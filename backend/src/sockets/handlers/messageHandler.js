const {
  MAX_MESSAGE_LENGTH,
  messageService,
  normalizeAttachments,
  normalizeVoiceMessage,
} = require('../../services/messageService');
const { normalizeSpotifyInvite } = require('../../services/spotifyService');
const { messageModerationService } = require('../../services/messageModerationService');
const { platformService } = require('../../services/platformService');
const storage = require('../../storage/inMemory');
const { emitAudit, emitToChannelViewers } = require('../authorizedEmit');

function getChannelAccess(channelId, userId, permission = 'VIEW_CHANNEL') {
  const channel = storage.getChannelById(channelId);
  if (!channel || !userId) {
    return { allowed: false, channel: channel || null, server: null, code: 'CHANNEL_NOT_FOUND' };
  }

  const server = storage.getServerById(channel.serverId);
  if (!server) return { allowed: false, channel, server: null, code: 'SERVER_NOT_FOUND' };

  if (server.isDM) {
    const participants = Array.isArray(server.dmUserIds) ? server.dmUserIds : [];
    const isParticipant = participants.includes(userId);
    const hasBlockedParticipant = participants.some(participantId => (
      participantId !== userId && storage.isBlockedEitherDirection(userId, participantId)
    ));
    const blockedForAction = isParticipant && permission === 'SEND_MESSAGES' && hasBlockedParticipant;
    return {
      allowed: isParticipant && !blockedForAction,
      channel,
      server,
      code: blockedForAction ? 'USER_BLOCKED' : 'MISSING_PERMISSION',
    };
  }

  if (messageModerationService.isUserBanned(server.id, userId)) {
    return { allowed: false, channel, server, code: 'BANNED' };
  }

  const isMember = typeof storage.isServerMember === 'function'
    ? storage.isServerMember(server.id, userId)
    : (storage.serverMembers.get(server.id) || []).includes(userId);
  if (!isMember) return { allowed: false, channel, server, code: 'NOT_A_MEMBER' };

  if (permission === 'SEND_MESSAGES'
    && server.creatorId !== userId
    && !storage.hasPermission(server.id, userId, 'ADMINISTRATOR')
    && !platformService.isMemberVerified(server.id, userId)) {
    return { allowed: false, channel, server, code: 'VERIFICATION_REQUIRED' };
  }

  if (permission === 'SEND_MESSAGES' && typeof storage.isMemberTimedOut === 'function' && storage.isMemberTimedOut(server.id, userId)) {
    const timeoutUntil = storage.getMemberModerationState?.(server.id, userId)?.timeoutUntil || null;
    return {
      allowed: false,
      channel,
      server,
      code: 'TIMEOUT',
      retryAfterMs: timeoutUntil ? Math.max(0, timeoutUntil - Date.now()) : undefined,
    };
  }

  const canViewChannel = messageModerationService.hasChannelPermission(channel, userId, 'VIEW_CHANNEL');
  const allowed = canViewChannel
    && (permission === 'VIEW_CHANNEL'
      || messageModerationService.hasChannelPermission(channel, userId, permission));

  return { allowed, channel, server, code: allowed ? null : 'MISSING_PERMISSION' };
}

function emitAccessError(socket, access, fallbackMessage) {
  const definitions = {
    BANNED: 'You cannot send messages because you are banned from this server.',
    TIMEOUT: 'You are temporarily timed out on this server.',
    NOT_A_MEMBER: 'You are not a member of this server.',
    CHANNEL_NOT_FOUND: 'Channel not found.',
    SERVER_NOT_FOUND: 'Server not found.',
    MISSING_PERMISSION: fallbackMessage || 'You do not have permission to perform this action.',
    USER_BLOCKED: 'You cannot message a blocked user.',
    VERIFICATION_REQUIRED: 'You must accept the server rules before sending messages.',
  };

  socket.emit('message:error', {
    message: definitions[access.code] || fallbackMessage || 'This action could not be completed.',
    code: access.code || 'MISSING_PERMISSION',
    retryAfterMs: access.retryAfterMs,
  });
}

function findMessage(channelId, messageId) {
  return storage.getChannelMessages(channelId).find(message => message.id === messageId);
}

function emitChannelUpdate(io, channelId, eventName, payload) {
  emitToChannelViewers(io, channelId, eventName, payload, { currentRoomOnly: true });
}

