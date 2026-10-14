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
  let angle = 0; // radians
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

  const SPRING = 18;
  const DAMP = 4.2;
  const MAX_A = 0.85;

  function physics(dt) {
    // angular spring toward 0
    const acc = -SPRING * angle - DAMP * vel;
    vel += acc * dt;
    angle += vel * dt;
    if (angle > MAX_A) {
      angle = MAX_A;
      vel *= -0.4;
    }
    if (angle < -MAX_A) {
      angle = -MAX_A;
      vel *= -0.4;
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
    const side = clientX < c.x ? 1 : -1; // hit left → swing right
    const distX = Math.abs(clientX - c.x);
    const pow = Math.max(0.45, Math.min(2.2, power || 0.9 + distX / 200));
    // impulse
    vel += side * pow * 3.2;
    angle += side * 0.04 * pow;
    squashUntil = performance.now() + 90;

    count++;
    const st = V.recordHit("bag", { vibrateMs: 14 + pow * 8 });
    const dmg = Math.round(8 + pow * 10 + (st.combo > 5 ? st.combo : 0));
    const crit = st.combo >= 8 || pow >= 1.7;
    V.playThud(Math.min(1.6, 0.4 + pow * 0.55));
    if (st.combo >= 2) V.playTick();

    const lx = clientX - stage.getBoundingClientRect().left;
    const ly = clientY - stage.getBoundingClientRect().top;
    V.spawnFloatingText(stage, crit ? "CRITICAL +" + dmg : "+" + dmg, lx, ly, {
      px: true,
      critical: crit,
    });
    V.createParticleBurst(stage, lx, ly, {
      count: crit ? 18 : 10,
      star: true,
      colors: ["#ffe566", "#ff3d7f", "#5ce1e6", "#f4e8d8"],
      dist: 40 + pow * 20,
    });
    V.screenShake(stage, 0.6 + pow * 0.5 + Math.min(1, st.combo / 12));

    if (st.combo > 0 && st.combo % 10 === 0) {
      V.createShockwave(stage, c.x - stage.getBoundingClientRect().left, c.y - stage.getBoundingClientRect().top);
      arena.classList.add("combo-flash");
      setTimeout(() => arena.classList.remove("combo-flash"), 200);
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
      const speed = Math.sqrt(dx * dx + dy * dy) / dt; // px/ms
      const power = 0.7 + Math.min(1.6, speed * 18);
      // hit at release (or tap): use contact / center side
      const hx = Math.abs(dx) + Math.abs(dy) > 8 ? e.clientX : lastPtr.x;
      const hy = Math.abs(dx) + Math.abs(dy) > 8 ? e.clientY : lastPtr.y;
      hit(hx, hy, power);
      lastPtr = null;
    },
    { passive: false }
  );

  arena.addEventListener("pointercancel", () => {
    lastPtr = null;
  });

  // also allow quick tap without waiting for big swipe
  const best = V.getGameStats("bag").bestCombo || 0;
  V.setHud(hud, "打了 0 下 · 最佳连击 " + best);
})();
