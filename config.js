/*
  ЛІНІЯ — мережевий конфіг.

  ВАЖЛИВО: старі безкоштовні TURN-сервери PeerJS більше не використовуються.
  Для надійного mobile <-> Wi-Fi підключення налаштуй Metered Open Relay нижче.
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

  // Працює для прямих P2P-з'єднань. TURN додається динамічно нижче.
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" }
  ],

  // Безкоштовний TURN через Metered Open Relay.
  // 1) створи free account на Metered
  // 2) створи TURN credential
  // 3) встав appName та credential-scoped apiKey сюди.
  // Документація Metered каже, що credential apiKey можна використовувати у frontend.
  meteredTurn: {
    enabled: false,
    appName: "",
    apiKey: ""
  },

  outgoingCallTimeoutMs: 25000,
  audioMaxBitrate: 64000
};
