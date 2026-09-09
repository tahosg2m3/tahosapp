const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { messageService } = require('../services/messageService');
const { platformService } = require('../services/platformService');
const { disconnectUserFromServerVoice } = require('../sockets/handlers/voiceHandler');
const { emitAudit, emitToChannelViewers, emitToServerMembers } = require('../sockets/authorizedEmit');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'platform'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'platform'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'platform'));
const publicReadRateLimit = rateLimit(createRateLimitOptions('publicRead', 'platform-public'));
const webhookRateLimit = rateLimit(createRateLimitOptions('webhook', 'platform-webhook'));

const CHANNEL_TYPES = new Set([
  'text',
  'voice',
  'category',
  'announcement',
  'forum',
  'stage',
  'media',
]);

const CHANNEL_WRITE_PERMISSIONS = new Set([
  'SEND_MESSAGES',
  'SEND_MESSAGES_IN_THREADS',
  'CREATE_PUBLIC_THREADS',
]);

const PLATFORM_SCOPE_PERMISSIONS = {
  invites: 'MANAGE_SERVER',
  'server-settings': 'MANAGE_SERVER',
  automod: 'MANAGE_SERVER',
  reports: 'MODERATE_MEMBERS',
  bans: 'BAN_MEMBERS',
  webhooks: 'MANAGE_WEBHOOKS',
  server: 'MANAGE_SERVER',
  'channel-permissions': 'MANAGE_CHANNELS',
  'announcement-follows': 'MANAGE_CHANNELS',
};

function text(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getServer(req, res, { permission = null, ownerOnly = false } = {}) {
  const serverId = text(req.params.serverId, 100);
  const server = storage.getServerById(serverId);
  if (!server || server.isDM) {
    res.status(404).json({ error: 'Server not found.' });
    return null;
  }
  if (!storage.isServerMember(serverId, req.user.id)) {
    res.status(403).json({ error: 'You do not have access to this server.' });
    return null;
  }
  if (ownerOnly && server.creatorId !== req.user.id) {
    res.status(403).json({ error: 'Only the server owner can perform this action.' });
    return null;
  }
  if (permission && server.creatorId !== req.user.id && !storage.hasPermission(serverId, req.user.id, permission)) {
    res.status(403).json({ error: 'You do not have permission to perform this action.' });
    return null;
  }
  return server;
}

function getChannel(req, res, permission = 'VIEW_CHANNEL') {
  const channelId = text(req.params.channelId, 100);
  const channel = storage.getChannelById(channelId);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found.' });
    return null;
  }
  const server = storage.getServerById(channel.serverId);
  if (!server || server.isDM || !storage.isServerMember(server.id, req.user.id)) {
    res.status(403).json({ error: 'You do not have access to this channel.' });
    return null;
  }
  const allowed = typeof platformService.hasChannelPermission === 'function'
    ? platformService.hasChannelPermission(channel.id, req.user.id, permission)
    : storage.hasPermission(server.id, req.user.id, permission);
  if (!allowed) {
    res.status(403).json({ error: 'You do not have the required channel permission.' });
    return null;
  }
  if (CHANNEL_WRITE_PERMISSIONS.has(permission)) {
    const bypassScreening = server.creatorId === req.user.id
      || storage.hasPermission(server.id, req.user.id, 'ADMINISTRATOR');
    if (platformService.isMemberTimedOut(server.id, req.user.id)) {
      res.status(403).json({
        error: 'You cannot post in this channel while timed out.',
        code: 'TIMEOUT',
      });
      return null;
    }
    if (!bypassScreening && !platformService.isMemberVerified(server.id, req.user.id)) {
      res.status(403).json({
        error: 'You must accept the server rules before posting.',
        code: 'RULES_NOT_ACCEPTED',
      });
      return null;
    }
  }
  return { channel, server };
}

function emitChannelEvent(req, channelId, eventName, payload) {
  emitToChannelViewers(req.app.get('io'), channelId, eventName, payload, { currentRoomOnly: true });
}

function emitUpdate(req, serverId, scope, action, data, channelId = null) {
  const io = req.app.get('io');
  if (!io) return;
  const payload = {
    serverId,
    scope,
    action,
    data,
    timestamp: Date.now(),
  };
  const permission = PLATFORM_SCOPE_PERMISSIONS[scope] || null;
  if (channelId) {
    emitToChannelViewers(io, channelId, 'platform:update', payload, {
      permission: permission || 'VIEW_CHANNEL',
    });
    return;
  }
  emitToServerMembers(io, serverId, 'platform:update', payload, permission);
}

function emitChannelPermissionRefresh(req, serverId, channelId) {
  const io = req.app.get('io');
  if (!io) return;
  // The detailed override remains visible only to channel managers via
  // platform:update. Everyone else receives only a refresh signal, so a
  // member who just lost VIEW_CHANNEL can remove the channel immediately.
  emitToChannelViewers(io, channelId, 'channel:permissions-changed', { channelId });
  emitToServerMembers(io, serverId, 'channels:changed', { serverId });
}

function audit(req, serverId, action, targetType, targetId, metadata = {}) {
  const entry = platformService.addAuditLog(serverId, {
    action,
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType,
    targetId: targetId || null,
    metadata,
  });
  emitAudit(req.app.get('io'), serverId, entry);
  return entry;
}

function serviceError(res, error) {
  const status = Number(error?.statusCode) || 400;
  return res.status(status).json({ error: error?.message || 'The action could not be completed.' });
}

function withWebhookEndpoint(webhook) {
  if (!webhook?.id || !webhook?.token) return webhook;
  const url = `/api/webhooks/${encodeURIComponent(webhook.id)}/${encodeURIComponent(webhook.token)}/messages`;
  return { ...webhook, url, webhookUrl: url };
}

function publicTemplate(template) {
  if (!template) return null;
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    public: true,
    uses: template.uses || 0,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    roles: (template.roles || []).map(role => ({
      name: role.name,
      color: role.color,
      icon: role.icon || null,
      hoist: Boolean(role.hoist),
      mentionable: Boolean(role.mentionable),
      permissions: Array.isArray(role.permissions) ? role.permissions : [],
      position: role.position,
    })),
    channels: (template.channels || []).map(channel => ({
      name: channel.name,
      type: channel.type,
      metadata: {
        topic: channel.settings?.metadata?.topic || '',
        nsfw: Boolean(channel.settings?.metadata?.nsfw),
        slowModeSeconds: Number(channel.settings?.metadata?.slowModeSeconds) || 0,
      },
    })),
    rules: (template.rulesScreening?.rules || []).map(rule => ({
      title: rule.title,
      description: rule.description,
    })),
  };
}

// Public invite preview and server discovery do not expose member or secret data.
router.get('/invites/:code', publicReadRateLimit, (req, res) => {
  const invite = platformService.getInviteByCode(text(req.params.code, 64));
  if (!invite || invite.revokedAt || (invite.expiresAt && invite.expiresAt <= Date.now())) {
    return res.status(404).json({ error: 'The invite is invalid or expired.' });
  }
  const server = storage.getServerById(invite.serverId);
  if (!server || server.isDM) return res.status(404).json({ error: 'Server not found.' });
  return res.json({
    code: invite.code,
    server: { id: server.id, name: server.name, icon: server.icon || null },
    expiresAt: invite.expiresAt || null,
    maxUses: invite.maxUses || 0,
    uses: invite.uses || 0,
  });
});

