/**
 * Library-free approximate pitch shift (same duration).
 * Granular overlap-add — good enough for comedy gag voices on mobile.
 * Limitation: artifacts on extreme shifts; not studio-grade.
 */
(function (global) {
  "use strict";

  function mixMono(buffer) {
    const len = buffer.length;
    const ch = buffer.numberOfChannels;
    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += d[i] / ch;
    }
    return out;
  }

  function hann(i, n) {
    return 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  }

  /**
   * @param {AudioBuffer} buffer
   * @param {number} pitchRatio >1 higher pitch, <1 lower; duration preserved
   * @param {AudioContext} ctx
   * @returns {AudioBuffer}
   */
  function pitchShiftBuffer(buffer, pitchRatio, ctx) {
    const ratio = Math.max(0.35, Math.min(2.6, pitchRatio || 1));
    if (Math.abs(ratio - 1) < 0.02) return buffer;

    const sr = buffer.sampleRate;
    const input = mixMono(buffer);
    const outLen = input.length;
    const output = new Float32Array(outLen);

    // ~40–50ms grains
    const grainLen = Math.max(64, Math.floor(sr * 0.045));
    const hopOut = Math.max(16, Math.floor(grainLen * 0.25));
    const hopIn = Math.max(8, Math.floor(hopOut * ratio));

    let inPos = 0;
    let outPos = 0;
    while (outPos + grainLen < outLen && inPos + grainLen < input.length) {
      for (let i = 0; i < grainLen; i++) {
        const srcIndex = inPos + i;
        if (srcIndex >= input.length) break;
        const w = hann(i, grainLen);
        output[outPos + i] += input[srcIndex] * w;
      }
      inPos += hopIn;
      outPos += hopOut;
    }

    // Soft normalize to avoid clipping from overlap
    let peak = 0.0001;
    for (let i = 0; i < outLen; i++) peak = Math.max(peak, Math.abs(output[i]));
    const g = Math.min(1.2, 0.92 / peak);
    for (let i = 0; i < outLen; i++) output[i] *= g;

    const outBuf = ctx.createBuffer(1, outLen, sr);
    outBuf.copyToChannel(output, 0);
    return outBuf;
  }

  /** Semitones helper */
  function shiftSemitones(buffer, semitones, ctx) {
    return pitchShiftBuffer(buffer, Math.pow(2, semitones / 12), ctx);
  }

  global.VentPitch = { pitchShiftBuffer, shiftSemitones, mixMono };
})(window);
