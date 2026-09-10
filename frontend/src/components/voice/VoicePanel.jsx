import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Mic, MicOff, MonitorUp, Music, PhoneOff, Settings, Users, Video, VideoOff, Volume2, VolumeX, X } from 'lucide-react';
import { useVoice } from '../../context/VoiceContext';
import { useSocket } from '../../context/SocketContext';
import { applyAudioOutputDevice, registerAudioOutputTarget } from '../../services/audioOutputService';

function RemoteAudio({ stream, muted, outputDeviceId }) {
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.srcObject = stream;
    audioRef.current.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    if (!audioRef.current) return undefined;
    void applyAudioOutputDevice(audioRef.current, outputDeviceId);
    return undefined;
  }, [outputDeviceId]);

  useEffect(() => {
    if (!audioRef.current) return undefined;
    return registerAudioOutputTarget(audioRef.current);
  }, []);

  return <audio ref={audioRef} autoPlay playsInline muted={muted} />;
}

async function playSynthSound(soundId) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const audioContext = new AudioContextClass();
  const unregisterOutput = registerAudioOutputTarget(audioContext);
  const patterns = {
    tada: [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.38]],
    alert: [[880, 0], [440, 0.16], [880, 0.32]],
    levelup: [[392, 0], [523, 0.1], [659, 0.2], [784, 0.3]],
    boop: [[740, 0], [520, 0.12]],
  };
  const notes = patterns[soundId] || patterns.boop;
  const routed = await applyAudioOutputDevice(audioContext);
  if (!routed) {
    unregisterOutput();
    await audioContext.close().catch(() => {});
    return;
  }
  await audioContext.resume().catch(() => {});
  notes.forEach(([frequency, offset], index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = soundId === 'alert' ? 'square' : 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + offset + 0.16);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + offset);
    oscillator.stop(audioContext.currentTime + offset + 0.18);
    if (index === notes.length - 1) oscillator.onended = () => {
      unregisterOutput();
      audioContext.close().catch(() => {});
    };
  });
}