router.get('/discovery', publicReadRateLimit, (req, res) => {
  const result = platformService.listDiscoverableServers({
    query: text(req.query.query, 100),
    category: text(req.query.category, 50),
    limit: integer(req.query.limit, 30, 1, 100),
  });
  return res.json(result);
});

router.post('/webhooks/:webhookId/:token/messages', webhookRateLimit, async (req, res) => {
  try {
    const webhook = platformService.getWebhookByToken(text(req.params.token, 200));
    if (!webhook || webhook.id !== text(req.params.webhookId, 100)) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    const content = text(req.body.content, 2000);
    if (!content) return res.status(400).json({ error: 'Message content is required.' });
    const replyTargetId = text(req.body.replyToMessageId || req.body.replyTo?.id, 128);
    const replyTarget = replyTargetId
      ? storage.getChannelMessages(webhook.channelId).find(item => item.id === replyTargetId)
      : null;
    const message = await messageService.createMessage({
      username: text(req.body.username, 80) || webhook.name,
      userId: `webhook:${webhook.id}`,
      content,
      channelId: webhook.channelId,
      attachments: [],
      replyTo: replyTarget ? {
        id: replyTarget.id,
        username: replyTarget.username,
        content: text(replyTarget.content, 500),
      } : null,
    });
    message.type = 'webhook';
    message.bot = true;
    message.webhookId = webhook.id;
    message.applicationId = webhook.id;
    message.author = { id: message.userId, username: message.username, bot: true };
    storage.saveData();
    emitChannelEvent(req, webhook.channelId, 'message:receive', message);
    platformService.touchWebhook(webhook.serverId, webhook.id);
    return res.status(201).json(message);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.use(authRateLimit, requireAuth, readRateLimit, mutationRateLimit);

// Invitations
router.get('/servers/:serverId/invites', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  return res.json(platformService.listInvites(server.id));
});

router.post('/servers/:serverId/invites', (req, res) => {
  const server = getServer(req, res, { permission: 'CREATE_INSTANT_INVITE' });
  if (!server) return undefined;
  try {
    const invite = platformService.createInvite(server.id, req.user.id, {
      channelId: text(req.body.channelId, 100) || null,
      maxAgeSeconds: integer(req.body.maxAgeSeconds, 86400, 0, 604800),
      maxUses: integer(req.body.maxUses, 0, 0, 1000),
      temporary: Boolean(req.body.temporary),
    });
    audit(req, server.id, 'INVITE_CREATE', 'invite', invite.id, { channelId: invite.channelId });
    emitUpdate(req, server.id, 'invites', 'created', invite);
    return res.status(201).json(invite);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.delete('/servers/:serverId/invites/:inviteId', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  const removed = platformService.revokeInvite(server.id, text(req.params.inviteId, 100));
  if (!removed) return res.status(404).json({ error: 'Invite not found.' });
  audit(req, server.id, 'INVITE_REVOKE', 'invite', req.params.inviteId);
  emitUpdate(req, server.id, 'invites', 'deleted', { id: req.params.inviteId });
  return res.json({ success: true });
});

// Audit log and automod
router.get('/servers/:serverId/settings', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  return res.json(platformService.getServerSettings(server.id));
});

router.put('/servers/:serverId/settings', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const settings = platformService.updateServerSettings(server.id, req.body);
  audit(req, server.id, 'SERVER_SETTINGS_UPDATE', 'server', server.id);
  emitUpdate(req, server.id, 'server-settings', 'updated', settings);
  return res.json(settings);
});

router.get('/servers/:serverId/audit-logs', (req, res) => {
  const server = getServer(req, res, { permission: 'VIEW_AUDIT_LOG' });
  if (!server) return undefined;
  return res.json(platformService.getAuditLogs(server.id, {
    limit: integer(req.query.limit, 100, 1, 250),
    before: Number(req.query.before) || null,
    action: text(req.query.action, 100) || null,
    actorId: text(req.query.actorId, 100) || null,
  }));
});

router.get('/servers/:serverId/automod', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  return res.json(platformService.getAutomodConfig(server.id));
});

router.put('/servers/:serverId/automod', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  const config = platformService.updateAutomodConfig(server.id, {
    enabled: req.body.enabled,
    blockLinks: req.body.blockLinks,
    blockInvites: req.body.blockInvites,
    capsPercentage: req.body.capsPercentage,
    capsMinimumLength: req.body.capsMinimumLength,
    maxMessagesPerInterval: req.body.spamMessageCount ?? req.body.maxMessagesPerInterval,
    intervalSeconds: req.body.spamIntervalSeconds ?? req.body.intervalSeconds,
    blockedWords: Array.isArray(req.body.blockedWords) ? req.body.blockedWords.slice(0, 500) : undefined,
    exemptRoleIds: Array.isArray(req.body.exemptRoleIds) ? req.body.exemptRoleIds.slice(0, 100) : undefined,
    exemptChannelIds: Array.isArray(req.body.exemptChannelIds) ? req.body.exemptChannelIds.slice(0, 100) : undefined,
    action: req.body.action,
    timeoutSeconds: req.body.timeoutSeconds
      ?? (Number.isFinite(Number(req.body.timeoutMinutes)) ? Number(req.body.timeoutMinutes) * 60 : undefined),
  });
  audit(req, server.id, 'AUTOMOD_UPDATE', 'server', server.id);
  emitUpdate(req, server.id, 'automod', 'updated', config);
  return res.json(config);
});

