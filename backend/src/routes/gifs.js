const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');

const router = express.Router();
const authRateLimit = rateLimit(createRateLimitOptions('auth', 'gifs'));
const externalRateLimit = rateLimit(createRateLimitOptions('external', 'gifs'));
const GIPHY_API_ROOT = 'https://api.giphy.com/v1/gifs';

function safeImageUrl(value) {
  const normalized = String(value || '').trim();
  return /^https:\/\//i.test(normalized) ? normalized.slice(0, 2048) : null;
}

function normalizeGif(item) {
  const images = item?.images || {};
  const original = safeImageUrl(images.original?.url || images.downsized_large?.url || images.downsized?.url);
  if (!item?.id || !original) return null;
  return {
    id: String(item.id),
    title: String(item.title || 'GIF').trim().slice(0, 200) || 'GIF',
    url: original,
    previewUrl: safeImageUrl(images.fixed_width_small?.webp || images.fixed_width_small?.url || images.preview_gif?.url || images.downsized?.url) || original,
    width: Number(images.original?.width) || null,
    height: Number(images.original?.height) || null,
    source: 'giphy',
  };
}

router.use(authRateLimit, requireAuth);

router.get('/', externalRateLimit, async (req, res) => {
  const apiKey = String(process.env.GIPHY_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'GIPHY is not configured. Add GIPHY_API_KEY to backend/.env.',
      code: 'GIPHY_NOT_CONFIGURED',
    });
  }

  const query = String(req.query.query || '').trim().slice(0, 100);
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 30) : 24;
  const endpoint = query ? 'search' : 'trending';
  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(limit),
    rating: 'pg-13',
    lang: 'tr',
    bundle: 'messaging_non_clips',
  });
  if (query) params.set('q', query);

  try {
    const response = await fetch(`${GIPHY_API_ROOT}/${endpoint}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return res.status(502).json({ error: `GIPHY request failed (${response.status}).` });
    const payload = await response.json();
    const gifs = (Array.isArray(payload?.data) ? payload.data : []).map(normalizeGif).filter(Boolean);
    return res.json({ gifs, pagination: payload?.pagination || null, source: 'giphy' });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(502).json({
      error: timedOut ? 'GIPHY timed out. Try again.' : 'Could not connect to GIPHY. Check your internet connection.',
    });
  }
});

module.exports = router;
