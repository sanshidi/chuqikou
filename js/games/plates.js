/**
 * 砸盘子 — Rage Pit lite: drifting/falling plates, tap to shatter, boss plates
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const arena = document.createElement("div");
  arena.className = "plates-arena";
  arena.innerHTML = '<canvas id="platesCanvas"></canvas><div class="plates-fire" id="platesFire">🔥</div>';
  stage.appendChild(arena);

  const canvas = document.getElementById("platesCanvas");
  const fireEl = document.getElementById("platesFire");
  const ctx = canvas.getContext("2d");

  let w = 0, h = 0, dpr = 1;
  let plates = [];
  let particles = [];
  let smashed = 0;
  let running = true;
  let raf = 0;
  let spawnAcc = 0;
  let camPunch = 0;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  const MAX_PARTICLES = 40;
  let alivePlates = 0;

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

  function pushParticle(obj) {
    if (particles.length >= MAX_PARTICLES) {
      // drop oldest dust first, else shift
      let dropped = false;
      for (let i = 0; i < particles.length; i++) {
        if (particles[i].dust) {
          particles.splice(i, 1);
          dropped = true;
          break;
        }
      }
      if (!dropped) particles.shift();
    }
    particles.push(obj);
  }

  function spawnPlate(fromTop) {
    const boss = Math.random() < 0.12;
    const size = boss ? rand(58, 78) : rand(32, 52);
    return {
      x: rand(size + 8, w - size - 8),
      y: fromTop ? -size : rand(size + 20, h - size - 20),
      r: size,
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.04, 0.04),
      vx: rand(-0.6, 0.6),
      vy: fromTop ? rand(0.8, 2.2) : rand(-0.25, 0.25),
      hue: boss ? rand(200, 280) : rand(0, 45),
      alive: true,
      boss: boss,
      hp: boss ? (Math.random() < 0.5 ? 3 : 2) : 1,
      cracked: false,
    };
  }

  function shatter(p, combo) {
    const q = V.getJuiceQuality ? V.getJuiceQuality() : 3;
    const cap = q <= 1 ? 18 : q === 2 ? 28 : 36;
    const shardN = Math.min(cap, 8 + (combo || 1) + (p.boss ? 6 : 0));
    for (let i = 0; i < shardN; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(3.2, 11) * (p.boss ? 1.45 : 1.15);
      pushParticle({
        x: p.x,
        y: p.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 2.5,
        life: 1,
        rot: rand(0, Math.PI),
        vr: rand(-0.25, 0.25),
        w: rand(5, 16),
        h: rand(4, 11),
        hue: p.hue,
        dust: Math.random() < 0.3,
      });
    }
  }

  function hitPlate(p) {
    if (!p.alive) return;
    if (p.boss && p.hp > 1) {
      p.hp--;
      p.cracked = true;
      p.vr += rand(-0.1, 0.1);
      V.playCrack(false);
      V.vibeHit("hit");
      V.screenShake(stage, 1.1, 2);
      V.hitStop(10);
      V.impactFlash(stage, {});
      V.spawnFloatingText(stage, "裂纹！", p.x, p.y, { px: true });
      const dustN = (V.getJuiceQuality && V.getJuiceQuality() <= 1) ? 4 : 8;
      for (let i = 0; i < dustN; i++) {
        const ang = rand(0, Math.PI * 2);
        pushParticle({
          x: p.x, y: p.y,
          vx: Math.cos(ang) * rand(1.5, 4),
          vy: Math.sin(ang) * rand(1.5, 4),
          life: 0.75, rot: 0, vr: 0, w: 4, h: 4, hue: p.hue, dust: true,
        });
      }
      return;
    }
    p.alive = false;
    smashed++;
    const st = V.recordHit("plates", { vibrateMs: 0 });
    shatter(p, st.combo);
    V.playCrack(!!p.boss);
    if (st.combo >= 2) V.playThud(1.1 + Math.min(1, st.combo / 10));
    if (p.boss) {
      V.playBurst();
      V.vibeHit("boss");
      V.hitStop(14);
      V.impactFlash(stage, { heavy: true, chromatic: true });
    } else {
      V.vibeHit(st.combo >= 5 ? "heavy" : "hit");
      V.hitStop(st.combo >= 6 ? 12 : 8);
      V.impactFlash(stage, { heavy: st.combo >= 6, chromatic: st.combo >= 8 });
    }
    camPunch = p.boss ? 14 : 7 + Math.min(6, st.combo * 0.5);
    V.screenShake(stage, p.boss ? 2.6 : 1.2 + Math.min(1.2, st.combo / 8), st.combo);
    const label = p.boss ? "大盘粉碎 +" + (24 + st.combo) : (st.combo >= 5 ? "连击 x" + st.combo : "+" + (6 + Math.min(18, st.combo)));
    if (p.boss || st.combo >= 2 || Math.random() > 0.35) {
      V.spawnFloatingText(stage, label, p.x, p.y, { px: true, critical: !!p.boss || st.combo >= 7 });
    }
    V.createParticleBurst(stage, p.x, p.y, {
      count: p.boss ? 12 : 6,
      big: true,
      star: !!p.boss,
      dist: p.boss ? 100 : 55,
      colors: ["#ffe566", "#ff3d7f", "#f4e8d8", "#5ce1e6"],
    });
    fireEl.classList.toggle("on", st.combo >= 5);
    V.setHud(
      hud,
      "砸碎 " + smashed + " · 连击 " + st.combo + (st.combo >= 5 ? " 燃" : "") + " · 最佳 " + st.bestCombo
    );
  }

  function drawPlate(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r, p.r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = p.boss ? "hsl(" + p.hue + ", 65%, 70%)" : "hsl(" + p.hue + ", 70%, 85%)";
    ctx.fill();
    ctx.strokeStyle = p.cracked ? "rgba(255,61,127,0.9)" : "hsl(" + p.hue + ", 40%, 45%)";
    ctx.lineWidth = p.boss ? 3 : 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, p.r * 0.45, p.r * 0.32, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(42,31,61,0.28)";
    ctx.stroke();
    if (p.cracked) {
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.5, -p.r * 0.1);
      ctx.lineTo(0, p.r * 0.15);
      ctx.lineTo(p.r * 0.4, -p.r * 0.2);
      ctx.strokeStyle = "rgba(20,10,30,0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (p.boss) {
      ctx.fillStyle = "rgba(12,10,18,0.55)";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("大", 0, 5);
    }
    ctx.restore();
  }

  let last = performance.now();
  function loop(t) {
    if (!running) return;
    const dt = Math.min(32, t - last);
    last = t;
    const freezing = V.isHitStopping && V.isHitStopping();
    spawnAcc += freezing ? 0 : dt;
    // recount occasionally via spawn path
    if (!freezing) {
      let live = 0;
      for (let i = 0; i < plates.length; i++) if (plates[i].alive) live++;
      alivePlates = live;
      if (alivePlates < 7 && spawnAcc > 700) {
        spawnAcc = 0;
        plates.push(spawnPlate(Math.random() < 0.55));
        // compact dead plates when array grows
        if (plates.length > 24) plates = plates.filter((p) => p.alive);
      }
    }

    ctx.save();
    if (!freezing && camPunch > 0.2) {
      const ox = (Math.random() - 0.5) * camPunch;
      const oy = (Math.random() - 0.5) * camPunch;
      ctx.translate(ox, oy);
      camPunch *= 0.82;
    } else if (freezing) {
      /* hold camera during hit-stop */
    } else camPunch = 0;
    ctx.clearRect(-20, -20, w + 40, h + 40);

    const step = freezing ? 0 : dt / 16;
    for (const p of plates) {
      if (!p.alive) continue;
      if (step) {
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.rot += p.vr * step;
        if (p.x < p.r) { p.x = p.r; p.vx *= -1; }
        if (p.x > w - p.r) { p.x = w - p.r; p.vx *= -1; }
        if (p.y > h + p.r + 40) p.alive = false;
      }
      if (p.alive) drawPlate(p);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      if (!freezing) {
        q.x += q.vx;
        q.y += q.vy;
        q.vy += 0.3;
        q.rot += q.vr;
        q.life -= q.dust ? 0.045 : 0.026;
      }
      if (q.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, q.life);
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = q.dust
        ? "rgba(200,190,180," + q.life + ")"
        : "hsl(" + q.hue + ", 70%, 78%)";
      ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
      ctx.restore();
    }
    ctx.restore();

    if (!document.hidden) raf = requestAnimationFrame(loop);
    else raf = 0;
  }

  function onPointer(e) {
    e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || 0) - rect.left;
    const y = (e.clientY || 0) - rect.top;
    for (let i = plates.length - 1; i >= 0; i--) {
      const p = plates[i];
      if (!p.alive) continue;
      const dx = x - p.x;
      const dy = y - p.y;
      if ((dx * dx) / (p.r * p.r) + (dy * dy) / (p.r * 0.72 * p.r * 0.72) <= 1.2) {
        hitPlate(p);
        break;
      }
    }
  }

  resize();
  for (let i = 0; i < 6; i++) plates.push(spawnPlate(false));
  plates.push(spawnPlate(true));
  V.setHud(hud, "砸碎 0 · 瞄准飞盘 · 点屏猛砸");
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !raf) raf = requestAnimationFrame(loop);
  });
  raf = requestAnimationFrame(loop);
  canvas.addEventListener("pointerdown", onPointer, { passive: false });
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    running = false;
    cancelAnimationFrame(raf);
  });
})();
