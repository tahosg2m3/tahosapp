const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');
const { spotifyService } = require('../services/spotifyService');

const router = express.Router();
const spotifyRateLimit = rateLimit(createRateLimitOptions('api', 'spotify'));

function errorResponse(res, error) {
  return res.status(Number(error.status) || 400).json({
    error: error.message || 'Spotify request failed.',
    code: error.code || 'SPOTIFY_REQUEST_FAILED',
  });
}

function callbackPage({ success, message }) {
  const title = success ? 'Spotify connected' : 'Spotify connection failed';
  const accent = success ? '#1ed760' : '#f23f42';
  const safeMessage = String(message || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f8fafc;font:16px/1.5 system-ui,sans-serif}.card{max-width:34rem;margin:2rem;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#1e293b;box-shadow:0 24px 60px #0008}.mark{color:${accent};font-size:2rem;font-weight:900}h1{margin:.5rem 0}p{color:#cbd5e1}button{border:0;border-radius:.5rem;background:${accent};color:#07130b;padding:.75rem 1rem;font-weight:800;cursor:pointer}</style></head><body><main class="card"><div class="mark">●</div><h1>${title}</h1><p>${safeMessage}</p><button onclick="window.close()">Close this window</button></main></body></html>`;
}

router.get('/callback', spotifyRateLimit, async (req, res) => {
  try {
    await spotifyService.completeAuthorization(req.query || {});
    return res.type('html').send(callbackPage({
      success: true,
      message: 'Your Spotify account is connected to tahosapp. You can return to the app and refresh the connection status.',
    }));
  } catch (error) {
    return res.status(Number(error.status) || 400).type('html').send(callbackPage({
      success: false,
      message: error.message || 'The Spotify connection could not be completed.',
    }));
  }
});

router.use(spotifyRateLimit, requireAuth);

router.get('/status', (req, res) => res.json(spotifyService.status(req.user.id)));

router.post('/connect', (req, res) => {
  try {
    return res.json(spotifyService.createAuthorization(req.user.id));
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.delete('/connection', (req, res) => res.json({
  success: true,
  removed: spotifyService.disconnect(req.user.id),
  ...spotifyService.status(req.user.id),
}));

router.get('/currently-playing', async (req, res) => {
  try {
    return res.json(await spotifyService.currentlyPlaying(req.user.id));
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/invite', async (req, res) => {
  try {
    return res.json(await spotifyService.inviteFromUrl(req.body?.url));
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.put('/play', async (req, res) => {
  try {
    return res.json(await spotifyService.startInvite(req.user.id, req.body?.invite || req.body));
  } catch (error) {
    return errorResponse(res, error);
  }
});

module.exports = router;
