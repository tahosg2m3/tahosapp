const storage = require('../../storage/inMemory');
const { richPresenceService } = require('../../services/richPresenceService');

function socketIdentity(socket) {
  const userId = socket.authUser?.id;
  if (!userId || socket.userData?.authenticated !== true || socket.userData?.userId !== userId) return null;
  return storage.getUserById(userId) || null;
}

function visibleStatus(status) {
  return status === 'invisible' ? 'offline' : status;
}

function getUserServerIds(userId) {
  return storage.getAllServers()
    .filter(server => !server.isDM && storage.isServerMember(server.id, userId))
    .map(server => server.id);
}

function broadcastStatus(io, user, status) {
  const publicStatus = visibleStatus(status);
  storage.getUserFriends(user.id).forEach(friend => {
    io.to(`user:${friend.id}`).emit('status:update', {
      userId: user.id,
      username: user.username,
      status: publicStatus,
      customStatus: user.customStatus || '',
    });
  });
  const publicProfile = storage.getPublicUserById(user.id);
  getUserServerIds(user.id).forEach(serverId => {
    io.to(`server:${serverId}`).emit('presence:update', {
      userId: user.id,
      status: publicStatus,
      customStatus: user.customStatus || '',
      serverId,
    });
    io.to(`server:${serverId}`).emit('user:profile-updated', {
      serverId,
      userId: user.id,
      user: publicProfile,
    });
  });
}

exports.handleStatusChange = (io, socket, data = {}) => {
  const user = socketIdentity(socket);
  if (!user) return;

  const status = String(data.status || '').trim().toLowerCase();
  if (!storage.PRESENCE_STATUSES.includes(status)) {
    socket.emit('status:error', {
      code: 'INVALID_PRESENCE_STATUS',
      message: 'Invalid online status.',
    });
    return;
  }

  const updates = { presenceStatus: status };
  if (Object.prototype.hasOwnProperty.call(data, 'customStatus')) updates.customStatus = data.customStatus;

  try {
    const updatedUser = storage.updateUserProfile(user.id, updates);
    const publicStatus = visibleStatus(status);
    storage.updateUserStatus(user.id, publicStatus);
    broadcastStatus(io, updatedUser, status);
    richPresenceService.broadcast(user.id);
    io.to(`user:${user.id}`).emit('status:update:self', {
      userId: user.id,
      status,
      visibleStatus: publicStatus,
      customStatus: updatedUser.customStatus,
    });
    console.log(`👤 ${updatedUser.username} status: ${status}`);
  } catch (error) {
    socket.emit('status:error', {
      code: 'INVALID_STATUS_UPDATE',
      message: error.message || 'Status could not be updated.',
    });
  }
};

exports.handleGetOnlineUsers = (io, socket, data = {}) => {
  const requester = socketIdentity(socket);
  if (!requester) return;

  const requestedServerIds = Array.isArray(data.serverIds) ? data.serverIds.slice(0, 100) : [];
  const usersById = new Map();

  requestedServerIds.forEach(rawServerId => {
    const serverId = String(rawServerId || '');
    if (!serverId || !storage.isServerMember(serverId, requester.id)) return;

    storage.getServerMembersWithDetails(serverId).forEach(member => {
      let status = storage.getUserStatus(member.id);
      const isRequesterInvisible = member.id === requester.id && requester.presenceStatus === 'invisible';
      if (isRequesterInvisible) status = 'invisible';
      if (status === 'offline') return;
      usersById.set(member.id, { ...member, status });
    });
  });

  socket.emit('users:online', { users: [...usersById.values()] });
};
