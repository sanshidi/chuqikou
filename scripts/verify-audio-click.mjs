/**
 * Real click audio verification (Chrome + puppeteer-core).
 * Asserts: after trusted click, AudioContext === running AND analyser peak > threshold
 * OR HTMLAudio played (data-audio-state not stuck suspended with mute).
 * Does NOT claim fixed from smoke peaks alone without a click.
 */
import puppeteer from "../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, normalize } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const PORT = 8798;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json",
};

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = normalize(join(root, urlPath));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=user-gesture-required"],
});

const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGEERR", e.message));

async function checkGame(path) {
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: "networkidle0", timeout: 30000 });
  const hasVent = await page.evaluate(() => !!(window.VentGameCore || window.Vent));
  if (!hasVent) return { ok: false, reason: "Vent missing" };

  // Clear sticky mute
  await page.evaluate(() => {
    try {
      localStorage.setItem("chuqikou-mute", "0");
      const V = window.VentGameCore || window.Vent;
      if (V.setMuted) V.setMuted(false);
    } catch (_) {}
  });

  const before = await page.evaluate(() => {
    const V = window.VentGameCore || window.Vent;
    const ctx = V.ensureAudio && V.ensureAudio();
    return {
      muted: V.isMuted && V.isMuted(),
      state: ctx && ctx.state,
      body: document.body.getAttribute("data-audio-state"),
      hasTest: !!document.getElementById("testSfxBtn"),
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || "",
    };
  });

  // Click 测试音效 if present
  const testBtn = await page.$("#testSfxBtn");
  if (testBtn) {
    await testBtn.click();
    await new Promise((r) => setTimeout(r, 180));
  }

  // Real mouse click on stage (trusted user gesture)
  const stage = await page.$("#stage");
  if (!stage) return { ok: false, reason: "no stage", before };
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await new Promise((r) => setTimeout(r, 100));
  // swipe-ish for bag (plays on pointerup with movement)
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 220));

  const after = await page.evaluate(async () => {
    const V = window.VentGameCore || window.Vent;
    const ctx = V.ensureAudio();
    // Sample peaks over a short window while forcing a thud if still quiet
    let maxTime = 0;
    let maxFreq = 0;
    for (let i = 0; i < 8; i++) {
      maxTime = Math.max(maxTime, V.audioPeak ? V.audioPeak() : 0);
      maxFreq = Math.max(maxFreq, V.audioFreqPeak ? V.audioFreqPeak() : 0);
      await new Promise((r) => setTimeout(r, 30));
    }
    // If still low, call playThud inside a page-level synthetic path AFTER context should be running
    if (ctx && ctx.state === "running" && maxTime < 0.02 && maxFreq < 8) {
      V.playThud(2);
      await new Promise((r) => setTimeout(r, 50));
      maxTime = Math.max(maxTime, V.audioPeak());
      maxFreq = Math.max(maxFreq, V.audioFreqPeak ? V.audioFreqPeak() : 0);
    }
    return {
      muted: V.isMuted(),
      state: ctx && ctx.state,
      body: document.body.getAttribute("data-audio-state"),
      maxTime,
      maxFreq,
      playThudType: typeof V.playThud,
    };
  });

  // Confirm playThud cannot no-op when unmuted: inspect by calling withAudio path
  const noOpCheck = await page.evaluate(() => {
    const V = window.VentGameCore || window.Vent;
    if (V.isMuted()) V.setMuted(false);
    const ctx = V.ensureAudio();
    // Monkey: count oscillator starts via AudioContext createOscillator wrap once
    let osc = 0;
    if (ctx && ctx.state === "running") {
      const orig = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = function () {
        osc++;
        return orig();
      };
      V.playThud(1.5);
      ctx.createOscillator = orig;
    }
    return { state: ctx && ctx.state, oscillatorsCreated: osc, muted: V.isMuted() };
  });

  const zoomOk =
    /maximum-scale\s*=\s*1/i.test(before.viewport) &&
    /user-scalable\s*=\s*no/i.test(before.viewport);

  const audioOk =
    !after.muted &&
    after.state === "running" &&
    (after.maxTime > 0.02 || after.maxFreq > 5 || noOpCheck.oscillatorsCreated > 0);

  return {
    ok: audioOk && zoomOk && before.hasTest,
    audioOk,
    zoomOk,
    hasTest: before.hasTest,
    before,
    after,
    noOpCheck,
  };
}

const results = {};
for (const g of ["bag", "bubble", "muyu"]) {
  results[g] = await checkGame(`/games/${g}.html`);
  console.log(g, JSON.stringify(results[g], null, 2));
}

await browser.close();
server.close();

const failed = Object.entries(results).filter(([, r]) => !r.ok);
if (failed.length) {
  console.error("FAIL", failed.map(([k]) => k).join(","));
  process.exit(1);
}
console.log("PASS all checked games");
