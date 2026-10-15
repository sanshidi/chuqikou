/**
 * 捏压力球 — soft-body hold-deform + directional squash + 爆浆 at max
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const COLORS = [
    { bg: "radial-gradient(circle at 32% 28%, #ffe566, #ff3d7f 50%, #8a1a40 85%)", name: "玫红" },
    { bg: "radial-gradient(circle at 32% 28%, #b8fff5, #5ce1e6 50%, #1a6a70 85%)", name: "青绿" },
    { bg: "radial-gradient(circle at 32% 28%, #fff0b0, #ffb020 50%, #a06010 85%)", name: "蜜橙" },
  ];

  let squeezes = 0;
  let colorIdx = 0;
  let pressing = false;
  let sx = 1, sy = 1;
  let targetSx = 1, targetSy = 1;
  let offsetX = 0, offsetY = 0;
  let startX = 0, startY = 0;
  let holdMs = 0;
  let lastTick = 0;
  let raf = 0;
  let bursting = false;

  const arena = document.createElement("div");
  arena.className = "squeeze-arena";
  arena.innerHTML =
    '<button type="button" class="squeeze-ball-xl" id="ball" aria-label="压力球，按住捏"></button>' +
    '<div class="squeeze-shadow" id="shadow"></div>' +
    '<div class="squeeze-colors" id="swatches"></div>' +
    '<p class="squeeze-hint-burst" id="burstHint"></p>';
  stage.appendChild(arena);

  const ball = document.getElementById("ball");
  const shadow = document.getElementById("shadow");
  const swatches = document.getElementById("swatches");
  const burstHint = document.getElementById("burstHint");

  COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "squeeze-swatch" + (i === 0 ? " is-on" : "");
    b.style.background = c.bg;
    b.setAttribute("aria-label", c.name);
    b.addEventListener("click", () => {
      colorIdx = i;
      ball.style.background = c.bg;
      swatches.querySelectorAll(".squeeze-swatch").forEach((el, j) => {
        el.classList.toggle("is-on", j === i);
      });
    });
    swatches.appendChild(b);
  });
  ball.style.background = COLORS[0].bg;

  function render() {
    ball.style.transform =
      "translate(" + offsetX.toFixed(1) + "px," + offsetY.toFixed(1) + "px) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")";
    const flat = (1.15 - sx) / 0.45;
    shadow.style.transform = "scaleX(" + (1 + flat * 0.7).toFixed(2) + ")";
    shadow.style.opacity = String(0.35 + flat * 0.45);
  }

  function reform() {
    bursting = false;
    ball.classList.remove("is-burst", "is-tremble");
    sx = 1; sy = 1; targetSx = 1; targetSy = 1;
    offsetX = 0; offsetY = 0; holdMs = 0;
    ball.style.opacity = "1";
    render();
    burstHint.textContent = "";
  }

  function doBurst() {
    if (bursting) return;
    bursting = true;
    pressing = false;
    ball.classList.remove("is-squeezing", "is-tremble");
    ball.classList.add("is-burst");
    V.playBurst();
    V.playSplat();
    V.playCrack(false);
    V.vibeHit("burst");
    V.screenShake(stage, 2.4, 8);
    V.hitStop(12);
    V.impactFlash(stage, { heavy: true, chromatic: true });
    const r = ball.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    V.createParticleBurst(stage, r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
      count: 10,
      dist: 120,
      colors: ["#ffe566", "#ff3d7f", "#5ce1e6", "#f4e8d8", "#fff"],
      star: true,
      big: true,
    });
    V.spawnFloatingText(stage, "爆浆！", r.left + r.width / 2 - sr.left, r.top - sr.top, {
      px: true,
      critical: true,
    });
    squeezes++;
    const st = V.recordHit("squeeze", { vibrateMs: 0, comboWindowMs: 1400 });
    V.setHud(hud, "次数 " + squeezes + " · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
    setTimeout(reform, 520);
  }

  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(32, t - lastT);
    lastT = t;

    if (pressing && !bursting) {
      holdMs += dt;
      if (t - lastTick > 80) {
        lastTick = t;
        V.playKnead(0.4 + (1 - sx) * 0.85);
        if (holdMs > 900) V.screenShake(stage, 0.25 + (1 - sx) * 0.5, 1);
      }
      targetSx = Math.max(0.48, targetSx - 0.014 * (dt / 16));
      targetSy = Math.min(1.55, targetSy + 0.012 * (dt / 16));
      if (holdMs > 1200) {
        ball.classList.add("is-tremble");
        burstHint.textContent = "快爆了…再捏紧！";
      }
      if (holdMs > 2000 || targetSx <= 0.5) {
        doBurst();
      }
    } else if (!bursting) {
      targetSx += (1 - targetSx) * 0.24;
      targetSy += (1 - targetSy) * 0.24;
      offsetX *= 0.82;
      offsetY *= 0.82;
      if (Math.abs(targetSx - 1) < 0.002) {
        targetSx = 1;
        targetSy = 1;
      }
    }

    sx += (targetSx - sx) * 0.38;
    sy += (targetSy - sy) * 0.38;
    render();
    if (!document.hidden) raf = requestAnimationFrame(loop);
    else raf = 0;
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !raf) raf = requestAnimationFrame(loop);
  });
  raf = requestAnimationFrame(loop);

  function onDown(e) {
    if (bursting) return;
    e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    pressing = true;
    holdMs = 0;
    startX = e.clientX;
    startY = e.clientY;
    ball.classList.add("is-squeezing");
    try { ball.setPointerCapture(e.pointerId); } catch (_) {}
    V.playKnead(0.65);
  }

  function onMove(e) {
    if (!pressing || bursting) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    offsetX = Math.max(-36, Math.min(36, dx * 0.18));
    offsetY = Math.max(-24, Math.min(24, dy * 0.14));
    const bias = Math.max(-1, Math.min(1, dx / 80));
    targetSx = Math.max(0.48, Math.min(0.92, 0.72 - Math.abs(bias) * 0.1));
    targetSy = Math.min(1.55, 1.18 + Math.abs(bias) * 0.14 + Math.abs(dy) / 350);
  }

  function onUp(e) {
    if (!pressing || bursting) return;
    pressing = false;
    ball.classList.remove("is-squeezing", "is-tremble");
    burstHint.textContent = "";
    const depth = 1.15 - sx;
    targetSx = 1 + depth * 0.7;
    targetSy = 1 - depth * 0.5;
    squeezes++;
    const st = V.recordHit("squeeze", { vibrateMs: 0, comboWindowMs: 1200 });
    V.playSplat();
    V.playPop(0.85 + depth, 1.35);
    V.vibeHit(depth > 0.35 ? "heavy" : "hit");
    V.screenShake(stage, 0.7 + depth * 1.4, st.combo);
    if (depth > 0.3) {
      V.hitStop(10);
      V.impactFlash(stage, {});
    }
    V.createParticleBurst(
      stage,
      ball.getBoundingClientRect().left + ball.offsetWidth / 2 - stage.getBoundingClientRect().left,
      ball.getBoundingClientRect().top + ball.offsetHeight / 2 - stage.getBoundingClientRect().top,
      { count: 8, dist: 40 + depth * 32, big: true, colors: ["#ffe566", "#ff3d7f", "#fff"] }
    );
    V.setHud(hud, "次数 " + squeezes + " · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
    setTimeout(() => {
      if (!pressing && !bursting) {
        targetSx = 1;
        targetSy = 1;
      }
    }, 120);
  }

  ball.addEventListener("pointerdown", onDown, { passive: false });
  ball.addEventListener("pointermove", onMove, { passive: false });
  ball.addEventListener("pointerup", onUp);
  ball.addEventListener("pointercancel", onUp);

  V.setHud(hud, "次数 0 · 按住揉捏 · 松手弹回");
})();
