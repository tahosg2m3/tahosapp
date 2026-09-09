const express = require('express');
const { rateLimit } = require('express-rate-limit');

const storage = require('../storage/inMemory');
const { messageService } = require('../services/messageService');
const { groupDmService } = require('../services/groupDmService');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'dm'));
const readRateLimit = rateLimit(createRateLimitOptions('read', 'dm'));
const mutationRateLimit = rateLimit(createRateLimitOptions('mutation', 'dm'));

router.use(authRateLimit, requireAuth, readRateLimit, mutationRateLimit);

router.get('/messages/:conversationId', (req, res) => {
  const conversation = storage.getServerById(req.params.conversationId);
  if (!conversation?.isDM || !conversation.dmUserIds?.includes(req.user.id)) {
    return res.status(403).json({ error: 'You do not have access to this direct message.' });
  }

  const channel = storage.getChannelsByServerId(conversation.id).find(item => item.type === 'text');
  if (!channel) return res.json([]);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  return res.json(messageService.getChannelMessages(channel.id, limit, req.query.before));
});

router.get('/:userId', (req, res) => {
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own direct messages.' });
  }
  return res.json(groupDmService.listForUser(req.user.id));
});

router.post('/create', (req, res) => {
  const targetUserId = String(req.body.userId2 || req.body.targetUserId || '').trim();
  if (!targetUserId || targetUserId === req.user.id) return res.status(400).json({ error: 'Choose a valid user.' });
  if (!storage.getUserById(targetUserId)) return res.status(404).json({ error: 'User not found.' });

  if (storage.isBlockedEitherDirection?.(req.user.id, targetUserId)) {
    return res.status(403).json({
      error: 'You cannot start a direct message with a blocked user.',
      code: 'USER_BLOCKED',
    });
  }

  const conversation = storage.getOrCreateDMConversation(req.user.id, targetUserId);
  return res.json(conversation);
});

router.post('/groups', (req, res) => {
  try {
    const conversation = groupDmService.create(req.user.id, {
      name: req.body.name,
      icon: req.body.icon,
      memberIds: req.body.memberIds,
    });
    const io = req.app.get('io');
    conversation.memberIds.forEach(userId => {
      io?.to(`user:${userId}`).emit('dm:group-created', { conversation });
    });
    return res.status(201).json(conversation);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

router.get('/groups/:conversationId', (req, res) => {
  const conversation = groupDmService.get(req.params.conversationId, req.user.id);
  if (!conversation || conversation.type !== 'group') {
    return res.status(404).json({ error: 'Group direct message not found.' });
  }
  return res.json(conversation);
});

router.patch('/groups/:conversationId', (req, res) => {
  try {
    const conversation = groupDmService.update(req.params.conversationId, req.user.id, req.body);
    if (!conversation) return res.status(403).json({ error: 'You do not have permission to edit this group.' });
    conversation.memberIds.forEach(userId => {
      req.app.get('io')?.to(`user:${userId}`).emit('dm:group-updated', { conversation });
    });
    return res.json(conversation);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/groups/:conversationId/members', (req, res) => {
  const conversation = groupDmService.addMember(
    req.params.conversationId,
    req.user.id,
    String(req.body.userId || '').trim(),
  );
  if (!conversation) return res.status(400).json({ error: 'The member could not be added; you must own the group and stay within its member limit.' });
  conversation.memberIds.forEach(userId => {
    req.app.get('io')?.to(`user:${userId}`).emit('dm:group-updated', { conversation });
  });
  return res.json(conversation);
});

router.delete('/groups/:conversationId/members/:userId', (req, res) => {
  const result = groupDmService.removeMember(req.params.conversationId, req.user.id, req.params.userId);
  if (!result) return res.status(403).json({ error: 'You do not have permission to remove this member.' });
  req.app.get('io')?.to(`user:${req.params.userId}`).emit('dm:group-removed', {
    conversationId: req.params.conversationId,
  });
  if (!result.deleted) {
    result.memberIds.forEach(userId => {
      req.app.get('io')?.to(`user:${userId}`).emit('dm:group-updated', { conversation: result });
    });
  }
  return res.json(result);
});

router.post('/groups/:conversationId/leave', (req, res) => {
  const result = groupDmService.removeMember(req.params.conversationId, req.user.id, req.user.id);
  if (!result) return res.status(404).json({ error: 'Group direct message not found.' });
  req.app.get('io')?.to(`user:${req.user.id}`).emit('dm:group-removed', {
    conversationId: req.params.conversationId,
  });
  if (!result.deleted) {
    result.memberIds.forEach(userId => {
      req.app.get('io')?.to(`user:${userId}`).emit('dm:group-updated', { conversation: result });
    });
  }
  return res.json(result);
});

module.exports = router;
