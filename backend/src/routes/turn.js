const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { requireAuth } = require('../middleware/auth');
const { createRateLimitOptions } = require('../middleware/rateLimit');

const router = express.Router();
const credentialsRateLimit = rateLimit(createRateLimitOptions('external', 'turn-credentials'));
const MIN_TURN_SECRET_BYTES = 32;
const MAX_TURN_SECRET_BYTES = 512;

function normalizePort(value, fallback) {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function normalizeHost(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.')) return null;
  return host;
}

function createCoturnRestCredential(secret, username) {
  // coturn TURN REST kimlik doğrulaması
  // base64(HMAC-SHA1(shared-secret, temporary-username)) biçimini zorunlu tutar.
  // Buradaki SHA-1 yalnızca yüksek entropili and süre sınırları denetlenen TURN
  // sırrıyla HMAC üretmek içindir; parola, dosya özeti veya dijital imza için
  // kullanılmaz. Algoritmayı değiştirmek coturn uyumluluğunu and sesi bozar.
  return crypto.createHmac('sha1', secret).update(username, 'utf8').digest('base64');
}

router.get('/', credentialsRateLimit, requireAuth, (req, res) => {
  const secret = Buffer.from(String(process.env.TURN_SECRET || '').trim(), 'utf8');
  const host = normalizeHost(process.env.TURN_HOST);

  if (!host || secret.length < MIN_TURN_SECRET_BYTES || secret.length > MAX_TURN_SECRET_BYTES) {
    return res.status(503).json({
      error: 'The TURN service is not configured yet.',
      code: 'TURN_NOT_CONFIGURED',
    });
  }

  const port = normalizePort(process.env.TURN_PORT, 3478);
  const requestedTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 600);
  const ttlSeconds = Number.isFinite(requestedTtl)
    ? Math.min(Math.max(Math.trunc(requestedTtl), 300), 3600)
    : 600;
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const encodedUserId = Buffer.from(String(req.user.id), 'utf8').toString('base64url').slice(0, 80);
  const username = `${expiresAtSeconds}:${encodedUserId}`;
  const credential = createCoturnRestCredential(secret, username);

  const urls = [
    `turn:${host}:${port}?transport=udp`,
    `turn:${host}:${port}?transport=tcp`,
  ];
  const tlsPort = Number(process.env.TURN_TLS_PORT || 0);
  if (Number.isInteger(tlsPort) && tlsPort > 0 && tlsPort <= 65535) {
    urls.push(`turns:${host}:${tlsPort}?transport=tcp`);
  }

  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.json({
    iceServers: [
      { urls: [`stun:${host}:${port}`] },
      { urls, username, credential },
    ],
    expiresAt: expiresAtSeconds * 1000,
  });
});

module.exports = router;
