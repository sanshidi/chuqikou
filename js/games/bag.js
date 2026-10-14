/**
 * 出气袋 — directional punch + angular swing physics
 * Interaction: pointer hit side relative to bag center; swipe velocity = power
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const faces = ["😤", "😠", "💢", "😮‍💨", "😵", "🔥", "😌"];
  let angle = 0;
  let vel = 0;
  let count = 0;
  let lastPtr = null;
  let raf = 0;
  let squashUntil = 0;

  const arena = document.createElement("div");
  arena.className = "bag-arena";
  arena.innerHTML =
    '<div class="bag-pivot"></div>' +
    '<div class="bag-swing" id="bagSwing">' +
    '<div class="bag-chain-long"></div>' +
    '<div class="bag-body-xl" id="bagBody"><span class="bag-face" id="bagFace">😤</span></div>' +
    "</div>" +
    '<div class="bag-combo-meter"><div class="bag-combo-fill" id="comboFill"></div></div>';
  stage.appendChild(arena);

  const swing = document.getElementById("bagSwing");
  const body = document.getElementById("bagBody");
  const face = document.getElementById("bagFace");
  const comboFill = document.getElementById("comboFill");

  const SPRING = 16;
  const DAMP = 3.6;
  const MAX_A = 1.05;

  function physics(dt) {
    const acc = -SPRING * angle - DAMP * vel;
    vel += acc * dt;
    angle += vel * dt;
    if (angle > MAX_A) {
      angle = MAX_A;
      vel *= -0.35;
    }
    if (angle < -MAX_A) {
      angle = -MAX_A;
      vel *= -0.35;
    }
    swing.style.transform = "rotate(" + angle + "rad)";
    if (performance.now() < squashUntil) body.classList.add("is-squash");
    else body.classList.remove("is-squash");
  }

  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    physics(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function bagCenter() {
    const r = body.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function hit(clientX, clientY, power) {
    const c = bagCenter();
    const side = clientX < c.x ? 1 : -1;
    const distX = Math.abs(clientX - c.x);
    const pow = Math.max(0.5, Math.min(2.4, power || 0.9 + distX / 200));
    vel += side * pow * 4.2;
    angle += side * 0.06 * pow;
    squashUntil = performance.now() + 110;

    count++;
    const st = V.recordHit("bag", { vibrateMs: 0 });
    const dmg = Math.round(10 + pow * 14 + (st.combo > 4 ? st.combo * 1.5 : 0));
    const crit = st.combo >= 7 || pow >= 1.65;
    V.playThud(Math.min(2.4, 0.7 + pow * 0.75));
    if (crit) V.playCrack(false);
    if (st.combo >= 2) V.playTick();
    if (pow >= 1.4) V.playWhoosh();

    if (crit) V.vibeHit("heavy");
    else if (pow >= 1.3) V.vibeHit("hit");
    else V.vibeHit("tap");

    const lx = clientX - stage.getBoundingClientRect().left;
    const ly = clientY - stage.getBoundingClientRect().top;
    V.spawnFloatingText(stage, crit ? "CRITICAL +" + dmg : "+" + dmg, lx, ly, {
      px: true,
      critical: crit,
    });
    V.createParticleBurst(stage, lx, ly, {
      count: crit ? 28 : 16,
      star: true,
      big: true,
      colors: crit ? ["#ff3d7f", "#ffe566", "#fff", "#5ce1e6"] : ["#ffe566", "#ff3d7f", "#5ce1e6", "#f4e8d8"],
      dist: 55 + pow * 35,
    });
    V.screenShake(stage, 0.9 + pow * 0.75, st.combo);
    if (crit || pow >= 1.5) {
      V.hitStop(crit ? 36 : 24);
      V.impactFlash(stage, { heavy: crit, chromatic: crit });
    } else if (pow >= 1.1) {
      V.impactFlash(stage, {});
    }

    if (st.combo > 0 && st.combo % 10 === 0) {
      V.createShockwave(stage, c.x - stage.getBoundingClientRect().left, c.y - stage.getBoundingClientRect().top);
      V.playBurst();
      V.vibeHit("burst");
      arena.classList.add("combo-flash");
      setTimeout(() => arena.classList.remove("combo-flash"), 220);
    }

    face.textContent = faces[Math.min(faces.length - 1, Math.floor(count / 4) % faces.length)];
    if (count > 0 && count % 25 === 0) face.textContent = "😌";

    comboFill.style.width = Math.min(100, (st.combo % 10) * 10) + "%";
    V.setHud(hud, "打了 " + count + " 下 · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
  }

  arena.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      V.ensureAudio();
      lastPtr = { x: e.clientX, y: e.clientY, t: performance.now() };
      try {
        arena.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    { passive: false }
  );

  arena.addEventListener(
    "pointerup",
    (e) => {
      e.preventDefault();
      if (!lastPtr) return;
      const dt = Math.max(16, performance.now() - lastPtr.t);
      const dx = e.clientX - lastPtr.x;
      const dy = e.clientY - lastPtr.y;
      const speed = Math.sqrt(dx * dx + dy * dy) / dt;
      const power = 0.75 + Math.min(1.8, speed * 20);
      const hx = Math.abs(dx) + Math.abs(dy) > 8 ? e.clientX : lastPtr.x;
      const hy = Math.abs(dx) + Math.abs(dy) > 8 ? e.clientY : lastPtr.y;
      if (speed > 0.3 || Math.abs(dx) + Math.abs(dy) > 36) V.playWhoosh();
      hit(hx, hy, power);
      lastPtr = null;
    },
    { passive: false }
  );

  arena.addEventListener("pointercancel", () => {
    lastPtr = null;
  });

  const best = V.getGameStats("bag").bestCombo || 0;
  V.setHud(hud, "打了 0 下 · 最佳连击 " + best);
})();
