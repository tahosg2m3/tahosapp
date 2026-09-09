const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { getBearerToken, verifyAuthToken } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { richPresenceService } = require('../services/richPresenceService');

const router = express.Router();
const requestRateLimit = rateLimit(createRateLimitOptions('webhook', 'rich-presence'));

function presenceToken(req) {
  const explicitToken = req.get('X-Presence-Token');
  if (explicitToken) return explicitToken;
  const authorization = String(req.headers.authorization || '').trim();
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (['Presence', 'RichPresence'].includes(scheme) && token) return token;
  const bearer = getBearerToken(authorization);
  return bearer?.startsWith('tpr_') ? bearer : null;
}

function requirePresenceAuth(req, res, next) {
  const bearer = getBearerToken(req.headers.authorization);
  if (bearer && !bearer.startsWith('tpr_')) {
    try {
      const { user } = verifyAuthToken(bearer);
      req.user = user;
      req.presenceAuth = 'session';
      return next();
    } catch (_) {
      // Aynı genel hata aşağıda döndürülür; token türü hakkında bilgi sızdırılmaz.
    }
  }

  const user = richPresenceService.authenticateToken(presenceToken(req));
  if (!user) return res.status(401).json({ error: 'The Rich Presence integration key is invalid.' });
  req.user = user;
  req.presenceAuth = 'integration';
  return next();
}

router.use(requestRateLimit, requirePresenceAuth);

router.get('/', (req, res) => res.json(richPresenceService.getManagementState(req.user.id)));

router.put('/', (req, res) => {
  try {
    const activity = richPresenceService.setActivity(req.user.id, req.body || {});
    return res.json({ activity, activities: richPresenceService.getActivities(req.user.id, { includeHidden: true }) });
  } catch (error) {
    return res.status(error.code === 'RICH_PRESENCE_DISABLED' ? 403 : 400).json({
      error: error.message || 'Activity could not be updated.',
      code: error.code || 'INVALID_RICH_PRESENCE',
    });
  }
});

router.post('/heartbeat', (req, res) => {
  const sessionId = String(req.body?.sessionId || 'primary');
  const activity = richPresenceService.heartbeat(req.user.id, sessionId, req.body?.ttlSeconds);
  if (!activity) return res.status(404).json({ error: 'Activelik oturumu not found.' });
  return res.json({ activity });
});

router.delete('/:sessionId', (req, res) => {
  const removed = richPresenceService.clear(req.user.id, req.params.sessionId);
  return res.json({ success: true, removed, activities: richPresenceService.getActivities(req.user.id, { includeHidden: true }) });
});

router.delete('/', (req, res) => {
  const removed = richPresenceService.clearAll(req.user.id);
  return res.json({ success: true, removed, activities: [] });
});

module.exports = router;
