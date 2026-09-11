import { API_ORIGIN } from '../config/runtimeConfig';

const LOCAL_UPLOAD_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;
const GENERATED_AVATAR_HOSTNAME = 'ui-avatars.com';

function encodeDomMediaUrl(value) {
  // Preserve URL parser escapes and IPv6 brackets while encoding characters
  // that could otherwise be reinterpreted if a DOM library builds HTML text.
  return encodeURI(value)
    .replace(/%25([0-9A-Fa-f]{2})/g, '%$1')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']')
    .replace(/'/g, '%27');
}

/**
 * Resolves media URLs that are safe to place in DOM URL-valued attributes.
 * Local uploads are restricted to the backend's flat uploads directory, while
 * remote media must use an explicit HTTP(S) URL.
 */
export function resolveSafeMediaUrl(value, { excludeGeneratedAvatar = false } = {}) {
  if (typeof value !== 'string') return null;

  const clean = value.trim();
  if (!clean) return null;
  if (LOCAL_UPLOAD_URL_PATTERN.test(clean)) return encodeDomMediaUrl(`${API_ORIGIN}${clean}`);

  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;
    if (excludeGeneratedAvatar && parsed.hostname.toLowerCase() === GENERATED_AVATAR_HOSTNAME) return null;
    return encodeDomMediaUrl(parsed.href);
  } catch {
    return null;
  }
}

export function resolveSafeAvatarUrl(value) {
  return resolveSafeMediaUrl(value, { excludeGeneratedAvatar: true });
}