function notificationDecision(recipientId, message, server, mentioned) {
  if (storage.isBlockedEitherDirection(recipientId, message.userId)) return { allowed: false };
  const prefs = platformService.getNotificationPreferences(recipientId);
  const now = Date.now();
  if (Number(prefs.mutedUntil) > now) return { allowed: false };

  if (server.isDM) {
    const dmEnabled = prefs.dmNotifications !== false && prefs.directMessages !== false;
    return { allowed: dmEnabled, prefs };
  }

  const serverPrefs = prefs.servers?.[server.id] || {};
  const channelPrefs = prefs.channels?.[message.channelId] || {};
  if (Number(serverPrefs.mutedUntil) > now || Number(channelPrefs.mutedUntil) > now) {
    return { allowed: false };
  }

  const level = (channelPrefs.level && channelPrefs.level !== 'inherit' ? channelPrefs.level : null)
    || (serverPrefs.level && serverPrefs.level !== 'inherit' ? serverPrefs.level : null)
    || prefs.level
    || prefs.serverMode
    || 'all';
  if (['none', 'nothing'].includes(level) || (level === 'mentions' && !mentioned)) return { allowed: false };
  if (mentioned && prefs.mentions === false) return { allowed: false };
  return { allowed: true, prefs };
}

function notifyRecipients(io, message, server, senderId) {
  if (!server) return;

  const recipientIds = server.isDM
    ? (server.dmUserIds || [])
    : (storage.serverMembers.get(server.id) || []);
  const body = message.content || (message.attachments?.length ? 'Sent a file.' : 'New message');

  recipientIds.forEach(recipientId => {
    if (recipientId === senderId) return;

    const recipient = storage.getUserById(recipientId);
    const mentioned = Boolean(
      recipient?.username
      && message.content?.toLocaleLowerCase('en-US').includes(`@${recipient.username}`.toLocaleLowerCase('en-US')),
    );
    const decision = notificationDecision(recipientId, message, server, mentioned);
    if (!decision.allowed) return;

    io.to(`user:${recipientId}`).emit('notification:new', {
      id: `message-${message.id}-${recipientId}`,
      messageId: message.id,
      channelId: message.channelId,
      title: mentioned ? `${message.username} mentioned you` : `${message.username} sent a new message`,
      body: body.slice(0, 180),
      timestamp: message.timestamp,
      isMention: mentioned,
      desktop: decision.prefs?.desktop !== false,
      sound: decision.prefs?.sound !== false,
    });
  });
}

async function forwardAnnouncement(io, message, channel) {
  if (channel?.type !== 'announcement') return;
  const follows = platformService.getAnnouncementFollowers(channel.id);
  for (const follow of follows) {
    const targetChannel = storage.getChannelById(follow.targetChannelId);
    const targetServer = targetChannel && storage.getServerById(targetChannel.serverId);
    if (!targetChannel || !targetServer || targetServer.isDM) continue;
    const forwarded = await messageService.createMessage({
      username: message.username,
      userId: `announcement:${channel.id}`,
      content: message.content,
      channelId: targetChannel.id,
      attachments: message.attachments || [],
      voiceMessage: message.voiceMessage || null,
      spotifyInvite: message.spotifyInvite || null,
    });
    forwarded.forwardedFrom = {
      serverId: channel.serverId,
      channelId: channel.id,
      messageId: message.id,
      authorId: message.userId,
    };
    if (message.bot) {
      forwarded.type = 'bot';
      forwarded.bot = true;
      forwarded.applicationId = message.applicationId || null;
      forwarded.author = message.author || { id: message.userId, username: message.username, bot: true };
    }
    storage.saveData();
    emitChannelUpdate(io, targetChannel.id, 'message:receive', forwarded);
    emitToChannelViewers(io, targetChannel.id, 'platform:update', {
      serverId: targetServer.id,
      scope: 'announcements',
      action: 'forwarded',
      data: { followId: follow.id, message: forwarded },
      timestamp: Date.now(),
    });
    notifyRecipients(io, forwarded, targetServer, forwarded.userId);
  }
}

