/**
 * 碎玻璃 — tap creates expanding cracks + shatter chunks
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const arena = document.createElement("div");
  arena.className = "glass-arena";
  arena.innerHTML =
    '<canvas id="glassCanvas"></canvas>' +
    '<div class="glass-toolbar"><button type="button" class="glass-clear" id="glassClear">清屏重砸</button></div>';
  stage.appendChild(arena);

  const canvas = document.getElementById("glassCanvas");
  const clearBtn = document.getElementById("glassClear");
  const ctx = canvas.getContext("2d");

  let w = 0, h = 0, dpr = 1;
  let cracks = [];
  let shards = [];
  let hits = 0;
  let broken = false;
  let raf = 0;
  let running = true;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  const MAX_SHARDS = 36;
  const MAX_CRACKS = 14;

  function resize() {
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    const r = arena.getBoundingClientRect();
    const nw = r.width;
    const nh = r.height;
    if (nw === w && nh === h && nextDpr === dpr && canvas.width) return;
    dpr = nextDpr;
    w = nw;
    h = nh;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function addCrack(x, y, power) {
    const rays = 5 + ((Math.random() * 5) | 0);
    const segs = [];
    for (let i = 0; i < rays; i++) {
      const ang = (Math.PI * 2 * i) / rays + rand(-0.25, 0.25);
      const len = (40 + power * 50) * rand(0.7, 1.3);
      const pts = [{ x: x, y: y }];
      let cx = x, cy = y;
      const steps = 3 + ((Math.random() * 3) | 0);
      for (let s = 0; s < steps; s++) {
        const a = ang + rand(-0.35, 0.35);
        const step = len / steps;
        cx += Math.cos(a) * step;
        cy += Math.sin(a) * step;
        pts.push({ x: cx, y: cy });
        if (Math.random() < 0.35) {
          const branch = a + rand(-0.9, 0.9);
          pts.push({
            x: cx + Math.cos(branch) * step * 0.55,
            y: cy + Math.sin(branch) * step * 0.55,
            branch: true,
          });
          pts.push({ x: cx, y: cy });
        }
      }
      segs.push(pts);
    }
    if (cracks.length >= MAX_CRACKS) cracks.shift();
    cracks.push({ segs: segs, life: 1, x: x, y: y, grow: 0 });
  }

  function spawnShards(x, y, n, combo) {
    const q = V.getJuiceQuality ? V.getJuiceQuality() : 3;
    const softCap = q <= 1 ? 12 : q === 2 ? 20 : 28;
    const count = Math.min(softCap, n + Math.min(10, (combo || 0)));
    for (let i = 0; i < count; i++) {
      if (shards.length >= MAX_SHARDS) shards.shift();
      const ang = rand(0, Math.PI * 2);
      const sp = rand(2, 9);
      shards.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 2,
        rot: rand(0, Math.PI),
        vr: rand(-0.3, 0.3),
        w: rand(8, 28),
        h: rand(6, 18),
        life: 1,
        alpha: 0.7 + Math.random() * 0.3,
      });
    }
  }

  function smash(clientX, clientY) {
    ensureLoop();
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    hits++;
    const st = V.recordHit("glass", { vibrateMs: 0, comboWindowMs: 800 });
    const power = 0.8 + Math.min(1.4, st.combo * 0.12);
    addCrack(x, y, power);
    spawnShards(x, y, 6 + (st.combo >= 5 ? 4 : 0), st.combo);

    V.playCrack(st.combo >= 6 || hits % 8 === 0);
    V.playThud(0.7 + Math.min(1.2, st.combo * 0.1));
    V.vibeHit(st.combo >= 6 ? "heavy" : "hit");
    V.screenShake(stage, 1.0 + Math.min(1.5, st.combo / 7), st.combo);
    V.hitStop(st.combo >= 5 ? 12 : 8);
    V.impactFlash(stage, { heavy: st.combo >= 7, chromatic: st.combo >= 8 });
    if (st.combo >= 3 || hits % 2 === 0) {
      V.spawnFloatingText(stage, st.combo >= 6 ? "粉碎 +" + st.combo : "咔 +" + (4 + st.combo), x, y, {
        px: true,
        critical: st.combo >= 7,
      });
    }
    V.createParticleBurst(stage, x, y, {
      count: 5 + Math.min(4, st.combo),
      dist: 50 + st.combo * 4,
      big: true,
      colors: ["#c8e8ff", "#5ce1e6", "#f4e8d8", "#fff"],
    });

    if (hits >= 12 && !broken) {
      broken = true;
      // big shatter cascade
      const cascade = (V.getJuiceQuality && V.getJuiceQuality() <= 1) ? 3 : 5;
      for (let i = 0; i < cascade; i++) {
        spawnShards(rand(w * 0.15, w * 0.85), rand(h * 0.15, h * 0.85), 6, st.combo);
      }
      V.playBurst();
      V.vibeHit("burst");
      V.screenShake(stage, 2.8, 10);
      V.impactFlash(stage, { heavy: true, chromatic: true });
      V.spawnFloatingText(stage, "整面碎裂！", w / 2, h / 2, { px: true, critical: true });
    }

    V.setHud(hud, "次数 " + hits + " · 连击 " + st.combo + " · 最佳 " + st.bestCombo + (broken ? " · 已碎透" : ""));
  }

  function clearGlass() {
    cracks = [];
    shards = [];
    hits = 0;
    broken = false;
    V.playWhoosh();
    V.setHud(hud, "已清屏 · 再砸一块新玻璃");
  }

  function draw() {
    const freezing = V.isHitStopping && V.isHitStopping();
    ctx.clearRect(0, 0, w, h);
    // glass sheen
    ctx.fillStyle = "rgba(180, 210, 240, 0.06)";
    ctx.fillRect(0, 0, w, h);

    for (const c of cracks) {
      if (!freezing) c.grow = Math.min(1, c.grow + 0.08);
      ctx.strokeStyle = "rgba(220, 235, 255, " + (0.55 + c.life * 0.35) + ")";
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      for (const pts of c.segs) {
        const max = Math.max(2, Math.floor(pts.length * c.grow));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < max; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      // impact star
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3 + c.grow * 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
    }

    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      if (!freezing) {
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.32;
        s.rot += s.vr;
        s.life -= 0.018;
      }
      if (s.life <= 0) {
        shards.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.life * s.alpha);
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      ctx.moveTo(-s.w / 2, -s.h / 2);
      ctx.lineTo(s.w / 2, -s.h / 3);
      ctx.lineTo(s.w / 3, s.h / 2);
      ctx.lineTo(-s.w / 3, s.h / 2);
      ctx.closePath();
      ctx.fillStyle = "rgba(200, 230, 255, 0.75)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  function loop() {
    if (!running) return;
    draw();
    if (!document.hidden) raf = requestAnimationFrame(loop);
    else raf = 0;
  }

  resize();
  V.setHud(hud, "次数 0 · 点屏幕砸出裂纹");
  function ensureLoop() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureLoop(); });
  ensureLoop();
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
      smash(e.clientX, e.clientY);
    },
    { passive: false }
  );
  clearBtn.addEventListener("click", () => {
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    clearGlass();
  });
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    running = false;
    cancelAnimationFrame(raf);
  });
})();
