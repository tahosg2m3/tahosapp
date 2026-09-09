const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { platformService } = require('../services/platformService');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { emitAudit } = require('../sockets/authorizedEmit');
const { requireServerMember, requireServerOwner } = require('../middleware/authorization');
const { disconnectUserFromServerVoice } = require('../sockets/handlers/voiceHandler');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'roles'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'roles'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'roles'));

const MODERATION_ACTIONS = {
  kick: { permission: 'KICK_MEMBERS' },
  mute: { permission: 'MUTE_MEMBERS', changes: { serverMuted: true } },
  unmute: { permission: 'MUTE_MEMBERS', changes: { serverMuted: false } },
  deafen: { permission: 'DEAFEN_MEMBERS', changes: { serverDeafened: true } },
  undeafen: { permission: 'DEAFEN_MEMBERS', changes: { serverDeafened: false } },
  disconnect: { permission: 'MOVE_MEMBERS' },
  timeout: { permission: 'MODERATE_MEMBERS', timeout: true },
  untimeout: { permission: 'MODERATE_MEMBERS', changes: { timeoutUntil: null } },
};

function emitRolesChanged(req, serverId) {
  req.app.get('io')?.to(`server:${serverId}`).emit('roles:changed', {
    serverId,
    roles: storage.getServerRoles(serverId),
  });
}

function emitMemberUpdated(req, serverId, userId) {
  const member = storage.getServerMemberDetails(serverId, userId);
  req.app.get('io')?.to(`server:${serverId}`).emit('server:member-updated', { serverId, member });
  req.app.get('io')?.to(`server:${serverId}`).emit('server:members-changed', { serverId });
  return member;
}

function writeAudit(req, serverId, action, targetType, targetId, metadata = {}) {
  const entry = platformService.addAuditLog(serverId, {
    action,
    actorId: req.user.id,
    actorUsername: req.user.username,
    targetType,
    targetId,
    metadata,
  });
  emitAudit(req.app.get('io'), serverId, entry);
}

router.get('/:serverId/roles', authRateLimit, requireAuth, readRateLimit, requireServerMember, (req, res) => {
  const serverId = req.params.serverId;
  return res.json({
    roles: storage.getServerRoles(serverId),
    permissions: storage.getAllPermissions(),
    currentUserPermissions: storage.getMemberPermissions(serverId, req.user.id),
    isOwner: req.server.creatorId === req.user.id,
  });
});

router.post('/:serverId/roles', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'The role name must be 1–100 characters.' });

  const role = storage.createServerRole(req.params.serverId, {
    name,
    color: req.body.color,
    icon: req.body.icon,
    hoist: req.body.hoist,
    mentionable: req.body.mentionable,
    permissions: req.body.permissions,
  });
  if (!role) return res.status(400).json({ error: 'The role could not be created.' });

  emitRolesChanged(req, req.params.serverId);
  writeAudit(req, req.params.serverId, 'ROLE_CREATE', 'role', role.id, { name: role.name });
  return res.status(201).json({ role });
});

router.patch('/:serverId/roles/reorder', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const roles = storage.reorderServerRoles(req.params.serverId, req.body.roleIds);
  if (!roles) return res.status(400).json({ error: 'The role order is invalid.' });
  emitRolesChanged(req, req.params.serverId);
  return res.json({ roles });
});

router.put('/:serverId/roles/reorder', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const roles = storage.reorderServerRoles(req.params.serverId, req.body.roleIds);
  if (!roles) return res.status(400).json({ error: 'The role order is invalid.' });
  emitRolesChanged(req, req.params.serverId);
  return res.json({ roles });
});

router.patch('/:serverId/roles/:roleId', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  const serverId = req.params.serverId;
  const role = storage.getServerRole(serverId, req.params.roleId);
  if (!role) return res.status(404).json({ error: 'Role not found.' });

  if (role.isDefault) {
    const allowedKeys = new Set(['permissions']);
    if (Object.keys(req.body).some(key => !allowedKeys.has(key))) {
      return res.status(400).json({ error: 'Only permissions can be changed on the @everyone role.' });
    }
  }

  if (req.body.position !== undefined && !role.isDefault) {
    const currentIds = storage.getServerRoles(serverId)
      .filter(item => !item.isDefault)
      .sort((first, second) => first.position - second.position)
      .map(item => item.id);
    const currentIndex = currentIds.indexOf(role.id);
    const requestedIndex = Math.max(0, Math.min(currentIds.length - 1, Number(req.body.position) - 1));
    if (!Number.isInteger(requestedIndex)) return res.status(400).json({ error: 'The role position is invalid.' });
    currentIds.splice(currentIndex, 1);
    currentIds.splice(requestedIndex, 0, role.id);
    storage.reorderServerRoles(serverId, currentIds);
  }

  const updated = storage.updateServerRole(serverId, req.params.roleId, {
    name: req.body.name,
    color: req.body.color,
    icon: req.body.icon,
    hoist: req.body.hoist,
    mentionable: req.body.mentionable,
    permissions: req.body.permissions,
  });
  if (!updated) return res.status(400).json({ error: 'The role could not be updated.' });

  emitRolesChanged(req, serverId);
  writeAudit(req, serverId, 'ROLE_UPDATE', 'role', updated.id, { name: updated.name });
  req.app.get('io')?.to(`server:${serverId}`).emit('server:members-changed', { serverId });
  return res.json({ role: updated });
});