// Reports and bans
router.post('/servers/:serverId/reports', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  const reason = text(req.body.reason, 1000);
  if (!reason) return res.status(400).json({ error: 'A report reason is required.' });
  try {
    const report = platformService.createReport(server.id, req.user.id, {
      targetUserId: text(req.body.targetUserId, 100) || null,
      channelId: text(req.body.channelId, 100) || null,
      messageId: text(req.body.messageId, 100) || null,
      category: text(req.body.category, 50) || 'other',
      reason,
    });
    emitUpdate(req, server.id, 'reports', 'created', { id: report.id });
    return res.status(201).json(report);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.get('/servers/:serverId/reports', (req, res) => {
  const server = getServer(req, res, { permission: 'MODERATE_MEMBERS' });
  if (!server) return undefined;
  return res.json(platformService.listReports(server.id, {
    status: text(req.query.status, 30) || null,
    limit: integer(req.query.limit, 100, 1, 250),
  }));
});

router.patch('/servers/:serverId/reports/:reportId', (req, res) => {
  const server = getServer(req, res, { permission: 'MODERATE_MEMBERS' });
  if (!server) return undefined;
  const report = platformService.updateReport(server.id, text(req.params.reportId, 100), {
    status: text(req.body.status, 30),
    resolution: text(req.body.resolution, 1000) || null,
    moderatorId: req.user.id,
  });
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  audit(req, server.id, 'REPORT_UPDATE', 'report', report.id, { status: report.status });
  emitUpdate(req, server.id, 'reports', 'updated', report);
  return res.json(report);
});

router.delete('/servers/:serverId/reports/:reportId', (req, res) => {
  const server = getServer(req, res, { permission: 'MODERATE_MEMBERS' });
  if (!server) return undefined;
  if (!platformService.deleteReport(server.id, text(req.params.reportId, 100))) {
    return res.status(404).json({ error: 'Report not found.' });
  }
  audit(req, server.id, 'REPORT_DELETE', 'report', req.params.reportId);
  emitUpdate(req, server.id, 'reports', 'deleted', { id: req.params.reportId });
  return res.json({ success: true });
});

router.get('/servers/:serverId/bans', (req, res) => {
  const server = getServer(req, res, { permission: 'BAN_MEMBERS' });
  if (!server) return undefined;
  return res.json(platformService.listBans(server.id));
});

router.put('/servers/:serverId/bans/:userId', (req, res) => {
  const server = getServer(req, res, { permission: 'BAN_MEMBERS' });
  if (!server) return undefined;
  const targetUserId = text(req.params.userId, 100);
  if (targetUserId === server.creatorId || (storage.isServerMember(server.id, targetUserId)
    && !storage.canManageMember(server.id, req.user.id, targetUserId))) {
    return res.status(403).json({ error: 'Your role hierarchy is not high enough to ban this member.' });
  }
  const ban = platformService.banUser(server.id, targetUserId, {
    createdBy: req.user.id,
    reason: text(req.body.reason, 500) || null,
    deleteMessageSeconds: integer(req.body.deleteMessageSeconds, 0, 0, 604800),
  });
  if (!ban) return res.status(400).json({ error: 'The user is already banned or the ban could not be created.' });
  platformService.revokeRulesAcknowledgement(server.id, targetUserId);
  disconnectUserFromServerVoice(req.app.get('io'), server.id, targetUserId);
  storage.removeServerMember(server.id, targetUserId);
  req.app.get('io')?.in(`user:${targetUserId}`).socketsLeave(`server:${server.id}`);
  req.app.get('io')?.to(`user:${targetUserId}`).emit('server:banned', { serverId: server.id, reason: ban.reason });
  audit(req, server.id, 'MEMBER_BAN', 'user', targetUserId, { reason: ban.reason });
  emitUpdate(req, server.id, 'bans', 'created', ban);
  req.app.get('io')?.to(`server:${server.id}`).emit('server:members-changed', { serverId: server.id });
  return res.status(201).json(ban);
});

router.delete('/servers/:serverId/bans/:userId', (req, res) => {
  const server = getServer(req, res, { permission: 'BAN_MEMBERS' });
  if (!server) return undefined;
  if (!platformService.unbanUser(server.id, text(req.params.userId, 100))) {
    return res.status(404).json({ error: 'Ban record not found.' });
  }
  audit(req, server.id, 'MEMBER_UNBAN', 'user', req.params.userId);
  emitUpdate(req, server.id, 'bans', 'deleted', { userId: req.params.userId });
  return res.json({ success: true });
});

// Onboarding, rules screening and verification
router.get('/servers/:serverId/onboarding', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  return res.json({
    ...platformService.getOnboarding(server.id),
    memberVerification: platformService.getMemberVerification(server.id, req.user.id),
  });
});

router.put('/servers/:serverId/onboarding', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const onboarding = platformService.updateOnboarding(server.id, {
    enabled: req.body.enabled,
    prompts: Array.isArray(req.body.questions)
      ? req.body.questions.slice(0, 20)
      : (Array.isArray(req.body.prompts) ? req.body.prompts.slice(0, 20) : undefined),
    welcomeMessage: text(req.body.welcomeMessage, 2000),
    defaultChannelIds: Array.isArray(req.body.defaultChannelIds) ? req.body.defaultChannelIds.slice(0, 100) : undefined,
    updatedBy: req.user.id,
  }, req.user.id);
  const rulesScreening = platformService.updateRulesScreening(server.id, {
    enabled: req.body.rulesEnabled ?? req.body.enabled,
    requireVerifiedEmail: req.body.requireVerifiedEmail
      ?? ['email', 'high'].includes(text(req.body.verificationLevel, 30)),
    rules: Array.isArray(req.body.rules) ? req.body.rules.slice(0, 50) : undefined,
    updatedBy: req.user.id,
  }, req.user.id);
  if (req.body.verificationLevel) {
    platformService.updateServerSettings(server.id, { verificationLevel: req.body.verificationLevel });
  }
  audit(req, server.id, 'ONBOARDING_UPDATE', 'server', server.id);
  const result = { ...onboarding, rulesScreening };
  emitUpdate(req, server.id, 'onboarding', 'updated', result);
  return res.json(result);
});

router.post('/servers/:serverId/onboarding/acknowledge', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  if (req.body.accepted !== true) return res.status(400).json({ error: 'Kurallar kabul edilmelidir.' });
  const rules = platformService.getRulesScreening(server.id).rules || [];
  const verification = platformService.acknowledgeOnboarding(server.id, req.user.id, {
    acceptedRuleIds: Array.isArray(req.body.acceptedRuleIds)
      ? req.body.acceptedRuleIds
      : rules.map(rule => rule.id),
    onboardingResponses: req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {},
    emailVerified: Boolean(req.user.emailVerified),
  });
  if (!verification) return res.status(400).json({ error: 'All rules must be accepted.' });
  emitUpdate(req, server.id, 'onboarding', 'member-verified', { userId: req.user.id });
  return res.json(verification);
});

// Scheduled events
router.get('/servers/:serverId/events', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  return res.json(platformService.listEvents(server.id, {
    status: text(req.query.status, 30) || null,
    upcomingOnly: req.query.includeCompleted !== 'true',
  }));
});

router.post('/servers/:serverId/events', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_EVENTS' });
  if (!server) return undefined;
  try {
    const startsAt = Number(req.body.scheduledStartAt ?? req.body.startsAt);
    if (!Number.isFinite(startsAt) || startsAt <= Date.now()) {
      return res.status(400).json({ error: 'The event must have a valid future start date.' });
    }
    const event = platformService.createEvent(server.id, req.user.id, {
      name: text(req.body.name, 100),
      description: text(req.body.description, 2000),
      channelId: text(req.body.channelId, 100) || null,
      location: text(req.body.location, 200) || null,
      startsAt,
      endsAt: Number(req.body.scheduledEndAt ?? req.body.endsAt) || null,
      type: text(req.body.type, 20) || (req.body.channelId ? 'voice' : 'external'),
      image: text(req.body.image, 1000) || null,
    });
    if (!event) {
      return res.status(400).json({ error: 'The event details are invalid. Check the start and end times.' });
    }
    audit(req, server.id, 'EVENT_CREATE', 'event', event.id);
    emitUpdate(req, server.id, 'events', 'created', event);
    return res.status(201).json(event);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.patch('/servers/:serverId/events/:eventId', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_EVENTS' });
  if (!server) return undefined;
  const event = platformService.updateEvent(server.id, text(req.params.eventId, 100), {
    ...req.body,
    startsAt: req.body.scheduledStartAt ?? req.body.startsAt,
    endsAt: req.body.scheduledEndAt ?? req.body.endsAt,
  });
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  audit(req, server.id, 'EVENT_UPDATE', 'event', event.id);
  emitUpdate(req, server.id, 'events', 'updated', event);
  return res.json(event);
});

router.delete('/servers/:serverId/events/:eventId', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_EVENTS' });
  if (!server) return undefined;
  if (!platformService.deleteEvent(server.id, text(req.params.eventId, 100))) {
    return res.status(404).json({ error: 'Event not found.' });
  }
  audit(req, server.id, 'EVENT_DELETE', 'event', req.params.eventId);
  emitUpdate(req, server.id, 'events', 'deleted', { id: req.params.eventId });
  return res.json({ success: true });
});

