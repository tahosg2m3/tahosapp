// backend/src/server.js - KOMPLE GÜNCEL VERSİYON
// FatalError/OOM tanı raporlarında SMTP/JWT/veri anahtarı gibi ortam sırlarını
// dışarıda tut. Bu ayar uygulama modülleri yüklenmeden önce yapılmalıdır.
try {
  if (process.report && 'excludeEnv' in process.report) process.report.excludeEnv = true;
} catch (_) {
  // Eski Node sürümlerinde not supportedsa normal başlangıç devam eder.
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Route/middleware modülleri yüklenmeden önce .env'i oku; JWT and APP_DATA_DIR
// gibi güvenlik/persist ayarları modül yüklenirken kullanılır.
dotenv.config();
if (process.env.RUNTIME_ENV_FILE || process.env.SMTP_ENV_FILE) {
  dotenv.config({
    path: process.env.RUNTIME_ENV_FILE || process.env.SMTP_ENV_FILE,
    override: false,
  });
}

const storage = require('./storage/inMemory');
const { hashPassword, isLegacyPlaintextPassword } = require('./services/passwordService');

const serverRoutes = require('./routes/servers');
const roleRoutes = require('./routes/roles');
const channelRoutes = require('./routes/channels');
const userRoutes = require('./routes/users');
const authRoutes = require('./routes/auth');
const dmRoutes = require('./routes/dm');
const friendRoutes = require('./routes/friends');
const uploadRoutes = require('./routes/upload');
const gifRoutes = require('./routes/gifs');
const richPresenceRoutes = require('./routes/richPresence');
const spotifyRoutes = require('./routes/spotify');
const turnRoutes = require('./routes/turn');
const platformRoutes = require('./routes/platform');
const feedbackRoutes = require('./routes/feedback');
const adminRoutes = require('./routes/admin');
const { richPresenceService } = require('./services/richPresenceService');

const setupSocketHandlers = require('./sockets');
const { disconnectPeerFromVoice } = require('./sockets/handlers/voiceHandler');
const { startPeerServer } = require('./peerServer');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./middleware/logger');

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
// Production traffic is proxied by Caddy on the same machine. Trust only
// loopback proxies so req.ip and per-client rate limits use the real client IP
// without accepting spoofed X-Forwarded-For headers from the public internet.
app.set('trust proxy', 'loopback');
const server = http.createServer(app);
const DESKTOP_CLIENT_ORIGIN = 'tahosapp://app';
// Eski masaüstü sürümlerinin otomatik güncellemeyi alabilmesi has geçici
// uyumluluk. En az bir sürüm döngüsünden sonra kaldırılabilir.
const LEGACY_DESKTOP_CLIENT_ORIGIN = 'discord-clone://app';
const configuredClientOrigins = new Set(String(process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean));
configuredClientOrigins.add(DESKTOP_CLIENT_ORIGIN);
configuredClientOrigins.add(LEGACY_DESKTOP_CLIENT_ORIGIN);
const allowConfiguredClientOrigin = (origin, callback) => {
  // Health checks and native/non-browser clients may omit Origin. Browser and
  // Electron renderer requests must match the explicit allowlist exactly.
  if (!origin || configuredClientOrigins.has(origin)) {
    callback(null, true);
    return;
  }

  const error = new Error('Client origin is not allowed.');
  error.status = 403;
  error.code = 'CORS_ORIGIN_DENIED';
  callback(error);
};
const uploadsDirectory = process.env.APP_DATA_DIR
  ? path.join(path.resolve(process.env.APP_DATA_DIR), 'uploads')
  : path.join(__dirname, '../uploads');

const io = new Server(server, {
  cors: {
    origin: allowConfiguredClientOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Filelar HTTP upload endpoint'inden gider. Socket paketleri yalnız mesaj ve
  // sinyal verisi taşır; bu sınır bellek tüketimi saldırılarını daraltır.
  maxHttpBufferSize: 1024 * 1024,
});

app.use(cors({
  origin: allowConfiguredClientOrigin,
  credentials: true,
}));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  });
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 100 }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object') return next();
  const pending = [req.body];
  let inspectedNodes = 0;
  while (pending.length) {
    const value = pending.pop();
    inspectedNodes += 1;
    if (inspectedNodes > 10_000) {
      return res.status(413).json({ error: 'The request structure is more complex than allowed.' });
    }
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        return res.status(400).json({ error: 'The request contains an unsafe field name.' });
      }
      const child = value[key];
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return next();
});
app.use(logger);

// Static files for uploads
app.use('/uploads', express.static(uploadsDirectory, {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  redirect: false,
  setHeaders: (res, filePath) => {
    res.set('X-Content-Type-Options', 'nosniff');
    // Desktop builds run under tahosapp://app, so user-uploaded media must be
    // embeddable from that isolated renderer origin. The flat, immutable upload
    // route contains no executable content and is still protected by nosniff.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    if (/\.(?:pdf|doc|docx|txt)$/i.test(filePath)) res.set('Content-Disposition', 'attachment');
  },
}));

