const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { requireAuth, signAuthToken } = require('../middleware/auth');
const { emitToChannelViewers, emitToServerMembers } = require('../sockets/authorizedEmit');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { messageModerationService } = require('../services/messageModerationService');
const {
  channelAccess,
  cleanText,
  configureWebPush,
  createSession,
  ensureHubState,
  serverAccess,
} = require('../services/communityHubService');

const router = express.Router();
const passkeyRateLimit = rateLimit(createRateLimitOptions('auth', 'hub-passkey'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'hub'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'hub'));
const passkeyChallenges = new Map();
const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function asTime(value, { future = false } = {}) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  if (future && (timestamp < Date.now() + 5000 || timestamp > Date.now() + MAX_FUTURE_MS)) return null;
  return timestamp;
}

function messageSnapshot(channelId, messageId) {
  const message = storage.getChannelMessages(channelId).find(item => item.id === messageId);
  if (!message) return null;
  return {
    messageId: message.id,
    channelId,
    authorId: message.userId,
    authorName: message.username,
    content: cleanText(message.content, 1000),
    timestamp: message.timestamp,
    attachments: (message.attachments || []).slice(0, 3),
  };
}

function publicUser(user) {
  if (!user) return null;
  const { password, tokenVersion, platformRole, platformBan, platformBanClearedAt, platformBanClearedBy, ...safe } = user;
  return { ...safe, isPlatformAdmin: ['owner', 'admin'].includes(platformRole) };
}

function canManageServer(userId, serverId, permission = 'MANAGE_SERVER') {
  return serverAccess(userId, serverId, permission).allowed;
}

function cleanupChallenges() {
  const now = Date.now();
  for (const [id, pending] of passkeyChallenges.entries()) if (pending.expiresAt <= now) passkeyChallenges.delete(id);
}

