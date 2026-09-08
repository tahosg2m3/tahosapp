function normalizedSet(value) {
  return new Set(String(value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean));
}

function isPlatformAdmin(user) {
  if (!user) return false;
  if (user.platformRole === 'owner') return true;

  const configuredIds = normalizedSet(process.env.PLATFORM_ADMIN_USER_IDS);
  const configuredEmails = normalizedSet(process.env.PLATFORM_ADMIN_EMAILS);
  const userId = String(user.id || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();

  return Boolean(
    (userId && configuredIds.has(userId))
    || (email && configuredEmails.has(email))
  );
}

function requirePlatformAdmin(req, res, next) {
  if (!isPlatformAdmin(req.user)) {
    return res.status(403).json({ error: 'Bu işlem yalnızca tahosapp yöneticisine açıktır.' });
  }
  return next();
}

module.exports = { isPlatformAdmin, requirePlatformAdmin };
