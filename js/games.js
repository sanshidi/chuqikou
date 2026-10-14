/**
 * 出气口 — mini-games (trimmed set)
 * Each factory(stage, vent) returns an optional cleanup function.
 */
(function () {
  "use strict";

  const Games = (window.VentGames = window.VentGames || {});

  function clearStage(stage) {
    stage.innerHTML = "";
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  /* ========== 1. 出气袋 ========== */
  Games.bag = function (stage, vent) {
    clearStage(stage);
    let count = 0;
    const wrap = document.createElement("div");
    wrap.className = "bag-stage";
    wrap.innerHTML =
      '<div class="bag-chain"></div>' +
      '<button type="button" class="punch-bag-btn" aria-label="出气袋">' +
      '<span class="bag-body"><span class="bag-face">😤</span></span></button>';
    stage.appendChild(wrap);
    const btn = wrap.querySelector(".punch-bag-btn");
    const face = wrap.querySelector(".bag-face");
    const faces = ["😤", "😠", "💢", "😮", "😳", "😌"];
    vent.setStat("已打 0 下");

    function hit() {
      count++;
      vent.setStat("已打 " + count + " 下");
      vent.playThud(Math.min(1, 0.4 + (count % 5) * 0.12));
      btn.classList.add("is-hit");
      face.textContent = faces[Math.min(faces.length - 1, Math.floor(count / 3) % faces.length)];
      setTimeout(() => btn.classList.remove("is-hit"), 90);
      if (count > 0 && count % 20 === 0) face.textContent = "😌";
    }

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      hit();
    });

    return () => {};
  };

  /* ========== 2. 泡泡膜 ========== */
  Games.bubble = function (stage, vent) {
    clearStage(stage);
    const cols = 6;
    const rows = 7;
    let popped = 0;
    const total = cols * rows;
    const grid = document.createElement("div");
    grid.className = "bubble-grid";
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    stage.appendChild(grid);
    vent.setStat("戳破 0 / " + total);

    for (let i = 0; i < total; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bubble";
      b.setAttribute("aria-label", "泡泡");
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (b.classList.contains("popped")) return;
        b.classList.add("popped");
        popped++;
        vent.playPop();
        vent.setStat("戳破 " + popped + " / " + total);
        if (popped >= total) vent.setStat("全破完了 · 再来一局？");
      });
      grid.appendChild(b);
    }
    return () => {};
  };

  /* ========== 3. 砸盘子 ========== */
  Games.plates = function (stage, vent) {
    clearStage(stage);
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let w, h, plates, particles, smashed, raf, running;

    function resize() {
      const r = stage.getBoundingClientRect();
      w = canvas.width = Math.floor(r.width * devicePixelRatio);
      h = canvas.height = Math.floor(r.height * devicePixelRatio);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function spawnPlate() {
      const size = rand(36, 58);
      return {
        x: rand(size, (w / devicePixelRatio) - size),
        y: rand(size + 10, (h / devicePixelRatio) - size - 10),
        r: size,
        rot: rand(0, Math.PI),
        hue: rand(0, 40),
        alive: true,
      };
    }

    function reset() {
      resize();
      plates = [];
      particles = [];
      smashed = 0;
      for (let i = 0; i < 8; i++) plates.push(spawnPlate());
      vent.setStat("砸碎 0 只");
    }

    function shatter(p, cx, cy) {
      p.alive = false;
      smashed++;
      vent.setStat("砸碎 " + smashed + " 只");
      vent.playCrack();
      for (let i = 0; i < 14; i++) {
        const ang = rand(0, Math.PI * 2);
        const sp = rand(2, 7);
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 2,
          life: 1,
          hue: p.hue,
        });
      }
      setTimeout(() => {
        if (!running) return;
        plates.push(spawnPlate());
      }, 400);
    }

    function drawPlate(p) {
      const cssW = w / devicePixelRatio;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = "hsl(" + p.hue + ", 70%, 85%)";
      ctx.fill();
      ctx.strokeStyle = "hsl(" + p.hue + ", 40%, 55%)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 0.45, p.r * 0.32, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(42,31,61,0.25)";
      ctx.stroke();
      ctx.restore();
    }

    function loop() {
      if (!running) return;
      const cssW = w / devicePixelRatio;
      const cssH = h / devicePixelRatio;
      ctx.clearRect(0, 0, cssW, cssH);
      for (const p of plates) if (p.alive) drawPlate(p);
      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.x += q.vx;
        q.y += q.vy;
        q.vy += 0.25;
        q.life -= 0.03;
        if (q.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = q.life;
        ctx.fillStyle = "hsl(" + q.hue + ", 70%, 80%)";
        ctx.fillRect(q.x, q.y, 5, 5);
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(loop);
    }

    function onPointer(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
      const y = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
      for (let i = plates.length - 1; i >= 0; i--) {
        const p = plates[i];
        if (!p.alive) continue;
        const dx = x - p.x;
        const dy = y - p.y;
        if ((dx * dx) / (p.r * p.r) + (dy * dy) / (p.r * 0.72 * p.r * 0.72) <= 1) {
          shatter(p, p.x, p.y);
          break;
        }
      }
    }

    running = true;
    requestAnimationFrame(() => {
      if (!running) return;
      reset();
      raf = requestAnimationFrame(loop);
    });
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", resize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", resize);
    };
  };

  /* ========== 5. 键盘宣泄 ========== */
  Games.rage = function (stage, vent) {
    clearStage(stage);
    let meter = 0;
    let bursts = 0;
    const wrap = document.createElement("div");
    wrap.className = "rage-stage";
    wrap.innerHTML =
      '<p class="rage-prompt" id="ragePrompt">狂按键盘或猛点这里</p>' +
      '<div class="rage-meter-track"><div class="rage-meter-fill" id="rageFill"></div></div>' +
      '<div class="rage-burst" id="rageBurst"></div>';
    stage.appendChild(wrap);
    wrap.style.position = "relative";
    const fill = wrap.querySelector("#rageFill");
    const prompt = wrap.querySelector("#ragePrompt");
    const burst = wrap.querySelector("#rageBurst");
    vent.setStat("怒气 0% · 爆发 0 次");

    function addRage(n) {
      if (meter >= 100) return;
      meter = Math.min(100, meter + n);
      fill.style.width = meter + "%";
      vent.setStat("怒气 " + Math.floor(meter) + "% · 爆发 " + bursts + " 次");
      vent.playTick();
      if (meter >= 100) {
        prompt.textContent = "满了！点一下释放！";
        fill.style.boxShadow = "0 0 24px #ffe566";
      }
    }

    function release() {
      if (meter < 100) return;
      bursts++;
      meter = 0;
      fill.style.width = "0%";
      fill.style.boxShadow = "";
      burst.classList.remove("go");
      void burst.offsetWidth;
      burst.classList.add("go");
      vent.playBurst();
      prompt.textContent = "呼——再来一轮";
      vent.setStat("怒气 0% · 爆发 " + bursts + " 次");
    }

    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Tab") return;
      e.preventDefault();
      if (meter >= 100) release();
      else addRage(3.5);
    }

    function onPointer(e) {
      e.preventDefault();
      if (meter >= 100) release();
      else addRage(4.5);
    }

    window.addEventListener("keydown", onKey);
    wrap.addEventListener("pointerdown", onPointer);

    return () => {
      window.removeEventListener("keydown", onKey);
      wrap.removeEventListener("pointerdown", onPointer);
    };
  };

  /* ========== 6. 捏压力球 ========== */
  Games.squeeze = function (stage, vent) {
    clearStage(stage);
    let squeezes = 0;
    const wrap = document.createElement("div");
    wrap.className = "squeeze-stage";
    const ball = document.createElement("button");
    ball.type = "button";
    ball.className = "squeeze-ball";
    ball.setAttribute("aria-label", "压力球，按住捏");
    wrap.appendChild(ball);
    stage.appendChild(wrap);
    vent.setStat("捏了 0 下");

    let pressing = false;
    let scaleX = 1;
    let scaleY = 1;
    let raf = null;

    function render() {
      ball.style.transform = "scale(" + scaleX + ", " + scaleY + ")";
    }

    function onDown(e) {
      e.preventDefault();
      pressing = true;
      ball.classList.add("is-squeezing");
      vent.playThud(0.5);
      const step = () => {
        if (!pressing) return;
        scaleX = Math.max(0.7, scaleX - 0.025);
        scaleY = Math.min(1.25, scaleY + 0.02);
        render();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function onUp() {
      if (!pressing) return;
      pressing = false;
      ball.classList.remove("is-squeezing");
      cancelAnimationFrame(raf);
      squeezes++;
      vent.setStat("捏了 " + squeezes + " 下");
      vent.playPop();
      scaleX = 1;
      scaleY = 1;
      render();
    }

    ball.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ball.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };

  /* ========== 11. 敲木鱼 ========== */
  Games.muyu = function (stage, vent) {
    clearStage(stage);
    let hits = 0;
    let lastHit = 0;
    let streak = 0;
    let bestStreak = 0;
    const reduced = vent.reducedMotion();

    const wrap = document.createElement("div");
    wrap.className = "muyu-stage";
    wrap.innerHTML =
      '<p class="muyu-line" id="muyuLine">一下一下，把心敲稳</p>' +
      '<button type="button" class="muyu-btn" id="muyuBtn" aria-label="敲木鱼">' +
      '<span class="muyu-glow" aria-hidden="true"></span>' +
      '<svg class="muyu-svg" viewBox="0 0 200 160" aria-hidden="true">' +
      '<ellipse cx="100" cy="118" rx="48" ry="10" fill="rgba(12,10,18,0.45)"/>' +
      '<path d="M42 88c0-38 26-68 58-68s58 30 58 68c0 8-6 14-18 18H60c-12-4-18-10-18-18z" fill="#c48a4a"/>' +
      '<path d="M50 86c4-32 24-56 50-56s46 24 50 56c0 6-4 10-12 13H62c-8-3-12-7-12-13z" fill="#e0a85c"/>' +
      '<path d="M78 52c8-6 18-8 28-6" fill="none" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round" opacity="0.55"/>' +
      '<ellipse cx="100" cy="78" rx="22" ry="16" fill="#9a6230"/>' +
      '<ellipse cx="100" cy="78" rx="12" ry="9" fill="#6e421c"/>' +
      '<circle cx="72" cy="70" r="4" fill="#8a5a2b" opacity="0.5"/>' +
      '<circle cx="128" cy="70" r="4" fill="#8a5a2b" opacity="0.5"/>' +
      '<path d="M148 40c18-8 28-4 34 8" fill="none" stroke="#d4a574" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="148" cy="40" r="7" fill="#b87a3a"/>' +
      '<circle cx="182" cy="48" r="6" fill="#e8c090"/>' +
      '</svg>' +
      '<span class="muyu-mallet" aria-hidden="true"></span>' +
      '</button>' +
      '<p class="muyu-rhythm" id="muyuRhythm" aria-live="polite"></p>';
    stage.appendChild(wrap);

    const btn = wrap.querySelector("#muyuBtn");
    const line = wrap.querySelector("#muyuLine");
    const rhythm = wrap.querySelector("#muyuRhythm");
    const lines = [
      "一下一下，把心敲稳",
      "听见了，就够了",
      "不急，跟着自己的节奏",
      "咚……心就落回来一点",
      "敲着敲着，气就散了",
    ];
    vent.setStat("敲了 0 下");

    function updateRhythm(gap) {
      // Gentle rhythm hint only — no score pressure
      if (!lastHit) {
        rhythm.textContent = "慢慢来就好";
        return;
      }
      if (gap >= 700 && gap <= 1400) {
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        if (streak >= 3) {
          rhythm.textContent = "节奏稳着 · 连着 " + streak + " 下";
        } else {
          rhythm.textContent = "节奏刚刚好";
        }
      } else if (gap < 450) {
        streak = 0;
        rhythm.textContent = "可以再慢一点";
      } else if (gap > 2000) {
        streak = 0;
        rhythm.textContent = "回来了就继续敲";
      } else {
        streak = 0;
        rhythm.textContent = "随意，没有错的拍子";
      }
    }

    function hit(e) {
      if (e) e.preventDefault();
      const now = performance.now();
      if (lastHit) updateRhythm(now - lastHit);
      else rhythm.textContent = "慢慢来就好";
      lastHit = now;
      hits++;
      vent.playWoodChime();
      vent.setStat("敲了 " + hits + " 下" + (bestStreak >= 3 ? " · 稳拍 " + bestStreak : ""));
      if (hits % 5 === 0) {
        line.textContent = lines[(hits / 5 | 0) % lines.length];
      }
      btn.classList.remove("is-hit", "is-glow");
      void btn.offsetWidth;
      btn.classList.add("is-hit");
      if (!reduced) btn.classList.add("is-glow");
      setTimeout(() => btn.classList.remove("is-hit"), reduced ? 80 : 180);
      setTimeout(() => btn.classList.remove("is-glow"), reduced ? 100 : 500);
    }

    btn.addEventListener("pointerdown", hit);

    return () => {
      btn.removeEventListener("pointerdown", hit);
    };
  };
})();
