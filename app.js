(() => {
  "use strict";

  const CFG = window.PHONE_CONFIG;
  const $ = (id) => document.getElementById(id);

  const els = {
    appName: $("appName"),
    signalStatus: $("signalStatus"),
    statusDot: $("statusDot"),
    statusText: $("statusText"),
    homePanel: $("homePanel"),
    modeLabel: $("modeLabel"),
    heroTitle: $("heroTitle"),
    heroCopy: $("heroCopy"),
    hostActions: $("hostActions"),
    guestActions: $("guestActions"),
    createInviteBtn: $("createInviteBtn"),
    inviteBox: $("inviteBox"),
    inviteUrl: $("inviteUrl"),
    copyInviteBtn: $("copyInviteBtn"),
    shareInviteBtn: $("shareInviteBtn"),
    callBtn: $("callBtn"),
    guestHint: $("guestHint"),
    callPanel: $("callPanel"),
    callState: $("callState"),
    callTimer: $("callTimer"),
    networkInfo: $("networkInfo"),
    muteBtn: $("muteBtn"),
    settingsBtn: $("settingsBtn"),
    hangupBtn: $("hangupBtn"),
    settingsPanel: $("settingsPanel"),
    closeSettingsBtn: $("closeSettingsBtn"),
    microphoneRow: $("microphoneRow"),
    microphoneSelect: $("microphoneSelect"),
    prepareMicBtn: $("prepareMicBtn"),
    micHint: $("micHint"),
    opponentVolume: $("opponentVolume"),
    opponentVolumeValue: $("opponentVolumeValue"),
    incomingModal: $("incomingModal"),
    acceptBtn: $("acceptBtn"),
    declineBtn: $("declineBtn"),
    audioUnlockBtn: $("audioUnlockBtn"),
    remoteAudio: $("remoteAudio"),
    toast: $("toast"),
    switches: [...document.querySelectorAll(".switch[data-constraint]")]
  };

  const supported = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  const join = parseJoinHash();

  const state = {
    role: join ? "guest" : "host",
    localId: "",
    token: "",
    hostSecret: "",
    targetId: join?.peerId || "",
    targetSecret: join?.secret || "",

    socket: null,
    socketOpen: false,
    signalReady: false,
    signalQueue: [],
    heartbeatTimer: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    intentionalSocketClose: false,

    pc: null,
    controlChannel: null,
    localStream: null,
    remoteStream: null,
    remotePeerId: "",
    connectionId: "",
    pendingOffer: null,
    pendingCandidates: new Map(),
    outgoingTimer: null,
    callStartedAt: 0,
    callTimerInterval: null,
    statsInterval: null,
    connected: false,
    isMuted: false,
    selectedDeviceId: "",
    resolvedIceServers: null,
    iceConfigError: "",

    remoteVolume: 100,
    audioContext: null,
    remoteAudioSource: null,
    remoteGain: null,

    audioPrefs: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },

    toastTimer: null
  };

  init();

  function init() {
    els.appName.textContent = CFG.appName || "Лінія";
    initIdentity();
    setupModeUI();
    setupAudioPreferenceUI();
    setupOpponentVolumeUI();
    bindEvents();
    refreshMicrophones(false).catch(() => {});
    resolveIceServers().catch(() => {});
    connectSignaling();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function initIdentity() {
    if (state.role === "host") {
      state.localId = sessionStorage.getItem("liniya-host-id") || randomToken(22, "h-");
      state.token = sessionStorage.getItem("liniya-host-token") || randomToken(28, "t-");
      state.hostSecret = sessionStorage.getItem("liniya-host-secret") || randomToken(24, "s-");
      sessionStorage.setItem("liniya-host-id", state.localId);
      sessionStorage.setItem("liniya-host-token", state.token);
      sessionStorage.setItem("liniya-host-secret", state.hostSecret);
    } else {
      state.localId = randomToken(22, "g-");
      state.token = randomToken(28, "t-");
    }
  }

  function setupModeUI() {
    if (state.role === "guest") {
      els.modeLabel.textContent = "Запрошення на дзвінок";
      els.heroTitle.textContent = "Подзвонити?";
      els.heroCopy.textContent = "Ти відкрив приватне посилання. Натисни кнопку — браузер попросить доступ до мікрофона і почне дзвінок.";
      els.hostActions.classList.add("hidden");
      els.guestActions.classList.remove("hidden");
    } else {
      els.modeLabel.textContent = "Твоя лінія";
      els.heroTitle.textContent = "Створи дзвінок";
      els.heroCopy.textContent = "Отримаєш приватне посилання. Надішли його співрозмовнику і залиш цю сторінку відкритою.";
    }
  }

  function setupAudioPreferenceUI() {
    for (const button of els.switches) {
      const key = button.dataset.constraint;
      const isSupported = Boolean(supported[key]);
      if (!isSupported) {
        button.disabled = true;
        button.title = "Цей браузер не повідомляє про підтримку цієї опції";
        button.querySelector("span").textContent = "—";
      } else {
        setSwitchVisual(button, false);
      }
    }
  }

  function setupOpponentVolumeUI() {
    setOpponentVolume(state.remoteVolume);
  }

  function bindEvents() {
    els.createInviteBtn.addEventListener("click", showInvite);
    els.copyInviteBtn.addEventListener("click", copyInvite);
    els.shareInviteBtn.addEventListener("click", shareInvite);
    els.callBtn.addEventListener("click", startOutgoingCall);
    els.acceptBtn.addEventListener("click", acceptIncomingCall);
    els.declineBtn.addEventListener("click", declineIncomingCall);
    els.hangupBtn.addEventListener("click", () => endCall({ notify: true, message: "Дзвінок завершено" }));
    els.muteBtn.addEventListener("click", toggleMute);
    els.settingsBtn.addEventListener("click", openSettingsDuringCall);
    els.closeSettingsBtn.addEventListener("click", closeSettingsDuringCall);
    els.prepareMicBtn.addEventListener("click", prepareMicrophone);
    els.microphoneSelect.addEventListener("change", () => switchMicrophone(els.microphoneSelect.value));
    els.opponentVolume.addEventListener("input", () => setOpponentVolume(Number(els.opponentVolume.value)));
    els.audioUnlockBtn.addEventListener("click", unlockRemoteAudio);

    for (const button of els.switches) {
      button.addEventListener("click", () => toggleAudioPreference(button));
    }

    navigator.mediaDevices?.addEventListener?.("devicechange", () => refreshMicrophones(Boolean(state.localStream)).catch(() => {}));
    window.addEventListener("beforeunload", () => {
      state.intentionalSocketClose = true;
      cleanupTimers();
      try { state.controlChannel?.close(); } catch (_) {}
      try { state.pc?.close(); } catch (_) {}
      stopLocalStream();
      try { state.socket?.close(); } catch (_) {}
    });
  }

  function parseJoinHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const value = params.get("join");
    if (!value) return null;
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const peerId = value.slice(0, dot);
    const secret = value.slice(dot + 1);
    if (!peerId || !secret) return null;
    return { peerId, secret };
  }

  function randomToken(length = 24, prefix = "") {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = prefix;
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }

  function buildInviteUrl() {
    const url = new URL(location.href);
    url.hash = `join=${encodeURIComponent(`${state.localId}.${state.hostSecret}`)}`;
    return url.toString();
  }

  function setSignalStatus(text, kind = "idle") {
    els.statusText.textContent = text;
    els.statusDot.classList.toggle("online", kind === "online");
    els.statusDot.classList.toggle("error", kind === "error");
  }

  function connectSignaling() {
    clearTimeout(state.reconnectTimer);
    const s = CFG.signaling;
    const proto = s.secure ? "wss" : "ws";
    const path = (s.path || "/").endsWith("/") ? (s.path || "/") : `${s.path}/`;
    const qs = new URLSearchParams({
      key: s.key,
      id: state.localId,
      token: state.token,
      version: s.version || "1.5.5"
    });
    const url = `${proto}://${s.host}:${s.port}${path}peerjs?${qs}`;

    setSignalStatus("Підключення…");
    state.signalReady = false;
    enableModeActions(false);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      scheduleReconnect("Помилка signaling");
      return;
    }

    state.socket = ws;

    ws.addEventListener("open", () => {
      state.socketOpen = true;
      state.reconnectAttempt = 0;
      setSignalStatus("Реєстрація…");
      flushSignalQueue();
      startHeartbeat();
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      handleSignalMessage(msg).catch(err => {
        console.error(err);
        showToast("Помилка WebRTC");
      });
    });

    ws.addEventListener("error", () => {
      setSignalStatus("Проблема з мережею", "error");
    });

    ws.addEventListener("close", () => {
      state.socketOpen = false;
      state.signalReady = false;
      stopHeartbeat();
      enableModeActions(false);
      if (!state.intentionalSocketClose) scheduleReconnect("Signaling розірвано");
    });
  }

  function scheduleReconnect(label) {
    setSignalStatus(label, "error");
    if (state.intentionalSocketClose) return;
    state.reconnectAttempt += 1;
    const delay = Math.min(1000 * (2 ** Math.min(state.reconnectAttempt - 1, 4)), CFG.signaling.reconnectMaxMs || 15000);
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connectSignaling, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = setInterval(() => {
      if (state.socket?.readyState === WebSocket.OPEN) {
        try { state.socket.send(JSON.stringify({ type: "HEARTBEAT" })); } catch (_) {}
      }
    }, CFG.signaling.pingIntervalMs || 5000);
  }

  function stopHeartbeat() {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  function sendSignal(type, payload, dst) {
    const message = { type };
    if (payload !== undefined) message.payload = payload;
    if (dst) message.dst = dst;

    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify(message));
    } else {
      state.signalQueue.push(message);
    }
  }

  function flushSignalQueue() {
    if (state.socket?.readyState !== WebSocket.OPEN) return;
    const queue = state.signalQueue.splice(0);
    for (const message of queue) state.socket.send(JSON.stringify(message));
  }

  async function handleSignalMessage(msg) {
    switch (msg.type) {
      case "OPEN":
        state.signalReady = true;
        setSignalStatus("Готово", "online");
        enableModeActions(true);
        return;

      case "ID-TAKEN":
        setSignalStatus("ID вже зайнятий", "error");
        state.intentionalSocketClose = true;
        showToast("Онови сторінку — signaling ID зайнятий");
        return;

      case "INVALID-KEY":
      case "ERROR":
        setSignalStatus("Помилка signaling", "error");
        showToast(msg.payload?.msg || "Signaling server повернув помилку");
        return;

      case "EXPIRE":
        if (state.role === "guest" && !state.connected) {
          clearTimeout(state.outgoingTimer);
          setCallState("Немає відповіді", "Посилання може бути застарілим або власник не в мережі");
          setTimeout(() => endCall({ notify: false, message: "Немає відповіді" }), 1800);
        }
        return;

      case "LEAVE":
        if (msg.src && msg.src === state.remotePeerId && state.pc) {
          endCall({ notify: false, message: "Співрозмовник відключився" });
        }
        return;

      case "OFFER":
        await handleIncomingOffer(msg);
        return;

      case "ANSWER":
        await handleAnswer(msg);
        return;

      case "CANDIDATE":
        await handleCandidate(msg);
        return;
    }
  }

  function enableModeActions(enabled) {
    if (state.role === "host") els.createInviteBtn.disabled = !enabled;
    else els.callBtn.disabled = !enabled || Boolean(state.pc);
  }

  function showInvite() {
    if (!state.signalReady) return showToast("Signaling ще підключається");
    els.inviteUrl.value = buildInviteUrl();
    els.inviteBox.classList.remove("hidden");
    els.createInviteBtn.textContent = "Посилання готове";
    els.createInviteBtn.disabled = true;
  }

  async function copyInvite() {
    const text = els.inviteUrl.value || buildInviteUrl();
    try {
      await navigator.clipboard.writeText(text);
      showToast("Посилання скопійовано");
    } catch (_) {
      els.inviteUrl.focus();
      els.inviteUrl.select();
      document.execCommand?.("copy");
      showToast("Скопійовано");
    }
  }

  async function shareInvite() {
    const url = els.inviteUrl.value || buildInviteUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: CFG.appName || "Лінія", text: "Відкрий посилання, щоб подзвонити мені", url });
        return;
      } catch (_) {}
    }
    await copyInvite();
  }

  async function prepareMicrophone() {
    els.prepareMicBtn.disabled = true;
    els.prepareMicBtn.textContent = "Доступ до мікрофона…";
    try {
      await ensureMicrophone();
      await refreshMicrophones(true);
      els.prepareMicBtn.textContent = "Мікрофон готовий";
      els.micHint.textContent = microphoneDescription();
    } catch (err) {
      handleMicError(err);
      els.prepareMicBtn.textContent = "Перевірити мікрофон";
    } finally {
      els.prepareMicBtn.disabled = false;
    }
  }

  function buildAudioConstraints(deviceId = state.selectedDeviceId) {
    const audio = {
      echoCancellation: state.audioPrefs.echoCancellation,
      noiseSuppression: state.audioPrefs.noiseSuppression,
      autoGainControl: state.audioPrefs.autoGainControl,
      channelCount: { ideal: 1 }
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return audio;
  }

  async function ensureMicrophone(forceNew = false, deviceId = state.selectedDeviceId) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia недоступний");

    const existing = state.localStream?.getAudioTracks?.()[0];
    if (existing && existing.readyState === "live" && !forceNew) return state.localStream;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: buildAudioConstraints(deviceId)
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Браузер не повернув аудіодоріжку");

    try { track.contentHint = "speech"; } catch (_) {}
    track.enabled = !state.isMuted;

    const oldStream = state.localStream;
    state.localStream = stream;

    const settings = track.getSettings?.() || {};
    if (settings.deviceId) state.selectedDeviceId = settings.deviceId;

    if (state.pc && oldStream) {
      const sender = state.pc.getSenders().find(s => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(track);
    }

    if (oldStream && oldStream !== stream) {
      oldStream.getTracks().forEach(t => t.stop());
    }

    await refreshMicrophones(true);
    els.micHint.textContent = microphoneDescription();
    return stream;
  }

  async function refreshMicrophones(hasPermissionHint = false) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === "audioinput");

    const current = state.selectedDeviceId || state.localStream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || "";
    els.microphoneSelect.innerHTML = "";

    if (!inputs.length) {
      els.microphoneRow.classList.add("hidden");
      return;
    }

    for (let i = 0; i < inputs.length; i += 1) {
      const d = inputs[i];
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label || `Мікрофон ${i + 1}`;
      if (d.deviceId === current) option.selected = true;
      els.microphoneSelect.appendChild(option);
    }

    if (inputs.length > 1 || hasPermissionHint) {
      els.microphoneRow.classList.remove("hidden");
    }
  }

  async function switchMicrophone(deviceId) {
    if (!deviceId || deviceId === state.selectedDeviceId) return;
    const previous = state.selectedDeviceId;
    state.selectedDeviceId = deviceId;
    try {
      await ensureMicrophone(true, deviceId);
      showToast("Мікрофон змінено");
    } catch (err) {
      state.selectedDeviceId = previous;
      handleMicError(err);
      await refreshMicrophones(Boolean(state.localStream));
    }
  }

  function microphoneDescription() {
    const track = state.localStream?.getAudioTracks?.()[0];
    if (!track) return "Усі три обробки вимкнені за замовчуванням.";
    return track.label ? `Активний: ${track.label}` : "Мікрофон активний";
  }

  async function toggleAudioPreference(button) {
    if (button.disabled) return;
    const key = button.dataset.constraint;
    const next = !state.audioPrefs[key];
    state.audioPrefs[key] = next;
    setSwitchVisual(button, next);

    const track = state.localStream?.getAudioTracks?.()[0];
    if (!track) return;

    try {
      const previous = track.getConstraints?.() || {};
      await track.applyConstraints({
        ...previous,
        echoCancellation: state.audioPrefs.echoCancellation,
        noiseSuppression: state.audioPrefs.noiseSuppression,
        autoGainControl: state.audioPrefs.autoGainControl
      });

      const settings = track.getSettings?.() || {};
      if (key in settings && Boolean(settings[key]) !== next) {
        showToast("Браузер не застосував цю опцію");
      }
    } catch (err) {
      state.audioPrefs[key] = !next;
      setSwitchVisual(button, !next);
      showToast("Не вдалося змінити обробку мікрофона");
    }
  }

  function setSwitchVisual(button, on) {
    button.setAttribute("aria-checked", String(on));
    button.querySelector("span").textContent = on ? "ВКЛ" : "ВИКЛ";
  }

  async function startOutgoingCall() {
    if (!state.signalReady || state.pc) return;
    activateRemoteAudio();
    els.callBtn.disabled = true;
    try {
      await ensureMicrophone();
      const connectionId = randomToken(20, "mc-");
      const pc = await createPeerConnection(state.targetId, connectionId, true);
      showCallPanel("Дзвонимо…");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignal("OFFER", {
        sdp: pc.localDescription,
        type: "media",
        connectionId,
        metadata: { secret: state.targetSecret, app: "liniya" },
        browser: navigator.userAgent
      }, state.targetId);

      clearTimeout(state.outgoingTimer);
      state.outgoingTimer = setTimeout(() => {
        if (!state.connected) endCall({ notify: true, message: state.iceConfigError ? `Немає з'єднання • ${state.iceConfigError}` : "Немає з'єднання" });
      }, CFG.outgoingCallTimeoutMs || 30000);
    } catch (err) {
      console.error(err);
      handleMicError(err);
      endCall({ notify: false, message: "Не вдалося почати дзвінок" });
    }
  }

  async function handleIncomingOffer(msg) {
    if (state.role !== "host") return;
    if (!msg.src || !msg.payload?.sdp || !msg.payload?.connectionId) return;

    const suppliedSecret = msg.payload?.metadata?.secret;
    if (suppliedSecret !== state.hostSecret) return;

    if (state.pc || state.pendingOffer) {
      sendSignal("ANSWER", {
        type: "media",
        connectionId: msg.payload.connectionId,
        rejected: true,
        reason: "busy"
      }, msg.src);
      return;
    }

    state.pendingOffer = msg;
    state.remotePeerId = msg.src;
    state.connectionId = msg.payload.connectionId;
    els.incomingModal.classList.remove("hidden");
    navigator.vibrate?.([180, 80, 180, 80, 260]);
  }

  async function acceptIncomingCall() {
    const msg = state.pendingOffer;
    if (!msg) return;
    activateRemoteAudio();
    els.acceptBtn.disabled = true;
    try {
      await ensureMicrophone();
      const pc = await createPeerConnection(msg.src, msg.payload.connectionId, false);
      els.incomingModal.classList.add("hidden");
      showCallPanel("З'єднання…");

      await pc.setRemoteDescription(msg.payload.sdp);
      await flushPendingCandidates(msg.src);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignal("ANSWER", {
        sdp: pc.localDescription,
        type: "media",
        connectionId: msg.payload.connectionId,
        browser: navigator.userAgent
      }, msg.src);

      state.pendingOffer = null;
    } catch (err) {
      console.error(err);
      handleMicError(err);
      declineIncomingCall("error");
    } finally {
      els.acceptBtn.disabled = false;
    }
  }

  function declineIncomingCall(reason = "declined") {
    const msg = state.pendingOffer;
    if (msg) {
      sendSignal("ANSWER", {
        type: "media",
        connectionId: msg.payload.connectionId,
        rejected: true,
        reason
      }, msg.src);
    }
    state.pendingOffer = null;
    state.remotePeerId = "";
    state.connectionId = "";
    els.incomingModal.classList.add("hidden");
    showToast(reason === "declined" ? "Дзвінок відхилено" : "Не вдалося прийняти дзвінок");
  }

  async function handleAnswer(msg) {
    if (!state.pc || !msg.src || msg.src !== state.remotePeerId) return;
    if (msg.payload?.connectionId !== state.connectionId) return;

    if (msg.payload?.rejected) {
      const text = msg.payload.reason === "busy" ? "Абонент зайнятий" : "Дзвінок відхилено";
      setCallState(text, "");
      setTimeout(() => endCall({ notify: false, message: text }), 1200);
      return;
    }

    if (!msg.payload?.sdp) return;
    if (!state.pc.currentRemoteDescription) {
      await state.pc.setRemoteDescription(msg.payload.sdp);
      await flushPendingCandidates(msg.src);
    }
  }

  async function handleCandidate(msg) {
    const src = msg.src;
    const payload = msg.payload;
    if (!src || !payload) return;

    if (payload.control === "hangup") {
      if (src === state.remotePeerId) endCall({ notify: false, message: "Співрозмовник завершив дзвінок" });
      return;
    }

    if (!payload.candidate) return;
    if (state.remotePeerId && src !== state.remotePeerId) return;
    if (state.connectionId && payload.connectionId && payload.connectionId !== state.connectionId) return;

    const candidate = payload.candidate;
    if (state.pc && state.pc.remoteDescription) {
      try { await state.pc.addIceCandidate(candidate); } catch (err) { console.warn("ICE candidate error", err); }
    } else {
      if (!state.pendingCandidates.has(src)) state.pendingCandidates.set(src, []);
      state.pendingCandidates.get(src).push(candidate);
    }
  }

  async function flushPendingCandidates(peerId) {
    const list = state.pendingCandidates.get(peerId) || [];
    state.pendingCandidates.delete(peerId);
    for (const candidate of list) {
      try { await state.pc?.addIceCandidate(candidate); } catch (err) { console.warn("ICE candidate error", err); }
    }
  }

  async function resolveIceServers() {
    if (state.resolvedIceServers) return state.resolvedIceServers;

    const base = Array.isArray(CFG.iceServers) ? [...CFG.iceServers] : [];
    const mt = CFG.meteredTurn || {};

    if (!mt.enabled) {
      state.resolvedIceServers = base;
      state.iceConfigError = "TURN не налаштований";
      return state.resolvedIceServers;
    }

    const appName = String(mt.appName || "").trim();
    const apiKey = String(mt.apiKey || "").trim();
    if (!appName || !apiKey) {
      state.resolvedIceServers = base;
      state.iceConfigError = "TURN увімкнений, але appName/apiKey порожні";
      return state.resolvedIceServers;
    }

    try {
      const url = `https://${encodeURIComponent(appName)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`TURN HTTP ${response.status}`);
      const remoteIce = await response.json();
      if (!Array.isArray(remoteIce) || !remoteIce.length) throw new Error("TURN API повернув порожній список");
      state.resolvedIceServers = [...base, ...remoteIce];
      state.iceConfigError = "";
      return state.resolvedIceServers;
    } catch (err) {
      console.error("TURN config error", err);
      state.resolvedIceServers = base;
      state.iceConfigError = "Не вдалося завантажити TURN";
      return state.resolvedIceServers;
    }
  }

  function hasTurnServer(servers) {
    return (servers || []).some(item => {
      const urls = Array.isArray(item?.urls) ? item.urls : [item?.urls];
      return urls.some(url => typeof url === "string" && /^turns?:/i.test(url));
    });
  }

  async function createPeerConnection(remotePeerId, connectionId, isCaller) {
    const iceServers = await resolveIceServers();
    const pc = new RTCPeerConnection({
      iceServers,
      sdpSemantics: "unified-plan"
    });
    const turnAvailable = hasTurnServer(iceServers);

    state.pc = pc;
    state.remotePeerId = remotePeerId;
    state.connectionId = connectionId;
    state.connected = false;

    const track = state.localStream.getAudioTracks()[0];
    const sender = pc.addTrack(track, state.localStream);
    preferOpus(pc, sender);
    setSenderBitrate(sender).catch(() => {});

    if (isCaller) {
      const dc = pc.createDataChannel("control", { ordered: true });
      setupControlChannel(dc);
    } else {
      pc.addEventListener("datachannel", event => setupControlChannel(event.channel));
    }

    pc.addEventListener("icecandidate", event => {
      if (!event.candidate) return;
      sendSignal("CANDIDATE", {
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        type: "media",
        connectionId
      }, remotePeerId);
    });

    pc.addEventListener("track", event => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      state.remoteStream = stream;
      els.remoteAudio.srcObject = stream;
      playRemoteAudio();
    });

    pc.addEventListener("connectionstatechange", () => {
      if (state.pc !== pc) return;
      const cs = pc.connectionState;
      if (cs === "connected") markConnected();
      else if (cs === "connecting") setCallState("З'єднання…", "");
      else if (cs === "failed") endCall({ notify: false, message: "WebRTC з'єднання не вдалося" });
      else if (cs === "closed") {
        if (state.pc === pc) endCall({ notify: false, message: "Дзвінок завершено" });
      } else if (cs === "disconnected") {
        setCallState("Відновлюємо зв'язок…", "Мережа тимчасово нестабільна");
      }
    });

    pc.addEventListener("iceconnectionstatechange", () => {
      if (state.pc !== pc) return;
      const ice = pc.iceConnectionState;
      if (ice === "checking") {
        setCallState("З'єднання…", turnAvailable ? "ICE перевіряє P2P / TURN…" : "ICE перевіряє P2P… TURN не налаштований");
      } else if (ice === "failed") {
        const detail = turnAvailable
          ? "ICE не знайшов робочого маршруту навіть через TURN"
          : "Прямий P2P не пройшов. Для mobile ↔ Wi‑Fi потрібен робочий TURN";
        setCallState("Немає маршруту", detail);
      } else if (ice === "disconnected") {
        setCallState("Відновлюємо зв'язок…", "ICE маршрут тимчасово втрачено");
      }
    });

    pc.addEventListener("icegatheringstatechange", () => {
      if (state.pc !== pc) return;
      if (pc.iceGatheringState === "complete" && !state.connected && !turnAvailable) {
        els.networkInfo.textContent = "ICE зібрано • TURN не налаштований";
      }
    });

    return pc;
  }

  function preferOpus(pc, sender) {
    try {
      const transceiver = pc.getTransceivers().find(t => t.sender === sender);
      const caps = RTCRtpReceiver.getCapabilities?.("audio");
      if (!transceiver?.setCodecPreferences || !caps?.codecs?.length) return;
      const opus = caps.codecs.filter(c => c.mimeType?.toLowerCase() === "audio/opus");
      const rest = caps.codecs.filter(c => c.mimeType?.toLowerCase() !== "audio/opus");
      if (opus.length) transceiver.setCodecPreferences([...opus, ...rest]);
    } catch (_) {}
  }

  async function setSenderBitrate(sender) {
    if (!sender?.getParameters || !sender?.setParameters) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = CFG.audioMaxBitrate || 64000;
    await sender.setParameters(params);
  }

  function setupControlChannel(channel) {
    state.controlChannel = channel;
    channel.addEventListener("message", event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "hangup") endCall({ notify: false, message: "Співрозмовник завершив дзвінок" });
      } catch (_) {}
    });
  }

  function notifyHangup() {
    try {
      if (state.controlChannel?.readyState === "open") {
        state.controlChannel.send(JSON.stringify({ type: "hangup" }));
      } else if (state.remotePeerId && state.connectionId && state.signalReady) {
        // Fallback через signaling. Тип CANDIDATE використовується лише як транспорт сумісного PeerServer.
        sendSignal("CANDIDATE", { control: "hangup", connectionId: state.connectionId }, state.remotePeerId);
      }
    } catch (_) {}
  }

  function showCallPanel(label) {
    els.homePanel.classList.add("hidden");
    els.callPanel.classList.remove("hidden");
    els.settingsPanel.classList.add("hidden");
    els.closeSettingsBtn.classList.add("hidden");
    setCallState(label, "Очікуємо WebRTC…");
    els.callTimer.textContent = "00:00";
  }

  function setCallState(label, networkText) {
    els.callState.textContent = label;
    if (networkText !== undefined) els.networkInfo.textContent = networkText;
  }

  function markConnected() {
    if (state.connected) return;
    state.connected = true;
    clearTimeout(state.outgoingTimer);
    setCallState("На зв'язку", "Визначаємо маршрут…");
    state.callStartedAt = Date.now();
    startCallTimer();
    startStats();

    const sender = state.pc?.getSenders().find(s => s.track?.kind === "audio");
    if (sender) setSenderBitrate(sender).catch(() => {});
  }

  function startCallTimer() {
    clearInterval(state.callTimerInterval);
    const update = () => {
      const sec = Math.max(0, Math.floor((Date.now() - state.callStartedAt) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      els.callTimer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    update();
    state.callTimerInterval = setInterval(update, 1000);
  }

  function startStats() {
    clearInterval(state.statsInterval);
    const update = async () => {
      const pc = state.pc;
      if (!pc || pc.connectionState !== "connected") return;
      try {
        const stats = await pc.getStats();
        let pair = null;
        let pairId = null;

        stats.forEach(report => {
          if (report.type === "transport" && report.selectedCandidatePairId) pairId = report.selectedCandidatePairId;
        });
        if (pairId) pair = stats.get(pairId);
        if (!pair) {
          stats.forEach(report => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) pair = report;
          });
        }
        if (!pair) return;

        const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : null;
        const remote = pair.remoteCandidateId ? stats.get(pair.remoteCandidateId) : null;
        const relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
        const route = relay ? "TURN relay" : "Пряме P2P";
        const rtt = Number.isFinite(pair.currentRoundTripTime) ? ` • RTT ${Math.round(pair.currentRoundTripTime * 1000)} мс` : "";
        els.networkInfo.textContent = `${route}${rtt}`;
      } catch (_) {}
    };
    update();
    state.statsInterval = setInterval(update, 2500);
  }

  function toggleMute() {
    const track = state.localStream?.getAudioTracks?.()[0];
    if (!track) return;
    state.isMuted = !state.isMuted;
    track.enabled = !state.isMuted;
    els.muteBtn.setAttribute("aria-pressed", String(state.isMuted));
    els.muteBtn.querySelector("span").textContent = state.isMuted ? "Вимкнено" : "Мікрофон";
  }

  function openSettingsDuringCall() {
    els.settingsPanel.classList.remove("hidden");
    els.closeSettingsBtn.classList.remove("hidden");
    els.settingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeSettingsDuringCall() {
    if (!state.pc) return;
    els.settingsPanel.classList.add("hidden");
    els.closeSettingsBtn.classList.add("hidden");
    els.callPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setOpponentVolume(value) {
    const percent = Math.min(500, Math.max(0, Math.round(Number(value) || 0)));
    state.remoteVolume = percent;
    els.opponentVolume.value = String(percent);
    els.opponentVolumeValue.value = `${percent}%`;
    els.opponentVolumeValue.textContent = `${percent}%`;
    els.opponentVolume.style.setProperty("--volume-progress", `${percent / 5}%`);

    const gain = percent / 100;
    if (state.remoteGain && state.audioContext) {
      const now = state.audioContext.currentTime;
      state.remoteGain.gain.cancelScheduledValues(now);
      state.remoteGain.gain.setTargetAtTime(gain, now, 0.012);
    } else {
      // Без Web Audio браузер може регулювати елемент лише в межах 0–100%.
      els.remoteAudio.volume = Math.min(1, gain);
    }
  }

  function ensureRemoteAudioGraph() {
    if (state.remoteGain) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      const context = state.audioContext || new AudioContextClass();
      const source = context.createMediaElementSource(els.remoteAudio);
      const gain = context.createGain();
      gain.gain.value = state.remoteVolume / 100;
      source.connect(gain);
      gain.connect(context.destination);

      state.audioContext = context;
      state.remoteAudioSource = source;
      state.remoteGain = gain;
      els.remoteAudio.volume = 1;
      return true;
    } catch (err) {
      console.warn("Remote audio gain unavailable", err);
      return false;
    }
  }

  function activateRemoteAudio() {
    if (!ensureRemoteAudioGraph()) return;
    if (state.audioContext?.state === "suspended") {
      state.audioContext.resume().catch(() => {});
    }
  }

  async function playRemoteAudio() {
    activateRemoteAudio();
    try {
      await els.remoteAudio.play();
      if (state.audioContext?.state === "suspended") await state.audioContext.resume();
      els.audioUnlockBtn.classList.add("hidden");
    } catch (_) {
      els.audioUnlockBtn.classList.remove("hidden");
    }
  }

  async function unlockRemoteAudio() {
    try {
      activateRemoteAudio();
      await els.remoteAudio.play();
      if (state.audioContext?.state === "suspended") await state.audioContext.resume();
      els.audioUnlockBtn.classList.add("hidden");
    } catch (_) {}
  }

  function endCall({ notify = false, message = "Дзвінок завершено" } = {}) {
    if (notify) notifyHangup();

    clearTimeout(state.outgoingTimer);
    clearInterval(state.callTimerInterval);
    clearInterval(state.statsInterval);
    state.outgoingTimer = null;
    state.callTimerInterval = null;
    state.statsInterval = null;

    const pc = state.pc;
    state.pc = null;
    try { state.controlChannel?.close(); } catch (_) {}
    state.controlChannel = null;
    try { pc?.close(); } catch (_) {}

    stopLocalStream();
    state.remoteStream = null;
    els.remoteAudio.srcObject = null;
    state.remotePeerId = "";
    state.connectionId = "";
    state.pendingOffer = null;
    state.pendingCandidates.clear();
    state.connected = false;
    state.isMuted = false;
    els.muteBtn.setAttribute("aria-pressed", "false");
    els.muteBtn.querySelector("span").textContent = "Мікрофон";
    els.incomingModal.classList.add("hidden");
    els.audioUnlockBtn.classList.add("hidden");

    els.callPanel.classList.add("hidden");
    els.homePanel.classList.remove("hidden");
    els.settingsPanel.classList.remove("hidden");
    els.closeSettingsBtn.classList.add("hidden");
    els.callTimer.textContent = "00:00";
    els.networkInfo.textContent = "Очікуємо WebRTC…";

    if (state.role === "guest") {
      els.callBtn.disabled = !state.signalReady;
      els.callBtn.textContent = "Подзвонити ще раз";
      els.guestHint.textContent = message;
    } else {
      if (els.inviteBox.classList.contains("hidden")) {
        els.createInviteBtn.disabled = !state.signalReady;
      }
    }

    if (message) showToast(message);
  }

  function stopLocalStream() {
    if (!state.localStream) return;
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
    els.micHint.textContent = "Усі три обробки вимкнені за замовчуванням.";
  }

  function cleanupTimers() {
    stopHeartbeat();
    clearTimeout(state.reconnectTimer);
    clearTimeout(state.outgoingTimer);
    clearInterval(state.callTimerInterval);
    clearInterval(state.statsInterval);
  }

  function handleMicError(err) {
    console.error(err);
    if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
      showToast("Дозволь доступ до мікрофона в браузері");
    } else if (err?.name === "NotFoundError") {
      showToast("Мікрофон не знайдено");
    } else if (err?.name === "OverconstrainedError") {
      showToast("Обраний мікрофон недоступний");
    } else {
      showToast("Не вдалося відкрити мікрофон");
    }
  }

  function showToast(text) {
    if (!text) return;
    clearTimeout(state.toastTimer);
    els.toast.textContent = text;
    els.toast.classList.remove("hidden");
    state.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3000);
  }
})();