async function executeSlashCommand(io, socket, access, user, content) {
  if (access.server.isDM || !content.startsWith('/')) return false;
  const match = content.match(/^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i);
  if (!match) {
    socket.emit('message:error', { message: 'The slash command format is invalid.', code: 'INVALID_COMMAND' });
    return true;
  }
  const [, commandName, rawArgs = ''] = match;
  const command = platformService.getCommand(access.server.id, commandName.toLowerCase());
  if (!command || !command.enabled) {
    socket.emit('message:error', { message: `/${commandName} commandu not found.`, code: 'UNKNOWN_COMMAND' });
    return true;
  }
  const missingPermission = (command.requiredPermissions || []).find(permission => (
    !platformService.hasChannelPermission(access.channel.id, user.id, permission)
  ));
  if (missingPermission) {
    socket.emit('message:error', {
      message: 'You do not have permission to use this command.',
      code: 'COMMAND_MISSING_PERMISSION',
      permission: missingPermission,
    });
    return true;
  }
  const args = rawArgs.trim().slice(0, 1000);
  const template = String(command.response || '').trim();
  if (!template) {
    socket.emit('message:error', {
      message: `/${command.name} command does not have a response configured yet.`,
      code: 'COMMAND_NO_RESPONSE',
    });
    return true;
  }
  const responseContent = template
    .replace(/\{user\}/gi, `@${user.username}`)
    .replace(/\{username\}/gi, user.username)
    .replace(/\{args\}/gi, args)
    .slice(0, 4000);
  const invocation = await messageService.createMessage({
    username: user.username,
    userId: user.id,
    content: String(content).slice(0, MAX_MESSAGE_LENGTH),
    channelId: access.channel.id,
  });
  emitChannelUpdate(io, access.channel.id, 'message:receive', invocation);
  socket.emit('message:receive', invocation);
  notifyRecipients(io, invocation, access.server, user.id);
  await forwardAnnouncement(io, invocation, access.channel);

  const response = await messageService.createMessage({
    username: command.name,
    userId: `command:${command.id}`,
    content: responseContent,
    channelId: access.channel.id,
    replyTo: {
      id: invocation.id,
      username: invocation.username,
      content: invocation.content,
    },
  });
  response.type = 'bot';
  response.bot = true;
  response.applicationId = command.id;
  response.command = {
    name: command.name,
    args,
    invokedBy: user.id,
  };
  response.author = { id: response.userId, username: command.name, bot: true };
  storage.saveData();
  emitChannelUpdate(io, access.channel.id, 'message:receive', response);
  socket.emit('message:receive', response);
  notifyRecipients(io, response, access.server, user.id);
  await forwardAnnouncement(io, response, access.channel);
  emitToChannelViewers(io, access.channel.id, 'command:invoked', {
    serverId: access.server.id,
    channelId: access.channel.id,
    commandId: command.id,
    commandName: command.name,
    userId: user.id,
    messageId: response.id,
    createdAt: response.timestamp,
  });
  platformService.recordServerStat(access.server.id, 'messagesSent');
  return true;
}

