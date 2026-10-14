/**
 * 敲木鱼 — calm rhythmic tap, merit accumulation (not rage)
 */
(function () {
  "use strict";
  const V = window.VentGameCore || window.Vent;
  const stage = document.getElementById("stage");
  const hud = document.getElementById("hudStats");
  V.bindMuteButton(document.getElementById("muteBtn"));

  let hits = 0;
  let lastHit = 0;
  let streak = 0;
  let bestStreak = 0;
  let merit = V.getGameStats("muyu").merit || 0;
  const reduced = V.reducedMotion();

  const arena = document.createElement("div");
  arena.className = "muyu-arena";
  arena.innerHTML =
    '<p class="muyu-line" id="muyuLine">一下一下，把心敲稳</p>' +
    '<button type="button" class="muyu-btn-xl" id="muyuBtn" aria-label="敲木鱼">' +
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
    "</svg>" +
    '<span class="muyu-mallet" aria-hidden="true"></span>' +
    "</button>" +
    '<p class="muyu-rhythm" id="muyuRhythm" aria-live="polite"></p>';
  stage.appendChild(arena);

  const btn = document.getElementById("muyuBtn");
  const line = document.getElementById("muyuLine");
  const rhythm = document.getElementById("muyuRhythm");
  const lines = [
    "一下一下，把心敲稳",
    "听见了，就够了",
    "不急，跟着自己的节奏",
    "咚……心就落回来一点",
    "敲着敲着，气就散了",
  ];

  function updateHud() {
    V.setHud(
      hud,
      "功德 " + merit + " · 本局 " + hits + (bestStreak >= 3 ? " · 稳拍 " + bestStreak : "")
    );
  }
  updateHud();

  function updateRhythm(gap) {
    if (!lastHit) {
      rhythm.textContent = "慢慢来就好";
      return;
    }
    if (gap >= 700 && gap <= 1400) {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      rhythm.textContent = streak >= 3 ? "节奏稳着 · 连着 " + streak + " 下" : "节奏刚刚好";
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

  function spawnMotes() {
    if (reduced) return;
    const r = btn.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2 - sr.left;
    const cy = r.top + r.height * 0.45 - sr.top;
    for (let i = 0; i < 6; i++) {
      const m = document.createElement("span");
      m.className = "muyu-mote";
      m.style.left = cx + (Math.random() * 40 - 20) + "px";
      m.style.top = cy + (Math.random() * 20 - 10) + "px";
      m.style.setProperty("--mx", (Math.random() * 50 - 25).toFixed(0) + "px");
      m.style.setProperty("--my", (-30 - Math.random() * 50).toFixed(0) + "px");
      stage.appendChild(m);
      setTimeout(() => {
        try { m.remove(); } catch (_) {}
      }, 1200);
    }
  }

  function hit(e) {
    if (e) e.preventDefault();
    if (V.unlockAudio) V.unlockAudio(false); else V.ensureAudio();
    const now = performance.now();
    if (lastHit && now - lastHit < 120) return;
    if (lastHit) updateRhythm(now - lastHit);
    else rhythm.textContent = "慢慢来就好";
    lastHit = now;
    hits++;
    merit++;
    V.setGameStat("muyu", { merit: merit });
    V.recordHit("muyu", { vibrateMs: 0, comboWindowMs: 1400 });
    V.playWoodChime();
    V.vibeHit("calm");

    const calm = Math.random() < 0.18;
    const r = btn.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const fx = r.left + r.width / 2 - sr.left + (Math.random() * 30 - 15);
    const fy = r.top - sr.top + 20;
    V.spawnFloatingText(stage, calm ? "心安" : (streak >= 8 ? "稳了 · 功德 +1" : "功德 +1"), fx, fy, { px: true, calm: true });
    // crisp float pop — tiny soft pulse, no rage shake
    if (!reduced) {
      V.createParticleBurst(stage, fx, fy + 30, {
        count: 3,
        dist: 28,
        colors: ["#5ce1e6", "#b8fff5", "#f4e8d8"],
        ms: 600,
      });
    }
    spawnMotes();

    if (hits % 5 === 0) line.textContent = lines[((hits / 5) | 0) % lines.length];

    btn.classList.remove("is-hit", "is-glow");
    void btn.offsetWidth;
    btn.classList.add("is-hit");
    if (!reduced) btn.classList.add("is-glow");
    setTimeout(() => btn.classList.remove("is-hit"), reduced ? 80 : 200);
    setTimeout(() => btn.classList.remove("is-glow"), reduced ? 100 : 520);
    updateHud();
  }

  btn.addEventListener("pointerdown", hit, { passive: false });
})();
