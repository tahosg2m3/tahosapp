import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, Video } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useVoice } from '../../context/VoiceContext';
import { getColorForString } from '../../utils/colors';

function MediaVideo({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = stream || null;
    if (stream) video.play().catch(() => {});
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="block h-full max-h-full w-full max-w-full bg-black object-contain"
    />
  );
}

function ParticipantTile({ participant, media, speaking, focused, onFocus, onUnfocus, isCurrentUser, muted }) {
  const tileRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const displayName = participant.nickname || participant.username || 'User';
  const hasVideo = Boolean(media?.stream?.getVideoTracks().some(track => track.readyState === 'live'));
  const announcedMode = media?.mode || participant.streamMode;
  const isWaitingForVideo = !hasVideo && (announcedMode === 'screen' || announcedMode === 'camera');

  useEffect(() => {
    const handleFullscreenChange = () => {
      const tileIsFullscreen = document.fullscreenElement === tileRef.current;
      setIsFullscreen(tileIsFullscreen);
      if (!tileIsFullscreen) setFullscreenError('');
    };
    const handleFullscreenError = event => {
      if (event.target === tileRef.current) {
        setFullscreenError('Could not enter full screen. Check browser permission and try again.');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('fullscreenerror', handleFullscreenError);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('fullscreenerror', handleFullscreenError);
    };
  }, []);

  useEffect(() => {
    if (!focused) setFullscreenError('');
  }, [focused]);

  const handleMediaClick = async () => {
    if (!hasVideo) return;

    if (!focused) {
      setFullscreenError('');
      onFocus(participant.userId);
      return;
    }

    const tile = tileRef.current;
    if (document.fullscreenElement === tile) return;
    if (!tile?.requestFullscreen) {
      setFullscreenError('This browser does not support full-screen mode.');
      return;
    }

    try {
      setFullscreenError('');
      await tile.requestFullscreen();
    } catch (error) {
      const denied = error?.name === 'NotAllowedError';
      setFullscreenError(denied
        ? 'The browser denied the full-screen request. Click the video again to retry.'
        : 'Could not enter full screen. Please try again.');
    }
  };

  const handleReturnToGrid = async () => {
    if (document.fullscreenElement === tileRef.current) {
      if (!document.exitFullscreen) {
        setFullscreenError('Could not exit full screen. You can press Esc.');
        return;
      }
      try {
        await document.exitFullscreen();
      } catch {
        setFullscreenError('Could not exit full screen. You can press Esc.');
        return;
      }
    }
    setFullscreenError('');
    onUnfocus();
  };

  return (
    <div
      ref={tileRef}
      className={`group relative w-full overflow-hidden border-2 bg-[#090f1b] text-left shadow-xl transition-all ${
        speaking ? 'border-[#22c55e] shadow-[0_0_0_2px_rgba(34,197,94,0.15)]' : focused ? 'border-[#3b82f6]' : 'border-white/[0.07]'
      } ${isFullscreen ? 'fixed inset-0 z-[9999] h-screen min-h-0 w-screen rounded-none border-0 bg-black' : focused ? 'h-full min-h-0 rounded-2xl' : 'h-full min-h-[210px] rounded-2xl'}`}
    >
      <button
        type="button"
        onClick={handleMediaClick}
        disabled={!hasVideo}
        aria-label={hasVideo
          ? focused ? `${displayName} Open video in full screen for` : `${displayName} Enlarge video for`
          : `${displayName} is not sharing video`}
        title={hasVideo ? focused ? 'Enter full screen' : 'Enlarge video' : undefined}
        className={`absolute inset-0 block h-full w-full overflow-hidden rounded-[inherit] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#60a5fa] ${hasVideo && !isFullscreen ? 'cursor-zoom-in' : 'cursor-default'}`}
      >
        {hasVideo ? (
          <MediaVideo stream={media.stream} />
        ) : (
          <div className="flex h-full min-h-[210px] flex-col items-center justify-center bg-[radial-gradient(circle_at_top,#1e293b_0%,#0b1220_72%)]">
            <div
              className={`flex h-24 w-24 items-center justify-center rounded-full text-4xl font-black text-white shadow-2xl transition-transform ${speaking ? 'scale-105 ring-4 ring-[#22c55e]/40' : ''}`}
              style={{ backgroundColor: getColorForString(displayName) }}
            >
              {displayName[0]?.toUpperCase() || '?'}
            </div>
            {isWaitingForVideo && <span className="mt-4 text-xs font-semibold text-[#94a3b8]">Connecting video…</span>}
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-4 pb-3 pt-12">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold text-white">{displayName}{isCurrentUser ? ' (Sen)' : ''}</span>
              {muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-[#f87171]" /> : speaking ? <Mic className="h-3.5 w-3.5 shrink-0 text-[#4ade80]" /> : null}
            </div>
            {hasVideo && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#cbd5e1]">
                {media.mode === 'screen' ? <MonitorUp className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                {media.mode === 'screen' ? 'Screen share' : 'Camera'}
              </span>
            )}
          </div>
          {hasVideo && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-black/35 px-2 py-1 text-[11px] font-bold text-white/90 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Maximize2 className="h-4 w-4" />
              {focused ? 'Full screen' : 'Enlarge'}
            </span>
          )}
        </div>
      </button>

      {focused && hasVideo && (
        <button
          type="button"
          onClick={handleReturnToGrid}
          className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa]"
          aria-label="Return to grid view"
          title="Return to grid view"
        >
          <Minimize2 className="h-4 w-4" />
          <span>Back to grid</span>
        </button>
      )}

      {fullscreenError && (
        <div
          role="alert"
          aria-live="assertive"
          className="pointer-events-none absolute left-3 top-3 z-30 max-w-[70%] rounded-lg border border-[#f87171]/40 bg-[#450a0a]/95 px-3 py-2 text-xs font-semibold text-[#fecaca] shadow-xl"
        >
          {fullscreenError}
        </div>
      )}
    </div>
  );
}

export default function VoiceRoomView() {
  const { user } = useAuth();
  const {
    activeVoiceChannel,
    voiceParticipants,
    speakingUserIds,
    remoteVideoStreams,
    cameraStream,
    screenStream,
    isMuted,
  } = useVoice();
  const [focusedUserId, setFocusedUserId] = useState(null);

  const participants = useMemo(() => {
    const byId = new Map((voiceParticipants || []).map(participant => [String(participant.userId), participant]));
    const currentUserId = String(user?.id || '');
    if (currentUserId && !byId.has(currentUserId)) {
      byId.set(currentUserId, { userId: currentUserId, username: user?.username || 'Sen' });
    }
    return [...byId.values()].sort((first, second) => {
      if (String(first.userId) === currentUserId) return -1;
      if (String(second.userId) === currentUserId) return 1;
      return String(first.username || '').localeCompare(String(second.username || ''), 'tr');
    });
  }, [user?.id, user?.username, voiceParticipants]);

  const mediaFor = participant => {
    const participantId = String(participant.userId);
    if (participantId === String(user?.id || '')) {
      if (screenStream) return { stream: screenStream, mode: 'screen' };
      if (cameraStream) return { stream: cameraStream, mode: 'camera' };
      return null;
    }
    return remoteVideoStreams[participantId] || null;
  };

  const focusedParticipant = participants.find(participant => String(participant.userId) === String(focusedUserId));
  const focusedMedia = focusedParticipant ? mediaFor(focusedParticipant) : null;
  const hasFocusedVideo = Boolean(focusedMedia?.stream?.getVideoTracks().some(track => track.readyState === 'live'));

  useEffect(() => {
    if (focusedUserId && !hasFocusedVideo) setFocusedUserId(null);
  }, [focusedUserId, hasFocusedVideo]);

  const renderTile = (participant, focused = false) => {
    const participantId = String(participant.userId);
    const isCurrentUser = participantId === String(user?.id || '');
    return (
      <ParticipantTile
        key={participantId}
        participant={participant}
        media={mediaFor(participant)}
        speaking={Boolean(speakingUserIds[participantId])}
        focused={focused}
        onFocus={id => setFocusedUserId(String(id))}
        onUnfocus={() => setFocusedUserId(null)}
        isCurrentUser={isCurrentUser}
        muted={isCurrentUser ? isMuted : Boolean(participant.serverMuted)}
      />
    );
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0b1220]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-white">{activeVoiceChannel?.name || 'Voice chat'}</h2>
          <p className="text-[11px] text-[#64748b]">{participants.length} people · Click once to enlarge and again for full screen</p>
        </div>
        <div className="rounded-full bg-[#22c55e]/10 px-3 py-1 text-[11px] font-bold text-[#4ade80]">Connected</div>
      </header>

      <div className={`min-h-0 flex-1 p-4 ${focusedParticipant && hasFocusedVideo ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
        {focusedParticipant && hasFocusedVideo ? (
          <div className="h-full min-h-0">{renderTile(focusedParticipant, true)}</div>
        ) : (
          <div className={`grid min-h-full auto-rows-fr gap-4 ${participants.length <= 1 ? 'grid-cols-1' : participants.length <= 4 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
            {participants.map(participant => renderTile(participant))}
          </div>
        )}
      </div>
    </main>
  );
}
