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
    V.setHud(hud, "本局 " + sessionPops + " · 累计 " + lifetime + bit);
  }
  updateHud();

  function popBubble(b, pitchScale) {
    if (!b || b.classList.contains("popped")) return false;
    b.classList.add("popped");
    b.classList.remove("regrowing");
    sessionPops++;
    lifetime++;
    const st = V.recordHit("bubble", { vibrateMs: 9, comboWindowMs: 650, extra: { pops: lifetime } });
    V.setGameStat("bubble", { pops: lifetime });
    const pitch = pitchScale != null ? pitchScale : 0.75 + Math.random() * 0.7;
    const loud = dragging && st.combo >= 2 ? 1 + Math.min(1.1, st.combo * 0.08) : 1;
    V.playPop(pitch, loud);
    if (st.combo >= 6) {
      grid.classList.add("combo-flash");
      setTimeout(() => grid.classList.remove("combo-flash"), 180);
    }
    updateHud(st.combo);

    // refill after delay
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
      V.ensureAudio();
      dragging = true;
      try {
        grid.setPointerCapture(e.pointerId);
      } catch (_) {}
      popBubble(bubbleAt(e.clientX, e.clientY) || e.target.closest(".bubble-cell"));
    },
    { passive: false }
  );

  grid.addEventListener(
    "pointermove",
    (e) => {
      if (!dragging) return;
      e.preventDefault();
      popBubble(bubbleAt(e.clientX, e.clientY));
    },
    { passive: false }
  );

  function endDrag() {
    dragging = false;
  }
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  popAllBtn.addEventListener("click", () => {
    V.ensureAudio();
    const cells = Array.from(grid.querySelectorAll(".bubble-cell:not(.popped)"));
    cells.forEach((b, i) => {
      setTimeout(() => {
        popBubble(b, 0.85 + (i % 8) * 0.06);
        const r = b.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        if (i % 4 === 0) {
          V.createParticleBurst(stage, r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
            count: 6,
            dist: 28,
            colors: ["#5ce1e6", "#f4e8d8"],
          });
        }
      }, i * 28);
    });
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
