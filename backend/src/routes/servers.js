const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { platformService } = require('../services/platformService');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { requireServerMember, requireServerOwner } = require('../middleware/authorization');
const { emitAudit, emitToServerMembers, getChannelViewerSockets } = require('../sockets/authorizedEmit');
const { richPresenceService } = require('../services/richPresenceService');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'servers'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'servers'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'servers'));

function notifyMembersChanged(req, serverId) {
  req.app.get('io')?.to(`server:${serverId}`).emit('server:members-changed', { serverId });
}

function getTrashServer(req, res) {
  const server = storage.getServerById(req.params.id);
  if (!server || server.isDM) {
    res.status(404).json({ error: 'Sunucu bulunamadı.' });
    return null;
  }
  const allowed = storage.isServerMember(server.id, req.user.id)
    && (server.creatorId === req.user.id
      || storage.hasPermission(server.id, req.user.id, 'ADMINISTRATOR')
      || storage.hasPermission(server.id, req.user.id, 'MANAGE_CHANNELS'));
  if (!allowed) {
    res.status(403).json({ error: 'Kanal çöp kutusunu yönetme yetkin yok.' });
    return null;
  }
  return server;
}

function normalizeInviteCode(value) {
  const raw = String(value || '').trim().slice(0, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const queryCode = url.searchParams.get('invite');
    if (queryCode) return queryCode.trim().slice(0, 128);
    const pathMatch = url.pathname.match(/\/(?:invite|davet)\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim().slice(0, 128);
  } catch {
    // Plain invite codes are supported for backwards compatibility.
  }
  return raw.slice(0, 128);
}

// Sadece giriş yapan kullanıcının gerçekten üye olduğu normal sunucular gösterilir.
router.get('/', authRateLimit, requireAuth, readRateLimit, (req, res) => {
  const servers = storage.getAllServers().filter(server => (
    !server.isDM && storage.isServerMember(server.id, req.user.id)
  ));
  return res.json(servers);
});

router.post('/join', authRateLimit, requireAuth, mutationRateLimit, (req, res) => {
  const inviteCode = normalizeInviteCode(req.body.inviteCode);
  const managedInvite = platformService.getInviteByCode(inviteCode);
  const server = managedInvite
    ? storage.getServerById(managedInvite.serverId)
    : storage.getServerByInviteCode(inviteCode);
  if (!server || server.isDM) return res.status(404).json({ error: 'Geçersiz davet kodu.' });

  if (platformService.isBanned(server.id, req.user.id)) {
    return res.status(403).json({ error: 'Bu sunucudan yasaklandın.' });
  }

  if (storage.isServerMember(server.id, req.user.id)) {
    return res.json(server);
  }

  if (managedInvite && !platformService.consumeInvite(inviteCode, req.user.id)) {
    return res.status(410).json({ error: 'Bu davetin süresi dolmuş veya kullanım sınırına ulaşmış.' });
  }

  storage.addServerMember(server.id, req.user.id);
  platformService.recordServerStat(server.id, 'membersJoined');
  const joinEntry = platformService.addAuditLog(server.id, {
    action: 'MEMBER_JOIN',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'user',
    targetId: req.user.id,
    metadata: { inviteCode: managedInvite?.code || inviteCode },
  });
  // Kullanıcının açık tüm sekmelerini anında sunucunun Socket.IO odasına al.
  req.app.get('io')?.in(`user:${req.user.id}`).socketsJoin(`server:${server.id}`);
  notifyMembersChanged(req, server.id);
  emitAudit(req.app.get('io'), server.id, joinEntry);
  return res.json(server);
});

router.post('/', authRateLimit, requireAuth, mutationRateLimit, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'Geçerli bir sunucu adı gerekli.' });

  const server = storage.createServer(name, req.user.id);
  platformService.getServerSettings(server.id);
  platformService.addAuditLog(server.id, {
    action: 'SERVER_CREATE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'server',
    targetId: server.id,
  });
  req.app.get('io')?.in(`user:${req.user.id}`).socketsJoin(`server:${server.id}`);
  return res.status(201).json(server);
});

