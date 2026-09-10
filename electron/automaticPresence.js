const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MAX_LINE_BYTES = 2 * 1024 * 1024;

const KNOWN_GAMES = new Map(Object.entries({
  'aces.exe': 'War Thunder',
  'among us.exe': 'Among Us',
  'bg3.exe': "Baldur's Gate 3",
  'cs2.exe': 'Counter-Strike 2',
  'cyberpunk2077.exe': 'Cyberpunk 2077',
  'destiny2.exe': 'Destiny 2',
  'dota2.exe': 'Dota 2',
  'eldenring.exe': 'Elden Ring',
  'escape from tarkov.exe': 'Escape from Tarkov',
  'factorio.exe': 'Factorio',
  'fallguys_client_game.exe': 'Fall Guys',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V Enhanced',
  'helldivers2.exe': 'HELLDIVERS 2',
  'javaw.exe': 'Minecraft: Java Edition',
  'league of legends.exe': 'League of Legends',
  'minecraft.windows.exe': 'Minecraft',
  'overwatch.exe': 'Overwatch 2',
  'pubg-win64-shipping.exe': 'PUBG: Battlegrounds',
  'r5apex.exe': 'Apex Legends',
  'rainbowsix.exe': "Tom Clancy's Rainbow Six Siege",
  'robloxplayerbeta.exe': 'Roblox',
  'rocketleague.exe': 'Rocket League',
  'starfield.exe': 'Starfield',
  'terraria.exe': 'Terraria',
  'valorant-win64-shipping.exe': 'VALORANT',
  'witcher3.exe': 'The Witcher 3',
}));

const IGNORED_EXECUTABLES = new Set([
  'applicationframehost.exe', 'battle.net.exe', 'chrome.exe', 'code.exe',
  'eadesktop.exe', 'epicgameslauncher.exe',
  'eosoverlayrenderer-win64-shipping.exe', 'epiconlineservicesuserhelper.exe',
  'epicwebhelper.exe',
  'explorer.exe', 'firefox.exe', 'gamebar.exe', 'gog galaxy.exe', 'msedge.exe',
  'opera.exe', 'powershell.exe', 'pwsh.exe', 'riotclientservices.exe',
  'spotify.exe', 'steam.exe', 'steamwebhelper.exe', 'tahosapp.exe',
  'ubisoftconnect.exe', 'vivaldi.exe', 'windowsterminal.exe',
  'wallpaper32.exe', 'wallpaper64.exe', 'webwallpaper64.exe', 'winrtutil32.exe',
]);

const STORE_PATHS = [
  { marker: '\\steamapps\\common\\', platform: 'Steam' },
  { marker: '\\xboxgames\\', platform: 'Xbox' },
  { marker: '\\epic games\\', platform: 'Epic Games' },
  { marker: '\\riot games\\', platform: 'Riot Games' },
  { marker: '\\ea games\\', platform: 'EA' },
  { marker: '\\gog galaxy\\games\\', platform: 'GOG' },
  { marker: '\\ubisoft game launcher\\games\\', platform: 'Ubisoft' },
];

