/*
  ЛІНІЯ — конфігурація мережі.
  За замовчуванням використовується публічний PeerServer Cloud тільки для signaling.
  Голос передається через WebRTC напряму або через TURN, якщо пряме з'єднання неможливе.
*/
window.PHONE_CONFIG = {
  appName: "Лінія",

  signaling: {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    key: "peerjs",
    secure: true,
    version: "1.5.5",
    pingIntervalMs: 5000,
    reconnectMaxMs: 15000
  },

  // Відповідає default ICE config PeerJS 1.5.5.
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: [
        "turn:eu-0.turn.peerjs.com:3478",
        "turn:us-0.turn.peerjs.com:3478"
      ],
      username: "peerjs",
      credential: "peerjsp"
    }
  ],

  outgoingCallTimeoutMs: 30000,
  audioMaxBitrate: 64000
};