router.put('/servers/:serverId/events/:eventId/rsvp', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  const event = platformService.rsvpEvent(
    server.id,
    text(req.params.eventId, 100),
    req.user.id,
    text(req.body.status, 20) || 'interested',
  );
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  emitUpdate(req, server.id, 'events', 'rsvp', { eventId: event.id, userId: req.user.id, status: req.body.status });
  return res.json(event);
});

// Discovery, stats, templates and backups
router.get('/servers/:serverId/discovery', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  return res.json(platformService.getDiscoverySettings(server.id));
});

router.put('/servers/:serverId/discovery', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const settings = platformService.updateDiscoverySettings(server.id, {
    enabled: req.body.enabled,
    description: text(req.body.description, 1000),
    category: text(req.body.category, 50),
    keywords: Array.isArray(req.body.tags)
      ? req.body.tags.slice(0, 10)
      : (Array.isArray(req.body.keywords) ? req.body.keywords.slice(0, 10) : []),
    language: text(req.body.language, 10) || 'tr',
    nsfw: Boolean(req.body.nsfw),
  });
  audit(req, server.id, 'DISCOVERY_UPDATE', 'server', server.id);
  emitUpdate(req, server.id, 'discovery', 'updated', settings);
  return res.json(settings);
});

router.get('/servers/:serverId/stats', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_SERVER' });
  if (!server) return undefined;
  return res.json(platformService.getServerStats(server.id));
});

router.get('/servers/:serverId/export', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  audit(req, server.id, 'SERVER_EXPORT', 'server', server.id);
  return res.json(platformService.exportServer(server.id));
});

router.get('/servers/:serverId/backups', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  return res.json(platformService.listBackups(server.id));
});

router.post('/servers/:serverId/backups', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const backup = platformService.createBackup(server.id, req.user.id, { name: text(req.body.name, 100) });
  if (!backup) return res.status(400).json({ error: 'The backup could not be created.' });
  audit(req, server.id, 'BACKUP_CREATE', 'backup', backup.id);
  return res.status(201).json(backup);
});

router.post('/servers/:serverId/backups/:backupId/restore', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const backupId = text(req.params.backupId, 100);
  const backup = platformService.getBackup(backupId);
  if (!backup || backup.serverId !== server.id) return res.status(404).json({ error: 'Backup not found.' });
  const result = platformService.restoreBackup(server.id, backupId);
  if (!result) return res.status(404).json({ error: 'Backup not found.' });
  audit(req, server.id, 'BACKUP_RESTORE', 'backup', req.params.backupId);
  emitUpdate(req, server.id, 'server', 'restored', { backupId: req.params.backupId });
  req.app.get('io')?.to(`server:${server.id}`).emit('channels:changed', { serverId: server.id });
  return res.json(result);
});

router.delete('/servers/:serverId/backups/:backupId', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const backup = platformService.getBackup(text(req.params.backupId, 100));
  if (!backup || backup.serverId !== server.id || !platformService.deleteBackup(backup.id)) {
    return res.status(404).json({ error: 'Backup not found.' });
  }
  audit(req, server.id, 'BACKUP_DELETE', 'backup', backup.id);
  return res.json({ success: true });
});

router.get('/templates', (req, res) => res.json(
  platformService.listServerTemplates({ publicOnly: true }).map(publicTemplate),
));

router.post('/servers/:serverId/templates', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const template = platformService.createServerTemplate(server.id, req.user.id, {
    name: text(req.body.name, 100),
    description: text(req.body.description, 1000),
    public: Boolean(req.body.isPublic ?? req.body.public),
  });
  if (!template) return res.status(400).json({ error: 'The template could not be created; a valid name is required.' });
  audit(req, server.id, 'TEMPLATE_CREATE', 'template', template.id);
  return res.status(201).json(template);
});

router.get('/servers/:serverId/templates', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  return res.json(platformService.listServerTemplates({ creatorId: req.user.id })
    .filter(template => template.sourceServerId === server.id));
});

router.patch('/servers/:serverId/templates/:templateId', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const current = platformService.getServerTemplate(text(req.params.templateId, 100));
  if (!current || current.sourceServerId !== server.id || current.creatorId !== req.user.id) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  const template = platformService.updateServerTemplate(current.id, {
    name: req.body.name,
    description: req.body.description,
    public: req.body.public ?? req.body.isPublic,
  });
  return res.json(template);
});

router.delete('/servers/:serverId/templates/:templateId', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const current = platformService.getServerTemplate(text(req.params.templateId, 100));
  if (!current || current.sourceServerId !== server.id || current.creatorId !== req.user.id
    || !platformService.deleteServerTemplate(current.id)) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  audit(req, server.id, 'TEMPLATE_DELETE', 'template', current.id);
  return res.json({ success: true });
});

router.post('/templates/:templateId/apply', (req, res) => {
  const name = text(req.body.name, 100);
  if (!name) return res.status(400).json({ error: 'A server name is required.' });
  const template = platformService.getServerTemplate(text(req.params.templateId, 100));
  if (!template || (!template.public && template.creatorId !== req.user.id)) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  try {
    const server = platformService.createServerFromTemplate(template.id, {
      name,
      creatorId: req.user.id,
    });
    req.app.get('io')?.in(`user:${req.user.id}`).socketsJoin(`server:${server.id}`);
    return res.status(201).json(server);
  } catch (error) {
    return serviceError(res, error);
  }
});

// Per-user notification preferences
router.get('/users/me/notification-preferences', (req, res) => (
  res.json(platformService.getNotificationPreferences(req.user.id))
));

router.put('/users/me/notification-preferences', (req, res) => (
  res.json(platformService.updateNotificationPreferences(req.user.id, req.body))
));

router.put('/users/me/notification-preferences/servers/:serverId', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  return res.json(platformService.setServerNotificationPreferences(req.user.id, server.id, req.body));
});

router.put('/users/me/notification-preferences/channels/:channelId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  return res.json(platformService.setChannelNotificationPreferences(req.user.id, access.channel.id, req.body));
});

router.delete('/users/me/notification-preferences', (req, res) => {
  platformService.resetNotificationPreferences(req.user.id);
  return res.json(platformService.getNotificationPreferences(req.user.id));
});

// Webhooks, slash commands, emojis and stickers
router.get('/servers/:serverId/webhooks', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_WEBHOOKS' });
  if (!server) return undefined;
  return res.json(platformService.listWebhooks(server.id));
});

router.post('/servers/:serverId/webhooks', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_WEBHOOKS' });
  if (!server) return undefined;
  const channelId = text(req.body.channelId, 100);
  const channel = storage.getChannelById(channelId);
  if (!channel || channel.serverId !== server.id) return res.status(400).json({ error: 'Invalid channel.' });
  const webhook = platformService.createWebhook(server.id, req.user.id, {
    name: text(req.body.name, 80),
    channelId,
    avatar: text(req.body.avatar, 1000) || null,
  });
  if (!webhook) return res.status(400).json({ error: 'The webhook could not be created.' });
  audit(req, server.id, 'WEBHOOK_CREATE', 'webhook', webhook.id, { channelId });
  emitUpdate(req, server.id, 'webhooks', 'created', { ...webhook, token: undefined });
  return res.status(201).json(withWebhookEndpoint(webhook));
});

