import { useEffect, useRef } from 'react';
import { MonitorOff } from 'lucide-react';
import { useVoice } from '../../context/VoiceContext';

function StreamVideo({ stream, label, muted }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[0.08] bg-black shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full object-contain"
      />
      <span className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-[11px] font-medium text-white">
        {label}
      </span>
    </div>
  );
}

export default function VideoGrid() {
  const {
    cameraStream,
    screenStream,
    remoteStreams,
    isDeafened,
    toggleScreenShare,
  } = useVoice();

  const remoteVideoStreams = Object.entries(remoteStreams).filter(
    ([, stream]) => stream.getVideoTracks().length > 0,
  );

  return (
    <div className="mb-4 rounded-xl border border-white/[0.06] bg-[#0f172a] p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#94a3b8]">Streams</span>
        {screenStream && (
          <button
            type="button"
            onClick={toggleScreenShare}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-[#fca5a5] hover:bg-white/[0.06]"
          >
            <MonitorOff className="h-3.5 w-3.5" /> Stop stream
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {cameraStream && !screenStream && <StreamVideo stream={cameraStream} label="Your camera" muted />}
        {screenStream && <StreamVideo stream={screenStream} label="Your stream" muted />}
        {remoteVideoStreams.map(([userId, stream]) => (
          <StreamVideo key={userId} stream={stream} label={userId} muted />
        ))}
      </div>
    </div>
  );
}
