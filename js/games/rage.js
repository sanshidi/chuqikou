/**
 * 键盘宣泄 — frantic mash / key spam → explode release
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  const WORDS = ["啊！", "怒！", "滚！", "烦！", "够了！", "！！", "哼", "哈", "气！", "炸！", "嘶", "吼"];
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

  const MAX_LETTERS = 28;
  let letterAlive = 0;

  function spawnLetter(ch, x, y, wild) {
    if (V.reducedMotion()) return;
    if (letterAlive >= MAX_LETTERS) {
      const oldEl = mashZone.querySelector(".rage-letter");
      if (oldEl) {
        try { oldEl.remove(); } catch (_) {}
        letterAlive = Math.max(0, letterAlive - 1);
      } else return;
    }
    const el = document.createElement("span");
    el.className = "rage-letter";
    el.textContent = ch;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.fontSize = (1.2 + Math.random() * (wild ? 1.6 : 0.8)) + "rem";
    el.style.color = wild
      ? ["#ff3d7f", "#ffe566", "#5ce1e6", "#fff"][(Math.random() * 4) | 0]
      : "#ff3d7f";
    el.style.setProperty("--lx", (Math.random() * 140 - 70).toFixed(0) + "px");
    el.style.setProperty("--ly", (-80 - Math.random() * 100).toFixed(0) + "px");
    el.style.setProperty("--lr", (Math.random() * 80 - 40).toFixed(0) + "deg");
    mashZone.appendChild(el);
    letterAlive++;
    setTimeout(() => {
      try { el.remove(); } catch (_) {}
      letterAlive = Math.max(0, letterAlive - 1);
    }, 800);
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
    V.recordHit("rage", { vibrateMs: 0, comboWindowMs: 350 });
    V.playTick();
    if (meter > 70) V.playThud(0.45 + (meter - 70) / 80);
    V.screenShake(stage, 0.45 + n * 0.08 + meter / 120, Math.floor(meter / 15));
    if (meter > 85) V.vibeHit("tap");
    else V.vibrate(6);

    const rect = mashZone.getBoundingClientRect();
    const x = clientX != null ? clientX - rect.left : randIn(rect.width);
    const y = clientY != null ? clientY - rect.top : randIn(rect.height);
    const ch = keyLabel || WORDS[(Math.random() * WORDS.length) | 0];
    spawnLetter(ch, x, y, meter > 60);
    if (meter > 50 && Math.random() < 0.4) {
      spawnLetter(WORDS[(Math.random() * WORDS.length) | 0], randIn(rect.width), randIn(rect.height), true);
    }

    if (meter >= 100) {
      prompt.textContent = "满了！再按一下释放！！";
      fill.style.boxShadow = "0 0 28px #ffe566";
      arena.classList.add("combo-flash");
      V.impactFlash(stage, { chromatic: true });
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
    V.playCrack(true);
    V.vibeHit("burst");
    V.screenShake(stage, 3.0, 12);
    V.hitStop(26);
    V.impactFlash(stage, { heavy: true, chromatic: true });
    V.createParticleBurst(stage, stage.clientWidth / 2, stage.clientHeight / 2, {
      count: 24,
      dist: 140,
      star: true,
      big: true,
      colors: ["#ff3d7f", "#ffe566", "#5ce1e6", "#f4e8d8", "#fff"],
      ms: 1000,
    });
    const letterN = (V.getJuiceQuality && V.getJuiceQuality() <= 1) ? 8 : 14;
    for (let i = 0; i < letterN; i++) {
      setTimeout(() => {
        spawnLetter(WORDS[i % WORDS.length], randIn(mashZone.clientWidth), randIn(mashZone.clientHeight), true);
      }, i * 28);
    }
    prompt.textContent = "呼——再来一轮";
    updateHud();
    setTimeout(() => {
      releasing = false;
      prompt.textContent = "狂按键盘或猛点下方区域";
      burst.classList.remove("go");
      crack.classList.remove("go");
    }, 800);
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" || e.key === "Tab") return;
    e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    if (meter >= 100) { release(); return; }
    const label = e.key.length === 1 ? e.key.toUpperCase() : WORDS[(Math.random() * WORDS.length) | 0];
    addRage(3.2, label);
  }

  function onPointer(e) {
    e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    if (meter >= 100) { release(); return; }
    addRage(4.2, null, e.clientX, e.clientY);
  }

  window.addEventListener("keydown", onKey);
  mashZone.addEventListener("pointerdown", onPointer, { passive: false });
  arena.addEventListener("pointerdown", (e) => {
    if (e.target === mashZone) return;
    if (meter >= 100) {
      e.preventDefault();
      release();
    }
  });

  setTimeout(() => {
    try { mashZone.focus(); } catch (_) {}
  }, 100);
})();
