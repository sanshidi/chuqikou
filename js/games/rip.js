/**
 * 撕纸 — preset annoying phrases, swipe to rip
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const PHRASES = [
    "加班？再说一遍试试",
    "你怎么又这样",
    "随便你吧",
    "我都是为你好",
    "马上到（其实没有）",
    "已读不回的人",
    "周一早上好",
    "KPI 又涨了",
    "别矫情了",
    "你想多了",
  ];

  let ripped = 0;
  let phraseIdx = 0;
  let dragging = false;
  let start = null;
  let ripProgress = 0;

  const arena = document.createElement("div");
  arena.className = "rip-arena";
  arena.innerHTML =
    '<div class="rip-toolbar" id="ripToolbar"></div>' +
    '<div class="rip-sheet-wrap" id="ripWrap">' +
    '<div class="rip-sheet" id="ripSheet"></div>' +
    "</div>" +
    '<p class="rip-hint">按住纸张用力一划，撕开这句话</p>';
  stage.appendChild(arena);

  const toolbar = document.getElementById("ripToolbar");
  const wrap = document.getElementById("ripWrap");
  const sheet = document.getElementById("ripSheet");

  PHRASES.slice(0, 5).forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rip-chip" + (i === 0 ? " is-on" : "");
    b.textContent = p.length > 6 ? p.slice(0, 6) + "…" : p;
    b.addEventListener("click", () => {
      phraseIdx = i;
      sheet.textContent = PHRASES[i];
      sheet.style.clipPath = "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
      ripProgress = 0;
      toolbar.querySelectorAll(".rip-chip").forEach((el, j) => el.classList.toggle("is-on", j === i));
    });
    toolbar.appendChild(b);
  });
  sheet.textContent = PHRASES[0];

  function updateHud(combo) {
    V.setHud(hud, "撕了 " + ripped + " 张" + (combo != null ? " · 连击 " + combo : ""));
  }
  updateHud();

  const MAX_RIP_SHARDS = 8;
  let ripShardAlive = 0;

  function spawnShards(progress) {
    if (V.reducedMotion && V.reducedMotion()) return;
    const r = wrap.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const q = V.getJuiceQuality ? V.getJuiceQuality() : 3;
    const n = Math.min(q <= 1 ? 6 : 12, 6 + Math.floor(progress * 6));
    for (let i = 0; i < n; i++) {
      if (ripShardAlive >= MAX_RIP_SHARDS) {
        const oldEl = stage.querySelector(".rip-shard");
        if (oldEl) {
          try { oldEl.remove(); } catch (_) {}
          ripShardAlive = Math.max(0, ripShardAlive - 1);
        } else break;
      }
      const el = document.createElement("div");
      el.className = "rip-shard";
      const w = 28 + Math.random() * 40;
      const h = 20 + Math.random() * 36;
      el.style.width = w + "px";
      el.style.height = h + "px";
      el.style.left = r.left - sr.left + Math.random() * r.width + "px";
      el.style.top = r.top - sr.top + Math.random() * r.height + "px";
      el.style.setProperty("--rx", (Math.random() * 160 - 80).toFixed(0) + "px");
      el.style.setProperty("--ry", (40 + Math.random() * 120).toFixed(0) + "px");
      el.style.setProperty("--rr", (Math.random() * 80 - 40).toFixed(0) + "deg");
      el.textContent = "撕";
      stage.appendChild(el);
      ripShardAlive++;
      setTimeout(() => {
        try { el.remove(); } catch (_) {}
        ripShardAlive = Math.max(0, ripShardAlive - 1);
      }, 750);
    }
  }

  function finishRip() {
    ripped++;
    const st = V.recordHit("rip", { vibrateMs: 0, comboWindowMs: 1200 });
    V.playCrack(true);
    V.playWhoosh();
    V.playBurst();
    V.vibeHit("burst");
    V.screenShake(stage, 2.2, st.combo);
    V.hitStop(12);
    V.impactFlash(stage, { heavy: true, chromatic: true });
    spawnShards(1);
    const r = wrap.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    V.spawnFloatingText(stage, st.combo >= 3 ? "撕穿 x" + st.combo : "撕烂！", r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
      px: true,
      critical: true,
    });
    V.createParticleBurst(stage, r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
      count: 8,
      big: true,
      star: true,
      dist: 100,
      colors: ["#f4e8d8", "#ff3d7f", "#ffe566", "#5ce1e6"],
    });
    updateHud(st.combo);

    // auto next phrase
    setTimeout(() => {
      phraseIdx = (phraseIdx + 1) % PHRASES.length;
      sheet.textContent = PHRASES[phraseIdx];
      sheet.style.clipPath = "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
      ripProgress = 0;
      toolbar.querySelectorAll(".rip-chip").forEach((el, j) => {
        el.classList.toggle("is-on", j === phraseIdx % 5);
        if (j === phraseIdx % 5) el.textContent = PHRASES[phraseIdx].length > 6 ? PHRASES[phraseIdx].slice(0, 6) + "…" : PHRASES[phraseIdx];
      });
    }, 420);
  }

  function applyRip(p) {
    // diagonal tear from top-left-ish
    const t = Math.max(0, Math.min(1, p));
    const cut = (t * 100).toFixed(1);
    // two halves separating
    sheet.style.clipPath =
      "polygon(0 0, " + cut + "% 0, " + (cut * 0.85).toFixed(1) + "% 100%, 0 100%)";
    // visual of tear via second layer would be nice — use opacity + shake of sheet
    sheet.style.transform = "rotate(" + (t * -3).toFixed(2) + "deg) translateX(" + (-t * 8).toFixed(1) + "px)";
  }

  wrap.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
      dragging = true;
      start = { x: e.clientX, y: e.clientY };
      ripProgress = 0;
      try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
      V.playTick();
    },
    { passive: false }
  );

  wrap.addEventListener(
    "pointermove",
    (e) => {
      if (!dragging || !start) return;
      e.preventDefault();
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const next = Math.min(1, dist / 160);
      if (next > ripProgress + 0.04) {
        ripProgress = next;
        applyRip(ripProgress);
        V.playTick();
        if (ripProgress > 0.3) V.playThud(0.4 + ripProgress);
        V.screenShake(stage, 0.35 + ripProgress * 0.9, Math.floor(ripProgress * 8));
        V.vibrate(8);
        if (ripProgress > 0.55 && Math.random() < 0.4) spawnShards(ripProgress * 0.4);
      }
      if (ripProgress >= 0.92) {
        dragging = false;
        start = null;
        finishRip();
        sheet.style.transform = "";
      }
    },
    { passive: false }
  );

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (ripProgress >= 0.7) {
      finishRip();
    } else {
      // snap back
      sheet.style.clipPath = "polygon(0 0, 100% 0, 100% 100%, 0 100%)";
      sheet.style.transform = "";
      ripProgress = 0;
      V.playPop(0.8, 0.9);
    }
    start = null;
  }
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);
})();
