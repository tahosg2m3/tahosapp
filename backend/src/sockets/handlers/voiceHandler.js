const storage = require('../../storage/inMemory');
const { platformService } = require('../../services/platformService');
const { getChannelViewerSockets } = require('../authorizedEmit');

// channelId -> [{ userId, username, peerId, socketId, streamMode, audioEnabled }]
const voiceChannels = new Map();

const VOICE_MODERATION_ACTIONS = {
  mute: { permission: 'MUTE_MEMBERS', changes: { serverMuted: true } },
  unmute: { permission: 'MUTE_MEMBERS', changes: { serverMuted: false } },
  deafen: { permission: 'DEAFEN_MEMBERS', changes: { serverDeafened: true } },
  undeafen: { permission: 'DEAFEN_MEMBERS', changes: { serverDeafened: false } },
  disconnect: { permission: 'MOVE_MEMBERS' },
  move: { permission: 'MOVE_MEMBERS' },
};

const SOUNDBOARD_SOUND_IDS = new Set([
  'airhorn', 'applause', 'laugh', 'drumroll', 'tada', 'rimshot', 'notification', 'boop',
]);

function sameId(first, second) {
  return String(first || '') === String(second || '');
}

function isValidPeerId(peerId) {
  return /^[A-Za-z0-9_-]{1,255}$/.test(peerId);
}

function getVoiceCapabilities(channel, userId) {
  const empty = {
    channelId: channel?.id || null,
    serverId: channel?.serverId || null,
    canConnect: false,
    canSpeak: false,
    canStream: false,
    serverMuted: false,
    serverDeafened: false,
    isTimedOut: false,
    verificationRequired: false,
  };

  if (!channel || !['voice', 'stage'].includes(channel.type)) return empty;
  const server = storage.getServerById(channel.serverId);
  if (!server || server.isDM || !storage.isServerMember(server.id, userId)) return empty;

  const moderation = storage.getMemberModerationState(server.id, userId);
  const isVerified = server.creatorId === userId
    || storage.hasPermission(server.id, userId, 'ADMINISTRATOR')
    || platformService.isMemberVerified(server.id, userId);
  const canConnect = isVerified && !moderation.isTimedOut
    && platformService.hasChannelPermission(channel.id, userId, 'CONNECT');
  return {
    channelId: channel.id,
    serverId: server.id,
    canConnect,
    canSpeak: canConnect && platformService.hasChannelPermission(channel.id, userId, 'SPEAK'),
    canStream: canConnect && platformService.hasChannelPermission(channel.id, userId, 'STREAM'),
    verificationRequired: !isVerified,
    ...moderation,
  };
}

function isVoiceChannelAccessible(channel, userId) {
  return getVoiceCapabilities(channel, userId).canConnect;
}

function withStageRole(channel, capabilities, participant = null) {
  if (channel?.type !== 'stage') return capabilities;
  const stageRole = participant?.stageRole || 'audience';
  const isSpeaker = stageRole === 'speaker';
  return {
    ...capabilities,
    stageRole,
    requestedToSpeak: Boolean(participant?.requestedToSpeak),
    canSpeak: capabilities.canSpeak && isSpeaker,
    canStream: capabilities.canStream && isSpeaker,
  };
}

function getPublicMembers(channelId) {
  const channel = storage.getChannelById(channelId);
  if (!channel) return [];

  return (voiceChannels.get(channelId) || []).map((participant) => {
    const moderation = storage.getMemberModerationState(channel.serverId, participant.userId);
    return {
      userId: participant.userId,
      username: participant.username,
      peerId: participant.peerId,
      streamMode: participant.streamMode || 'none',
      stageRole: channel.type === 'stage' ? (participant.stageRole || 'audience') : null,
      requestedToSpeak: channel.type === 'stage' ? Boolean(participant.requestedToSpeak) : false,
      ...moderation,
    };
  });
}

function broadcastVoiceMembers(io, channelId) {
  const payload = {
    channelId,
    members: getPublicMembers(channelId),
  };
  getChannelViewerSockets(io, channelId)
    .forEach(targetSocket => targetSocket.emit('voice:channel-members', payload));
}

