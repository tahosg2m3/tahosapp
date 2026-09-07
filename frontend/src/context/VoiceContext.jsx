import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Peer } from 'peerjs';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import {
  createRnnoiseProcessor,
  isRnnoiseRuntimeSupported,
  RNNOISE_SAMPLE_RATE,
} from '../services/rnnoiseProcessor';
import { FEEDBACK_SOUND_IDS, playFeedbackSound } from '../services/feedbackSoundService';
import { setGlobalAudioOutputDevice } from '../services/audioOutputService';
import { getPeerIceServers, withPeerIceServers } from '../services/turnService';
import { PEER_CONFIG as RUNTIME_PEER_CONFIG } from '../config/runtimeConfig';

const VoiceContext = createContext(null);

// Yerel geliştirme, Electron ve dağıtım ortamlarında PeerJS adresi ayrı ayrı
// ayarlanabilir. Peer sunucusunda discovery kapalı olduğu için istemci tarafında
// rastgele peer keşfi yapılmaz.
const PEER_CONFIG = {
  ...RUNTIME_PEER_CONFIG,
  debug: import.meta.env.DEV ? 2 : 0,
};

const DEFAULT_CAPABILITIES = Object.freeze({
  channelId: null,
  serverId: null,
  canConnect: false,
  canSpeak: false,
  canStream: false,
  serverMuted: false,
  serverDeafened: false,
  isTimedOut: false,
});

export const VOICE_ISOLATION_MODES = Object.freeze(['off', 'standard', 'strong']);
export const AUDIO_QUALITY_PRESETS = Object.freeze(['standard', 'high', 'studio']);

const AUDIO_QUALITY_CONFIG = Object.freeze({
  standard: Object.freeze({ sampleRate: 48000, channelCount: 1, sampleSize: 16, maxBitrate: 64000 }),
  high: Object.freeze({ sampleRate: 48000, channelCount: 1, sampleSize: 24, maxBitrate: 96000 }),
  studio: Object.freeze({ sampleRate: 48000, channelCount: 2, sampleSize: 24, maxBitrate: 128000 }),
});

function normalizeVoiceIsolationMode(mode) {
  return VOICE_ISOLATION_MODES.includes(mode) ? mode : 'standard';
}

function normalizeAudioQuality(quality) {
  return AUDIO_QUALITY_PRESETS.includes(quality) ? quality : 'high';
}

function getInitialVoiceIsolationMode() {
  const storedMode = localStorage.getItem('voice:isolation-mode');
  if (VOICE_ISOLATION_MODES.includes(storedMode)) return storedMode;

  // Eski tek gürültü azaltma anahtarını yeni üç kademeli ayara taşı.
  return localStorage.getItem('voice:noise-suppression') === 'false' ? 'off' : 'standard';
}

export const useVoice = () => useContext(VoiceContext);

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function hasLiveAudioTrack(stream) {
  return Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'));
}

function normalizeCapabilities(capabilities = {}) {
  return {
    ...DEFAULT_CAPABILITIES,
    ...capabilities,
    canConnect: Boolean(capabilities.canConnect),
    canSpeak: Boolean(capabilities.canSpeak),
    canStream: Boolean(capabilities.canStream),
    serverMuted: Boolean(capabilities.serverMuted),
    serverDeafened: Boolean(capabilities.serverDeafened),
    isTimedOut: Boolean(capabilities.isTimedOut),
  };
}

function sameId(first, second) {
  return String(first || '') === String(second || '');
}

function getSupportedMediaConstraints() {
  try {
    return navigator.mediaDevices?.getSupportedConstraints?.() || null;
  } catch {
    return null;
  }
}

function buildAudioConstraints({ deviceId, isolationMode, audioQuality, includeQuality = true }) {
  const supported = getSupportedMediaConstraints();
  const supports = (key) => !supported || Boolean(supported[key]);
  const quality = AUDIO_QUALITY_CONFIG[audioQuality] || AUDIO_QUALITY_CONFIG.high;
  const processingEnabled = isolationMode !== 'off';
  const useRnnoise = isolationMode === 'strong' && isRnnoiseRuntimeSupported();
  const constraints = {};

  if (deviceId && supports('deviceId')) constraints.deviceId = { exact: deviceId };
  if (supports('echoCancellation')) constraints.echoCancellation = processingEnabled;
  // RNNoise ile tarayıcı gürültü engellemesini üst üste çalıştırmak metalik
  // ses/pumping üretebilir. Güçlü modda yankı engelleme kalır; gürültü ve AGC
  // işlemini RNNoise + aşağıdaki kontrollü Web Audio zinciri üstlenir.
  if (supports('noiseSuppression')) constraints.noiseSuppression = processingEnabled && !useRnnoise;
  if (supports('autoGainControl')) constraints.autoGainControl = processingEnabled && !useRnnoise;
  if (supports('voiceIsolation')) constraints.voiceIsolation = isolationMode === 'strong' && !useRnnoise;

  if (includeQuality) {
    if (supports('sampleRate')) constraints.sampleRate = { ideal: useRnnoise ? RNNOISE_SAMPLE_RATE : quality.sampleRate };
    if (supports('channelCount')) constraints.channelCount = { ideal: useRnnoise ? 1 : quality.channelCount };
    if (supports('sampleSize')) constraints.sampleSize = { ideal: quality.sampleSize };
    if (supports('latency')) constraints.latency = { ideal: 0.02 };
  }

  return constraints;
}

async function captureMicrophone({ deviceId, isolationMode, audioQuality }) {
  const fullConstraints = buildAudioConstraints({ deviceId, isolationMode, audioQuality });
  const processingConstraints = buildAudioConstraints({
    deviceId,
    isolationMode,
    audioQuality,
    includeQuality: false,
  });
  const deviceConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
  const attempts = [fullConstraints, processingConstraints, deviceConstraints];
  if (deviceId) attempts.push(true);

  let lastError;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: attempts[index], video: false });
      return {
        stream,
        usedConstraintFallback: index > 0,
        usedDefaultDevice: deviceId && index === attempts.length - 1,
      };
    } catch (error) {
      lastError = error;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
      const canRetry = ['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError', 'NotFoundError'].includes(error?.name);
      if (!canRetry || index === attempts.length - 1) throw error;
    }
  }

  throw lastError;
}