router.patch('/servers/:serverId/webhooks/:webhookId', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_WEBHOOKS' });
  if (!server) return undefined;
  if (req.body.channelId) {
    const channel = storage.getChannelById(text(req.body.channelId, 100));
    if (!channel || channel.serverId !== server.id) return res.status(400).json({ error: 'Invalid channel.' });
  }
  const webhook = platformService.updateWebhook(server.id, text(req.params.webhookId, 100), req.body);
  if (!webhook) return res.status(404).json({ error: 'Webhook not found.' });
  audit(req, server.id, 'WEBHOOK_UPDATE', 'webhook', webhook.id);
  emitUpdate(req, server.id, 'webhooks', 'updated', webhook);
  return res.json(webhook);
});

router.post('/servers/:serverId/webhooks/:webhookId/rotate-token', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_WEBHOOKS' });
  if (!server) return undefined;
  const webhook = platformService.rotateWebhookToken(server.id, text(req.params.webhookId, 100));
  if (!webhook) return res.status(404).json({ error: 'Webhook not found.' });
  audit(req, server.id, 'WEBHOOK_TOKEN_ROTATE', 'webhook', webhook.id);
  return res.json(withWebhookEndpoint(webhook));
});

router.delete('/servers/:serverId/webhooks/:webhookId', (req, res) => {
  const server = getServer(req, res, { permission: 'MANAGE_WEBHOOKS' });
  if (!server) return undefined;
  if (!platformService.deleteWebhook(server.id, text(req.params.webhookId, 100))) {
    return res.status(404).json({ error: 'Webhook not found.' });
  }
  audit(req, server.id, 'WEBHOOK_DELETE', 'webhook', req.params.webhookId);
  emitUpdate(req, server.id, 'webhooks', 'deleted', { id: req.params.webhookId });
  return res.json({ success: true });
});

router.get('/servers/:serverId/commands', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  return res.json(platformService.listCommands(server.id));
});

router.post('/servers/:serverId/commands', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const command = platformService.createCommand(server.id, req.user.id, {
    name: text(req.body.name, 32).toLowerCase(),
    description: text(req.body.description, 100),
    response: text(req.body.response, 2000),
    requiredPermissions: Array.isArray(req.body.permissions)
      ? req.body.permissions
      : (Array.isArray(req.body.requiredPermissions) ? req.body.requiredPermissions : []),
    options: Array.isArray(req.body.options) ? req.body.options : [],
    handlerType: req.body.handlerType,
    webhookId: req.body.webhookId,
    enabled: req.body.enabled !== false,
  });
  if (!command) return res.status(400).json({ error: 'The command name is invalid or already in use.' });
  audit(req, server.id, 'COMMAND_CREATE', 'command', command.id);
  emitUpdate(req, server.id, 'commands', 'created', command);
  return res.status(201).json(command);
});

router.patch('/servers/:serverId/commands/:commandId', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  const command = platformService.updateCommand(server.id, text(req.params.commandId, 100), {
    ...req.body,
    requiredPermissions: req.body.requiredPermissions ?? req.body.permissions,
  });
  if (!command) return res.status(404).json({ error: 'Command not found.' });
  audit(req, server.id, 'COMMAND_UPDATE', 'command', command.id);
  emitUpdate(req, server.id, 'commands', 'updated', command);
  return res.json(command);
});

router.delete('/servers/:serverId/commands/:commandId', (req, res) => {
  const server = getServer(req, res, { ownerOnly: true });
  if (!server) return undefined;
  if (!platformService.deleteCommand(server.id, text(req.params.commandId, 100))) {
    return res.status(404).json({ error: 'Command not found.' });
  }
  audit(req, server.id, 'COMMAND_DELETE', 'command', req.params.commandId);
  emitUpdate(req, server.id, 'commands', 'deleted', { id: req.params.commandId });
  return res.json({ success: true });
});

router.post('/servers/:serverId/commands/:name/execute', (req, res) => {
  const server = getServer(req, res);
  if (!server) return undefined;
  const command = platformService.getCommand(server.id, text(req.params.name, 32));
  if (!command || !command.enabled) return res.status(404).json({ error: 'The command was not found or is disabled.' });
  const required = Array.isArray(command.requiredPermissions) ? command.requiredPermissions : [];
  if (required.some(permission => !storage.hasPermission(server.id, req.user.id, permission))) {
    return res.status(403).json({ error: 'You do not have permission to use this command.' });
  }
  const channelId = text(req.body.channelId, 100) || null;
  if (channelId) {
    const channel = storage.getChannelById(channelId);
    const canUseChannel = channel?.serverId === server.id
      && platformService.hasChannelPermission(channelId, req.user.id, 'VIEW_CHANNEL')
      && platformService.hasChannelPermission(channelId, req.user.id, 'SEND_MESSAGES');
    if (!canUseChannel) {
      return res.status(403).json({ error: 'You do not have permission to use commands in this channel.', code: 'MISSING_PERMISSION' });
    }
    const bypassScreening = server.creatorId === req.user.id
      || storage.hasPermission(server.id, req.user.id, 'ADMINISTRATOR');
    if (platformService.isMemberTimedOut(server.id, req.user.id)) {
      return res.status(403).json({ error: 'You cannot use commands while timed out.', code: 'TIMEOUT' });
    }
    if (!bypassScreening && !platformService.isMemberVerified(server.id, req.user.id)) {
      return res.status(403).json({ error: 'You must accept the server rules first.', code: 'RULES_NOT_ACCEPTED' });
    }
  }
  const result = {
    invocationId: `${command.id}:${Date.now()}`,
    command,
    userId: req.user.id,
    channelId,
    options: req.body.options && typeof req.body.options === 'object' ? req.body.options : {},
    createdAt: Date.now(),
  };
  if (channelId) emitToChannelViewers(req.app.get('io'), channelId, 'command:invoked', result);
  else emitToServerMembers(req.app.get('io'), server.id, 'command:invoked', result);
  return res.json(result);
});

for (const kind of ['emojis', 'stickers']) {
  const singular = kind === 'emojis' ? 'Emoji' : 'Sticker';
  router.get(`/servers/:serverId/${kind}`, (req, res) => {
    const server = getServer(req, res);
    if (!server) return undefined;
    return res.json(kind === 'emojis'
      ? platformService.listEmojis(server.id)
      : platformService.listStickers(server.id));
  });
  router.post(`/servers/:serverId/${kind}`, (req, res) => {
    const server = getServer(req, res, { permission: 'MANAGE_EMOJIS_AND_STICKERS' });
    if (!server) return undefined;
    const value = kind === 'emojis'
      ? platformService.createEmoji(server.id, req.user.id, req.body)
      : platformService.createSticker(server.id, req.user.id, req.body);
    if (!value) return res.status(400).json({ error: `${singular} could not be created.` });
    audit(req, server.id, `${singular.toUpperCase()}_CREATE`, singular.toLowerCase(), value.id);
    emitUpdate(req, server.id, kind, 'created', value);
    return res.status(201).json(value);
  });
  router.patch(`/servers/:serverId/${kind}/:assetId`, (req, res) => {
    const server = getServer(req, res, { permission: 'MANAGE_EMOJIS_AND_STICKERS' });
    if (!server) return undefined;
    const value = kind === 'emojis'
      ? platformService.updateEmoji(server.id, text(req.params.assetId, 100), req.body)
      : platformService.updateSticker(server.id, text(req.params.assetId, 100), req.body);
    if (!value) return res.status(404).json({ error: `${singular} not found.` });
    audit(req, server.id, `${singular.toUpperCase()}_UPDATE`, singular.toLowerCase(), value.id);
    emitUpdate(req, server.id, kind, 'updated', value);
    return res.json(value);
  });
  router.delete(`/servers/:serverId/${kind}/:assetId`, (req, res) => {
    const server = getServer(req, res, { permission: 'MANAGE_EMOJIS_AND_STICKERS' });
    if (!server) return undefined;
    const removed = kind === 'emojis'
      ? platformService.deleteEmoji(server.id, text(req.params.assetId, 100))
      : platformService.deleteSticker(server.id, text(req.params.assetId, 100));
    if (!removed) return res.status(404).json({ error: `${singular} not found.` });
    audit(req, server.id, `${singular.toUpperCase()}_DELETE`, singular.toLowerCase(), req.params.assetId);
    emitUpdate(req, server.id, kind, 'deleted', { id: req.params.assetId });
    return res.json({ success: true });
  });
}

