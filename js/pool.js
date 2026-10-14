/**
 * 出气口 · 情绪池
 * WeChat-style hold-to-talk + comedy voice bubbles.
 * Local-only; in-memory (refresh clears); never uploaded.
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
  const wxHud = document.getElementById("wxRecHud");
  const wxTip = document.getElementById("wxRecTip");
  const wxTime = document.getElementById("wxRecTime");
  const wxHoldLabel = document.getElementById("wxHoldLabel");
  const wxRec = document.getElementById("wxRec");
  if (!tank || !btnRec) return;

  /* Comedy gag presets — obvious, not studio-subtle */
  const VOICE_PRESETS = {
    normal: { label: "原声", rate: 1, detune: 0, filter: null, echo: false, tremolo: 0 },
    m2f: { label: "男变女", rate: 1.62, detune: 280, filter: "bright", echo: false, tremolo: 0 },
    f2m: { label: "女变男", rate: 0.62, detune: -220, filter: "dark", echo: false, tremolo: 0 },
    helium: { label: "卡通娃娃", rate: 1.92, detune: 420, filter: "helium", echo: false, tremolo: 0 },
    monster: { label: "大叔怪兽", rate: 0.48, detune: -380, filter: "monster", echo: false, tremolo: 0 },
    robot: { label: "电音颤音", rate: 1.08, detune: 60, filter: "robot", echo: false, tremolo: 14 },
    echo: { label: "回声搞笑", rate: 1.1, detune: 40, filter: null, echo: true, tremolo: 0 },
  };

  const MIN_SIZE = 52;
  const MAX_SIZE = 118;
  const LONG_PRESS_MS = 650;
  const MIN_SEND_MS = 700;
  const MAX_REC_MS = 60000;
  const CANCEL_SLIDE_PX = 56;

  let fuseMode = "day";
  let voiceMode = "normal";
  let recording = false;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordChunks = [];
  let recordStartedAt = 0;
  let pendingBlob = null;
  let lastBlob = null;
  let previewNodes = null;
  let previewPlaying = false;

  /* Live capture graph */
  let capCtx = null;
  let capSource = null;
  let capGain = null;
  let capComp = null;
  let capDest = null;
  let capAnalyser = null;
  let meterRaf = 0;

  /* Hold-to-talk gesture */
  let holdPointerId = null;
  let holdStartY = 0;
  let cancelArmed = false;
  let recTimerInterval = 0;
  let maxRecTimer = 0;
  let finishing = false;

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

  function voiceLabel(v) {
    return (VOICE_PRESETS[v] && VOICE_PRESETS[v].label) || v;
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

  function formatClock(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }

  /* —— Chips —— */
  document.querySelectorAll(".emotion-pool [data-fuse]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".emotion-pool [data-fuse]").forEach((b) => {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      fuseMode = btn.getAttribute("data-fuse");
      setStatus("引信：" + fuseLabel() + "。按住说话，松手丢进池。");
    });
  });

  document.querySelectorAll(".emotion-pool [data-voice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".emotion-pool [data-voice]").forEach((b) => {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      voiceMode = btn.getAttribute("data-voice");
      setStatus("变声：「" + voiceLabel(voiceMode) + "」— 很夸张，试听或丢进池后点泡泡听。");
    });
  });

  /* —— Audio ctx —— */
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
      if (nodes.lfo) nodes.lfo.stop();
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

  function applyFilter(ctx, filterKind) {
    if (!filterKind) return null;
    const f = ctx.createBiquadFilter();
    if (filterKind === "bright") {
      f.type = "highshelf";
      f.frequency.value = 1800;
      f.gain.value = 10;
    } else if (filterKind === "dark") {
      f.type = "lowshelf";
      f.frequency.value = 320;
      f.gain.value = 9;
    } else if (filterKind === "helium") {
      f.type = "highpass";
      f.frequency.value = 420;
      f.Q.value = 0.7;
    } else if (filterKind === "monster") {
      f.type = "lowpass";
      f.frequency.value = 480;
      f.Q.value = 0.9;
    } else if (filterKind === "robot") {
      f.type = "bandpass";
      f.frequency.value = 1100;
      f.Q.value = 4.5;
    }
    return f;
  }

  /**
   * Play with gag voice. Returns { stop, getOffset }.
   */
  async function playWithVoice(blob, voice, offsetSec, onEnded) {
    const ctx = ensureCtx();
    if (!ctx || !blob) return null;
    const ab = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    const preset = VOICE_PRESETS[voice] || VOICE_PRESETS.normal;
    const rate = preset.rate;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    try {
      source.detune.value = preset.detune || 0;
    } catch (_) {}

    const extras = [];
    const master = ctx.createGain();
    master.gain.value = 1;
    extras.push(master);

    let node = source;
    const filt = applyFilter(ctx, preset.filter);
    if (filt) {
      extras.push(filt);
      node.connect(filt);
      node = filt;
    }

    let lfo = null;
    if (preset.tremolo > 0) {
      const tremolo = ctx.createGain();
      tremolo.gain.value = 0.55;
      extras.push(tremolo);
      lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = preset.tremolo;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.45;
      extras.push(lfoDepth);
      lfo.connect(lfoDepth);
      lfoDepth.connect(tremolo.gain);
      node.connect(tremolo);
      node = tremolo;
      lfo.start();
    }

    if (preset.echo) {
      const dry = ctx.createGain();
      dry.gain.value = 0.75;
      const delay = ctx.createDelay(1.2);
      delay.delayTime.value = 0.28;
      const fb = ctx.createGain();
      fb.gain.value = 0.48;
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      const delay2 = ctx.createDelay(1.2);
      delay2.delayTime.value = 0.52;
      const wet2 = ctx.createGain();
      wet2.gain.value = 0.4;
      extras.push(dry, delay, fb, wet, delay2, wet2);
      node.connect(dry);
      dry.connect(master);
      node.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(master);
      node.connect(delay2);
      delay2.connect(wet2);
      wet2.connect(master);
    } else {
      node.connect(master);
    }
    master.connect(ctx.destination);

    const startAt = ctx.currentTime;
    const off = Math.max(0, Math.min(offsetSec || 0, Math.max(0, buffer.duration - 0.02)));
    source.start(0, off);
    let stopped = false;
    const durationAtRate = (buffer.duration - off) / rate;
    const endWatch = setTimeout(() => {
      if (!stopped && typeof onEnded === "function") {
        stopped = true;
        onEnded();
      }
    }, durationAtRate * 1000 + 80);

    source.onended = () => {
      clearTimeout(endWatch);
      if (stopped) return;
      stopped = true;
      if (typeof onEnded === "function") onEnded();
    };

    return {
      source,
      lfo,
      extras,
      buffer,
      rate,
      startAt,
      offset: off,
      stop() {
        if (stopped) return;
        stopped = true;
        clearTimeout(endWatch);
        stopGraph({ source, lfo, extras });
      },
      getOffset() {
        const elapsed = (ctx.currentTime - startAt) * rate;
        return Math.min(buffer.duration, off + elapsed);
      },
    };
  }

  /* —— Capture quality: opus + bitrate + live gain/compressor —— */
  function pickMime() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm;codecs=opus,pcm",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    for (const t of types) {
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
      } catch (_) {}
    }
    return "";
  }

  function teardownCaptureGraph() {
    if (meterRaf) {
      cancelAnimationFrame(meterRaf);
      meterRaf = 0;
    }
    try {
      if (capSource) capSource.disconnect();
    } catch (_) {}
    try {
      if (capGain) capGain.disconnect();
    } catch (_) {}
    try {
      if (capComp) capComp.disconnect();
    } catch (_) {}
    try {
      if (capAnalyser) capAnalyser.disconnect();
    } catch (_) {}
    capSource = capGain = capComp = capDest = capAnalyser = null;
  }

  function buildCaptureGraph(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return stream;
    capCtx = capCtx || ensureCtx() || new AC();
    if (capCtx.state === "suspended") capCtx.resume();
    capSource = capCtx.createMediaStreamSource(stream);
    capGain = capCtx.createGain();
    capGain.gain.value = 1.65;
    capComp = capCtx.createDynamicsCompressor();
    capComp.threshold.value = -28;
    capComp.knee.value = 18;
    capComp.ratio.value = 10;
    capComp.attack.value = 0.003;
    capComp.release.value = 0.18;
    capAnalyser = capCtx.createAnalyser();
    capAnalyser.fftSize = 256;
    capDest = capCtx.createMediaStreamDestination();
    capSource.connect(capGain);
    capGain.connect(capComp);
    capComp.connect(capAnalyser);
    capAnalyser.connect(capDest);
    return capDest.stream;
  }

  function pulseMeter() {
    if (!capAnalyser || !recording) return;
    const data = new Uint8Array(capAnalyser.frequencyBinCount);
    capAnalyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length / 255;
    const bars = wxRec ? wxRec.querySelectorAll(".wx-bar") : [];
    bars.forEach((bar, i) => {
      const h = 20 + avg * 70 * (0.5 + ((i * 17) % 10) / 10);
      bar.style.height = Math.min(100, h) + "%";
      bar.classList.toggle("is-loud", avg > 0.28);
    });
    meterRaf = requestAnimationFrame(pulseMeter);
  }

  /** Peak-normalize decoded audio and re-wrap as 16-bit mono WAV for louder clear playback */
  async function normalizeToWavBlob(blob) {
    const ctx = ensureCtx();
    if (!ctx) return blob;
    let buffer;
    try {
      buffer = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    } catch (_) {
      return blob;
    }
    const len = buffer.length;
    const ch = buffer.numberOfChannels;
    const mixed = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mixed[i] += d[i] / ch;
    }
    let peak = 0.0001;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mixed[i]));
    const gain = Math.min(3.8, 0.9 / peak);
    const sr = buffer.sampleRate;
    const out = new ArrayBuffer(44 + len * 2);
    const v = new DataView(out);
    const wstr = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    wstr(0, "RIFF");
    v.setUint32(4, 36 + len * 2, true);
    wstr(8, "WAVE");
    wstr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    wstr(36, "data");
    v.setUint32(40, len * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      let s = Math.max(-1, Math.min(1, mixed[i] * gain));
      v.setInt16(o, (s * 32767) | 0, true);
      o += 2;
    }
    return new Blob([out], { type: "audio/wav" });
  }

  async function startRecordingFromGesture() {
    if (recording || finishing) return false;
    ensureCtx();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("这台设备不支持录音。");
      return false;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    } catch (err) {
      setStatus("没拿到麦克风权限。去系统设置开一下再试。");
      return false;
    }

    const processed = buildCaptureGraph(mediaStream);
    recordChunks = [];
    const mime = pickMime();
    const recOpts = { audioBitsPerSecond: 192000 };
    if (mime) recOpts.mimeType = mime;
    try {
      mediaRecorder = new MediaRecorder(processed, recOpts);
    } catch (_) {
      try {
        mediaRecorder = mime
          ? new MediaRecorder(processed, { mimeType: mime, audioBitsPerSecond: 128000 })
          : new MediaRecorder(processed, { audioBitsPerSecond: 128000 });
      } catch (err2) {
        try {
          mediaRecorder = new MediaRecorder(processed);
        } catch (err3) {
          setStatus("没法启动录音机。换个浏览器试试？");
          stopMicTracks();
          teardownCaptureGraph();
          return false;
        }
      }
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordChunks.push(e.data);
    };

    recording = true;
    recordStartedAt = Date.now();
    cancelArmed = false;
    mediaRecorder.start(50);
    pulseMeter();
    return true;
  }

  function stopMicTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  function showHud(show) {
    if (!wxHud) return;
    wxHud.hidden = !show;
  }

  function setCancelUi(on) {
    cancelArmed = on;
    if (wxRec) wxRec.classList.toggle("is-cancel", on);
    if (btnRec) btnRec.classList.toggle("is-cancel", on);
    if (wxTip) wxTip.textContent = on ? "松开 取消" : "松开发送";
    if (wxHoldLabel) wxHoldLabel.textContent = on ? "松开 取消" : "松开发送";
  }

  function updateRecClock() {
    if (!recording) return;
    const ms = Date.now() - recordStartedAt;
    if (wxTime) wxTime.textContent = formatClock(ms);
    if (ms >= MAX_REC_MS - 50) {
      // soft max — finish as send
      finishHold(false, true);
    }
  }

  async function finalizeChunks(discard) {
    teardownCaptureGraph();
    stopMicTracks();
    const mime = (mediaRecorder && mediaRecorder.mimeType) || pickMime() || "audio/webm";
    mediaRecorder = null;
    if (discard || !recordChunks.length) {
      recordChunks = [];
      return null;
    }
    let blob = new Blob(recordChunks, { type: mime });
    recordChunks = [];
    try {
      blob = await normalizeToWavBlob(blob);
    } catch (_) {}
    return blob;
  }

  function waitRecorderStop(rec) {
    return new Promise((resolve) => {
      if (!rec || rec.state === "inactive") {
        resolve();
        return;
      }
      const prev = rec.onstop;
      rec.onstop = () => {
        if (typeof prev === "function") prev();
        resolve();
      };
      try {
        rec.stop();
      } catch (_) {
        resolve();
      }
    });
  }

  async function finishHold(cancelled, fromMax) {
    if (!recording || finishing) return;
    finishing = true;
    recording = false;
    if (recTimerInterval) {
      clearInterval(recTimerInterval);
      recTimerInterval = 0;
    }
    if (maxRecTimer) {
      clearTimeout(maxRecTimer);
      maxRecTimer = 0;
    }

    const elapsed = Date.now() - recordStartedAt;
    const tooShort = !cancelled && elapsed < MIN_SEND_MS;
    const discard = cancelled || tooShort;

    showHud(false);
    setCancelUi(false);
    if (wxRec) wxRec.classList.remove("is-holding");
    if (btnRec) btnRec.classList.remove("is-holding");
    if (wxHoldLabel) wxHoldLabel.textContent = "按住 说话";
    holdPointerId = null;

    const rec = mediaRecorder;
    await waitRecorderStop(rec);
    const blob = await finalizeChunks(discard);
    finishing = false;

    if (cancelled) {
      setStatus("已取消。再按住说一次吧。");
      return;
    }
    if (tooShort) {
      setStatus("说话时间太短。按住多说一会儿再松手。");
      return;
    }
    if (!blob) {
      setStatus("好像没录到声音。再按住试一次。");
      return;
    }

    lastBlob = blob;
    pendingBlob = blob;
    syncPendingButtons();

    // WeChat-like: release = send into pool
    addBubble(blob, voiceMode);
    setStatus(
      (fromMax ? "满 60 秒了，已帮你丢进池。" : "已丢进池。") +
        "点泡泡听「" +
        voiceLabel(voiceMode) +
        "」· 点「炸」丢掉。"
    );
  }

  /* —— WeChat hold gesture (touch + mouse) —— */
  function onHoldStart(e) {
    if (finishing || recording) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    ensureCtx();
    holdPointerId = e.pointerId;
    holdStartY = e.clientY;
    cancelArmed = false;
    try {
      btnRec.setPointerCapture(e.pointerId);
    } catch (_) {}

    (async () => {
      const ok = await startRecordingFromGesture();
      if (!ok) {
        holdPointerId = null;
        try {
          btnRec.releasePointerCapture(e.pointerId);
        } catch (_) {}
        return;
      }
      // If finger already released while awaiting permission
      if (holdPointerId !== e.pointerId) {
        await finishHold(true, false);
        return;
      }
      if (wxRec) wxRec.classList.add("is-holding");
      if (btnRec) btnRec.classList.add("is-holding");
      showHud(true);
      setCancelUi(false);
      if (wxHoldLabel) wxHoldLabel.textContent = "松开发送";
      if (wxTime) wxTime.textContent = "0:00";
      setStatus("正在录音… 上滑可取消");
      recTimerInterval = setInterval(updateRecClock, 200);
      maxRecTimer = setTimeout(() => {}, MAX_REC_MS); // clock handles max
    })();
  }

  function onHoldMove(e) {
    if (!recording || holdPointerId !== e.pointerId) return;
    const dy = holdStartY - e.clientY;
    setCancelUi(dy >= CANCEL_SLIDE_PX);
  }

  function onHoldEnd(e) {
    if (holdPointerId !== e.pointerId && holdPointerId != null) return;
    // permission pending: mark cancelled
    if (!recording && holdPointerId === e.pointerId) {
      holdPointerId = null;
      return;
    }
    if (!recording) return;
    const cancelled = cancelArmed;
    finishHold(cancelled, false);
    try {
      btnRec.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  btnRec.addEventListener("pointerdown", onHoldStart);
  btnRec.addEventListener("pointermove", onHoldMove);
  btnRec.addEventListener("pointerup", onHoldEnd);
  btnRec.addEventListener("pointercancel", (e) => {
    if (recording && holdPointerId === e.pointerId) finishHold(true, false);
    holdPointerId = null;
  });
  // Prevent context menu / scroll hijack on the hold button
  btnRec.addEventListener("contextmenu", (e) => e.preventDefault());

  function syncPendingButtons() {
    const has = !!(pendingBlob || lastBlob);
    btnPreview.disabled = !has;
    btnDrop.disabled = !has;
  }

  btnPreview.addEventListener("click", async () => {
    const blob = pendingBlob || lastBlob;
    if (!blob) return;
    if (previewPlaying && previewNodes) {
      previewNodes.stop();
      previewPlaying = false;
      previewNodes = null;
      btnPreview.textContent = "试听变声";
      setStatus("试听已停。");
      return;
    }
    btnPreview.textContent = "停止试听";
    setStatus("试听「" + voiceLabel(voiceMode) + "」中…");
    previewPlaying = true;
    try {
      previewNodes = await playWithVoice(blob, voiceMode, 0, () => {
        previewPlaying = false;
        previewNodes = null;
        btnPreview.textContent = "试听变声";
        setStatus("试听结束。可再丢一颗，或按住再说一段。");
      });
    } catch (_) {
      previewPlaying = false;
      btnPreview.textContent = "试听变声";
      setStatus("试听失败了。");
    }
  });

  btnDrop.addEventListener("click", () => {
    const blob = pendingBlob || lastBlob;
    if (!blob) return;
    if (previewPlaying && previewNodes) {
      previewNodes.stop();
      previewPlaying = false;
      previewNodes = null;
      btnPreview.textContent = "试听变声";
    }
    addBubble(blob, voiceMode);
    setStatus("又丢了一颗（" + voiceLabel(voiceMode) + "）。点泡泡听。");
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
      '<span class="pool-bubble-voice">' +
      voiceLabel(voice) +
      "</span>" +
      '<span class="pool-bubble-time"></span>';

    const boom = document.createElement("button");
    boom.type = "button";
    boom.className = "pool-bubble-boom";
    boom.setAttribute("aria-label", "炸掉这个泡泡");
    boom.textContent = "炸";

    el.appendChild(core);
    el.appendChild(boom);
    bubblesEl.appendChild(el);

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
      baseXPct: pickBaseXPct(),
      xPct: 50,
      yPct: 78,
      phase: Math.random() * Math.PI * 2,
      size: MIN_SIZE,
      playing: false,
      pauseOffset: 0,
      nodes: null,
      longTimer: null,
      longFired: false,
      suppressClick: false,
    };
    item.xPct = item.baseXPct;
    bubbles.set(id, item);

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
      setStatus("已暂停。再点继续听，或点「炸」。");
      return;
    }
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
      setStatus("在听「" + voiceLabel(item.voice) + "」…");
      item.nodes = await playWithVoice(item.blob, item.voice, item.pauseOffset, () => {
        item.playing = false;
        item.pauseOffset = 0;
        item.nodes = null;
        item.el.classList.remove("is-playing");
        setStatus("听完了。可再点重播，或点「炸」。");
      });
      if (!item.nodes) {
        item.playing = false;
        item.el.classList.remove("is-playing");
      }
    } catch (_) {
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

  function pickBaseXPct() {
    const slots = [16, 32, 48, 64, 80];
    let best = slots[bubbles.size % slots.length];
    let bestScore = -1;
    const existing = [];
    bubbles.forEach((b) => {
      if (!b._exploding) existing.push(b.xPct != null ? b.xPct : b.baseXPct);
    });
    slots.forEach((s) => {
      let minD = 100;
      existing.forEach((x) => {
        minD = Math.min(minD, Math.abs(s - x));
      });
      if (!existing.length) minD = 100;
      if (minD > bestScore) {
        bestScore = minD;
        best = s;
      }
    });
    return best + (Math.random() * 4 - 2);
  }

  function applyBubbleStyle(item, now) {
    const p = progressOf(item, now);
    item.el.style.width = item.size + "px";
    item.el.style.height = item.size + "px";
    item.el.style.left = item.xPct + "%";
    item.el.style.top = item.yPct + "%";
    item.timeEl.textContent = formatRemain(item.explodeAt - now);
    item.el.classList.toggle("is-hot", p > 0.75);
  }

  /** Ideal rise path, then separate overlapping bubbles in tank space */
  function layoutBubbles(now) {
    const tw = Math.max(1, tank.clientWidth);
    const th = Math.max(1, tank.clientHeight);
    const list = [];
    bubbles.forEach((item) => {
      if (item._exploding) return;
      const p = progressOf(item, now);
      const size = MIN_SIZE + p * (MAX_SIZE - MIN_SIZE);
      const idealY = 78 - p * 62;
      const idealX = item.baseXPct + Math.sin(now / 1400 + item.phase) * 2.2;
      item.size = size;
      if (item.xPct == null) item.xPct = idealX;
      if (item.yPct == null) item.yPct = idealY;
      item.xPct += (idealX - item.xPct) * 0.1;
      item.yPct += (idealY - item.yPct) * 0.14;
      list.push(item);
    });

    const pad = 12;
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const ax = (a.xPct / 100) * tw;
          const ay = (a.yPct / 100) * th;
          const bx = (b.xPct / 100) * tw;
          const by = (b.yPct / 100) * th;
          let dx = bx - ax;
          let dy = by - ay;
          let dist = Math.hypot(dx, dy);
          const minDist = (a.size + b.size) / 2 + pad;
          if (dist >= minDist) continue;
          if (dist < 0.001) {
            dx = (i + 1) * 0.7;
            dy = (j + 1) * 0.3;
            dist = Math.hypot(dx, dy);
          }
          const push = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          // Prefer horizontal separation so rise motion stays readable
          const sx = ((nx * push * 0.9) / tw) * 100;
          const sy = ((ny * push * 0.35) / th) * 100;
          a.xPct -= sx;
          a.yPct -= sy;
          b.xPct += sx;
          b.yPct += sy;
        }
      }
    }

    list.forEach((item) => {
      const halfX = ((item.size / 2) / tw) * 100;
      const halfY = ((item.size / 2) / th) * 100;
      item.xPct = Math.max(halfX + 1, Math.min(100 - halfX - 1, item.xPct));
      item.yPct = Math.max(halfY + 4, Math.min(90 - halfY, item.yPct));
      applyBubbleStyle(item, now);
    });
  }

  function updateBubbleVisual(item, now) {
    layoutBubbles(now || Date.now());
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
    spawnBurst(rect.left + rect.width / 2 - tankRect.left, rect.top + rect.height / 2 - tankRect.top, item.el.classList.contains("is-hot"));
    playWhooshSoft();
    item.el.classList.add("is-exploding");
    setTimeout(
      () => {
        item.el.remove();
        bubbles.delete(id);
        if (!bubbles.size) emptyEl.hidden = false;
      },
      reducedMotion ? 80 : 420
    );
    setStatus(manual ? "炸掉了。气散一点就好。" : "引信到了，泡泡自己炸开了。");
  }

  function resizeFx() {
    const dpr = window.devicePixelRatio || 1;
    const w = tank.clientWidth;
    const h = tank.clientHeight;
    fxCanvas.width = Math.floor(w * dpr);
    fxCanvas.height = Math.floor(h * dpr);
    fxCanvas.style.width = w + "px";
    fxCanvas.style.height = h + "px";
    fxCanvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
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
      layoutBubbles(now);
      bubbles.forEach((item) => {
        if (item._exploding) return;
        if (now >= item.explodeAt) explodeBubble(item.id, false);
      });
      if (fxParticles.length) drawFx();
      if (bubbles.size || fxParticles.length) rafId = requestAnimationFrame(tick);
      else {
        rafId = 0;
        const ctx = fxCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, tank.clientWidth, tank.clientHeight);
      }
    };
    rafId = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => {
    if (bubbles.size || fxParticles.length) {
      resizeFx();
      if (bubbles.size) layoutBubbles(Date.now());
    }
  });

  syncPendingButtons();
})();