async function createProcessedVoiceStream(
  rawStream,
  isolationMode,
  audioQuality,
  { onRnnoiseRuntimeError } = {},
) {
  if (isolationMode === 'off') {
    return {
      outputStream: rawStream,
      context: null,
      nodes: [],
      rnnoiseApplied: false,
      processingEngine: 'none',
    };
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API desteklenmiyor.');

  const quality = AUDIO_QUALITY_CONFIG[audioQuality] || AUDIO_QUALITY_CONFIG.high;
  const wantsRnnoise = isolationMode === 'strong' && isRnnoiseRuntimeSupported();
  let context;
  try {
    context = new AudioContextClass({
      latencyHint: 'interactive',
      sampleRate: wantsRnnoise ? RNNOISE_SAMPLE_RATE : quality.sampleRate,
    });
  } catch {
    context = new AudioContextClass();
  }

  const nodes = [];
  let rnnoiseSession = null;
  try {
    const source = context.createMediaStreamSource(rawStream);
    const highPass = context.createBiquadFilter();
    const lowPass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const presence = context.createBiquadFilter();
    const outputGain = context.createGain();
    const destination = context.createMediaStreamDestination();
    nodes.push(source, highPass, lowPass, compressor, presence, outputGain, destination);
    try {
      destination.channelCount = wantsRnnoise ? 1 : quality.channelCount;
      destination.channelCountMode = 'explicit';
    } catch { /* Tarayıcı çıkış kanal sayısını kendi seçebilir. */ }

    highPass.type = 'highpass';
    highPass.frequency.value = isolationMode === 'strong' ? 85 : 75;
    highPass.Q.value = isolationMode === 'strong' ? 0.75 : 0.7;

    lowPass.type = 'lowpass';
    lowPass.frequency.value = isolationMode === 'strong' ? 15000 : 15000;
    lowPass.Q.value = 0.55;

    compressor.threshold.value = isolationMode === 'strong' ? -24 : -26;
    compressor.knee.value = isolationMode === 'strong' ? 18 : 20;
    compressor.ratio.value = isolationMode === 'strong' ? 3 : 3;
    compressor.attack.value = 0.004;
    compressor.release.value = isolationMode === 'strong' ? 0.2 : 0.18;

    presence.type = 'peaking';
    presence.frequency.value = 2800;
    presence.Q.value = 0.75;
    presence.gain.value = isolationMode === 'strong' ? 1.5 : 1.2;
    outputGain.gain.value = isolationMode === 'strong' ? 1.02 : 1;

    source.connect(highPass);
    let rnnoiseApplied = false;
    let fallbackReason = '';
    if (isolationMode === 'strong') {
      const rnnoiseGain = context.createGain();
      const fallbackGain = context.createGain();
      nodes.push(rnnoiseGain, fallbackGain);
      rnnoiseGain.gain.value = 0;
      fallbackGain.gain.value = 1;

      // RNNoise başlatılamazsa aynı AudioContext içindeki bypass yolu sesin
      // kesilmesini önler. Hazır olunca iki yol kısa bir geçişle yer değiştirir.
      highPass.connect(fallbackGain);
      fallbackGain.connect(lowPass);

      if (wantsRnnoise) {
        const handleRuntimeFailure = (error) => {
          if (!rnnoiseApplied || context.state === 'closed') return;
          const now = context.currentTime;
          rnnoiseGain.gain.cancelScheduledValues(now);
          fallbackGain.gain.cancelScheduledValues(now);
          rnnoiseGain.gain.setTargetAtTime(0, now, 0.015);
          fallbackGain.gain.setTargetAtTime(1, now, 0.015);
          rnnoiseApplied = false;
          onRnnoiseRuntimeError?.(error);
        };

        try {
          rnnoiseSession = await createRnnoiseProcessor(context, {
            onProcessorError: handleRuntimeFailure,
          });
          nodes.push(rnnoiseSession.node);
          highPass.connect(rnnoiseSession.node);
          rnnoiseSession.node.connect(rnnoiseGain);
          rnnoiseGain.connect(lowPass);
          const now = context.currentTime;
          rnnoiseApplied = true;
          rnnoiseGain.gain.setTargetAtTime(1, now, 0.015);
          fallbackGain.gain.setTargetAtTime(0, now, 0.015);
        } catch (error) {
          fallbackReason = error?.message || 'RNNoise başlatılamadı.';
          rnnoiseSession?.destroy();
          rnnoiseSession = null;
        }
      } else {
        fallbackReason = 'AudioWorklet/WebAssembly desteği bulunamadı.';
      }

      lowPass.connect(compressor);
    } else {
      highPass.connect(lowPass);
      lowPass.connect(compressor);
    }

    compressor.connect(presence);
    presence.connect(outputGain);
    outputGain.connect(destination);
    if (context.state !== 'running') {
      // Bazı tarayıcılar kullanıcı hareketi dışında oluşturulan AudioContext'i
      // askıda bırakır. Askıda bir işleme zinciri sessiz bir WebRTC izi üretir;
      // kısa süre içinde başlayamazsa üst katman ham mikrofon akışına düşer.
      await Promise.race([
        context.resume().catch(() => {}),
        new Promise(resolve => window.setTimeout(resolve, 750)),
      ]);
      if (context.state !== 'running') {
        throw new Error('Web Audio işleme zinciri başlatılamadı.');
      }
    }

    const outputTrack = destination.stream.getAudioTracks()[0];
    if (!outputTrack) throw new Error('İşlenmiş mikrofon izi oluşturulamadı.');
    try { outputTrack.contentHint = 'speech'; } catch { /* Bazı tarayıcılar salt okunur uygular. */ }

    return {
      outputStream: new MediaStream([outputTrack]),
      context,
      nodes,
      disposeProcessor: () => rnnoiseSession?.destroy(),
      rnnoiseApplied,
      fallbackReason,
      processingEngine: rnnoiseApplied ? 'rnnoise' : 'web-audio',
    };
  } catch (error) {
    rnnoiseSession?.destroy();
    nodes.forEach(node => {
      try { node.disconnect?.(); } catch { /* Bağlı olmayan düğüm. */ }
    });
    await context.close().catch(() => {});
    throw error;
  }
}

async function enableNativeVoiceProcessingFallback(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track?.applyConstraints) return false;
  const supported = getSupportedMediaConstraints();
  const constraints = {};
  if (!supported || supported.echoCancellation) constraints.echoCancellation = true;
  if (!supported || supported.noiseSuppression) constraints.noiseSuppression = true;
  if (!supported || supported.autoGainControl) constraints.autoGainControl = true;
  try {
    await track.applyConstraints(constraints);
    return true;
  } catch {
    return false;
  }
}

function disposeVoiceProcessingSession(session = {}) {
  try { session.disposeListeners?.(); } catch { /* Dinleyiciler zaten kaldırılmış olabilir. */ }
  try { session.disposeProcessor?.(); } catch { /* İşlemci zaten kapanmış olabilir. */ }
  (session.nodes || []).forEach(node => {
    try { node.disconnect?.(); } catch { /* Bağlı olmayan düğüm. */ }
  });
  stopStream(session.outputStream);
  if (session.rawStream && session.rawStream !== session.outputStream) stopStream(session.rawStream);
  session.context?.close?.().catch(() => {});
}