exports.handleSend = async (io, socket, data = {}) => {
  try {
    const { content, channelId, attachments, replyTo, spotifyInvite } = data;
    const finalUserId = socket.authUser?.id;
    const authenticatedUser = finalUserId ? storage.getUserById(finalUserId) : null;
    const finalUsername = authenticatedUser?.username;
    const cleanContent = String(content || '').trim();
    const safeAttachments = normalizeAttachments(attachments);
    const voiceMessage = normalizeVoiceMessage(data.voiceMessage);
    const safeSpotifyInvite = normalizeSpotifyInvite(spotifyInvite);

    if (cleanContent.length > MAX_MESSAGE_LENGTH) {
      socket.emit('message:error', {
        message: `Messages can contain at most ${MAX_MESSAGE_LENGTH} characters.`,
        code: 'MESSAGE_TOO_LONG',
      });
      return;
    }

    if (Array.isArray(attachments) && attachments.length > 0 && safeAttachments.length === 0) {
      socket.emit('message:error', { message: 'The attachment URL is invalid.', code: 'INVALID_ATTACHMENT' });
      return;
    }

    if (data.voiceMessage != null && !voiceMessage) {
      socket.emit('message:error', {
        message: 'The voice message data is invalid.',
        code: 'INVALID_VOICE_MESSAGE',
      });
      return;
    }

    if (spotifyInvite != null && !safeSpotifyInvite) {
      socket.emit('message:error', {
        message: 'The Spotify listening invite is invalid.',
        code: 'INVALID_SPOTIFY_INVITE',
      });
      return;
    }

    if ((!cleanContent && safeAttachments.length === 0 && !voiceMessage) || !finalUsername || !channelId) {
      socket.emit('message:error', {
        message: 'No valid message or file was provided.',
        code: 'INVALID_MESSAGE',
      });
      return;
    }

    const access = getChannelAccess(channelId, finalUserId, 'SEND_MESSAGES');
    if (!access.allowed) {
      emitAccessError(socket, access, 'You do not have permission to send messages in this channel.');
      return;
    }

    const moderationResult = messageModerationService.inspect({
      server: access.server,
      channel: access.channel,
      userId: finalUserId,
      content: cleanContent || (safeAttachments.length ? '[attachment]' : '[voice-message]'),
    });
    if (moderationResult) {
      messageModerationService.applyViolation(io, socket, {
        server: access.server,
        channel: access.channel,
        userId: finalUserId,
        username: finalUsername,
      }, moderationResult);
      return;
    }

    if (cleanContent.startsWith('/')
      && await executeSlashCommand(io, socket, access, authenticatedUser, cleanContent)) {
      return;
    }

    const originalReply = replyTo?.id ? findMessage(channelId, String(replyTo.id)) : null;
    const safeReply = originalReply ? {
      id: originalReply.id,
      username: originalReply.username,
      content: String(originalReply.content || '').slice(0, 500),
    } : null;
    const message = await messageService.createMessage({
      username: finalUsername,
      userId: finalUserId,
      content: cleanContent,
      channelId,
      attachments: safeAttachments,
      replyTo: safeReply,
      voiceMessage,
      spotifyInvite: safeSpotifyInvite,
    });

    if (!access.server.isDM) {
      messageModerationService.markMessageAccepted(
        access.server.id,
        channelId,
        finalUserId,
        message.timestamp,
      );
      platformService.recordServerStat(access.server.id, 'messagesSent');
    }

    emitChannelUpdate(io, channelId, 'message:receive', message);
    socket.emit('message:receive', message);
    notifyRecipients(io, message, access.server, finalUserId);
    await forwardAnnouncement(io, message, access.channel);

    if (access.server.isDM) {
      access.server.dmUserIds.forEach(recipientId => {
        if (recipientId !== finalUserId) {
          const recipient = storage.getUserById(recipientId);
          const mentioned = Boolean(
            recipient?.username
            && message.content?.toLocaleLowerCase('en-US')
              .includes(`@${recipient.username}`.toLocaleLowerCase('en-US')),
          );
          if (notificationDecision(recipientId, message, access.server, mentioned).allowed) {
            io.to(`user:${recipientId}`).emit('dm:notification', { channelId, message });
          }
        }
      });
    }
  } catch (error) {
    console.error('Send messagesilirken sunucuda hata oluştu:', error);
    socket.emit('message:error', { message: 'Message could not be sent.', code: 'MESSAGE_SEND_FAILED' });
  }
};

exports.handleEdit = (io, socket, data = {}) => {
  try {
    const { messageId, content, channelId } = data;
    const userId = socket.userData?.userId;
    const cleanContent = String(content || '').trim();
    if (cleanContent.length > MAX_MESSAGE_LENGTH) {
      socket.emit('message:error', {
        message: `Messages can contain at most ${MAX_MESSAGE_LENGTH} characters.`,
        code: 'MESSAGE_TOO_LONG',
      });
      return;
    }
    const access = getChannelAccess(channelId, userId, 'SEND_MESSAGES');
    const originalMessage = findMessage(channelId, messageId);
    if (!access.allowed) {
      emitAccessError(socket, access, 'You do not have permission to edit messages in this channel.');
      return;
    }
    if (!originalMessage || originalMessage.userId !== userId) {
      socket.emit('message:error', { message: 'Editnecek mesaj not found.', code: 'MESSAGE_NOT_FOUND' });
      return;
    }
    if (!cleanContent && !(originalMessage.attachments || []).length) {
      socket.emit('message:error', { message: 'Message content cannot be empty.', code: 'INVALID_MESSAGE' });
      return;
    }

    const moderationResult = messageModerationService.inspect({
      server: access.server,
      channel: access.channel,
      userId,
      content: cleanContent,
      skipRateLimits: true,
    });
    if (moderationResult) {
      messageModerationService.applyViolation(io, socket, {
        server: access.server,
        channel: access.channel,
        userId,
        username: socket.userData?.username,
      }, moderationResult);
      return;
    }

    const updatedMessage = messageService.updateMessageWithChannel(channelId, messageId, cleanContent, userId);
    if (updatedMessage) {
      emitChannelUpdate(io, channelId, 'message:update', updatedMessage);
      if (!access.server.isDM) {
        const entry = platformService.addAuditLog(access.server.id, {
          action: 'MESSAGE_EDIT',
          actorId: userId,
          targetType: 'message',
          targetId: messageId,
          metadata: { channelId, revisionCount: updatedMessage.editHistory?.length || 0 },
        });
        emitAudit(io, access.server.id, entry);
      }
    }
  } catch (error) {
    console.error('Message düzenleme hatası:', error);
    socket.emit('message:error', { message: 'The message could not be edited.', code: 'MESSAGE_EDIT_FAILED' });
  }
};

