/**
 * Smoke: serve static, curl all game pages 200, node --check already done by caller.
 * Optional puppeteer: load each game, call Vent play* helpers, click stage.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const PAGES = [
  "/",
  "/index.html",
  "/styles.css",
  "/styles-games.css",
  "/js/game-core.js",
  "/sw.js",
  "/games/bag.html",
  "/games/bubble.html",
  "/games/plates.html",
  "/games/rage.html",
  "/games/squeeze.html",
  "/games/muyu.html",
  "/js/games/bag.js",
  "/js/games/bubble.js",
  "/js/games/plates.js",
  "/js/games/rage.js",
  "/js/games/squeeze.js",
  "/js/games/muyu.js",
];

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

async function curlAll(port) {
  const fails = [];
  for (const p of PAGES) {
    const r = await fetch("http://127.0.0.1:" + port + p);
    if (!r.ok) fails.push(p + " -> " + r.status);
    else console.log("OK", p, r.status);
  }
  return fails;
}

async function browserAudio(port) {
  let puppeteer;
  try {
    puppeteer = await import("puppeteer-core");
  } catch {
    console.log("SKIP puppeteer-core not available");
    return [];
  }
  const chrome = "/usr/bin/google-chrome-stable";
  if (!fs.existsSync(chrome)) {
    console.log("SKIP chrome missing");
    return [];
  }
  const browser = await puppeteer.default.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const fails = [];
  const games = ["bag", "bubble", "plates", "rage", "squeeze", "muyu"];
  for (const id of games) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => fails.push(id + " pageerror: " + e.message));
    await page.goto("http://127.0.0.1:" + port + "/games/" + id + ".html", {
      waitUntil: "networkidle0",
      timeout: 20000,
    });
    const result = await page.evaluate(async () => {
      const V = window.VentGameCore || window.Vent;
      if (!V) return { ok: false, err: "no Vent" };
      if (V.unlockAudio) await V.unlockAudio(true);
      await V.ensureAudioAsync();
      V.getMasterOut && V.getMasterOut();
      if (V.setMuted) V.setMuted(false);
      const calls = [
        ["playThud", () => V.playThud(1.4)],
        ["playPop", () => V.playPop(1, 1.5)],
        ["playWhoosh", () => V.playWhoosh()],
        ["playCrack", () => V.playCrack(true)],
        ["playBurst", () => V.playBurst()],
        ["playTick", () => V.playTick()],
        ["playWoodChime", () => V.playWoodChime()],
        ["playKnead", () => V.playKnead && V.playKnead(1)],
        ["playSplat", () => V.playSplat && V.playSplat()],
      ];
      const thrown = [];
      let peak = 0;
      for (const [name, fn] of calls) {
        try {
          fn();
          // sample while voice is still sounding
          await new Promise((r) => setTimeout(r, 30));
          peak = Math.max(peak, V.audioPeak ? V.audioPeak() : 0);
        } catch (e) {
          thrown.push(name + ": " + e.message);
        }
      }
      // click/tap stage — simulated hit should also make sound
      const stage = document.getElementById("stage");
      if (stage) {
        stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 200 }));
        stage.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160, clientY: 220 }));
        await new Promise((r) => setTimeout(r, 40));
        peak = Math.max(peak, V.audioPeak ? V.audioPeak() : 0);
      }
      // hold a sustaining burst and re-sample
      V.playBurst();
      await new Promise((r) => setTimeout(r, 50));
      peak = Math.max(peak, V.audioPeak ? V.audioPeak() : 0);
      return {
        ok: thrown.length === 0,
        thrown,
        peak,
        hasStage: !!stage,
        muted: V.isMuted ? V.isMuted() : null,
        ctxState: (V.ensureAudio && V.ensureAudio() && V.ensureAudio().state) || "?",
      };
    });
    if (!result.ok) fails.push(id + " audio throws: " + (result.thrown || []).join("; "));
    else if (!(result.peak > 0.08)) {
      fails.push(id + " audio peak too low: " + result.peak + " muted=" + result.muted + " ctx=" + result.ctxState);
    } else console.log("AUDIO", id, "peak~", result.peak.toFixed(3), "stage", result.hasStage, "ctx", result.ctxState);
    await page.close();
  }
  await browser.close();
  return fails;
}

async function main() {
  // syntax check
  const files = [
    "js/game-core.js",
    "js/app.js",
    "js/games.js",
    ...gamesJs(),
  ];
  for (const f of files) {
    const r = spawnSync("node", ["--check", path.join(ROOT, f)], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("SYNTAX FAIL", f, r.stderr);
      process.exit(1);
    }
  }
  console.log("SYNTAX ok", files.length, "files");

  const port = 8797;
  const server = await serve(port);
  const curlFails = await curlAll(port);
  const audioFails = await browserAudio(port);
  server.close();
  const all = [...curlFails, ...audioFails];
  if (all.length) {
    console.error("FAILS:\n" + all.join("\n"));
    process.exit(1);
  }
  console.log("SMOKE PASS");
}

function gamesJs() {
  return fs.readdirSync(path.join(ROOT, "js/games")).filter((f) => f.endsWith(".js")).map((f) => "js/games/" + f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
