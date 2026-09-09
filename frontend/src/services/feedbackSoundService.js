import {
  applyAudioOutputDevice,
  getSelectedAudioOutputDeviceId,
  registerAudioOutputTarget,
} from './audioOutputService';

// Bu klasöre sonradan eklenen MP3/WAV/OGG dosyaları Vite tarafından otomatik
// olarak bulunur. Yeni ses ekledikten sonra geliştirme sunucusunu yeniden başlat.
const discoveredSoundAssets = import.meta.glob('../assets/sounds/feedback/*.{mp3,wav,ogg}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const FEEDBACK_SOUND_IDS = Object.freeze({
  MESSAGE: 'message',
  DEAFEN: 'deafen',
  UNDEAFEN: 'undeafen',
  MUTE: 'mute',
  UNMUTE: 'unmute',
  LEAVE_CALL: 'leaveCall',
  PTT_ACTIVATE: 'pttActivate',
  PTT_DEACTIVATE: 'pttDeactivate',
  USER_JOINS: 'userJoins',
  USER_LEAVES: 'userLeaves',
  MOVED: 'moved',
  OUTGOING_CALL: 'outgoingCall',
  STREAM_STARTED: 'streamStarted',
  STREAM_STOPPED: 'streamStopped',
  USER_JOINED_STREAM: 'userJoinedStream',
  USER_LEFT_STREAM: 'userLeftStream',
  INCOMING_CALL: 'incomingCall',
});

const SOUND_FILE_CANDIDATES = Object.freeze({
  [FEEDBACK_SOUND_IDS.MESSAGE]: ['message', 'message-notification'],
  [FEEDBACK_SOUND_IDS.DEAFEN]: ['deafen'],
  [FEEDBACK_SOUND_IDS.UNDEAFEN]: ['undeafen'],
  [FEEDBACK_SOUND_IDS.MUTE]: ['mute'],
  [FEEDBACK_SOUND_IDS.UNMUTE]: ['unmute'],
  [FEEDBACK_SOUND_IDS.LEAVE_CALL]: ['leave-call', 'user-leaves', 'user-leave'],
  [FEEDBACK_SOUND_IDS.PTT_ACTIVATE]: ['ptt-activate', 'push-to-talk-activate'],
  [FEEDBACK_SOUND_IDS.PTT_DEACTIVATE]: ['ptt-deactivate', 'push-to-talk-deactivate'],
  [FEEDBACK_SOUND_IDS.USER_JOINS]: ['user-joins', 'user-joins-call-sound'],
  [FEEDBACK_SOUND_IDS.USER_LEAVES]: ['user-leaves', 'user-leave'],
  [FEEDBACK_SOUND_IDS.MOVED]: ['moved'],
  [FEEDBACK_SOUND_IDS.OUTGOING_CALL]: ['outgoing-call'],
  [FEEDBACK_SOUND_IDS.STREAM_STARTED]: ['stream-started'],
  [FEEDBACK_SOUND_IDS.STREAM_STOPPED]: ['stream-stopped'],
  [FEEDBACK_SOUND_IDS.USER_JOINED_STREAM]: ['user-joined-stream'],
  [FEEDBACK_SOUND_IDS.USER_LEFT_STREAM]: ['user-left-stream'],
  [FEEDBACK_SOUND_IDS.INCOMING_CALL]: ['incoming-call'],
});

// Gönderilen test çıkış kaydı düşük olduğu has yalnız bu ses yükseltilir.
// Yeni dosya zaten yüksekse bu değeri 1 yapabilirsin.
const DEFAULT_GAINS = Object.freeze({
  [FEEDBACK_SOUND_IDS.LEAVE_CALL]: 2.2,
  [FEEDBACK_SOUND_IDS.USER_LEAVES]: 2.2,
});