exports.handleDelete = (io, socket, data = {}) => {
  try {
    const { messageId, channelId } = data;
    const userId = socket.userData?.userId;
    const access = getChannelAccess(channelId, userId, 'VIEW_CHANNEL');
    const originalMessage = findMessage(channelId, messageId);
    const canManage = access.server?.isDM
      || originalMessage?.userId === userId
      || getChannelAccess(channelId, userId, 'MANAGE_MESSAGES').allowed;
    if (!access.allowed || !originalMessage || !canManage) return;

    const removed = messageService.deleteMessageWithChannel(channelId, messageId, originalMessage.userId);
    if (removed) {
      emitChannelUpdate(io, channelId, 'message:delete', { messageId });
      if (!access.server.isDM) {
        const entry = platformService.addAuditLog(access.server.id, {
          action: 'MESSAGE_DELETE',
          actorId: userId,
          targetType: 'message',
          targetId: messageId,
          metadata: { channelId, authorId: originalMessage.userId },
        });
        emitAudit(io, access.server.id, entry);
      }
    }
  } catch (error) {
    console.error('Message silme hatası:', error);
  }
};

exports.handleReactionToggle = (io, socket, data = {}) => {
  try {
    const { channelId, messageId } = data;
    const emoji = String(data.emoji || '').trim();
    const userId = socket.userData?.userId;
    const access = getChannelAccess(channelId, userId, 'VIEW_CHANNEL');
    if (!access.allowed || !emoji || emoji.length > 24) return;

    const message = findMessage(channelId, messageId);
    if (!message) return;

    message.reactions = message.reactions && typeof message.reactions === 'object'
      ? message.reactions
      : {};
    const users = Array.isArray(message.reactions[emoji]) ? message.reactions[emoji] : [];
    const existingIndex = users.indexOf(userId);
    if (existingIndex === -1) users.push(userId);
    else users.splice(existingIndex, 1);

    if (users.length) message.reactions[emoji] = users;
    else delete message.reactions[emoji];
    storage.saveData?.();

    emitChannelUpdate(io, channelId, 'message:reaction:update', {
      messageId,
      reactions: message.reactions,
    });
  } catch (error) {
    console.error('Message tepkisi güncellenemedi:', error);
  }
};

exports.handlePinToggle = (io, socket, data = {}) => {
  try {
    const { channelId, messageId } = data;
    const userId = socket.userData?.userId;
    const access = getChannelAccess(channelId, userId, 'MANAGE_MESSAGES');
    if (!access.allowed) {
      socket.emit('message:error', { message: 'You do not have permission to pin messages.' });
      return;
    }

    const message = findMessage(channelId, messageId);
    if (!message) return;

    message.isPinned = !message.isPinned;
    message.pinnedBy = message.isPinned ? userId : null;
    message.pinnedAt = message.isPinned ? Date.now() : null;
    storage.saveData?.();

    emitChannelUpdate(io, channelId, 'message:pin:update', {
      messageId,
      isPinned: message.isPinned,
      pinnedBy: message.pinnedBy,
      pinnedAt: message.pinnedAt,
    });
  } catch (error) {
    console.error('Message sabitleme güncellenemedi:', error);
  }
};

exports.handleSearch = (io, socket, data = {}, callback) => {
  try {
    const { channelId } = data;
    const userId = socket.userData?.userId;
    const query = String(data.query || '').trim().toLocaleLowerCase('en-US');
    const access = getChannelAccess(channelId, userId, 'VIEW_CHANNEL');
    if (!access.allowed) return;

    const messages = query
      ? storage.getChannelMessages(channelId)
        .filter(message => `${message.username || ''} ${message.content || ''} ${(message.attachments || []).map(file => file.filename || file.name || '').join(' ')}`.toLocaleLowerCase('en-US').includes(query))
        .slice(-100)
      : [];
    const payload = { channelId, messages };
    if (typeof callback === 'function') callback(payload);
    socket.emit('message:search:results', payload);
  } catch (error) {
    console.error('Message araması başarısız:', error);
  }
};