export const VoiceProvider = ({ children }) => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [peerId, setPeerId] = useState(null);
  const [isInVoice, setIsInVoice] = useState(false);
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteVideoStreams, setRemoteVideoStreams] = useState({});
  const [isVoiceViewOpen, setIsVoiceViewOpen] = useState(false);
  const [voiceChannelMembers, setVoiceChannelMembers] = useState({});
  const [voiceParticipants, setVoiceParticipants] = useState({});
  const [speakingUserIds, setSpeakingUserIds] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isServerMuted, setIsServerMuted] = useState(false);
  const [isServerDeafened, setIsServerDeafened] = useState(false);
  const [voiceCapabilities, setVoiceCapabilities] = useState(DEFAULT_CAPABILITIES);
  const [voiceError, setVoiceError] = useState('');
  const [availableDevices, setAvailableDevices] = useState({ audioinput: [], audiooutput: [], videoinput: [] });
  const [inputDeviceId, setInputDeviceId] = useState(() => localStorage.getItem('voice:input-device') || '');
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem('voice:output-device') || '');
  const [cameraDeviceId, setCameraDeviceId] = useState(() => localStorage.getItem('voice:camera-device') || '');
  const [voiceMode, setVoiceModeState] = useState(() => localStorage.getItem('voice:mode') || 'activity');
  const [pushToTalkKey, setPushToTalkKeyState] = useState(() => localStorage.getItem('voice:ptt-key') || 'Space');
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const [voiceIsolationMode, setVoiceIsolationModeState] = useState(getInitialVoiceIsolationMode);
  const [audioQuality, setAudioQualityState] = useState(() => normalizeAudioQuality(localStorage.getItem('voice:audio-quality')));
  const [voiceProcessingStatus, setVoiceProcessingStatus] = useState('idle');
  const [effectiveVoiceIsolationMode, setEffectiveVoiceIsolationMode] = useState('off');
  const [voiceProcessingEngine, setVoiceProcessingEngine] = useState('none');
  const [screenSharePreset, setScreenSharePreset] = useState(() => localStorage.getItem('voice:screen-preset') || '1080p30');

  const userRef = useRef(user);
  const socketRef = useRef(socket);
  const peerRef = useRef(null);
  const peerIdRef = useRef(null);
  const activeVoiceChannelRef = useRef(null);
  const isInVoiceRef = useRef(false);
  const voiceCapabilitiesRef = useRef(DEFAULT_CAPABILITIES);
  const audioStreamRef = useRef(null);
  const sourceAudioStreamRef = useRef(null);
  const audioProcessingSessionRef = useRef(null);
  const microphoneRequestIdRef = useRef(0);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const callsRef = useRef({});
  const incomingVideoCallsRef = useRef({});
  const outgoingVideoCallsRef = useRef({});
  const participantsRef = useRef({});
  const remoteStreamsRef = useRef({});
  const remoteVideoStreamsRef = useRef({});
  const isMutedRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const leaveVoiceChannelRef = useRef(() => {});
  const pendingVoiceJoinRef = useRef(null);
  const joinInProgressRef = useRef(false);
  const rejoiningRef = useRef(false);
  const inputDeviceIdRef = useRef(inputDeviceId);
  const cameraDeviceIdRef = useRef(cameraDeviceId);
  const voiceModeRef = useRef(voiceMode);
  const pushToTalkActiveRef = useRef(false);
  const voiceIsolationModeRef = useRef(voiceIsolationMode);
  const audioQualityRef = useRef(audioQuality);

  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const webAudioProcessingSupported = Boolean(
    AudioContextClass
    && AudioContextClass.prototype?.createMediaStreamSource
    && AudioContextClass.prototype?.createMediaStreamDestination,
  );
  const nativeVoiceIsolationSupported = Boolean(getSupportedMediaConstraints()?.voiceIsolation);
  const rnnoiseSupported = isRnnoiseRuntimeSupported();
  const audioProcessingSupported = webAudioProcessingSupported || nativeVoiceIsolationSupported || rnnoiseSupported;
  const noiseSuppression = voiceIsolationMode !== 'off';

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    // Çıkış yapıldığında VoiceProvider yaşamaya devam edebilir. Mikrofon,
    // RNNoise worklet'i ve Peer çağrıları kullanıcı oturumu ile birlikte kapanır.
    if (!user?.id && isInVoiceRef.current) {
      leaveVoiceChannelRef.current({ notifyServer: false });
    }
  }, [user?.id]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => { inputDeviceIdRef.current = inputDeviceId; localStorage.setItem('voice:input-device', inputDeviceId); }, [inputDeviceId]);
  useEffect(() => {
    void setGlobalAudioOutputDevice(outputDeviceId);
  }, [outputDeviceId]);
  useEffect(() => { cameraDeviceIdRef.current = cameraDeviceId; localStorage.setItem('voice:camera-device', cameraDeviceId); }, [cameraDeviceId]);
  useEffect(() => { voiceModeRef.current = voiceMode; localStorage.setItem('voice:mode', voiceMode); }, [voiceMode]);
  useEffect(() => { localStorage.setItem('voice:ptt-key', pushToTalkKey); }, [pushToTalkKey]);
  useEffect(() => {
    voiceIsolationModeRef.current = voiceIsolationMode;
    localStorage.setItem('voice:isolation-mode', voiceIsolationMode);
    // Eski arayüz/kurulumlarla geriye uyumluluk.
    localStorage.setItem('voice:noise-suppression', String(voiceIsolationMode !== 'off'));
  }, [voiceIsolationMode]);
  useEffect(() => {
    audioQualityRef.current = audioQuality;
    localStorage.setItem('voice:audio-quality', audioQuality);
  }, [audioQuality]);
  useEffect(() => { localStorage.setItem('voice:screen-preset', screenSharePreset); }, [screenSharePreset]);

  const refreshAvailableDevices = useCallback(async ({ requestPermission = false } = {}) => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setVoiceError('Bu cihaz ses aygıtlarını listelemeyi desteklemiyor.');
      return { success: false, error: 'unsupported' };
    }

    let permissionStream = null;
    try {
      const alreadyHasMicrophone = hasLiveAudioTrack(sourceAudioStreamRef.current);
      if (requestPermission && !alreadyHasMicrophone) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextDevices = {
        audioinput: devices.filter(device => device.kind === 'audioinput'),
        audiooutput: devices.filter(device => device.kind === 'audiooutput'),
        videoinput: devices.filter(device => device.kind === 'videoinput'),
      };
      setAvailableDevices(nextDevices);
      return { success: true, devices: nextDevices };
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Mikrofon izni verilmedi. Gerçek aygıt adlarını göstermek için izne izin ver.'
        : 'Ses aygıtları okunamadı. Windows gizlilik ve ses ayarlarını kontrol et.';
      setVoiceError(message);
      return { success: false, error: message };
    } finally {
      stopStream(permissionStream);
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    const handleDeviceChange = () => { void refreshAvailableDevices(); };
    void refreshAvailableDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
  }, [refreshAvailableDevices]);

  useEffect(() => {
    const editable = target => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    const setPressed = pressed => {
      if (voiceModeRef.current !== 'push-to-talk' || !isInVoiceRef.current) return;
      if (pushToTalkActiveRef.current === pressed) return;
      pushToTalkActiveRef.current = pressed;
      setIsPushToTalkActive(pressed);
      audioStreamRef.current?.getAudioTracks().forEach(track => {
        track.enabled = pressed && !isMutedRef.current && !voiceCapabilitiesRef.current.serverMuted;
      });
      playFeedbackSound(pressed ? FEEDBACK_SOUND_IDS.PTT_ACTIVATE : FEEDBACK_SOUND_IDS.PTT_DEACTIVATE);
    };
    const down = event => {
      if (voiceModeRef.current !== 'push-to-talk' || event.code !== pushToTalkKey || editable(event.target)) return;
      event.preventDefault();
      if (!event.repeat) setPressed(true);
    };
    const up = event => {
      if (event.code !== pushToTalkKey) return;
      event.preventDefault();
      setPressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [pushToTalkKey]);

  useEffect(() => {
    activeVoiceChannelRef.current = activeVoiceChannel;
  }, [activeVoiceChannel]);

  useEffect(() => {
    isInVoiceRef.current = isInVoice;
  }, [isInVoice]);

  const createOutgoingStream = () => {
    const stream = new MediaStream();
    audioStreamRef.current?.getAudioTracks().forEach((track) => stream.addTrack(track));
    return stream;
  };

  const applyDeafenState = (deafened) => {
    Object.values(remoteStreamsRef.current).forEach((stream) => {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !deafened;
      });
    });
  };

  const removeRemoteUser = (userId) => {
    setRemoteStreams((previous) => {
      const updated = { ...previous };
      delete updated[userId];
      remoteStreamsRef.current = updated;
      return updated;
    });
  };

  const removeRemoteVideo = (userId) => {
    const normalizedUserId = String(userId || '');
    setRemoteVideoStreams((previous) => {
      if (!previous[normalizedUserId]) return previous;
      const updated = { ...previous };
      delete updated[normalizedUserId];
      remoteVideoStreamsRef.current = updated;
      return updated;
    });
  };

  const closeVideoCallsForUser = (userId) => {
    const normalizedUserId = String(userId || '');
    const incoming = incomingVideoCallsRef.current[normalizedUserId];
    const outgoing = outgoingVideoCallsRef.current[normalizedUserId];
    delete incomingVideoCallsRef.current[normalizedUserId];
    delete outgoingVideoCallsRef.current[normalizedUserId];
    incoming?.close();
    outgoing?.close();
    removeRemoteVideo(normalizedUserId);
  };

  const addVoiceParticipant = (participant) => {
    if (!participant?.userId || !participant?.peerId) return;

    const userId = String(participant.userId);
    const normalized = { ...participant, userId, peerId: String(participant.peerId) };
    participantsRef.current = {
      ...participantsRef.current,
      [userId]: { ...participantsRef.current[userId], ...normalized },
    };
    setVoiceParticipants((previous) => ({
      ...previous,
      [userId]: { ...previous[userId], ...normalized },
    }));
  };

  const removeVoiceParticipant = (userId) => {
    const normalizedUserId = String(userId || '');
    delete participantsRef.current[normalizedUserId];
    setVoiceParticipants((previous) => {
      const updated = { ...previous };
      delete updated[normalizedUserId];
      return updated;
    });
  };

  const applyAudioQualityToCall = async (call) => {
    const peerConnection = call?.peerConnection;
    if (!peerConnection?.getSenders) return;

    const { maxBitrate } = AUDIO_QUALITY_CONFIG[audioQualityRef.current] || AUDIO_QUALITY_CONFIG.high;
    const audioSenders = peerConnection.getSenders().filter(sender => sender.track?.kind === 'audio');
    await Promise.all(audioSenders.map(async (sender) => {
      if (!sender.getParameters || !sender.setParameters) return;
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        parameters.encodings = parameters.encodings.map(encoding => ({ ...encoding, maxBitrate }));
        await sender.setParameters(parameters);
      } catch (error) {
        // Codec/bitrate tercihi desteklenmiyorsa WebRTC kendi uygun değerini seçer.
        console.warn('Ses kalite profili WebRTC göndericisine uygulanamadı:', error);
      }
    }));
  };

  const attachCall = (call, remoteUserId) => {
    const normalizedUserId = String(remoteUserId);
    const previousCall = callsRef.current[normalizedUserId];
    if (previousCall && previousCall !== call) previousCall.close();
    callsRef.current[normalizedUserId] = call;
    void applyAudioQualityToCall(call);

    call.on('stream', (stream) => {
      void applyAudioQualityToCall(call);
      // Arka planda sağırlaştırılmış kullanıcıların uzaktaki sesi de kapalı kalır.
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isDeafenedRef.current;
      });

      setRemoteStreams((previous) => {
        const updated = { ...previous, [normalizedUserId]: stream };
        remoteStreamsRef.current = updated;
        return updated;
      });
    });

    const removeCall = () => {
      if (callsRef.current[normalizedUserId] === call) {
        delete callsRef.current[normalizedUserId];
        removeRemoteUser(normalizedUserId);
      }
    };

    call.on('close', removeCall);
    call.on('error', removeCall);
  };

  const closeAllCalls = () => {
    Object.values(callsRef.current).forEach((call) => call.close());
    callsRef.current = {};
    remoteStreamsRef.current = {};
    setRemoteStreams({});
  };

  const closeAllVideoCalls = () => {
    Object.values(incomingVideoCallsRef.current).forEach(call => call.close());
    Object.values(outgoingVideoCallsRef.current).forEach(call => call.close());
    incomingVideoCallsRef.current = {};
    outgoingVideoCallsRef.current = {};
    remoteVideoStreamsRef.current = {};
    setRemoteVideoStreams({});
  };

  const closeOutgoingVideoCalls = () => {
    Object.values(outgoingVideoCallsRef.current).forEach(call => call.close());
    outgoingVideoCallsRef.current = {};
  };

  const callParticipant = (participant) => {
    const currentPeer = peerRef.current;
    const activeChannel = activeVoiceChannelRef.current;
    const localUser = userRef.current;
    const remoteUserId = String(participant?.userId || '');
    const knownParticipant = participantsRef.current[remoteUserId];

    if (
      !currentPeer
      || !localUser?.id
      || !isInVoiceRef.current
      || !activeChannel?.id
      || !remoteUserId
      || !knownParticipant?.peerId
      || sameId(remoteUserId, localUser.id)
      || callsRef.current[remoteUserId]
    ) return;

    // Her ikisinin de aynı anda arama başlatmasını önlemek için yalnızca küçük
    // kullanıcı kimliğine sahip taraf aramayı başlatır.
    if (String(localUser.id) > remoteUserId) return;

    const call = currentPeer.call(knownParticipant.peerId, createOutgoingStream(), {
      metadata: {
        userId: String(localUser.id),
        channelId: String(activeChannel.id),
      },
    });

    if (call) attachCall(call, remoteUserId);
  };

  const callVideoParticipant = (participant, stream, mode) => {
    const currentPeer = peerRef.current;
    const activeChannel = activeVoiceChannelRef.current;
    const localUser = userRef.current;
    const remoteUserId = String(participant?.userId || '');
    const knownParticipant = participantsRef.current[remoteUserId];

    if (
      !currentPeer
      || !localUser?.id
      || !isInVoiceRef.current
      || !activeChannel?.id
      || !stream?.getVideoTracks().some(track => track.readyState === 'live')
      || !remoteUserId
      || !knownParticipant?.peerId
      || sameId(remoteUserId, localUser.id)
    ) return;

    outgoingVideoCallsRef.current[remoteUserId]?.close();
    const call = currentPeer.call(knownParticipant.peerId, stream, {
      metadata: {
        userId: String(localUser.id),
        channelId: String(activeChannel.id),
        mediaKind: 'video',
        mode,
      },
    });
    if (!call) return;

    outgoingVideoCallsRef.current[remoteUserId] = call;
    const removeCall = () => {
      if (outgoingVideoCallsRef.current[remoteUserId] === call) {
        delete outgoingVideoCallsRef.current[remoteUserId];
      }
    };
    call.on('close', removeCall);
    call.on('error', removeCall);
  };

  const broadcastVideoStream = (stream, mode) => {
    closeOutgoingVideoCalls();
    Object.values(participantsRef.current).forEach(participant => {
      callVideoParticipant(participant, stream, mode);
    });
  };

  const sendCurrentVideoToParticipant = (participant) => {
    const mode = getCurrentVideoMode();
    const stream = mode === 'screen' ? screenStreamRef.current : cameraStreamRef.current;
    if (mode !== 'none' && stream) callVideoParticipant(participant, stream, mode);
  };

  const reconnectAudioCall = (participant) => {
    const localUserId = String(userRef.current?.id || '');
    const remoteUserId = String(participant?.userId || '');

    // Ses çağrısının tek sahibi küçük kullanıcı kimliğine sahip taraftır.
    // Mikrofon sonradan hazır olduğunda iki tarafın da aynı çağrıyı kapatması,
    // yeni kurulan çağrının yarış nedeniyle yeniden kapanmasına yol açabiliyor.
    if (!localUserId || !remoteUserId || localUserId >= remoteUserId) return;

    const previousCall = callsRef.current[remoteUserId];
    if (previousCall) {
      delete callsRef.current[remoteUserId];
      previousCall.close();
      removeRemoteUser(remoteUserId);
    }
    callParticipant(participant);
  };

  const reconnectCalls = () => {
    Object.values(participantsRef.current).forEach(reconnectAudioCall);
  };

  const emitWithAck = (event, payload, timeout = 7000) => new Promise((resolve) => {
    const currentSocket = socketRef.current;
    if (!currentSocket?.connected) {
      resolve({ success: false, error: 'Sunucu bağlantısı kurulamadı.' });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result || { success: false, error: 'Sunucu yanıt vermedi.' });
    };
    const timer = window.setTimeout(() => finish({ success: false, error: 'Sunucu yanıt vermedi.' }), timeout);

    currentSocket.emit(event, payload, finish);
  });

  const notifyStreamChanged = async (channelId, payload) => {
    const result = await emitWithAck('voice:stream-changed', { channelId, ...payload });
    if (!result?.success) {
      setVoiceError(result?.error || 'Ses/yayın durumu doğrulanamadı.');
    }
    return result;
  };

  const releaseMicrophone = () => {
    microphoneRequestIdRef.current += 1;
    const currentSession = audioProcessingSessionRef.current || {
      outputStream: audioStreamRef.current,
      rawStream: sourceAudioStreamRef.current,
    };
    audioProcessingSessionRef.current = null;
    audioStreamRef.current = null;
    sourceAudioStreamRef.current = null;
    disposeVoiceProcessingSession(currentSession);
    setMyStream(null);
    setVoiceProcessingStatus('idle');
    setEffectiveVoiceIsolationMode('off');
    setVoiceProcessingEngine('none');
  };

  const getCurrentVideoMode = () => {
    if (screenStreamRef.current?.getVideoTracks().some((track) => track.readyState === 'live')) return 'screen';
    if (cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === 'live')) return 'camera';
    return 'none';
  };

  const applyVoiceCapabilities = (capabilities) => {
    const next = normalizeCapabilities(capabilities);
    const previous = voiceCapabilitiesRef.current;
    voiceCapabilitiesRef.current = next;
    setVoiceCapabilities(next);
    setIsServerMuted(next.serverMuted);
    setIsServerDeafened(next.serverDeafened);

    let audioChanged = false;
    let videoChanged = false;
    if (!next.canSpeak || next.serverMuted) {
      if (audioStreamRef.current) {
        releaseMicrophone();
        audioChanged = true;
      }
      isMutedRef.current = true;
      setIsMuted(true);
    }

    if (!next.canStream && (cameraStreamRef.current || screenStreamRef.current)) {
      stopStream(cameraStreamRef.current);
      stopStream(screenStreamRef.current);
      cameraStreamRef.current = null;
      screenStreamRef.current = null;
      setCameraStream(null);
      setScreenStream(null);
      closeOutgoingVideoCalls();
      videoChanged = true;
    }

    if (next.serverDeafened) {
      isDeafenedRef.current = true;
      applyDeafenState(true);
      setIsDeafened(true);
    }

    if ((audioChanged || videoChanged) && isInVoiceRef.current) {
      if (audioChanged) reconnectCalls();
      const activeChannel = activeVoiceChannelRef.current;
      if (videoChanged && activeChannel?.id && socketRef.current?.connected) {
        void notifyStreamChanged(activeChannel.id, { kind: 'video', mode: getCurrentVideoMode() });
      }
    }

    // Yetkiler değiştiğinde yalnızca gerçekten değişmişse sessizce güncelle.
    if (previous.channelId && !sameId(previous.channelId, next.channelId)) {
      setVoiceError('Ses kanalı yetkilerin güncellendi.');
    }

    return next;
  };

  const requestVoiceCapabilities = async (channelId) => {
    const result = await emitWithAck('voice:capabilities-request', { channelId });
    if (result?.capabilities) applyVoiceCapabilities(result.capabilities);
    return result;
  };

  const requestVoiceChannelMembers = (serverId) => {
    if (socketRef.current?.connected && serverId) {
      socketRef.current.emit('voice:members-request', { serverId });
    }
  };

  const ensureMicrophone = async ({ skipCapabilityRefresh = false, forceReplace = false } = {}) => {
    const activeChannel = activeVoiceChannelRef.current;
    if (!isInVoiceRef.current || !activeChannel?.id) return false;
    const previousOutgoingStream = audioStreamRef.current;
    const previousRawStream = sourceAudioStreamRef.current;
    const hasPreviousStream = hasLiveAudioTrack(previousOutgoingStream);
    const previousSession = hasPreviousStream
      ? (audioProcessingSessionRef.current || {
        outputStream: previousOutgoingStream,
        rawStream: previousRawStream,
      })
      : null;
    const previousEffectiveMode = previousSession?.effectiveMode || effectiveVoiceIsolationMode;
    const previousProcessingStatus = previousSession?.processingStatus || voiceProcessingStatus;
    const previousProcessingEngine = previousSession?.processingEngine || voiceProcessingEngine;
    const requestId = microphoneRequestIdRef.current + 1;
    microphoneRequestIdRef.current = requestId;
    setVoiceProcessingStatus('starting');

    let capabilities = voiceCapabilitiesRef.current;
    if (!skipCapabilityRefresh) {
      const result = await requestVoiceCapabilities(activeChannel.id);
      if (requestId !== microphoneRequestIdRef.current) return false;
      if (!result?.success) {
        setVoiceError(result?.error || 'Ses yetkilerin doğrulanamadı.');
        setVoiceProcessingStatus('error');
        return false;
      }
      capabilities = normalizeCapabilities(result.capabilities);
    }

    if (!capabilities.canSpeak) {
      setVoiceError('Bu ses kanalında konuşma yetkin yok. Dinleyici olarak bağlısın.');
      setVoiceProcessingStatus('idle');
      return false;
    }
    if (capabilities.serverMuted) {
      setVoiceError('Mikrofonun bir moderatör tarafından susturuldu.');
      setVoiceProcessingStatus('idle');
      return false;
    }

    if (hasPreviousStream && !forceReplace) {
      audioStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current && (voiceModeRef.current !== 'push-to-talk' || pushToTalkActiveRef.current);
      });
      setVoiceProcessingStatus('active');
      return true;
    }

    try {
      const isolationMode = voiceIsolationModeRef.current;
      const quality = audioQualityRef.current;
      const capture = await captureMicrophone({
        deviceId: inputDeviceIdRef.current,
        isolationMode,
        audioQuality: quality,
      });
      const rawStream = capture.stream;
      void refreshAvailableDevices();
      if (
        requestId !== microphoneRequestIdRef.current
        || !isInVoiceRef.current
        || !sameId(activeVoiceChannelRef.current?.id, activeChannel.id)
      ) {
        stopStream(rawStream);
        return false;
      }

      rawStream.getAudioTracks().forEach(track => {
        try { track.contentHint = 'speech'; } catch { /* Bazı tarayıcılar salt okunur uygular. */ }
      });

      let processingSession;
      let processingFallback = capture.usedConstraintFallback;
      try {
        processingSession = await createProcessedVoiceStream(rawStream, isolationMode, quality, {
          onRnnoiseRuntimeError: (error) => {
            const currentSession = audioProcessingSessionRef.current;
            if (!currentSession || currentSession.rawStream !== rawStream) return;
            currentSession.rnnoiseApplied = false;
            currentSession.effectiveMode = 'standard';
            currentSession.processingStatus = 'fallback';
            currentSession.processingEngine = 'browser-fallback';
            void enableNativeVoiceProcessingFallback(rawStream);
            setEffectiveVoiceIsolationMode('standard');
            setVoiceProcessingStatus('fallback');
            setVoiceProcessingEngine('browser-fallback');
            setVoiceError(`RNNoise çalışmayı durdurdu; standart gürültü azaltmaya geçildi${error?.message ? ` (${error.message})` : ''}.`);
          },
        });
      } catch (processingError) {
        console.warn('Ses izolasyonu Web Audio katmanına uygulanamadı; tarayıcı işlemesi kullanılıyor:', processingError);
        processingFallback = true;
        processingSession = {
          outputStream: rawStream,
          context: null,
          nodes: [],
          rnnoiseApplied: false,
          processingEngine: 'browser-fallback',
          fallbackReason: processingError?.message || 'Ses işleme zinciri başlatılamadı.',
        };
      }
      processingSession.rawStream = rawStream;
      const rawTrack = rawStream.getAudioTracks()[0];
      if (rawTrack?.addEventListener) {
        const handleUnexpectedTrackEnd = () => {
          if (audioProcessingSessionRef.current !== processingSession || !isInVoiceRef.current) return;
          setVoiceError('Mikrofon bağlantısı kesildi; yeniden bağlanılıyor…');
          releaseMicrophone();
          void ensureMicrophone({ skipCapabilityRefresh: true, forceReplace: true });
        };
        rawTrack.addEventListener('ended', handleUnexpectedTrackEnd);
        processingSession.disposeListeners = () => rawTrack.removeEventListener('ended', handleUnexpectedTrackEnd);
      }

      if (isolationMode === 'strong' && !processingSession.rnnoiseApplied) {
        processingFallback = true;
        processingSession.processingEngine = 'browser-fallback';
        await enableNativeVoiceProcessingFallback(rawStream);
      }

      if (
        requestId !== microphoneRequestIdRef.current
        || !isInVoiceRef.current
        || !sameId(activeVoiceChannelRef.current?.id, activeChannel.id)
      ) {
        disposeVoiceProcessingSession(processingSession);
        return false;
      }

      const outgoingStream = processingSession.outputStream;
      const nextEffectiveMode = isolationMode === 'strong' && !processingSession.rnnoiseApplied
        ? 'standard'
        : isolationMode;
      const nextProcessingStatus = processingFallback ? 'fallback' : 'active';
      const nextProcessingEngine = processingSession.processingEngine
        || (nextEffectiveMode === 'off' ? 'none' : 'web-audio');
      processingSession.effectiveMode = nextEffectiveMode;
      processingSession.processingStatus = nextProcessingStatus;
      processingSession.processingEngine = nextProcessingEngine;
      outgoingStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current && (voiceModeRef.current !== 'push-to-talk' || pushToTalkActiveRef.current);
      });
      sourceAudioStreamRef.current = rawStream;
      audioProcessingSessionRef.current = processingSession;
      audioStreamRef.current = outgoingStream;
      setMyStream(outgoingStream);
      setEffectiveVoiceIsolationMode(nextEffectiveMode);
      setVoiceProcessingStatus(nextProcessingStatus);
      setVoiceProcessingEngine(nextProcessingEngine);

      const result = await notifyStreamChanged(activeChannel.id, {
        kind: 'audio',
        enabled: !isMutedRef.current && (voiceModeRef.current !== 'push-to-talk' || pushToTalkActiveRef.current),
      });
      if (!result?.success) {
        if (hasPreviousStream) {
          sourceAudioStreamRef.current = previousRawStream;
          audioProcessingSessionRef.current = previousSession;
          audioStreamRef.current = previousOutgoingStream;
          setMyStream(previousOutgoingStream);
          setEffectiveVoiceIsolationMode(previousEffectiveMode);
          setVoiceProcessingStatus(previousProcessingStatus === 'starting' ? 'active' : previousProcessingStatus);
          setVoiceProcessingEngine(previousProcessingEngine);
        } else {
          sourceAudioStreamRef.current = null;
          audioProcessingSessionRef.current = null;
          audioStreamRef.current = null;
          setMyStream(null);
          setEffectiveVoiceIsolationMode('off');
          setVoiceProcessingStatus('error');
          setVoiceProcessingEngine('none');
        }
        disposeVoiceProcessingSession(processingSession);
        return false;
      }

      if (capture.usedDefaultDevice) {
        inputDeviceIdRef.current = '';
        setInputDeviceId('');
      }
      if (previousSession && previousSession !== processingSession) {
        disposeVoiceProcessingSession(previousSession);
      }
      reconnectCalls();
      return true;
    } catch (error) {
      if (requestId !== microphoneRequestIdRef.current) return false;
      if (error.name !== 'NotAllowedError') {
        console.error('Mikrofon erişim hatası:', error);
      }
      if (hasPreviousStream) {
        setEffectiveVoiceIsolationMode(previousEffectiveMode);
        setVoiceProcessingStatus(previousProcessingStatus === 'starting' ? 'active' : previousProcessingStatus);
        setVoiceProcessingEngine(previousProcessingEngine);
        setVoiceError('Yeni ses ayarı uygulanamadı; önceki mikrofon bağlantın kullanılmaya devam ediyor.');
      } else {
        setEffectiveVoiceIsolationMode('off');
        setVoiceProcessingStatus('error');
        setVoiceProcessingEngine('none');
        setVoiceError('Mikrofon izni verilmedi veya mikrofon bulunamadı. Dinleyici olarak bağlı kalabilirsin.');
      }
      return false;
    }
  };

  const ensureStreamPermission = async (channel) => {
    const result = await requestVoiceCapabilities(channel.id);
    const capabilities = normalizeCapabilities(result?.capabilities);
    if (!result?.success || !capabilities.canStream) {
      setVoiceError(result?.error || 'Bu ses kanalında yayın veya kamera açma yetkin yok.');
      return false;
    }
    return true;
  };

  const stopScreenShare = ({ notify = true } = {}) => {
    const stream = screenStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    screenStreamRef.current = null;
    setScreenStream(null);
    closeOutgoingVideoCalls();

    const activeChannel = activeVoiceChannelRef.current;
    if (notify && activeChannel?.id && socketRef.current?.connected) {
      void notifyStreamChanged(activeChannel.id, { kind: 'video', mode: getCurrentVideoMode() });
      playFeedbackSound(FEEDBACK_SOUND_IDS.STREAM_STOPPED);
    }
  };

  const stopCamera = ({ notify = true } = {}) => {
    const stream = cameraStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    cameraStreamRef.current = null;
    setCameraStream(null);
    closeOutgoingVideoCalls();

    const activeChannel = activeVoiceChannelRef.current;
    if (notify && activeChannel?.id && socketRef.current?.connected) {
      void notifyStreamChanged(activeChannel.id, { kind: 'video', mode: getCurrentVideoMode() });
    }
  };

  const toggleCamera = async () => {
    const activeChannel = activeVoiceChannelRef.current;
    if (!isInVoiceRef.current || !activeChannel?.id) {
      setVoiceError('Kamerayı açmak için önce bir ses kanalına katıl.');
      return;
    }
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }
    if (!(await ensureStreamPermission(activeChannel))) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceIdRef.current ? { deviceId: { exact: cameraDeviceIdRef.current } } : true,
        audio: false,
      });
      if (!isInVoiceRef.current || !sameId(activeVoiceChannelRef.current?.id, activeChannel.id)) {
        stopStream(stream);
        return;
      }

      if (screenStreamRef.current) stopScreenShare({ notify: false });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => stopCamera();
      cameraStreamRef.current = stream;
      setCameraStream(stream);

      const result = await notifyStreamChanged(activeChannel.id, {
        kind: 'video',
        mode: getCurrentVideoMode(),
      });
      if (!result?.success) {
        stopCamera({ notify: false });
        return;
      }
      broadcastVideoStream(stream, 'camera');
    } catch (error) {
      if (error.name !== 'NotAllowedError') console.error('Kamera erişim hatası:', error);
      setVoiceError('Kamera izni verilmedi veya kamera bulunamadı.');
    }
  };

  const toggleScreenShare = async () => {
    const activeChannel = activeVoiceChannelRef.current;
    if (!isInVoiceRef.current || !activeChannel?.id) {
      setVoiceError('Yayın açmak için önce bir ses kanalına katıl.');
      return;
    }
    if (screenStreamRef.current) {
      stopScreenShare();
      return;
    }
    if (!(await ensureStreamPermission(activeChannel))) return;

    try {
      const presets = {
        '720p30': { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        '1080p30': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
        '1080p60': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } },
      };
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: presets[screenSharePreset] || presets['1080p30'], audio: false });
      if (!isInVoiceRef.current || !sameId(activeVoiceChannelRef.current?.id, activeChannel.id)) {
        stopStream(stream);
        return;
      }

      if (cameraStreamRef.current) stopCamera({ notify: false });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.onended = () => stopScreenShare();
      screenStreamRef.current = stream;
      setScreenStream(stream);

      const result = await notifyStreamChanged(activeChannel.id, {
        kind: 'video',
        mode: getCurrentVideoMode(),
      });
      if (!result?.success) {
        stopScreenShare({ notify: false });
        return;
      }
      broadcastVideoStream(stream, 'screen');
      playFeedbackSound(FEEDBACK_SOUND_IDS.STREAM_STARTED);
    } catch (error) {
      if (error.name !== 'NotAllowedError') {
        console.error('Ekran paylaşımı hatası:', error);
        setVoiceError('Ekran paylaşımı başlatılamadı.');
      }
    }
  };

  const leaveVoiceChannel = ({ notifyServer = true, playSound = notifyServer } = {}) => {
    const activeChannel = activeVoiceChannelRef.current;
    const currentSocket = socketRef.current;

    // Ayrılan kullanıcı da çıkış bildirimini duyar. Başarısız
    // join/rollback akışlarında notifyServer=false olduğu için gereksiz çalmaz.
    if (playSound && activeChannel?.id) playFeedbackSound(FEEDBACK_SOUND_IDS.LEAVE_CALL);

    // Önce ref'leri temizlemek, geç kalan PeerJS çağrılarının cevaplanmasını engeller.
    activeVoiceChannelRef.current = null;
    isInVoiceRef.current = false;
    pendingVoiceJoinRef.current = null;
    joinInProgressRef.current = false;
    rejoiningRef.current = false;

    if (notifyServer && currentSocket?.connected) {
      // Backend bu socket'i bulunduğu tüm ses kanallarından çıkarır. Kanal
      // state'i istemcide bozulmuş olsa bile kullanıcı seste kilitli kalmaz.
      currentSocket.emit('voice:leave', { channelId: activeChannel?.id || null });
    }

    closeAllCalls();
    closeAllVideoCalls();
    participantsRef.current = {};
    setVoiceParticipants({});
    setSpeakingUserIds({});
    releaseMicrophone();
    stopStream(cameraStreamRef.current);
    stopStream(screenStreamRef.current);
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
    setScreenStream(null);
    isMutedRef.current = false;
    isDeafenedRef.current = false;
    setIsMuted(false);
    setIsDeafened(false);
    setIsServerMuted(false);
    setIsServerDeafened(false);
    voiceCapabilitiesRef.current = DEFAULT_CAPABILITIES;
    setVoiceCapabilities(DEFAULT_CAPABILITIES);
    setIsInVoice(false);
    setActiveVoiceChannel(null);
    setIsVoiceViewOpen(false);
  };

  const joinVoiceChannel = async (channel, { isMove = false } = {}) => {
    if (!channel?.id || joinInProgressRef.current) return false;
    if (!socketRef.current?.connected) {
      setVoiceError('Sunucu bağlantısı kurulamadı. Tekrar dene.');
      return false;
    }
    if (!peerIdRef.current) {
      setVoiceError('Ses altyapısı hazırlanıyor. Birkaç saniye sonra tekrar dene.');
      return false;
    }
    if (sameId(activeVoiceChannelRef.current?.id, channel.id)) return true;

    joinInProgressRef.current = true;
    try {
      if (activeVoiceChannelRef.current) {
        leaveVoiceChannel({ notifyServer: !isMove, playSound: !isMove });
        // leaveVoiceChannel genel temizlik sırasında bu bayrağı da sıfırlar.
        // Kanal değiştirme işlemi bitene kadar ikinci bir join başlamasın.
        joinInProgressRef.current = true;
      }

      // Mikrofon izni istemeden önce sunucunun güncel CONNECT/SPEAK/STREAM
      // yetkisini imzalı socket oturumu üzerinden al.
      const preflight = await requestVoiceCapabilities(channel.id);
      const capabilities = normalizeCapabilities(preflight?.capabilities);
      if (!preflight?.success || !capabilities.canConnect) {
        setVoiceError(preflight?.error || 'Bu ses kanalına bağlanma yetkin yok.');
        return false;
      }

      const localUser = userRef.current;
      const localParticipant = {
        userId: String(localUser.id),
        username: localUser.username,
        peerId: peerIdRef.current,
      };
      participantsRef.current = { [localParticipant.userId]: localParticipant };
      setVoiceParticipants({ [localParticipant.userId]: localParticipant });
      activeVoiceChannelRef.current = channel;
      isInVoiceRef.current = true;
      setActiveVoiceChannel(channel);
      setIsInVoice(true);
      isMutedRef.current = false;
      setIsMuted(false);
      setVoiceError('');
      pendingVoiceJoinRef.current = channel.id;

      const result = await emitWithAck('voice:join', {
        channelId: channel.id,
        peerId: peerIdRef.current,
      });
      pendingVoiceJoinRef.current = null;

      if (!result?.success) {
        setVoiceError(result?.error || 'Ses kanalına bağlanılamadı.');
        leaveVoiceChannel({ notifyServer: false });
        return false;
      }

      if (!isMove) playFeedbackSound(FEEDBACK_SOUND_IDS.USER_JOINS);
      const joinedCapabilities = applyVoiceCapabilities(result.capabilities || capabilities);
      if (joinedCapabilities.canSpeak && !joinedCapabilities.serverMuted && !isMutedRef.current) {
        await ensureMicrophone({ skipCapabilityRefresh: true });
      }
      return true;
    } finally {
      joinInProgressRef.current = false;
    }
  };

  const rejoinActiveVoice = async () => {
    const activeChannel = activeVoiceChannelRef.current;
    if (!isInVoiceRef.current || !activeChannel?.id) return;
    if (rejoiningRef.current) return;
    if (!socketRef.current?.connected || !peerIdRef.current) {
      setVoiceError('Ses bağlantısı yeniden kurulamadı. Kanaldan ayrıldın.');
      leaveVoiceChannel({ notifyServer: false });
      return;
    }

    rejoiningRef.current = true;
    try {
      // Sunucu bağlantısı kesildiğinde uzaktaki katılımcılar eski WebRTC
      // çağrılarını kapatır. Buradaki eski çağrıları da temizleyip yeniden
      // gelen katılımcı anlık görüntüsünden deterministik olarak kurarız.
      closeAllCalls();
      closeAllVideoCalls();
      const result = await emitWithAck('voice:join', {
        channelId: activeChannel.id,
        peerId: peerIdRef.current,
      });
      if (!result?.success) {
        setVoiceError(result?.error || 'Ses bağlantısı yeniden kurulamadı. Kanaldan ayrıldın.');
        leaveVoiceChannel({ notifyServer: false });
        return;
      }

      const capabilities = applyVoiceCapabilities(result.capabilities);
      if (capabilities.canSpeak && !capabilities.serverMuted && !isMutedRef.current && !hasLiveAudioTrack(audioStreamRef.current)) {
        await ensureMicrophone({ skipCapabilityRefresh: true });
      }
    } finally {
      rejoiningRef.current = false;
    }
  };

  const toggleMute = async () => {
    const capabilities = voiceCapabilitiesRef.current;
    if (!isInVoiceRef.current) return;
    if (!capabilities.canSpeak) {
      setVoiceError('Bu ses kanalında konuşma yetkin yok.');
      return;
    }
    if (capabilities.serverMuted) {
      setVoiceError('Mikrofonun bir moderatör tarafından susturuldu.');
      return;
    }

    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);

    if (!nextMuted && !hasLiveAudioTrack(audioStreamRef.current)) {
      const started = await ensureMicrophone();
      if (!started) {
        isMutedRef.current = true;
        setIsMuted(true);
        return;
      }
      playFeedbackSound(FEEDBACK_SOUND_IDS.UNMUTE);
      return;
    }

    audioStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted && (voiceModeRef.current !== 'push-to-talk' || pushToTalkActiveRef.current);
    });
    playFeedbackSound(nextMuted ? FEEDBACK_SOUND_IDS.MUTE : FEEDBACK_SOUND_IDS.UNMUTE);
  };

  const toggleDeafen = () => {
    if (voiceCapabilitiesRef.current.serverDeafened) {
      setVoiceError('Sağırlaştırman bir moderatör tarafından uygulanıyor.');
      return;
    }
    const nextDeafened = !isDeafenedRef.current;
    isDeafenedRef.current = nextDeafened;
    applyDeafenState(nextDeafened);
    setIsDeafened(nextDeafened);
    playFeedbackSound(nextDeafened ? FEEDBACK_SOUND_IDS.DEAFEN : FEEDBACK_SOUND_IDS.UNDEAFEN);
  };

  const setVoiceMode = (mode) => {
    const normalized = mode === 'push-to-talk' ? 'push-to-talk' : 'activity';
    voiceModeRef.current = normalized;
    setVoiceModeState(normalized);
    if (normalized !== 'push-to-talk') {
      pushToTalkActiveRef.current = false;
      setIsPushToTalkActive(false);
    }
    audioStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !isMutedRef.current && (normalized !== 'push-to-talk' || pushToTalkActiveRef.current);
    });
  };

  const setPushToTalkKey = (key) => {
    if (!key) return;
    setPushToTalkKeyState(key);
  };

  const changeInputDevice = async (deviceId) => {
    const previousDeviceId = inputDeviceIdRef.current;
    inputDeviceIdRef.current = deviceId;
    setInputDeviceId(deviceId);
    if (!isInVoiceRef.current || !voiceCapabilitiesRef.current.canSpeak || !audioStreamRef.current) return true;
    const applied = await ensureMicrophone({ skipCapabilityRefresh: true, forceReplace: true });
    if (!applied && inputDeviceIdRef.current === deviceId) {
      inputDeviceIdRef.current = previousDeviceId;
      setInputDeviceId(previousDeviceId);
    }
    return applied;
  };

  const changeCameraDevice = async (deviceId) => {
    cameraDeviceIdRef.current = deviceId;
    setCameraDeviceId(deviceId);
    if (cameraStreamRef.current) {
      stopCamera();
      await toggleCamera();
    }
  };

  const restartMicrophoneForAudioSetting = async () => {
    if (!isInVoiceRef.current || !audioStreamRef.current || !voiceCapabilitiesRef.current.canSpeak) return true;
    return ensureMicrophone({ skipCapabilityRefresh: true, forceReplace: true });
  };

  const setVoiceIsolationMode = async (mode) => {
    const normalized = normalizeVoiceIsolationMode(mode);
    const previousMode = voiceIsolationModeRef.current;
    if (previousMode === normalized) return true;
    voiceIsolationModeRef.current = normalized;
    setVoiceIsolationModeState(normalized);
    const applied = await restartMicrophoneForAudioSetting();
    if (!applied && voiceIsolationModeRef.current === normalized) {
      voiceIsolationModeRef.current = previousMode;
      setVoiceIsolationModeState(previousMode);
    }
    return applied;
  };

  const setAudioQuality = async (quality) => {
    const normalized = normalizeAudioQuality(quality);
    const previousQuality = audioQualityRef.current;
    if (previousQuality === normalized) return true;
    audioQualityRef.current = normalized;
    setAudioQualityState(normalized);
    const applied = await restartMicrophoneForAudioSetting();
    if (!applied && audioQualityRef.current === normalized) {
      audioQualityRef.current = previousQuality;
      setAudioQualityState(previousQuality);
    }
    return applied;
  };

  const setNoiseSuppression = async (enabled) => {
    const nextMode = enabled
      ? (voiceIsolationModeRef.current === 'off' ? 'standard' : voiceIsolationModeRef.current)
      : 'off';
    return setVoiceIsolationMode(nextMode);
  };

  // PeerJS nesnesi tüm ses oturumu boyunca tek kalır. Gelen çağrılar sadece
  // sunucunun aktif katılımcı olarak bildirdiği peer kimliğiyle eşleşirse yanıtlanır.
  useEffect(() => {
    if (!user?.id) return undefined;

    let newPeer = null;
    let disposed = false;

    const initializePeer = async () => {
      let iceServers = [];
      try {
        iceServers = await getPeerIceServers();
      } catch (error) {
        console.warn('TURN kimliği alınamadı; varsayılan PeerJS ICE yapılandırması kullanılacak.', error);
      }
      if (disposed) return;

      newPeer = new Peer(undefined, withPeerIceServers(PEER_CONFIG, iceServers));
      peerRef.current = newPeer;

      newPeer.on('open', (id) => {
        const hadPeerId = peerIdRef.current;
        peerIdRef.current = id;
        setPeerId(id);
        setVoiceError('');

        // PeerJS bağlantısı yeniden oluşturulduysa, aktif ses kanalını yeni peerId
        // ile tekrar kaydet. Başarısız olursa yerel oturumu temizleriz.
        if (hadPeerId && isInVoiceRef.current && socketRef.current?.connected) {
          void rejoinActiveVoice();
        }
      });

      newPeer.on('call', (call) => {
        const activeChannel = activeVoiceChannelRef.current;
        const localUser = userRef.current;
        const remoteUserId = String(call.metadata?.userId || '');
        const remoteChannelId = String(call.metadata?.channelId || '');
        const participant = participantsRef.current[remoteUserId];
        const isVerifiedParticipant = Boolean(
          isInVoiceRef.current
            && activeChannel?.id
            && remoteUserId
            && !sameId(remoteUserId, localUser?.id)
            && sameId(remoteChannelId, activeChannel.id)
            && participant?.peerId
            && sameId(participant.peerId, call.peer),
        );

        if (!isVerifiedParticipant) {
          // PeerJS çağrısı aktif kanal/katılımcı doğrulamasından geçmediyse medya
          // akışını hiç cevaplamadan kapatılır.
          call.close();
          return;
        }

        if (call.metadata?.mediaKind === 'video') {
          const previousCall = incomingVideoCallsRef.current[remoteUserId];
          if (previousCall && previousCall !== call) previousCall.close();
          incomingVideoCallsRef.current[remoteUserId] = call;
          const mode = call.metadata?.mode === 'screen' ? 'screen' : 'camera';

          call.answer();
          call.on('stream', (stream) => {
            if (!stream?.getVideoTracks().length) return;
            const wasAlreadyWatching = Boolean(remoteVideoStreamsRef.current[remoteUserId]);
            setRemoteVideoStreams((previous) => {
              const updated = { ...previous, [remoteUserId]: { stream, mode } };
              remoteVideoStreamsRef.current = updated;
              return updated;
            });
            if (!wasAlreadyWatching) playFeedbackSound(FEEDBACK_SOUND_IDS.USER_JOINED_STREAM);
          });

          const removeVideoCall = () => {
            if (incomingVideoCallsRef.current[remoteUserId] === call) {
              delete incomingVideoCallsRef.current[remoteUserId];
              const wasWatching = Boolean(remoteVideoStreamsRef.current[remoteUserId]);
              removeRemoteVideo(remoteUserId);
              if (wasWatching) playFeedbackSound(FEEDBACK_SOUND_IDS.USER_LEFT_STREAM);
            }
          };
          call.on('close', removeVideoCall);
          call.on('error', removeVideoCall);
          return;
        }

        call.answer(createOutgoingStream());
        attachCall(call, remoteUserId);
      });

      newPeer.on('error', (error) => {
        console.error('PeerJS hatası:', error);
        setVoiceError(`Ses sunucusuna bağlanılamadı (${error.type || 'bilinmeyen hata'}).`);
      });
    };

    void initializePeer();

    return () => {
      disposed = true;
      if (!newPeer) return;
      if (peerRef.current === newPeer) peerRef.current = null;
      if (peerIdRef.current === newPeer.id) {
        peerIdRef.current = null;
        setPeerId(null);
      }
      newPeer.destroy();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleUserJoined = (participant) => {
      const activeChannel = activeVoiceChannelRef.current;
      if (!participant?.userId || !participant?.peerId) return;
      if (participant.channelId && !sameId(participant.channelId, activeChannel?.id)) return;

      playFeedbackSound(FEEDBACK_SOUND_IDS.USER_JOINS);
      const userId = String(participant.userId);
      const previousPeerId = participantsRef.current[userId]?.peerId;
      addVoiceParticipant(participant);
      if (previousPeerId && !sameId(previousPeerId, participant.peerId)) {
        callsRef.current[userId]?.close();
        delete callsRef.current[userId];
      }
      callParticipant(participant);
      sendCurrentVideoToParticipant(participant);
    };

    const handleExistingUsers = (payload) => {
      const participants = Array.isArray(payload) ? payload : payload?.participants;
      const channelId = Array.isArray(payload) ? null : payload?.channelId;
      if (!Array.isArray(participants)) return;
      if (channelId && !sameId(channelId, activeVoiceChannelRef.current?.id)) return;

      pendingVoiceJoinRef.current = null;
      participants.forEach((participant) => {
        if (!participant?.userId || !participant?.peerId) return;
        const userId = String(participant.userId);
        const previousPeerId = participantsRef.current[userId]?.peerId;
        addVoiceParticipant(participant);
        if (previousPeerId && !sameId(previousPeerId, participant.peerId)) {
          callsRef.current[userId]?.close();
          delete callsRef.current[userId];
        }
        callParticipant(participant);
        sendCurrentVideoToParticipant(participant);
      });
    };

    const handleUserLeft = ({ userId, channelId } = {}) => {
      const normalizedUserId = String(userId || '');
      if (channelId && normalizedUserId) {
        // Kanal altındaki genel katılımcı listesi, aktif olarak o ses
        // kanalında bulunmasak bile canlı kalmalı.
        setVoiceChannelMembers((previous) => ({
          ...previous,
          [channelId]: (previous[channelId] || [])
            .filter(member => !sameId(member?.userId || member?.id, normalizedUserId)),
        }));
      }
      if (channelId && !sameId(channelId, activeVoiceChannelRef.current?.id)) return;
      if (normalizedUserId) playFeedbackSound(FEEDBACK_SOUND_IDS.USER_LEAVES);
      callsRef.current[normalizedUserId]?.close();
      delete callsRef.current[normalizedUserId];
      removeRemoteUser(normalizedUserId);
      closeVideoCallsForUser(normalizedUserId);
      removeVoiceParticipant(normalizedUserId);
    };

    const handleStreamChanged = ({ userId, channelId, kind, mode } = {}) => {
      if (channelId && !sameId(channelId, activeVoiceChannelRef.current?.id)) return;
      const normalizedUserId = String(userId || '');
      const participant = participantsRef.current[normalizedUserId];
      if (!participant) return;
      if (sameId(normalizedUserId, userRef.current?.id)) return;

      if (kind === 'audio') {
        // Mikrofon akışı değişen taraf çağrının sahibi değilse, sahibi olan bu
        // istemci ses çağrısını yeni track ile tekrar kurar. Video çağrıları
        // ayrı tutulduğu için bu işlem kamera/yayını etkilemez.
        reconnectAudioCall(participant);
        return;
      }

      if (kind === 'video') {
        const normalizedMode = mode === 'screen' || mode === 'camera' ? mode : 'none';
        const updatedParticipant = { ...participant, streamMode: normalizedMode };
        participantsRef.current[normalizedUserId] = updatedParticipant;
        setVoiceParticipants(previous => ({
          ...previous,
          [normalizedUserId]: { ...previous[normalizedUserId], streamMode: normalizedMode },
        }));
        if (normalizedMode === 'none') {
          incomingVideoCallsRef.current[normalizedUserId]?.close();
          delete incomingVideoCallsRef.current[normalizedUserId];
          removeRemoteVideo(normalizedUserId);
        }
      }
    };

    const handleChannelMembers = ({ channelId, members } = {}) => {
      if (!channelId || !Array.isArray(members)) return;
      setVoiceChannelMembers((previous) => ({ ...previous, [channelId]: members }));
    };

    const handleChannelsSnapshot = ({ channels } = {}) => {
      if (!Array.isArray(channels)) return;
      setVoiceChannelMembers((previous) => {
        const updated = { ...previous };
        channels.forEach(({ channelId, members }) => {
          if (channelId && Array.isArray(members)) updated[channelId] = members;
        });
        return updated;
      });
    };

    const handleCapabilities = (capabilities = {}) => {
      if (!sameId(capabilities.channelId, activeVoiceChannelRef.current?.id)) return;
      applyVoiceCapabilities(capabilities);
    };

    const handleModerationState = (state = {}) => {
      if (state.channelId && !sameId(state.channelId, activeVoiceChannelRef.current?.id)) return;
      applyVoiceCapabilities({ ...voiceCapabilitiesRef.current, ...state });
    };

    const handleVoiceError = ({ message } = {}) => {
      setVoiceError(message || 'Ses kanalına bağlanılamadı.');
      if (pendingVoiceJoinRef.current) {
        pendingVoiceJoinRef.current = null;
        leaveVoiceChannelRef.current({ notifyServer: false });
      }
    };

    const handleModerated = ({ action, byUsername, serverId, state, targetChannel } = {}) => {
      const activeChannel = activeVoiceChannelRef.current;
      if (serverId && activeChannel?.serverId && !sameId(serverId, activeChannel.serverId)) return;

      if (action === 'mute') {
        applyVoiceCapabilities({ ...voiceCapabilitiesRef.current, ...state, serverMuted: true });
        playFeedbackSound(FEEDBACK_SOUND_IDS.MUTE);
        setVoiceError(`${byUsername || 'Bir moderatör'} mikrofonunu susturdu.`);
      }
      if (action === 'deafen') {
        applyVoiceCapabilities({ ...voiceCapabilitiesRef.current, ...state, serverDeafened: true });
        playFeedbackSound(FEEDBACK_SOUND_IDS.DEAFEN);
        setVoiceError(`${byUsername || 'Bir moderatör'} seni sağırlaştırdı.`);
      }
      if (action === 'unmute') {
        applyVoiceCapabilities({ ...voiceCapabilitiesRef.current, ...state, serverMuted: false });
        playFeedbackSound(FEEDBACK_SOUND_IDS.UNMUTE);
        setVoiceError(`${byUsername || 'Bir moderatör'} mikrofonunun sesini açtı.`);
      }
      if (action === 'undeafen') {
        applyVoiceCapabilities({ ...voiceCapabilitiesRef.current, ...state, serverDeafened: false });
        isDeafenedRef.current = false;
        applyDeafenState(false);
        setIsDeafened(false);
        playFeedbackSound(FEEDBACK_SOUND_IDS.UNDEAFEN);
        setVoiceError(`${byUsername || 'Bir moderatör'} sağırlaştırmayı kaldırdı.`);
      }
      if (action === 'disconnect') {
        playFeedbackSound(FEEDBACK_SOUND_IDS.LEAVE_CALL);
        setVoiceError(`${byUsername || 'Bir moderatör'} seni ses kanalından çıkardı.`);
        leaveVoiceChannelRef.current({ notifyServer: false });
      }
      if (action === 'move' || action === 'moved') {
        playFeedbackSound(FEEDBACK_SOUND_IDS.MOVED);
        if (!targetChannel?.id) {
          setVoiceError('Taşındığın ses kanalı bulunamadı.');
          leaveVoiceChannelRef.current({ notifyServer: false, playSound: false });
          return;
        }
        void joinVoiceChannel(targetChannel, { isMove: true }).then((joined) => {
          if (joined) {
            setVoiceError(`${byUsername || 'Bir moderatör'} seni ${targetChannel.name || 'başka bir ses kanalına'} taşıdı.`);
          }
        });
      }
    };

    const refreshOwnCapabilities = ({ serverId, member } = {}) => {
      const activeChannel = activeVoiceChannelRef.current;
      if (!activeChannel?.id || !sameId(serverId, activeChannel.serverId)) return;
      if (member?.id && !sameId(member.id, userRef.current?.id)) return;
      void requestVoiceCapabilities(activeChannel.id);
    };

    const handleRolesChanged = ({ serverId } = {}) => refreshOwnCapabilities({ serverId });

    const handleSocketConnect = () => {
      if (!isInVoiceRef.current) return;
      if (!peerIdRef.current) {
        setVoiceError('Ses altyapısı hazır olmadığı için kanaldan ayrıldın.');
        leaveVoiceChannelRef.current({ notifyServer: false });
        return;
      }
      void rejoinActiveVoice();
    };

    const handleSocketDisconnect = () => {
      if (isInVoiceRef.current) setVoiceError('Sunucu bağlantısı kesildi; ses bağlantısı yeniden kuruluyor…');
    };

    socket.on('voice:user-joined', handleUserJoined);
    socket.on('voice:existing-users', handleExistingUsers);
    socket.on('voice:user-left', handleUserLeft);
    socket.on('voice:stream-changed', handleStreamChanged);
    socket.on('voice:channel-members', handleChannelMembers);
    socket.on('voice:channels-snapshot', handleChannelsSnapshot);
    socket.on('voice:capabilities', handleCapabilities);
    socket.on('voice:moderation-state', handleModerationState);
    socket.on('voice:error', handleVoiceError);
    socket.on('voice:moderated', handleModerated);
    socket.on('server:member-updated', refreshOwnCapabilities);
    socket.on('roles:changed', handleRolesChanged);
    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);

    return () => {
      socket.off('voice:user-joined', handleUserJoined);
      socket.off('voice:existing-users', handleExistingUsers);
      socket.off('voice:user-left', handleUserLeft);
      socket.off('voice:stream-changed', handleStreamChanged);
      socket.off('voice:channel-members', handleChannelMembers);
      socket.off('voice:channels-snapshot', handleChannelsSnapshot);
      socket.off('voice:capabilities', handleCapabilities);
      socket.off('voice:moderation-state', handleModerationState);
      socket.off('voice:error', handleVoiceError);
      socket.off('voice:moderated', handleModerated);
      socket.off('server:member-updated', refreshOwnCapabilities);
      socket.off('roles:changed', handleRolesChanged);
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleSocketDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!isInVoice || !user?.id) {
      setSpeakingUserIds({});
      return undefined;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return undefined;

    const audioContext = new AudioContextClass();
    const sources = [
      ...(audioStreamRef.current ? [{ userId: String(user.id), stream: audioStreamRef.current }] : []),
      ...Object.entries(remoteStreams).map(([userId, stream]) => ({ userId, stream })),
    ];
    const analyzers = [];
    const speakingUntil = new Map();
    let animationFrameId;

    sources.forEach(({ userId, stream }) => {
      if (!stream.getAudioTracks().length) return;
      try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyzers.push({ userId, analyser, data: new Uint8Array(analyser.frequencyBinCount) });
      } catch (error) {
        console.warn('Konuşma algılama başlatılamadı:', error);
      }
    });

    const updateSpeakingUsers = () => {
      const now = Date.now();
      const nextSpeakingUsers = {};
      analyzers.forEach(({ userId, analyser, data }) => {
        analyser.getByteFrequencyData(data);
        const averageVolume = data.reduce((total, value) => total + value, 0) / data.length;
        if (averageVolume > 12) speakingUntil.set(userId, now + 450);
        if ((speakingUntil.get(userId) || 0) > now) nextSpeakingUsers[userId] = true;
      });

      setSpeakingUserIds((previous) => {
        const previousIds = Object.keys(previous);
        const nextIds = Object.keys(nextSpeakingUsers);
        const isSame = previousIds.length === nextIds.length && nextIds.every((id) => previous[id]);
        return isSame ? previous : nextSpeakingUsers;
      });
      animationFrameId = requestAnimationFrame(updateSpeakingUsers);
    };

    audioContext.resume().catch(() => {});
    updateSpeakingUsers();
    return () => {
      cancelAnimationFrame(animationFrameId);
      audioContext.close().catch(() => {});
    };
  }, [isInVoice, myStream, remoteStreams, user?.id]);

  // Dinleyici ilkesi: CONNECT olan ama SPEAK olmayan üye kanala katılır; ses
  // kaynağı istenmez ve panelde konuşma/yayın tuşları pasif görünür.
  leaveVoiceChannelRef.current = leaveVoiceChannel;

  return (
    <VoiceContext.Provider
      value={{
        isInVoice,
        activeVoiceChannel,
        myStream,
        cameraStream,
        screenStream,
        remoteStreams,
        remoteVideoStreams,
        isVoiceViewOpen,
        setIsVoiceViewOpen,
        toggleVoiceView: () => setIsVoiceViewOpen(open => !open),
        voiceChannelMembers,
        requestVoiceChannelMembers,
        voiceParticipants: Object.values(voiceParticipants),
        speakingUserIds,
        peers: remoteStreams,
        isMuted,
        isDeafened,
        isServerMuted,
        isServerDeafened,
        canSpeak: voiceCapabilities.canSpeak,
        canStream: voiceCapabilities.canStream,
        voiceCapabilities,
        isScreenSharing: Boolean(screenStream),
        isCameraOn: Boolean(cameraStream),
        voiceError,
        availableDevices,
        refreshAvailableDevices,
        inputDeviceId,
        outputDeviceId,
        cameraDeviceId,
        voiceMode,
        pushToTalkKey,
        isPushToTalkActive,
        voiceIsolationMode,
        effectiveVoiceIsolationMode,
        voiceProcessingStatus,
        audioProcessingSupported,
        webAudioProcessingSupported,
        nativeVoiceIsolationSupported,
        rnnoiseSupported,
        voiceProcessingEngine,
        audioQuality,
        voiceIsolationModes: VOICE_ISOLATION_MODES,
        audioQualityPresets: AUDIO_QUALITY_PRESETS,
        noiseSuppression,
        screenSharePreset,
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleMute,
        toggleDeafen,
        toggleScreenShare,
        toggleCamera,
        changeInputDevice,
        setOutputDeviceId,
        changeCameraDevice,
        setVoiceMode,
        setPushToTalkKey,
        setVoiceIsolationMode,
        setAudioQuality,
        setNoiseSuppression,
        setScreenSharePreset,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
};
