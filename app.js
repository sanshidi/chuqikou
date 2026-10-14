/**
 * 出气口 — local-only emotional vent MVP
 * No network uploads. All text stays in memory / DOM only.
 */
(function () {
  "use strict";

  const ventText = document.getElementById("ventText");
  const textareaWrap = document.getElementById("textareaWrap");
  const shredOverlay = document.getElementById("shredOverlay");
  const btnShred = document.getElementById("btnShred");
  const btnVoid = document.getElementById("btnVoid");
  const btnBalloon = document.getElementById("btnBalloon");
  const balloonLayer = document.getElementById("balloonLayer");
  const punchBag = document.getElementById("punchBag");
  const bagFace = document.getElementById("bagFace");
  const punchCountEl = document.getElementById("punchCount");
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

  let punchCount = 0;
  let destroying = false;
  let audioCtx = null;
  let breatheTimer = null;
  let breathePhaseTimer = null;

  const FACES = ["😤", "😠", "💢", "😳", "😮", "😌"];

  function syncDestroyButtons() {
    const has = ventText.value.trim().length > 0 && !destroying;
    btnShred.disabled = !has;
    btnVoid.disabled = !has;
    btnBalloon.disabled = !has;
  }

  ventText.addEventListener("input", syncDestroyButtons);

  mood.addEventListener("input", () => {
    moodValue.textContent = mood.value;
  });

  /* —— Web Audio feedback (lazy init) —— */
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
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
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
  }

  function playPop() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.2);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /* —— Clear text locally (never leave page) —— */
  function clearVentText() {
    ventText.value = "";
    shredOverlay.innerHTML = "";
    shredOverlay.classList.remove("shredding");
    textareaWrap.classList.remove("voiding");
    ventText.style.cssText = "";
    destroying = false;
    syncDestroyButtons();
  }

  function afterDestroy() {
    clearVentText();
    offerBreathe.hidden = false;
    breatheSection.hidden = true;
    offerBreathe.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* —— P0: Shred —— */
  function doShred() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playWhoosh();

    const text = ventText.value;
    shredOverlay.innerHTML = "";
    shredOverlay.classList.add("shredding");
    ventText.style.opacity = "0";

    const lines = 8;
    for (let i = 0; i < lines; i++) {
      const strip = document.createElement("div");
      strip.className = "shred-strip";
      strip.style.top = i * (100 / lines) + "%";
      strip.style.setProperty("--rot", (i % 2 === 0 ? 1 : -1) * (6 + i * 2) + "deg");
      strip.style.animationDelay = i * 0.05 + "s";
      const start = Math.floor((text.length / lines) * i);
      const end = Math.floor((text.length / lines) * (i + 1));
      strip.textContent = text.slice(start, end) || "····";
      shredOverlay.appendChild(strip);
    }

    setTimeout(afterDestroy, 1100);
  }

  /* —— P0: Void —— */
  function doVoid() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playWhoosh();
    textareaWrap.classList.add("voiding");
    setTimeout(afterDestroy, 900);
  }

  /* —— P0: Balloon —— */
  function doBalloon() {
    if (destroying || !ventText.value.trim()) return;
    destroying = true;
    syncDestroyButtons();
    ensureAudio();
    playPop();

    const rect = textareaWrap.getBoundingClientRect();
    const emojis = ["🎈", "🎈", "☁️", "✨", "🎈"];
    emojis.forEach((emoji, i) => {
      const el = document.createElement("div");
      el.className = "fly-balloon";
      el.textContent = emoji;
      el.style.left = rect.left + rect.width * (0.2 + i * 0.15) + "px";
      el.style.top = rect.top + rect.height * 0.4 + "px";
      el.style.animationDelay = i * 0.12 + "s";
      balloonLayer.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    });

    ventText.style.transition = "opacity 0.6s, transform 0.8s";
    ventText.style.opacity = "0";
    ventText.style.transform = "translateY(-40px) scale(0.85)";
    setTimeout(afterDestroy, 900);
  }

  btnShred.addEventListener("click", doShred);
  btnVoid.addEventListener("click", doVoid);
  btnBalloon.addEventListener("click", doBalloon);

  /* —— P1: Punch bag —— */
  function onPunch(e) {
    e.preventDefault();
    ensureAudio();
    punchCount += 1;
    punchCountEl.textContent = String(punchCount);

    const hard = punchCount % 5 === 0;
    punchBag.classList.remove("hit", "hit-hard");
    void punchBag.offsetWidth;
    punchBag.classList.add(hard ? "hit-hard" : "hit");
    playThud(hard ? 1 : 0.5);

    bagFace.textContent = FACES[Math.min(FACES.length - 1, Math.floor(punchCount / 3) % FACES.length)];
    if (punchCount >= 12) bagFace.textContent = "😌";

    const rect = punchBag.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0] && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0] && e.touches[0].clientY);
    const impact = document.createElement("span");
    impact.className = "impact";
    const x = clientX != null ? clientX - rect.left - 20 : rect.width / 2 - 20;
    const y = clientY != null ? clientY - rect.top - 20 : rect.height / 2 - 20;
    impact.style.left = x + "px";
    impact.style.top = y + "px";
    punchBag.appendChild(impact);
    setTimeout(() => impact.remove(), 400);

    // Soft offer breathe after enough punches
    if (punchCount === 15 && offerBreathe.hidden && breatheSection.hidden) {
      offerBreathe.hidden = false;
    }
  }

  punchBag.addEventListener("pointerdown", onPunch);

  /* —— P1: Breathing 45s —— */
  const BREATHE_TOTAL_MS = 45000;
  const INHALE_MS = 4000;
  const EXHALE_MS = 4000;

  function stopBreathe() {
    if (breatheTimer) clearTimeout(breatheTimer);
    if (breathePhaseTimer) clearInterval(breathePhaseTimer);
    breatheTimer = null;
    breathePhaseTimer = null;
    breatheCircle.classList.remove("inhale", "exhale");
    breatheText.textContent = "完成";
    breatheHint.textContent = "缓好了就可以继续，或关掉这一页。";
    btnBreatheStart.disabled = false;
    btnBreatheStart.textContent = "再来一轮";
  }

  function startBreathe() {
    offerBreathe.hidden = true;
    breatheSection.hidden = false;
    breatheSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    btnBreatheStart.disabled = true;
    btnBreatheStart.textContent = "进行中…";
    breatheHint.textContent = "跟着圆圈：吸气 4 秒 · 呼气 4 秒";

    let inhaling = true;
    function tickPhase() {
      breatheCircle.classList.remove("inhale", "exhale");
      void breatheCircle.offsetWidth;
      if (inhaling) {
        breatheCircle.classList.add("inhale");
        breatheText.textContent = "吸气";
      } else {
        breatheCircle.classList.add("exhale");
        breatheText.textContent = "呼气";
      }
      inhaling = !inhaling;
    }

    tickPhase();
    breathePhaseTimer = setInterval(tickPhase, INHALE_MS);

    breatheTimer = setTimeout(stopBreathe, BREATHE_TOTAL_MS);
  }

  btnBreatheStart.addEventListener("click", startBreathe);
  btnBreatheSkip.addEventListener("click", () => {
    stopBreathe();
    breatheSection.hidden = true;
    breatheText.textContent = "准备";
  });

  btnOfferYes.addEventListener("click", startBreathe);
  btnOfferNo.addEventListener("click", () => {
    offerBreathe.hidden = true;
  });

  /* Init */
  syncDestroyButtons();
  moodValue.textContent = mood.value;
})();