router.post('/:id/transfer-ownership', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const newOwnerId = String(req.body.userId || '').trim();
  if (!newOwnerId || !storage.isServerMember(req.params.id, newOwnerId)) {
    return res.status(400).json({ error: 'Yeni sahip sunucunun bir üyesi olmalıdır.' });
  }

  const previousOwnerId = req.user.id;
  const updated = storage.transferServerOwnership(req.params.id, newOwnerId);
  const entry = platformService.addAuditLog(req.params.id, {
    action: 'SERVER_OWNERSHIP_TRANSFER',
    actorId: previousOwnerId,
    actorUsername: req.user.username,
    targetType: 'user',
    targetId: newOwnerId,
    metadata: { previousOwnerId },
  });
  notifyMembersChanged(req, req.params.id);
  req.app.get('io')?.to(`server:${req.params.id}`).emit('server:updated', { server: updated });
  emitAudit(req.app.get('io'), req.params.id, entry);
  return res.json(updated);
});

router.get('/:serverId/members/me/profile', authRateLimit, requireAuth, readRateLimit, requireServerMember, (req, res) => (
  res.json({ profile: storage.getServerMemberProfile(req.params.serverId, req.user.id) })
));

router.patch('/:serverId/members/me/profile', authRateLimit, requireAuth, mutationRateLimit, requireServerMember, (req, res) => {
  const updates = {};
  ['nickname', 'serverAvatar', 'serverBanner', 'serverBio'].forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
  });

  try {
    const profile = storage.updateServerMemberProfile(req.params.serverId, req.user.id, updates);
    if (!profile) return res.status(404).json({ error: 'Sunucu üyeliği bulunamadı.' });
    const member = storage.getServerMemberDetails(req.params.serverId, req.user.id);
    notifyMembersChanged(req, req.params.serverId);
    req.app.get('io')?.to(`server:${req.params.serverId}`).emit('server:member-profile-updated', {
      serverId: req.params.serverId,
      userId: req.user.id,
      profile,
      member,
    });
    return res.json({ profile, member });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Sunucu profili güncellenemedi.' });
  }
});

router.get('/:id/members', authRateLimit, requireAuth, readRateLimit, requireServerMember, (req, res) => (
  res.json(storage.getServerMembersWithDetails(req.params.id).map(member => ({
    ...member,
    activities: richPresenceService.getActivities(member.id),
  })))
));

router.get('/:id', authRateLimit, requireAuth, readRateLimit, requireServerMember, (req, res) => res.json(req.server));

router.patch('/:id', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
  if (name !== undefined && (!name || name.length > 100)) {
    return res.status(400).json({ error: 'Geçerli bir sunucu adı gerekli.' });
  }

  const updated = storage.updateServer(req.params.id, {
    name,
    icon: req.body.icon,
    description: req.body.description,
    banner: req.body.banner,
    discoveryEnabled: req.body.discoveryEnabled,
    vanityCode: req.body.vanityCode,
    defaultNotificationMode: req.body.defaultNotificationMode,
  });
  if (!updated) return res.status(400).json({ error: 'Vanity kodu geçersiz veya başka bir sunucu tarafından kullanılıyor.' });
  if (req.body.discoveryEnabled !== undefined || req.body.description !== undefined || req.body.banner !== undefined) {
    platformService.updateDiscoverySettings(req.params.id, {
      enabled: req.body.discoveryEnabled,
      description: req.body.description,
      banner: req.body.banner,
    });
  }
  if (req.body.defaultNotificationMode !== undefined) {
    platformService.updateServerSettings(req.params.id, { defaultNotifications: req.body.defaultNotificationMode });
  }
  const entry = platformService.addAuditLog(req.params.id, {
    action: 'SERVER_UPDATE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'server',
    targetId: req.params.id,
  });
  req.app.get('io')?.to(`server:${req.params.id}`).emit('server:updated', { server: updated });
  emitAudit(req.app.get('io'), req.params.id, entry);
  return res.json(updated);
});

