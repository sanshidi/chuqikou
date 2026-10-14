/**
 * 怒戳地鼠 — targets pop up, smack down hard
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const FACES = ["😤", "😠", "💢", "😈", "🥴", "😵"];
  const BOSS = "👑";
  let score = 0;
  let misses = 0;
  let active = [];
  let timers = [];
  let running = true;

  const arena = document.createElement("div");
  arena.className = "mole-arena";
  arena.innerHTML = '<div class="mole-grid" id="moleGrid"></div>';
  stage.appendChild(arena);
  const grid = document.getElementById("moleGrid");

  const holes = [];
  for (let i = 0; i < 9; i++) {
    const hole = document.createElement("div");
    hole.className = "mole-hole";
    hole.dataset.i = String(i);
    const target = document.createElement("button");
    target.type = "button";
    target.className = "mole-target";
    target.setAttribute("aria-label", "地鼠");
    target.textContent = FACES[0];
    hole.appendChild(target);
    grid.appendChild(hole);
    holes.push({ hole, target, up: false, boss: false, hp: 1, hideTimer: 0 });
  }

  function updateHud(combo) {
    V.setHud(
      hud,
      "砸中 " + score + (combo != null ? " · 连击 " + combo : "") + " · 溜掉 " + misses
    );
  }
  updateHud();

  function hideMole(slot, escaped) {
    if (!slot.up) return;
    slot.up = false;
    slot.target.classList.remove("is-up", "is-boss", "is-smashed");
    if (escaped) {
      misses++;
      updateHud();
    }
  }

  function showMole() {
    if (!running) return;
    const free = holes.filter((h) => !h.up);
    if (!free.length) return;
    const slot = free[(Math.random() * free.length) | 0];
    const boss = Math.random() < 0.14;
    slot.boss = boss;
    slot.hp = boss ? 3 : 1;
    slot.up = true;
    slot.target.textContent = boss ? BOSS : FACES[(Math.random() * FACES.length) | 0];
    slot.target.classList.toggle("is-boss", boss);
    slot.target.classList.remove("is-smashed");
    void slot.target.offsetWidth;
    slot.target.classList.add("is-up");
    const lifetime = boss ? 1600 + Math.random() * 600 : 900 + Math.random() * 700;
    clearTimeout(slot.hideTimer);
    slot.hideTimer = setTimeout(() => hideMole(slot, true), lifetime);
  }

  function schedule() {
    if (!running) return;
    showMole();
    if (Math.random() < 0.35) setTimeout(showMole, 180);
    const next = 480 + Math.random() * 520;
    timers.push(setTimeout(schedule, next));
  }

  function smack(slot, e) {
    if (!slot.up) return;
    e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    const r = slot.target.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const lx = r.left + r.width / 2 - sr.left;
    const ly = r.top + r.height / 2 - sr.top;

    if (slot.boss && slot.hp > 1) {
      slot.hp--;
      slot.target.classList.add("is-smashed");
      setTimeout(() => slot.target.classList.remove("is-smashed"), 90);
      V.playThud(1.1);
      V.playCrack(false);
      V.vibeHit("hit");
      V.screenShake(stage, 1.2, 3);
      V.hitStop(16);
      V.impactFlash(stage, {});
      V.spawnFloatingText(stage, "还没倒!", lx, ly, { px: true });
      return;
    }

    clearTimeout(slot.hideTimer);
    slot.target.classList.add("is-smashed");
    score++;
    const st = V.recordHit("mole", { vibrateMs: 0, comboWindowMs: 900 });
    const isBoss = slot.boss;
    setTimeout(() => hideMole(slot, false), 120);

    V.playThud(isBoss ? 2.0 : 1.2 + Math.min(0.8, st.combo * 0.08));
    if (isBoss) {
      V.playBurst();
      V.playCrack(true);
      V.vibeHit("boss");
      V.screenShake(stage, 2.5, st.combo);
      V.hitStop(26);
      V.impactFlash(stage, { heavy: true, chromatic: true });
    } else {
      V.vibeHit(st.combo >= 5 ? "heavy" : "hit");
      V.screenShake(stage, 1.0 + Math.min(1.3, st.combo / 8), st.combo);
      V.hitStop(st.combo >= 6 ? 22 : 14);
      V.impactFlash(stage, { heavy: st.combo >= 6 });
    }
    V.spawnFloatingText(stage, isBoss ? "BOSS KO +" + (20 + st.combo) : "砸！" + (st.combo > 1 ? " x" + st.combo : ""), lx, ly, {
      px: true,
      critical: isBoss || st.combo >= 7,
    });
    V.createParticleBurst(stage, lx, ly, {
      count: isBoss ? 18 : 10,
      big: true,
      star: isBoss || st.combo >= 5,
      dist: isBoss ? 90 : 50,
      colors: ["#ffe566", "#ff3d7f", "#5ce1e6", "#fff"],
    });
    updateHud(st.combo);
  }

  holes.forEach((slot) => {
    slot.target.addEventListener(
      "pointerdown",
      (e) => {
        smack(slot, e);
      },
      { passive: false }
    );
  });

  schedule();
  window.addEventListener("pagehide", () => {
    running = false;
    timers.forEach(clearTimeout);
    holes.forEach((h) => clearTimeout(h.hideTimer));
  });
})();