// Channel metadata and permission overrides
router.get('/channels/:channelId/messages/:messageId/edit-history', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const message = storage.getChannelMessages(access.channel.id)
    .find(item => item.id === text(req.params.messageId, 100));
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  const canView = message.userId === req.user.id
    || platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  if (!canView) return res.status(403).json({ error: 'You do not have permission to view message edit history.' });
  return res.json({
    messageId: message.id,
    currentContent: message.content,
    editedAt: message.editedAt || null,
    history: Array.isArray(message.editHistory) ? message.editHistory : [],
  });
});

router.patch('/channels/:channelId/metadata', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  if (req.body.type !== undefined && !CHANNEL_TYPES.has(req.body.type)) {
    return res.status(400).json({ error: 'Invalid channel type.' });
  }
  if (req.body.name !== undefined) {
    const name = text(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'The channel name cannot be empty.' });
    access.channel.name = name;
  }
  if (req.body.type !== undefined) access.channel.type = req.body.type;
  if (req.body.temporary !== undefined && ['voice', 'stage'].includes(access.channel.type)) {
    access.channel.temporary = Boolean(req.body.temporary);
  }
  storage.saveData();
  const metadata = platformService.updateChannelMetadata(access.channel.id, {
    topic: req.body.topic === undefined ? undefined : text(req.body.topic, 1024),
    slowModeSeconds: req.body.slowModeSeconds ?? req.body.slowmodeSeconds,
    nsfw: req.body.nsfw,
    categoryId: req.body.categoryId,
    position: req.body.position,
    bitrate: req.body.bitrate,
    userLimit: req.body.userLimit,
    tags: req.body.tags,
  });
  const channel = { ...access.channel, ...(metadata || {}) };
  audit(req, access.server.id, 'CHANNEL_UPDATE', 'channel', channel.id);
  emitUpdate(req, access.server.id, 'channels', 'updated', channel, access.channel.id);
  req.app.get('io')?.to(`server:${access.server.id}`).emit('channels:changed', { serverId: access.server.id });
  return res.json(channel);
});

router.get('/channels/:channelId/permissions', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  return res.json({
    overrides: platformService.listChannelOverrides(access.channel.id),
    effectivePermissions: platformService.getEffectiveChannelPermissions(access.channel.id, req.user.id),
  });
});

router.put('/channels/:channelId/permissions/:targetType/:targetId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  const targetType = text(req.params.targetType, 20);
  if (!['role', 'member'].includes(targetType)) return res.status(400).json({ error: 'The target type must be role or member.' });
  const override = platformService.setChannelPermissionOverride(access.channel.id, {
    targetType,
    targetId: text(req.params.targetId, 100),
    allow: Array.isArray(req.body.allow) ? req.body.allow : [],
    deny: Array.isArray(req.body.deny) ? req.body.deny : [],
    updatedBy: req.user.id,
  });
  if (!override) return res.status(400).json({ error: 'The channel permission override could not be created.' });
  audit(req, access.server.id, 'CHANNEL_OVERRIDE_UPDATE', targetType, req.params.targetId, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'channel-permissions', 'updated', override, access.channel.id);
  emitChannelPermissionRefresh(req, access.server.id, access.channel.id);
  return res.json(override);
});

router.delete('/channels/:channelId/permissions/:targetType/:targetId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  const removed = platformService.deleteChannelOverride(
    access.channel.id,
    text(req.params.targetType, 20),
    text(req.params.targetId, 100),
  );
  if (!removed) return res.status(404).json({ error: 'Channel permission override not found.' });
  audit(req, access.server.id, 'CHANNEL_OVERRIDE_DELETE', req.params.targetType, req.params.targetId, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'channel-permissions', 'deleted', {
    targetType: req.params.targetType,
    targetId: req.params.targetId,
  }, access.channel.id);
  emitChannelPermissionRefresh(req, access.server.id, access.channel.id);
  return res.json({ success: true });
});

// Announcement channel following
router.get('/channels/:channelId/followers', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  if (access.channel.type !== 'announcement') return res.status(400).json({ error: 'This is not an announcement channel.' });
  return res.json(platformService.listAnnouncementFollows(access.channel.id));
});

router.post('/channels/:channelId/followers', (req, res) => {
  const sourceAccess = getChannel(req, res, 'VIEW_CHANNEL');
  if (!sourceAccess) return undefined;
  if (sourceAccess.channel.type !== 'announcement') return res.status(400).json({ error: 'This is not an announcement channel.' });
  const targetChannel = storage.getChannelById(text(req.body.targetChannelId, 100));
  const targetServer = targetChannel && storage.getServerById(targetChannel.serverId);
  if (!targetChannel || !targetServer || targetServer.isDM || !storage.isServerMember(targetServer.id, req.user.id)) {
    return res.status(404).json({ error: 'Target channel not found.' });
  }
  const canManageTarget = platformService.hasChannelPermission(targetChannel.id, req.user.id, 'MANAGE_CHANNELS')
    || platformService.hasChannelPermission(targetChannel.id, req.user.id, 'MANAGE_WEBHOOKS');
  if (!canManageTarget) return res.status(403).json({ error: 'You do not have permission to create an announcement follow in the target channel.' });
  const follow = platformService.createAnnouncementFollow(
    sourceAccess.channel.id,
    targetChannel.id,
    req.user.id,
  );
  if (!follow) return res.status(400).json({ error: 'The announcement follow could not be created.' });
  audit(req, sourceAccess.server.id, 'ANNOUNCEMENT_FOLLOW_CREATE', 'channel', sourceAccess.channel.id, {
    targetServerId: targetServer.id,
    targetChannelId: targetChannel.id,
  });
  emitUpdate(req, sourceAccess.server.id, 'announcement-follows', 'created', follow, sourceAccess.channel.id);
  emitUpdate(req, targetServer.id, 'announcement-follows', 'created', follow, targetChannel.id);
  return res.status(201).json(follow);
});

