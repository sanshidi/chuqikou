/**
 * 出气口 — core: audio, rituals, breathe, hub shell
 * Local-only. No uploads.
 */
(function () {
  "use strict";

  const ventText = document.getElementById("ventText");
  const textareaWrap = document.getElementById("textareaWrap");
  const btnShred = document.getElementById("btnShred");
  const btnVoid = document.getElementById("btnVoid");
  const btnBalloon = document.getElementById("btnBalloon");
  const btnBurn = document.getElementById("btnBurn");
  const btnShatter = document.getElementById("btnShatter");
  const shredOverlay = document.getElementById("shredOverlay");
  const balloonLayer = document.getElementById("balloonLayer");
  const mood = document.getElementById("mood");
  const moodValue = document.getElementById("moodValue");
  const breatheSection = document.getElementById("breatheSection");
  const breatheCircle = document.getElementById("breatheCircle");
  const breatheText = document.getElementById("breatheText");
  const breatheHint = document.getElementById("breatheHint");
  const btnBreatheStart = document.getElementById("btnBreatheStart");
  const btnBreatheSkip = document.getElementById("btnBreatheSkip");
  const offerBreathe = document.getElementById("offerBreathe");
  const btnOfferYes = document.getElementById("btnOfferYes");
  const btnOfferNo = document.getElementById("btnOfferNo");
  const ventValve = document.getElementById("ventValve");
  const gameModal = document.getElementById("gameModal");
  const gameStage = document.getElementById("gameStage");
  const gameTitle = document.getElementById("gameTitle");
  const gameHint = document.getElementById("gameHint");
  const gameStat = document.getElementById("gameStat");
  const btnCloseGame = document.getElementById("btnCloseGame");
  const btnResetGame = document.getElementById("btnResetGame");
  const stallGrid = document.getElementById("stallGrid");

  let destroying = false;
  let audioCtx = null;
  let breatheTimer = null;
  let breathePhaseTimer = null;
  let activeCleanup = null;
  let activeGameId = null;
  let reducedMotion = false;

  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {}


  /* —— Harden against mobile pinch-zoom (Safari gestures + multi-touch) —— */
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
    // iOS sometimes fires ctrl+wheel zoom on trackpads; harmless on phones
    document.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey) prevent(e);
      },
      opt
    );
  })();

  /* —— Shared API for games —— */
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

  /** Record a hit for combo/best — local only */
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
    stats[gameId] = g;
    saveStats(stats);
    if (o.vibrate !== false) vibrate(o.vibrateMs || 10);
    return { combo: g._combo, bestCombo: g.bestCombo, hits: g.hits };
  }

  function getGameStats(gameId) {
    const g = loadStats()[gameId] || {};
    return { hits: g.hits || 0, bestCombo: g.bestCombo || 0 };
  }

  const Vent = {
    ensureAudio,
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
    setStat(text) {
      gameStat.textContent = text || "";
    },
    offerCalm() {
      showOfferBreathe();
    },
  };
  window.Vent = Vent;
  window.VentGames = window.VentGames || {};

  function syncDestroyButtons() {
    const has = ventText.value.trim().length > 0 && !destroying;
    [btnShred, btnVoid, btnBalloon, btnBurn, btnShatter].forEach((b) => {
      if (b) b.disabled = !has;
    });
  }

  ventText.addEventListener("input", syncDestroyButtons);

  mood.addEventListener("input", () => {
    moodValue.textContent = mood.value;
  });

  /* —— Web Audio —— */
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playThud(intensity) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90 + intensity * 40, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    filter.type = "lowpass";
    filter.frequency.value = 280;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22 + intensity * 0.08, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  function playPop() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(600 + Math.random() * 400, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  function playWhoosh() {
    const ctx = ensureAudio();
    if (!ctx) return;
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
    gain.connect(ctx.destination);
    src.start(t);
  }

  function playCrack() {
    const ctx = ensureAudio();
    if (!ctx) return;
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
    gain.connect(ctx.destination);
    src.start(t);
  }

  function playBurst() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.46);
    playWhoosh();
  }


  function playWoodChime() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Soft woody tonal: warm sine fundamental + quiet harmonic, short decay
    const freqs = [392, 588]; // G4 + soft fifth-ish overtone
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
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.58);
    });
    // Tiny soft knock body
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
    ng.connect(ctx.destination);
    src.start(t);
  }

  function playTick() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /* —— Valve tease —— */
  function puffValve(boot) {
    ensureAudio();
    ventValve.classList.remove("is-puff", "boot-puff");
    void ventValve.offsetWidth;
    ventValve.classList.add(boot ? "boot-puff" : "is-puff");
    playWhoosh();
    setTimeout(() => ventValve.classList.remove("is-puff", "boot-puff"), 900);
  }

  ventValve.addEventListener("click", () => puffValve(false));

  if (!reducedMotion) {
    setTimeout(() => puffValve(true), 600);
  }

  /* —— Destroy rituals —— */
  function clearVentText() {
    ventText.value = "";
    syncDestroyButtons();
  }

  function afterDestroy() {
    destroying = false;
    textareaWrap.classList.remove(
      "is-shredding",
      "is-voiding",
      "is-ballooning",
      "is-burning",
      "is-shattering"
    );
    if (shredOverlay) {
      shredOverlay.innerHTML = "";
      shredOverlay.className = "shred-overlay";
    }
    clearVentText();
    showOfferBreathe();
  }

  function spawnDestroyParticles(kind) {
    if (!shredOverlay || reducedMotion) return;
    shredOverlay.className = "shred-overlay is-on is-" + kind;
    shredOverlay.innerHTML = "";
    const n = kind === "shatter" ? 28 : kind === "burn" ? 22 : 18;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "destroy-particle";
      p.style.left = Math.random() * 100 + "%";
      p.style.top = Math.random() * 100 + "%";
      p.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.random() * 140 - 40).toFixed(1) + "px");
      p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + "s";
      shredOverlay.appendChild(p);
    }
  }

  function runShred() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playCrack();
    vibrate(18);
    spawnDestroyParticles("shred");
    textareaWrap.classList.add("is-shredding");
    setTimeout(afterDestroy, reducedMotion ? 200 : 900);
  }

  function runVoid() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playWhoosh();
    vibrate(14);
    spawnDestroyParticles("void");
    textareaWrap.classList.add("is-voiding");
    setTimeout(afterDestroy, reducedMotion ? 200 : 950);
  }

  function runBalloon() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playWhoosh();
    vibrate(12);
    textareaWrap.classList.add("is-ballooning");
    const emojis = ["🎈", "🎈", "💨", "✨", "🫧"];
    for (let i = 0; i < 8; i++) {
      const el = document.createElement("span");
      el.className = "fly-balloon";
      el.textContent = emojis[i % emojis.length];
      el.style.left = 8 + Math.random() * 84 + "%";
      el.style.animationDelay = i * 0.08 + "s";
      el.style.fontSize = 1.4 + Math.random() * 1.2 + "rem";
      balloonLayer.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    }
    setTimeout(afterDestroy, reducedMotion ? 200 : 1000);
  }

  function runBurn() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playCrack();
    playWhoosh();
    vibrate(22);
    spawnDestroyParticles("burn");
    textareaWrap.classList.add("is-burning");
    setTimeout(afterDestroy, reducedMotion ? 220 : 1100);
  }

  function runShatter() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playCrack();
    vibrate([10, 30, 18]);
    spawnDestroyParticles("shatter");
    textareaWrap.classList.add("is-shattering");
    setTimeout(afterDestroy, reducedMotion ? 220 : 1000);
  }

  btnShred.addEventListener("click", runShred);
  btnVoid.addEventListener("click", runVoid);
  btnBalloon.addEventListener("click", runBalloon);
  if (btnBurn) btnBurn.addEventListener("click", runBurn);
  if (btnShatter) btnShatter.addEventListener("click", runShatter);

  /* —— Breathing —— */
  function showOfferBreathe() {
    offerBreathe.hidden = false;
    breatheSection.hidden = true;
  }

  function hideOffer() {
    offerBreathe.hidden = true;
  }

  function stopBreathe() {
    if (breatheTimer) clearTimeout(breatheTimer);
    if (breathePhaseTimer) clearInterval(breathePhaseTimer);
    breatheTimer = null;
    breathePhaseTimer = null;
    breatheCircle.classList.remove("inhale", "exhale");
    breatheText.textContent = "准备";
  }

  function startBreathe() {
    hideOffer();
    breatheSection.hidden = false;
    breatheSection.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    stopBreathe();
    breatheHint.textContent = "跟着光圈：吸气 4 秒…停 2 秒…呼气 4 秒…";
    let phase = 0;
    const cycle = () => {
      breatheCircle.classList.remove("inhale", "exhale");
      if (phase % 3 === 0) {
        breatheText.textContent = "吸气";
        breatheCircle.classList.add("inhale");
      } else if (phase % 3 === 1) {
        breatheText.textContent = "停一下";
      } else {
        breatheText.textContent = "呼气";
        breatheCircle.classList.add("exhale");
      }
      phase++;
    };
    cycle();
    breathePhaseTimer = setInterval(cycle, 4000);
    breatheTimer = setTimeout(() => {
      stopBreathe();
      breatheText.textContent = "好了";
      breatheHint.textContent = "缓过来一点就行。需要再来可以再点开始。";
    }, 45000);
  }

  btnOfferYes.addEventListener("click", startBreathe);
  btnOfferNo.addEventListener("click", hideOffer);
  btnBreatheStart.addEventListener("click", startBreathe);
  btnBreatheSkip.addEventListener("click", () => {
    stopBreathe();
    breatheSection.hidden = true;
  });

  /* —— Game hub —— */
  const META = {
    bag: { title: "出气袋", hint: "连点出气，把劲儿打出去。" },
    bubble: { title: "泡泡膜", hint: "一格格戳破。全破完可以再来一局。" },
    plates: { title: "砸盘子", hint: "点盘子就碎，碎片会飞开。" },
    rage: { title: "键盘宣泄", hint: "狂按键盘或猛点屏幕，填满怒气条再释放。" },
    squeeze: { title: "捏压力球", hint: "按住捏扁，松开弹回。多捏几下。" },
    muyu: { title: "敲木鱼", hint: "点一下听一声。不用赶，跟着自己的节奏。" },
  };

  function closeGame() {
    if (typeof activeCleanup === "function") {
      try {
        activeCleanup();
      } catch (_) {}
    }
    activeCleanup = null;
    activeGameId = null;
    gameStage.innerHTML = "";
    gameStat.textContent = "";
    gameModal.hidden = true;
    document.body.style.overflow = "";
  }

  function openGame(id) {
    const meta = META[id];
    const factory = window.VentGames[id];
    if (!meta || typeof factory !== "function") return;
    ensureAudio();
    closeGame();
    activeGameId = id;
    gameTitle.textContent = meta.title;
    gameHint.textContent = meta.hint;
    gameModal.hidden = false;
    document.body.style.overflow = "hidden";
    activeCleanup = factory(gameStage, Vent) || null;
    btnCloseGame.focus();
  }

  stallGrid.addEventListener("pointerdown", () => {
    ensureAudio();
  }, { passive: true });

  stallGrid.addEventListener("click", (e) => {
    const stall = e.target.closest(".stall");
    if (!stall) return;
    openGame(stall.dataset.game);
  });

  const gameSheet = gameModal.querySelector(".game-sheet");
  if (gameSheet) {
    gameSheet.addEventListener("click", (e) => e.stopPropagation());
  }

  btnCloseGame.addEventListener("click", () => {
    closeGame();
    showOfferBreathe();
  });

  btnResetGame.addEventListener("click", () => {
    if (activeGameId) openGame(activeGameId);
  });

  gameModal.addEventListener("click", (e) => {
    if (e.target === gameModal) {
      closeGame();
      showOfferBreathe();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !gameModal.hidden) {
      closeGame();
      showOfferBreathe();
    }
  });


  /* —— Subtle crisis affordance —— */
  const btnHelpChip = document.getElementById("btnHelpChip");
  const helpPanel = document.getElementById("helpPanel");
  const btnHelpClose = document.getElementById("btnHelpClose");
  if (btnHelpChip && helpPanel) {
    btnHelpChip.addEventListener("click", () => {
      const willOpen = helpPanel.hidden;
      helpPanel.hidden = !willOpen;
      btnHelpChip.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    if (btnHelpClose) {
      btnHelpClose.addEventListener("click", () => {
        helpPanel.hidden = true;
        btnHelpChip.setAttribute("aria-expanded", "false");
      });
    }
  }

  /* —— PWA —— */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  syncDestroyButtons();
})();
