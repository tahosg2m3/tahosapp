const express = require('express');
const { rateLimit } = require('express-rate-limit');
const storage = require('../storage/inMemory');
const { createRateLimitOptions } = require('../middleware/rateLimit');

const router = express.Router();
const feedbackRateLimit = rateLimit(createRateLimitOptions('feedback', 'uninstall-feedback'));
const ALLOWED_REASONS = new Set([
  'technical_problem',
  'performance',
  'missing_features',
  'not_using',
  'privacy',
  'reinstalling',
  'other',
]);

router.post('/uninstall', feedbackRateLimit, (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const version = typeof req.body?.version === 'string' ? req.body.version.trim() : '';

  if (!ALLOWED_REASONS.has(reason) || !/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/.test(version)) {
    return res.status(400).json({ error: 'Invalid feedback.' });
  }

  // Only aggregate counts are persisted in the encrypted application state.
  // No account, note, machine identifier or client IP is stored.
  storage.recordUninstallFeedback(reason, version);
  return res.status(204).end();
});

module.exports = router;
