const { v4: uuidv4 } = require('uuid');

const storage = require('../storage/inMemory');

function uniqueMemberIds(ownerId, inputIds) {
  return [...new Set([String(ownerId), ...(Array.isArray(inputIds) ? inputIds : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)])].slice(0, 10);
}

function serializeConversation(server, viewerId) {
  if (!server?.isDM || !server.dmUserIds?.includes(viewerId)) return null;
  const channel = storage.getChannelsByServerId(server.id).find(item => item.type === 'text');
  if (server.isGroupDM) {
    return {
      id: server.id,
      channelId: channel?.id || null,
      type: 'group',
      name: server.name,
      icon: server.icon || null,
      ownerId: server.ownerId,
      memberIds: [...server.dmUserIds],
      members: server.dmUserIds.map(id => storage.getPublicUserById(id)).filter(Boolean),
      createdAt: server.createdAt,
      updatedAt: server.updatedAt || server.createdAt,
    };
  }
  const otherUserId = server.dmUserIds.find(id => id !== viewerId);
  const otherUser = storage.getPublicUserById(otherUserId);
  if (!otherUser) return null;
  return {
    id: server.id,
    channelId: channel?.id || null,
    type: 'direct',
    user1Id: viewerId,
    user2Id: otherUserId,
    otherUser,
  };
}

class GroupDmService {
  listForUser(userId) {
    return storage.getAllServers()
      .filter(server => server.isDM && server.dmUserIds?.includes(userId))
      .map(server => serializeConversation(server, userId))
      .filter(Boolean);
  }

  get(conversationId, viewerId) {
    return serializeConversation(storage.getServerById(conversationId), viewerId);
  }

  create(ownerId, input = {}) {
    const memberIds = uniqueMemberIds(ownerId, input.memberIds);
    if (memberIds.length < 3) throw new Error('A group direct message requires at least three people.');
    if (memberIds.some(userId => !storage.getUserById(userId))) throw new Error('Membersden biri not found.');
    if (memberIds.some(userId => userId !== String(ownerId)
      && storage.isBlockedEitherDirection?.(ownerId, userId))) {
      const error = new Error('A blocked user cannot be added to the group.');
      error.statusCode = 403;
      error.code = 'USER_BLOCKED';
      throw error;
    }
    const now = Date.now();
    const server = {
      id: uuidv4(),
      name: String(input.name || 'New Group').trim().slice(0, 100) || 'New Group',
      icon: input.icon ? String(input.icon).slice(0, 1000) : null,
      isDM: true,
      isGroupDM: true,
      ownerId: String(ownerId),
      dmUserIds: memberIds,
      createdAt: now,
      updatedAt: now,
    };
    const channel = {
      id: uuidv4(),
      serverId: server.id,
      name: 'group-dm-chat',
      type: 'text',
      createdAt: now,
    };
    storage.servers.push(server);
    storage.channels.push(channel);
    storage.serverMembers.set(server.id, [...memberIds]);
    storage.saveData();
    return serializeConversation(server, ownerId);
  }

  update(conversationId, actorId, updates = {}) {
    const server = storage.getServerById(conversationId);
    if (!server?.isGroupDM || server.ownerId !== actorId) return null;
    if (updates.name !== undefined) {
      const name = String(updates.name || '').trim().slice(0, 100);
      if (!name) throw new Error('The group name cannot be empty.');
      server.name = name;
    }
    if (updates.icon !== undefined) server.icon = updates.icon ? String(updates.icon).slice(0, 1000) : null;
    server.updatedAt = Date.now();
    storage.saveData();
    return serializeConversation(server, actorId);
  }

  addMember(conversationId, actorId, userId) {
    const server = storage.getServerById(conversationId);
    if (!server?.isGroupDM || server.ownerId !== actorId || server.dmUserIds.length >= 10) return null;
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId || !storage.getUserById(normalizedUserId)) return null;
    if (server.dmUserIds.some(memberId => storage.isBlockedEitherDirection?.(memberId, normalizedUserId))) return null;
    if (!server.dmUserIds.includes(normalizedUserId)) server.dmUserIds.push(normalizedUserId);
    storage.serverMembers.set(server.id, [...server.dmUserIds]);
    server.updatedAt = Date.now();
    storage.saveData();
    return serializeConversation(server, actorId);
  }

  removeMember(conversationId, actorId, userId) {
    const server = storage.getServerById(conversationId);
    if (!server?.isGroupDM || !server.dmUserIds.includes(userId)) return null;
    const removingSelf = actorId === userId;
    if (!removingSelf && server.ownerId !== actorId) return null;
    if (userId === server.ownerId) {
      const successor = server.dmUserIds.find(id => id !== userId);
      if (!successor) {
        storage.deleteServer(server.id);
        return { deleted: true, conversationId: server.id };
      }
      server.ownerId = successor;
    }
    server.dmUserIds = server.dmUserIds.filter(id => id !== userId);
    if (server.dmUserIds.length < 2) {
      storage.deleteServer(server.id);
      return { deleted: true, conversationId: server.id };
    }
    storage.serverMembers.set(server.id, [...server.dmUserIds]);
    server.updatedAt = Date.now();
    storage.saveData();
    return serializeConversation(server, actorId === userId ? server.ownerId : actorId);
  }
}

module.exports = { groupDmService: new GroupDmService() };
