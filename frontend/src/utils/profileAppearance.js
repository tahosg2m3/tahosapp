export const APP_THEME_OPTIONS = Object.freeze([
  { value: 'dark', label: 'Koyu', surface: '#1e293b', background: '#0f172a' },
  { value: 'midnight', label: 'Gece', surface: '#0c1220', background: '#050914' },
  { value: 'light', label: 'Open', surface: '#ffffff', background: '#e8edf5' },
  { value: 'ocean', label: 'Okyanus', surface: '#12314a', background: '#071a2b' },
  { value: 'forest', label: 'Orman', surface: '#173a31', background: '#091f1a' },
  { value: 'rose', label: 'Rose', surface: '#3d1f35', background: '#210f1d' },
  { value: 'sunset', label: 'Sunset', surface: '#4b2b2e', background: '#251315' },
  { value: 'cyber', label: 'Siber', surface: '#172447', background: '#070b20' },
  { value: 'lavender', label: 'Lavanta', surface: '#30264d', background: '#171229' },
  { value: 'coffee', label: 'Kahve', surface: '#392a24', background: '#1c1411' },
]);

export const PROFILE_THEME_OPTIONS = Object.freeze([
  { value: 'default', label: 'Default', colors: ['#334155', '#0f172a'] },
  { value: 'aurora', label: 'Aurora', colors: ['#7c3aed', '#06b6d4'] },
  { value: 'ocean', label: 'Okyanus', colors: ['#0369a1', '#22d3ee'] },
  { value: 'sunset', label: 'Sunset', colors: ['#f97316', '#db2777'] },
  { value: 'forest', label: 'Orman', colors: ['#15803d', '#84cc16'] },
  { value: 'rose', label: 'Rose', colors: ['#be185d', '#f472b6'] },
  { value: 'midnight', label: 'Night light', colors: ['#312e81', '#818cf8'] },
  { value: 'monochrome', label: 'Monokrom', colors: ['#52525b', '#d4d4d8'] },
]);

export const NAME_FONT_OPTIONS = Object.freeze([
  { value: 'default', label: 'Modern' },
  { value: 'rounded', label: 'Yuvarlak' },
  { value: 'serif', label: 'Klasik' },
  { value: 'mono', label: 'Terminal' },
  { value: 'handwritten', label: 'Handwritten' },
  { value: 'wide', label: 'Wide' },
]);

export const NAME_EFFECT_OPTIONS = Object.freeze([
  { value: 'none', label: 'Sade' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'glow', label: 'Glowing' },
  { value: 'shimmer', label: 'Shimmering' },
]);

export const AVATAR_DECORATION_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'ring', label: 'Color ring' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'neon', label: 'Neon' },
  { value: 'orbit', label: 'Orbit' },
]);

export const PROFILE_EFFECT_OPTIONS = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'soft-glow', label: 'Soft glow' },
  { value: 'waves', label: 'Dalgalar' },
  { value: 'stars', label: 'Stars' },
]);

const SAFE_ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

export function getProfileAccent(profile, fallback = '#7c5cff') {
  const candidate = String(profile?.profileAccentColor || '').trim();
  return SAFE_ACCENT_PATTERN.test(candidate) ? candidate : fallback;
}

export function getProfileCssVariables(profile) {
  return { '--profile-accent': getProfileAccent(profile) };
}

export function getNameAppearance(profile) {
  const font = NAME_FONT_OPTIONS.some(option => option.value === profile?.nameFont) ? profile.nameFont : 'default';
  const effect = NAME_EFFECT_OPTIONS.some(option => option.value === profile?.nameEffect) ? profile.nameEffect : 'none';
  return {
    className: `profile-name profile-name-font-${font} profile-name-effect-${effect}`,
    style: getProfileCssVariables(profile),
  };
}

export function getProfileSurface(profile) {
  const theme = PROFILE_THEME_OPTIONS.some(option => option.value === profile?.profileTheme) ? profile.profileTheme : 'default';
  const effect = PROFILE_EFFECT_OPTIONS.some(option => option.value === profile?.profileEffect) ? profile.profileEffect : 'none';
  return {
    className: `profile-surface profile-surface-theme-${theme} profile-effect-${effect}`,
    style: getProfileCssVariables(profile),
  };
}

export function getAvatarDecoration(profile) {
  const decoration = AVATAR_DECORATION_OPTIONS.some(option => option.value === profile?.avatarDecoration)
    ? profile.avatarDecoration
    : 'none';
  return {
    className: `profile-avatar-decoration profile-avatar-decoration-${decoration}`,
    style: getProfileCssVariables(profile),
  };
}
