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

  /** iOS / WeChat: resume alone is not enough — play a near-silent buffer in the gesture. */
  function pokeSilentBuffer(ctx) {
    if (!ctx) return;
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.001;
      src.connect(g);
      g.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
  }

  function getMasterOut() {
    const ctx = ensureAudio();
    if (!ctx) return null;
    if (!masterOut) {
      masterAnalyser = ctx.createAnalyser();
      masterAnalyser.fftSize = 256;
      masterOut = ctx.createGain();
      masterOut.gain.value = muted ? 0 : 1.35;
      masterOut.connect(masterAnalyser);
      masterAnalyser.connect(ctx.destination);
    }
    return masterOut;
  }

  function outNode() {
    return getMasterOut() || (audioCtx && audioCtx.destination);
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
    if (out) out.gain.value = muted ? 0 : 1.35;
    try {
      localStorage.setItem("chuqikou-mute", muted ? "1" : "0");
    } catch (_) {}
    syncUnlockBanner();
    return muted;
  }

  function isMuted() {
    return muted;
  }

  try {
    muted = localStorage.getItem("chuqikou-mute") === "1";
  } catch (_) {}

  let audioReady = false;
  let unlockBannerEl = null;

  function noiseBurst(ctx, t, dur, opts) {
    const o = opts || {};
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * (o.decay || 0.18)));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type || "bandpass";
    filter.frequency.value = o.freq || 900;
    if (o.Q != null) filter.Q.value = o.Q;
    const gain = ctx.createGain();
    const peak = o.gain == null ? 0.35 : o.gain;
    gain.gain.setValueAtTime(Math.max(0.0001, peak), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(outNode());
    src.start(t);
    return src;
  }

  function playThud(intensity) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const i = Math.max(0, Math.min(3, intensity == null ? 1 : intensity));
    // Sub bass punch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95 + i * 40, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.16);
    filter.type = "lowpass";
    filter.frequency.value = 380;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.62 + i * 0.22, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.22);
    // Mid body click
    const mid = ctx.createOscillator();
    const mg = ctx.createGain();
    mid.type = "triangle";
    mid.frequency.setValueAtTime(260 + i * 70, t);
    mid.frequency.exponentialRampToValueAtTime(70, t + 0.055);
    mg.gain.setValueAtTime(0.0001, t);
    mg.gain.exponentialRampToValueAtTime(0.38 + i * 0.14, t + 0.002);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    mid.connect(mg);
    mg.connect(outNode());
    mid.start(t);
    mid.stop(t + 0.08);
    // Transient noise transient
    noiseBurst(ctx, t, 0.045, {
      freq: 1400 + i * 200,
      type: "highpass",
      Q: 0.7,
      gain: 0.42 + i * 0.14,
      decay: 0.08,
    });
    noiseBurst(ctx, t, 0.09, {
      freq: 320 + i * 90,
      type: "bandpass",
      Q: 0.85,
      gain: 0.4 + i * 0.12,
      decay: 0.14,
    });
  }

  function playPop(pitch, loudness) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const p = pitch == null ? 1 : pitch;
    const loud = loudness == null ? 1 : Math.max(0.5, Math.min(2.5, loudness));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime((780 + Math.random() * 520) * p, t);
    osc.frequency.exponentialRampToValueAtTime(110 * p, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.48 * loud, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.12);
    // Thick membrane snap
    noiseBurst(ctx, t, 0.05, {
      freq: 2200 * p,
      type: "bandpass",
      Q: 1.6,
      gain: 0.38 * loud,
      decay: 0.09,
    });
    noiseBurst(ctx, t, 0.07, {
      freq: 420 * p,
      type: "lowpass",
      gain: 0.28 * loud,
      decay: 0.16,
    });
  }

  function playWhoosh() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.28);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(220, t + 0.24);
    filter.Q.value = 0.65;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.52, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(outNode());
    src.start(t);
  }

  function playCrack(big) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const scale = big ? 1.85 : 1.15;
    noiseBurst(ctx, t, 0.08, { freq: 3200, type: "highpass", gain: 0.62 * scale, decay: 0.08 });
    noiseBurst(ctx, t, 0.12, { freq: 1100, type: "bandpass", Q: 0.75, gain: 0.48 * scale, decay: 0.16 });
    noiseBurst(ctx, t, 0.16, { freq: 280, type: "lowpass", gain: 0.36 * scale, decay: 0.22 });
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(big ? 1800 : 1300, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.1);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28 * scale, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.13);
  }

  function playBurst() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.48);
    gain.gain.setValueAtTime(0.68, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.56);
    // Bass boom
    const bass = ctx.createOscillator();
    const bg = ctx.createGain();
    bass.type = "sine";
    bass.frequency.setValueAtTime(90, t);
    bass.frequency.exponentialRampToValueAtTime(28, t + 0.35);
    bg.gain.setValueAtTime(0.55, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    bass.connect(bg);
    bg.connect(outNode());
    bass.start(t);
    bass.stop(t + 0.42);
    noiseBurst(ctx, t, 0.22, { freq: 2800, type: "highpass", gain: 0.55, decay: 0.12 });
    noiseBurst(ctx, t, 0.35, { freq: 420, type: "lowpass", gain: 0.62, decay: 0.28 });
    playWhoosh();
  }

  function playWoodChime() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const freqs = [392, 588, 784];
    const peaks = [0.34, 0.14, 0.07];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t);
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peaks[i], t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(outNode());
      osc.start(t);
      osc.stop(t + 0.5);
    });
    // Crisp wood attack
    noiseBurst(ctx, t, 0.035, { freq: 920, type: "bandpass", Q: 1.8, gain: 0.32, decay: 0.08 });
    noiseBurst(ctx, t, 0.05, { freq: 380, type: "bandpass", Q: 1.2, gain: 0.22, decay: 0.12 });
  }

  function playTick() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 980;
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Soft knead ticks while holding squeeze ball */
  function playKnead(intensity) {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const i = Math.max(0.2, Math.min(1.4, intensity == null ? 0.5 : intensity));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(160 + i * 40, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12 + i * 0.08, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(gain);
    gain.connect(outNode());
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Splat / release for squeeze + 爆浆 */
  function playSplat() {
    const ctx = ensureAudio();
    if (!ctx || muted) return;
    pokeSilentBuffer(ctx);
    playPop(0.65, 1.85);
    const t = ctx.currentTime;
    noiseBurst(ctx, t, 0.14, { freq: 280, type: "lowpass", gain: 0.55, decay: 0.25 });
    noiseBurst(ctx, t, 0.08, { freq: 1600, type: "bandpass", Q: 1.1, gain: 0.4, decay: 0.12 });
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

  function screenShake(el, intensity, combo) {
    if (!el || reducedMotion) return;
    const cBoost = combo ? Math.min(1.4, 0.35 + combo * 0.08) : 0;
    const i = Math.max(0.4, Math.min(3.5, (intensity == null ? 1 : intensity) + cBoost));
    el.classList.remove("is-shake", "is-shake-hard", "is-shake-mega");
    void el.offsetWidth;
    const cls = i >= 2.2 ? "is-shake-mega" : i >= 1.2 ? "is-shake-hard" : "is-shake";
    el.classList.add(cls);
    el.style.setProperty("--shake-amp", (6 * i).toFixed(1) + "px");
    setTimeout(() => {
      el.classList.remove("is-shake", "is-shake-hard", "is-shake-mega");
    }, i >= 2.2 ? 320 : i >= 1.2 ? 240 : 160);
  }

  /** Brief freeze-frame hit-stop (20–40ms typical). */
  function hitStop(ms) {
    if (reducedMotion) return;
    const dur = Math.max(12, Math.min(48, ms == null ? 28 : ms));
    const root = document.documentElement;
    root.classList.add("is-hitstop");
    setTimeout(() => root.classList.remove("is-hitstop"), dur);
  }

  /** White / chromatic impact flash overlay on stage. */
  function impactFlash(parent, opts) {
    if (!parent || reducedMotion) return;
    const o = opts || {};
    const flash = document.createElement("div");
    flash.className = "impact-flash" + (o.heavy ? " is-heavy" : "") + (o.chromatic ? " is-chromatic" : "");
    parent.appendChild(flash);
    setTimeout(() => {
      try { flash.remove(); } catch (_) {}
    }, o.ms || 180);
  }

  /** Combo-aware vibrate: longer patterns on big hits. */
  function vibeHit(kind) {
    try {
      if (!navigator.vibrate) return;
      const patterns = {
        light: 10,
        tap: 14,
        hit: [12, 18, 22],
        heavy: [18, 30, 28, 40, 35],
        boss: [22, 40, 30, 50, 40],
        burst: [25, 45, 35, 55, 40, 30],
        calm: 8,
      };
      navigator.vibrate(patterns[kind] || patterns.hit);
    } catch (_) {}
  }

  function createParticleBurst(parent, x, y, opts) {
    if (!parent || reducedMotion) return;
    const o = opts || {};
    const n = o.count || 18;
    const colors = o.colors || ["#5ce1e6", "#ff3d7f", "#ffe566", "#f4e8d8"];
    const layer = document.createElement("div");
    layer.className = "particle-burst";
    layer.style.left = x + "px";
    layer.style.top = y + "px";
    parent.appendChild(layer);
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      const big = o.big || o.star;
      p.className = "particle-dot" + (o.star ? " is-star" : "") + (big ? " is-big" : "");
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.45;
      const dist = (o.dist || 72) * (0.5 + Math.random() * 0.75);
      p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      p.style.background = colors[i % colors.length];
      p.style.color = colors[i % colors.length];
      if (big) {
        const sz = 10 + Math.random() * 10;
        p.style.width = sz + "px";
        p.style.height = sz + "px";
      }
      layer.appendChild(p);
    }
    setTimeout(() => {
      try {
        layer.remove();
      } catch (_) {}
    }, o.ms || 750);
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

  /* Unlock audio on every gesture until running (iOS / WeChat safe) */
  function hideUnlockBanner() {
    if (unlockBannerEl) {
      try {
        unlockBannerEl.remove();
      } catch (_) {}
      unlockBannerEl = null;
    }
  }

  function showUnlockBanner() {
    if (unlockBannerEl || muted || typeof document === "undefined") return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "audio-unlock-banner";
    el.setAttribute("aria-label", "点击开启音效");
    el.textContent = "🔊 点按开启音效";
    el.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        unlockAudioFromGesture(true);
      },
      { passive: false }
    );
    (document.body || document.documentElement).appendChild(el);
    unlockBannerEl = el;
  }

  function syncUnlockBanner() {
    if (muted || audioReady) hideUnlockBanner();
  }

  function unlockAudioFromGesture(forceBanner) {
    const ctx = ensureAudio();
    if (!ctx) {
      showUnlockBanner();
      return Promise.resolve(null);
    }
    pokeSilentBuffer(ctx);
    getMasterOut();
    const finish = () => {
      if (ctx.state === "running") {
        audioReady = true;
        hideUnlockBanner();
      } else if (forceBanner || !audioReady) {
        showUnlockBanner();
      }
      return ctx;
    };
    if (ctx.state === "suspended") {
      return ctx.resume().then(finish).catch(finish);
    }
    return Promise.resolve(finish());
  }

  ["pointerdown", "touchstart", "keydown"].forEach((t) => {
    document.addEventListener(
      t,
      () => {
        unlockAudioFromGesture(false);
      },
      { capture: true, passive: true }
    );
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && audioCtx && audioCtx.state === "suspended") {
      try {
        audioCtx.resume();
      } catch (_) {}
    }
  });

  // If autoplay policy blocks, surface Chinese tip after a short beat
  setTimeout(() => {
    if (muted || audioReady) return;
    const ctx = audioCtx;
    if (!ctx || ctx.state === "suspended") showUnlockBanner();
  }, 900);

  /** Wire mute button if present */
  function bindMuteButton(btn) {
    if (!btn) return;
    const sync = () => {
      btn.textContent = muted ? "🔇" : "🔊";
      btn.setAttribute("aria-label", muted ? "取消静音" : "静音");
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
      btn.title = muted ? "当前静音，点按恢复" : "静音";
    };
    sync();
    btn.addEventListener("click", () => {
      setMuted(!muted);
      if (!muted) unlockAudioFromGesture(true);
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
    unlockAudio: unlockAudioFromGesture,
    playThud,
    playPop,
    playWhoosh,
    playCrack,
    playBurst,
    playTick,
    playWoodChime,
    playKnead,
    playSplat,
    reducedMotion: () => reducedMotion,
    vibrate,
    recordHit,
    getGameStats,
    setGameStat,
    spawnFloatingText,
    screenShake,
    hitStop,
    impactFlash,
    vibeHit,
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
