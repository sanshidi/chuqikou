/**
 * Generate punchier impact WAV samples (mono 22050 Hz, 16-bit).
 * Heavier thud, sharper crack, meatier bag-hit body, clearer pop, resonant wood.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SR = 22050;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "audio");
mkdirSync(root, { recursive: true });

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function writeWav(name, samples) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  // soft clip + normalize peak to ~0.92
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const norm = peak > 1e-6 ? 0.92 / peak : 1;
  for (let i = 0; i < n; i++) {
    let s = samples[i] * norm;
    // tanh soft clip
    s = Math.tanh(s * 1.15);
    buf.writeInt16LE((clamp(s, -1, 1) * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(join(root, name + ".wav"), buf);
  console.log(name, buf.length, "bytes", (n / SR).toFixed(3) + "s");
}

function noise() {
  return Math.random() * 2 - 1;
}

function envExp(t, decay) {
  return Math.exp(-t * decay);
}

function sine(f, t) {
  return Math.sin(2 * Math.PI * f * t);
}

function render(dur, fn) {
  const n = Math.floor(SR * dur);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i, n);
  return out;
}

// Heavy body thud + sharp transient crack layer
writeWav(
  "thud",
  render(0.32, (t) => {
    const body =
      sine(78, t) * envExp(t, 9) * 0.85 +
      sine(48, t) * envExp(t, 6.5) * 0.55 +
      sine(110, t) * envExp(t, 14) * 0.28;
    const mid = sine(180 + t * 40, t) * envExp(t, 18) * 0.22;
    const click = noise() * envExp(t, 85) * 0.55 + sine(2400, t) * envExp(t, 120) * 0.18;
    const bag = noise() * envExp(t, 22) * 0.22 * (t < 0.08 ? 1 : 0.4);
    return body + mid + click + bag;
  })
);

// Air whoosh / swing
writeWav(
  "whoosh",
  render(0.28, (t) => {
    const n = noise();
    const sweep = 900 + 2200 * Math.exp(-t * 8) - t * 400;
    // crude band-ish by mixing HP-ish noise with sine carrier
    const band = n * (0.55 + 0.45 * Math.sin(2 * Math.PI * sweep * t * 0.002));
    const env = Math.sin(Math.PI * clamp(t / 0.22, 0, 1)) * envExp(t, 3.2);
    return band * env * 0.75 + noise() * envExp(t, 14) * 0.12;
  })
);

// Clear bubble pop
writeWav(
  "pop",
  render(0.12, (t) => {
    const f0 = 920 - t * 5200;
    const osc = sine(Math.max(90, f0), t) * envExp(t, 28) * 0.7;
    const click = noise() * envExp(t, 90) * 0.45;
    const air = noise() * envExp(t, 35) * 0.18;
    return osc + click + air;
  })
);

// Sharp glass/plate crack transient
writeWav(
  "crack",
  render(0.18, (t) => {
    const transient = noise() * envExp(t, 110) * 0.95;
    const bright = noise() * envExp(t, 55) * 0.4;
    const ring =
      sine(1850, t) * envExp(t, 28) * 0.22 +
      sine(3100, t) * envExp(t, 42) * 0.12 +
      sine(620, t) * envExp(t, 18) * 0.1;
    return transient + bright + ring;
  })
);

// Explosive rage burst
writeWav(
  "burst",
  render(0.42, (t) => {
    const boom =
      sine(55, t) * envExp(t, 5.5) * 0.9 +
      sine(90, t) * envExp(t, 8) * 0.45 +
      sine(140, t) * envExp(t, 12) * 0.2;
    const roar = noise() * envExp(t, 7) * 0.55;
    const snap = noise() * envExp(t, 70) * 0.5 + sine(2000, t) * envExp(t, 90) * 0.15;
    return boom + roar + snap;
  })
);

// Soft UI tick
writeWav(
  "tick",
  render(0.05, (t) => {
    return sine(1100, t) * envExp(t, 55) * 0.55 + noise() * envExp(t, 80) * 0.12;
  })
);

// Woody knock with resonance (muyu)
writeWav(
  "wood",
  render(0.4, (t) => {
    const knock = noise() * envExp(t, 95) * 0.35;
    const fund =
      sine(392, t) * envExp(t, 7.5) * 0.55 +
      sine(588, t) * envExp(t, 9) * 0.28 +
      sine(784, t) * envExp(t, 11) * 0.14 +
      sine(196, t) * envExp(t, 6) * 0.18;
    const body = sine(98, t) * envExp(t, 8) * 0.12;
    return knock + fund + body;
  })
);

// Wet splat / squeeze
writeWav(
  "splat",
  render(0.22, (t) => {
    const wet =
      noise() * envExp(t, 16) * 0.55 +
      sine(220 - t * 400, t) * envExp(t, 14) * 0.35 +
      sine(90, t) * envExp(t, 10) * 0.4;
    const drip = noise() * envExp(Math.max(0, t - 0.04), 28) * 0.25;
    const pop = sine(600, t) * envExp(t, 40) * 0.2;
    return wet + drip + pop;
  })
);

console.log("OK wrote samples to", root);
