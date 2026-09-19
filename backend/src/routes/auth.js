const express = require('express');
const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage/inMemory');
const { createSession, ensureHubState } = require('../services/communityHubService');
const {
  sendTwoFactorCode,
  sendPasswordResetCode,
  sendEmailChangeCode,
} = require('../services/emailService');
const {
  hashPassword,
  isPasswordWorkQueueError,
  verifyPassword,
} = require('../services/passwordService');
const { requireAuth, signAuthToken } = require('../middleware/auth');
const { isPlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();

const pendingTwoFactorLogins = new Map();
const pendingPasswordResets = new Map();
const pendingEmailChanges = new Map();
const pendingSocialStates = new Map();
const pendingSocialTickets = new Map();
const authRateLimitEntries = new Map();

const CODE_EXPIRES_IN_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const SOCIAL_STATE_TTL_MS = 10 * 60 * 1000;
const SOCIAL_TICKET_TTL_MS = 2 * 60 * 1000;
const SOCIAL_PASSWORD_SETUP_WINDOW_MS = 15 * 60 * 1000;
const SOCIAL_PROVIDERS = Object.freeze({
  google: Object.freeze({
    label: 'Google',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid profile email',
  }),
  discord: Object.freeze({
    label: 'Discord',
    clientIdEnv: 'DISCORD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DISCORD_OAUTH_CLIENT_SECRET',
    authorizationUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
  }),
});
// Kodlar kısa and tek useslı olduğundan Argon2 ile parola gibi işlenmez.
// Süreç belleğinde kalan rastgele HMAC anahtarı, Map içindeki özetlerin çevrimdışı
// 000000-999999 taramasına karşı doğrudan SHA-256'dan daha güvenli olmasını sağlar.
// Uygulama yeniden başladığında bekleyen oturumlar zaten bellekten silinir.
const CODE_HASH_KEY = crypto.randomBytes(32);
const RATE_LIMIT_HASH_KEY = crypto.randomBytes(32);
// Public, non-secret Argon2id sentinel. Unknown-account logins verify against
// this hash so response timing does not reveal whether an e-mail exists.
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,p=1,t=3$Q9clpdqQzK5znLvxYe1zzg$+y38aOiYvmC5pbq8Ze7riuzMneX0c0kSd0eY32o6Qk8';

function cleanupExpiredSecurityState(now = Date.now()) {
  [pendingTwoFactorLogins, pendingPasswordResets, pendingEmailChanges].forEach(map => {
    for (const [key, pending] of map.entries()) {
      if (!pending || now > pending.expiresAt) map.delete(key);
    }
  });

  for (const [key, entry] of authRateLimitEntries.entries()) {
    if (!entry || now >= entry.expiresAt) authRateLimitEntries.delete(key);
  }
  for (const [key, entry] of pendingSocialStates.entries()) {
    if (!entry || now >= entry.expiresAt) pendingSocialStates.delete(key);
  }
  for (const [key, entry] of pendingSocialTickets.entries()) {
    if (!entry || now >= entry.expiresAt) pendingSocialTickets.delete(key);
  }
}

const securityCleanupTimer = setInterval(
  cleanupExpiredSecurityState,
  RATE_LIMIT_CLEANUP_INTERVAL_MS,
);
securityCleanupTimer.unref?.();

function rateLimitSubject(value) {
  const normalized = String(value ?? '').trim().toLowerCase().slice(0, 256);
  return normalized || '<empty>';
}

function rateLimitKey(scope, kind, value) {
  return crypto.createHmac('sha256', RATE_LIMIT_HASH_KEY)
    .update(`${scope}:${kind}:${rateLimitSubject(value)}`)
    .digest('hex');
}

function requestRemoteAddress(req) {
  // Express yalnız loopback reverse proxy'ye güvenecek şekilde yapılandırılır.
  // Bu nedenle req.ip, Caddy/Cloudflare arkasındaki gerçek istemciyi verirken
  // doğrudan internete gönderilmiş sahte X-Forwarded-For başlıklarını reddeder.
  const address = req.ip || req.socket?.remoteAddress || 'unknown';
  return address === 'unknown' ? address : ipKeyGenerator(address);
}

class BoundedAuthRateLimitStore {
  constructor({ windowMs, limit }) {
    this.windowMs = windowMs;
    this.limit = limit;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  increment(key) {
    const now = Date.now();
    let entry = authRateLimitEntries.get(key);

    if (entry && now >= entry.expiresAt) {
      authRateLimitEntries.delete(key);
      entry = null;
    }

    if (!entry && authRateLimitEntries.size >= MAX_RATE_LIMIT_ENTRIES) {
      cleanupExpiredSecurityState(now);
      entry = authRateLimitEntries.get(key);
      if (!entry && authRateLimitEntries.size >= MAX_RATE_LIMIT_ENTRIES) {
        return {
          totalHits: this.limit + 1,
          resetTime: new Date(now + 60 * 1000),
        };
      }
    }

    if (entry) {
      entry.count += 1;
    } else {
      entry = { count: 1, expiresAt: now + this.windowMs };
      authRateLimitEntries.set(key, entry);
    }

    return { totalHits: entry.count, resetTime: new Date(entry.expiresAt) };
  }

  decrement(key) {
    const entry = authRateLimitEntries.get(key);
    if (!entry) return;
    entry.count = Math.max(0, entry.count - 1);
    if (entry.count === 0) authRateLimitEntries.delete(key);
  }

  resetKey(key) {
    authRateLimitEntries.delete(key);
  }
}

function rejectRateLimitedRequest(req, res) {
  const resetAt = req.rateLimit?.resetTime instanceof Date
    ? req.rateLimit.resetTime.getTime()
    : Date.now() + 60 * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    error: 'Too many attempts. Please wait and try again.',
  });
}