router.put('/:id', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const name = req.body.name === undefined ? undefined : String(req.body.name).trim();
  if (name !== undefined && (!name || name.length > 100)) {
    return res.status(400).json({ error: 'Geçerli bir sunucu adı gerekli.' });
  }
  const updated = storage.updateServer(req.params.id, {
    name,
    icon: req.body.icon,
    description: req.body.description,
    banner: req.body.banner,
    discoveryEnabled: req.body.discoveryEnabled,
    vanityCode: req.body.vanityCode,
    defaultNotificationMode: req.body.defaultNotificationMode,
  });
  if (!updated) return res.status(400).json({ error: 'Vanity kodu geçersiz veya başka bir sunucu tarafından kullanılıyor.' });
  platformService.updateDiscoverySettings(req.params.id, {
    enabled: req.body.discoveryEnabled,
    description: req.body.description,
    banner: req.body.banner,
  });
  platformService.updateServerSettings(req.params.id, { defaultNotifications: req.body.defaultNotificationMode });
  const entry = platformService.addAuditLog(req.params.id, {
    action: 'SERVER_UPDATE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'server',
    targetId: req.params.id,
  });
  req.app.get('io')?.to(`server:${req.params.id}`).emit('server:updated', { server: updated });
  emitAudit(req.app.get('io'), req.params.id, entry);
  return res.json(updated);
});

router.post('/:id/leave', authRateLimit, requireAuth, mutationRateLimit, requireServerMember, (req, res) => {
  if (req.server.creatorId === req.user.id) {
    return res.status(400).json({ error: 'Sunucu sahibi sunucudan ayrılamaz. Önce sahipliği devret.' });
  }

  storage.removeServerMember(req.params.id, req.user.id);
  platformService.revokeRulesAcknowledgement(req.params.id, req.user.id);
  platformService.recordServerStat(req.params.id, 'membersLeft');
  const leaveEntry = platformService.addAuditLog(req.params.id, {
    action: 'MEMBER_LEAVE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'user',
    targetId: req.user.id,
  });
  req.app.get('io')?.in(`user:${req.user.id}`).socketsLeave(`server:${req.params.id}`);
  notifyMembersChanged(req, req.params.id);
  emitAudit(req.app.get('io'), req.params.id, leaveEntry);
  return res.json({ success: true });
});

router.get('/:id/trash', authRateLimit, requireAuth, readRateLimit, (req, res) => {
  const server = getTrashServer(req, res);
  if (!server) return undefined;
  return res.json(platformService.listTrash(server.id));
});

router.post('/:id/trash/:trashId/restore', authRateLimit, requireAuth, mutationRateLimit, (req, res) => {
  const server = getTrashServer(req, res);
  if (!server) return undefined;
  const result = platformService.restoreTrash(server.id, req.params.trashId);
  if (!result) return res.status(404).json({ error: 'Çöp kutusu kaydı bulunamadı veya süresi dolmuş.' });
  const entry = platformService.addAuditLog(server.id, {
    action: 'CHANNEL_RESTORE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'channel',
    targetId: result.channel.id,
    metadata: { trashId: result.trashId, name: result.channel.name },
  });
  emitAudit(req.app.get('io'), server.id, entry);
  getChannelViewerSockets(req.app.get('io'), result.channel.id)
    .forEach(targetSocket => targetSocket.emit('channels:changed', { serverId: server.id }));
  emitToServerMembers(req.app.get('io'), server.id, 'platform:update', {
    serverId: server.id,
    scope: 'trash',
    action: 'restored',
    data: { trashId: result.trashId, channelId: result.channel.id },
    timestamp: Date.now(),
  }, 'MANAGE_CHANNELS');
  return res.json(result);
});

router.delete('/:id/trash/:trashId', authRateLimit, requireAuth, mutationRateLimit, (req, res) => {
  const server = getTrashServer(req, res);
  if (!server) return undefined;
  if (!platformService.purgeTrash(server.id, req.params.trashId)) {
    return res.status(404).json({ error: 'Çöp kutusu kaydı bulunamadı.' });
  }
  const entry = platformService.addAuditLog(server.id, {
    action: 'TRASH_PURGE',
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType: 'trash',
    targetId: req.params.trashId,
  });
  emitAudit(req.app.get('io'), server.id, entry);
  emitToServerMembers(req.app.get('io'), server.id, 'platform:update', {
    serverId: server.id,
    scope: 'trash',
    action: 'purged',
    data: { trashId: req.params.trashId },
    timestamp: Date.now(),
  }, 'MANAGE_CHANNELS');
  return res.json({ success: true });
});

router.delete('/:id', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const serverId = req.params.id;
  platformService.deleteServerData(serverId);
  if (!storage.deleteServer(serverId)) return res.status(404).json({ error: 'Sunucu bulunamadı.' });

  req.app.get('io')?.to(`server:${serverId}`).emit('server:deleted', { serverId });
  return res.json({ message: 'Sunucu silindi.' });
});

module.exports = router;
