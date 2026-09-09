const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { messageService } = require('../services/messageService');
const { platformService } = require('../services/platformService');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { emitAudit, getChannelViewerSockets } = require('../sockets/authorizedEmit');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'channels'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'channels'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'channels'));

function writeChannelAudit(req, serverId, action, channel, metadata = {}) {
  const entry = platformService.addAuditLog(serverId, {
    action,
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'channel',
    targetId: channel.id,
    metadata: { name: channel.name, type: channel.type, ...metadata },
  });
  emitAudit(req.app.get('io'), serverId, entry);
}

function canAccessServer(serverId, userId, permission = 'VIEW_CHANNEL') {
  const server = storage.getServerById(serverId);
  if (!server) return { allowed: false, server: null };
  if (server.isDM) return { allowed: server.dmUserIds?.includes(userId), server };
  return {
    allowed: storage.isServerMember(serverId, userId) && storage.hasPermission(serverId, userId, permission),
    server,
  };
}

function hasChannelPermission(channel, userId, permission) {
  if (!channel) return false;
  return typeof platformService.hasChannelPermission === 'function'
    ? platformService.hasChannelPermission(channel.id, userId, permission)
    : storage.hasPermission(channel.serverId, userId, permission);
}

function getChannelAccess(channelId, userId, permission = 'VIEW_CHANNEL') {
  const channel = storage.getChannelById(channelId);
  if (!channel) return { allowed: false, channel: null, server: null };
  const server = storage.getServerById(channel.serverId);
  if (!server) return { allowed: false, channel, server: null };
  if (server.isDM) return { channel, server, allowed: server.dmUserIds?.includes(userId) };
  return {
    channel,
    server,
    allowed: storage.isServerMember(server.id, userId) && hasChannelPermission(channel, userId, permission),
  };
}

router.use(authRateLimit, requireAuth, readRateLimit, mutationRateLimit);

router.get('/', (req, res) => {
  const serverId = String(req.query.serverId || '');
  if (!serverId) return res.status(400).json({ error: 'serverId is required.' });

  const access = canAccessServer(serverId, req.user.id, 'VIEW_CHANNEL');
  // Kanal override'ı VIEW_CHANNEL iznini belirli bir kanalda tekrar verebilir.
  // Bu nedenle kanal listesi seviyesinde yalnızca memberliği zorunlu tutuyoruz;
  // görünür kanallar aşağıdaki filtrede tek tek hesaplanır.
  if (access.server && !access.server.isDM && storage.isServerMember(serverId, req.user.id)) {
    access.allowed = true;
  }
  if (!access.server) return res.status(404).json({ error: 'Server not found.' });
  if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this server.' });
  const channels = storage.getChannelsByServerId(serverId)
    .filter(channel => access.server.isDM || hasChannelPermission(channel, req.user.id, 'VIEW_CHANNEL'))
    .map(channel => ({
      ...channel,
      ...(platformService.getChannelMetadata(channel.id) || {}),
    }));
  return res.json(channels);
});

router.get('/:id/messages', (req, res) => {
  const access = getChannelAccess(req.params.id, req.user.id, 'VIEW_CHANNEL');
  if (!access.channel) return res.status(404).json({ error: 'Channel not found.' });
  if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this channel.' });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  return res.json(messageService.getChannelMessages(req.params.id, limit, req.query.before));
});

router.get('/:id', (req, res) => {
  const access = getChannelAccess(req.params.id, req.user.id, 'VIEW_CHANNEL');
  if (!access.channel) return res.status(404).json({ error: 'Channel not found.' });
  if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this channel.' });
  return res.json({
    ...access.channel,
    ...(platformService.getChannelMetadata(access.channel.id) || {}),
  });
});

router.post('/', (req, res) => {
  const serverId = String(req.body.serverId || '');
  const name = String(req.body.name || '').trim();
  const allowedTypes = new Set(['text', 'voice', 'category', 'announcement', 'forum', 'stage', 'media']);
  const type = allowedTypes.has(req.body.type) ? req.body.type : 'text';
  if (!serverId || !name || name.length > 100) return res.status(400).json({ error: 'Valid channel details are required.' });

  const access = canAccessServer(serverId, req.user.id, 'MANAGE_CHANNELS');
  if (!access.server) return res.status(404).json({ error: 'Server not found.' });
  if (access.server.isDM || !access.allowed) return res.status(403).json({ error: 'You do not have permission to create channels.' });

  const channel = storage.createChannel(serverId, name, type);
  if (['voice', 'stage'].includes(type)) channel.temporary = Boolean(req.body.temporary);
  platformService.updateChannelMetadata(channel.id, {
    topic: req.body.topic,
    nsfw: req.body.nsfw,
    slowModeSeconds: req.body.slowModeSeconds ?? req.body.slowmodeSeconds,
    categoryId: req.body.categoryId,
    position: req.body.position,
    bitrate: req.body.bitrate,
    userLimit: req.body.userLimit,
    announcement: type === 'announcement',
  });
  storage.saveData();
  writeChannelAudit(req, serverId, 'CHANNEL_CREATE', channel);
  req.app.get('io')?.to(`server:${serverId}`).emit('channels:changed', { serverId });
  return res.status(201).json({
    ...channel,
    ...(platformService.getChannelMetadata(channel.id) || {}),
  });
});

router.delete('/:id', (req, res) => {
  const access = getChannelAccess(req.params.id, req.user.id, 'MANAGE_CHANNELS');
  if (!access.channel) return res.status(404).json({ error: 'Channel not found.' });
  if (access.server.isDM || !access.allowed) return res.status(403).json({ error: 'You do not have permission to delete channels.' });

  const serverId = access.channel.serverId;
  const viewers = getChannelViewerSockets(req.app.get('io'), access.channel.id);
  const trash = platformService.trashChannel(req.params.id, req.user.id);
  if (!trash) return res.status(500).json({ error: 'The channel could not be moved safely to the trash.' });
  writeChannelAudit(req, serverId, 'CHANNEL_DELETE', access.channel, { trashId: trash.id, expiresAt: trash.expiresAt });
  platformService.deleteChannelData?.(req.params.id);
  storage.deleteChannel(req.params.id);
  viewers.forEach(targetSocket => targetSocket.emit('channels:changed', { serverId }));
  return res.json({ message: 'Channel deleted and moved to the trash for 7 days.', trash });
});

module.exports = router;