export default function VoicePanel() {
  const [showSettings, setShowSettings] = useState(false);
  const [stageRequested, setStageRequested] = useState(false);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const { socket } = useSocket();
  const {
    isInVoice,
    activeVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    toggleCamera,
    isMuted,
    isDeafened,
    isScreenSharing,
    isCameraOn,
    remoteStreams,
    remoteVideoStreams,
    voiceParticipants,
    isVoiceViewOpen,
    toggleVoiceView,
    canSpeak,
    canStream,
    isServerMuted,
    isServerDeafened,
    voiceError,
    availableDevices,
    inputDeviceId,
    outputDeviceId,
    cameraDeviceId,
    voiceMode,
    pushToTalkKey,
    isPushToTalkActive,
    voiceIsolationMode,
    effectiveVoiceIsolationMode,
    voiceProcessingStatus,
    rnnoiseSupported,
    voiceProcessingEngine,
    audioQuality,
    screenSharePreset,
    changeInputDevice,
    setOutputDeviceId,
    changeCameraDevice,
    setVoiceMode,
    setPushToTalkKey,
    setVoiceIsolationMode,
    setAudioQuality,
    setScreenSharePreset,
  } = useVoice();

  useEffect(() => {
    if (!socket || !activeVoiceChannel?.id) return undefined;
    const play = payload => {
      if (!payload?.channelId || payload.channelId === activeVoiceChannel.id) playSynthSound(payload.soundId);
    };
    socket.on('voice:soundboard:play', play);
    return () => socket.off('voice:soundboard:play', play);
  }, [activeVoiceChannel?.id, socket]);

  if (!isInVoice || !activeVoiceChannel) return null;

  const isStage = activeVoiceChannel.type === 'stage';
  const requestToSpeak = () => {
    socket?.emit('voice:stage:request-to-speak', { channelId: activeVoiceChannel.id }, result => {
      if (result?.success) setStageRequested(true);
    });
  };

  const playSoundboard = soundId => {
    playSynthSound(soundId);
    socket?.emit('voice:soundboard:play', { channelId: activeVoiceChannel.id, soundId }, result => {
      if (result && !result.success) setShowSoundboard(false);
    });
  };

  const liveVideoCount = Object.keys(remoteVideoStreams).length + (isScreenSharing || isCameraOn ? 1 : 0);
  const voiceProcessingLabels = {
    idle: 'Your selected setting is applied when you join a voice channel.',
    starting: 'Preparing the new voice processing pipeline…',
    active: effectiveVoiceIsolationMode === 'strong' && voiceProcessingEngine === 'rnnoise'
      ? 'RNNoise AI noise suppression is active.'
      : `${effectiveVoiceIsolationMode === 'standard' ? 'Standard' : 'Off'} voice isolation is active.`,
    fallback: effectiveVoiceIsolationMode === 'off'
      ? 'Isolation is off; the microphone is using browser-compatible settings.'
      : 'Standard noise reduction is being used when supported by the browser.',
    error: 'The new setting could not be applied; the active voice connection is unchanged.',
  };

  return (
    <section className="relative shrink-0 border-t border-white/[0.06] bg-[#151b27] p-4">
      {Object.entries(remoteStreams).map(([userId, stream]) => (
        <RemoteAudio key={userId} stream={stream} muted={isDeafened} outputDeviceId={outputDeviceId} />
      ))}

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-[#34d399]">Voice connected</div>
          <div className="truncate text-[12px] text-[#94a3b8]">{activeVoiceChannel.name}</div>
          {!canSpeak && <div className="mt-1 text-[11px] text-[#fbbf24]">Listener mode — you cannot speak</div>}
          {canSpeak && voiceMode === 'push-to-talk' && <div className={`mt-1 text-[11px] ${isPushToTalkActive ? 'font-bold text-[#34d399]' : 'text-[#fbbf24]'}`}>{isPushToTalkActive ? 'You are speaking' : `${pushToTalkKey} hold to talk`}</div>}
          {isStage && !canSpeak && <button type="button" disabled={stageRequested} onClick={requestToSpeak} className="mt-1 text-[11px] font-semibold text-[#60a5fa] hover:underline disabled:text-[#fbbf24] disabled:no-underline">{stageRequested ? 'Request to speak sent' : 'Request to speak'}</button>}
          {voiceError && <div className="mt-1 text-[11px] text-[#fca5a5]">{voiceError}</div>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={toggleVoiceView}
            className={`relative flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-colors ${isVoiceViewOpen ? 'bg-[#2563eb] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title={isVoiceViewOpen ? 'Return to chat' : 'Show voice room'}
          >
            {isVoiceViewOpen ? <MessageSquare className="h-4 w-4" /> : <Users className="h-4 w-4" />}
            <span className="hidden xl:inline">{isVoiceViewOpen ? 'Chat' : 'Room'}</span>
            {liveVideoCount > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[9px] text-white">{liveVideoCount}</span>}
            {liveVideoCount === 0 && voiceParticipants.length > 0 && <span className="text-[9px] text-[#94a3b8]">{voiceParticipants.length}</span>}
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(show => !show)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${showSettings ? 'bg-[#2563eb] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title="Voice settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          <div className="relative">
            <button type="button" onClick={() => setShowSoundboard(show => !show)} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${showSoundboard ? 'bg-[#7c3aed] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`} title="Soundboard"><Music className="h-4 w-4" /></button>
            {showSoundboard && <div className="absolute bottom-12 right-0 z-50 grid w-48 grid-cols-2 gap-1 rounded-xl border border-white/[0.09] bg-[#0f172a] p-2 shadow-2xl">{[['tada', '🎉 Celebration'], ['alert', '🚨 Alert'], ['levelup', '⭐ Level'], ['boop', '🔔 Boop']].map(([id, label]) => <button key={id} type="button" onClick={() => playSoundboard(id)} className="rounded-lg bg-white/[0.05] px-2 py-2 text-xs font-semibold text-[#cbd5e1] hover:bg-white/[0.1] hover:text-white">{label}</button>)}</div>}
          </div>

          <button
            type="button"
            onClick={toggleMute}
            disabled={!canSpeak || isServerMuted}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isMuted ? 'bg-[#ef4444] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title={!canSpeak ? 'You do not have permission to speak' : isServerMuted ? 'Your microphone was muted by a moderator' : isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={toggleDeafen}
            disabled={isServerDeafened}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isDeafened ? 'bg-[#ef4444] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title={isServerDeafened ? 'You were deafened by a moderator' : isDeafened ? 'Enable audio' : 'Deafen'}
          >
            {isDeafened ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={!canStream && !isScreenSharing}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isScreenSharing ? 'bg-[#2563eb] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title={!canStream && !isScreenSharing ? 'You do not have permission to stream' : isScreenSharing ? 'Stop stream' : 'Share your screen'}
          >
            <MonitorUp className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleCamera}
            disabled={!canStream && !isCameraOn}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isCameraOn ? 'bg-[#2563eb] text-white' : 'bg-white/[0.07] text-[#cbd5e1] hover:bg-white/[0.12]'}`}
            title={!canStream && !isCameraOn ? 'You do not have permission to use the camera' : isCameraOn ? 'Turn off camera' : 'Turn on camera'}
          >
            {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={leaveVoiceChannel}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ef4444] text-white transition-colors hover:bg-[#dc2626]"
            title="Leave voice channel"
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="custom-scrollbar absolute bottom-full right-4 z-[70] mb-2 max-h-[min(64vh,560px)] w-[min(760px,calc(100%-2rem))] overflow-y-auto rounded-xl border border-white/[0.1] bg-[#0f172a] p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-white">Voice & Video</h3><p className="text-[10px] text-[#64748b]">Changes apply to the active call.</p></div><button type="button" onClick={() => setShowSettings(false)} className="rounded p-1 text-[#94a3b8] hover:bg-white/[0.07] hover:text-white"><X className="h-4 w-4" /></button></div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Input device<select value={inputDeviceId} onChange={event => changeInputDevice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="">System default</option>{availableDevices.audioinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Output device<select value={outputDeviceId} onChange={event => setOutputDeviceId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="">System default</option>{availableDevices.audiooutput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Camera<select value={cameraDeviceId} onChange={event => changeCameraDevice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="">System default</option>{availableDevices.videoinput.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Input mode<select value={voiceMode} onChange={event => setVoiceMode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="activity">Voice activity</option><option value="push-to-talk">Push to talk</option></select></label>
            {voiceMode === 'push-to-talk' && <label className="text-[10px] font-bold uppercase text-[#64748b]">Push-to-talk key<input readOnly value={pushToTalkKey} onKeyDown={event => { event.preventDefault(); setPushToTalkKey(event.code); }} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-center text-xs font-bold text-[#cbd5e1] outline-none focus:border-[#3b82f6]" title="Select the field and press the key you want" /></label>}
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Voice isolation<select value={voiceIsolationMode} onChange={event => void setVoiceIsolationMode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="off">Off</option><option value="standard">Standard</option><option value="strong" disabled={!rnnoiseSupported}>RNNoise (Strong){!rnnoiseSupported ? ' — not supported' : ''}</option></select></label>
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Audio quality<select value={audioQuality} onChange={event => void setAudioQuality(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="standard">Standard</option><option value="high">High</option><option value="studio">Studio</option></select></label>
            <label className="text-[10px] font-bold uppercase text-[#64748b]">Stream quality<select value={screenSharePreset} onChange={event => setScreenSharePreset(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-[#151d2c] px-2 py-2 text-xs text-[#cbd5e1] outline-none"><option value="720p30">720p / 30 FPS</option><option value="1080p30">1080p / 30 FPS</option><option value="1080p60">1080p / 60 FPS</option></select></label>
            <div className={`rounded-lg border px-3 py-2 text-xs md:col-span-2 ${voiceProcessingStatus === 'error' ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]' : voiceProcessingStatus === 'fallback' ? 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#fcd34d]' : 'border-[#22c55e]/20 bg-[#22c55e]/10 text-[#86efac]'}`} role="status" aria-live="polite">{voiceProcessingLabels[voiceProcessingStatus] || voiceProcessingLabels.idle}</div>
          </div>
        </div>
      )}
    </section>
  );
}
