/**
 * 出气口 · 情绪池
 * Local-only voice bubbles: record → drop → grow/rise → play/pause or explode.
 * Audio never uploaded. In-memory only (refresh clears).
 */
(function () {
  "use strict";

  const tank = document.getElementById("poolTank");
  const bubblesEl = document.getElementById("poolBubbles");
  const emptyEl = document.getElementById("poolEmpty");
  const fxCanvas = document.getElementById("poolFx");
  const statusEl = document.getElementById("poolStatus");
  const btnRec = document.getElementById("btnPoolRec");
  const btnPreview = document.getElementById("btnPoolPreview");
  const btnDrop = document.getElementById("btnPoolDrop");
  if (!tank || !btnRec) return;

  const VOICE_RATE = { normal: 1, low: 0.72, high: 1.38, echo: 1 };
  const MIN_SIZE = 52;
  const MAX_SIZE = 118;
  const LONG_PRESS_MS = 650;

  let fuseMode = "day"; // 10 | 20 | day
  let voiceMode = "normal";
  let recording = false;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordChunks = [];
  let recordStartedAt = 0;
  let pendingBlob = null;
  let pendingUrl = null;
  let previewNodes = null;
  let previewPlaying = false;

  /** @type {Map<string, object>} */
  const bubbles = new Map();
  let fxParticles = [];
  let rafId = 0;
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {}

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function endOfTodayMs() {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function fuseExplodeAt(now) {
    if (fuseMode === "10") return now + 10000;
    if (fuseMode === "20") return now + 20000;
    return endOfTodayMs();
  }

  function fuseLabel() {
    if (fuseMode === "10") return "10 秒";
    if (fuseMode === "20") return "20 秒";
    return "今天结束";
  }

  /* —— Chip groups —— */
  document.querySelectorAll(".emotion-pool [data-fuse]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".emotion-pool [data-fuse]").forEach((b) => {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      fuseMode = btn.getAttribute("data-fuse");
      setStatus("引信：" + fuseLabel() + "。录完再丢进池里。");
    });
  });

  document.querySelectorAll(".emotion-pool [data-voice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".emotion-pool [data-voice]").forEach((b) => {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      voiceMode = btn.getAttribute("data-voice");
      setStatus("变声：" + btn.textContent + "（试听与泡泡播放都会用这个）。");
    });
  });

  /* —— Audio helpers (Web Audio, for pitch-ish rate + echo) —— */
  function ensureCtx() {
    if (window.Vent && typeof Vent.ensureAudio === "function") return Vent.ensureAudio();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ensureCtx._ctx) ensureCtx._ctx = new AC();
    if (ensureCtx._ctx.state === "suspended") ensureCtx._ctx.resume();
    return ensureCtx._ctx;
  }

  function playWhooshSoft() {
    if (window.Vent && Vent.playWhoosh) Vent.playWhoosh();
  }

  function stopGraph(nodes) {
    if (!nodes) return;
    try {
      if (nodes.source) {
        nodes.source.onended = null;
        nodes.source.stop();
      }
    } catch (_) {}
    try {
      if (nodes.source) nodes.source.disconnect();
    } catch (_) {}
    (nodes.extras || []).forEach((n) => {
      try {
        n.disconnect();
      } catch (_) {}
    });
  }

  /**
   * Play blob with voice preset. Returns control object { stop, getOffset }.
   * onEnded called when naturally finished.
   */
  async function playWithVoice(blob, voice, offsetSec, onEnded) {
    const ctx = ensureCtx();
    if (!ctx || !blob) return null;
    const ab = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    const rate = VOICE_RATE[voice] || 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const extras = [];
    const master = ctx.createGain();
    master.gain.value = 0.95;
    extras.push(master);

    if (voice === "echo") {
      const dry = ctx.createGain();
      dry.gain.value = 0.85;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.24;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      extras.push(dry, delay, fb, wet);
      source.connect(dry);
      dry.connect(master);
      source.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(master);
    } else {
      source.connect(master);
    }
    master.connect(ctx.destination);

    const startAt = ctx.currentTime;
    const off = Math.max(0, Math.min(offsetSec || 0, buffer.duration - 0.01));
    source.start(0, off);
    let stopped = false;
    source.onended = () => {
      if (stopped) return;
      stopped = true;
      if (typeof onEnded === "function") onEnded();
    };

    return {
      source,
      extras,
      buffer,
      rate,
      startAt,
      offset: off,
      stop() {
        if (stopped) return;
        stopped = true;
        stopGraph({ source, extras });
      },
      /** Elapsed content seconds accounting for playbackRate */
      getOffset() {
        const elapsed = (ctx.currentTime - startAt) * rate;
        return Math.min(buffer.duration, off + elapsed);
      },
    };
  }

  /* —— Recording —— */
  function pickMime() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const t of types) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return "";
  }

  async function startRecording() {
    if (recording) return;
    ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("这台设备不支持录音。可以看看别的出气方式。");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setStatus("没拿到麦克风权限。可以改权限后再试，或先玩夜市小游戏。");
      btnRec.classList.remove("is-recording");
      btnRec.setAttribute("aria-pressed", "false");
      return;
    }
    recordChunks = [];
    const mime = pickMime();
    try {
      mediaRecorder = mime
        ? new MediaRecorder(mediaStream, { mimeType: mime })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      setStatus("没法启动录音机。换个浏览器试试？");
      stopStream();
      return;
    }
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      stopStream();
      const type = (mediaRecorder && mediaRecorder.mimeType) || mime || "audio/webm";
      if (!recordChunks.length) {
        setStatus("好像没录到声音。再试一次？");
        syncPendingButtons();
        return;
      }
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      pendingBlob = new Blob(recordChunks, { type });
      pendingUrl = URL.createObjectURL(pendingBlob);
      const sec = ((Date.now() - recordStartedAt) / 1000).toFixed(1);
      setStatus("录好了约 " + sec + " 秒。可以试听，或丢进池里（引信：" + fuseLabel() + "）。");
      syncPendingButtons();
    };
    recording = true;
    recordStartedAt = Date.now();
    mediaRecorder.start(100);
    btnRec.classList.add("is-recording");
    btnRec.setAttribute("aria-pressed", "true");
    btnRec.textContent = "录音中… 再点结束";
    setStatus("正在听你说… 说完再点一下结束。");
  }

  function stopStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  function stopRecording() {
    if (!recording || !mediaRecorder) return;
    recording = false;
    btnRec.classList.remove("is-recording");
    btnRec.setAttribute("aria-pressed", "false");
    btnRec.textContent = "点一下开始录音";
    try {
      if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
    } catch (_) {
      stopStream();
    }
  }

  function syncPendingButtons() {
    const has = !!pendingBlob;
    btnPreview.disabled = !has;
    btnDrop.disabled = !has;
  }

  btnRec.addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording();
  });

  btnPreview.addEventListener("click", async () => {
    if (!pendingBlob) return;
    if (previewPlaying && previewNodes) {
      previewNodes.stop();
      previewPlaying = false;
      previewNodes = null;
      btnPreview.textContent = "试听";
      setStatus("试听已停。");
      return;
    }
    btnPreview.textContent = "停止试听";
    setStatus("试听中（" + voiceLabel(voiceMode) + "）…");
    previewPlaying = true;
    try {
      previewNodes = await playWithVoice(pendingBlob, voiceMode, 0, () => {
        previewPlaying = false;
        previewNodes = null;
        btnPreview.textContent = "试听";
        setStatus("试听结束。可以丢进池里。");
      });
    } catch (e) {
      previewPlaying = false;
      btnPreview.textContent = "试听";
      setStatus("试听失败了，换个浏览器或再录一次。");
    }
  });

  function voiceLabel(v) {
    return ({ normal: "原声", low: "低沉", high: "尖细", echo: "回声" }[v] || v);
  }

  btnDrop.addEventListener("click", () => {
    if (!pendingBlob) return;
    if (previewPlaying && previewNodes) {
      previewNodes.stop();
      previewPlaying = false;
      previewNodes = null;
      btnPreview.textContent = "试听";
    }
    addBubble(pendingBlob, voiceMode);
    pendingBlob = null;
    if (pendingUrl) {
      URL.revokeObjectURL(pendingUrl);
      pendingUrl = null;
    }
    syncPendingButtons();
    setStatus("丢进池里了。点泡泡听，点「炸」炸掉。");
  });

  /* —— Bubbles —— */
  function uid() {
    return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addBubble(blob, voice) {
    const now = Date.now();
    const id = uid();
    const el = document.createElement("div");
    el.className = "pool-bubble";
    el.dataset.id = id;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "情绪泡泡，点听，炸按钮炸掉");

    const core = document.createElement("button");
    core.type = "button";
    core.className = "pool-bubble-core";
    core.setAttribute("aria-label", "播放或暂停这段录音");
    core.innerHTML =
      '<span class="pool-bubble-icon" aria-hidden="true">🫧</span>' +
      '<span class="pool-bubble-time"></span>';

    const boom = document.createElement("button");
    boom.type = "button";
    boom.className = "pool-bubble-boom";
    boom.setAttribute("aria-label", "炸掉这个泡泡");
    boom.textContent = "炸";

    el.appendChild(core);
    el.appendChild(boom);
    bubblesEl.appendChild(el);

    const tankW = tank.clientWidth || 300;
    const xPct = 12 + Math.random() * 66;

    const item = {
      id,
      blob,
      voice,
      createdAt: now,
      explodeAt: fuseExplodeAt(now),
      el,
      core,
      boom,
      timeEl: core.querySelector(".pool-bubble-time"),
      xPct,
      drift: (Math.random() - 0.5) * 0.02,
      playing: false,
      pauseOffset: 0,
      nodes: null,
      longTimer: null,
      longFired: false,
    };
    bubbles.set(id, item);

    // Tap/click core = play/pause; long-press = explode; 「炸」button = explode
    item.suppressClick = false;
    core.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      item.longFired = false;
      item.suppressClick = false;
      item.longTimer = setTimeout(() => {
        item.longFired = true;
        item.suppressClick = true;
        explodeBubble(id, true);
      }, LONG_PRESS_MS);
    });
    const clearLong = () => {
      if (item.longTimer) {
        clearTimeout(item.longTimer);
        item.longTimer = null;
      }
    };
    core.addEventListener("pointerup", clearLong);
    core.addEventListener("pointerleave", clearLong);
    core.addEventListener("pointercancel", clearLong);
    core.addEventListener("click", (e) => {
      e.preventDefault();
      if (item.suppressClick) {
        item.suppressClick = false;
        return;
      }
      togglePlay(item);
    });

    boom.addEventListener("click", (e) => {
      e.stopPropagation();
      clearLong();
      explodeBubble(id, true);
    });

    emptyEl.hidden = true;
    ensureLoop();
    updateBubbleVisual(item, 0);
  }

  async function togglePlay(item) {
    ensureCtx();
    if (item.playing && item.nodes) {
      item.pauseOffset = item.nodes.getOffset();
      item.nodes.stop();
      item.nodes = null;
      item.playing = false;
      item.el.classList.remove("is-playing");
      setStatus("已暂停。再点泡泡继续听，或点「炸」丢掉。");
      return;
    }
    // stop other playing bubbles
    bubbles.forEach((b) => {
      if (b !== item && b.playing && b.nodes) {
        b.pauseOffset = b.nodes.getOffset();
        b.nodes.stop();
        b.nodes = null;
        b.playing = false;
        b.el.classList.remove("is-playing");
      }
    });
    try {
      item.playing = true;
      item.el.classList.add("is-playing");
      setStatus("在听（" + voiceLabel(item.voice) + "）… 再点暂停 · 「炸」丢掉");
      item.nodes = await playWithVoice(item.blob, item.voice, item.pauseOffset, () => {
        item.playing = false;
        item.pauseOffset = 0;
        item.nodes = null;
        item.el.classList.remove("is-playing");
        setStatus("听完了。可以再点重播，或点「炸」。");
      });
      if (!item.nodes) {
        item.playing = false;
        item.el.classList.remove("is-playing");
      }
    } catch (err) {
      item.playing = false;
      item.el.classList.remove("is-playing");
      setStatus("播放失败了。");
    }
  }

  function formatRemain(ms) {
    if (ms <= 0) return "要炸了";
    if (ms < 60000) return Math.ceil(ms / 1000) + "s";
    const m = Math.floor(ms / 60000);
    const s = Math.ceil((ms % 60000) / 1000);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return h + "h" + (m % 60) + "m";
    }
    return m + ":" + String(s).padStart(2, "0");
  }

  function progressOf(item, now) {
    const total = Math.max(1, item.explodeAt - item.createdAt);
    return Math.min(1, Math.max(0, (now - item.createdAt) / total));
  }

  function updateBubbleVisual(item, now) {
    const p = progressOf(item, now || Date.now());
    const size = MIN_SIZE + p * (MAX_SIZE - MIN_SIZE);
    // rise: bottom 12% → top 8% of tank (Y as % from top)
    const yPct = 78 - p * 62;
    const x = item.xPct + Math.sin((now || Date.now()) / 900 + item.xPct) * 3;
    item.el.style.width = size + "px";
    item.el.style.height = size + "px";
    item.el.style.left = x + "%";
    item.el.style.top = yPct + "%";
    item.el.style.setProperty("--p", String(p));
    const remain = item.explodeAt - (now || Date.now());
    item.timeEl.textContent = formatRemain(remain);
    if (p > 0.75) item.el.classList.add("is-hot");
    else item.el.classList.remove("is-hot");
  }

  function explodeBubble(id, manual) {
    const item = bubbles.get(id);
    if (!item || item._exploding) return;
    item._exploding = true;
    if (item.longTimer) clearTimeout(item.longTimer);
    if (item.playing && item.nodes) {
      item.nodes.stop();
      item.nodes = null;
      item.playing = false;
    }
    const rect = item.el.getBoundingClientRect();
    const tankRect = tank.getBoundingClientRect();
    const cx = rect.left + rect.width / 2 - tankRect.left;
    const cy = rect.top + rect.height / 2 - tankRect.top;
    spawnBurst(cx, cy, item.el.classList.contains("is-hot"));
    playWhooshSoft();
    item.el.classList.add("is-exploding");
    setTimeout(() => {
      item.el.remove();
      bubbles.delete(id);
      if (!bubbles.size) emptyEl.hidden = false;
    }, reducedMotion ? 80 : 420);
    setStatus(manual ? "炸掉了。气散一点就好。" : "引信到了，泡泡自己炸开了。");
  }

  /* —— FX canvas particles —— */
  function resizeFx() {
    const dpr = window.devicePixelRatio || 1;
    const w = tank.clientWidth;
    const h = tank.clientHeight;
    fxCanvas.width = Math.floor(w * dpr);
    fxCanvas.height = Math.floor(h * dpr);
    fxCanvas.style.width = w + "px";
    fxCanvas.style.height = h + "px";
    const ctx = fxCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnBurst(x, y, hot) {
    resizeFx();
    const colors = hot
      ? ["#ff3d7f", "#ffe566", "#ff8fab", "#5ce1e6"]
      : ["#5ce1e6", "#c4a8ff", "#ffe566", "#ff3d7f"];
    const n = reducedMotion ? 8 : 22;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = 1.5 + Math.random() * 4.5;
      fxParticles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1,
        life: 1,
        color: colors[i % colors.length],
        r: 2 + Math.random() * 4,
      });
    }
  }

  function drawFx() {
    const ctx = fxCanvas.getContext("2d");
    if (!ctx) return;
    const w = tank.clientWidth;
    const h = tank.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p = fxParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life -= reducedMotion ? 0.08 : 0.025;
      if (p.life <= 0) {
        fxParticles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function ensureLoop() {
    if (rafId) return;
    const tick = () => {
      const now = Date.now();
      bubbles.forEach((item) => {
        if (item._exploding) return;
        updateBubbleVisual(item, now);
        if (now >= item.explodeAt) explodeBubble(item.id, false);
      });
      if (fxParticles.length) drawFx();
      if (bubbles.size || fxParticles.length) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
        const ctx = fxCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, tank.clientWidth, tank.clientHeight);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => {
    if (bubbles.size || fxParticles.length) resizeFx();
  });

  syncPendingButtons();
})();
