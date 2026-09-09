const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { richPresenceService } = require('../services/richPresenceService');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'users'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'users'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'users'));

function privateUser(user) {
  if (!user) return null;
  const { password, tokenVersion, platformRole, platformBan, platformBanClearedAt, platformBanClearedBy, ...safeUser } = user;
  return { ...safeUser, status: storage.getUserStatus(user.id) };
}

function emitProfileUpdate(req, user) {
  const io = req.app.get('io');
  if (!io || !user) return;
  const publicProfile = storage.getPublicUserById(user.id);
  storage.getAllServers()
    .filter(server => !server.isDM && storage.isServerMember(server.id, user.id))
    .forEach(server => {
      io.to(`server:${server.id}`).emit('user:profile-updated', {
        serverId: server.id,
        userId: user.id,
        user: publicProfile,
      });
      io.to(`server:${server.id}`).emit('server:members-changed', { serverId: server.id });
    });
}

function emitSocialUpdate(req, userIds) {
  const io = req.app.get('io');
  if (!io) return;
  [...new Set(userIds.filter(Boolean))].forEach(userId => {
    io.to(`user:${userId}`).emit('friends:changed', { userId });
  });
}

function safeActivityImage(value) {
  const candidate = String(value || '').trim();
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return null;
    const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localDevelopmentHost)) return parsed.href;
  } catch (_) {
    return null;
  }
  return null;
}

function safeActivity(activity, index) {
  if (!activity || typeof activity !== 'object') return null;
  const name = String(activity.name || '').trim().slice(0, 80);
  if (!name) return null;
  return {
    id: String(activity.id || `activity-${index}`).slice(0, 100),
    sessionId: String(activity.sessionId || activity.id || `activity-${index}`).slice(0, 100),
    name,
    details: String(activity.details || '').trim().slice(0, 160),
    state: String(activity.state || '').trim().slice(0, 160),
    imageUrl: safeActivityImage(activity.imageUrl || activity.image),
    startedAt: Number(activity.startedAt) || null,
    endsAt: Number(activity.endsAt) || null,
    updatedAt: Number(activity.updatedAt) || null,
    expiresAt: Number(activity.expiresAt) || null,
    type: String(activity.type || 'playing').trim().slice(0, 24),
    category: String(activity.category || '').trim().slice(0, 24),
    provider: String(activity.provider || '').trim().slice(0, 40),
    playbackStatus: String(activity.playbackStatus || '').trim().slice(0, 24),
    hideElapsed: Boolean(activity.hideElapsed),
    smallImageUrl: safeActivityImage(activity.smallImageUrl),
    imageText: String(activity.imageText || '').trim().slice(0, 80),
    smallImageText: String(activity.smallImageText || '').trim().slice(0, 80),
    progress: activity.progress || null,
    party: activity.party || null,
    music: activity.music || null,
    metadata: activity.metadata && typeof activity.metadata === 'object' ? activity.metadata : {},
    buttons: Array.isArray(activity.buttons) ? activity.buttons.slice(0, 2) : [],
  };
}

router.use(authRateLimit, requireAuth, readRateLimit, mutationRateLimit);

// Eski kullanıcı adıyla şifresiz giriş endpoint'i güvenlik nedeniyle kaldırıldı.
router.post('/login', (req, res) => res.status(410).json({
  error: 'This sign-in method has been removed. Use email and two-factor verification.',
}));

router.get('/', (req, res) => res.json(storage.getPublicUsers()));

router.get('/me', (req, res) => res.json({ user: privateUser(req.user) }));

router.get('/me/rich-presence', (req, res) => {
  res.json(richPresenceService.getManagementState(req.user.id));
});

router.post('/me/rich-presence/token', (req, res) => {
  try {
    return res.status(201).json(richPresenceService.createToken(req.user.id));
  } catch (error) {
    return res.status(400).json({ error: error.message || 'The integration key could not be created.' });
  }
});

router.delete('/me/rich-presence/token', (req, res) => {
  const revoked = richPresenceService.revokeToken(req.user.id);
  return res.json({ success: true, revoked });
});

router.patch('/me/rich-presence/settings', (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'The enabled setting must be true or false.' });
  }
  return res.json(richPresenceService.setEnabled(req.user.id, req.body.enabled));
});

router.patch('/me', async (req, res) => {
  const allowedFields = [
    'username',
    'avatar',
    'banner',
    'bio',
    'customStatus',
    'presenceStatus',
    'locale',
    'theme',
    'profileTheme',
    'profileAccentColor',
    'nameFont',
    'nameEffect',
    'avatarDecoration',
    'profileEffect',
  ];
  const updates = {};
  allowedFields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) updates[field] = req.body[field];
  });

  try {
    const user = storage.updateUserProfile(req.user.id, updates);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Username değiştiğinde mevcut socket oturumları da eski adla
    // mesaj göndermeye devam etmesin.
    const io = req.app.get('io');
    if (io) {
      try {
        const sockets = await io.in(`user:${user.id}`).fetchSockets();
        sockets.forEach(activeSocket => {
          if (activeSocket.authUser?.id !== user.id) return;
          activeSocket.authUser.username = user.username;
          if (activeSocket.userData) activeSocket.userData.username = user.username;
        });
      } catch (error) {
        console.warn('Could not update active profile sessions:', error.message);
      }
    }

    emitProfileUpdate(req, user);
    return res.json({ user: privateUser(user) });
  } catch (error) {
    const message = error.message === 'Username taken'
      ? 'This username is already in use.'
      : (error.message || 'The profile could not be updated.');
    return res.status(400).json({ error: message });
  }
});

