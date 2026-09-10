const express = require('express');
const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const storage = require('../storage/inMemory');
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
const authRateLimitEntries = new Map();

const CODE_EXPIRES_IN_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
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

  return res.json({ user: publicUser(user), token: signAuthToken(user) });
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
