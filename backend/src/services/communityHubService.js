const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage/inMemory');
const { messageService } = require('./messageService');
const { emitToChannelViewers } = require('../sockets/authorizedEmit');
const { platformService } = require('./platformService');

const DAY = 24 * 60 * 60 * 1000;
let workerTimer = null;
let configuredPushKey = '';

function ensureHubState() {
  const root = storage.platformState;
  if (!root.communityHub || typeof root.communityHub !== 'object' || Array.isArray(root.communityHub)) {
    root.communityHub = {};
  }
  const hub = root.communityHub;
  const arrayFields = ['bookmarks', 'reminders', 'scheduledMessages', 'lfgPosts', 'tickets', 'wikiPages', 'whiteboards'];
  arrayFields.forEach(field => { if (!Array.isArray(hub[field])) hub[field] = []; });
  ['sessions', 'passkeys', 'pushSubscriptions'].forEach(field => {
    if (!hub[field] || typeof hub[field] !== 'object' || Array.isArray(hub[field])) hub[field] = {};
  });
  if (!hub.vapidKeys || typeof hub.vapidKeys !== 'object') hub.vapidKeys = null;
  return hub;
}

function cleanText(value, max = 500, required = false) {
  const clean = String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  if (required && !clean) {
    const error = new Error('This field is required.');
    error.statusCode = 400;
    throw error;
  }
  return clean;
}

function channelAccess(userId, channelId, permission = 'VIEW_CHANNEL') {
  const channel = storage.getChannelById(String(channelId || ''));
  const server = channel && storage.getServerById(channel.serverId);
  if (!channel || !server) return { allowed: false, channel, server };
  if (server.isDM) {
    const member = server.dmUserIds?.includes(userId);
    const blocked = permission === 'SEND_MESSAGES' && server.dmUserIds?.some(id => id !== userId && storage.isBlockedEitherDirection(userId, id));
    return { allowed: member && !blocked, channel, server };
  }
  const isOwner = server.creatorId === userId;
  const isAdmin = storage.hasPermission(server.id, userId, 'ADMINISTRATOR');
  const hasPermission = platformService.hasChannelPermission(channel.id, userId, permission);
  const screened = permission !== 'SEND_MESSAGES' || isOwner || isAdmin || platformService.isMemberVerified(server.id, userId);
  const active = permission !== 'SEND_MESSAGES' || !platformService.isMemberTimedOut(server.id, userId);
  return {
    allowed: storage.isServerMember(server.id, userId) && hasPermission && screened && active,
    channel,
    server,
  };
}

function serverAccess(userId, serverId, permission = null) {
  const server = storage.getServerById(String(serverId || ''));
  if (!server || server.isDM || !storage.isServerMember(server.id, userId)) return { allowed: false, server };
  return {
    allowed: !permission || server.creatorId === userId || storage.hasPermission(server.id, userId, 'ADMINISTRATOR') || storage.hasPermission(server.id, userId, permission),
    server,
  };
}

function requestDevice(req) {
  return {
    ip: cleanText(req.ip || req.socket?.remoteAddress || 'unknown', 100),
    userAgent: cleanText(req.headers['user-agent'] || 'Unknown device', 240),
  };
}

function createSession(userId, req, method = 'password') {
  const hub = ensureHubState();
  const session = {
    id: uuidv4(),
    userId,
    method,
    ...requestDevice(req),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + Math.min(90, Math.max(1, Number(process.env.AUTH_SESSION_DAYS) || 7)) * DAY,
    revokedAt: null,
  };
  hub.sessions[session.id] = session;
  storage.saveData();
  return session;
}

function getSession(sessionId) {
  return ensureHubState().sessions[String(sessionId || '')] || null;
}

function touchSession(sessionId) {
  const session = getSession(sessionId);
  if (!session || session.revokedAt || session.expiresAt <= Date.now()) return false;
  if (Date.now() - Number(session.lastSeenAt || 0) > 5 * 60 * 1000) {
    session.lastSeenAt = Date.now();
    storage.saveData();
  }
  return true;
}