router.get('/:userId/profile', (req, res) => {
  const targetUserId = String(req.params.userId || '').trim();
  const target = storage.getPublicUserById(targetUserId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const requestedServerId = String(req.query.serverId || '').trim();
  const canSeeServerContext = requestedServerId
    && storage.isServerMember(requestedServerId, req.user.id)
    && storage.isServerMember(requestedServerId, targetUserId);
  const server = canSeeServerContext ? storage.getServerById(requestedServerId) : null;
  const serverMember = server ? storage.getServerMemberDetails(server.id, targetUserId) : null;
  const viewerMember = server ? storage.getServerMemberDetails(server.id, req.user.id) : null;
  const friendship = storage.getFriendship(req.user.id, targetUserId);
  const pendingRequest = storage.getPendingFriendRelationship(req.user.id, targetUserId);
  const activities = richPresenceService.getActivities(targetUserId, { includeHidden: req.user.id === targetUserId })
    .map(safeActivity)
    .filter(Boolean)
    .slice(0, 10);

  if (!activities.length && target.customStatus) {
    activities.push({
      id: 'custom-status',
      name: 'Custom State',
      details: String(target.customStatus).slice(0, 160),
      state: '',
      imageUrl: null,
      startedAt: null,
      type: 'custom-status',
    });
  }

  return res.json({
    user: { ...target, status: storage.getUserStatus(targetUserId) },
    server: server ? {
      id: server.id,
      name: server.name,
      icon: server.icon || null,
      createdAt: server.createdAt || null,
    } : null,
    serverMember,
    viewer: viewerMember ? {
      isOwner: viewerMember.isOwner,
      permissions: viewerMember.permissions,
      canManageRoles: viewerMember.isOwner,
    } : null,
    availableRoles: viewerMember?.isOwner ? storage.getServerRoles(server.id) : [],
    relationship: {
      isSelf: req.user.id === targetUserId,
      isFriend: Boolean(friendship),
      friendsSince: friendship?.createdAt || null,
      pendingRequest,
      isBlocked: storage.getBlockedUsers(req.user.id).some(user => user.id === targetUserId),
    },
    mutualFriends: storage.getMutualFriends(req.user.id, targetUserId),
    mutualServers: storage.getMutualServers(req.user.id, targetUserId),
    note: req.user.id === targetUserId ? '' : storage.getProfileNote(req.user.id, targetUserId),
    activities,
  });
});

router.put('/:userId/note', (req, res) => {
  const targetUserId = String(req.params.userId || '').trim();
  if (!storage.getUserById(targetUserId)) return res.status(404).json({ error: 'User not found.' });
  if (targetUserId === req.user.id) return res.status(400).json({ error: 'You cannot add a private note to your own profile.' });
  try {
    const note = storage.setProfileNote(req.user.id, targetUserId, req.body?.note ?? '');
    return res.json({ note });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'The note could not be saved.' });
  }
});

router.get('/me/blocks', (req, res) => res.json({ users: storage.getBlockedUsers(req.user.id) }));

function blockUser(req, res) {
  const targetUserId = String(req.params.userId || req.body?.userId || req.body?.targetUserId || '').trim();
  if (!targetUserId) return res.status(400).json({ error: 'A user to block is required.' });
  if (targetUserId === req.user.id) return res.status(400).json({ error: 'Kendini engelleyemezsin.' });
  if (!storage.getUserById(targetUserId)) return res.status(404).json({ error: 'User not found.' });

  const blocked = storage.blockUser(req.user.id, targetUserId);
  if (!blocked) return res.status(400).json({ error: 'User engellenemedi.' });
  emitSocialUpdate(req, [req.user.id, targetUserId]);
  req.app.get('io')?.to(`user:${req.user.id}`).emit('blocks:changed', { userId: req.user.id });
  return res.status(201).json({ blockedUser: blocked.user, blockedAt: blocked.createdAt });
}

router.post('/me/blocks', blockUser);
router.post('/me/blocks/:userId', blockUser);

router.delete('/me/blocks/:userId', (req, res) => {
  const targetUserId = String(req.params.userId || '').trim();
  const removed = storage.unblockUser(req.user.id, targetUserId);
  if (!removed) return res.status(404).json({ error: 'This user is not in your blocked list.' });
  req.app.get('io')?.to(`user:${req.user.id}`).emit('blocks:changed', { userId: req.user.id });
  return res.json({ success: true });
});

module.exports = router;