function cleanText(value, maximumLength = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function executableName(processInfo) {
  const fromPath = path.win32.basename(cleanText(processInfo?.path, 520)).toLowerCase();
  if (fromPath) return fromPath;
  const name = cleanText(processInfo?.name, 120).toLowerCase();
  return name.endsWith('.exe') ? name : `${name}.exe`;
}

function titleFromStorePath(executablePath, store) {
  const normalized = cleanText(executablePath, 520).replace(/\//g, '\\');
  const lower = normalized.toLowerCase();
  const markerIndex = lower.indexOf(store.marker);
  if (markerIndex === -1) return '';
  const relative = normalized.slice(markerIndex + store.marker.length);
  return cleanText(relative.split('\\').filter(Boolean)[0], 80);
}

function classifyGame(processInfo) {
  const executable = executableName(processInfo);
  if (!executable || IGNORED_EXECUTABLES.has(executable)) return null;
  const executablePath = cleanText(processInfo?.path, 520).replace(/\//g, '\\');
  const lowerPath = executablePath.toLowerCase();
  if (lowerPath.includes('\\epic games\\launcher\\')
    || lowerPath.includes('\\epic games\\epic online services\\')
    || lowerPath.includes('\\riot games\\riot client\\')) return null;
  if (executable === 'javaw.exe'
    && !lowerPath.includes('\\.minecraft\\')
    && !/minecraft/i.test(cleanText(processInfo?.title, 240))) return null;
  // Roblox leaves RobloxPlayerBeta.exe alive in the background after its game
  // window closes. Only publish it while an actual player window exists.
  if (executable === 'robloxplayerbeta.exe'
    && processInfo?.hasWindow !== true
    && !cleanText(processInfo?.title, 240)) return null;
  const knownName = KNOWN_GAMES.get(executable);
  const store = STORE_PATHS.find(item => lowerPath.includes(item.marker));
  if (!knownName && !store) return null;

  const storeName = store ? titleFromStorePath(executablePath, store) : '';
  const name = knownName || storeName || cleanText(processInfo?.title, 80);
  if (!name) return null;
  return {
    score: (knownName ? 200 : 100) + (processInfo?.title ? 10 : 0),
    activity: {
      sessionId: 'auto-game',
      type: 'playing',
      name,
      details: 'Playing',
      state: store?.platform ? `Playing via ${store.platform}` : 'Playing a game',
      startedAt: Number(processInfo?.startedAt) || Date.now(),
      ttlSeconds: 60,
      metadata: {
        Source: 'Automatic detection',
        ...(store?.platform ? { Platform: store.platform } : {}),
      },
    },
  };
}

function automaticMediaSessionId(prefix, sourceId) {
  const digest = crypto.createHash('sha256').update(sourceId || prefix).digest('hex').slice(0, 12);
  return `auto-${prefix}-${digest}`;
}

function classifyMedia(media) {
  if (!media) return null;
  const rawPlaybackStatus = cleanText(media.playbackStatus, 32).toLowerCase();
  if (!['playing', 'paused'].includes(rawPlaybackStatus)) return null;
  const sourceId = cleanText(media.sourceId, 200).toLowerCase();
  const browserSource = /(chrome|msedge|firefox|opera|vivaldi)/.test(sourceId);
  const reportedPlaybackType = cleanText(media.playbackType, 32).toLowerCase();
  const isSpotify = sourceId.includes('spotify');
  const isYouTubeMusic = sourceId.includes('youtubemusic')
    || sourceId.includes('youtube music')
    || sourceId.includes('cinhimbnkkghhklpknlkffjgod');
  const category = isSpotify || isYouTubeMusic
    ? 'music'
    : browserSource || reportedPlaybackType === 'video'
      ? 'video'
      : 'music';
  const provider = isSpotify
    ? 'Spotify'
    : isYouTubeMusic
      ? 'YouTube Music'
      : browserSource
        ? 'Browser video'
        : category === 'video' ? 'Video player' : 'Media player';
  const title = cleanText(media.title, 100);
  const artist = cleanText(media.artist, 100);
  if (!title) return null;
  const isPaused = rawPlaybackStatus === 'paused';
  const positionMs = Math.max(0, Number(media.positionMs) || 0);
  const durationMs = Math.max(0, Number(media.durationMs) || 0);
  const mediaPrefix = category === 'video' ? 'video' : 'media';

  return {
    sessionId: automaticMediaSessionId(mediaPrefix, sourceId),
    type: category === 'video' ? 'watching' : 'listening',
    category,
    provider: isSpotify ? 'spotify' : isYouTubeMusic ? 'youtube-music' : browserSource ? 'browser' : 'other',
    playbackStatus: isPaused ? 'paused' : 'playing',
    name: provider,
    details: title,
    state: artist || (isPaused ? 'Paused' : ''),
    startedAt: Date.now() - positionMs,
    ttlSeconds: 60,
    ...(category === 'music' ? {
      music: {
        song: title,
        artist,
        album: cleanText(media.album, 100),
        durationMs,
        positionMs,
      },
    } : durationMs > 0 ? {
      progress: {
        current: positionMs,
        total: durationMs,
        label: 'Video ilerlemesi',
      },
    } : {}),
    metadata: {
      Source: 'Automatic detection',
      Service: provider,
      State: isPaused ? 'Paused' : 'Playing',
    },
  };
}

function classifySnapshot(snapshot) {
  const processes = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
  const mediaSessions = Array.isArray(snapshot?.media) ? snapshot.media : [];
  const games = processes.map(classifyGame).filter(Boolean).sort((a, b) => (
    b.score - a.score || Number(b.activity?.startedAt || 0) - Number(a.activity?.startedAt || 0)
  ));
  const mediaActivities = mediaSessions
    .map(item => ({ item, activity: classifyMedia(item) }))
    .filter(entry => entry.activity)
    .sort((a, b) => (
      Number(b.item?.isCurrent) - Number(a.item?.isCurrent)
      || Number(/^playing$/i.test(b.item?.playbackStatus)) - Number(/^playing$/i.test(a.item?.playbackStatus))
    ))
    .map(entry => entry.activity)
    .filter((activity, index, all) => all.findIndex(item => item.sessionId === activity.sessionId) === index)
    .slice(0, 4);

  return [games[0]?.activity, ...mediaActivities].filter(Boolean).slice(0, 5);
}

function safeScannerEnvironment() {
  const keys = ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE'];
  return Object.fromEntries(keys
    .map(key => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string' && value));
}

class AutomaticPresenceDetector {
  constructor({ onActivities, onError } = {}) {
    this.onActivities = typeof onActivities === 'function' ? onActivities : () => {};
    this.onError = typeof onError === 'function' ? onError : () => {};
    this.child = null;
    this.restartTimer = null;
    this.stopping = false;
    this.lastDigest = '';
  }

  start() {
    if (process.platform !== 'win32' || this.child || this.stopping) return false;
    const scriptPath = path.join(__dirname, 'windows-presence-scanner.ps1');
    const encodedScript = fs.readFileSync(scriptPath, 'utf8');
    const encodedCommand = Buffer.from(encodedScript, 'utf16le').toString('base64');
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedCommand,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: safeScannerEnvironment(),
    });
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return;
      try {
        const activities = classifySnapshot(JSON.parse(line));
        const digest = crypto.createHash('sha256').update(JSON.stringify(activities)).digest('hex');
        // Aynı içerik de süre aşımına uğramasın diye her taramada gönderilir.
        this.lastDigest = digest;
        this.onActivities(activities);
      } catch (error) {
        this.onError(new Error(`Could not read automatic activity output: ${error.message}`));
      }
    });
    child.stderr.on('data', chunk => {
      const message = cleanText(chunk.toString('utf8'), 240);
      if (message && !message.includes('#< CLIXML')) this.onError(new Error(message));
    });
    child.once('error', error => this.onError(error));
    child.once('exit', () => {
      lines.close();
      if (this.child === child) this.child = null;
      if (!this.stopping) {
        this.restartTimer = setTimeout(() => this.start(), 5_000);
        this.restartTimer.unref?.();
      }
    });
    return true;
  }

  stop() {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
  }
}

module.exports = {
  AutomaticPresenceDetector,
  classifySnapshot,
};
