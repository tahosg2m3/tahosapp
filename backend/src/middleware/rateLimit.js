const { ipKeyGenerator } = require('express-rate-limit');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const PROFILES = Object.freeze({
  auth: {
    windowMs: 60 * 1000,
    limit: 1200,
    maxEntries: 20_000,
    keyType: 'ip',
  },
  read: {
    windowMs: 60 * 1000,
    limit: 600,
    maxEntries: 20_000,
    keyType: 'client',
    methods: 'read',
  },
  mutation: {
    windowMs: 60 * 1000,
    limit: 180,
    maxEntries: 20_000,
    keyType: 'client',
    methods: 'mutation',
  },
  upload: {
    windowMs: 10 * 60 * 1000,
    limit: 30,
    maxEntries: 5_000,
    keyType: 'client',
  },
  external: {
    windowMs: 60 * 1000,
    limit: 60,
    maxEntries: 5_000,
    keyType: 'client',
  },
  publicRead: {
    windowMs: 60 * 1000,
    limit: 240,
    maxEntries: 10_000,
    keyType: 'ip',
  },
  webhook: {
    windowMs: 60 * 1000,
    limit: 120,
    maxEntries: 10_000,
    keyType: 'ip',
  },
  feedback: {
    windowMs: 60 * 60 * 1000,
    limit: 10,
    maxEntries: 10_000,
    keyType: 'ip',
  },
});

/**
 * A fixed-window store whose key count has a hard upper bound. When the store
 * is full, unknown clients fail closed instead of evicting active counters and
 * allowing a high-cardinality attacker to bypass the limiter.
 */
class BoundedMemoryStore {
  constructor(maxEntries) {
    this.maxEntries = Math.max(100, Number(maxEntries) || 10_000);
    this.entries = new Map();
    this.windowMs = 60 * 1000;
    this.lastSweepAt = 0;
    this.localKeys = true;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.resetTime.getTime() <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  increment(key) {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (entry && entry.resetTime.getTime() <= now) {
      this.entries.delete(key);
      entry = undefined;
    }

    if (!entry && this.entries.size >= this.maxEntries) {
      this.sweepExpired(now);
      if (this.entries.size >= this.maxEntries) {
        return {
          totalHits: Number.MAX_SAFE_INTEGER,
          resetTime: new Date(now + this.windowMs),
        };
      }
    }

    if (!entry) {
      entry = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
      this.entries.set(key, entry);
    }

    entry.totalHits = Math.min(Number.MAX_SAFE_INTEGER, entry.totalHits + 1);
    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  decrement(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.totalHits <= 1) {
      this.entries.delete(key);
      return;
    }
    entry.totalHits -= 1;
  }

  resetKey(key) {
    this.entries.delete(key);
  }

  resetAll() {
    this.entries.clear();
  }

  shutdown() {
    this.resetAll();
  }

  sweepExpired(now) {
    // Avoid turning a saturated store into an O(n)-per-request CPU target.
    if (now - this.lastSweepAt < 1000) return;
    this.lastSweepAt = now;
    for (const [key, entry] of this.entries) {
      if (entry.resetTime.getTime() <= now) this.entries.delete(key);
    }
  }
}

function normalizedIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return ip === 'unknown' ? ip : ipKeyGenerator(ip);
}

function clientKey(req) {
  const userId = req.user?.id ? String(req.user.id).slice(0, 128) : 'anonymous';
  return `${userId}:${normalizedIp(req)}`;
}

function retryAfterSeconds(req, windowMs) {
  const resetAt = req.rateLimit?.resetTime?.getTime?.();
  if (!Number.isFinite(resetAt)) return Math.max(1, Math.ceil(windowMs / 1000));
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function createRateLimitOptions(profileName, scope) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown rate-limit profile: ${profileName}`);

  return {
    windowMs: profile.windowMs,
    limit: profile.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: false,
    identifier: `${scope}-${profileName}`,
    keyGenerator: profile.keyType === 'client' ? clientKey : normalizedIp,
    store: new BoundedMemoryStore(profile.maxEntries),
    skip: req => {
      if (profile.methods === 'read') return !READ_METHODS.has(req.method);
      if (profile.methods === 'mutation') return READ_METHODS.has(req.method);
      return false;
    },
    handler: (req, res) => {
      const retryAfter = retryAfterSeconds(req, profile.windowMs);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please try again shortly.',
        code: 'RATE_LIMITED',
        retryAfter,
      });
    },
  };
}

module.exports = {
  BoundedMemoryStore,
  createRateLimitOptions,
};