// Routes
app.use('/api/servers', serverRoutes);
app.use('/api/servers', roleRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dm', dmRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/gifs', gifRoutes);
app.use('/api/rich-presence', richPresenceRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/turn-credentials', turnRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
// Yeni platform özellikleri tam API yollarını kendi router'ında tanımlar.
// Eski endpoint'ler yukarıda kalır and geriye dönük uyumluluğunu korur.
app.use('/api', platformRoutes);

app.get('/health', (req, res) => {
  if (process.env.DESKTOP_INSTANCE_TOKEN) {
    res.set('X-Tahosapp-Instance', process.env.DESKTOP_INSTANCE_TOKEN);
  }
  const peerReady = Boolean(peerServerController?.isReady());
  res.status(peerReady ? 200 : 503).json({
    status: peerReady ? 'ok' : (peerServerController?.startupError ? 'error' : 'starting'),
    services: { api: 'ok', peer: peerReady ? 'ok' : 'unavailable' },
    timestamp: new Date().toISOString(),
  });
});

richPresenceService.setIo(io);
setupSocketHandlers(io, {
  isPeerAvailable: peerId => Boolean(peerServerController?.hasClient(peerId)),
});
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
const HOST = String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1';
let peerServerController = null;
let isShuttingDown = false;

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.once('error', error => {
  console.error(`HTTP server could not start: ${error.message}`);
  storage.close();
  process.exit(1);
});

async function migrateLegacyPlaintextPasswords() {
  const legacyUsers = storage.getAllUsers().filter(user => isLegacyPlaintextPassword(user.password));
  if (!legacyUsers.length) return 0;

  // Düz text bırakılmış çok eski kayıtları servis istek kabul etmeden önce
  // Argon2id'e çevir. Bcrypt hashleri parola bilinmeden dönüştürülemez; onlar
  // başarılı ilk girişte auth akışı tarafından yükseltilir.
  let migratedCount = 0;
  for (const user of legacyUsers) {
    if (isShuttingDown) break;
    const passwordHash = await hashPassword(user.password);
    // Hash çalışırken kapanış başladıysa kapanmış storage'a yazma yapma.
    if (isShuttingDown) break;
    storage.updateUserPassword(user.id, passwordHash, { invalidateSessions: false });
    migratedCount += 1;
  }
  if (isShuttingDown) return migratedCount;
  if (!storage.flush()) throw new Error('The Argon2id password migration could not be saved to disk.');
  return migratedCount;
}

async function migrateArchivedPlaintextPasswords() {
  if (isShuttingDown) return 0;
  return storage.transformArchivedSnapshots(async snapshot => {
    if (isShuttingDown) return { snapshot, changed: false, changedCount: 0 };
    if (!Array.isArray(snapshot?.users)) {
      return { snapshot, changed: false, changedCount: 0 };
    }

    let changedCount = 0;
    for (const user of snapshot.users) {
      if (isShuttingDown) return { snapshot, changed: false, changedCount: 0 };
      if (!isLegacyPlaintextPassword(user?.password)) continue;
      const passwordHash = await hashPassword(user.password);
      if (isShuttingDown) return { snapshot, changed: false, changedCount: 0 };
      user.password = passwordHash;
      changedCount += 1;
    }

    return {
      snapshot,
      changed: changedCount > 0,
      changedCount,
    };
  });
}

async function startServices() {
  if (isShuttingDown) return;
  const migratedPasswordCount = await migrateLegacyPlaintextPasswords();
  if (isShuttingDown) return;
  if (migratedPasswordCount) {
    console.log('🔐 Legacy passwords were safely migrated to Argon2id.');
  }
  const migratedArchivedPasswordCount = await migrateArchivedPlaintextPasswords();
  if (isShuttingDown) return;
  if (migratedArchivedPasswordCount) {
    console.log('🔐 Passwords in legacy encrypted snapshots were migrated to Argon2id.');
  }

  server.listen(PORT, HOST, () => {
    if (isShuttingDown) return;
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    console.log('📡 WebSocket server ready');
    console.log(`🌐 CORS enabled for ${Array.from(configuredClientOrigins).join(', ')}`);

    peerServerController = startPeerServer({
      onPeerDisconnect: peerId => disconnectPeerFromVoice(io, peerId),
    });
  });
}

startServices().catch(error => {
  console.error(`Secure backend startup failed: ${error.message}`);
  storage.close();
  process.exit(1);
});

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} signal received: closing HTTP server`);

  // Debounce edilmiş son yazıyı bağlantıları kapatmadan önce diske bas.
  // Paketli Electron, Windows'ta da çalışan IPC kapanış mesajını kullanır.
  let persistenceFailed = storage.flush() !== true;
  if (persistenceFailed) {
    console.error('The final application state could not be persisted during shutdown.');
  }

  let pendingServers = 2;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    richPresenceService.close();
    if (storage.close() !== true) persistenceFailed = true;
    console.log('HTTP and PeerJS servers closed');
    process.exit(persistenceFailed ? 1 : 0);
  };
  const markServerClosed = () => {
    pendingServers -= 1;
    if (pendingServers <= 0) finish();
  };

  try {
    io.close(() => {
      if (!server.listening) {
        markServerClosed();
        return;
      }

      server.close(markServerClosed);
      server.closeIdleConnections?.();
    });
  } catch (_) {
    if (server.listening) server.close(markServerClosed);
    else markServerClosed();
  }

  if (peerServerController) peerServerController.close(markServerClosed);
  else markServerClosed();

  setTimeout(() => {
    if (finished) return;
    storage.close();
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('message', message => {
  if (message?.type === 'tahosapp:shutdown') shutdown('IPC');
});
process.parentPort?.once('message', event => {
  if (event?.data?.type === 'tahosapp:shutdown') shutdown('IPC');
});

app.set('io', io);