function reply(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

function sendCapabilities(socket, capabilities) {
  socket.emit('voice:capabilities', capabilities);
}

function removeVoiceSocket(io, channelId, socketId, { notify = true } = {}) {
  const users = voiceChannels.get(channelId) || [];
  const userIndex = users.findIndex((member) => member.socketId === socketId);
  if (userIndex === -1) return null;

  const [participant] = users.splice(userIndex, 1);
  const channel = storage.getChannelById(channelId);
  if (channel && participant.joinedAt) {
    const voiceMinutes = Math.max(0, (Date.now() - participant.joinedAt) / 60_000);
    if (voiceMinutes > 0) platformService.recordServerStat(channel.serverId, 'voiceMinutes', voiceMinutes);
  }
  const targetSocket = io.sockets.sockets.get(socketId);
  targetSocket?.leave(`voice:${channelId}`);

  if (notify) {
    io.to(`voice:${channelId}`).emit('voice:user-left', {
      channelId,
      serverId: channel?.serverId,
      userId: participant.userId,
    });
  }
  if (users.length === 0) {
    voiceChannels.delete(channelId);
    if (channel?.temporary) {
      const serverId = channel.serverId;
      const viewers = getChannelViewerSockets(io, channelId);
      const managers = getChannelViewerSockets(io, channelId, 'MANAGE_CHANNELS');
      platformService.deleteChannelData?.(channelId);
      storage.deleteChannel(channelId);
      viewers.forEach(targetSocket => targetSocket.emit('channels:changed', { serverId }));
      const update = {
        serverId,
        scope: 'channels',
        action: 'temporary-deleted',
        data: {},
        timestamp: Date.now(),
      };
      managers.forEach(targetSocket => targetSocket.emit('platform:update', update));
    } else {
      // Son katılımcı çıktığında da kanal listesini izleyen tüm yetkili
      // istemcilere boş snapshot gönder. Aksi halde kullanıcı, F5 yapılana
      // kadar ses kanalının altında görünmeye devam eder.
      broadcastVoiceMembers(io, channelId);
    }
  } else {
    broadcastVoiceMembers(io, channelId);
  }
  return participant;
}

function sendModerationEvent(io, targetUserId, payload) {
  io.to(`user:${targetUserId}`).emit('voice:moderated', payload);
}

function disconnectUserFromServerVoice(io, serverId, userId) {
  if (!io) return false;
  let disconnected = false;

  for (const channelId of [...voiceChannels.keys()]) {
    const channel = storage.getChannelById(channelId);
    if (!channel || !sameId(channel.serverId, serverId)) continue;
    const participant = (voiceChannels.get(channelId) || []).find((member) => sameId(member.userId, userId));
    if (!participant) continue;
    removeVoiceSocket(io, channelId, participant.socketId);
    disconnected = true;
  }

  return disconnected;
}

function disconnectPeerFromVoice(io, peerId) {
  if (!io || !peerId) return false;
  let disconnected = false;
  for (const channelId of [...voiceChannels.keys()]) {
    const participants = [...(voiceChannels.get(channelId) || [])];
    participants
      .filter(participant => sameId(participant.peerId, peerId))
      .forEach(participant => {
        removeVoiceSocket(io, channelId, participant.socketId);
        disconnected = true;
      });
  }
  return disconnected;
}

module.exports = (io, socket, { isPeerAvailable = () => true } = {}) => {
  let lastSoundboardPlayAt = 0;
  const fail = (message, callback, capabilities) => {
    if (capabilities) sendCapabilities(socket, capabilities);
    socket.emit('voice:error', { message });
    reply(callback, { success: false, error: message, capabilities });
  };

  socket.on('voice:capabilities-request', (data = {}, callback) => {
    const userId = socket.userData?.userId;
    const channelId = String(data.channelId || '');
    const channel = storage.getChannelById(channelId);
    const participant = (voiceChannels.get(channelId) || []).find(member => sameId(member.userId, userId));
    const capabilities = withStageRole(channel, getVoiceCapabilities(channel, userId), participant);

    if (!socket.userData?.authenticated || !userId || !channelId || !capabilities.canConnect) {
      reply(callback, {
        success: false,
        error: 'You do not have permission to join this voice channel.',
        capabilities,
      });
      return;
    }

    sendCapabilities(socket, capabilities);
    reply(callback, { success: true, capabilities });
  });

  socket.on('voice:join', (data = {}, callback) => {
    const userId = socket.userData?.userId;
    const username = socket.userData?.username;
    const channelId = String(data.channelId || '');
    const peerId = String(data.peerId || '');
    const channel = storage.getChannelById(channelId);
    const capabilities = getVoiceCapabilities(channel, userId);

    if (!socket.userData?.authenticated || !userId || !username || !channelId || !isValidPeerId(peerId)) {
      fail('The voice channel connection details are invalid.', callback, capabilities);
      return;
    }
    if (!capabilities.canConnect) {
      fail('You do not have permission to join this voice channel.', callback, capabilities);
      return;
    }
    if (!isPeerAvailable(peerId)) {
      fail('The voice connection is not ready yet. Try again in a few seconds.', callback, capabilities);
      return;
    }

    // Aynı socket başka bir ses kanalındaysa önce temizle.
    for (const existingChannelId of [...voiceChannels.keys()]) {
      if (!sameId(existingChannelId, channelId)) removeVoiceSocket(io, existingChannelId, socket.id);
    }

    if (!voiceChannels.has(channelId)) voiceChannels.set(channelId, []);
    // Socket bağlantısı açık kalsa bile kapanmış bir PeerJS kimliği ses
    // listesinde tutulmaz. Bu temizlik, F5 veya kısa ağ kesintisinden kalan
    // eski kimliğe çağrı yapılıp `peer-unavailable` hatası oluşmasını önler.
    [...(voiceChannels.get(channelId) || [])]
      .filter(member => !sameId(member.userId, userId) && !isPeerAvailable(member.peerId))
      .forEach(member => removeVoiceSocket(io, channelId, member.socketId));
    const users = voiceChannels.get(channelId) || [];
    const existingUser = users.find((member) => sameId(member.userId, userId));
    let peerChanged = false;

    if (existingUser) {
      const oldSocketId = existingUser.socketId;
      peerChanged = !sameId(existingUser.peerId, peerId);
      existingUser.username = username;
      existingUser.peerId = peerId;
      existingUser.socketId = socket.id;
      if (oldSocketId !== socket.id) io.sockets.sockets.get(oldSocketId)?.leave(`voice:${channelId}`);
    } else {
      users.push({
        userId: String(userId),
        username,
        peerId,
        socketId: socket.id,
        streamMode: 'none',
        audioEnabled: false,
        stageRole: channel.type === 'stage' ? 'audience' : null,
        requestedToSpeak: false,
        joinedAt: Date.now(),
      });
    }

    socket.join(`voice:${channelId}`);
    // Yeni katılan istemci önce mevcut katılımcıları tanısın. Böylece hemen
    // ardından gelecek PeerJS ses/kamera/yayın çağrılarını güvenlik kontrolü
    // yüzünden yanlışlıkla reddetmez.
    socket.emit('voice:existing-users', users
      .filter((member) => !sameId(member.userId, userId))
      .map((member) => ({
        userId: member.userId,
        username: member.username,
        peerId: member.peerId,
        streamMode: member.streamMode || 'none',
        stageRole: channel.type === 'stage' ? (member.stageRole || 'audience') : null,
        requestedToSpeak: channel.type === 'stage' ? Boolean(member.requestedToSpeak) : false,
        ...storage.getMemberModerationState(channel.serverId, member.userId),
      })));
    // Yeni socket veya yeni PeerJS kimliği diğer katılımcıların eski WebRTC
    // çağrısını kapatıp doğru peerId ile tekrar kurmasını sağlar.
    if (!existingUser || peerChanged || existingUser.socketId === socket.id) {
      socket.to(`voice:${channelId}`).emit('voice:user-joined', {
        channelId,
        serverId: channel.serverId,
        userId: String(userId),
        username,
        peerId,
      });
    }
    const participant = users.find(member => sameId(member.userId, userId));
    const effectiveCapabilities = withStageRole(channel, capabilities, participant);
    sendCapabilities(socket, effectiveCapabilities);
    socket.emit('voice:moderation-state', effectiveCapabilities);
    broadcastVoiceMembers(io, channelId);
    reply(callback, { success: true, capabilities: effectiveCapabilities });
  });

  socket.on('voice:leave', () => {
    if (!socket.userData?.authenticated) return;
    for (const channelId of [...voiceChannels.keys()]) removeVoiceSocket(io, channelId, socket.id);
  });

  socket.on('voice:stream-changed', (data = {}, callback) => {
    const userId = socket.userData?.userId;
    const channelId = String(data.channelId || '');
    const kind = String(data.kind || 'video').toLowerCase();
    const mode = String(data.mode || 'camera').toLowerCase();
    const channel = storage.getChannelById(channelId);
    const baseCapabilities = getVoiceCapabilities(channel, userId);
    const users = voiceChannels.get(channelId) || [];
    const participant = users.find((member) => member.socketId === socket.id && sameId(member.userId, userId));
    const capabilities = withStageRole(channel, baseCapabilities, participant);

    if (!socket.userData?.authenticated || !participant || !capabilities.canConnect) {
      fail('Your voice channel connection could not be verified.', callback, capabilities);
      return;
    }
    if (!['audio', 'video'].includes(kind)) {
      fail('Invalid voice or stream state.', callback, capabilities);
      return;
    }
    if (kind === 'video' && !['camera', 'screen', 'none'].includes(mode)) {
      fail('Invalid stream type.', callback, capabilities);
      return;
    }
    if (kind === 'video' && mode !== 'none' && !capabilities.canStream) {
      fail('You do not have permission to stream or use the camera in this voice channel.', callback, capabilities);
      return;
    }
    if (kind === 'audio' && data.enabled !== false
      && (!capabilities.canSpeak || capabilities.serverMuted
        || (channel.type === 'stage' && participant.stageRole !== 'speaker'))) {
      fail('You do not have permission to speak in this voice channel.', callback, capabilities);
      return;
    }

    if (kind === 'video') participant.streamMode = mode;
    if (kind === 'audio') participant.audioEnabled = Boolean(data.enabled);
    socket.to(`voice:${channelId}`).emit('voice:stream-changed', {
      channelId,
      serverId: channel.serverId,
      userId: String(userId),
      kind,
      mode: kind === 'video' ? mode : undefined,
      enabled: kind === 'audio' ? Boolean(data.enabled) : undefined,
    });
    sendCapabilities(socket, capabilities);
    broadcastVoiceMembers(io, channelId);
    reply(callback, { success: true, capabilities });
  });

  socket.on('voice:members-request', (data = {}) => {
    const serverId = String(data.serverId || '');
    const userId = socket.userData?.userId;
    if (!socket.userData?.authenticated || !storage.isServerMember(serverId, userId)) return;

    const channels = storage.getChannelsByServerId(serverId)
      .filter((channel) => ['voice', 'stage'].includes(channel.type)
        && platformService.hasChannelPermission(channel.id, userId, 'VIEW_CHANNEL'))
      .map((channel) => ({ channelId: channel.id, members: getPublicMembers(channel.id) }));
    socket.emit('voice:channels-snapshot', { serverId, channels });
  });

  socket.on('voice:stage:request-to-speak', (data = {}, callback) => {
    const userId = socket.userData?.userId;
    const channelId = String(data.channelId || '');
    const channel = storage.getChannelById(channelId);
    const participant = (voiceChannels.get(channelId) || [])
      .find(member => member.socketId === socket.id && sameId(member.userId, userId));
    if (!socket.userData?.authenticated || channel?.type !== 'stage' || !participant) {
      reply(callback, { success: false, error: 'Your Stage channel connection could not be verified.' });
      return;
    }
    participant.requestedToSpeak = true;
    participant.stageRole = participant.stageRole || 'audience';
    io.to(`voice:${channelId}`).emit('voice:stage:update', {
      channelId,
      serverId: channel.serverId,
      userId,
      stageRole: participant.stageRole,
      requestedToSpeak: true,
    });
    broadcastVoiceMembers(io, channelId);
    reply(callback, { success: true, stageRole: participant.stageRole, requestedToSpeak: true });
  });

  socket.on('voice:stage:moderate', (data = {}, callback) => {
    const actorId = socket.userData?.userId;
    const channelId = String(data.channelId || '');
    const targetUserId = String(data.targetUserId || '');
    const action = String(data.action || '').toLowerCase();
    const channel = storage.getChannelById(channelId);
    const target = (voiceChannels.get(channelId) || []).find(member => sameId(member.userId, targetUserId));
    const server = channel && storage.getServerById(channel.serverId);
    const validAction = ['invite', 'audience', 'approve', 'deny'].includes(action);
    const hasPermission = server && (
      server.creatorId === actorId
      || platformService.hasChannelPermission(channelId, actorId, 'MANAGE_CHANNELS')
      || platformService.hasChannelPermission(channelId, actorId, 'MUTE_MEMBERS')
      || platformService.hasChannelPermission(channelId, actorId, 'MOVE_MEMBERS')
    );
    const hierarchyAllowed = server?.creatorId === actorId
      || storage.canManageMember(channel?.serverId, actorId, targetUserId);
    if (!socket.userData?.authenticated || channel?.type !== 'stage' || !target || !validAction
      || !hasPermission || !hierarchyAllowed) {
      reply(callback, { success: false, error: 'You do not have sufficient permission or role hierarchy for this Stage action.' });
      return;
    }
    if (action === 'invite' || action === 'approve') target.stageRole = 'speaker';
    if (action === 'audience' || action === 'deny') target.stageRole = 'audience';
    target.requestedToSpeak = false;
    if (target.stageRole === 'audience') target.audioEnabled = false;
    const payload = {
      channelId,
      serverId: channel.serverId,
      userId: targetUserId,
      action,
      stageRole: target.stageRole,
      requestedToSpeak: false,
      moderatedBy: actorId,
    };
    io.to(`voice:${channelId}`).emit('voice:stage:update', payload);
    io.to(`user:${targetUserId}`).emit('voice:stage:moderated', payload);
    const targetCapabilities = withStageRole(channel, getVoiceCapabilities(channel, targetUserId), target);
    io.to(`user:${targetUserId}`).emit('voice:capabilities', targetCapabilities);
    broadcastVoiceMembers(io, channelId);
    reply(callback, { success: true, ...payload });
  });

  socket.on('voice:soundboard:play', (data = {}, callback) => {
    const userId = socket.userData?.userId;
    const channelId = String(data.channelId || '');
    const soundId = String(data.soundId || '').toLowerCase();
    const channel = storage.getChannelById(channelId);
    const participant = (voiceChannels.get(channelId) || [])
      .find(member => member.socketId === socket.id && sameId(member.userId, userId));
    const now = Date.now();
    if (!socket.userData?.authenticated || !participant || !['voice', 'stage'].includes(channel?.type)
      || !SOUNDBOARD_SOUND_IDS.has(soundId)
      || !platformService.hasChannelPermission(channelId, userId, 'SPEAK')) {
      reply(callback, { success: false, error: 'This soundboard action is invalid or you do not have permission.' });
      return;
    }
    if (channel.type === 'stage' && participant.stageRole !== 'speaker') {
      reply(callback, { success: false, error: 'Stage listeners cannot use the soundboard.' });
      return;
    }
    const retryAfterMs = Math.max(0, 2000 - (now - lastSoundboardPlayAt));
    if (retryAfterMs > 0) {
      reply(callback, { success: false, error: 'You are using the soundboard too quickly.', retryAfterMs });
      return;
    }
    lastSoundboardPlayAt = now;
    const payload = {
      channelId,
      serverId: channel.serverId,
      userId,
      username: socket.userData.username,
      soundId,
      createdAt: now,
    };
    io.to(`voice:${channelId}`).emit('voice:soundboard:play', payload);
    reply(callback, { success: true, ...payload });
  });

  socket.on('voice:moderate', (data = {}, callback) => {
    const actorId = socket.userData?.userId;
    const action = String(data.action || '').toLowerCase();
    const targetUserId = String(data.targetUserId || '');
    const channelId = String(data.channelId || '');
    const definition = VOICE_MODERATION_ACTIONS[action];
    const channel = storage.getChannelById(channelId);
    const capabilities = getVoiceCapabilities(channel, actorId);
    const moderationFail = (message) => fail(message, callback, capabilities);

    if (!socket.userData?.authenticated || !definition || !targetUserId || !capabilities.canConnect) {
      moderationFail('Invalid voice moderation action.');
      return;
    }

    const targetParticipant = (voiceChannels.get(channelId) || []).find((member) => sameId(member.userId, targetUserId));
    if (!targetParticipant) {
      moderationFail('This user is not in this voice channel.');
      return;
    }

    if (!storage.canModerateMember(channel.serverId, actorId, targetUserId, definition.permission)) {
      moderationFail('You do not have sufficient permission or role hierarchy to manage this user.');
      return;
    }

    const eventBase = {
      action,
      channelId,
      serverId: channel.serverId,
      byUsername: socket.userData.username,
    };

    if (action === 'move') {
      const targetChannelId = String(data.targetChannelId || '');
      const targetChannel = storage.getChannelById(targetChannelId);
      const targetCapabilities = getVoiceCapabilities(targetChannel, targetUserId);
      const actorCanMoveInSource = platformService.hasChannelPermission(channel.id, actorId, 'MOVE_MEMBERS');
      const actorCanMoveInTarget = targetChannel
        ? platformService.hasChannelPermission(targetChannel.id, actorId, 'MOVE_MEMBERS')
        : false;

      if (!targetChannel
        || !['voice', 'stage'].includes(targetChannel.type)
        || !sameId(targetChannel.serverId, channel.serverId)
        || sameId(targetChannel.id, channel.id)
        || !targetCapabilities.canConnect
        || !actorCanMoveInSource
        || !actorCanMoveInTarget) {
        moderationFail('The user cannot be moved to this voice channel or your permission is insufficient.');
        return;
      }

      removeVoiceSocket(io, channel.id, targetParticipant.socketId);
      // Aynı hesap birden fazla cihazda açıksa yalnızca gerçekten kaynak ses
      // kanalında bulunan socket taşınır; diğer cihazlar istemeden kanala girmez.
      io.to(targetParticipant.socketId).emit('voice:moderated', {
        ...eventBase,
        action: 'move',
        targetChannel: {
          id: targetChannel.id,
          serverId: targetChannel.serverId,
          name: targetChannel.name,
          type: targetChannel.type,
        },
      });
      reply(callback, { success: true, action: 'move', targetChannelId: targetChannel.id });
      return;
    }

    if (definition.changes) {
      const state = storage.setMemberModerationState(channel.serverId, targetUserId, definition.changes, actorId);
      const targetCapabilities = getVoiceCapabilities(channel, targetUserId);
      sendModerationEvent(io, targetUserId, { ...eventBase, state });
      io.to(`user:${targetUserId}`).emit('voice:capabilities', targetCapabilities);
      broadcastVoiceMembers(io, channelId);
      const member = storage.getServerMemberDetails(channel.serverId, targetUserId);
      io.to(`server:${channel.serverId}`).emit('server:member-updated', { serverId: channel.serverId, member });
      io.to(`server:${channel.serverId}`).emit('server:members-changed', { serverId: channel.serverId });
      reply(callback, { success: true, action, state, capabilities: targetCapabilities });
      return;
    }

    sendModerationEvent(io, targetUserId, eventBase);
    disconnectUserFromServerVoice(io, channel.serverId, targetUserId);
    reply(callback, { success: true, action });
  });

  socket.on('disconnect', () => {
    for (const channelId of [...voiceChannels.keys()]) removeVoiceSocket(io, channelId, socket.id);
  });
};

module.exports.disconnectUserFromServerVoice = disconnectUserFromServerVoice;
module.exports.disconnectPeerFromVoice = disconnectPeerFromVoice;
