const express = require('express');
const { rateLimit } = require('express-rate-limit');
const storage = require('../storage/inMemory');
const { requireAuth } = require('../middleware/auth');
const { isPlatformAdmin, requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
const adminRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many administrative requests. Please wait a moment.' },
});

// Istek siniri pahali JWT, kullanici and yonetici yetkisi kontrollerinden once
// uygulanir. Boylece gecersiz/anonim istekler de bu kontrolleri sinirsiz
// tetikleyerek servisi yoramaz.
router.use(adminRateLimit, requireAuth, requirePlatformAdmin);

function adminUser(user) {
  const ban = storage.getUserPlatformBan(user.id);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar || null,
    createdAt: Number(user.createdAt) || null,
    status: storage.getUserStatus(user.id),
    isPlatformAdmin: isPlatformAdmin(user),
    banned: Boolean(ban),
    ban,
  };
}

router.get('/overview', (req, res) => {
  const query = String(req.query.query || '').trim().toLocaleLowerCase('en-US').slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const allUsers = storage.getAllUsers();
  const matchingUsers = query
    ? allUsers.filter(user => (
      String(user.username || '').toLocaleLowerCase('en-US').includes(query)
      || String(user.email || '').toLocaleLowerCase('en-US').includes(query)
      || String(user.id || '').toLowerCase().includes(query)
    ))
    : allUsers;

  return res.json({
    totalUsers: allUsers.length,
    bannedUsers: allUsers.filter(user => storage.isUserPlatformBanned(user.id)).length,
    matchingUsers: matchingUsers.length,
    users: matchingUsers.slice(offset, offset + limit).map(adminUser),
  });
});

router.put('/users/:userId/ban', (req, res) => {
  const target = storage.getUserById(String(req.params.userId || ''));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot ban your own account.' });
  if (isPlatformAdmin(target)) return res.status(403).json({ error: 'Another tahosapp administrator cannot be banned.' });

  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (reason.length < 3) return res.status(400).json({ error: 'The ban reason must be at least 3 characters.' });

  const ban = storage.setUserPlatformBan(target.id, {
    reason,
    bannedBy: req.user.id,
  });
  const io = req.app.get('io');
  io?.to(`user:${target.id}`).emit('platform:account-banned', { reason: ban.reason });
  io?.in(`user:${target.id}`).disconnectSockets(true);

  return res.json({ user: adminUser(target) });
});

router.delete('/users/:userId/ban', (req, res) => {
  const target = storage.getUserById(String(req.params.userId || ''));
  if (!target) return res.status(404).json({ error: 'User not found.' });

  storage.clearUserPlatformBan(target.id, req.user.id);
  return res.json({ user: adminUser(target) });
});

module.exports = router;
