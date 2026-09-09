const { randomUUID } = require('crypto');
const storage = require('../../storage/inMemory');

const RING_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const START_COOLDOWN_MS = 3_000;
const activeCalls = new Map();
const userCallIds = new Map();
const lastCallStartAt = new Map();

function sameId(first, second) {
  return String(first || '') === String(second || '');
}

function reply(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    presenceStatus: user.presenceStatus || user.status || 'offline',
  };
}

function publicCall(call) {
  return {
    id: call.id,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    caller: publicUser(storage.getUserById(call.callerId)),
    callee: publicUser(storage.getUserById(call.calleeId)),
    status: call.status,
    createdAt: call.createdAt,
    expiresAt: call.expiresAt,
  };
}

function clearCall(call) {
  if (!call) return;
  if (call.timeout) clearTimeout(call.timeout);
  activeCalls.delete(call.id);
  if (userCallIds.get(call.callerId) === call.id) userCallIds.delete(call.callerId);
  if (userCallIds.get(call.calleeId) === call.id) userCallIds.delete(call.calleeId);
}

function finishCall(io, call, eventName, details = {}) {
  if (!call || !activeCalls.has(call.id)) return;
  clearCall(call);
  const payload = { call: publicCall(call), callId: call.id, ...details };
  io.to(`user:${call.callerId}`).emit(eventName, payload);
  io.to(`user:${call.calleeId}`).emit(eventName, payload);
}

function getCallForUser(callId, userId) {
  const call = activeCalls.get(String(callId || ''));
  if (!call || (!sameId(call.callerId, userId) && !sameId(call.calleeId, userId))) return null;
  return call;
}

function validateDirectConversation(conversationId, callerId, targetUserId) {
  const conversation = storage.getServerById(String(conversationId || ''));
  if (!conversation?.isDM || conversation.isGroupDM) return null;
  if (!Array.isArray(conversation.dmUserIds) || conversation.dmUserIds.length !== 2) return null;
  if (!conversation.dmUserIds.some(id => sameId(id, callerId))) return null;
  if (!conversation.dmUserIds.some(id => sameId(id, targetUserId))) return null;
  return conversation;
}

function isPeerIdValid(peerId) {
  return /^[A-Za-z0-9_-]{1,255}$/.test(String(peerId || ''));
}

