/**
 * 出气口 — mini-games (abstract objects only)
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
    reset();
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", resize);
    };
  };

  /* ========== 4. 气球扎破 ========== */
  Games.balloons = function (stage, vent) {
    clearStage(stage);
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let w, h, balloons, popped, raf, running, spawnAcc;

    function resize() {
      const r = stage.getBoundingClientRect();
      w = canvas.width = Math.floor(r.width * devicePixelRatio);
      h = canvas.height = Math.floor(r.height * devicePixelRatio);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function spawn() {
      const cssW = w / devicePixelRatio;
      const cssH = h / devicePixelRatio;
      const colors = ["#ff3d7f", "#5ce1e6", "#ffe566", "#c4a8ff", "#ff8fab"];
      balloons.push({
        x: rand(30, cssW - 30),
        y: cssH + rand(20, 80),
        r: rand(22, 36),
        vy: -rand(1.2, 2.4),
        vx: rand(-0.4, 0.4),
        color: colors[(Math.random() * colors.length) | 0],
        alive: true,
      });
    }

    function reset() {
      resize();
      balloons = [];
      popped = 0;
      spawnAcc = 0;
      for (let i = 0; i < 5; i++) spawn();
      vent.setStat("扎破 0 个");
    }

    function loop() {
      if (!running) return;
      const cssW = w / devicePixelRatio;
      const cssH = h / devicePixelRatio;
      ctx.clearRect(0, 0, cssW, cssH);
      spawnAcc++;
      if (spawnAcc > 45) {
        spawnAcc = 0;
        spawn();
      }
      for (let i = balloons.length - 1; i >= 0; i--) {
        const b = balloons[i];
        if (!b.alive) {
          balloons.splice(i, 1);
          continue;
        }
        b.x += b.vx;
        b.y += b.vy;
        if (b.y + b.r < 0) {
          balloons.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + b.r);
        ctx.lineTo(b.x, b.y + b.r + 18);
        ctx.strokeStyle = "rgba(244,232,216,0.5)";
        ctx.stroke();
        ctx.restore();
      }
      raf = requestAnimationFrame(loop);
    }

    function onPointer(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (let i = balloons.length - 1; i >= 0; i--) {
        const b = balloons[i];
        if (!b.alive) continue;
        const dx = x - b.x;
        const dy = y - b.y;
        if (dx * dx + dy * dy < b.r * b.r) {
          b.alive = false;
          popped++;
          vent.playPop();
          vent.setStat("扎破 " + popped + " 个");
          break;
        }
      }
    }

    running = true;
    reset();
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);

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

  /* ========== 7. 碎纸机 ========== */
  Games.shredder = function (stage, vent) {
    clearStage(stage);
    let jobs = 0;
    const wrap = document.createElement("div");
    wrap.className = "shredder-stage";
    wrap.innerHTML =
      '<textarea class="shredder-input" id="shredIn" rows="3" maxlength="500" placeholder="把烦心事写进来，或拖选中的文字到下面…"></textarea>' +
      '<div class="shredder-slot" id="shredSlot" tabindex="0">' +
      '<p style="margin:0;color:#9b8fb0;font-size:0.85rem;z-index:1">丢进碎纸口</p>' +
      '<div class="shredder-blades"></div>' +
      '<div class="shred-strips" id="shredStrips"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>' +
      "</div>" +
      '<button type="button" class="neon-btn magenta" id="btnDoShred" style="width:100%">粉碎</button>';
    stage.appendChild(wrap);
    const input = wrap.querySelector("#shredIn");
    const slot = wrap.querySelector("#shredSlot");
    const strips = wrap.querySelector("#shredStrips");
    const btn = wrap.querySelector("#btnDoShred");
    vent.setStat("已粉碎 0 次");

    function doShred() {
      const t = input.value.trim();
      if (!t) {
        input.focus();
        return;
      }
      jobs++;
      vent.playCrack();
      vent.playWhoosh();
      strips.classList.remove("go");
      void strips.offsetWidth;
      strips.classList.add("go");
      input.value = "";
      vent.setStat("已粉碎 " + jobs + " 次");
    }

    btn.addEventListener("click", doShred);

    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
      slot.classList.add("is-dragover");
    });
    slot.addEventListener("dragleave", () => slot.classList.remove("is-dragover"));
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      slot.classList.remove("is-dragover");
      const text = e.dataTransfer.getData("text/plain");
      if (text) {
        input.value = (input.value + " " + text).trim().slice(0, 500);
        doShred();
      }
    });

    return () => {};
  };

  /* ========== 8. 消火 (whack) ========== */
  Games.whack = function (stage, vent) {
    clearStage(stage);
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let w, h, fires, hit, missed, raf, running, tick;

    const ICONS = ["🔥", "💢", "☁️", "⚡"];

    function resize() {
      const r = stage.getBoundingClientRect();
      w = canvas.width = Math.floor(r.width * devicePixelRatio);
      h = canvas.height = Math.floor(r.height * devicePixelRatio);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function spawn() {
      const cssW = w / devicePixelRatio;
      const cssH = h / devicePixelRatio;
      const cols = 4;
      const rows = 3;
      const cw = cssW / cols;
      const ch = cssH / rows;
      const c = (Math.random() * cols) | 0;
      const r = (Math.random() * rows) | 0;
      fires.push({
        x: c * cw + cw / 2,
        y: r * ch + ch / 2,
        life: 1.2,
        icon: ICONS[(Math.random() * ICONS.length) | 0],
        r: 28,
      });
    }

    function reset() {
      resize();
      fires = [];
      hit = 0;
      missed = 0;
      tick = 0;
      vent.setStat("灭火 0 · 漏掉 0");
    }

    function loop() {
      if (!running) return;
      const cssW = w / devicePixelRatio;
      const cssH = h / devicePixelRatio;
      ctx.clearRect(0, 0, cssW, cssH);
      // holes
      const cols = 4;
      const rows = 3;
      const cw = cssW / cols;
      const ch = cssH / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + cw / 2;
          const y = r * ch + ch / 2;
          ctx.beginPath();
          ctx.ellipse(x, y + 12, 28, 10, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(12,10,18,0.6)";
          ctx.fill();
          ctx.strokeStyle = "rgba(92,225,230,0.2)";
          ctx.stroke();
        }
      }

      tick++;
      if (tick % 40 === 0) spawn();

      for (let i = fires.length - 1; i >= 0; i--) {
        const f = fires[i];
        f.life -= 0.016;
        if (f.life <= 0) {
          fires.splice(i, 1);
          missed++;
          vent.setStat("灭火 " + hit + " · 漏掉 " + missed);
          continue;
        }
        const rise = Math.min(1, (1.2 - f.life) * 3);
        ctx.font = "32px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.fillText(f.icon, f.x, f.y - rise * 20);
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(loop);
    }

    function onPointer(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (let i = fires.length - 1; i >= 0; i--) {
        const f = fires[i];
        const dx = x - f.x;
        const dy = y - f.y;
        if (dx * dx + dy * dy < 40 * 40) {
          fires.splice(i, 1);
          hit++;
          vent.playPop();
          vent.setStat("灭火 " + hit + " · 漏掉 " + missed);
          break;
        }
      }
    }

    running = true;
    reset();
    canvas.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", resize);
    };
  };

  /* ========== 9. 甩飞便签 ========== */
  Games.notes = function (stage, vent) {
    clearStage(stage);
    const wrap = document.createElement("div");
    wrap.className = "notes-stage";
    stage.appendChild(wrap);
    let flung = 0;
    const phrases = [
      "别管了",
      "烦死了",
      "再说吧",
      "关我屁事",
      "滚出去",
      "不想理",
      "累了",
      "随便",
      "哼",
      "走开",
    ];
    vent.setStat("甩飞 0 张");

    const notes = [];
    const cssW = () => wrap.clientWidth;
    const cssH = () => wrap.clientHeight;

    function placeNotes() {
      wrap.innerHTML = "";
      notes.length = 0;
      for (let i = 0; i < 8; i++) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "sticky-note";
        el.textContent = phrases[i % phrases.length];
        const rot = rand(-12, 12);
        el.style.setProperty("--rot", rot + "deg");
        const x = rand(8, Math.max(20, cssW() - 110));
        const y = rand(8, Math.max(20, cssH() - 100));
        el.style.left = x + "px";
        el.style.top = y + "px";
        wrap.appendChild(el);
        notes.push({ el, x, y, vx: 0, vy: 0 });
        bindNote(el, notes[notes.length - 1]);
      }
    }

    function bindNote(el, data) {
      let dragging = false;
      let px = 0;
      let py = 0;
      let lx = 0;
      let ly = 0;
      let lt = 0;

      function down(e) {
        e.preventDefault();
        dragging = true;
        el.classList.add("is-dragging");
        el.setPointerCapture(e.pointerId);
        px = e.clientX;
        py = e.clientY;
        lx = e.clientX;
        ly = e.clientY;
        lt = performance.now();
        data.vx = 0;
        data.vy = 0;
      }

      function move(e) {
        if (!dragging) return;
        const dx = e.clientX - px;
        const dy = e.clientY - py;
        data.x += dx;
        data.y += dy;
        el.style.left = data.x + "px";
        el.style.top = data.y + "px";
        const now = performance.now();
        const dt = Math.max(1, now - lt);
        data.vx = ((e.clientX - lx) / dt) * 16;
        data.vy = ((e.clientY - ly) / dt) * 16;
        px = e.clientX;
        py = e.clientY;
        lx = e.clientX;
        ly = e.clientY;
        lt = now;
      }

      function up(e) {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("is-dragging");
        const speed = Math.hypot(data.vx, data.vy);
        if (speed > 8) {
          el.classList.add("is-flung");
          const fx = data.vx * 40;
          const fy = data.vy * 40;
          el.style.transform = "translate(" + fx + "px," + fy + "px) rotate(" + rand(-40, 40) + "deg)";
          vent.playWhoosh();
          flung++;
          vent.setStat("甩飞 " + flung + " 张");
          setTimeout(() => {
            el.remove();
            if (wrap.querySelectorAll(".sticky-note:not(.is-flung)").length === 0) {
              vent.setStat("甩飞 " + flung + " 张 · 桌面清了");
            }
          }, 450);
        }
      }

      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }

    // wait a frame for layout
    requestAnimationFrame(placeNotes);

    return () => {
      wrap.innerHTML = "";
    };
  };

  /* ========== 10. 碎砖块 breakout ========== */
  Games.breakout = function (stage, vent) {
    clearStage(stage);
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let w, h, cssW, cssH, raf, running;
    let paddle, ball, bricks, score, lives;

    function resize() {
      const r = stage.getBoundingClientRect();
      cssW = r.width;
      cssH = r.height;
      w = canvas.width = Math.floor(cssW * devicePixelRatio);
      h = canvas.height = Math.floor(cssH * devicePixelRatio);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    function buildBricks() {
      bricks = [];
      const cols = 7;
      const rows = 4;
      const pad = 4;
      const bw = (cssW - pad * (cols + 1)) / cols;
      const bh = 16;
      const colors = ["#ff3d7f", "#5ce1e6", "#ffe566", "#c4a8ff"];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          bricks.push({
            x: pad + c * (bw + pad),
            y: 24 + r * (bh + pad),
            w: bw,
            h: bh,
            color: colors[r % colors.length],
            alive: true,
          });
        }
      }
    }

    function resetBall() {
      ball = {
        x: cssW / 2,
        y: cssH - 60,
        vx: rand(-2.5, 2.5) || 2,
        vy: -3.2,
        r: 7,
      };
    }

    function reset() {
      resize();
      paddle = { w: 72, h: 12, x: cssW / 2 - 36, y: cssH - 28 };
      score = 0;
      lives = 3;
      buildBricks();
      resetBall();
      vent.setStat("砖 0 · 命 " + lives);
    }

    function loop() {
      if (!running) return;
      ctx.clearRect(0, 0, cssW, cssH);

      // bricks
      let left = 0;
      for (const b of bricks) {
        if (!b.alive) continue;
        left++;
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 8;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.shadowBlur = 0;
      }
      if (left === 0) {
        buildBricks();
        vent.setStat("清屏！砖 " + score + " · 命 " + lives);
      }

      // paddle
      ctx.fillStyle = "#f4e8d8";
      ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);

      // ball
      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.x < ball.r || ball.x > cssW - ball.r) ball.vx *= -1;
      if (ball.y < ball.r) ball.vy *= -1;
      if (
        ball.y + ball.r > paddle.y &&
        ball.y - ball.r < paddle.y + paddle.h &&
        ball.x > paddle.x &&
        ball.x < paddle.x + paddle.w
      ) {
        ball.vy = -Math.abs(ball.vy);
        ball.vx += (ball.x - (paddle.x + paddle.w / 2)) * 0.08;
        vent.playTick();
      }
      if (ball.y > cssH + 20) {
        lives--;
        if (lives <= 0) {
          vent.setStat("砖 " + score + " · 再来一局吧");
          resetBall();
          lives = 3;
          score = 0;
          buildBricks();
        } else {
          resetBall();
          vent.setStat("砖 " + score + " · 命 " + lives);
        }
      }

      for (const b of bricks) {
        if (!b.alive) continue;
        if (
          ball.x + ball.r > b.x &&
          ball.x - ball.r < b.x + b.w &&
          ball.y + ball.r > b.y &&
          ball.y - ball.r < b.y + b.h
        ) {
          b.alive = false;
          ball.vy *= -1;
          score++;
          vent.playCrack();
          vent.setStat("砖 " + score + " · 命 " + lives);
          break;
        }
      }

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3d7f";
      ctx.shadowColor = "#ff3d7f";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(loop);
    }

    function movePaddle(clientX) {
      const rect = canvas.getBoundingClientRect();
      paddle.x = Math.max(0, Math.min(cssW - paddle.w, clientX - rect.left - paddle.w / 2));
    }

    function onPointer(e) {
      e.preventDefault();
      movePaddle(e.clientX);
    }

    running = true;
    reset();
    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointermove", onPointer);
    window.addEventListener("resize", () => {
      const px = paddle.x / cssW;
      resize();
      paddle.y = cssH - 28;
      paddle.x = px * cssW;
    });
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onPointer);
    };
  };
})();
