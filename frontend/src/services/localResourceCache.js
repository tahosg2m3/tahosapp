const CACHE_VERSION = 1;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(resource, userId) {
  return `tahosapp:cache:${resource}:${String(userId || '')}`;
}

export function readUserResourceCache(resource, userId) {
  if (!userId) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(resource, userId)) || 'null');
    if (cached?.version !== CACHE_VERSION || !Array.isArray(cached.value)) return null;
    if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > MAX_CACHE_AGE_MS) return null;
    return cached.value;
  } catch (_) {
    return null;
  }
}

export function writeUserResourceCache(resource, userId, value) {
  if (!userId || !Array.isArray(value)) return;
  try {
    localStorage.setItem(cacheKey(resource, userId), JSON.stringify({
      version: CACHE_VERSION,
      savedAt: Date.now(),
      value,
    }));
  } catch (_) {
    // Cache storage is an optional speed-up. A full localStorage quota must
    // never prevent fresh server data from reaching the UI.
  }
}
