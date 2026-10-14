/**
 * 出气口 — shared game core (audio, stats, juice helpers)
 * Local-only. No uploads.
 */
(function () {
  "use strict";

  let audioCtx = null;
  let masterOut = null;
  let masterAnalyser = null;
  let muted = false;
  let reducedMotion = false;

  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {}

  const STATS_KEY = "chuqikou-game-stats-v1";

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveStats(s) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(s));
    } catch (_) {}
  }

  function vibrate(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 12);
    } catch (_) {}
  }

  function recordHit(gameId, opts) {
    const o = opts || {};
    const stats = loadStats();
    const g = stats[gameId] || { hits: 0, bestCombo: 0, sessions: 0 };
    const now = Date.now();
    if (!g._comboUntil || now > g._comboUntil) g._combo = 0;
    g._combo = (g._combo || 0) + 1;
    g._comboUntil = now + (o.comboWindowMs || 900);
    g.hits = (g.hits || 0) + 1;
    if (g._combo > (g.bestCombo || 0)) g.bestCombo = g._combo;
    if (o.extra && typeof o.extra === "object") {
      Object.keys(o.extra).forEach((k) => {
        g[k] = o.extra[k];
      });
    }
    stats[gameId] = g;
    saveStats(stats);
    if (o.vibrate !== false) vibrate(o.vibrateMs || 10);
    return { combo: g._combo, bestCombo: g.bestCombo, hits: g.hits, raw: g };
  }

  function getGameStats(gameId) {
    const g = loadStats()[gameId] || {};
    return {
      hits: g.hits || 0,
      bestCombo: g.bestCombo || 0,
      merit: g.merit || 0,
      bursts: g.bursts || 0,
      pops: g.pops || 0,
    };
  }

  function setGameStat(gameId, patch) {
    const stats = loadStats();
    const g = Object.assign({}, stats[gameId] || {}, patch || {});
    stats[gameId] = g;
    saveStats(stats);
    return g;
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try {
        audioCtx.resume();
      } catch (_) {}
    }
    return audioCtx;
  }

  function ensureAudioAsync() {
    const ctx = ensureAudio();
    if (!ctx) return Promise.resolve(null);
    if (ctx.state === "suspended") {
      return ctx.resume().then(() => ctx).catch(() => ctx);
    }
    return Promise.resolve(ctx);
  }

  function getMasterOut() {
    const ctx = ensureAudio();
    if (!ctx) return null;
    if (!masterOut) {
      masterAnalyser = ctx.createAnalyser();
      masterAnalyser.fftSize = 256;
      masterOut = ctx.createGain();
      masterOut.gain.value = muted ? 0 : 1;
      masterOut.connect(masterAnalyser);
      masterAnalyser.connect(ctx.destination);
    }
    return masterOut;
  }

  function audioPeak() {
    if (!masterAnalyser) return 0;
    const data = new Uint8Array(masterAnalyser.frequencyBinCount);
    masterAnalyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i] - 128));
    }
    return peak / 128;
  }

  function setMuted(v) {
    muted = !!v;
    const out = getMasterOut();
    if (out) out.gain.value = muted ? 0 : 1;
    try {
      localStorage.setItem("chuqikou-mute", muted ? "1" : "0");
    } catch (_) {}
    return muted;
  }

  function isMuted() {
    return muted;
  }

  try {
    muted = localStorage.getItem("chuqikou-mute") === "1";
  } catch (_) {}

  function playThud(intensity) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const i = Math.max(0, Math.min(2, intensity == null ? 0.8 : intensity));
    osc.type = "sine";
    osc.frequency.setValueAtTime(90 + i * 40, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    filter.type = "lowpass";
    filter.frequency.value = 280;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22 + i * 0.08, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  function playPop(pitch) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const p = pitch == null ? 1 : pitch;
    osc.type = "triangle";
    osc.frequency.setValueAtTime((600 + Math.random() * 400) * p, t);
    osc.frequency.exponentialRampToValueAtTime(120 * p, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  function playWhoosh() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    src.start(t);
  }

  function playCrack() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.12;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    src.start(t);
  }

  function playBurst() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    osc.start(t);
    osc.stop(t + 0.46);
    playWhoosh();
  }

  function playWoodChime() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const freqs = [392, 588];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t);
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      const peak = i === 0 ? 0.14 : 0.045;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(getMasterOut() || ctx.destination);
      osc.start(t);
      osc.stop(t + 0.58);
    });
    const bufLen = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.12));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 420;
    nf.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(nf);
    nf.connect(ng);
    ng.connect(getMasterOut() || ctx.destination);
    src.start(t);
  }

  function playTick() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain);
    gain.connect(getMasterOut() || ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /* —— Visual juice —— */
  function spawnFloatingText(parent, text, x, y, opts) {
    if (!parent) return;
    const o = opts || {};
    const el = document.createElement("span");
    el.className = "float-dmg" + (o.critical ? " is-crit" : "") + (o.calm ? " is-calm" : "");
    el.textContent = text;
    el.style.left = (typeof x === "number" ? x : 50) + (typeof x === "number" && x <= 100 && !o.px ? "%" : "px");
    if (o.px) {
      el.style.left = x + "px";
      el.style.top = y + "px";
    } else if (typeof x === "number" && x > 100) {
      el.style.left = x + "px";
      el.style.top = (y || 0) + "px";
    } else {
      el.style.left = (x == null ? 50 : x) + "%";
      el.style.top = (y == null ? 40 : y) + "%";
    }
    if (o.color) el.style.color = o.color;
    parent.appendChild(el);
    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
    }, o.ms || 900);
  }

  function screenShake(el, intensity) {
    if (!el || reducedMotion) return;
    const i = Math.max(0.3, Math.min(2.5, intensity == null ? 1 : intensity));
    el.classList.remove("is-shake", "is-shake-hard");
    void el.offsetWidth;
    el.classList.add(i >= 1.4 ? "is-shake-hard" : "is-shake");
    el.style.setProperty("--shake-amp", (4 * i).toFixed(1) + "px");
    setTimeout(() => {
      el.classList.remove("is-shake", "is-shake-hard");
    }, i >= 1.4 ? 220 : 140);
  }

  function createParticleBurst(parent, x, y, opts) {
    if (!parent || reducedMotion) return;
    const o = opts || {};
    const n = o.count || 12;
    const colors = o.colors || ["#5ce1e6", "#ff3d7f", "#ffe566", "#f4e8d8"];
    const layer = document.createElement("div");
    layer.className = "particle-burst";
    layer.style.left = x + "px";
    layer.style.top = y + "px";
    parent.appendChild(layer);
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "particle-dot" + (o.star ? " is-star" : "");
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = (o.dist || 48) * (0.45 + Math.random() * 0.7);
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      p.style.background = colors[i % colors.length];
      p.style.color = colors[i % colors.length];
      layer.appendChild(p);
    }
    setTimeout(() => {
      try {
        layer.remove();
      } catch (_) {}
    }, o.ms || 700);
  }

  function createShockwave(parent, x, y) {
    if (!parent || reducedMotion) return;
    const ring = document.createElement("div");
    ring.className = "shockwave-ring";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    parent.appendChild(ring);
    setTimeout(() => {
      try {
        ring.remove();
      } catch (_) {}
    }, 600);
  }

  /* —— Zoom guards —— */
  (function blockPinchZoom() {
    const opt = { passive: false, capture: true };
    function prevent(e) {
      e.preventDefault();
    }
    ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
      document.addEventListener(type, prevent, opt);
    });
    document.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches && e.touches.length > 1) prevent(e);
      },
      opt
    );
    document.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) prevent(e);
      },
      opt
    );
  })();

  /* Unlock audio on first gesture */
  function unlockOnce() {
    ensureAudioAsync();
    getMasterOut();
  }
  ["pointerdown", "keydown", "touchstart"].forEach((t) => {
    document.addEventListener(t, unlockOnce, { once: true, passive: true });
  });

  /** Wire mute button if present */
  function bindMuteButton(btn) {
    if (!btn) return;
    const sync = () => {
      btn.textContent = muted ? "🔇" : "🔊";
      btn.setAttribute("aria-label", muted ? "取消静音" : "静音");
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
    };
    sync();
    btn.addEventListener("click", () => {
      setMuted(!muted);
      sync();
    });
  }

  /** HUD helper */
  function setHud(el, text) {
    if (el) el.textContent = text || "";
  }

  const api = {
    ensureAudio,
    ensureAudioAsync,
    getMasterOut,
    audioPeak,
    playThud,
    playPop,
    playWhoosh,
    playCrack,
    playBurst,
    playTick,
    playWoodChime,
    reducedMotion: () => reducedMotion,
    vibrate,
    recordHit,
    getGameStats,
    setGameStat,
    spawnFloatingText,
    screenShake,
    createParticleBurst,
    createShockwave,
    setMuted,
    isMuted,
    bindMuteButton,
    setHud,
    setStat: setHud,
  };

  window.VentGameCore = api;
  window.Vent = api;
})();
