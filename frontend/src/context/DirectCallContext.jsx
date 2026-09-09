import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Peer } from 'peerjs';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useVoice } from './VoiceContext';
import { getPeerIceServers, withPeerIceServers } from '../services/turnService';
import {
  FEEDBACK_SOUND_IDS,
  playFeedbackSound,
  startFeedbackSoundLoop,
} from '../services/feedbackSoundService';
import { PEER_CONFIG as RUNTIME_PEER_CONFIG } from '../config/runtimeConfig';

const DirectCallContext = createContext(null);

const PEER_CONFIG = {
  ...RUNTIME_PEER_CONFIG,
  debug: import.meta.env.DEV ? 2 : 0,
};

function sameId(first, second) {
  return String(first || '') === String(second || '');
}

export function useDirectCall() {
  return useContext(DirectCallContext);
}

export function DirectCallProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { isInVoice, leaveVoiceChannel } = useVoice();
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callError, setCallError] = useState('');
  const [peerReady, setPeerReady] = useState(false);

  const callRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const mediaCallRef = useRef(null);
  const peerRef = useRef(null);
  const peerIdRef = useRef(null);
  const stopRingingRef = useRef(() => {});
  const endingRef = useRef(false);
  const socketRef = useRef(socket);
  const isInVoiceRef = useRef(isInVoice);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { isInVoiceRef.current = isInVoice; }, [isInVoice]);

  const storeCall = (nextCall) => {
    callRef.current = nextCall;
    setCall(nextCall);
  };

  const patchCall = (updates) => {
    if (!callRef.current) return null;
    const next = { ...callRef.current, ...updates };
    storeCall(next);
    return next;
  };

  const stopRinging = () => {
    stopRingingRef.current?.();
    stopRingingRef.current = () => {};
  };

  const startRinging = (soundId) => {
    stopRinging();
    stopRingingRef.current = startFeedbackSoundLoop(soundId, { maxDurationMs: 30_000 });
  };

  const releaseMedia = ({ closeCall = true } = {}) => {
    endingRef.current = true;
    if (closeCall) mediaCallRef.current?.close();
    mediaCallRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    queueMicrotask(() => { endingRef.current = false; });
  };

  const clearCall = ({ playEndSound = false } = {}) => {
    const hadCall = Boolean(callRef.current);
    stopRinging();
    releaseMedia();
    storeCall(null);
    if (hadCall && playEndSound) playFeedbackSound(FEEDBACK_SOUND_IDS.LEAVE_CALL);
  };

  const emitWithAck = (eventName, payload, timeoutMs = 8_000) => new Promise((resolve) => {
    const currentSocket = socketRef.current;
    if (!currentSocket?.connected) {
      resolve({ success: false, error: 'No server connection.' });
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: 'The server did not respond in time.' });
    }, timeoutMs);
    currentSocket.emit(eventName, payload, (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result || { success: false, error: 'Invalid server response.' });
    });
  });

  const ensureLocalMicrophone = async () => {
    if (localStreamRef.current?.getAudioTracks().some(track => track.readyState === 'live')) {
      return localStreamRef.current;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device does not support microphone access.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  const attachMediaCall = (nextMediaCall) => {
    if (!nextMediaCall) return;
    if (mediaCallRef.current && mediaCallRef.current !== nextMediaCall) mediaCallRef.current.close();
    mediaCallRef.current = nextMediaCall;

    nextMediaCall.on('stream', (stream) => {
      if (mediaCallRef.current !== nextMediaCall) return;
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      patchCall({ status: 'active', connectedAt: Date.now() });
      socketRef.current?.emit('call:connected', { callId: callRef.current?.id });
      setCallError('');
    });

    const handleClosed = () => {
      if (mediaCallRef.current !== nextMediaCall) return;
      mediaCallRef.current = null;
      if (endingRef.current || !callRef.current) return;
      const callId = callRef.current.id;
      socketRef.current?.emit('call:end', { callId, reason: 'peer-closed' });
      clearCall({ playEndSound: true });
    };
    nextMediaCall.on('close', handleClosed);
    nextMediaCall.on('error', handleClosed);
  };

  useEffect(() => {
    if (!user?.id) return undefined;
    let peer = null;
    let disposed = false;

    const initializePeer = async () => {
      let iceServers = [];
      try {
        iceServers = await getPeerIceServers();
      } catch (error) {
        console.warn('Could not obtain TURN credentials; the default PeerJS ICE configuration will be used.', error);
      }
      if (disposed) return;

      peer = new Peer(undefined, withPeerIceServers(PEER_CONFIG, iceServers));
      peerRef.current = peer;
      setPeerReady(false);

      peer.on('open', (id) => {
        if (peerRef.current !== peer) return;
        peerIdRef.current = id;
        setPeerReady(true);
      });

      peer.on('call', (incomingMediaCall) => {
        const current = callRef.current;
        const metadata = incomingMediaCall.metadata || {};
        const valid = current
          && current.direction === 'incoming'
          && ['connecting', 'active'].includes(current.status)
          && metadata.callKind === 'direct'
          && sameId(metadata.callId, current.id)
          && sameId(metadata.userId, current.callerId)
          && localStreamRef.current;
        if (!valid) {
          incomingMediaCall.close();
          return;
        }
        incomingMediaCall.answer(localStreamRef.current);
        attachMediaCall(incomingMediaCall);
      });

      peer.on('error', (error) => {
        if (['peer-unavailable', 'network', 'server-error'].includes(error?.type)) {
          setCallError('The call connection could not be established.');
        }
      });
    };

    void initializePeer();

    return () => {
      disposed = true;
      if (!peer) return;
      if (peerRef.current === peer) peerRef.current = null;
      if (peerIdRef.current === peer.id) peerIdRef.current = null;
      setPeerReady(false);
      peer.destroy();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleIncoming = ({ call: incomingCall } = {}) => {
      if (!incomingCall?.id || callRef.current) return;
      setCallError('');
      storeCall({
        ...incomingCall,
        direction: 'incoming',
        otherUser: incomingCall.caller,
        status: 'ringing',
      });
      startRinging(FEEDBACK_SOUND_IDS.INCOMING_CALL);
    };

    const handleAccepted = ({ call: acceptedCall, calleePeerId } = {}) => {
      const current = callRef.current;
      if (!current || !sameId(current.id, acceptedCall?.id)) return;
      stopRinging();

      if (current.direction === 'incoming') {
        if (!sameId(calleePeerId, peerIdRef.current)) {
          clearCall();
          return;
        }
        patchCall({ ...acceptedCall, direction: 'incoming', otherUser: acceptedCall.caller, status: 'connecting' });
        return;
      }

      const stream = localStreamRef.current;
      const peer = peerRef.current;
      if (!stream || !peer || !calleePeerId) {
        socket.emit('call:end', { callId: current.id, reason: 'media-unavailable' });
        clearCall({ playEndSound: true });
        return;
      }
      patchCall({ ...acceptedCall, direction: 'outgoing', otherUser: acceptedCall.callee, status: 'connecting' });
      const outgoingMediaCall = peer.call(calleePeerId, stream, {
        metadata: { callKind: 'direct', callId: current.id, userId: user?.id },
      });
      attachMediaCall(outgoingMediaCall);
    };

    const handleFinished = ({ callId } = {}) => {
      if (!callRef.current || (callId && !sameId(callId, callRef.current.id))) return;
      clearCall({ playEndSound: true });
    };

    const handleDisconnect = () => {
      if (callRef.current) {
        setCallError('The server connection was lost, so the call ended.');
        clearCall({ playEndSound: true });
      }
    };

    socket.on('call:incoming', handleIncoming);
    socket.on('call:accepted', handleAccepted);
    socket.on('call:rejected', handleFinished);
    socket.on('call:cancelled', handleFinished);
    socket.on('call:timeout', handleFinished);
    socket.on('call:ended', handleFinished);
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('call:incoming', handleIncoming);
      socket.off('call:accepted', handleAccepted);
      socket.off('call:rejected', handleFinished);
      socket.off('call:cancelled', handleFinished);
      socket.off('call:timeout', handleFinished);
      socket.off('call:ended', handleFinished);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, user?.id]);

  useEffect(() => () => clearCall(), [user?.id]);

  const startCall = async ({ targetUser, conversationId }) => {
    if (callRef.current) return { success: false, error: 'You are already in a call.' };
    if (!targetUser?.id || !conversationId || !peerReady || !peerIdRef.current) {
      return { success: false, error: 'Call services are not ready yet.' };
    }

    setCallError('');
    try {
      if (isInVoiceRef.current) leaveVoiceChannel();
      await ensureLocalMicrophone();
    } catch (error) {
      releaseMedia();
      return { success: false, error: 'Microphone permission is required for calls.' };
    }

    const result = await emitWithAck('call:start', { targetUserId: targetUser.id, conversationId });
    if (!result?.success) {
      releaseMedia();
      return result;
    }
    const outgoingCall = {
      ...result.call,
      direction: 'outgoing',
      otherUser: targetUser,
      status: 'ringing',
    };
    storeCall(outgoingCall);
    startRinging(FEEDBACK_SOUND_IDS.OUTGOING_CALL);
    return { success: true, call: outgoingCall };
  };

  const acceptCall = async () => {
    const current = callRef.current;
    if (!current || current.direction !== 'incoming' || current.status !== 'ringing') return false;
    if (!peerReady || !peerIdRef.current) {
      setCallError('Call services are not ready yet.');
      return false;
    }
    stopRinging();
    try {
      if (isInVoiceRef.current) leaveVoiceChannel();
      await ensureLocalMicrophone();
    } catch (error) {
      setCallError('Microphone permission is required to accept the call.');
      startRinging(FEEDBACK_SOUND_IDS.INCOMING_CALL);
      return false;
    }
    patchCall({ status: 'connecting' });
    const result = await emitWithAck('call:accept', { callId: current.id, peerId: peerIdRef.current });
    if (!result?.success) {
      setCallError(result?.error || 'Arama kabul edilemedi.');
      clearCall({ playEndSound: true });
      return false;
    }
    return true;
  };

  const rejectCall = async () => {
    const current = callRef.current;
    if (!current) return;
    stopRinging();
    await emitWithAck('call:reject', { callId: current.id });
    clearCall({ playEndSound: true });
  };

  const cancelCall = async () => {
    const current = callRef.current;
    if (!current) return;
    stopRinging();
    await emitWithAck('call:cancel', { callId: current.id });
    clearCall({ playEndSound: true });
  };

  const endCall = async () => {
    const current = callRef.current;
    if (!current) return;
    stopRinging();
    socketRef.current?.emit('call:end', { callId: current.id, reason: 'ended' });
    clearCall({ playEndSound: true });
  };

  const toggleCallMute = () => {
    if (!localStreamRef.current) return;
    const nextMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
    setIsMuted(nextMuted);
    playFeedbackSound(nextMuted ? FEEDBACK_SOUND_IDS.MUTE : FEEDBACK_SOUND_IDS.UNMUTE);
  };

  return (
    <DirectCallContext.Provider value={{
      call,
      callError,
      peerReady,
      localStream,
      remoteStream,
      isMuted,
      startCall,
      acceptCall,
      rejectCall,
      cancelCall,
      endCall,
      toggleCallMute,
    }}>
      {children}
    </DirectCallContext.Provider>
  );
}