function normalizeFileName(path) {
  return String(path || '')
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const soundUrlByName = new Map(
  Object.entries(discoveredSoundAssets).map(([path, url]) => [normalizeFileName(path), url]),
);

function resolveSoundUrl(soundId) {
  const candidates = SOUND_FILE_CANDIDATES[soundId] || [];
  const matchingName = candidates.find(name => soundUrlByName.has(name));
  return matchingName ? soundUrlByName.get(matchingName) : null;
}

function reportPlaybackError(error) {
  if (error?.name !== 'NotAllowedError') {
    console.warn('Could not play feedback sound:', error);
  }
}

export function playFeedbackSound(soundId, options = {}) {
  const soundUrl = resolveSoundUrl(soundId);
  if (!soundUrl || typeof Audio === 'undefined') return false;

  try {
    const audio = new Audio(soundUrl);
    const volume = Number(options.volume ?? localStorage.getItem('feedback:sound-volume') ?? 1);
    const gainAmount = Number(options.gain ?? DEFAULT_GAINS[soundId] ?? 1);
    audio.preload = 'auto';
    audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;

    const play = () => Promise.resolve(audio.play());

    const playDirectlyOnSelectedOutput = () => {
      const unregisterOutput = registerAudioOutputTarget(audio);
      const cleanupOutput = () => unregisterOutput();
      audio.addEventListener('ended', cleanupOutput, { once: true });
      audio.addEventListener('error', cleanupOutput, { once: true });
      void applyAudioOutputDevice(audio).then(play).catch((error) => {
        cleanupOutput();
        reportPlaybackError(error);
      });
      return true;
    };

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!Number.isFinite(gainAmount) || gainAmount <= 1 || !AudioContextClass) {
      return playDirectlyOnSelectedOutput();
    }

    const audioContext = new AudioContextClass();
    // Chooseili özel aygıtı AudioContext'e yönlendiremeyen eski ortamlarda
    // yükseltme efektinden vazgeçip HTMLAudioElement yolunu kullanırız. Böylece
    // ses yüksekliği yerine yanlış hoparlörden çalma hatasını tercih etmeyiz.
    if (getSelectedAudioOutputDeviceId() && typeof audioContext.setSinkId !== 'function') {
      void audioContext.close().catch(() => {});
      return playDirectlyOnSelectedOutput();
    }
    const source = audioContext.createMediaElementSource(audio);
    const gainNode = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    gainNode.gain.value = gainAmount;
    compressor.threshold.value = -6;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    source.connect(gainNode).connect(compressor).connect(audioContext.destination);

    let cleaned = false;
    const unregisterOutput = registerAudioOutputTarget(audioContext);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      source.disconnect();
      gainNode.disconnect();
      compressor.disconnect();
      unregisterOutput();
      void audioContext.close().catch(() => {});
    };
    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup, { once: true });
    void applyAudioOutputDevice(audioContext).then(() => audioContext.resume()).then(play).catch((error) => {
      cleanup();
      reportPlaybackError(error);
    });
    return true;
  } catch (error) {
    reportPlaybackError(error);
    return false;
  }
}

export function hasFeedbackSound(soundId) {
  return Boolean(resolveSoundUrl(soundId));
}

export function startFeedbackSoundLoop(soundId, options = {}) {
  const soundUrl = resolveSoundUrl(soundId);
  if (!soundUrl || typeof Audio === 'undefined') return () => {};

  const audio = new Audio(soundUrl);
  const volume = Number(options.volume ?? localStorage.getItem('feedback:sound-volume') ?? 1);
  const maxDurationMs = Math.min(30_000, Math.max(1_000, Number(options.maxDurationMs) || 30_000));
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;

  let stopped = false;
  let timer = null;
  const unregisterOutput = registerAudioOutputTarget(audio);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) window.clearTimeout(timer);
    audio.pause();
    audio.currentTime = 0;
    unregisterOutput();
  };

  void applyAudioOutputDevice(audio).then(() => {
    if (stopped) return;
    const result = audio.play();
    result?.catch?.(reportPlaybackError);
  }).catch(reportPlaybackError);
  timer = window.setTimeout(stop, maxDurationMs);
  return stop;
}
