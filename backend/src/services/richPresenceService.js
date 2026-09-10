const crypto = require('crypto');

const storage = require('../storage/inMemory');

const ACTIVITY_TYPES = new Set(['playing', 'listening', 'watching', 'working', 'competing', 'custom']);
const ACTIVITY_CATEGORIES = new Set(['game', 'music', 'video', 'application', 'custom']);
const PLAYBACK_STATUSES = new Set(['playing', 'paused', 'stopped']);
const MAX_SESSIONS_PER_USER = 5;
const DEFAULT_TTL_SECONDS = 120;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 900;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(value, maxLength, fallback = '') {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, maxLength);
}

function integer(value, minimum, maximum, fallback = minimum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function timestamp(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function safeImageUrl(value) {
  const candidate = oneLine(value, 2048);
  if (!candidate) return null;
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) return null;
    const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localDevelopmentHost)
      ? parsed.href
      : null;
  } catch (_) {
    return null;
  }
}

function safeActionUrl(value) {
  const candidate = oneLine(value, 2048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

function normalizeMetadata(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 8)
    .map(([key, item]) => [oneLine(key, 32), oneLine(item, 80)])
    .filter(([key, item]) => key && item));
}

function normalizeActivity(input, previous = null) {
  if (!isRecord(input)) throw new Error('Activity details must be an object.');
  const now = Date.now();
  const name = oneLine(input.name ?? input.applicationName, 80);
  if (!name) throw new Error('An app or game name is required.');

  const sessionId = oneLine(input.sessionId || previous?.sessionId || 'primary', 64, 'primary');
  if (!/^[A-Za-z0-9._:-]+$/.test(sessionId)) {
    throw new Error('The session ID may contain only letters, numbers, periods, underscores, colons, and hyphens.');
  }

  const type = oneLine(input.type || previous?.type || 'playing', 24).toLowerCase();
  if (!ACTIVITY_TYPES.has(type)) throw new Error('Unsupported activity type.');
  const requestedCategory = oneLine(input.category || previous?.category, 24).toLowerCase();
  const category = ACTIVITY_CATEGORIES.has(requestedCategory)
    ? requestedCategory
    : type === 'listening' ? 'music' : type === 'watching' ? 'video' : type === 'playing' ? 'game' : 'application';
  const requestedPlaybackStatus = oneLine(input.playbackStatus || previous?.playbackStatus, 24).toLowerCase();
  const playbackStatus = PLAYBACK_STATUSES.has(requestedPlaybackStatus) ? requestedPlaybackStatus : null;

  const ttlSeconds = integer(input.ttlSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const progressInput = isRecord(input.progress) ? input.progress : {};
  const current = Number(progressInput.current);
  const total = Number(progressInput.total);
  const progress = Number.isFinite(current) && Number.isFinite(total) && total > 0
    ? {
      current: Math.max(0, Math.min(total, current)),
      total,
      label: oneLine(progressInput.label, 48),
    }
    : null;

  const partyInput = isRecord(input.party) ? input.party : {};
  const partySize = integer(partyInput.size, 0, 999, 0);
  const partyMax = integer(partyInput.max, 0, 999, 0);
  const party = partyMax > 0 ? {
    id: oneLine(partyInput.id, 64),
    size: Math.min(partySize, partyMax),
    max: partyMax,
  } : null;

  const musicInput = isRecord(input.music) ? input.music : {};
  const music = type === 'listening' && oneLine(musicInput.song, 100)
    ? {
      song: oneLine(musicInput.song, 100),
      artist: oneLine(musicInput.artist, 100),
      album: oneLine(musicInput.album, 100),
      durationMs: integer(musicInput.durationMs, 0, 24 * 60 * 60 * 1000, 0),
      positionMs: integer(musicInput.positionMs, 0, 24 * 60 * 60 * 1000, 0),
    }
    : null;

  const buttons = (Array.isArray(input.buttons) ? input.buttons : [])
    .slice(0, 2)
    .map(button => ({
      label: oneLine(button?.label, 32),
      url: safeActionUrl(button?.url),
    }))
    .filter(button => button.label && button.url);

  return {
    id: sessionId,
    sessionId,
    type,
    category,
    provider: oneLine(input.provider || previous?.provider, 40),
    playbackStatus,
    hideElapsed: Boolean(input.hideElapsed),
    name,
    details: oneLine(input.details, 160),
    state: oneLine(input.state, 160),
    imageUrl: safeImageUrl(input.imageUrl || input.largeImageUrl),
    smallImageUrl: safeImageUrl(input.smallImageUrl),
    imageText: oneLine(input.imageText || input.largeImageText, 80),
    smallImageText: oneLine(input.smallImageText, 80),
    startedAt: timestamp(input.startedAt ?? input.startTimestamp, previous?.startedAt || now),
    endsAt: timestamp(input.endsAt ?? input.endTimestamp),
    progress,
    party,
    music,
    metadata: normalizeMetadata(input.metadata),
    buttons,
    updatedAt: now,
    expiresAt: now + ttlSeconds * 1000,
  };
}

function publicActivity(activity) {
  if (!activity) return null;
  return JSON.parse(JSON.stringify(activity));
}

class RichPresenceService {
  constructor(storageInstance = storage) {
    this.storage = storageInstance;
    this.sessions = new Map();
    this.lastTokenUse = new Map();
    this.io = null;
    this.ensurePersistentState();
    this.cleanupTimer = setInterval(() => this.pruneExpiredSessions(true), 15_000);
    this.cleanupTimer.unref?.();
  }

  ensurePersistentState() {
    const root = isRecord(this.storage.platformState) ? this.storage.platformState : { version: 1 };
    const current = isRecord(root.richPresence) ? root.richPresence : {};
    root.richPresence = {
      tokens: isRecord(current.tokens) ? current.tokens : {},
      settings: isRecord(current.settings) ? current.settings : {},
    };
    this.storage.platformState = root;
    return root.richPresence;
  }

  setIo(io) {
    this.io = io || null;
  }

  isEnabled(userId) {
    return this.ensurePersistentState().settings[userId]?.enabled !== false;
  }

  setEnabled(userId, enabled) {
    const state = this.ensurePersistentState();
    state.settings[userId] = { enabled: Boolean(enabled), updatedAt: Date.now() };
    this.storage.saveData();
    if (!enabled) this.clearAll(userId, { broadcast: false });
    this.broadcast(userId);
    return this.getManagementState(userId);
  }

  tokenHash(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
  }

  createToken(userId) {
    if (!this.storage.getUserById(userId)) throw new Error('User not found.');
    const token = `tpr_${crypto.randomBytes(32).toString('base64url')}`;
    const state = this.ensurePersistentState();
    const rotated = Boolean(state.tokens[userId]?.hash);
    state.tokens[userId] = {
      hash: this.tokenHash(token),
      lastFour: token.slice(-4),
      createdAt: Date.now(),
    };
    this.storage.saveData();
    if (rotated) this.clearAll(userId);
    return { token, rotated, ...this.tokenInfo(userId), activities: this.getActivities(userId, { includeHidden: true }) };
  }

  revokeToken(userId) {
    const state = this.ensurePersistentState();
    const existed = Boolean(state.tokens[userId]);
    delete state.tokens[userId];
    this.lastTokenUse.delete(userId);
    this.storage.saveData();
    this.clearAll(userId);
    return existed;
  }

  tokenInfo(userId) {
    const stored = this.ensurePersistentState().tokens[userId];
    return {
      exists: Boolean(stored?.hash),
      lastFour: stored?.lastFour || null,
      createdAt: stored?.createdAt || null,
      lastUsedAt: this.lastTokenUse.get(userId) || null,
    };
  }

  authenticateToken(token) {
    const candidate = oneLine(token, 128);
    if (!candidate.startsWith('tpr_') || candidate.length < 32) return null;
    const hash = this.tokenHash(candidate);
    const tokens = this.ensurePersistentState().tokens;
    const entry = Object.entries(tokens).find(([, value]) => (
      typeof value?.hash === 'string'
      && value.hash.length === hash.length
      && crypto.timingSafeEqual(Buffer.from(value.hash), Buffer.from(hash))
    ));
    if (!entry) return null;
    const user = this.storage.getUserById(entry[0]);
    if (!user) return null;
    this.lastTokenUse.set(user.id, Date.now());
    return user;
  }

  getActivities(userId, { includeHidden = false } = {}) {
    this.pruneExpiredForUser(userId, false);
    if (!this.isEnabled(userId)) return [];
    const user = this.storage.getUserById(userId);
    if (!includeHidden && (user?.presenceStatus === 'invisible' || this.storage.getUserStatus(userId) === 'offline')) return [];
    return [...(this.sessions.get(userId)?.values() || [])]
      .sort((first, second) => second.updatedAt - first.updatedAt)
      .map(publicActivity);
  }

  setActivity(userId, input) {
    if (!this.storage.getUserById(userId)) throw new Error('User not found.');
    if (!this.isEnabled(userId)) {
      const error = new Error('Rich Presence sharing is disabled in account settings.');
      error.code = 'RICH_PRESENCE_DISABLED';
      throw error;
    }
    const userSessions = this.sessions.get(userId) || new Map();
    const requestedSessionId = oneLine(input?.sessionId || 'primary', 64, 'primary');
    const previous = userSessions.get(requestedSessionId) || null;
    if (!previous && userSessions.size >= MAX_SESSIONS_PER_USER) {
      throw new Error(`You can share up to ${MAX_SESSIONS_PER_USER} activity sessions at once.`);
    }
    const activity = normalizeActivity(input, previous);
    userSessions.set(activity.sessionId, activity);
    this.sessions.set(userId, userSessions);
    this.broadcast(userId);
    return publicActivity(activity);
  }

  heartbeat(userId, sessionId, ttlSeconds = DEFAULT_TTL_SECONDS) {
    const normalizedSessionId = oneLine(sessionId || 'primary', 64, 'primary');
    const activity = this.sessions.get(userId)?.get(normalizedSessionId);
    if (!activity) return null;
    const now = Date.now();
    activity.updatedAt = now;
    activity.expiresAt = now + integer(ttlSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS) * 1000;
    this.broadcast(userId);
    return publicActivity(activity);
  }

  clear(userId, sessionId, { broadcast = true } = {}) {
    const normalizedSessionId = oneLine(sessionId || 'primary', 64, 'primary');
    const userSessions = this.sessions.get(userId);
    const removed = Boolean(userSessions?.delete(normalizedSessionId));
    if (userSessions && userSessions.size === 0) this.sessions.delete(userId);
    if (removed && broadcast) this.broadcast(userId);
    return removed;
  }

  clearAll(userId, { broadcast = true } = {}) {
    const removed = this.sessions.delete(userId);
    if (removed && broadcast) this.broadcast(userId);
    return removed;
  }

  pruneExpiredForUser(userId, broadcast = true) {
    const userSessions = this.sessions.get(userId);
    if (!userSessions) return false;
    const now = Date.now();
    let changed = false;
    userSessions.forEach((activity, sessionId) => {
      if (activity.expiresAt <= now || (activity.endsAt && activity.endsAt <= now)) {
        userSessions.delete(sessionId);
        changed = true;
      }
    });
    if (!userSessions.size) this.sessions.delete(userId);
    if (changed && broadcast) this.broadcast(userId);
    return changed;
  }

  pruneExpiredSessions(broadcast = true) {
    [...this.sessions.keys()].forEach(userId => this.pruneExpiredForUser(userId, broadcast));
  }

  broadcast(userId) {
    if (!this.io) return;
    const activities = this.getActivities(userId);
    const privateActivities = this.getActivities(userId, { includeHidden: true });
    const payload = { userId, activities, updatedAt: Date.now() };
    this.io.to(`user:${userId}`).emit('rich-presence:update', { ...payload, activities: privateActivities });
    this.storage.getUserFriends(userId).forEach(friend => {
      this.io.to(`user:${friend.id}`).emit('rich-presence:update', payload);
    });
    this.storage.getAllServers()
      .filter(server => !server.isDM && this.storage.isServerMember(server.id, userId))
      .forEach(server => {
        const target = this.io.to(`server:${server.id}`);
        const publicTarget = typeof target.except === 'function'
          ? target.except(`user:${userId}`)
          : target;
        publicTarget.emit('rich-presence:update', {
          ...payload,
          serverId: server.id,
        });
      });
  }

  getManagementState(userId) {
    return {
      enabled: this.isEnabled(userId),
      token: this.tokenInfo(userId),
      activities: this.getActivities(userId, { includeHidden: true }),
      limits: {
        maxSessions: MAX_SESSIONS_PER_USER,
        ttlSeconds: { minimum: MIN_TTL_SECONDS, default: DEFAULT_TTL_SECONDS, maximum: MAX_TTL_SECONDS },
      },
    };
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
    this.lastTokenUse.clear();
    this.io = null;
  }
}

const richPresenceService = new RichPresenceService();

module.exports = {
  ACTIVITY_TYPES,
  normalizeActivity,
  richPresenceService,
};
