#!/usr/bin/env node
// Offline test for granular-core: 1s render, finite, nonzero peak, timing.

import { createRequire } from "module";
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import vm from "vm";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePath = join(__dirname, "granular-core.js");

// Load plain JS (no ES modules) into a sandbox / globalThis
const code = fs.readFileSync(corePath, "utf8");
const sandbox = { globalThis: {}, module: { exports: {} }, exports: {}, console };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const Jq = sandbox.globalThis.JqGranular || sandbox.module.exports;
if (!Jq || typeof Jq.init !== "function") {
  console.error("FAIL: JqGranular not attached");
  process.exit(1);
}

const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

const SR = 48000;
const SECONDS = 1;
const N = SR * SECONDS;

Jq.init(SR);
const mem = Jq.memBytes();
console.log("memBytes:", JSON.stringify(mem, null, 2));

assert(mem.sourceLen > 0 && mem.sourceLen <= 8192, "sourceLen capped ≤8192: " + mem.sourceLen);
assert(mem.shared > 0, "shared mem > 0");
assert(mem.shared < 64 * 1024, "shared mem tiny (<64KB): " + mem.shared);
assert(mem.perVoice < 1024, "perVoice tiny (<1KB): " + mem.perVoice);

const state = Jq.createState();
const note = {
  frequency: 261.625565, // C4
  duration: 0.6,
  modulationIndex: 3.5,
  modulatorRatio: 1.5,
  feedback: 1.2,
  modulatorDecay: 0.25,
  carrierAttack: 0.01,
  carrierRelease: 0.3,
  pitchSweep: 0.5,
  pitchDecay: 0.1,
  level: 0.4,
  startSample: 0,
};

Jq.trigger(state, note, SR);

// Outer envelope: simple attack/sustain/release matching processor-ish shape
function outerEnv(t, note) {
  const total = note.duration + note.carrierRelease;
  if (t < 0 || t >= total) return 0;
  let a = 1;
  if (t < note.carrierAttack) a = t / note.carrierAttack;
  if (t >= note.duration) {
    const u = (t - note.duration) / note.carrierRelease;
    a *= Math.exp(-5 * u); // soft fade
  }
  return a;
}

const out = new Float32Array(N);
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const time = i / SR;
  const env = outerEnv(time, note);
  out[i] = Jq.render(state, time, env);
}
const ms = performance.now() - t0;

let peak = 0;
let sumSq = 0;
let finite = true;
let nonzero = 0;
for (let i = 0; i < N; i++) {
  const x = out[i];
  if (!Number.isFinite(x)) {
    finite = false;
    break;
  }
  const a = x < 0 ? -x : x;
  if (a > peak) peak = a;
  if (a > 1e-6) nonzero++;
  sumSq += x * x;
}
const rms = Math.sqrt(sumSq / N);

assert(finite, "all samples finite");
assert(peak > 0.001, "nonzero peak: " + peak);
assert(peak < 2.5, "peak not exploding: " + peak);
assert(nonzero > SR * 0.05, "enough non-silent samples: " + nonzero);
assert(rms > 1e-5, "rms energy: " + rms);

// Second note (higher pitch, denser) — still finite
const state2 = Jq.createState();
Jq.trigger(state2, {
  ...note,
  frequency: 440,
  modulationIndex: 7,
  modulatorRatio: 0.5,
  feedback: 3,
  pitchSweep: -2,
  startSample: 12345,
}, SR);
let peak2 = 0;
let finite2 = true;
for (let i = 0; i < SR * 0.25; i++) {
  const time = i / SR;
  const s = Jq.render(state2, time, outerEnv(time, note));
  if (!Number.isFinite(s)) {
    finite2 = false;
    break;
  }
  const a = s < 0 ? -s : s;
  if (a > peak2) peak2 = a;
}
assert(finite2, "second note finite");
assert(peak2 > 0.0005, "second note peak: " + peak2);

// No alloc in render: grain arrays same references after long run
const posRef = state.gPos;
Jq.render(state, 0.9, 0.1);
assert(state.gPos === posRef, "no reallocation of grain arrays");

const xrt = (SECONDS * 1000) / ms; // realtime multiples
console.log(
  `render ${SECONDS}s @ ${SR}Hz: ${ms.toFixed(2)} ms  (${xrt.toFixed(1)}× realtime)  peak=${peak.toFixed(4)} rms=${rms.toFixed(5)}`,
);
console.log(
  `shared=${mem.shared}B sourceLen=${mem.sourceLen} perVoice≈${mem.perVoice}B totalOneVoice≈${mem.totalOneVoice}B`,
);

if (fails.length) {
  console.error("FAIL:");
  for (const f of fails) console.error(" -", f);
  process.exit(1);
}
console.log("OK granular-core");
