const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { richPresenceService } = require('../services/richPresenceService');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'friends'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'friends'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'friends'));

function emitFriendUpdate(req, userId) {
  req.app.get('io')?.to(`user:${userId}`).emit('friends:changed', { userId });
}

router.use(authRateLimit, requireAuth, readRateLimit, mutationRateLimit);

router.get('/:userId/pending', (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'You do not have access to these requests.' });
  return res.json(storage.getPendingRequests(req.user.id));
});

router.get('/:userId', (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'You do not have access to this friends list.' });
  return res.json(storage.getUserFriends(req.user.id).map(friend => ({
    ...friend,
    activities: richPresenceService.getActivities(friend.id),
  })));
});

router.post('/request', (req, res) => {
  const targetUsername = String(req.body.targetUsername || '').trim();
  const targetUserId = String(req.body.toUserId || '').trim();
  const targetUser = targetUserId
    ? storage.getUserById(targetUserId)
    : storage.findUserByUsername(targetUsername);

  if (!targetUser) return res.status(404).json({ error: 'User not found.' });
  if (targetUser.id === req.user.id) return res.status(400).json({ error: 'You cannot send a friend request to yourself.' });

  const request = storage.sendFriendRequest(req.user.id, targetUser.id);
  if (!request) return res.status(400).json({ error: 'The request was already sent or you are already friends.' });

  req.app.get('io')?.to(`user:${targetUser.id}`).emit('friend:request', {
    request: { ...request, fromUser: storage.getPublicUserById(req.user.id) },
  });
  return res.status(201).json(request);
});

router.post('/accept', (req, res) => {
  const request = storage.friendRequests.find(item => item.id === req.body.requestId);
  if (!request || request.toUserId !== req.user.id || request.status !== 'pending') {
    return res.status(400).json({ error: 'Friend request not found.' });
  }

  if (!storage.acceptFriendRequest(request.id)) {
    return res.status(400).json({ error: 'The friend request can no longer be accepted.' });
  }
  const conversation = storage.getOrCreateDMConversation(request.fromUserId, request.toUserId);
  emitFriendUpdate(req, request.fromUserId);
  emitFriendUpdate(req, request.toUserId);
  req.app.get('io')?.to(`user:${request.fromUserId}`).emit('dm:created', {
    conversationId: conversation.id,
  });
  req.app.get('io')?.to(`user:${request.toUserId}`).emit('dm:created', {
    conversationId: conversation.id,
  });
  return res.json({ message: 'Friend request accepted.' });
});

router.post('/reject', (req, res) => {
  const request = storage.friendRequests.find(item => item.id === req.body.requestId);
  if (!request || request.toUserId !== req.user.id || request.status !== 'pending') {
    return res.status(400).json({ error: 'Friend request not found.' });
  }

  storage.rejectFriendRequest(request.id);
  emitFriendUpdate(req, req.user.id);
  return res.json({ message: 'Friend request declined.' });
});

router.delete('/:userId/:friendId', (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'You cannot change this friendship.' });
  storage.removeFriend(req.user.id, req.params.friendId);
  emitFriendUpdate(req, req.user.id);
  emitFriendUpdate(req, req.params.friendId);
  return res.json({ success: true });
});

module.exports = router;
