/**
 * Offline AudioContext smoke for play* patterns (no browser).
 * Confirms helpers do not throw when AudioContext exists via web-audio mock minimal.
 */
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import vm from "vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

class FakeParam {
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v) {
    this.value = v;
  }
}
class FakeOsc {
  constructor() {
    this.frequency = new FakeParam(0);
    this.type = "sine";
  }
  connect() {
    return this;
  }
  start() {}
  stop() {}
}
class FakeGain {
  constructor() {
    this.gain = new FakeParam(1);
  }
  connect() {
    return this;
  }
}
class FakeFilter {
  constructor() {
    this.frequency = new FakeParam(0);
    this.Q = new FakeParam(1);
    this.type = "lowpass";
  }
  connect() {
    return this;
  }
}
class FakeBufSrc {
  constructor() {
    this.buffer = null;
  }
  connect() {
    return this;
  }
  start() {}
}
class FakeAnalyser {
  constructor() {
    this.fftSize = 256;
    this.frequencyBinCount = 128;
    this._peak = 0;
  }
  connect() {}
  /** Simulate non-silent bus after play* (node mock cannot render). */
  markActivity(level) {
    this._peak = Math.max(this._peak, level);
  }
  getByteTimeDomainData(a) {
    const v = 128 + Math.round(this._peak * 127);
    for (let i = 0; i < a.length; i++) a[i] = v;
  }
}
class FakeCtx {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
    this._analyser = null;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator() {
    return new FakeOsc();
  }
  createGain() {
    return new FakeGain();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() {
    return new FakeBufSrc();
  }
  createAnalyser() {
    this._analyser = new FakeAnalyser();
    return this._analyser;
  }
}

const code = fs.readFileSync(path.join(ROOT, "js/game-core.js"), "utf8");
const sandbox = {
  window: {},
  document: {
    addEventListener() {},
    elementFromPoint() {
      return null;
    },
    visibilityState: "visible",
    body: { appendChild() {}, remove() {} },
    documentElement: { appendChild() {} },
    createElement() {
      return {
        type: "",
        className: "",
        textContent: "",
        setAttribute() {},
        addEventListener() {},
        remove() {},
        style: {},
      };
    },
  },
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {},
  },
  navigator: {},
  performance: { now: () => Date.now() },
  AudioContext: FakeCtx,
  webkitAudioContext: FakeCtx,
  setTimeout,
  console,
};
sandbox.window = sandbox;
vm.runInNewContext(code, sandbox);

const V = sandbox.window.VentGameCore;
if (!V) {
  console.error("no VentGameCore");
  process.exit(1);
}
V.ensureAudio();
V.getMasterOut();
const plays = [
  ["playThud", () => V.playThud(1)],
  ["playPop", () => V.playPop(1.1, 1.2)],
  ["playWhoosh", () => V.playWhoosh()],
  ["playCrack", () => V.playCrack(true)],
  ["playBurst", () => V.playBurst()],
  ["playTick", () => V.playTick()],
  ["playWoodChime", () => V.playWoodChime()],
  ["playKnead", () => V.playKnead(0.8)],
  ["playSplat", () => V.playSplat()],
];
for (const [name, fn] of plays) {
  if (typeof fn !== "function" || typeof V[name.split("(")[0]] !== "function" && !V[name]) {
    // name is playThud etc
  }
  if (typeof V[name] !== "function") {
    console.error("missing", name);
    process.exit(1);
  }
  fn();
  // mock analyser activity so audioPeak path is exercised
  const ctx = sandbox.AudioContext && null;
  console.log("play ok", name);
}
// Mark analyser as active for peak path
const rawCtx = V.ensureAudio();
if (rawCtx && rawCtx._analyser) rawCtx._analyser.markActivity(0.4);
const peak = V.audioPeak();
if (!(peak > 0)) {
  console.error("expected audioPeak > 0 after mock activity, got", peak);
  process.exit(1);
}
const st = V.recordHit("bag", { vibrate: false });
console.log("recordHit", st);
console.log("audioPeak", peak.toFixed(3));
console.log("AUDIO NODE PASS");
