/**
 * 出气口 — mood journal, calm kit, prompt helpers (local-only)
 */
(function () {
  "use strict";

  const JOURNAL_KEY = "chuqikou-journal-v1";
  const EXTRA_PROMPTS = [
    "如果情绪是一种天气，此刻窗外在下……",
    "我想允许自己今天不完美，因为……",
    "那句最伤人的话，其实我想回的是……",
    "我渴望被看见的一小部分是……",
    "把愤怒翻译成需要：我真正需要的是……",
    "假如朋友遇到同样的事，我会温柔地告诉他……",
  ];

  function loadJournal() {
    try {
      return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]") || [];
    } catch (_) {
      return [];
    }
  }

  function saveJournal(list) {
    try {
      localStorage.setItem(JOURNAL_KEY, JSON.stringify(list.slice(0, 80)));
    } catch (_) {}
  }

  function addEntry(entry) {
    const list = loadJournal();
    list.unshift(entry);
    saveJournal(list);
    return list;
  }

  function clearJournal() {
    saveJournal([]);
  }

  /* —— UI wiring —— */
  const journalList = document.getElementById("journalList");
  const moodChart = document.getElementById("moodChart");
  const moodChartHint = document.getElementById("moodChartHint");
  const mood = document.getElementById("mood");
  const moodValue = document.getElementById("moodValue");
  const btnClearJournal = document.getElementById("btnClearJournal");
  const promptRow = document.getElementById("promptRow");

  function renderJournal() {
    if (!journalList) return;
    const list = loadJournal();
    journalList.innerHTML = "";
    if (!list.length) {
      journalList.innerHTML = '<li class="journal-empty">还没有记录。完成一次「写完就散」或语音发泄后可留下轨迹。</li>';
      drawChart([]);
      if (moodChartHint) moodChartHint.textContent = "本地记录，不上云。写完毁掉后可自动记一笔。";
      return;
    }
    list.slice(0, 12).forEach((e) => {
      const li = document.createElement("li");
      const when = new Date(e.ts);
      const time =
        when.getMonth() +
        1 +
        "/" +
        when.getDate() +
        " " +
        String(when.getHours()).padStart(2, "0") +
        ":" +
        String(when.getMinutes()).padStart(2, "0");
      const tags = (e.tags || []).join(" · ") || "未标记";
      li.innerHTML =
        '<span class="j-time">' +
        time +
        '</span><span class="j-mood">强度 ' +
        (e.mood != null ? e.mood : "—") +
        '</span><span class="j-tags">' +
        tags +
        "</span>" +
        (e.note
          ? '<span class="j-note">' + escapeHtml(e.note) + "</span>"
          : "");
      journalList.appendChild(li);
    });
    drawChart(list);
    if (moodChartHint) {
      const avg =
        list.slice(0, 7).reduce((s, e) => s + (Number(e.mood) || 0), 0) /
        Math.min(7, list.length);
      moodChartHint.textContent =
        "近 " + Math.min(7, list.length) + " 次平均强度 " + avg.toFixed(1) + " · 仅本机";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function drawChart(list) {
    if (!moodChart) return;
    const ctx = moodChart.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = moodChart.clientWidth || 400;
    const cssH = 90;
    moodChart.width = Math.floor(cssW * dpr);
    moodChart.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const pts = list
      .slice(0, 14)
      .map((e) => Number(e.mood))
      .filter((n) => !isNaN(n))
      .reverse();
    ctx.strokeStyle = "rgba(92,225,230,0.25)";
    ctx.beginPath();
    ctx.moveTo(8, cssH - 12);
    ctx.lineTo(cssW - 8, cssH - 12);
    ctx.stroke();
    if (pts.length < 1) return;
    const pad = 12;
    const w = cssW - pad * 2;
    const h = cssH - pad * 2;
    ctx.beginPath();
    ctx.strokeStyle = "#5ce1e6";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(92,225,230,0.4)";
    ctx.shadowBlur = 6;
    pts.forEach((v, i) => {
      const x = pad + (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w);
      const y = pad + h - (Math.max(0, Math.min(10, v)) / 10) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    pts.forEach((v, i) => {
      const x = pad + (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w);
      const y = pad + h - (Math.max(0, Math.min(10, v)) / 10) * h;
      ctx.fillStyle = "#ff3d7f";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (mood && moodValue) {
    mood.addEventListener("input", () => {
      moodValue.textContent = mood.value;
    });
  }

  if (btnClearJournal) {
    btnClearJournal.addEventListener("click", () => {
      if (!confirm("清空本机心情日记？不可恢复。")) return;
      clearJournal();
      renderJournal();
    });
  }

  if (promptRow) {
    promptRow.addEventListener("click", (e) => {
      const chip = e.target.closest(".prompt-chip");
      if (!chip) return;
      const ventText = document.getElementById("ventText");
      if (!ventText) return;
      if (chip.textContent.trim() === "换一张") {
        const p = EXTRA_PROMPTS[(Math.random() * EXTRA_PROMPTS.length) | 0];
        ventText.value = p;
      } else {
        ventText.value = chip.getAttribute("data-prompt") || chip.textContent;
      }
      ventText.dispatchEvent(new Event("input"));
      ventText.focus();
    });
  }

  /* —— Calm kit audio —— */
  let calmCtx = null;
  let calmNodes = null;
  let walkTimer = null;
  let walkEnds = 0;

  function ensureCalmCtx() {
    if (window.Vent && Vent.ensureAudio) return Vent.ensureAudio();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!calmCtx) calmCtx = new AC();
    if (calmCtx.state === "suspended") calmCtx.resume();
    return calmCtx;
  }

  function stopSoundscape() {
    if (calmNodes) {
      try {
        calmNodes.stop();
      } catch (_) {}
      calmNodes = null;
    }
    document.querySelectorAll(".calm-tile.is-on").forEach((t) => {
      t.classList.remove("is-on");
      t.setAttribute("aria-pressed", "false");
    });
  }

  function startNoise(kind) {
    const ctx = ensureCalmCtx();
    if (!ctx) return;
    stopSoundscape();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    gain.gain.value = kind === "rain" ? 0.12 : 0.08;
    if (kind === "rain") {
      filter.type = "bandpass";
      filter.frequency.value = 1200;
      filter.Q.value = 0.6;
    } else {
      filter.type = "lowpass";
      filter.frequency.value = 800;
    }
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    calmNodes = {
      stop() {
        try {
          src.stop();
          src.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch (_) {}
      },
    };
  }

  function setCalmStatus(msg) {
    const el = document.getElementById("calmStatus");
    if (el) el.textContent = msg;
  }

  function startWalk(minutes) {
    const bar = document.getElementById("walkBar");
    const fill = document.getElementById("walkFill");
    const label = document.getElementById("walkLabel");
    if (!bar) return;
    if (walkTimer) clearInterval(walkTimer);
    walkEnds = Date.now() + minutes * 60 * 1000;
    bar.hidden = false;
    setCalmStatus("走走计时 " + minutes + " 分钟。不必快，走一走就好。");
    const total = minutes * 60 * 1000;
    walkTimer = setInterval(() => {
      const left = Math.max(0, walkEnds - Date.now());
      const done = 1 - left / total;
      if (fill) fill.style.width = done * 100 + "%";
      const s = Math.ceil(left / 1000);
      if (label)
        label.textContent =
          Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      if (left <= 0) {
        clearInterval(walkTimer);
        walkTimer = null;
        setCalmStatus("时间到了。回来喝口水吧。");
        if (window.Vent && Vent.vibrate) Vent.vibrate([20, 40, 20]);
      }
    }, 250);
  }

  const btnRain = document.getElementById("btnRain");
  const btnNoise = document.getElementById("btnNoise");
  const btnWalk5 = document.getElementById("btnWalk5");
  const btnWalk10 = document.getElementById("btnWalk10");
  const btnGuide60 = document.getElementById("btnGuide60");
  const btnStopCalm = document.getElementById("btnStopCalm");

  if (btnRain) {
    btnRain.addEventListener("click", () => {
      startNoise("rain");
      btnRain.classList.add("is-on");
      btnRain.setAttribute("aria-pressed", "true");
      setCalmStatus("雨声开着。再点「停止声景」可关掉。");
    });
  }
  if (btnNoise) {
    btnNoise.addEventListener("click", () => {
      startNoise("white");
      btnNoise.classList.add("is-on");
      btnNoise.setAttribute("aria-pressed", "true");
      setCalmStatus("白噪开着。");
    });
  }
  if (btnWalk5) btnWalk5.addEventListener("click", () => startWalk(5));
  if (btnWalk10) btnWalk10.addEventListener("click", () => startWalk(10));
  if (btnGuide60) {
    btnGuide60.addEventListener("click", () => {
      if (window.Vent && typeof Vent.startBreathe === "function") {
        Vent.startBreathe(60);
        setCalmStatus("60 秒呼吸引导已开始。");
      } else {
        setCalmStatus("请稍候，呼吸模块加载中。");
      }
    });
  }
  if (btnStopCalm) {
    btnStopCalm.addEventListener("click", () => {
      stopSoundscape();
      setCalmStatus("声景已停。");
    });
  }

  window.VentJournal = {
    addEntry,
    loadJournal,
    clearJournal,
    renderJournal,
    currentMood() {
      return mood ? Number(mood.value) : 5;
    },
  };

  renderJournal();
  window.addEventListener("resize", () => drawChart(loadJournal()));
})();
