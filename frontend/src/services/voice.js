export const createPeerConnection = (socket, remoteUserId, stream) => {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  stream.getTracks().forEach(track => {
    pc.addTrack(track, stream);
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('voice:signal', {
        to: remoteUserId,
        data: { candidate: event.candidate }
      });
    }
  };

  return pc;
};

// PeerJS akışını kullanan mevcut VoiceContext has bu yardımcılar optional
// olarak kullanılabilir; modül yüklenirken medya izni istemezler.
export const requestMicrophoneStream = () => navigator.mediaDevices.getUserMedia({
  audio: true,
  video: false,
});

export const requestCameraStream = () => navigator.mediaDevices.getUserMedia({
  audio: false,
  video: true,
});

export const requestScreenStream = () => navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: false,
});
