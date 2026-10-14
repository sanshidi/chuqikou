/**
 * Confirm all audio/*.wav return 200 and play* peaks after preload (Chrome).
 */
import puppeteer from "../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, normalize } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const PORT = 8893;
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
    res.end("missing " + urlPath);
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const kinds = ["thud", "whoosh", "pop", "crack", "burst", "tick", "wood", "splat"];
for (const k of kinds) {
  const res = await fetch(`http://127.0.0.1:${PORT}/audio/${k}.wav`);
  if (!res.ok) {
    console.error("HTTP fail", k, res.status);
    process.exit(1);
  }
  console.log("HTTP", k, res.status, (await res.arrayBuffer()).byteLength);
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGEERR", e.message));
await page.goto(`http://127.0.0.1:${PORT}/games/bag.html`, {
  waitUntil: "domcontentloaded",
  timeout: 20000,
});
await page.click("#testSfxBtn");
await new Promise((r) => setTimeout(r, 500));
const report = await page.evaluate(async () => {
  const V = window.Vent;
  await V.ensureAudioAsync();
  V.setMuted(false);
  await V.preloadSamples();
  const loaded = Object.keys(V.sampleBuffers || {}).filter((k) => V.sampleBuffers[k]);
  const plays = [
    ["thud", () => V.playThud(1.5)],
    ["pop", () => V.playPop()],
    ["whoosh", () => V.playWhoosh()],
    ["crack", () => V.playCrack(true)],
    ["burst", () => V.playBurst()],
    ["tick", () => V.playTick()],
    ["wood", () => V.playWoodChime()],
    ["splat", () => V.playSplat()],
    ["test", () => V.playTestBeep()],
  ];
  const peaks = {};
  for (const [name, fn] of plays) {
    fn();
    let max = 0;
    const start = performance.now();
    while (performance.now() - start < 200) {
      max = Math.max(max, V.audioPeak());
      await new Promise((r) => setTimeout(r, 8));
    }
    peaks[name] = +max.toFixed(4);
  }
  return { loaded, peaks, ctx: V.ensureAudio().state };
});
console.log(JSON.stringify(report, null, 2));
const bad = Object.entries(report.peaks).filter(([, p]) => p < 0.02);
const ok = report.loaded.length === 8 && bad.length === 0 && report.ctx === "running";
console.log(ok ? "SELFTEST PASS" : "SELFTEST FAIL", "bad=", bad);
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