router.delete('/:serverId/roles/:roleId', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  if (!storage.deleteServerRole(req.params.serverId, req.params.roleId)) {
    return res.status(400).json({ error: 'The @everyone role cannot be deleted, or the role was not found.' });
  }
  emitRolesChanged(req, req.params.serverId);
  writeAudit(req, req.params.serverId, 'ROLE_DELETE', 'role', req.params.roleId);
  req.app.get('io')?.to(`server:${req.params.serverId}`).emit('server:members-changed', { serverId: req.params.serverId });
  return res.json({ success: true });
});

router.get('/:serverId/members/:userId/permissions', authRateLimit, requireAuth, readRateLimit, requireServerMember, (req, res) => {
  const member = storage.getServerMemberDetails(req.params.serverId, req.params.userId);
  if (!member) return res.status(404).json({ error: 'Member not found.' });
  return res.json({
    userId: req.params.userId,
    roleIds: member.roleIds,
    permissions: member.permissions,
    isOwner: member.isOwner,
  });
});

router.patch('/:serverId/members/:userId/roles', authRateLimit, requireAuth, mutationRateLimit, requireServerOwner, (req, res) => {
  if (!storage.isServerMember(req.params.serverId, req.params.userId)) {
    return res.status(404).json({ error: 'Member not found.' });
  }
  if (!Array.isArray(req.body.roleIds)) return res.status(400).json({ error: 'roleIds must be an array.' });

  const member = storage.setMemberRoles(req.params.serverId, req.params.userId, req.body.roleIds);
  if (!member) return res.status(400).json({ error: 'Role assignments are invalid.' });
  emitMemberUpdated(req, req.params.serverId, req.params.userId);
  writeAudit(req, req.params.serverId, 'MEMBER_ROLES_UPDATE', 'user', req.params.userId, { roleIds: req.body.roleIds });
  return res.json({ member });
});

router.post('/:serverId/members/:userId/moderate', authRateLimit, requireAuth, mutationRateLimit, requireServerMember, (req, res) => {
  const serverId = req.params.serverId;
  const targetUserId = req.params.userId;
  const action = String(req.body.action || '').toLowerCase();
  const definition = MODERATION_ACTIONS[action];

  if (!definition) return res.status(400).json({ error: 'Invalid moderation action.' });
  if (!storage.isServerMember(serverId, targetUserId)) return res.status(404).json({ error: 'Member not found.' });
  if (!storage.canModerateMember(serverId, req.user.id, targetUserId, definition.permission)) {
    return res.status(403).json({ error: 'You do not have sufficient permission or role hierarchy to manage this member.' });
  }

  const io = req.app.get('io');
  const reason = String(req.body.reason || '').trim().slice(0, 500) || null;

  if (action === 'kick') {
    disconnectUserFromServerVoice(io, serverId, targetUserId);
    storage.removeServerMember(serverId, targetUserId);
    platformService.revokeRulesAcknowledgement(serverId, targetUserId);
    io?.in(`user:${targetUserId}`).socketsLeave(`server:${serverId}`);
    io?.to(`user:${targetUserId}`).emit('server:kicked', {
      serverId,
      byUsername: req.user.username,
      reason,
    });
    io?.to(`user:${targetUserId}`).emit('voice:moderated', {
      action: 'disconnect',
      serverId,
      byUsername: req.user.username,
    });
    io?.to(`server:${serverId}`).emit('server:member-kicked', { serverId, userId: targetUserId });
    io?.to(`server:${serverId}`).emit('server:members-changed', { serverId });
    platformService.recordServerStat(serverId, 'membersLeft');
    writeAudit(req, serverId, 'MEMBER_KICK', 'user', targetUserId, { reason });
    return res.json({ success: true, action });
  }

  if (definition.changes || definition.timeout) {
    let changes = definition.changes;
    if (definition.timeout) {
      const durationMinutes = Number(req.body.durationMinutes);
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
        return res.status(400).json({ error: 'The mute duration must be between 1 and 10080 minutes.' });
      }
      changes = { timeoutUntil: Date.now() + (durationMinutes * 60 * 1000) };
    }

    const state = storage.setMemberModerationState(serverId, targetUserId, changes, req.user.id);
    const member = emitMemberUpdated(req, serverId, targetUserId);
    if (action === 'timeout') {
      disconnectUserFromServerVoice(io, serverId, targetUserId);
      io?.to(`user:${targetUserId}`).emit('voice:moderated', {
        action: 'disconnect',
        serverId,
        byUsername: req.user.username,
        reason,
        state,
      });
    }
    io?.to(`user:${targetUserId}`).emit('server:moderated', {
      action,
      serverId,
      byUsername: req.user.username,
      reason,
      state,
    });
    if (!definition.timeout && action !== 'untimeout') {
      io?.to(`user:${targetUserId}`).emit('voice:moderated', {
        action,
        serverId,
        byUsername: req.user.username,
        reason,
        state,
      });
    }
    writeAudit(req, serverId, `MEMBER_${action.toUpperCase()}`, 'user', targetUserId, { reason, state });
    return res.json({ success: true, action, member });
  }

  // "disconnect" aktif ses kanalından çıkarmak has istemciye hedefli olay gönderir.
  disconnectUserFromServerVoice(io, serverId, targetUserId);
  io?.to(`user:${targetUserId}`).emit('voice:moderated', {
    action: 'disconnect',
    serverId,
    byUsername: req.user.username,
    reason,
  });
  writeAudit(req, serverId, 'MEMBER_DISCONNECT', 'user', targetUserId, { reason });
  return res.json({ success: true, action });
});

module.exports = router;