function authRateLimitOptions({ scope, kind, windowMs, limit, subject }) {
  return {
    windowMs,
    limit,
    legacyHeaders: false,
    standardHeaders: false,
    keyGenerator: req => rateLimitKey(scope, kind, subject(req)),
    store: new BoundedAuthRateLimitStore({ windowMs, limit }),
    handler: rejectRateLimitedRequest,
  };
}

const rateLimits = Object.freeze({
  registerIp: rateLimit(authRateLimitOptions({
    scope: 'register', kind: 'ip', windowMs: 60 * 60 * 1000, limit: 12,
    subject: requestRemoteAddress,
  })),
  registerAccount: rateLimit(authRateLimitOptions({
    scope: 'register', kind: 'account', windowMs: 60 * 60 * 1000, limit: 5,
    subject: req => normalizeEmail(req.body?.email),
  })),
  loginIp: rateLimit(authRateLimitOptions({
    scope: 'login', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 30,
    subject: requestRemoteAddress,
  })),
  loginAccount: rateLimit(authRateLimitOptions({
    scope: 'login', kind: 'account', windowMs: 15 * 60 * 1000, limit: 10,
    subject: req => normalizeEmail(req.body?.email),
  })),
  verifyTwoFactorIp: rateLimit(authRateLimitOptions({
    scope: 'verify-2fa', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 40,
    subject: requestRemoteAddress,
  })),
  verifyTwoFactorAccount: rateLimit(authRateLimitOptions({
    scope: 'verify-2fa', kind: 'account', windowMs: 15 * 60 * 1000, limit: 8,
    subject: req => req.body?.loginTicket,
  })),
  resendTwoFactorIp: rateLimit(authRateLimitOptions({
    scope: 'resend-2fa', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  resendTwoFactorAccount: rateLimit(authRateLimitOptions({
    scope: 'resend-2fa', kind: 'account', windowMs: 15 * 60 * 1000, limit: 5,
    subject: req => req.body?.loginTicket,
  })),
  requestPasswordResetIp: rateLimit(authRateLimitOptions({
    scope: 'request-password-reset', kind: 'ip', windowMs: 60 * 60 * 1000, limit: 12,
    subject: requestRemoteAddress,
  })),
  requestPasswordResetAccount: rateLimit(authRateLimitOptions({
    scope: 'request-password-reset', kind: 'account', windowMs: 60 * 60 * 1000, limit: 5,
    subject: req => normalizeEmail(req.body?.email),
  })),
  resendPasswordResetIp: rateLimit(authRateLimitOptions({
    scope: 'resend-password-reset', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  resendPasswordResetAccount: rateLimit(authRateLimitOptions({
    scope: 'resend-password-reset', kind: 'account', windowMs: 15 * 60 * 1000, limit: 5,
    subject: req => req.body?.resetTicket,
  })),
  resetPasswordIp: rateLimit(authRateLimitOptions({
    scope: 'reset-password', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  resetPasswordAccount: rateLimit(authRateLimitOptions({
    scope: 'reset-password', kind: 'account', windowMs: 15 * 60 * 1000, limit: 8,
    subject: req => req.body?.resetTicket,
  })),
  changePasswordIp: rateLimit(authRateLimitOptions({
    scope: 'change-password', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  changePasswordAccount: rateLimit(authRateLimitOptions({
    scope: 'change-password', kind: 'account', windowMs: 15 * 60 * 1000, limit: 8,
    subject: req => req.user?.id,
  })),
  socialStartIp: rateLimit(authRateLimitOptions({
    scope: 'social-start', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 30,
    subject: requestRemoteAddress,
  })),
  socialExchangeIp: rateLimit(authRateLimitOptions({
    scope: 'social-exchange', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 40,
    subject: requestRemoteAddress,
  })),
  socialCallbackIp: rateLimit(authRateLimitOptions({
    scope: 'social-callback', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 60,
    subject: requestRemoteAddress,
  })),
  requestEmailChangeIp: rateLimit(authRateLimitOptions({
    scope: 'request-email-change', kind: 'ip', windowMs: 60 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  requestEmailChangeAccount: rateLimit(authRateLimitOptions({
    scope: 'request-email-change', kind: 'account', windowMs: 60 * 60 * 1000, limit: 6,
    subject: req => req.user?.id,
  })),
  resendEmailChangeIp: rateLimit(authRateLimitOptions({
    scope: 'resend-email-change', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 20,
    subject: requestRemoteAddress,
  })),
  resendEmailChangeAccount: rateLimit(authRateLimitOptions({
    scope: 'resend-email-change', kind: 'account', windowMs: 15 * 60 * 1000, limit: 5,
    subject: req => req.body?.emailChangeTicket,
  })),
  confirmEmailChangeIp: rateLimit(authRateLimitOptions({
    scope: 'confirm-email-change', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 30,
    subject: requestRemoteAddress,
  })),
  confirmEmailChangeAccount: rateLimit(authRateLimitOptions({
    scope: 'confirm-email-change', kind: 'account', windowMs: 15 * 60 * 1000, limit: 8,
    subject: req => req.body?.emailChangeTicket,
  })),
  verifySessionIp: rateLimit(authRateLimitOptions({
    scope: 'verify-session', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 300,
    subject: requestRemoteAddress,
  })),
  verifySessionAccount: rateLimit(authRateLimitOptions({
    scope: 'verify-session', kind: 'account', windowMs: 15 * 60 * 1000, limit: 180,
    subject: req => req.user?.id,
  })),
  readProfileIp: rateLimit(authRateLimitOptions({
    scope: 'read-profile', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 600,
    subject: requestRemoteAddress,
  })),
  readProfileAccount: rateLimit(authRateLimitOptions({
    scope: 'read-profile', kind: 'account', windowMs: 15 * 60 * 1000, limit: 300,
    subject: req => req.user?.id,
  })),
  updateProfileIp: rateLimit(authRateLimitOptions({
    scope: 'update-profile', kind: 'ip', windowMs: 15 * 60 * 1000, limit: 60,
    subject: requestRemoteAddress,
  })),
  updateProfileAccount: rateLimit(authRateLimitOptions({
    scope: 'update-profile', kind: 'account', windowMs: 15 * 60 * 1000, limit: 30,
    subject: req => req.user?.id,
  })),
});

function publicUser(user) {
  const { password, tokenVersion, platformRole, platformBan, platformBanClearedAt, platformBanClearedBy, ...safeUser } = user;
  return { ...safeUser, isPlatformAdmin: isPlatformAdmin(user) };
}

function publicProfile(user) {
  const { password, email, tokenVersion, platformRole, platformBan, platformBanClearedAt, platformBanClearedBy, ...safeUser } = user;
  if (safeUser.presenceStatus === 'invisible') safeUser.presenceStatus = 'offline';
  return safeUser;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createSixDigitCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashCode(code) {
  return crypto.createHmac('sha256', CODE_HASH_KEY).update(String(code)).digest('hex');
}

function isCodeCorrect(receivedCode, storedCodeHash) {
  const receivedHash = Buffer.from(hashCode(receivedCode), 'hex');
  const storedHash = Buffer.from(storedCodeHash, 'hex');

  return receivedHash.length === storedHash.length
    && crypto.timingSafeEqual(receivedHash, storedHash);
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

function isValidEmail(value) {
  if (typeof value !== 'string' || value.length < 5 || value.length > 254 || /\s/u.test(value)) {
    return false;
  }

  const atIndex = value.indexOf('@');
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) return false;

  const finalDotIndex = value.lastIndexOf('.');
  return finalDotIndex > atIndex + 1 && finalDotIndex < value.length - 1;
}

function emailDeliveryErrorMessage(error, fallback) {
  return error?.code === 'SMTP_CONFIG_ERROR' ? error.message : fallback;
}

function passwordWorkBusyResponse(error, res) {
  if (!isPasswordWorkQueueError(error)) return null;
  res.set('Retry-After', '2');
  return res.status(503).json({
    error: 'The secure password service is busy. Please try again shortly.',
  });
}

function findUserByEmail(email) {
  return storage.getUserByEmail(normalizeEmail(email));
}

async function checkPasswordAndMigrate(user, password) {
  if (!user || typeof password !== 'string') return false;

  const result = await verifyPassword(password, user.password);
  if (!result.valid) return false;

  // Bcrypt, eski Argon2 parametreleri and çok eski düz text kayıtları başarılı
  // doğrulamanın hemen ardından Argon2id'e taşınır. User henüz yeni bir
  // oturum almadığı has mevcut tokenVersion değiştirilmez.
  if (result.needsRehash) {
    storage.updateUserPassword(user.id, await hashPassword(password), {
      invalidateSessions: false,
    });
  }

  return true;
}

function createPendingCode(map, userId, extra = {}) {
  const code = createSixDigitCode();
  const ticket = uuidv4();
  map.set(ticket, {
    userId,
    codeHash: hashCode(code),
    expiresAt: Date.now() + CODE_EXPIRES_IN_MS,
    lastSentAt: Date.now(),
    attempts: 0,
    ...extra,
  });
  return { ticket, code };
}

function createDecoyPasswordReset(ticket = uuidv4()) {
  const now = Date.now();
  pendingPasswordResets.set(ticket, {
    userId: null,
    decoy: true,
    // Gerçek bir kod üretilmez veya gönderilmez. Rastgele özet, tahmin edilen
    // hiçbir altı haneli kodla pratikte eşleşmez.
    codeHash: crypto.randomBytes(32).toString('hex'),
    expiresAt: now + CODE_EXPIRES_IN_MS,
    lastSentAt: now,
    attempts: 0,
  });
  return ticket;
}

function findPendingRegistration({ username, email }) {
  for (const [ticket, pending] of pendingTwoFactorLogins.entries()) {
    if (Date.now() > pending.expiresAt) {
      pendingTwoFactorLogins.delete(ticket);
      continue;
    }

    const registration = pending.registration;
    if (!registration) continue;

    if (
      registration.email === email
      || registration.username.toLowerCase() === username.toLowerCase()
    ) {
      return { ticket, pending };
    }
  }

  return null;
}

function validatePendingCode(map, ticket, code) {
  const pending = map.get(ticket);
  if (!pending) return { error: 'Verification session not found. Try again.', status: 400 };

  if (Date.now() > pending.expiresAt) {
    map.delete(ticket);
    return { error: 'The code expired. Start the process again.', status: 400 };
  }

  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    map.delete(ticket);
    return { error: 'Too many incorrect attempts. Start the process again.', status: 429 };
  }

  if (!/^\d{6}$/.test(code) || !isCodeCorrect(code, pending.codeHash)) {
    pending.attempts += 1;
    return {
      error: `Incorrect code. Attempts remaining: ${Math.max(0, MAX_CODE_ATTEMPTS - pending.attempts)}`,
      status: 400,
    };
  }

  return { pending };
}

async function sendLoginCode(user) {
  const { ticket, code } = createPendingCode(pendingTwoFactorLogins, user.id);
  try {
    await sendTwoFactorCode(user.email, user.username, code);
    return ticket;
  } catch (error) {
    pendingTwoFactorLogins.delete(ticket);
    throw error;
  }
}

async function sendRegistrationCode({ username, email, passwordHash }) {
  const existing = findPendingRegistration({ username, email });
  if (existing) {
    const registration = existing.pending.registration;
    if (registration.email === email && registration.username.toLowerCase() === username.toLowerCase()) {
      return { ticket: existing.ticket, reused: true };
    }

    const error = new Error('A pending verification already exists for this username or email address.');
    error.code = 'PENDING_REGISTRATION_EXISTS';
    throw error;
  }

  const { ticket, code } = createPendingCode(pendingTwoFactorLogins, null, {
    registration: { username, email, passwordHash },
  });

  try {
    await sendTwoFactorCode(email, username, code);
    return { ticket, reused: false };
  } catch (error) {
    pendingTwoFactorLogins.delete(ticket);
    throw error;
  }
}

async function resendPendingCode(map, ticket, sendCode, resolveRecipient = pending => storage.getUserById(pending.userId)) {
  const pending = map.get(ticket);
  if (!pending) return { error: 'Verification session not found. Try again.', status: 400 };
  if (Date.now() > pending.expiresAt) {
    map.delete(ticket);
    return { error: 'The code expired. Start the process again.', status: 400 };
  }

  const remainingWait = RESEND_WAIT_MS - (Date.now() - pending.lastSentAt);
  if (remainingWait > 0) {
    return { error: `You can request a new code in ${Math.ceil(remainingWait / 1000)} seconds.`, status: 429 };
  }

  const recipient = resolveRecipient(pending);
  if (!recipient) {
    map.delete(ticket);
    return { error: 'User not found.', status: 404 };
  }

  const code = createSixDigitCode();
  const previousLastSentAt = pending.lastSentAt;
  // Start the resend cooldown immediately so concurrent requests cannot flood
  // the recipient, but retain the old working code if the SMTP call fails.
  pending.lastSentAt = Date.now();
  try {
    await sendCode(recipient, code, pending);
  } catch (error) {
    pending.lastSentAt = previousLastSentAt;
    throw error;
  }

  pending.codeHash = hashCode(code);
  pending.expiresAt = Date.now() + CODE_EXPIRES_IN_MS;
  pending.attempts = 0;
  return { pending };
}

function getSocialProvider(providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  const definition = SOCIAL_PROVIDERS[id];
  if (!definition) return null;
  const clientId = String(process.env[definition.clientIdEnv] || '').trim();
  const clientSecret = String(process.env[definition.clientSecretEnv] || '').trim();
  return { id, ...definition, clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function readCookie(req, name) {
  const prefix = `${name}=`;
  const entry = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch (_) {
    return '';
  }
}

function socialStateCookie(req, value, maxAgeSeconds) {
  const secure = req.secure;
  return [
    `tahos_social_state=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth/social/',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function safeOrigin(value, fallback) {
  try {
    const parsed = new URL(String(value || fallback || ''));
    const localhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) || parsed.username || parsed.password) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function socialCallbackUrl(req, providerId) {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const base = safeOrigin(process.env.SOCIAL_AUTH_BASE_URL, requestOrigin);
  if (!base) throw new Error('SOCIAL_AUTH_BASE_URL must be an HTTPS origin.');
  return new URL(`/api/auth/social/${providerId}/callback`, base).href;
}

function socialWebUrl(req) {
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const target = safeOrigin(process.env.SOCIAL_AUTH_WEB_URL || process.env.CLIENT_URL, requestOrigin);
  if (!target) throw new Error('SOCIAL_AUTH_WEB_URL must be an HTTPS URL.');
  return target;
}

function redirectSocialResult(req, res, client, values) {
  try {
    if (client === 'desktop') {
      const target = new URL('tahosapp-auth://callback');
      Object.entries(values).forEach(([key, value]) => target.searchParams.set(key, String(value)));
      return res.redirect(303, target.href);
    }

    const target = socialWebUrl(req);
    target.hash = new URLSearchParams(values).toString();
    return res.redirect(303, target.href);
  } catch (error) {
    console.error('Social sign-in redirect error:', error.message);
    return res.status(500).send('Social sign-in could not return to tahosapp.');
  }
}

async function fetchOAuthJson(url, options, providerLabel) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  timeout.unref?.();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${providerLabel} returned an authentication error.`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSocialProfile(provider, code, redirectUri) {
  const token = await fetchOAuthJson(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  }, provider.label);
  if (!token.access_token || !/^[A-Za-z][A-Za-z0-9+.-]*$/.test(String(token.token_type || 'Bearer'))) {
    throw new Error(`${provider.label} did not return a usable access token.`);
  }

  const profile = await fetchOAuthJson(provider.userInfoUrl, {
    headers: { Authorization: `${token.token_type || 'Bearer'} ${token.access_token}`, Accept: 'application/json' },
  }, provider.label);

  if (provider.id === 'google') {
    return {
      subject: String(profile.sub || ''),
      email: normalizeEmail(profile.email),
      emailVerified: profile.email_verified === true,
      username: String(profile.name || profile.email?.split('@')[0] || ''),
      avatar: String(profile.picture || ''),
    };
  }

  return {
    subject: String(profile.id || ''),
    email: normalizeEmail(profile.email),
    emailVerified: profile.verified === true,
    username: String(profile.global_name || profile.username || profile.email?.split('@')[0] || ''),
    avatar: profile.id && profile.avatar
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(profile.id)}/${encodeURIComponent(profile.avatar)}.png?size=128`
      : '',
  };
}

function uniqueSocialUsername(preferred, email) {
  const fallback = String(email || '').split('@')[0] || 'tahosapp-user';
  const base = String(preferred || fallback)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 43) || 'tahosapp-user';
  if (!storage.getUserByUsername(base)) return base;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base.slice(0, 43)}-${crypto.randomBytes(3).toString('hex')}`;
    if (!storage.getUserByUsername(candidate)) return candidate;
  }
  return `tahosapp-${crypto.randomBytes(12).toString('hex')}`.slice(0, 50);
}

async function findOrCreateSocialUser(provider, profile) {
  if (!profile.subject || !isValidEmail(profile.email) || !profile.emailVerified) {
    throw new Error(`${provider.label} must provide a verified email address.`);
  }

  const hub = ensureHubState();
  const identityKey = `${provider.id}:${profile.subject}`;
  const identity = hub.socialIdentities[identityKey];
  let user = identity?.userId ? storage.getUserById(identity.userId) : null;
  if (!user) user = storage.getUserByEmail(profile.email);

  if (!user) {
    user = storage.createUserWithAuth({
      username: uniqueSocialUsername(profile.username, profile.email),
      email: profile.email,
      password: await hashPassword(crypto.randomBytes(48).toString('base64url')),
    });
    user.socialOnly = true;
    if (/^https:\/\//i.test(profile.avatar)) user.avatar = profile.avatar;
  }

  hub.socialIdentities[identityKey] = {
    userId: user.id,
    provider: provider.id,
    subject: profile.subject,
    email: profile.email,
    linkedAt: identity?.linkedAt || Date.now(),
    lastLoginAt: Date.now(),
  };
  storage.saveData();
  return user;
}

router.get('/social/providers', (_req, res) => {
  return res.json({
    providers: Object.keys(SOCIAL_PROVIDERS).map(id => {
      const provider = getSocialProvider(id);
      return { id, label: provider.label, enabled: provider.configured };
    }),
  });
});

router.get('/social/:provider/start', rateLimits.socialStartIp, (req, res) => {
  const provider = getSocialProvider(req.params.provider);
  const client = req.query.client === 'desktop' ? 'desktop' : 'web';
  if (!provider) return res.status(404).send('Social sign-in provider not found.');
  if (!provider.configured) return res.status(503).send(`${provider.label} sign-in is not configured.`);

  try {
    cleanupExpiredSecurityState();
    const state = crypto.randomBytes(32).toString('base64url');
    const redirectUri = socialCallbackUrl(req, provider.id);
    pendingSocialStates.set(state, { providerId: provider.id, client, redirectUri, expiresAt: Date.now() + SOCIAL_STATE_TTL_MS });
    res.set('Set-Cookie', socialStateCookie(req, state, Math.ceil(SOCIAL_STATE_TTL_MS / 1000)));
    const target = new URL(provider.authorizationUrl);
    target.searchParams.set('client_id', provider.clientId);
    target.searchParams.set('redirect_uri', redirectUri);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('scope', provider.scope);
    target.searchParams.set('state', state);
    if (provider.id === 'google') target.searchParams.set('prompt', 'select_account');
    return res.redirect(303, target.href);
  } catch (error) {
    console.error('Could not start social sign-in:', error.message);
    return res.status(500).send('Social sign-in could not be started.');
  }
});

router.get('/social/:provider/callback', rateLimits.socialCallbackIp, async (req, res) => {
  cleanupExpiredSecurityState();
  const state = String(req.query.state || '');
  const pending = pendingSocialStates.get(state);
  if (pending) pendingSocialStates.delete(state);
  const cookieState = readCookie(req, 'tahos_social_state');
  res.set('Set-Cookie', socialStateCookie(req, '', 0));
  const provider = getSocialProvider(req.params.provider);
  const client = pending?.client === 'desktop' ? 'desktop' : 'web';
  const stateBuffer = Buffer.from(state);
  const cookieStateBuffer = Buffer.from(cookieState);
  const stateMatchesCookie = stateBuffer.length > 0
    && cookieStateBuffer.length === stateBuffer.length
    && crypto.timingSafeEqual(cookieStateBuffer, stateBuffer);

  if (!pending || !stateMatchesCookie || !provider || pending.providerId !== provider.id || !provider.configured) {
    return redirectSocialResult(req, res, client, { social_error: 'invalid_request' });
  }
  if (req.query.error || !req.query.code) {
    return redirectSocialResult(req, res, client, { social_error: req.query.error === 'access_denied' ? 'cancelled' : 'provider_error' });
  }

  try {
    const profile = await fetchSocialProfile(provider, String(req.query.code), pending.redirectUri);
    const user = await findOrCreateSocialUser(provider, profile);
    const platformBan = storage.getUserPlatformBan(user.id);
    if (platformBan) return redirectSocialResult(req, res, client, { social_error: 'account_banned' });

    const ticket = crypto.randomBytes(32).toString('base64url');
    pendingSocialTickets.set(ticket, { userId: user.id, providerId: provider.id, expiresAt: Date.now() + SOCIAL_TICKET_TTL_MS });
    return redirectSocialResult(req, res, client, { social_ticket: ticket });
  } catch (error) {
    console.error(`${provider.label} sign-in callback error:`, error.message);
    return redirectSocialResult(req, res, client, { social_error: 'verification_failed' });
  }
});

router.post('/social/exchange', rateLimits.socialExchangeIp, (req, res) => {
  cleanupExpiredSecurityState();
  const ticket = String(req.body.ticket || '');
  const pending = pendingSocialTickets.get(ticket);
  if (pending) pendingSocialTickets.delete(ticket);
  if (!pending) return res.status(400).json({ error: 'Social sign-in expired. Please try again.' });

  const user = storage.getUserById(pending.userId);
  if (!user || storage.getUserPlatformBan(user.id)) return res.status(403).json({ error: 'This account cannot sign in.' });
  const session = createSession(user.id, req, `oauth:${pending.providerId}`);
  return res.json({ user: publicUser(user), token: signAuthToken(user, { sid: session.id }) });
});

router.post('/register', rateLimits.registerIp, rateLimits.registerAccount, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (username.length < 2 || username.length > 50 || !isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({
        error: 'A valid username, email address, and password of at least 8 characters are required.',
      });
    }

    if (storage.getUserByUsername(username) || storage.getUserByEmail(email)) {
      return res.status(409).json({ error: 'This username or email address is already in use.' });
    }

    const passwordHash = await hashPassword(password);
    // SMTP teslimi başarısız olursa kullanıcı/veri memberliği oluşmaz. Hesap yalnızca
    // e-postadaki kod doğrulandığında kalıcı olarak oluşturulur.
    const registrationResult = await sendRegistrationCode({ username, email, passwordHash });
    const loginTicket = registrationResult.ticket;

    return res.status(201).json({
      requiresTwoFactor: true,
      loginTicket,
      message: 'Registration successful. A verification code was sent to your email address.',
    });
  } catch (error) {
    const busyResponse = passwordWorkBusyResponse(error, res);
    if (busyResponse) return busyResponse;
    console.error('Registration verification error:', error.message);
    return res.status(503).json({
      error: emailDeliveryErrorMessage(error, 'The registration verification email could not be sent. Check the SMTP settings and try again.'),
    });
  }
});

router.post('/login', rateLimits.loginIp, rateLimits.loginAccount, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const user = findUserByEmail(email);

    // Bound the Argon2 input and perform the same expensive verification for
    // unknown accounts. This closes both oversized-input abuse and the common
    // account-existence timing side channel.
    const passwordCandidate = isValidPassword(password) ? password : '<invalid-password>';
    let passwordAccepted = false;
    if (user) {
      passwordAccepted = await checkPasswordAndMigrate(user, passwordCandidate);
    } else {
      await verifyPassword(passwordCandidate, DUMMY_PASSWORD_HASH);
    }

    if (!user || !passwordAccepted) {
      return res.status(401).json({ error: 'Incorrect email address or password.' });
    }

    const platformBan = storage.getUserPlatformBan(user.id);
    if (platformBan) {
      return res.status(403).json({
        error: `Your account was banned: ${platformBan.reason}`,
        code: 'ACCOUNT_BANNED',
      });
    }

    const loginTicket = await sendLoginCode(storage.getUserById(user.id));
    return res.json({
      requiresTwoFactor: true,
      loginTicket,
      message: 'A verification code was sent to your email address.',
    });
  } catch (error) {
    const busyResponse = passwordWorkBusyResponse(error, res);
    if (busyResponse) return busyResponse;
    console.error('Sign-in verification error:', error.message);
    return res.status(503).json({
      error: emailDeliveryErrorMessage(error, 'The verification email could not be sent. Check the SMTP settings.'),
    });
  }
});

router.post('/verify-2fa', rateLimits.verifyTwoFactorIp, rateLimits.verifyTwoFactorAccount, (req, res) => {
  const loginTicket = String(req.body.loginTicket || '');
  const code = String(req.body.code || '').trim();
  const result = validatePendingCode(pendingTwoFactorLogins, loginTicket, code);

  if (result.error) return res.status(result.status).json({ error: result.error });

  let user;
  if (result.pending.registration) {
    const registration = result.pending.registration;
    try {
      user = storage.createUserWithAuth({
        username: registration.username,
        email: registration.email,
        password: registration.passwordHash,
      });
    } catch (error) {
      pendingTwoFactorLogins.delete(loginTicket);
      return res.status(409).json({
        error: 'This username or email address was claimed by another account during verification. Please register again.',
      });
    }
  } else {
    user = storage.getUserById(result.pending.userId);
  }
  pendingTwoFactorLogins.delete(loginTicket);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const platformBan = storage.getUserPlatformBan(user.id);
  if (platformBan) {
    return res.status(403).json({
      error: `Your account was banned: ${platformBan.reason}`,
      code: 'ACCOUNT_BANNED',
    });
  }

  const session = createSession(user.id, req, result.pending.registration ? 'registration' : 'password');
  return res.json({ user: publicUser(user), token: signAuthToken(user, { sid: session.id }) });
});

router.post('/resend-2fa', rateLimits.resendTwoFactorIp, rateLimits.resendTwoFactorAccount, async (req, res) => {
  try {
    const loginTicket = String(req.body.loginTicket || '');
    const result = await resendPendingCode(
      pendingTwoFactorLogins,
      loginTicket,
      (user, code) => sendTwoFactorCode(user.email, user.username, code),
      pending => pending.registration || storage.getUserById(pending.userId),
    );
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ message: 'A new verification code was sent to your email address.' });
  } catch (error) {
    console.error('Could not resend the code:', error.message);
    return res.status(503).json({ error: emailDeliveryErrorMessage(error, 'The new code could not be sent.') });
  }
});

// E-posta adresinin varlığı hakkında bilgi sızdırmamak has her zaman aynı mesaj döner.
router.post(
  '/request-password-reset',
  rateLimits.requestPasswordResetIp,
  rateLimits.requestPasswordResetAccount,
  async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const user = findUserByEmail(email);
    let resetTicket = null;

    try {
      if (user) {
        const created = createPendingCode(pendingPasswordResets, user.id);
        resetTicket = created.ticket;
        await sendPasswordResetCode(user.email, user.username, created.code);
      } else {
        resetTicket = createDecoyPasswordReset();
      }
    } catch (error) {
      // SMTP hatası da hesap yokmuş gibi aynı şekil and sonraki davranışla replieslanır.
      // Böylece replies gövdesi üzerinden hesap veya teslimat durumu anlaşılmaz.
      if (resetTicket) {
        pendingPasswordResets.delete(resetTicket);
        createDecoyPasswordReset(resetTicket);
      } else {
        resetTicket = createDecoyPasswordReset();
      }
      console.error('Could not send the password reset email:', error.message);
    }

    return res.json({
      message: 'If this email address is registered, a password reset code was sent.',
      resetTicket,
    });
  },
);

router.post(
  '/resend-password-reset',
  rateLimits.resendPasswordResetIp,
  rateLimits.resendPasswordResetAccount,
  async (req, res) => {
    try {
      const resetTicket = String(req.body.resetTicket || '');
      const result = await resendPendingCode(
        pendingPasswordResets,
        resetTicket,
        (user, code, pending) => (pending.decoy
          ? Promise.resolve()
          : sendPasswordResetCode(user.email, user.username, code)),
        pending => (pending.decoy ? { decoy: true } : storage.getUserById(pending.userId)),
      );
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ message: 'A new password reset code was sent to your email address.' });
    } catch (error) {
      console.error('Could not resend the password reset code:', error.message);
      return res.status(503).json({ error: emailDeliveryErrorMessage(error, 'The new code could not be sent.') });
    }
  },
);

router.post('/reset-password', rateLimits.resetPasswordIp, rateLimits.resetPasswordAccount, async (req, res) => {
  try {
    const resetTicket = String(req.body.resetTicket || '');
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: 'The new password must be between 8 and 128 characters.' });
    }

    const result = validatePendingCode(pendingPasswordResets, resetTicket, code);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (result.pending.decoy) {
      pendingPasswordResets.delete(resetTicket);
      return res.status(400).json({ error: 'The code or verification session is invalid. Start the process again.' });
    }

    const user = storage.getUserById(result.pending.userId);
    if (!user) {
      pendingPasswordResets.delete(resetTicket);
      return res.status(404).json({ error: 'User not found.' });
    }

    storage.updateUserPassword(user.id, await hashPassword(newPassword));
    pendingPasswordResets.delete(resetTicket);
    return res.json({ message: 'Your password was updated. Sign in again for security.' });
  } catch (error) {
    const busyResponse = passwordWorkBusyResponse(error, res);
    if (busyResponse) return busyResponse;
    console.error('Password reset error:', error.message);
    return res.status(500).json({ error: 'The password could not be updated.' });
  }
});

router.post(
  '/change-password',
  rateLimits.changePasswordIp,
  requireAuth,
  rateLimits.changePasswordAccount,
  async (req, res) => {
    try {
      const currentPassword = String(req.body.currentPassword || '');
      const newPassword = String(req.body.newPassword || '');
      if (!isValidPassword(newPassword)) {
        return res.status(400).json({ error: 'The new password must be between 8 and 128 characters.' });
      }

      const sessions = ensureHubState().sessions;
      const sessionId = String(req.auth?.sid || '');
      const session = Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : null;
      const freshSocialSession = Boolean(
        req.user.socialOnly
        && session?.userId === req.user.id
        && String(session.method || '').startsWith('oauth:')
        && Date.now() - Number(session.createdAt || 0) <= SOCIAL_PASSWORD_SETUP_WINDOW_MS,
      );

      if (!freshSocialSession && !(await checkPasswordAndMigrate(req.user, currentPassword))) {
        return res.status(401).json({
          error: req.user.socialOnly
            ? 'Sign in again with Google or Discord before setting your first password.'
            : 'The current password is incorrect.',
        });
      }

      const passwordHash = await hashPassword(newPassword);
      req.user.socialOnly = false;
      storage.updateUserPassword(req.user.id, passwordHash);
      return res.json({ message: 'Your password was updated. Sign in again for security.' });
    } catch (error) {
      const busyResponse = passwordWorkBusyResponse(error, res);
      if (busyResponse) return busyResponse;
      console.error('Password change error:', error.message);
      return res.status(500).json({ error: 'The password could not be updated.' });
    }
  },
);

router.post(
  '/request-email-change',
  rateLimits.requestEmailChangeIp,
  requireAuth,
  rateLimits.requestEmailChangeAccount,
  async (req, res) => {
    try {
      const newEmail = normalizeEmail(req.body.newEmail);
      const currentPassword = String(req.body.currentPassword || '');

      if (!isValidEmail(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (newEmail === normalizeEmail(req.user.email)) return res.status(400).json({ error: 'Bu e-posta adresi zaten usesda.' });
      if (storage.getUserByEmail(newEmail)) return res.status(409).json({ error: 'This email address is used by another account.' });
      if (!(await checkPasswordAndMigrate(req.user, currentPassword))) {
        return res.status(401).json({ error: 'The current password is incorrect.' });
      }

      const created = createPendingCode(pendingEmailChanges, req.user.id, { newEmail });
      try {
        await sendEmailChangeCode(newEmail, req.user.username, created.code);
      } catch (error) {
        pendingEmailChanges.delete(created.ticket);
        throw error;
      }

      return res.json({
        emailChangeTicket: created.ticket,
        message: 'A verification code was sent to your new email address.',
      });
    } catch (error) {
      const busyResponse = passwordWorkBusyResponse(error, res);
      if (busyResponse) return busyResponse;
      console.error('Could not send email change verification:', error.message);
      return res.status(503).json({ error: emailDeliveryErrorMessage(error, 'The verification email could not be sent.') });
    }
  },
);

router.post(
  '/resend-email-change',
  rateLimits.resendEmailChangeIp,
  requireAuth,
  rateLimits.resendEmailChangeAccount,
  async (req, res) => {
    try {
      const emailChangeTicket = String(req.body.emailChangeTicket || '');
      const pending = pendingEmailChanges.get(emailChangeTicket);
      if (!pending || pending.userId !== req.user.id) {
        return res.status(400).json({ error: 'Verification session not found. Start the process again.' });
      }

      const result = await resendPendingCode(pendingEmailChanges, emailChangeTicket, (user, code, current) => (
        sendEmailChangeCode(current.newEmail, user.username, code)
      ));
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ message: 'A new verification code was sent to the new email address.' });
    } catch (error) {
      console.error('Could not resend the email change code:', error.message);
      return res.status(503).json({ error: emailDeliveryErrorMessage(error, 'The new code could not be sent.') });
    }
  },
);

router.post(
  '/confirm-email-change',
  rateLimits.confirmEmailChangeIp,
  requireAuth,
  rateLimits.confirmEmailChangeAccount,
  (req, res) => {
    const emailChangeTicket = String(req.body.emailChangeTicket || '');
    const code = String(req.body.code || '').trim();
    const pending = pendingEmailChanges.get(emailChangeTicket);

    if (!pending || pending.userId !== req.user.id) {
      return res.status(400).json({ error: 'Verification session not found. Start the process again.' });
    }

    const result = validatePendingCode(pendingEmailChanges, emailChangeTicket, code);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (storage.getUserByEmail(result.pending.newEmail)) {
      pendingEmailChanges.delete(emailChangeTicket);
      return res.status(409).json({ error: 'This email address is now used by another account.' });
    }

    const user = storage.updateUserEmail(req.user.id, result.pending.newEmail);
    pendingEmailChanges.delete(emailChangeTicket);
    if (!user) return res.status(400).json({ error: 'The email address could not be updated.' });
    return res.json({ user: publicUser(user), message: 'Your email address was updated.' });
  },
);

router.get(
  '/verify',
  rateLimits.verifySessionIp,
  requireAuth,
  rateLimits.verifySessionAccount,
  (req, res) => res.json({ user: publicUser(req.user) }),
);

router.get('/:id', rateLimits.readProfileIp, requireAuth, rateLimits.readProfileAccount, (req, res) => {
  const user = storage.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json(req.params.id === req.user.id ? publicUser(user) : publicProfile(user));
});

router.put('/:id', rateLimits.updateProfileIp, requireAuth, rateLimits.updateProfileAccount, (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'You cannot change another user’s profile.' });

  try {
    const user = storage.updateUserProfile(req.user.id, {
      username: req.body.username,
      avatar: req.body.avatar,
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json(publicUser(user));
  } catch (error) {
    return res.status(400).json({ error: error.message || 'The profile could not be updated.' });
  }
});

module.exports = router;
