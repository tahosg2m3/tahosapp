const storage = require('../../storage/inMemory');
const { MAX_MESSAGE_LENGTH, messageService } = require('../../services/messageService');
const { platformService } = require('../../services/platformService');

// Eski dm:send event'i has güvenli geriye dönük destek. Yeni arayüz normal
// message:send + DM kanalını kullanır; burada da kimlik yalnızca socket JWT'den gelir.
exports.handleSendDM = async (io, socket, data = {}) => {
  const senderId = socket.authUser?.id;
  const sender = senderId ? storage.getUserById(senderId) : null;
  const username = sender?.username;
  const receiverId = String(data.receiverId || '');
  const content = String(data.content || '').trim();

  if (!socket.userData?.authenticated || !senderId || !username || !receiverId || !content) return;
  if (content.length > MAX_MESSAGE_LENGTH) {
    socket.emit('message:error', {
      code: 'MESSAGE_TOO_LONG',
      message: `Messages can contain at most ${MAX_MESSAGE_LENGTH} characters.`,
    });
    return;
  }
  if (receiverId === senderId || !storage.getUserById(receiverId)) return;

  if (storage.isBlockedEitherDirection(senderId, receiverId)) {
    socket.emit('message:error', {
      code: 'USER_BLOCKED',
      message: 'You cannot message a blocked user.',
    });
    return;
  }

  try {
    const conversation = storage.getOrCreateDMConversation(senderId, receiverId);
    const message = await messageService.createMessage({
      username,
      userId: senderId,
      content,
      channelId: conversation.channelId,
    });

    io.to(`channel:${conversation.channelId}`).emit('message:receive', message);
    socket.emit('message:receive', message);
    const preferences = platformService.getNotificationPreferences(receiverId);
    if (preferences.dmNotifications !== false && preferences.directMessages !== false
      && (!preferences.mutedUntil || Number(preferences.mutedUntil) <= Date.now())) {
      io.to(`user:${receiverId}`).emit('dm:notification', { channelId: conversation.channelId, message });
    }
    io.to(`user:${receiverId}`).emit('dm:receive', { conversationId: conversation.id, message });
  } catch (error) {
    console.error('Could not send the direct message:', error.message);
    socket.emit('message:error', { message: 'The direct message could not be sent.' });
  }
};