module.exports = function registerCallHandlers(io, socket) {
  const authenticatedUserId = () => socket.userData?.authenticated && socket.userData?.userId;

  socket.on('call:start', (data = {}, callback) => {
    const callerId = authenticatedUserId();
    const targetUserId = String(data.targetUserId || '');
    if (!callerId || !targetUserId || sameId(callerId, targetUserId)) {
      reply(callback, { success: false, error: 'Invalid call request.' });
      return;
    }

    const now = Date.now();
    const retryAfterMs = Math.max(0, START_COOLDOWN_MS - (now - (lastCallStartAt.get(callerId) || 0)));
    if (retryAfterMs > 0) {
      reply(callback, { success: false, error: 'Wait a moment before starting another call.', retryAfterMs });
      return;
    }
    lastCallStartAt.set(callerId, now);

    const targetUser = storage.getUserById(targetUserId);
    const conversation = validateDirectConversation(data.conversationId, callerId, targetUserId);
    if (!targetUser || !conversation || storage.isBlockedEitherDirection(callerId, targetUserId)) {
      reply(callback, { success: false, error: 'This user could not be called.' });
      return;
    }
    if (userCallIds.has(callerId) || userCallIds.has(targetUserId)) {
      reply(callback, { success: false, error: 'One of the users is already in another call.' });
      return;
    }
    if (!(io.sockets.adapter.rooms.get(`user:${targetUserId}`)?.size > 0)) {
      reply(callback, { success: false, error: 'The user is currently offline.' });
      return;
    }

    const call = {
      id: randomUUID(),
      conversationId: conversation.id,
      callerId: String(callerId),
      calleeId: targetUserId,
      callerSocketId: socket.id,
      acceptedSocketId: null,
      status: 'ringing',
      createdAt: now,
      expiresAt: now + RING_TIMEOUT_MS,
      timeout: null,
    };
    activeCalls.set(call.id, call);
    userCallIds.set(call.callerId, call.id);
    userCallIds.set(call.calleeId, call.id);
    call.timeout = setTimeout(() => finishCall(io, call, 'call:timeout', { reason: 'timeout' }), RING_TIMEOUT_MS);
    call.timeout.unref?.();

    const payload = { call: publicCall(call) };
    io.to(`user:${call.calleeId}`).emit('call:incoming', payload);
    reply(callback, { success: true, ...payload });
  });

  socket.on('call:accept', (data = {}, callback) => {
    const userId = authenticatedUserId();
    const call = getCallForUser(data.callId, userId);
    const peerId = String(data.peerId || '');
    if (!call || !sameId(call.calleeId, userId) || call.status !== 'ringing' || !isPeerIdValid(peerId)) {
      reply(callback, { success: false, error: 'This call can no longer be accepted.' });
      return;
    }

    if (call.timeout) clearTimeout(call.timeout);
    call.timeout = null;
    call.status = 'connecting';
    call.calleePeerId = peerId;
    call.acceptedSocketId = socket.id;
    call.timeout = setTimeout(() => finishCall(io, call, 'call:ended', { reason: 'connection-timeout' }), CONNECT_TIMEOUT_MS);
    call.timeout.unref?.();
    const payload = {
      call: publicCall(call),
      callId: call.id,
      calleePeerId: peerId,
      acceptedSocketId: socket.id,
    };
    io.to(`user:${call.callerId}`).emit('call:accepted', payload);
    io.to(`user:${call.calleeId}`).emit('call:accepted', payload);
    reply(callback, { success: true, ...payload });
  });

  socket.on('call:connected', (data = {}, callback) => {
    const userId = authenticatedUserId();
    const call = getCallForUser(data.callId, userId);
    if (!call || call.status !== 'connecting') {
      reply(callback, { success: false, error: 'This call can no longer be connected.' });
      return;
    }
    if (call.timeout) clearTimeout(call.timeout);
    call.timeout = null;
    call.status = 'active';
    reply(callback, { success: true, call: publicCall(call) });
  });

  socket.on('call:reject', (data = {}, callback) => {
    const userId = authenticatedUserId();
    const call = getCallForUser(data.callId, userId);
    if (!call || !sameId(call.calleeId, userId) || call.status !== 'ringing') {
      reply(callback, { success: false, error: 'This call can no longer be declined.' });
      return;
    }
    finishCall(io, call, 'call:rejected', { reason: 'rejected' });
    reply(callback, { success: true });
  });

  socket.on('call:cancel', (data = {}, callback) => {
    const userId = authenticatedUserId();
    const call = getCallForUser(data.callId, userId);
    if (!call || !sameId(call.callerId, userId) || call.status !== 'ringing') {
      reply(callback, { success: false, error: 'This call can no longer be canceled.' });
      return;
    }
    finishCall(io, call, 'call:cancelled', { reason: 'cancelled' });
    reply(callback, { success: true });
  });

  socket.on('call:end', (data = {}, callback) => {
    const userId = authenticatedUserId();
    const call = getCallForUser(data.callId, userId);
    if (!call) {
      reply(callback, { success: true });
      return;
    }
    finishCall(io, call, 'call:ended', { reason: String(data.reason || 'ended').slice(0, 32) });
    reply(callback, { success: true });
  });

  socket.on('disconnect', () => {
    const userId = socket.userData?.userId;
    const call = getCallForUser(userCallIds.get(userId), userId);
    if (!call) return;
    if (call.status === 'ringing' && sameId(call.callerSocketId, socket.id)) {
      finishCall(io, call, 'call:cancelled', { reason: 'caller-disconnected' });
    } else if (call.status === 'ringing'
      && sameId(call.calleeId, userId)
      && !(io.sockets.adapter.rooms.get(`user:${call.calleeId}`)?.size > 0)) {
      finishCall(io, call, 'call:cancelled', { reason: 'callee-disconnected' });
    } else if (call.status !== 'ringing'
      && (sameId(call.callerSocketId, socket.id) || sameId(call.acceptedSocketId, socket.id))) {
      finishCall(io, call, 'call:ended', { reason: 'disconnected' });
    }
  });
};
