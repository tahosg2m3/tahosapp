const messageHandler = require('./handlers/messageHandler');
const userHandler = require('./handlers/userHandler');
const typingHandler = require('./handlers/typingHandler');
const voiceHandler = require('./handlers/voiceHandler');
const dmHandler = require('./handlers/dmHandler');
const statusHandler = require('./handlers/statusHandler');
const callHandler = require('./handlers/callHandler');
const { userService } = require('../services/userService');
const storage = require('../storage/inMemory');
const { verifyAuthToken } = require('../middleware/auth');
const { richPresenceService } = require('../services/richPresenceService');
const { messageModerationService } = require('../services/messageModerationService');

const activeUserSockets = new Map();

function getUserServerIds(userId) {
  return storage.getAllServers()
    .filter(server => !server.isDM && storage.isServerMember(server.id, userId))
    .map(server => server.id);
}

function broadcastPresence(io, userId, status) {
  getUserServerIds(userId).forEach(serverId => {
    io.to(`server:${serverId}`).emit('presence:update', { userId, status, serverId });
  });
}

function socketToken(socket) {
  const handshakeToken = socket.handshake.auth?.token;
  if (typeof handshakeToken === 'string') return handshakeToken;

  const authorization = socket.handshake.headers?.authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null;
}

function socketEventLimit(eventName) {
  if (/^(message:|dm:)/.test(eventName)) return { bucket: 'message', max: 25, windowMs: 10_000 };
  if (/^(voice:|call:|webrtc:|screen:|camera:)/.test(eventName)) return { bucket: 'realtime-media', max: 180, windowMs: 10_000 };
  if (/^(typing:|status:|members:|users:)/.test(eventName)) return { bucket: 'presence', max: 100, windowMs: 10_000 };
  return { bucket: 'other', max: 120, windowMs: 10_000 };
}

function installSocketRateLimit(socket) {
  const counters = new Map();
  socket.use(([eventName], next) => {
    const event = typeof eventName === 'string' ? eventName.slice(0, 100) : 'unknown';
    const now = Date.now();
    const limit = socketEventLimit(event);
    const current = counters.get(limit.bucket);
    const counter = !current || now - current.startedAt >= limit.windowMs
      ? { startedAt: now, count: 0 }
      : current;
    counter.count += 1;
    counters.set(limit.bucket, counter);
    if (counter.count <= limit.max) return next();

    const error = new Error('Too many real-time actions were sent. Please wait a moment.');
    error.data = {
      code: 'SOCKET_RATE_LIMITED',
      retryAfterMs: Math.max(1, limit.windowMs - (now - counter.startedAt)),
    };
    return next(error);
  });
}

function canViewChannel(channelId, userId) {
  const channel = storage.getChannelById(String(channelId || ''));
  if (!channel || !userId) return false;
  const server = storage.getServerById(channel.serverId);
  if (!server) return false;
  if (server.isDM) return Array.isArray(server.dmUserIds) && server.dmUserIds.includes(userId);
  return storage.isServerMember(server.id, userId)
    && messageModerationService.hasChannelPermission(channel, userId, 'VIEW_CHANNEL');
}

