export const AUTOMATIC_PRESENCE_PREFERENCES_EVENT = 'automatic-presence:preferences-changed';
export const AUTOMATIC_PRESENCE_PREFERENCES_KEY = 'chat:auto-rich-presence-preferences:v1';

export const DEFAULT_AUTOMATIC_PRESENCE_PREFERENCES = Object.freeze({
  enabled: true,
  showGames: true,
  showGamePlatform: true,
  showGameElapsed: true,
  showSpotify: true,
  showYouTubeMusic: true,
  showOtherMusic: true,
  showPausedMusic: true,
  showSongTitle: true,
  showArtist: true,
  showAlbum: true,
  showMusicProgress: true,
  showMusicElapsed: true,
  showBrowserVideos: false,
  showOtherVideos: false,
  showPausedVideos: false,
  showVideoTitle: true,
  showVideoCreator: true,
  showVideoProgress: true,
  showVideoElapsed: true,
});

function normalizePreferences(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_AUTOMATIC_PRESENCE_PREFERENCES)
    .map(([key, fallback]) => [key, typeof candidate[key] === 'boolean' ? candidate[key] : fallback]));
}

export function readAutomaticPresencePreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(AUTOMATIC_PRESENCE_PREFERENCES_KEY) || '{}'));
  } catch (_) {
    return { ...DEFAULT_AUTOMATIC_PRESENCE_PREFERENCES };
  }
}

export function saveAutomaticPresencePreferences(value) {
  const preferences = normalizePreferences(value);
  try {
    localStorage.setItem(AUTOMATIC_PRESENCE_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (_) {
    // Depolama tarayıcı tarafından engellense bile mevcut oturumda seçim uygulanır.
  }
  window.dispatchEvent(new CustomEvent(AUTOMATIC_PRESENCE_PREFERENCES_EVENT, { detail: preferences }));
  return preferences;
}

export function isAutomaticPresenceSessionId(value) {
  return value === 'auto-game'
    || value === 'auto-media'
    || /^auto-(?:media|video)-[a-f0-9]{12}$/.test(String(value || ''));
}

function filterMusic(activity, preferences) {
  const provider = activity.provider || 'other';
  if (provider === 'spotify' && !preferences.showSpotify) return null;
  if (provider === 'youtube-music' && !preferences.showYouTubeMusic) return null;
  if (!['spotify', 'youtube-music'].includes(provider) && !preferences.showOtherMusic) return null;
  if (activity.playbackStatus === 'paused' && !preferences.showPausedMusic) return null;

  const next = { ...activity, music: { ...(activity.music || {}) }, metadata: { ...(activity.metadata || {}) } };
  if (!preferences.showSongTitle) {
    next.details = 'Listening to a song';
    next.music.song = 'A song';
  }
  if (!preferences.showArtist) {
    next.music.artist = '';
    next.state = activity.playbackStatus === 'paused' ? 'Paused' : '';
  }
  if (!preferences.showAlbum) next.music.album = '';
  if (!preferences.showMusicProgress) {
    next.music.durationMs = 0;
    next.music.positionMs = 0;
  }
  next.hideElapsed = !preferences.showMusicElapsed;
  return next;
}

function filterVideo(activity, preferences) {
  const isBrowser = activity.provider === 'browser';
  if (isBrowser ? !preferences.showBrowserVideos : !preferences.showOtherVideos) return null;
  if (activity.playbackStatus === 'paused' && !preferences.showPausedVideos) return null;

  const next = { ...activity, metadata: { ...(activity.metadata || {}) } };
  if (!preferences.showVideoTitle) next.details = 'Watching a video';
  if (!preferences.showVideoCreator) next.state = activity.playbackStatus === 'paused' ? 'Paused' : '';
  if (!preferences.showVideoProgress) next.progress = null;
  next.hideElapsed = !preferences.showVideoElapsed;
  return next;
}

export function filterAutomaticPresenceActivities(value, preferencesValue) {
  const preferences = normalizePreferences(preferencesValue);
  if (!preferences.enabled) return [];

  return (Array.isArray(value) ? value : [])
    .filter(activity => activity && isAutomaticPresenceSessionId(activity.sessionId) && activity.name)
    .map(activity => {
      if (activity.category === 'music' || activity.type === 'listening') return filterMusic(activity, preferences);
      if (activity.category === 'video' || activity.type === 'watching') return filterVideo(activity, preferences);
      if (!preferences.showGames) return null;
      const next = { ...activity, metadata: { ...(activity.metadata || {}) } };
      if (!preferences.showGamePlatform) {
        delete next.metadata.Platform;
        next.state = 'Playing a game';
      }
      next.hideElapsed = !preferences.showGameElapsed;
      return next;
    })
    .filter(Boolean)
    .slice(0, 5);
}