function passkeyContext(req) {
  const configuredOrigin = String(process.env.WEBAUTHN_ORIGIN || '').trim();
  const requestOrigin = String(req.headers.origin || '').trim();
  const origin = configuredOrigin || requestOrigin;
  if (!origin || !/^https?:\/\//i.test(origin)) throw new Error('Passkey requires the web app to run on HTTPS or localhost.');
  const hostname = new URL(origin).hostname;
  return {
    origin,
    rpID: String(process.env.WEBAUTHN_RP_ID || hostname).trim(),
    rpName: String(process.env.WEBAUTHN_RP_NAME || 'tahosapp').trim(),
  };
}

// Passkey ile giriş endpointleri oturum açmadan kullanılabilmelidir.
router.post('/passkeys/login/options', passkeyRateLimit, async (req, res) => {
  try {
    cleanupChallenges();
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = storage.getUserByEmail(email);
    const credentials = user ? (ensureHubState().passkeys[user.id] || []) : [];
    if (!user || !credentials.length) return fail(res, 404, 'Bu hesap için kayıtlı passkey bulunamadı.');
    const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
    const context = passkeyContext(req);
    const options = await generateAuthenticationOptions({
      rpID: context.rpID,
      allowCredentials: credentials.map(item => ({ id: item.id, transports: item.transports || [] })),
      userVerification: 'required',
    });
    const ticket = uuidv4();
    passkeyChallenges.set(ticket, { type: 'login', userId: user.id, challenge: options.challenge, ...context, expiresAt: Date.now() + 5 * 60 * 1000 });
    return res.json({ ticket, options });
  } catch (error) {
    return fail(res, 400, error.message || 'Passkey girişi başlatılamadı.');
  }
});

router.post('/passkeys/login/verify', passkeyRateLimit, async (req, res) => {
  try {
    cleanupChallenges();
    const pending = passkeyChallenges.get(String(req.body.ticket || ''));
    if (!pending || pending.type !== 'login') return fail(res, 400, 'Passkey isteğinin süresi doldu.');
    const hub = ensureHubState();
    const stored = (hub.passkeys[pending.userId] || []).find(item => item.id === req.body.response?.id);
    if (!stored) return fail(res, 401, 'Passkey doğrulanamadı.');
    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');
    const verification = await verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: pending.origin,
      expectedRPID: pending.rpID,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: Number(stored.counter) || 0,
        transports: stored.transports || [],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return fail(res, 401, 'Passkey doğrulanamadı.');
    stored.counter = verification.authenticationInfo.newCounter;
    stored.lastUsedAt = Date.now();
    passkeyChallenges.delete(String(req.body.ticket || ''));
    const user = storage.getUserById(pending.userId);
    if (!user || storage.getUserPlatformBan(user.id)) return fail(res, 403, 'Bu hesap kullanılamıyor.');
    const session = createSession(user.id, req, 'passkey');
    storage.saveData();
    return res.json({ user: publicUser(user), token: signAuthToken(user, { sid: session.id }) });
  } catch (error) {
    return fail(res, 401, error.message || 'Passkey doğrulanamadı.');
  }
});

router.use(requireAuth, readRateLimit, mutationRateLimit);

router.get('/overview', (req, res) => {
  const hub = ensureHubState();
  const serverId = String(req.query.serverId || '');
  const channelId = String(req.query.channelId || '');
  const serverAllowed = serverId && serverAccess(req.user.id, serverId).allowed;
  const channelAllowed = channelId && channelAccess(req.user.id, channelId).allowed;
  const isStaff = serverAllowed && canManageServer(req.user.id, serverId, 'MODERATE_MEMBERS');
  return res.json({
    bookmarks: hub.bookmarks.filter(item => item.userId === req.user.id).sort((a, b) => b.createdAt - a.createdAt),
    reminders: hub.reminders.filter(item => item.userId === req.user.id).sort((a, b) => a.remindAt - b.remindAt),
    scheduledMessages: hub.scheduledMessages.filter(item => item.userId === req.user.id).sort((a, b) => a.sendAt - b.sendAt),
    sessions: Object.values(hub.sessions).filter(item => item.userId === req.user.id && !item.revokedAt).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    passkeys: (hub.passkeys[req.user.id] || []).map(({ publicKey, ...item }) => item),
    pushEnabled: Boolean((hub.pushSubscriptions[req.user.id] || []).length),
    vapidPublicKey: configureWebPush(),
    lfgPosts: serverAllowed ? hub.lfgPosts.filter(item => item.serverId === serverId && item.status !== 'closed').sort((a, b) => b.createdAt - a.createdAt) : [],
    tickets: serverAllowed ? hub.tickets.filter(item => item.serverId === serverId && (isStaff || item.requesterId === req.user.id)).sort((a, b) => b.updatedAt - a.updatedAt) : [],
    wikiPages: serverAllowed ? hub.wikiPages.filter(item => item.serverId === serverId).sort((a, b) => a.title.localeCompare(b.title)) : [],
    whiteboard: channelAllowed ? (hub.whiteboards.find(item => item.channelId === channelId) || { channelId, strokes: [], updatedAt: null }) : null,
    currentSessionId: req.auth?.sid || null,
    permissions: {
      manageTickets: Boolean(isStaff),
      clearWhiteboard: Boolean(channelId && channelAccess(req.user.id, channelId, 'MANAGE_MESSAGES').allowed),
      manageWiki: Boolean(serverAllowed && canManageServer(req.user.id, serverId)),
    },
  });
});

router.post('/bookmarks', (req, res) => {
  const channelId = String(req.body.channelId || '');
  const messageId = String(req.body.messageId || '');
  if (!channelAccess(req.user.id, channelId).allowed) return fail(res, 403, 'Bu mesaja erişiminiz yok.');
  const snapshot = messageSnapshot(channelId, messageId);
  if (!snapshot) return fail(res, 404, 'Mesaj bulunamadı.');
  const hub = ensureHubState();
  const existing = hub.bookmarks.find(item => item.userId === req.user.id && item.messageId === messageId);
  if (existing) return res.json(existing);
  const bookmark = { id: uuidv4(), userId: req.user.id, collection: cleanText(req.body.collection, 50) || 'Genel', note: cleanText(req.body.note, 240), ...snapshot, createdAt: Date.now() };
  hub.bookmarks.push(bookmark);
  storage.saveData();
  return res.status(201).json(bookmark);
});

router.delete('/bookmarks/:id', (req, res) => {
  const hub = ensureHubState();
  const before = hub.bookmarks.length;
  hub.bookmarks = hub.bookmarks.filter(item => item.id !== req.params.id || item.userId !== req.user.id);
  if (hub.bookmarks.length === before) return fail(res, 404, 'Kayıt bulunamadı.');
  storage.saveData();
  return res.json({ success: true });
});

router.post('/reminders', (req, res) => {
  const channelId = String(req.body.channelId || '');
  if (channelId && !channelAccess(req.user.id, channelId).allowed) return fail(res, 403, 'Bu kanala erişiminiz yok.');
  const remindAt = asTime(req.body.remindAt, { future: true });
  if (!remindAt) return fail(res, 400, 'Geçerli bir gelecek tarihi seçin.');
  const snapshot = req.body.messageId ? messageSnapshot(channelId, String(req.body.messageId)) : null;
  if (req.body.messageId && !snapshot) return fail(res, 404, 'Mesaj bulunamadı.');
  const reminder = { id: uuidv4(), userId: req.user.id, channelId: channelId || null, messageId: snapshot?.messageId || null, messagePreview: snapshot?.content || '', note: cleanText(req.body.note, 300) || snapshot?.content || 'Hatırlatıcı', remindAt, status: 'pending', createdAt: Date.now() };
  ensureHubState().reminders.push(reminder);
  storage.saveData();
  return res.status(201).json(reminder);
});

router.delete('/reminders/:id', (req, res) => {
  const hub = ensureHubState();
  const item = hub.reminders.find(entry => entry.id === req.params.id && entry.userId === req.user.id);
  if (!item) return fail(res, 404, 'Hatırlatıcı bulunamadı.');
  item.status = 'cancelled';
  item.cancelledAt = Date.now();
  storage.saveData();
  return res.json(item);
});

router.post('/scheduled-messages', (req, res) => {
  const channelId = String(req.body.channelId || '');
  const access = channelAccess(req.user.id, channelId, 'SEND_MESSAGES');
  if (!access.allowed) return fail(res, 403, 'Bu kanalda mesaj gönderemezsiniz.');
  const content = cleanText(req.body.content, 4000, true);
  const violation = messageModerationService.inspect({ server: access.server, channel: access.channel, userId: req.user.id, content, skipRateLimits: true });
  if (violation) return fail(res, 400, violation.message);
  const sendAt = asTime(req.body.sendAt, { future: true });
  if (!sendAt) return fail(res, 400, 'Geçerli bir gelecek tarihi seçin.');
  const item = { id: uuidv4(), userId: req.user.id, channelId, content, sendAt, status: 'pending', createdAt: Date.now() };
  ensureHubState().scheduledMessages.push(item);
  storage.saveData();
  return res.status(201).json(item);
});

router.delete('/scheduled-messages/:id', (req, res) => {
  const item = ensureHubState().scheduledMessages.find(entry => entry.id === req.params.id && entry.userId === req.user.id);
  if (!item) return fail(res, 404, 'Zamanlanmış mesaj bulunamadı.');
  if (item.status !== 'pending') return fail(res, 409, 'Bu mesaj artık iptal edilemez.');
  item.status = 'cancelled';
  item.cancelledAt = Date.now();
  storage.saveData();
  return res.json(item);
});

router.post('/lfg', (req, res) => {
  const serverId = String(req.body.serverId || '');
  if (!serverAccess(req.user.id, serverId).allowed) return fail(res, 403, 'Bu sunucuya erişiminiz yok.');
  const maxPlayers = Math.min(20, Math.max(2, Number(req.body.maxPlayers) || 5));
  const post = { id: uuidv4(), serverId, ownerId: req.user.id, ownerName: req.user.username, game: cleanText(req.body.game, 80, true), title: cleanText(req.body.title, 120, true), details: cleanText(req.body.details, 500), rank: cleanText(req.body.rank, 60), language: cleanText(req.body.language, 40) || 'Türkçe', maxPlayers, memberIds: [req.user.id], status: 'open', voiceChannelId: null, createdAt: Date.now(), updatedAt: Date.now() };
  ensureHubState().lfgPosts.push(post);
  storage.saveData();
  emitToServerMembers(req.app.get('io'), serverId, 'hub:lfg-update', { action: 'created', post });
  return res.status(201).json(post);
});

router.post('/lfg/:id/join', (req, res) => {
  const post = ensureHubState().lfgPosts.find(item => item.id === req.params.id);
  if (!post || post.status === 'closed') return fail(res, 404, 'Ekip ilanı bulunamadı.');
  if (!serverAccess(req.user.id, post.serverId).allowed) return fail(res, 403, 'Bu sunucuya erişiminiz yok.');
  if (!post.memberIds.includes(req.user.id)) post.memberIds.push(req.user.id);
  if (post.memberIds.length >= post.maxPlayers) {
    post.status = 'full';
    if (!post.voiceChannelId) {
      const channel = storage.createChannel(post.serverId, `ekip-${post.game}`.toLowerCase().replace(/[^a-z0-9ğüşöçı_-]+/gi, '-').slice(0, 80), 'voice');
      channel.temporary = true;
      channel.userLimit = post.maxPlayers;
      post.voiceChannelId = channel.id;
      req.app.get('io')?.to(`server:${post.serverId}`).emit('channels:changed', { serverId: post.serverId });
    }
  }
  post.updatedAt = Date.now();
  storage.saveData();
  emitToServerMembers(req.app.get('io'), post.serverId, 'hub:lfg-update', { action: 'joined', post });
  return res.json(post);
});

router.delete('/lfg/:id', (req, res) => {
  const post = ensureHubState().lfgPosts.find(item => item.id === req.params.id);
  if (!post) return fail(res, 404, 'Ekip ilanı bulunamadı.');
  if (post.ownerId !== req.user.id && !canManageServer(req.user.id, post.serverId)) return fail(res, 403, 'Bu ilanı kapatamazsınız.');
  post.status = 'closed';
  post.updatedAt = Date.now();
  storage.saveData();
  emitToServerMembers(req.app.get('io'), post.serverId, 'hub:lfg-update', { action: 'closed', post });
  return res.json(post);
});

router.post('/tickets', (req, res) => {
  const serverId = String(req.body.serverId || '');
  if (!serverAccess(req.user.id, serverId).allowed) return fail(res, 403, 'Bu sunucuya erişiminiz yok.');
  const ticket = { id: uuidv4(), serverId, requesterId: req.user.id, requesterName: req.user.username, subject: cleanText(req.body.subject, 120, true), status: 'open', assigneeId: null, messages: [{ id: uuidv4(), userId: req.user.id, username: req.user.username, content: cleanText(req.body.message, 2000, true), createdAt: Date.now() }], createdAt: Date.now(), updatedAt: Date.now() };
  ensureHubState().tickets.push(ticket);
  storage.saveData();
  emitToServerMembers(req.app.get('io'), serverId, 'hub:ticket-update', { action: 'created', ticketId: ticket.id }, 'MODERATE_MEMBERS');
  return res.status(201).json(ticket);
});

router.post('/tickets/:id/messages', (req, res) => {
  const ticket = ensureHubState().tickets.find(item => item.id === req.params.id);
  if (!ticket) return fail(res, 404, 'Destek talebi bulunamadı.');
  const staff = canManageServer(req.user.id, ticket.serverId, 'MODERATE_MEMBERS');
  if (ticket.requesterId !== req.user.id && !staff) return fail(res, 403, 'Bu talebe erişiminiz yok.');
  if (ticket.status === 'resolved') return fail(res, 409, 'Çözülmüş talebe mesaj eklenemez.');
  const message = { id: uuidv4(), userId: req.user.id, username: req.user.username, content: cleanText(req.body.message, 2000, true), createdAt: Date.now() };
  ticket.messages.push(message);
  ticket.updatedAt = Date.now();
  storage.saveData();
  req.app.get('io')?.to(`user:${ticket.requesterId}`).emit('hub:ticket-update', { action: 'message', ticketId: ticket.id });
  emitToServerMembers(req.app.get('io'), ticket.serverId, 'hub:ticket-update', { action: 'message', ticketId: ticket.id }, 'MODERATE_MEMBERS');
  return res.status(201).json(ticket);
});

router.patch('/tickets/:id', (req, res) => {
  const ticket = ensureHubState().tickets.find(item => item.id === req.params.id);
  if (!ticket) return fail(res, 404, 'Destek talebi bulunamadı.');
  if (!canManageServer(req.user.id, ticket.serverId, 'MODERATE_MEMBERS')) return fail(res, 403, 'Bu talebi yönetemezsiniz.');
  if (['open', 'pending', 'resolved'].includes(req.body.status)) ticket.status = req.body.status;
  if (req.body.assignToMe === true) ticket.assigneeId = req.user.id;
  ticket.updatedAt = Date.now();
  storage.saveData();
  req.app.get('io')?.to(`user:${ticket.requesterId}`).emit('hub:ticket-update', { action: 'updated', ticketId: ticket.id });
  return res.json(ticket);
});

router.post('/wiki', (req, res) => {
  const serverId = String(req.body.serverId || '');
  if (!serverAccess(req.user.id, serverId).allowed) return fail(res, 403, 'Bu sunucuya erişiminiz yok.');
  const page = { id: uuidv4(), serverId, title: cleanText(req.body.title, 100, true), content: cleanText(req.body.content, 12000, true), authorId: req.user.id, authorName: req.user.username, revisions: [], createdAt: Date.now(), updatedAt: Date.now() };
  ensureHubState().wikiPages.push(page);
  storage.saveData();
  emitToServerMembers(req.app.get('io'), serverId, 'hub:wiki-update', { action: 'created', page });
  return res.status(201).json(page);
});

router.patch('/wiki/:id', (req, res) => {
  const page = ensureHubState().wikiPages.find(item => item.id === req.params.id);
  if (!page) return fail(res, 404, 'Wiki sayfası bulunamadı.');
  if (page.authorId !== req.user.id && !canManageServer(req.user.id, page.serverId)) return fail(res, 403, 'Bu sayfayı düzenleyemezsiniz.');
  page.revisions = Array.isArray(page.revisions) ? page.revisions : [];
  page.revisions.push({ title: page.title, content: page.content, editedBy: req.user.id, editedAt: Date.now() });
  page.revisions = page.revisions.slice(-20);
  if (req.body.title !== undefined) page.title = cleanText(req.body.title, 100, true);
  if (req.body.content !== undefined) page.content = cleanText(req.body.content, 12000, true);
  page.updatedAt = Date.now();
  page.updatedBy = req.user.id;
  storage.saveData();
  emitToServerMembers(req.app.get('io'), page.serverId, 'hub:wiki-update', { action: 'updated', page });
  return res.json(page);
});

router.delete('/wiki/:id', (req, res) => {
  const hub = ensureHubState();
  const page = hub.wikiPages.find(item => item.id === req.params.id);
  if (!page) return fail(res, 404, 'Wiki sayfası bulunamadı.');
  if (page.authorId !== req.user.id && !canManageServer(req.user.id, page.serverId)) return fail(res, 403, 'Bu sayfayı silemezsiniz.');
  hub.wikiPages = hub.wikiPages.filter(item => item.id !== page.id);
  storage.saveData();
  emitToServerMembers(req.app.get('io'), page.serverId, 'hub:wiki-update', { action: 'deleted', pageId: page.id });
  return res.json({ success: true });
});

router.post('/whiteboards/:channelId/strokes', (req, res) => {
  const access = channelAccess(req.user.id, req.params.channelId, 'SEND_MESSAGES');
  if (!access.allowed) return fail(res, 403, 'Bu tahtaya çizim yapamazsınız.');
  const points = (Array.isArray(req.body.points) ? req.body.points : []).slice(0, 200).map(point => ({ x: Math.max(0, Math.min(1, Number(point.x) || 0)), y: Math.max(0, Math.min(1, Number(point.y) || 0)) }));
  if (points.length < 2) return fail(res, 400, 'Çizgi için en az iki nokta gerekir.');
  const hub = ensureHubState();
  let board = hub.whiteboards.find(item => item.channelId === req.params.channelId);
  if (!board) { board = { channelId: req.params.channelId, strokes: [], updatedAt: Date.now() }; hub.whiteboards.push(board); }
  const stroke = { id: uuidv4(), userId: req.user.id, color: /^#[0-9a-f]{6}$/i.test(req.body.color) ? req.body.color : '#60a5fa', width: Math.max(1, Math.min(12, Number(req.body.width) || 3)), points, createdAt: Date.now() };
  board.strokes.push(stroke);
  board.strokes = board.strokes.slice(-1000);
  board.updatedAt = Date.now();
  storage.saveData();
  emitToChannelViewers(req.app.get('io'), req.params.channelId, 'whiteboard:stroke', stroke);
  return res.status(201).json(stroke);
});

router.delete('/whiteboards/:channelId', (req, res) => {
  const access = channelAccess(req.user.id, req.params.channelId, 'MANAGE_MESSAGES');
  if (!access.allowed) return fail(res, 403, 'Tahtayı temizleme izniniz yok.');
  const hub = ensureHubState();
  hub.whiteboards = hub.whiteboards.filter(item => item.channelId !== req.params.channelId);
  storage.saveData();
  emitToChannelViewers(req.app.get('io'), req.params.channelId, 'whiteboard:cleared', { channelId: req.params.channelId });
  return res.json({ success: true });
});

router.get('/catch-up/:channelId', (req, res) => {
  if (!channelAccess(req.user.id, req.params.channelId).allowed) return fail(res, 403, 'Bu kanala erişiminiz yok.');
  const since = Math.max(0, Number(req.query.since) || Date.now() - 24 * 60 * 60 * 1000);
  const messages = storage.getChannelMessages(req.params.channelId).filter(item => item.timestamp > since).slice(-250);
  const participants = {};
  const questions = [];
  const mentions = [];
  const decisions = [];
  messages.forEach(message => {
    participants[message.username] = (participants[message.username] || 0) + 1;
    const content = cleanText(message.content, 500);
    if (!content) return;
    const entry = { id: message.id, username: message.username, content, timestamp: message.timestamp };
    if (content.includes('?')) questions.push(entry);
    if (content.toLocaleLowerCase('tr').includes(`@${req.user.username}`.toLocaleLowerCase('tr'))) mentions.push(entry);
    if (/\b(karar|anlaştık|yapacağız|plan|decided|agreed|will do)\b/i.test(content)) decisions.push(entry);
  });
  return res.json({
    since,
    messageCount: messages.length,
    participants: Object.entries(participants).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([username, count]) => ({ username, count })),
    mentions: mentions.slice(-10),
    questions: questions.slice(-10),
    decisions: decisions.slice(-10),
    highlights: messages.filter(item => item.isPinned || (item.reactions && Object.keys(item.reactions).length)).slice(-10).map(item => ({ id: item.id, username: item.username, content: cleanText(item.content, 500), timestamp: item.timestamp })),
  });
});

router.get('/sessions', (req, res) => {
  const sessions = Object.values(ensureHubState().sessions).filter(item => item.userId === req.user.id && !item.revokedAt).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  return res.json({ sessions, currentSessionId: req.auth?.sid || null });
});

router.delete('/sessions/:id', (req, res) => {
  const session = ensureHubState().sessions[req.params.id];
  if (!session || session.userId !== req.user.id) return fail(res, 404, 'Oturum bulunamadı.');
  session.revokedAt = Date.now();
  storage.saveData();
  return res.json({ success: true, current: req.auth?.sid === session.id });
});

router.post('/passkeys/register/options', async (req, res) => {
  try {
    cleanupChallenges();
    const { generateRegistrationOptions } = await import('@simplewebauthn/server');
    const hub = ensureHubState();
    const credentials = hub.passkeys[req.user.id] || [];
    const context = passkeyContext(req);
    const options = await generateRegistrationOptions({
      rpName: context.rpName,
      rpID: context.rpID,
      userName: req.user.email || req.user.username,
      userDisplayName: req.user.username,
      userID: Buffer.from(req.user.id, 'utf8'),
      excludeCredentials: credentials.map(item => ({ id: item.id, transports: item.transports || [] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    const ticket = uuidv4();
    passkeyChallenges.set(ticket, { type: 'register', userId: req.user.id, challenge: options.challenge, ...context, expiresAt: Date.now() + 5 * 60 * 1000 });
    return res.json({ ticket, options });
  } catch (error) {
    return fail(res, 400, error.message || 'Passkey kaydı başlatılamadı.');
  }
});

router.post('/passkeys/register/verify', async (req, res) => {
  try {
    cleanupChallenges();
    const ticket = String(req.body.ticket || '');
    const pending = passkeyChallenges.get(ticket);
    if (!pending || pending.type !== 'register' || pending.userId !== req.user.id) return fail(res, 400, 'Passkey isteğinin süresi doldu.');
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    const verification = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge: pending.challenge, expectedOrigin: pending.origin, expectedRPID: pending.rpID, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) return fail(res, 400, 'Passkey doğrulanamadı.');
    const credential = verification.registrationInfo.credential;
    const passkey = { id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: req.body.response?.response?.transports || credential.transports || [], deviceType: verification.registrationInfo.credentialDeviceType, backedUp: verification.registrationInfo.credentialBackedUp, name: cleanText(req.body.name, 80) || 'Passkey', createdAt: Date.now(), lastUsedAt: null };
    const hub = ensureHubState();
    hub.passkeys[req.user.id] = (hub.passkeys[req.user.id] || []).filter(item => item.id !== passkey.id);
    hub.passkeys[req.user.id].push(passkey);
    passkeyChallenges.delete(ticket);
    storage.saveData();
    const { publicKey, ...safePasskey } = passkey;
    return res.status(201).json(safePasskey);
  } catch (error) {
    return fail(res, 400, error.message || 'Passkey kaydedilemedi.');
  }
});

router.delete('/passkeys/:id', (req, res) => {
  const hub = ensureHubState();
  const current = hub.passkeys[req.user.id] || [];
  hub.passkeys[req.user.id] = current.filter(item => item.id !== req.params.id);
  if (hub.passkeys[req.user.id].length === current.length) return fail(res, 404, 'Passkey bulunamadı.');
  storage.saveData();
  return res.json({ success: true });
});

router.get('/push/public-key', (req, res) => res.json({ publicKey: configureWebPush() }));

router.post('/push/subscriptions', (req, res) => {
  const subscription = req.body.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return fail(res, 400, 'Geçerli bir bildirim aboneliği gerekir.');
  const hub = ensureHubState();
  const current = hub.pushSubscriptions[req.user.id] || [];
  hub.pushSubscriptions[req.user.id] = [...current.filter(item => item.endpoint !== subscription.endpoint), { endpoint: cleanText(subscription.endpoint, 2048, true), expirationTime: subscription.expirationTime || null, keys: { p256dh: cleanText(subscription.keys.p256dh, 300, true), auth: cleanText(subscription.keys.auth, 200, true) }, createdAt: Date.now() }].slice(-10);
  storage.saveData();
  return res.status(201).json({ success: true });
});

router.delete('/push/subscriptions', (req, res) => {
  const endpoint = String(req.body.endpoint || '');
  const hub = ensureHubState();
  hub.pushSubscriptions[req.user.id] = (hub.pushSubscriptions[req.user.id] || []).filter(item => item.endpoint !== endpoint);
  storage.saveData();
  return res.json({ success: true });
});

module.exports = router;