module.exports = (io, options = {}) => {
  // Socket.IO bağlantısı daha event çalışmadan gerçek JWT ile doğrulanır.
  io.use((socket, next) => {
    try {
      const { user } = verifyAuthToken(socketToken(socket));
      socket.authUser = { id: user.id, username: user.username };
      return next();
    } catch (error) {
      return next(new Error('The session is invalid or expired. Please sign in again.'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);
    installSocketRateLimit(socket);
    socket.on('error', error => {
      if (error?.data?.code === 'SOCKET_RATE_LIMITED') {
        socket.emit('rate-limit:error', {
          message: error.message,
          code: error.data.code,
          retryAfterMs: error.data.retryAfterMs,
        });
        return;
      }
      console.warn(`Socket packet rejected (${socket.id}): ${error?.message || 'unknown error'}`);
    });

    socket.userData = {
      userId: null,
      username: null,
      currentChannel: null,
      authenticated: false,
    };

    const ensureAuthenticated = callback => (...args) => {
      if (!socket.userData.authenticated) {
        socket.emit('auth:error', { message: 'Authenticate the socket connection first.' });
        return undefined;
      }
      return callback(...args);
    };

    // Eski istemcinin gönderdiği userId/username artık güvenilmez. Kimlik sadece JWT'den gelir.
    socket.on('authenticate', () => {
      if (socket.userData.authenticated) {
        const currentUser = storage.getUserById(socket.authUser?.id);
        const selectedStatus = storage.PRESENCE_STATUSES.includes(currentUser?.presenceStatus)
          ? currentUser.presenceStatus
          : 'online';
        socket.emit('presence:ready', {
          status: selectedStatus,
          visibleStatus: selectedStatus === 'invisible' ? 'offline' : selectedStatus,
        });
        return;
      }

      const user = storage.getUserById(socket.authUser?.id);
      if (!user) {
        socket.emit('auth:error', { message: 'User not found.' });
        socket.disconnect(true);
        return;
      }

      socket.userData.userId = user.id;
      socket.userData.username = user.username;
      socket.userData.authenticated = true;

      const userSockets = activeUserSockets.get(user.id) || new Set();
      const wasOffline = userSockets.size === 0;
      userSockets.add(socket.id);
      activeUserSockets.set(user.id, userSockets);

      socket.join(`user:${user.id}`);
      const selectedStatus = storage.PRESENCE_STATUSES.includes(user.presenceStatus)
        ? user.presenceStatus
        : 'online';
      const publicStatus = selectedStatus === 'invisible' ? 'offline' : selectedStatus;
      storage.updateUserStatus(user.id, publicStatus);

      getUserServerIds(user.id).forEach(serverId => socket.join(`server:${serverId}`));

      if (wasOffline) {
        storage.getUserFriends(user.id).forEach(friend => {
          io.to(`user:${friend.id}`).emit('status:update', {
            userId: user.id,
            username: user.username,
            status: publicStatus,
          });
        });
        broadcastPresence(io, user.id, publicStatus);
        richPresenceService.broadcast(user.id);
      }

      socket.emit('presence:ready', { status: selectedStatus, visibleStatus: publicStatus });
    });

    socket.on('user:join', ensureAuthenticated(data => userHandler.handleJoin(io, socket, data)));
    socket.on('user:leave', ensureAuthenticated(data => userHandler.handleLeave(io, socket, data)));

    socket.on('message:send', ensureAuthenticated(data => messageHandler.handleSend(io, socket, data)));
    socket.on('message:edit', ensureAuthenticated(data => messageHandler.handleEdit(io, socket, data)));
    socket.on('message:delete', ensureAuthenticated(data => messageHandler.handleDelete(io, socket, data)));
    socket.on('message:reaction:toggle', ensureAuthenticated(data => messageHandler.handleReactionToggle(io, socket, data)));
    socket.on('message:pin:toggle', ensureAuthenticated(data => messageHandler.handlePinToggle(io, socket, data)));
    socket.on('message:search', ensureAuthenticated((data, callback) => messageHandler.handleSearch(io, socket, data, callback)));
    // Okunma bilgisinin kalıcılığı sonraki veri tabanı aşamasında eklenecek; event güvenle kabul edilir.
    socket.on('channel:read', ensureAuthenticated(() => {}));

    socket.on('typing:start', ensureAuthenticated(data => typingHandler.handleStart(io, socket, data)));
    socket.on('typing:stop', ensureAuthenticated(data => typingHandler.handleStop(io, socket, data)));

    voiceHandler(io, socket, options);
    callHandler(io, socket);

    socket.on('dm:send', ensureAuthenticated(data => dmHandler.handleSendDM(io, socket, data)));
    socket.on('status:change', ensureAuthenticated(data => statusHandler.handleStatusChange(io, socket, data)));
    socket.on('users:get-online', ensureAuthenticated(data => statusHandler.handleGetOnlineUsers(io, socket, data)));

    socket.on('members:request', ensureAuthenticated(data => {
      const channelId = String(data?.channelId || '');
      if (!canViewChannel(channelId, socket.userData.userId)) {
        socket.emit('members:update', { channelId, members: [], error: 'You do not have permission to view this channel.' });
        return;
      }
      const members = userService.getChannelMembers(channelId);
      socket.emit('members:update', { channelId, members });
    }));

    socket.on('disconnect', () => {
      if (socket.userData.username && socket.userData.currentChannel) {
        userService.removeUser(socket.userData.currentChannel, socket.id);
        io.to(`channel:${socket.userData.currentChannel}`).emit('user:left', {
          username: socket.userData.username,
          timestamp: Date.now(),
        });
      }

      if (socket.userData.authenticated && socket.userData.userId) {
        const userId = socket.userData.userId;
        const userSockets = activeUserSockets.get(userId);
        userSockets?.delete(socket.id);

        if (!userSockets || userSockets.size === 0) {
          activeUserSockets.delete(userId);
          storage.updateUserStatus(userId, 'offline');

          storage.getUserFriends(userId).forEach(friend => {
            io.to(`user:${friend.id}`).emit('status:update', { userId, status: 'offline' });
          });
          broadcastPresence(io, userId, 'offline');
          richPresenceService.broadcast(userId);
        }
      }

      console.log('❌ Client disconnected:', socket.id);
    });
  });
};
