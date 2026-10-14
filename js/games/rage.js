/**
 * 键盘宣泄 — frantic mash / key spam → explode release
 * Interaction: keydown OR pointer spam fills meter; at 100% release = full burst
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const WORDS = ["啊！", "怒！", "滚！", "烦！", "够了！", "！！", "哼", "哈"];
  let meter = 0;
  let bursts = V.getGameStats("rage").bursts || 0;
  let mashTimes = [];
  let peakRate = 0;
  let releasing = false;

  const arena = document.createElement("div");
  arena.className = "rage-arena";
  arena.innerHTML =
    '<p class="rage-prompt" id="ragePrompt">狂按键盘或猛点下方区域</p>' +
    '<div class="rage-meter-track"><div class="rage-meter-fill" id="rageFill"></div></div>' +
    '<div class="rage-mash-zone" id="mashZone" tabindex="0" aria-label="宣泄区"></div>' +
    '<div class="rage-burst-overlay" id="rageBurst"></div>' +
    '<div class="rage-crack" id="rageCrack"></div>';
  stage.appendChild(arena);

  const fill = document.getElementById("rageFill");
  const prompt = document.getElementById("ragePrompt");
  const mashZone = document.getElementById("mashZone");
  const burst = document.getElementById("rageBurst");
  const crack = document.getElementById("rageCrack");

  function updateHud() {
    V.setHud(hud, "怒气 " + Math.floor(meter) + "% · 爆发 " + bursts + " · 峰值 " + peakRate + "/秒");
  }
  updateHud();

  function trackRate() {
    const now = performance.now();
    mashTimes.push(now);
    mashTimes = mashTimes.filter((t) => now - t < 1000);
    peakRate = Math.max(peakRate, mashTimes.length);
  }

  function spawnLetter(ch, x, y) {
    if (V.reducedMotion()) return;
    const el = document.createElement("span");
    el.className = "rage-letter";
    el.textContent = ch;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.setProperty("--lx", (Math.random() * 80 - 40).toFixed(0) + "px");
    el.style.setProperty("--ly", (-60 - Math.random() * 70).toFixed(0) + "px");
    el.style.setProperty("--lr", (Math.random() * 50 - 25).toFixed(0) + "deg");
    mashZone.appendChild(el);
    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
    }, 750);
  }

  function addRage(n, keyLabel, clientX, clientY) {
    if (releasing || meter >= 100) {
      if (meter >= 100 && !releasing) {
        prompt.textContent = "满了！再按一下释放！！";
        fill.style.boxShadow = "0 0 28px #ffe566";
      }
      return;
    }
    meter = Math.min(100, meter + n);
    fill.style.width = meter + "%";
    trackRate();
    V.recordHit("rage", { vibrateMs: 5, comboWindowMs: 350 });
    V.playTick();
    V.screenShake(stage, 0.35 + n * 0.05);

    const rect = mashZone.getBoundingClientRect();
    const x = clientX != null ? clientX - rect.left : randIn(rect.width);
    const y = clientY != null ? clientY - rect.top : randIn(rect.height);
    const ch = keyLabel || WORDS[(Math.random() * WORDS.length) | 0];
    spawnLetter(ch, x, y);

    if (meter >= 100) {
      prompt.textContent = "满了！再按一下释放！！";
      fill.style.boxShadow = "0 0 28px #ffe566";
      arena.classList.add("combo-flash");
    }
    updateHud();
  }

  function randIn(m) {
    return 40 + Math.random() * Math.max(20, m - 80);
  }

  function release() {
    if (meter < 100 || releasing) return;
    releasing = true;
    bursts++;
    V.setGameStat("rage", { bursts: bursts });
    meter = 0;
    fill.style.width = "0%";
    fill.style.boxShadow = "";
    burst.classList.remove("go");
    crack.classList.remove("go");
    void burst.offsetWidth;
    burst.classList.add("go");
    crack.classList.add("go");
    V.playBurst();
    V.vibrate([20, 40, 30]);
    V.screenShake(stage, 2.2);
    V.createParticleBurst(stage, stage.clientWidth / 2, stage.clientHeight / 2, {
      count: 36,
      dist: 110,
      star: true,
      colors: ["#ff3d7f", "#ffe566", "#5ce1e6", "#f4e8d8"],
      ms: 900,
    });
    // flying overload letters
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        spawnLetter(WORDS[i % WORDS.length], randIn(mashZone.clientWidth), randIn(mashZone.clientHeight));
      }, i * 40);
    }
    prompt.textContent = "呼——再来一轮";
    updateHud();
    setTimeout(() => {
      releasing = false;
      prompt.textContent = "狂按键盘或猛点下方区域";
      burst.classList.remove("go");
      crack.classList.remove("go");
    }, 700);
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" || e.key === "Tab") return;
    e.preventDefault();
    V.ensureAudio();
    if (meter >= 100) {
      release();
      return;
    }
    const label =
      e.key.length === 1 ? e.key.toUpperCase() : WORDS[(Math.random() * WORDS.length) | 0];
    addRage(3.2, label);
  }

  function onPointer(e) {
    e.preventDefault();
    V.ensureAudio();
    if (meter >= 100) {
      release();
      return;
    }
    addRage(4.2, null, e.clientX, e.clientY);
  }

  window.addEventListener("keydown", onKey);
  mashZone.addEventListener("pointerdown", onPointer, { passive: false });
  arena.addEventListener("pointerdown", (e) => {
    if (e.target === mashZone) return;
    // allow tapping prompt/meter area too
    if (meter >= 100) {
      e.preventDefault();
      release();
    }
  });

  // focus mash zone for keyboard
  setTimeout(() => {
    try {
      mashZone.focus();
    } catch (_) {}
  }, 100);
})();