function configureWebPush() {
  const hub = ensureHubState();
  const envPublic = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPublic && envPrivate) hub.vapidKeys = { publicKey: envPublic, privateKey: envPrivate };
  if (!hub.vapidKeys?.publicKey || !hub.vapidKeys?.privateKey) {
    hub.vapidKeys = webpush.generateVAPIDKeys();
    storage.saveData();
  }
  if (configuredPushKey !== hub.vapidKeys.publicKey) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@tahosapp.com.tr',
      hub.vapidKeys.publicKey,
      hub.vapidKeys.privateKey,
    );
    configuredPushKey = hub.vapidKeys.publicKey;
  }
  return hub.vapidKeys.publicKey;
}

async function notifyUserPush(userId, payload) {
  configureWebPush();
  const hub = ensureHubState();
  const subscriptions = Array.isArray(hub.pushSubscriptions[userId]) ? hub.pushSubscriptions[userId] : [];
  const expired = new Set();
  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60, timeout: 10_000 });
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) expired.add(subscription.endpoint);
    }
  }));
  if (expired.size) {
    hub.pushSubscriptions[userId] = subscriptions.filter(item => !expired.has(item.endpoint));
    storage.saveData();
  }
}

async function deliverScheduled(io, item) {
  const user = storage.getUserById(item.userId);
  const access = channelAccess(item.userId, item.channelId, 'SEND_MESSAGES');
  if (!user || !access.allowed) throw new Error('Channel access is no longer available.');
  const message = await messageService.createMessage({
    username: user.username,
    userId: user.id,
    content: item.content,
    channelId: item.channelId,
  });
  message.scheduled = true;
  storage.saveData();
  emitToChannelViewers(io, item.channelId, 'message:receive', message, { currentRoomOnly: true });
  io?.to(`user:${item.userId}`).emit('scheduled-message:sent', { scheduledMessageId: item.id, message });
  return message;
}

async function processDueItems(io) {
  const hub = ensureHubState();
  const now = Date.now();
  const dueMessages = hub.scheduledMessages.filter(item => item.status === 'pending' && item.sendAt <= now).slice(0, 25);
  for (const item of dueMessages) {
    item.status = 'processing';
    try {
      const message = await deliverScheduled(io, item);
      item.status = 'sent';
      item.sentAt = Date.now();
      item.messageId = message.id;
    } catch (error) {
      item.status = 'failed';
      item.error = cleanText(error.message, 200);
    }
  }
  const dueReminders = hub.reminders.filter(item => item.status === 'pending' && item.remindAt <= now).slice(0, 50);
  for (const item of dueReminders) {
    item.status = 'delivered';
    item.deliveredAt = Date.now();
    const payload = {
      id: `reminder-${item.id}`,
      title: 'Hatırlatıcı',
      body: item.note || item.messagePreview || 'Kaydettiğiniz mesaja yeniden bakma zamanı.',
      channelId: item.channelId,
      messageId: item.messageId,
      timestamp: Date.now(),
      url: item.channelId ? `/?channel=${encodeURIComponent(item.channelId)}&message=${encodeURIComponent(item.messageId || '')}` : '/',
    };
    io?.to(`user:${item.userId}`).emit('notification:new', payload);
    await notifyUserPush(item.userId, payload);
  }
  if (dueMessages.length || dueReminders.length) storage.saveData();
}

function startCommunityWorkers(io) {
  configureWebPush();
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = setInterval(() => processDueItems(io).catch(error => console.error('Community worker failed:', error.message)), 5000);
  workerTimer.unref?.();
  processDueItems(io).catch(error => console.error('Community worker startup failed:', error.message));
  return () => { if (workerTimer) clearInterval(workerTimer); workerTimer = null; };
}

module.exports = {
  channelAccess,
  cleanText,
  configureWebPush,
  createSession,
  ensureHubState,
  getSession,
  notifyUserPush,
  requestDevice,
  serverAccess,
  startCommunityWorkers,
  touchSession,
};
