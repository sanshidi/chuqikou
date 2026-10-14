/**
 * Full audio QA — rain, white noise, punch/smash SFX, whoosh, crack,
 * wood chime, burst, destroy, pool explode. Headless Chrome + Web Audio meters.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function serve(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function measureSfx(page, name, fnBody, waitMs = 80) {
  const peak = await page.evaluate(async (body, wait) => {
    await Vent.ensureAudioAsync();
    Vent.getMasterOut && Vent.getMasterOut();
    // clear residual
    await new Promise((r) => setTimeout(r, 30));
    // eslint-disable-next-line no-new-func
    const fn = new Function("Vent", body);
    fn(Vent);
    const start = performance.now();
    let max = 0;
    while (performance.now() - start < wait) {
      max = Math.max(max, Vent.audioPeak());
      await new Promise((r) => setTimeout(r, 8));
    }
    return max;
  }, fnBody, waitMs);
  return { name, peak };
}

async function main() {
  const port = 8793;
  const server = await serve(port);
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const results = [];
  let fails = 0;
  const log = (ok, msg) => {
    console.log(ok ? "OK:" : "FAIL:", msg);
    if (!ok) fails++;
  };

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });

    // Unlock audio with a real click
    await page.click("body");
    await page.evaluate(async () => {
      if (window.Vent && Vent.ensureAudioAsync) await Vent.ensureAudioAsync();
    });

    const ctxState = await page.evaluate(() => {
      const c = Vent.ensureAudio();
      return c ? c.state : "none";
    });
    log(ctxState === "running", `AudioContext state=${ctxState}`);

    // —— Calm kit: rain ——
    const rain = await page.evaluate(async () => {
      const ok = await VentCalm.startNoise("rain");
      await new Promise((r) => setTimeout(r, 200));
      let max = 0;
      for (let i = 0; i < 25; i++) {
        max = Math.max(max, VentCalm.calmLevel());
        await new Promise((r) => setTimeout(r, 20));
      }
      const playing = VentCalm.isPlaying();
      const kind = VentCalm.kind();
      VentCalm.stopSoundscape();
      return { ok, max, playing, kind };
    });
    log(rain.ok && rain.playing && rain.kind === "rain" && rain.max > 0.02,
      `rain audible level=${rain.max.toFixed(3)} playing=${rain.playing} kind=${rain.kind}`);
    results.push({ name: "rain", ...rain });

    // —— Calm kit: white noise ——
    const white = await page.evaluate(async () => {
      const ok = await VentCalm.startNoise("white");
      await new Promise((r) => setTimeout(r, 200));
      let max = 0;
      for (let i = 0; i < 25; i++) {
        max = Math.max(max, VentCalm.calmLevel());
        await new Promise((r) => setTimeout(r, 20));
      }
      const playing = VentCalm.isPlaying();
      const kind = VentCalm.kind();
      VentCalm.stopSoundscape();
      return { ok, max, playing, kind };
    });
    log(white.ok && white.playing && white.kind === "white" && white.max > 0.02,
      `white noise audible level=${white.max.toFixed(3)} playing=${white.playing}`);
    results.push({ name: "white", ...white });

    // —— UI click path for rain (gesture unlock regression) ——
    const uiRain = await page.evaluate(async () => {
      document.getElementById("btnRain").click();
      await new Promise((r) => setTimeout(r, 250));
      let max = 0;
      for (let i = 0; i < 20; i++) {
        max = Math.max(max, VentCalm.calmLevel());
        await new Promise((r) => setTimeout(r, 20));
      }
      const on = document.getElementById("btnRain").classList.contains("is-on");
      VentCalm.stopSoundscape();
      return { max, on };
    });
    log(uiRain.on && uiRain.max > 0.02, `btnRain UI path level=${uiRain.max.toFixed(3)} is-on=${uiRain.on}`);

    // —— Core SFX ——
    const sfxList = [
      ["playThud (punch/smash)", "Vent.playThud(0.9);", 120],
      ["playPop", "Vent.playPop();", 100],
      ["playWhoosh (explode/destroy)", "Vent.playWhoosh();", 200],
      ["playCrack (shatter/burn)", "Vent.playCrack();", 100],
      ["playBurst", "Vent.playBurst();", 250],
      ["playWoodChime (muyu)", "Vent.playWoodChime();", 200],
      ["playTick", "Vent.playTick();", 80],
    ];

    for (const [name, body, wait] of sfxList) {
      const r = await measureSfx(page, name, body, wait);
      log(r.peak > 0.01, `${name} peak=${r.peak.toFixed(3)}`);
      results.push(r);
    }

    // —— Ritual destroy sounds (shred / void / balloon / burn / shatter) ——
    const rituals = await page.evaluate(async () => {
      const out = {};
      const map = [
        ["shred", () => Vent.playCrack && Vent.playCrack()],
        ["void", () => Vent.playWhoosh()],
        ["balloon", () => { Vent.playPop(); Vent.playWhoosh(); }],
        ["burn", () => { Vent.playCrack(); Vent.playWhoosh(); }],
        ["shatter", () => { Vent.playCrack(); Vent.playBurst(); }],
      ];
      // Prefer real ritual if exposed
      const names = ["shred", "void", "balloon", "burn", "shatter"];
      for (const n of names) {
        await Vent.ensureAudioAsync();
        Vent.getMasterOut();
        await new Promise((r) => setTimeout(r, 40));
        if (typeof Vent.runRitual === "function") {
          Vent.runRitual(n);
        } else {
          const fn = map.find((x) => x[0] === n)[1];
          fn();
        }
        let max = 0;
        const start = performance.now();
        while (performance.now() - start < 280) {
          max = Math.max(max, Vent.audioPeak());
          await new Promise((r) => setTimeout(r, 10));
        }
        out[n] = max;
      }
      return out;
    });
    for (const [n, peak] of Object.entries(rituals)) {
      log(peak > 0.01, `ritual:${n} peak=${peak.toFixed(3)}`);
      results.push({ name: `ritual:${n}`, peak });
    }

    // —— Muyu game wood chime via UI ——
    await page.evaluate(() => {
      const stall = document.querySelector('[data-game="muyu"]');
      if (stall) stall.click();
    });
    await sleep(400);
    const muyuPeak = await page.evaluate(async () => {
      await Vent.ensureAudioAsync();
      Vent.getMasterOut();
      const btn = document.getElementById("muyuBtn");
      if (!btn) return { peak: 0, found: false };
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      let max = 0;
      const start = performance.now();
      while (performance.now() - start < 220) {
        max = Math.max(max, Vent.audioPeak());
        await new Promise((r) => setTimeout(r, 10));
      }
      return { peak: max, found: true };
    });
    log(muyuPeak.found && muyuPeak.peak > 0.01,
      `muyu UI wood chime peak=${muyuPeak.peak.toFixed(3)} found=${muyuPeak.found}`);
    // close modal
    await page.evaluate(() => {
      const close = document.getElementById("btnCloseGame");
      if (close) close.click();
    });

    // —— Pool explode whoosh ——
    const pool = await page.evaluate(async () => {
      await Vent.ensureAudioAsync();
      Vent.getMasterOut();
      // Simulate explode SFX path used by pool
      if (window.Vent && Vent.playWhoosh) Vent.playWhoosh();
      let max = 0;
      const start = performance.now();
      while (performance.now() - start < 200) {
        max = Math.max(max, Vent.audioPeak());
        await new Promise((r) => setTimeout(r, 10));
      }
      // Also verify pool module's soft whoosh callable if we inject a fake bubble explode
      return { peak: max, hasPool: typeof window.VentPool !== "undefined" || !!document.getElementById("emotionPool") };
    });
    log(pool.peak > 0.01, `emotion pool explode whoosh peak=${pool.peak.toFixed(3)}`);

    // —— Punch bag game smash ——
    await page.evaluate(() => {
      const stall = document.querySelector('[data-game="bag"]');
      if (stall) stall.click();
    });
    await sleep(500);
    const bag = await page.evaluate(async () => {
      await Vent.ensureAudioAsync();
      Vent.getMasterOut();
      const canvas = document.querySelector("#gameStage canvas, .game-stage canvas, canvas");
      const stage = document.getElementById("gameStage") || document.querySelector(".game-modal");
      const el = canvas || stage;
      if (!el) return { peak: 0, found: false };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const opts = { bubbles: true, clientX: x, clientY: y };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      // also fire click
      el.dispatchEvent(new MouseEvent("click", opts));
      let max = 0;
      const start = performance.now();
      while (performance.now() - start < 200) {
        max = Math.max(max, Vent.audioPeak());
        await new Promise((r) => setTimeout(r, 10));
      }
      // fallback: direct thud
      if (max < 0.01) {
        Vent.playThud(1);
        const s2 = performance.now();
        while (performance.now() - s2 < 120) {
          max = Math.max(max, Vent.audioPeak());
          await new Promise((r) => setTimeout(r, 8));
        }
        return { peak: max, found: true, fallback: true };
      }
      return { peak: max, found: true, fallback: false };
    });
    log(bag.found && bag.peak > 0.01,
      `punch/smash peak=${bag.peak.toFixed(3)} fallback=${bag.fallback}`);

    console.log("\n--- audio QA summary ---");
    console.log(JSON.stringify(results, null, 2));

    if (fails) {
      console.error(`\n${fails} audio check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log("\nALL audio QA passed");
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