router.delete('/channels/:channelId/followers/:followId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  if (!platformService.deleteAnnouncementFollow(access.channel.id, text(req.params.followId, 100))) {
    return res.status(404).json({ error: 'Announcement follow not found.' });
  }
  audit(req, access.server.id, 'ANNOUNCEMENT_FOLLOW_DELETE', 'channel', access.channel.id, {
    followId: req.params.followId,
  });
  emitUpdate(req, access.server.id, 'announcement-follows', 'deleted', { id: req.params.followId }, access.channel.id);
  return res.json({ success: true });
});

// Forum tags, posts, replies and threads
router.get('/channels/:channelId/forum-tags', (req, res) => {
  const access = getChannel(req, res);
  if (!access) return undefined;
  return res.json(platformService.listForumTags(access.server.id, access.channel.id));
});

router.post('/channels/:channelId/forum-tags', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  const tag = platformService.createForumTag(access.server.id, {
    channelId: access.channel.id,
    name: text(req.body.name, 30),
    color: text(req.body.color, 7) || null,
    emoji: text(req.body.emoji, 64) || null,
    moderated: Boolean(req.body.moderated),
  });
  if (!tag) return res.status(400).json({ error: 'The forum tag could not be created.' });
  audit(req, access.server.id, 'FORUM_TAG_CREATE', 'forum-tag', tag.id, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'forum-tags', 'created', tag, access.channel.id);
  return res.status(201).json(tag);
});

router.patch('/channels/:channelId/forum-tags/:tagId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  const current = platformService.listForumTags(access.server.id, access.channel.id)
    .find(tag => tag.id === text(req.params.tagId, 100));
  if (!current) {
    return res.status(404).json({ error: 'Forum tag not found.' });
  }
  const tag = platformService.updateForumTag(access.channel.id, current.id, req.body);
  audit(req, access.server.id, 'FORUM_TAG_UPDATE', 'forum-tag', tag.id, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'forum-tags', 'updated', tag, access.channel.id);
  return res.json(tag);
});

router.delete('/channels/:channelId/forum-tags/:tagId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_CHANNELS');
  if (!access) return undefined;
  const current = platformService.listForumTags(access.server.id, access.channel.id)
    .find(tag => tag.id === text(req.params.tagId, 100));
  if (!current || !platformService.deleteForumTag(access.channel.id, current.id)) {
    return res.status(404).json({ error: 'Forum tag not found.' });
  }
  audit(req, access.server.id, 'FORUM_TAG_DELETE', 'forum-tag', current.id, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'forum-tags', 'deleted', { id: current.id }, access.channel.id);
  return res.json({ success: true });
});

router.get('/channels/:channelId/forum-posts', (req, res) => {
  const access = getChannel(req, res);
  if (!access) return undefined;
  return res.json(platformService.listForumPosts(access.server.id, {
    channelId: access.channel.id,
    tagId: text(req.query.tagId, 100) || null,
    query: text(req.query.query, 100) || null,
    archived: req.query.archived === undefined ? undefined : req.query.archived === 'true',
    limit: integer(req.query.limit, 50, 1, 100),
  }));
});

router.post('/channels/:channelId/forum-posts', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  try {
    const requestedTagIds = Array.isArray(req.body.tagIds) ? req.body.tagIds.slice(0, 5) : [];
    const moderatedTagSelected = platformService.listForumTags(access.server.id, access.channel.id)
      .some(tag => tag.moderated && requestedTagIds.includes(tag.id));
    if (moderatedTagSelected
      && !platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES')) {
      return res.status(403).json({ error: 'Only moderators can use this forum tag.' });
    }
    const post = platformService.createForumPost(access.server.id, {
      channelId: access.channel.id,
      authorId: req.user.id,
      title: text(req.body.title, 100),
      content: text(req.body.content, 10000),
      tagIds: requestedTagIds,
    });
    audit(req, access.server.id, 'FORUM_POST_CREATE', 'forum-post', post.id, { channelId: access.channel.id });
    emitUpdate(req, access.server.id, 'forum-posts', 'created', post, access.channel.id);
    return res.status(201).json(post);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.patch('/channels/:channelId/forum-posts/:postId', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  const canManage = post.authorId === req.user.id
    || platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage this forum topic.' });
  if (Array.isArray(req.body.tagIds)) {
    const requestedTagIds = req.body.tagIds.slice(0, 5);
    const moderatedTagSelected = platformService.listForumTags(access.server.id, access.channel.id)
      .some(tag => tag.moderated && requestedTagIds.includes(tag.id));
    if (moderatedTagSelected
      && !platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES')) {
      return res.status(403).json({ error: 'Only moderators can use this forum tag.' });
    }
  }
  const updated = platformService.updateForumPost(access.channel.id, post.id, req.body);
  audit(req, access.server.id, 'FORUM_POST_UPDATE', 'forum-post', post.id);
  emitUpdate(req, access.server.id, 'forum-posts', 'updated', updated, access.channel.id);
  return res.json(updated);
});

router.delete('/channels/:channelId/forum-posts/:postId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  const canManage = post.authorId === req.user.id
    || platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  if (!canManage) return res.status(403).json({ error: 'You do not have permission to delete this forum topic.' });
  platformService.deleteForumPost(access.channel.id, post.id);
  audit(req, access.server.id, 'FORUM_POST_DELETE', 'forum-post', post.id);
  emitUpdate(req, access.server.id, 'forum-posts', 'deleted', { id: post.id }, access.channel.id);
  return res.json({ success: true });
});

router.post('/channels/:channelId/forum-posts/:postId/replies', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  const content = text(req.body.content, 10000);
  if (!content) return res.status(400).json({ error: 'Reply content is required.' });
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  const reply = platformService.addForumReply(access.channel.id, post.id, {
    authorId: req.user.id,
    content,
  });
  if (!reply) return res.status(404).json({ error: 'Forum topic not found.' });
  emitUpdate(req, access.server.id, 'forum-posts', 'reply-created', {
    postId: req.params.postId,
    reply,
  }, access.channel.id);
  return res.status(201).json(reply);
});

router.get('/channels/:channelId/forum-posts/:postId/replies', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  return res.json(platformService.listForumReplies(access.channel.id, post.id));
});

router.patch('/channels/:channelId/forum-posts/:postId/replies/:replyId', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  const reply = platformService.updateForumReply(
    access.channel.id,
    post.id,
    text(req.params.replyId, 100),
    req.user.id,
    text(req.body.content, 10000),
  );
  if (!reply) return res.status(404).json({ error: 'The reply was not found or does not belong to you.' });
  emitUpdate(req, access.server.id, 'forum-posts', 'reply-updated', {
    postId: req.params.postId,
    reply,
  }, access.channel.id);
  return res.json(reply);
});

router.delete('/channels/:channelId/forum-posts/:postId/replies/:replyId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const post = platformService.getForumPost(access.channel.id, text(req.params.postId, 100));
  if (!post || post.channelId !== access.channel.id) return res.status(404).json({ error: 'Forum topic not found.' });
  const canModerate = platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  const removed = platformService.deleteForumReply(
    access.channel.id,
    post.id,
    text(req.params.replyId, 100),
    req.user.id,
    canModerate,
  );
  if (!removed) return res.status(404).json({ error: 'The reply was not found or you do not have permission to delete it.' });
  emitUpdate(req, access.server.id, 'forum-posts', 'reply-deleted', {
    postId: req.params.postId,
    replyId: req.params.replyId,
  }, access.channel.id);
  return res.json({ success: true });
});

