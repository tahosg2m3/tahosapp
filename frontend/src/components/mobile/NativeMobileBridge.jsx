import { useCallback, useEffect, useRef } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { useVoice } from '../../context/VoiceContext';
import { useDirectCall } from '../../context/DirectCallContext';
import { useSocket } from '../../context/SocketContext';
import { isNativeAndroid } from '../../utils/nativePlatform';

const CallSession = registerPlugin('CallSession');

export default function NativeMobileBridge() {
  const { isInVoice, myStream } = useVoice();
  const { localStream } = useDirectCall();
  const { socket } = useSocket();
  const commandQueue = useRef(Promise.resolve());
  const hasMicrophoneRef = useRef(false);
  const audioStream = isInVoice ? myStream : localStream;
  const hasMicrophone = Boolean(audioStream?.getAudioTracks().some(track => track.readyState === 'live'));

  const enqueue = useCallback((method) => {
    commandQueue.current = commandQueue.current
      .catch(() => {})
      .then(() => CallSession[method]({ title: 'tahosapp sesli görüşme' }))
      .catch(error => console.warn('Android call session:', error.message));
  }, []);

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;
    let disposed = false;
    const handles = [];
    const listen = async (name, handler) => {
      const handle = await NativeApp.addListener(name, handler);
      if (disposed) await handle.remove();
      else handles.push(handle);
    };
    void listen('backButton', ({ canGoBack }) => {
      if (!window.dispatchEvent(new Event('tahosapp:back', { cancelable: true }))) return;
      // A hardware Back press must not terminate an ongoing voice call.
      if (canGoBack) window.history.back();
      else void NativeApp.minimizeApp();
    });
    void listen('appStateChange', ({ isActive }) => {
      if (isActive && socket && !socket.connected) socket.connect();
      // The microphone permission prompt can briefly pause the Activity. Retry
      // after it becomes visible so Android 14+ accepts the foreground service.
      if (isActive && hasMicrophoneRef.current) enqueue('start');
    });
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove();
    };
  }, [enqueue, socket]);

  useEffect(() => {
    if (!isNativeAndroid()) return undefined;
    hasMicrophoneRef.current = hasMicrophone;
    enqueue(hasMicrophone ? 'start' : 'stop');
    const tracks = audioStream?.getAudioTracks() || [];
    const handleEnded = () => {
      hasMicrophoneRef.current = false;
      enqueue('stop');
    };
    tracks.forEach(track => track.addEventListener('ended', handleEnded));
    return () => {
      tracks.forEach(track => track.removeEventListener('ended', handleEnded));
      if (hasMicrophone) enqueue('stop');
    };
  }, [audioStream, enqueue, hasMicrophone]);

  return null;
}
