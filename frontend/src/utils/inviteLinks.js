const PUBLIC_APP_URL = String(import.meta.env.VITE_PUBLIC_APP_URL || 'https://tahosapp.com.tr/app/').trim();

export function normalizeInviteCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const queryCode = url.searchParams.get('invite');
    if (queryCode) return queryCode.trim();
    const pathMatch = url.pathname.match(/\/(?:invite|davet)\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim();
  } catch {
    // A plain invite code is valid input too.
  }

  return raw;
}

export function buildInviteUrl(code) {
  const normalizedCode = normalizeInviteCode(code);
  if (!normalizedCode) return '';
  const url = new URL(PUBLIC_APP_URL, 'https://tahosapp.com.tr/');
  url.searchParams.set('invite', normalizedCode);
  return url.toString();
}
