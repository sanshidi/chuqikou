/**
 * 捏压力球 — soft-body hold-deform + directional squash + 爆浆 at max
 * Interaction: hold to squash; pointer move shifts squash axis; release = elastic bounce
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
  let sx = 1,
    sy = 1;
  let targetSx = 1,
    targetSy = 1;
  let offsetX = 0,
    offsetY = 0;
  let startX = 0,
    startY = 0;
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
    const flat = (1.15 - sx) / 0.45; // 0..1-ish
    shadow.style.transform = "scaleX(" + (1 + flat * 0.55).toFixed(2) + ")";
    shadow.style.opacity = String(0.35 + flat * 0.4);
  }

  function reform() {
    bursting = false;
    ball.classList.remove("is-burst", "is-tremble");
    sx = 1;
    sy = 1;
    targetSx = 1;
    targetSy = 1;
    offsetX = 0;
    offsetY = 0;
    holdMs = 0;
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
    V.playPop(0.6);
    V.vibrate([18, 30, 22]);
    V.screenShake(stage, 1.8);
    const r = ball.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    V.createParticleBurst(stage, r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top, {
      count: 28,
      dist: 90,
      colors: ["#ffe566", "#ff3d7f", "#5ce1e6", "#f4e8d8"],
      star: true,
    });
    V.spawnFloatingText(stage, "爆浆！", r.left + r.width / 2 - sr.left, r.top - sr.top, {
      px: true,
      critical: true,
    });
    squeezes++;
    const st = V.recordHit("squeeze", { vibrateMs: 0, comboWindowMs: 1400 });
    V.setHud(hud, "捏了 " + squeezes + " 下 · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
    setTimeout(reform, 480);
  }

  let lastT = performance.now();
  function loop(t) {
    const dt = Math.min(32, t - lastT);
    lastT = t;

    if (pressing && !bursting) {
      holdMs += dt;
      // continuous soft ticks while squeezing
      if (t - lastTick > 90) {
        lastTick = t;
        V.playThud(0.25 + (1 - sx) * 0.5);
      }
      // approach max squash
      targetSx = Math.max(0.55, targetSx - 0.012 * (dt / 16));
      targetSy = Math.min(1.45, targetSy + 0.01 * (dt / 16));
      if (holdMs > 1400) {
        ball.classList.add("is-tremble");
        burstHint.textContent = "快爆了…再捏紧！";
      }
      if (holdMs > 2200 || targetSx <= 0.56) {
        doBurst();
      }
    } else if (!bursting) {
      // elastic return with overshoot
      targetSx += (1 - targetSx) * 0.22;
      targetSy += (1 - targetSy) * 0.22;
      offsetX *= 0.85;
      offsetY *= 0.85;
      if (Math.abs(targetSx - 1) < 0.002) {
        targetSx = 1;
        targetSy = 1;
      }
    }

    sx += (targetSx - sx) * 0.35;
    sy += (targetSy - sy) * 0.35;
    render();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function onDown(e) {
    if (bursting) return;
    e.preventDefault();
    V.ensureAudio();
    pressing = true;
    holdMs = 0;
    startX = e.clientX;
    startY = e.clientY;
    ball.classList.add("is-squeezing");
    try {
      ball.setPointerCapture(e.pointerId);
    } catch (_) {}
    V.playThud(0.45);
  }

  function onMove(e) {
    if (!pressing || bursting) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // shift squash direction: horizontal drag → more scaleX bias
    offsetX = Math.max(-28, Math.min(28, dx * 0.15));
    offsetY = Math.max(-18, Math.min(18, dy * 0.12));
    const bias = Math.max(-1, Math.min(1, dx / 80));
    targetSx = Math.max(0.55, Math.min(0.95, 0.78 - Math.abs(bias) * 0.08));
    targetSy = Math.min(1.45, 1.12 + Math.abs(bias) * 0.12 + Math.abs(dy) / 400);
  }

  function onUp(e) {
    if (!pressing || bursting) return;
    pressing = false;
    ball.classList.remove("is-squeezing", "is-tremble");
    burstHint.textContent = "";
    // overshoot bounce
    const depth = 1.15 - sx;
    targetSx = 1 + depth * 0.55;
    targetSy = 1 - depth * 0.4;
    squeezes++;
    const st = V.recordHit("squeeze", { vibrateMs: 14, comboWindowMs: 1200 });
    V.playPop(0.9 + depth);
    V.createParticleBurst(
      stage,
      ball.getBoundingClientRect().left + ball.offsetWidth / 2 - stage.getBoundingClientRect().left,
      ball.getBoundingClientRect().top + ball.offsetHeight / 2 - stage.getBoundingClientRect().top,
      { count: 10, dist: 36, colors: ["#ffe566", "#ff3d7f"] }
    );
    V.setHud(hud, "捏了 " + squeezes + " 下 · 连击 " + st.combo + " · 最佳 " + st.bestCombo);
    // settle overshoot
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

  V.setHud(hud, "捏了 0 下 · 按住揉捏，松手弹回");
})();