// Regular message threads (forum posts create their own linked thread automatically).
router.get('/channels/:channelId/threads', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  return res.json(platformService.listThreads(access.server.id, {
    channelId: access.channel.id,
    archived: req.query.archived === undefined ? undefined : req.query.archived === 'true',
  }));
});

router.post('/channels/:channelId/threads', (req, res) => {
  const access = getChannel(req, res, 'CREATE_PUBLIC_THREADS');
  if (!access) return undefined;
  const thread = platformService.createThread(access.server.id, {
    channelId: access.channel.id,
    ownerId: req.user.id,
    name: text(req.body.name, 100),
    parentMessageId: text(req.body.parentMessageId, 100) || null,
    autoArchiveDuration: req.body.autoArchiveDuration,
  });
  if (!thread) return res.status(400).json({ error: 'The thread could not be created.' });
  audit(req, access.server.id, 'THREAD_CREATE', 'thread', thread.id, { channelId: access.channel.id });
  emitUpdate(req, access.server.id, 'threads', 'created', thread, access.channel.id);
  return res.status(201).json(thread);
});

router.patch('/channels/:channelId/threads/:threadId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const current = platformService.getThread(access.server.id, text(req.params.threadId, 100));
  if (!current || current.channelId !== access.channel.id) return res.status(404).json({ error: 'Thread not found.' });
  const canManage = current.ownerId === req.user.id
    || platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  if (!canManage) return res.status(403).json({ error: 'You do not have permission to manage this thread.' });
  const thread = platformService.updateThread(access.server.id, current.id, req.body);
  emitUpdate(req, access.server.id, 'threads', 'updated', thread, access.channel.id);
  return res.json(thread);
});

router.get('/channels/:channelId/threads/:threadId/messages', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const thread = platformService.getThread(access.server.id, text(req.params.threadId, 100));
  if (!thread || thread.channelId !== access.channel.id) return res.status(404).json({ error: 'Thread not found.' });
  const messages = platformService.listThreadMessages(access.server.id, thread.id);
  const limit = integer(req.query.limit, 100, 1, 200);
  const before = Number(req.query.before) || null;
  return res.json(messages
    .filter(message => !before || message.createdAt < before)
    .slice(-limit));
});

router.post('/channels/:channelId/threads/:threadId/messages', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES_IN_THREADS');
  if (!access) return undefined;
  const thread = platformService.getThread(access.server.id, text(req.params.threadId, 100));
  if (!thread || thread.channelId !== access.channel.id) return res.status(404).json({ error: 'Thread not found.' });
  const message = platformService.addThreadMessage(access.server.id, thread.id, {
    authorId: req.user.id,
    content: text(req.body.content, 10000),
    attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
  });
  if (!message) return res.status(400).json({ error: 'The thread is locked or archived, or the content is invalid.' });
  emitUpdate(req, access.server.id, 'threads', 'message-created', {
    channelId: access.channel.id,
    threadId: thread.id,
    message,
  }, access.channel.id);
  emitChannelEvent(req, access.channel.id, 'thread:message', {
    channelId: access.channel.id,
    threadId: thread.id,
    message,
  });
  return res.status(201).json(message);
});

router.delete('/channels/:channelId/threads/:threadId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const current = platformService.getThread(access.server.id, text(req.params.threadId, 100));
  if (!current || current.channelId !== access.channel.id) return res.status(404).json({ error: 'Thread not found.' });
  const canManage = current.ownerId === req.user.id
    || platformService.hasChannelPermission(access.channel.id, req.user.id, 'MANAGE_MESSAGES');
  if (!canManage) return res.status(403).json({ error: 'You do not have permission to delete this thread.' });
  platformService.deleteThread(access.server.id, current.id);
  audit(req, access.server.id, 'THREAD_DELETE', 'thread', current.id);
  emitUpdate(req, access.server.id, 'threads', 'deleted', { id: current.id }, access.channel.id);
  return res.json({ success: true });
});

// Polls
router.get('/channels/:channelId/polls', (req, res) => {
  const access = getChannel(req, res);
  if (!access) return undefined;
  return res.json(platformService.listPolls(access.server.id, { channelId: access.channel.id }, req.user.id));
});

router.get('/channels/:channelId/polls/:pollId', (req, res) => {
  const access = getChannel(req, res, 'VIEW_CHANNEL');
  if (!access) return undefined;
  const poll = platformService.getPoll(access.channel.id, text(req.params.pollId, 100), req.user.id);
  if (!poll || poll.channelId !== access.channel.id) return res.status(404).json({ error: 'Poll not found.' });
  return res.json(poll);
});

router.post('/channels/:channelId/polls', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  try {
    const poll = platformService.createPoll(access.server.id, {
      channelId: access.channel.id,
      creatorId: req.user.id,
      question: text(req.body.question, 300),
      options: Array.isArray(req.body.options) ? req.body.options.slice(0, 10) : [],
      allowMultiple: Boolean(req.body.allowMultiple),
      expiresAt: Number(req.body.expiresAt) || null,
    });
    audit(req, access.server.id, 'POLL_CREATE', 'poll', poll.id, { channelId: access.channel.id });
    emitUpdate(req, access.server.id, 'polls', 'created', poll, access.channel.id);
    return res.status(201).json(poll);
  } catch (error) {
    return serviceError(res, error);
  }
});

router.put('/channels/:channelId/polls/:pollId/votes', (req, res) => {
  const access = getChannel(req, res, 'SEND_MESSAGES');
  if (!access) return undefined;
  const current = platformService.getPoll(access.channel.id, text(req.params.pollId, 100), req.user.id);
  if (!current || current.channelId !== access.channel.id) return res.status(404).json({ error: 'Poll not found.' });
  const poll = platformService.votePoll(
    access.channel.id,
    current.id,
    req.user.id,
    Array.isArray(req.body.optionIds) ? req.body.optionIds.slice(0, 10) : [],
  );
  if (!poll) return res.status(404).json({ error: 'Poll not found.' });
  emitUpdate(req, access.server.id, 'polls', 'voted', poll, access.channel.id);
  return res.json(poll);
});

router.post('/channels/:channelId/polls/:pollId/close', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_MESSAGES');
  if (!access) return undefined;
  const current = platformService.getPoll(access.channel.id, text(req.params.pollId, 100), req.user.id);
  if (!current || current.channelId !== access.channel.id) return res.status(404).json({ error: 'Poll not found.' });
  const poll = platformService.closePoll(access.channel.id, current.id, req.user.id);
  audit(req, access.server.id, 'POLL_CLOSE', 'poll', poll.id);
  emitUpdate(req, access.server.id, 'polls', 'closed', poll, access.channel.id);
  return res.json(poll);
});

router.delete('/channels/:channelId/polls/:pollId', (req, res) => {
  const access = getChannel(req, res, 'MANAGE_MESSAGES');
  if (!access) return undefined;
  const current = platformService.getPoll(access.channel.id, text(req.params.pollId, 100), req.user.id);
  if (!current || current.channelId !== access.channel.id || !platformService.deletePoll(access.channel.id, current.id)) {
    return res.status(404).json({ error: 'Poll not found.' });
  }
  audit(req, access.server.id, 'POLL_DELETE', 'poll', current.id);
  emitUpdate(req, access.server.id, 'polls', 'deleted', { id: current.id }, access.channel.id);
  return res.json({ success: true });
});

module.exports = router;
