/**
 * 出气口 — shared game core (audio, stats, juice helpers)
 * Local-only. No uploads.
 *
 * Audio policy (iOS / WeChat / Chrome):
 * - Never schedule Web Audio while AudioContext is suspended (stale currentTime → silence).
 * - resume() then schedule with FRESH currentTime; also HTMLAudioElement fallback in-gesture.
 * - Mute defaults OFF; chuqikou-mute only when user sets "1".
 */
(function () {
  "use strict";

  let audioCtx = null;
  let masterOut = null;
  let masterAnalyser = null;
  let muted = false;
  let reducedMotion = false;
  let audioReady = false;
  let unlockBannerEl = null;
  let resumeChain = null;

  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {}

  const STATS_KEY = "chuqikou-game-stats-v1";
  const MUTE_KEY = "chuqikou-mute";

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

  function setAudioState(state) {
    try {
      if (document.body) document.body.setAttribute("data-audio-state", state);
    } catch (_) {}
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        try {
          audioCtx = new AC();
        } catch (_) {
          audioCtx = null;
        }
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try {
        const p = audioCtx.resume();
        if (p && typeof p.then === "function") resumeChain = p.catch(() => audioCtx);
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

  function audioFreqPeak() {
    if (!masterAnalyser) return 0;
    const data = new Uint8Array(masterAnalyser.frequencyBinCount);
    masterAnalyser.getByteFrequencyData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, data[i]);
    return peak;
  }

  /* —— HTMLAudioElement fallback (WeChat / X5 when Web Audio flaky) —— */
  const htmlUriCache = Object.create(null);
  const htmlPool = Object.create(null);

  function makeWavDataUri(freq, duration, vol, opts) {
    const o = opts || {};
    const sampleRate = 22050;
    const numSamples = Math.max(1, Math.floor(sampleRate * duration));
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeStr(off, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    const decay = o.decay == null ? 10 : o.decay;
    const freq2 = o.freq2 || 0;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * decay);
      let sample = Math.sin(2 * Math.PI * freq * t) * env * vol;
      if (freq2) sample += Math.sin(2 * Math.PI * freq2 * t) * env * vol * 0.45;
      if (o.noise) sample += (Math.random() * 2 - 1) * env * vol * o.noise;
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, (clipped * 32767) | 0, true);
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return "data:audio/wav;base64," + btoa(binary);
  }

  function htmlUri(kind) {
    if (htmlUriCache[kind]) return htmlUriCache[kind];
    let uri;
    if (kind === "beep") uri = makeWavDataUri(880, 0.22, 0.9, { decay: 8 });
    else if (kind === "pop") uri = makeWavDataUri(720, 0.1, 0.75, { decay: 18, freq2: 240 });
    else if (kind === "crack") uri = makeWavDataUri(1400, 0.12, 0.7, { decay: 22, noise: 0.55 });
    else if (kind === "tick") uri = makeWavDataUri(980, 0.05, 0.45, { decay: 40 });
    else if (kind === "wood") uri = makeWavDataUri(392, 0.35, 0.55, { decay: 6, freq2: 588 });
    else uri = makeWavDataUri(90, 0.18, 0.95, { decay: 12, freq2: 180, noise: 0.25 }); // thud
    htmlUriCache[kind] = uri;
    return uri;
  }

  function playHtmlSfx(kind) {
    if (muted) return;
    try {
      const key = kind || "thud";
      let a = htmlPool[key];
      if (!a) {
        a = new Audio(htmlUri(key));
        a.preload = "auto";
        htmlPool[key] = a;
      }
      a.pause();
      a.currentTime = 0;
      a.volume = key === "beep" ? 1 : 0.92;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }

  /** Unlock HTMLAudio inside a user gesture (silent priming clip). */
  function pokeHtmlUnlock() {
    try {
      const a = new Audio(htmlUri("tick"));
      a.volume = 0.01;
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          try {
            a.pause();
          } catch (_) {}
        }).catch(() => {});
      }
    } catch (_) {}
  }

  /**
   * Schedule Web Audio ONLY when ctx is running (fresh currentTime).
   * If suspended: HTMLAudio fallback immediately + resume().then(schedule).
   */
  function withAudio(scheduleFn, htmlKind) {
    if (muted) {
      setAudioState("muted");
      return;
    }
    const ctx = ensureAudio();
    getMasterOut();

    const runWeb = () => {
      if (muted || !ctx || ctx.state !== "running") return false;
      try {
        scheduleFn(ctx, ctx.currentTime);
        audioReady = true;
        setAudioState("running");
        hideUnlockBanner();
        return true;
      } catch (_) {
        return false;
      }
    };

    if (ctx && ctx.state === "running") {
      if (runWeb()) return;
    }

    // Gesture-safe audible fallback while Web Audio unlocks
    if (htmlKind) playHtmlSfx(htmlKind);

    if (!ctx) {
      setAudioState("no-ctx");
      showUnlockBanner();
      return;
    }

    pokeSilentBuffer(ctx);
    setAudioState("unlocking");

    const afterResume = () => {
      if (runWeb()) return;
      if (ctx.state === "suspended") {
        setAudioState("suspended");
        showUnlockBanner();
      } else {
        setAudioState(ctx.state || "unknown");
      }
    };

    try {
      const p = ctx.resume();
      if (p && typeof p.then === "function") {
        resumeChain = p.then(afterResume).catch(afterResume);
      } else {
        afterResume();
      }
    } catch (_) {
      afterResume();
    }
  }

  function setMuted(v) {
    muted = !!v;
    const out = getMasterOut();
    if (out) out.gain.value = muted ? 0 : 1.35;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch (_) {}
    setAudioState(muted ? "muted" : audioReady ? "running" : "idle");
    syncUnlockBanner();
    return muted;
  }

  function isMuted() {
    return muted;
  }

  // Default unmuted. Only "1" mutes — never treat missing/other as mute.
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch (_) {
    muted = false;
  }

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
    withAudio((ctx, t) => {
      const i = Math.max(0, Math.min(3, intensity == null ? 1 : intensity));
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
    }, "thud");
  }

  function playPop(pitch, loudness) {
    withAudio((ctx, t) => {
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
    }, "pop");
  }

  function playWhoosh() {
    withAudio((ctx, t) => {
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
    }, "thud");
  }

  function playCrack(big) {
    withAudio((ctx, t) => {
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
    }, "crack");
  }

  function playBurst() {
    withAudio((ctx, t) => {
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
    }, "thud");
    // layered whoosh via its own path (may HTML-fallback once)
    playWhoosh();
  }

  function playWoodChime() {
    withAudio((ctx, t) => {
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
      noiseBurst(ctx, t, 0.035, { freq: 920, type: "bandpass", Q: 1.8, gain: 0.32, decay: 0.08 });
      noiseBurst(ctx, t, 0.05, { freq: 380, type: "bandpass", Q: 1.2, gain: 0.22, decay: 0.12 });
    }, "wood");
  }

  function playTick() {
    withAudio((ctx, t) => {
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
    }, "tick");
  }

  function playKnead(intensity) {
    withAudio((ctx, t) => {
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
    }, "tick");
  }

  function playSplat() {
    playPop(0.65, 1.85);
    withAudio((ctx, t) => {
      noiseBurst(ctx, t, 0.14, { freq: 280, type: "lowpass", gain: 0.55, decay: 0.25 });
      noiseBurst(ctx, t, 0.08, { freq: 1600, type: "bandpass", Q: 1.1, gain: 0.4, decay: 0.12 });
    }, "pop");
  }

  /** Loud verification beep — forces unmute and plays HTML + WebAudio. */
  function playTestBeep() {
    setMuted(false);
    pokeHtmlUnlock();
    playHtmlSfx("beep");
    const ctx = ensureAudio();
    if (ctx) {
      pokeSilentBuffer(ctx);
      getMasterOut();
      const fire = () => {
        if (!ctx || ctx.state !== "running") return;
        try {
          const t = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(880, t);
          osc.frequency.setValueAtTime(660, t + 0.12);
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.7, t + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          osc.connect(gain);
          gain.connect(outNode());
          osc.start(t);
          osc.stop(t + 0.3);
          audioReady = true;
          setAudioState("running");
          hideUnlockBanner();
        } catch (_) {}
      };
      if (ctx.state === "running") fire();
      else {
        setAudioState("unlocking");
        try {
          ctx.resume().then(fire).catch(fire);
        } catch (_) {
          fire();
        }
      }
    } else {
      setAudioState("html-only");
    }
  }

  /* —— Visual juice (perf-capped) —— */
  /** 0=off/reduced, 1=low, 2=med, 3=high */
  let juiceQuality = reducedMotion ? 0 : 3;
  let juiceAlive = 0;
  let floatAlive = 0;
  let shockAlive = 0;
  let lastShakeAt = 0;
  let shakeTimer = 0;
  let shakePending = null;
  let hitStopUntil = 0;
  let hitStopTimer = 0;
  let lastFlashAt = 0;
  let lastVibeAt = 0;
  let frameEma = 16.7;
  let lastFrameTs = 0;
  let qualityWatchStarted = false;
  const particlePool = [];
  const flashByParent = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  const MAX_PARTICLES_HIGH = 64;
  const MAX_PARTICLES_MED = 40;
  const MAX_PARTICLES_LOW = 24;
  const MAX_FLOAT = 12;
  const MAX_SHOCK = 3;

  function maxParticles() {
    if (juiceQuality <= 0) return 0;
    if (juiceQuality === 1) return MAX_PARTICLES_LOW;
    if (juiceQuality === 2) return MAX_PARTICLES_MED;
    return MAX_PARTICLES_HIGH;
  }

  function particleBudget() {
    return Math.max(0, maxParticles() - juiceAlive);
  }

  function startQualityWatch() {
    if (qualityWatchStarted || reducedMotion) return;
    if (typeof requestAnimationFrame !== "function") return;
    qualityWatchStarted = true;
    function tick(ts) {
      if (lastFrameTs) {
        const dt = ts - lastFrameTs;
        if (dt > 0 && dt < 120) {
          frameEma = frameEma * 0.9 + dt * 0.1;
          if (frameEma > 28 && juiceQuality > 1) juiceQuality = 1;
          else if (frameEma > 22 && juiceQuality > 2) juiceQuality = 2;
          else if (frameEma < 17.5 && juiceQuality < 3) juiceQuality = Math.min(3, juiceQuality + 1);
        }
      }
      lastFrameTs = ts;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startQualityWatch);
    } else {
      startQualityWatch();
    }
  } catch (_) {}

  function acquireDot() {
    let p = particlePool.pop();
    if (!p) {
      p = document.createElement("span");
    }
    return p;
  }

  function releaseDot(p) {
    try {
      if (p.parentNode) p.parentNode.removeChild(p);
    } catch (_) {}
    p.className = "";
    p.removeAttribute("style");
    if (particlePool.length < 96) particlePool.push(p);
  }

  function pruneOldestBurst(parent) {
    if (!parent) return;
    const bursts = parent.querySelectorAll(".particle-burst");
    if (!bursts.length) return;
    const oldest = bursts[0];
    const dots = oldest.querySelectorAll(".particle-dot");
    juiceAlive = Math.max(0, juiceAlive - dots.length);
    dots.forEach(releaseDot);
    try {
      oldest.remove();
    } catch (_) {}
  }

  function spawnFloatingText(parent, text, x, y, opts) {
    if (!parent) return;
    if (juiceQuality <= 0 && !reducedMotion) return;
    if (floatAlive >= MAX_FLOAT) {
      const old = parent.querySelector(".float-dmg");
      if (old) {
        try {
          old.remove();
        } catch (_) {}
        floatAlive = Math.max(0, floatAlive - 1);
      }
    }
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
    floatAlive++;
    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
      floatAlive = Math.max(0, floatAlive - 1);
    }, o.ms || 900);
  }

  function applyShake(el, intensity, combo) {
    const cBoost = combo ? Math.min(1.4, 0.35 + combo * 0.08) : 0;
    const i = Math.max(0.4, Math.min(3.5, (intensity == null ? 1 : intensity) + cBoost));
    const cls = i >= 2.2 ? "is-shake-mega" : i >= 1.2 ? "is-shake-hard" : "is-shake";
    const now = performance.now();
    // Coalesce: if already shaking hard enough, just bump amp — avoid layout thrash
    if (now - lastShakeAt < 48 && (el.classList.contains("is-shake") || el.classList.contains("is-shake-hard") || el.classList.contains("is-shake-mega"))) {
      el.style.setProperty("--shake-amp", (6 * i).toFixed(1) + "px");
      if (cls === "is-shake-mega" && !el.classList.contains("is-shake-mega")) {
        el.classList.remove("is-shake", "is-shake-hard");
        el.classList.add("is-shake-mega");
      } else if (cls === "is-shake-hard" && el.classList.contains("is-shake")) {
        el.classList.remove("is-shake");
        el.classList.add("is-shake-hard");
      }
      clearTimeout(shakeTimer);
      shakeTimer = setTimeout(() => {
        el.classList.remove("is-shake", "is-shake-hard", "is-shake-mega");
      }, i >= 2.2 ? 300 : i >= 1.2 ? 220 : 150);
      lastShakeAt = now;
      return;
    }
    el.classList.remove("is-shake", "is-shake-hard", "is-shake-mega");
    // One reflow only when restarting the CSS animation
    void el.offsetWidth;
    el.classList.add(cls);
    el.style.setProperty("--shake-amp", (6 * i).toFixed(1) + "px");
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => {
      el.classList.remove("is-shake", "is-shake-hard", "is-shake-mega");
    }, i >= 2.2 ? 300 : i >= 1.2 ? 220 : 150);
    lastShakeAt = now;
  }

  function screenShake(el, intensity, combo) {
    if (!el || juiceQuality <= 0) return;
    if (juiceQuality === 1 && (intensity == null ? 1 : intensity) < 0.9) return;
    // Coalesce multiple shakes in the same frame to one apply
    if (shakePending) {
      shakePending.intensity = Math.max(shakePending.intensity, intensity == null ? 1 : intensity);
      shakePending.combo = Math.max(shakePending.combo || 0, combo || 0);
      return;
    }
    shakePending = { el: el, intensity: intensity == null ? 1 : intensity, combo: combo || 0 };
    requestAnimationFrame(() => {
      const p = shakePending;
      shakePending = null;
      if (p) applyShake(p.el, p.intensity, p.combo);
    });
  }

  /**
   * Brief hit-stop. Caps ≤28ms, single timer, no busy-wait.
   * Uses a flag for canvas loops; CSS only dims stage (does NOT pause every descendant).
   */
  function hitStop(ms) {
    if (juiceQuality <= 0) return;
    if (juiceQuality === 1) ms = Math.min(ms == null ? 16 : ms, 16);
    const dur = Math.max(10, Math.min(28, ms == null ? 20 : ms));
    const until = performance.now() + dur;
    if (until <= hitStopUntil + 2) return;
    hitStopUntil = until;
    const root = document.documentElement;
    root.classList.add("is-hitstop");
    clearTimeout(hitStopTimer);
    hitStopTimer = setTimeout(() => {
      root.classList.remove("is-hitstop");
    }, dur);
  }

  function isHitStopping() {
    return performance.now() < hitStopUntil;
  }

  /** Single reusable flash overlay per parent; throttled. */
  function impactFlash(parent, opts) {
    if (!parent || juiceQuality <= 0) return;
    const now = performance.now();
    if (now - lastFlashAt < (juiceQuality <= 1 ? 90 : 50)) return;
    lastFlashAt = now;
    const o = opts || {};
    let flash = flashByParent ? flashByParent.get(parent) : null;
    if (!flash || !flash.isConnected) {
      flash = document.createElement("div");
      parent.appendChild(flash);
      if (flashByParent) flashByParent.set(parent, flash);
    }
    flash.className = "impact-flash" + (o.heavy ? " is-heavy" : "") + (o.chromatic && juiceQuality >= 2 ? " is-chromatic" : "");
    // Restart CSS animation without stacking nodes
    flash.style.animation = "none";
    void flash.offsetWidth;
    flash.style.animation = "";
    clearTimeout(flash._ventTimer);
    flash._ventTimer = setTimeout(() => {
      flash.className = "impact-flash is-idle";
    }, o.ms || 180);
  }

  /** Combo-aware vibrate: longer patterns on big hits; lightly throttled. */
  function vibeHit(kind) {
    try {
      if (!navigator.vibrate) return;
      const now = performance.now();
      if (now - lastVibeAt < 28 && kind !== "burst" && kind !== "boss") return;
      lastVibeAt = now;
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
    if (!parent || juiceQuality <= 0) return;
    const o = opts || {};
    let want = o.count || 18;
    if (juiceQuality === 1) want = Math.min(want, 8);
    else if (juiceQuality === 2) want = Math.min(want, 16);
    else want = Math.min(want, 28);
    let budget = particleBudget();
    while (budget < Math.min(6, want) && juiceAlive > 0) {
      pruneOldestBurst(parent);
      budget = particleBudget();
    }
    const n = Math.min(want, budget);
    if (n <= 0) return;
    const colors = o.colors || ["#5ce1e6", "#ff3d7f", "#ffe566", "#f4e8d8"];
    const layer = document.createElement("div");
    layer.className = "particle-burst";
    layer.style.left = x + "px";
    layer.style.top = y + "px";
    parent.appendChild(layer);
    const big = juiceQuality >= 2 && (o.big || o.star);
    const useStar = juiceQuality >= 2 && o.star;
    for (let i = 0; i < n; i++) {
      const p = acquireDot();
      p.className = "particle-dot" + (useStar ? " is-star" : "") + (big ? " is-big" : "");
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
    juiceAlive += n;
    const life = o.ms || 650;
    setTimeout(() => {
      const dots = layer.querySelectorAll(".particle-dot");
      juiceAlive = Math.max(0, juiceAlive - dots.length);
      dots.forEach(releaseDot);
      try {
        layer.remove();
      } catch (_) {}
    }, life);
  }

  function createShockwave(parent, x, y) {
    if (!parent || juiceQuality <= 0) return;
    if (shockAlive >= MAX_SHOCK) return;
    if (juiceQuality === 1) return;
    const ring = document.createElement("div");
    ring.className = "shockwave-ring";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    parent.appendChild(ring);
    shockAlive++;
    setTimeout(() => {
      try {
        ring.remove();
      } catch (_) {}
      shockAlive = Math.max(0, shockAlive - 1);
    }, 550);
  }

  function getJuiceQuality() {
    return juiceQuality;
  }

  /* —— Zoom guards (iOS / WeChat / Chrome) —— */
  (function blockPinchZoom() {
    const opt = { passive: false, capture: true };
    function prevent(e) {
      try {
        e.preventDefault();
      } catch (_) {}
    }
    ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
      document.addEventListener(type, prevent, opt);
    });
    document.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length > 1) prevent(e);
      },
      opt
    );
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
    // Double-tap zoom (iOS): collapse rapid second tap on non-editable targets
    let lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const now = Date.now();
        if (now - lastTouchEnd < 320) {
          const t = e.target;
          const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
          if (tag !== "input" && tag !== "textarea" && tag !== "select") prevent(e);
        }
        lastTouchEnd = now;
      },
      opt
    );
    function lockViewportMeta() {
      try {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
          meta = document.createElement("meta");
          meta.setAttribute("name", "viewport");
          (document.head || document.documentElement).appendChild(meta);
        }
        meta.setAttribute(
          "content",
          "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        );
      } catch (_) {}
    }
    lockViewportMeta();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", lockViewportMeta, { once: true });
    }
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
    el.innerHTML = "🔊 点这里开启音效<br><small>听不见？再点一次测试</small>";
    el.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        unlockAudioFromGesture(true);
        playTestBeep();
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
    pokeHtmlUnlock();
    const ctx = ensureAudio();
    if (!ctx) {
      playHtmlSfx("beep");
      showUnlockBanner();
      setAudioState("no-ctx");
      return Promise.resolve(null);
    }
    pokeSilentBuffer(ctx);
    getMasterOut();
    setAudioState(ctx.state === "running" ? "running" : "unlocking");

    const finish = () => {
      if (ctx.state === "running") {
        audioReady = true;
        setAudioState("running");
        hideUnlockBanner();
        // Audible confirm only when forced (banner / test / unmute)
        if (forceBanner) {
          try {
            const t = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = 660;
            gain.gain.setValueAtTime(0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
            osc.connect(gain);
            gain.connect(outNode());
            osc.start(t);
            osc.stop(t + 0.14);
          } catch (_) {}
        }
      } else if (forceBanner || !audioReady) {
        setAudioState("suspended");
        showUnlockBanner();
      }
      return ctx;
    };

    if (ctx.state === "suspended") {
      try {
        return ctx.resume().then(finish).catch(finish);
      } catch (_) {
        return Promise.resolve(finish());
      }
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

  setTimeout(() => {
    if (muted || audioReady) return;
    const ctx = audioCtx;
    if (!ctx || ctx.state === "suspended") showUnlockBanner();
  }, 700);

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
      if (!muted) {
        unlockAudioFromGesture(true);
        playTestBeep();
      }
      sync();
    });
  }

  function bindTestSfxButton(btn) {
    if (!btn) return;
    btn.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMuted(false);
        unlockAudioFromGesture(true);
        playTestBeep();
        // refresh mute icon if present
        const muteBtn = document.getElementById("muteBtn");
        if (muteBtn) {
          muteBtn.textContent = "🔊";
          muteBtn.setAttribute("aria-pressed", "false");
        }
      },
      { passive: false }
    );
  }

  function setHud(el, text) {
    if (el) el.textContent = text || "";
  }

  // Auto-wire test button when present
  function autoBindTest() {
    try {
      const btn = document.getElementById && document.getElementById("testSfxBtn");
      if (btn) bindTestSfxButton(btn);
    } catch (_) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoBindTest);
  } else {
    autoBindTest();
  }
  setAudioState(muted ? "muted" : "idle");

  const api = {
    ensureAudio,
    ensureAudioAsync,
    getMasterOut,
    audioPeak,
    audioFreqPeak,
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
    playTestBeep,
    reducedMotion: () => reducedMotion,
    vibrate,
    recordHit,
    getGameStats,
    setGameStat,
    spawnFloatingText,
    screenShake,
    hitStop,
    isHitStopping,
    impactFlash,
    vibeHit,
    createParticleBurst,
    createShockwave,
    getJuiceQuality,
    setMuted,
    isMuted,
    bindMuteButton,
    bindTestSfxButton,
    setHud,
    setStat: setHud,
  };

  window.VentGameCore = api;
  window.Vent = api;
})();
