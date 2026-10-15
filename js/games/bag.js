/**
 * 出气袋 — directional punch + angular swing physics
 * Interaction: pointer hit side relative to bag center; swipe velocity = power
 * Perf: edge-only squash class, cached stage rect, lean juice (no light hitStop)
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
  let squashing = false;

  /** Cached stage rect — avoid multi getBoundingClientRect per punch */
  let stageRect = null;
  let stageRectAt = 0;
  let lastFloatAt = 0;
  let lastCrackAt = 0;
  let lastWhooshAt = 0;
  let lastShockAt = 0;
  let lastFlashAt = 0;

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

  function refreshStageRect(force) {
    const now = performance.now();
    if (force || !stageRect || now - stageRectAt > 400) {
      stageRect = stage.getBoundingClientRect();
      stageRectAt = now;
    }
    return stageRect;
  }

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
    // Edge-only class toggle — no classList thrash every rAF frame
    const wantSquash = performance.now() < squashUntil;
    if (wantSquash !== squashing) {
      squashing = wantSquash;
      body.classList.toggle("is-squash", squashing);
    }
  }

  let lastT = performance.now();
  function loop(t) {
    if (document.hidden) {
      raf = 0;
      return;
    }
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    physics(dt);
    // idle: skip frames when nearly still
    if (Math.abs(vel) < 0.002 && Math.abs(angle) < 0.002 && performance.now() > squashUntil) {
      swing.style.transform = "rotate(" + angle + "rad)";
      if (squashing) {
        squashing = false;
        body.classList.remove("is-squash");
      }
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(loop);
  }
  function ensureLoop() {
    if (!raf && !document.hidden) {
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureLoop();
  });
  window.addEventListener(
    "resize",
    () => {
      stageRect = null;
    },
    { passive: true }
  );
  raf = requestAnimationFrame(loop);

  function bagCenter() {
    const r = body.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function hit(clientX, clientY, power) {
    const jq = V.getJuiceQuality ? V.getJuiceQuality() : 2;
    const c = bagCenter();
    const sr = refreshStageRect(false);
    const side = clientX < c.x ? 1 : -1;
    const distX = Math.abs(clientX - c.x);
    const pow = Math.max(0.5, Math.min(2.4, power || 0.9 + distX / 200));
    vel += side * pow * 4.2;
    angle += side * 0.06 * pow;
    squashUntil = performance.now() + 110;
    if (!squashing) {
      squashing = true;
      body.classList.add("is-squash");
    }

    ensureLoop();
    count++;
    const st = V.recordHit("bag", { vibrateMs: 0 });
    const dmg = Math.round(10 + pow * 14 + (st.combo > 4 ? st.combo * 1.5 : 0));
    const crit = st.combo >= 7 || pow >= 1.65;
    const now = performance.now();

    // SFX: thud always (sample path already layers light tick/whoosh/crack).
    // Extra crack/whoosh/tick only when needed — avoid 4 overlapping voices/hit.
    V.playThud(Math.min(2.4, 0.7 + pow * 0.75));
    if (crit && jq >= 2 && now - lastCrackAt > 140) {
      lastCrackAt = now;
      V.playCrack(false);
    }

    if (crit) V.vibeHit("heavy");
    else if (pow >= 1.3) V.vibeHit("hit");
    else V.vibeHit("tap");

    const lx = clientX - sr.left;
    const ly = clientY - sr.top;

    // Floats: crit or every 3rd hit; hard throttle for rapid taps
    if (jq > 0 && (crit || st.combo % 3 === 0) && now - lastFloatAt > 70) {
      lastFloatAt = now;
      V.spawnFloatingText(stage, crit ? "暴击 +" + dmg : "+" + dmg, lx, ly, {
        px: true,
        critical: crit,
      });
    }

    // Particles: 3–5; skip star/big on light hits
    if (jq > 0) {
      const pCount = crit ? (jq >= 2 ? 5 : 3) : jq <= 1 ? 3 : 4;
      V.createParticleBurst(stage, lx, ly, {
        count: pCount,
        star: !!(crit && jq >= 2),
        big: !!(crit && jq >= 2),
        colors: crit
          ? ["#ff3d7f", "#ffe566", "#fff", "#5ce1e6"]
          : ["#ffe566", "#ff3d7f", "#5ce1e6", "#f4e8d8"],
        dist: 40 + pow * 28,
      });
    }

    // Shake: lighter amp; skip tiny taps when juice already low
    if (jq > 0 && (crit || pow >= 0.95)) {
      V.screenShake(stage, 0.5 + pow * 0.4, st.combo);
    }

    // Prefer NO hitStop — squash transform already sells the punch.
    // Flash only on crit / heavy, throttled; no chromatic (cheaper paint).
    if (crit && now - lastFlashAt > 90) {
      lastFlashAt = now;
      V.impactFlash(stage, { heavy: true });
    } else if (pow >= 1.55 && jq >= 2 && now - lastFlashAt > 110) {
      lastFlashAt = now;
      V.impactFlash(stage, {});
    }

    if (st.combo > 0 && st.combo % 10 === 0 && now - lastShockAt > 450) {
      lastShockAt = now;
      if (jq >= 2) {
        V.createShockwave(stage, c.x - sr.left, c.y - sr.top);
      }
      V.playBurst();
      V.vibeHit("burst");
      if (jq > 0) {
        V.spawnFloatingText(stage, "连击达 " + st.combo + "！", 50, 18, { critical: true });
      }
      arena.classList.add("combo-flash");
      setTimeout(() => arena.classList.remove("combo-flash"), 220);
    }

    face.textContent = faces[Math.min(faces.length - 1, Math.floor(count / 4) % faces.length)];
    if (count > 0 && count % 25 === 0) face.textContent = "😌";

    comboFill.style.width = Math.min(100, (st.combo % 10) * 10) + "%";
    V.setHud(hud, "次数 " + count + " · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
  }

  arena.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      if (V.unlockAudio) V.unlockAudio(false);
      else V.ensureAudio();
      refreshStageRect(true);
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
      const now = performance.now();
      // Swipe whoosh once, throttled (thud already carries air whoosh)
      if ((speed > 0.35 || Math.abs(dx) + Math.abs(dy) > 48) && now - lastWhooshAt > 160) {
        lastWhooshAt = now;
        V.playWhoosh();
      }
      hit(hx, hy, power);
      lastPtr = null;
    },
    { passive: false }
  );

  arena.addEventListener("pointercancel", () => {
    lastPtr = null;
  });

  const best = V.getGameStats("bag").bestCombo || 0;
  V.setHud(hud, "次数 0 · 最佳连击 " + best + " · 甩打开始");
})();
