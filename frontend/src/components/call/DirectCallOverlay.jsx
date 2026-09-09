import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
} from 'lucide-react';
import { useDirectCall } from '../../context/DirectCallContext';
import { useVoice } from '../../context/VoiceContext';
import { applyAudioOutputDevice, registerAudioOutputTarget } from '../../services/audioOutputService';
import { getColorForString } from '../../utils/colors';
import { resolveSafeAvatarUrl } from '../../utils/safeMediaUrl';

function RemoteCallAudio({ stream, outputDeviceId }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream || null;
    if (stream) ref.current.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    if (!ref.current) return undefined;
    void applyAudioOutputDevice(ref.current, outputDeviceId);
    return undefined;
  }, [outputDeviceId]);
  useEffect(() => {
    if (!ref.current) return undefined;
    return registerAudioOutputTarget(ref.current);
  }, []);
  return <audio ref={ref} autoPlay playsInline />;
}

export default function DirectCallOverlay() {
  const { outputDeviceId } = useVoice();
  const {
    call,
    callError,
    remoteStream,
    isMuted,
    acceptCall,
    rejectCall,
    cancelCall,
    endCall,
    toggleCallMute,
  } = useDirectCall();
  const [remainingSeconds, setRemainingSeconds] = useState(30);

  useEffect(() => {
    if (!call || call.status !== 'ringing') return undefined;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((Number(call.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [call?.expiresAt, call?.status]);

  if (!call) return null;
  const otherUser = call.otherUser || (call.direction === 'incoming' ? call.caller : call.callee) || {};
  const name = otherUser.username || 'Unknown user';
  const initial = name[0]?.toUpperCase() || '?';
  const avatarColor = getColorForString(name);
  const avatarUrl = resolveSafeAvatarUrl(otherUser.avatar);
  const ringing = call.status === 'ringing';
  const incoming = call.direction === 'incoming';
  const active = call.status === 'active';

  return (
    <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <RemoteCallAudio stream={remoteStream} outputDeviceId={outputDeviceId} />
      <section className={`pointer-events-auto w-full overflow-hidden border border-white/[0.1] bg-[#111827]/98 shadow-2xl shadow-black/60 backdrop-blur ${ringing ? 'max-w-sm rounded-3xl' : 'fixed bottom-5 left-1/2 max-w-xl -translate-x-1/2 rounded-2xl'}`}>
        <div className={`flex ${ringing ? 'flex-col items-center px-7 py-8 text-center' : 'items-center gap-4 px-5 py-4'}`}>
          <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${ringing ? 'mb-5 h-24 w-24 text-3xl' : 'h-12 w-12 text-lg'}`} style={{ backgroundColor: avatarColor }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              : initial}
            {ringing && <span className="absolute inset-0 animate-ping rounded-full border border-[#5865f2]/60" />}
          </div>

          <div className={ringing ? '' : 'min-w-0 flex-1'}>
            <h2 className={`${ringing ? 'text-2xl' : 'truncate text-base'} font-bold text-white`}>{name}</h2>
            <div className={`mt-1 flex items-center ${ringing ? 'justify-center' : ''} gap-2 text-sm text-[#94a3b8]`}>
              {ringing ? (incoming ? <PhoneIncoming className="h-4 w-4" /> : <PhoneOutgoing className="h-4 w-4" />) : active ? <Phone className="h-4 w-4 text-[#34d399]" /> : <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{ringing ? (incoming ? 'Incoming call' : 'Calling…') : active ? 'Call connected' : 'Connecting…'}</span>
              {ringing && <span className="font-mono text-xs text-[#64748b]">{remainingSeconds}s</span>}
            </div>
            {callError && <p className="mt-2 text-xs text-[#fca5a5]">{callError}</p>}
          </div>

          {ringing ? (
            <div className="mt-7 flex items-center justify-center gap-5">
              {incoming && (
                <button type="button" onClick={acceptCall} className="flex h-14 w-14 items-center justify-center rounded-full bg-[#23a559] text-white shadow-lg transition hover:bg-[#1a7f43]" title="Accept call" aria-label="Accept call"><Phone className="h-6 w-6" /></button>
              )}
              <button type="button" onClick={incoming ? rejectCall : cancelCall} className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ef4444] text-white shadow-lg transition hover:bg-[#dc2626]" title={incoming ? 'Decline call' : 'Cancel call'} aria-label={incoming ? 'Decline call' : 'Cancel call'}><PhoneOff className="h-6 w-6" /></button>
            </div>
          ) : (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button type="button" onClick={toggleCallMute} className={`flex h-10 w-10 items-center justify-center rounded-full transition ${isMuted ? 'bg-[#ef4444] text-white' : 'bg-white/[0.08] text-[#cbd5e1] hover:bg-white/[0.14]'}`} title={isMuted ? 'Unmute microphone' : 'Mute microphone'}>{isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
              <button type="button" onClick={endCall} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#ef4444] text-white transition hover:bg-[#dc2626]" title="End call"><PhoneOff className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
