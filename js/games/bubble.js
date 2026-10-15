/**
 * 泡泡膜 — InfiniPop drag-to-pop fidget
 * Interaction: pointerdown + pointermove while down pops under finger; endless refill
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const arena = document.createElement("div");
  arena.className = "bubble-arena";
  arena.innerHTML =
    '<div class="bubble-toolbar"><button type="button" class="bubble-popall" id="popAll">一键全破</button></div>' +
    '<div class="bubble-grid-full" id="grid"></div>';
  stage.appendChild(arena);

  const grid = document.getElementById("grid");
  const popAllBtn = document.getElementById("popAll");

  function colsRows() {
    const w = stage.clientWidth || 360;
    const h = stage.clientHeight || 500;
    const cell = w < 360 ? 36 : 42;
    const cols = Math.max(6, Math.min(10, Math.floor((w - 16) / cell)));
    const rows = Math.max(8, Math.min(14, Math.floor((h - 60) / cell)));
    return { cols, rows };
  }

  let { cols, rows } = colsRows();
  let lifetime = V.getGameStats("bubble").pops || 0;
  let sessionPops = 0;
  let dragging = false;
  let lastStreak = null;
  const refillTimers = new WeakMap();

  function build() {
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    const total = cols * rows;
    for (let i = 0; i < total; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bubble-cell";
      b.setAttribute("aria-label", "泡泡");
      b.dataset.i = String(i);
      grid.appendChild(b);
    }
  }
  build();

  function updateHud(combo) {
    const bit = combo != null ? " · 连击 " + combo : "";
    V.setHud(hud, "本局破 " + sessionPops + " · 累计 " + lifetime + bit);
  }
  updateHud();

  function drawStreak(x0, y0, x1, y1) {
    if (V.reducedMotion()) return;
    const sr = stage.getBoundingClientRect();
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 8) return;
    const el = document.createElement("div");
    el.className = "bubble-streak";
    el.style.left = x0 - sr.left + "px";
    el.style.top = y0 - sr.top - 5 + "px";
    el.style.width = len + "px";
    el.style.transform = "rotate(" + Math.atan2(dy, dx) + "rad)";
    stage.appendChild(el);
    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
    }, 300);
  }

  function popBubble(b, pitchScale, clientX, clientY) {
    if (!b || b.classList.contains("popped")) return false;
    b.classList.add("popped");
    b.classList.remove("regrowing");
    sessionPops++;
    lifetime++;
    const st = V.recordHit("bubble", { vibrateMs: 0, comboWindowMs: 650, extra: { pops: lifetime } });
    V.setGameStat("bubble", { pops: lifetime });
    const pitch = pitchScale != null ? pitchScale : 0.75 + Math.random() * 0.7;
    const loud = dragging && st.combo >= 2 ? 1.15 + Math.min(1.2, st.combo * 0.09) : 1.25;
    V.playPop(pitch, loud);
    if (st.combo >= 3) V.vibeHit("tap");
    else V.vibrate(10);
    if (st.combo >= 8) {
      V.screenShake(stage, 0.55, st.combo);
      V.impactFlash(stage, {});
    } else if (st.combo >= 4 && st.combo % 2 === 0) {
      V.screenShake(stage, 0.35, Math.floor(st.combo / 2));
    }
    if (st.combo >= 6) {
      grid.classList.add("combo-flash");
      setTimeout(() => grid.classList.remove("combo-flash"), 180);
    }
    if (clientX != null && lastStreak) {
      drawStreak(lastStreak.x, lastStreak.y, clientX, clientY);
    }
    if (clientX != null) lastStreak = { x: clientX, y: clientY };
    if (st.combo > 0 && st.combo % 10 === 0) {
      V.spawnFloatingText(stage, "连破 x" + st.combo, 50, 28, { critical: true });
      V.playTick();
    }
    updateHud(st.combo);

    const prev = refillTimers.get(b);
    if (prev) clearTimeout(prev);
    const delay = 1200 + Math.random() * 800;
    const t = setTimeout(() => {
      if (!b.isConnected) return;
      b.classList.remove("popped");
      b.classList.add("regrowing");
      setTimeout(() => b.classList.remove("regrowing"), 360);
    }, delay);
    refillTimers.set(b, t);
    return true;
  }

  function bubbleAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (el && el.classList && el.classList.contains("bubble-cell")) return el;
    return null;
  }

  grid.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
      dragging = true;
      lastStreak = { x: e.clientX, y: e.clientY };
      try {
        grid.setPointerCapture(e.pointerId);
      } catch (_) {}
      popBubble(bubbleAt(e.clientX, e.clientY) || e.target.closest(".bubble-cell"), null, e.clientX, e.clientY);
    },
    { passive: false }
  );

  grid.addEventListener(
    "pointermove",
    (e) => {
      if (!dragging) return;
      e.preventDefault();
      popBubble(bubbleAt(e.clientX, e.clientY), null, e.clientX, e.clientY);
    },
    { passive: false }
  );

  function endDrag() {
    dragging = false;
    lastStreak = null;
  }
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  popAllBtn.addEventListener("click", () => {
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    const cells = Array.from(grid.querySelectorAll(".bubble-cell:not(.popped)"));
    cells.forEach((b, i) => {
      setTimeout(() => {
        popBubble(b, 0.85 + (i % 8) * 0.06);
        const r = b.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        if (i % 5 === 0) {
          V.createParticleBurst(stage, r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
            count: 5,
            dist: 36,
            big: true,
            colors: ["#5ce1e6", "#f4e8d8", "#ffe566"],
          });
        }
      }, i * 24);
    });
    V.screenShake(stage, 1.2, 6);
    V.vibeHit("heavy");
  });

  window.addEventListener("resize", () => {
    const n = colsRows();
    if (n.cols !== cols || n.rows !== rows) {
      cols = n.cols;
      rows = n.rows;
      build();
    }
  });
})();
