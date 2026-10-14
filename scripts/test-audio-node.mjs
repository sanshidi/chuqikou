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

// Minimal OfflineAudioContext polyfill surface used by game-core
class FakeOsc {
  constructor() { this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }; this.type = "sine"; }
  connect() { return this; }
  start() {}
  stop() {}
}
class FakeGain {
  constructor() { this.gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  connect() { return this; }
}
class FakeFilter {
  constructor() { this.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; this.Q = { value: 1 }; this.type = "lowpass"; }
  connect() { return this; }
}
class FakeBufSrc {
  constructor() { this.buffer = null; }
  connect() { return this; }
  start() {}
}
class FakeAnalyser {
  constructor() { this.fftSize = 256; this.frequencyBinCount = 128; }
  connect() {}
  getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128; }
}
class FakeCtx {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  resume() { return Promise.resolve(); }
  createOscillator() { return new FakeOsc(); }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { return new FakeFilter(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return new FakeBufSrc(); }
  createAnalyser() { return new FakeAnalyser(); }
}

const code = fs.readFileSync(path.join(ROOT, "js/game-core.js"), "utf8");
const sandbox = {
  window: {},
  document: {
    addEventListener() {},
    elementFromPoint() { return null; },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  navigator: {},
  performance: { now: () => Date.now() },
  AudioContext: FakeCtx,
  webkitAudioContext: FakeCtx,
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
[
  () => V.playThud(1),
  () => V.playPop(1.1),
  () => V.playWhoosh(),
  () => V.playCrack(),
  () => V.playBurst(),
  () => V.playTick(),
  () => V.playWoodChime(),
].forEach((fn, i) => {
  fn();
  console.log("play ok", i);
});
const st = V.recordHit("bag", { vibrate: false });
console.log("recordHit", st);
console.log("AUDIO NODE PASS");
