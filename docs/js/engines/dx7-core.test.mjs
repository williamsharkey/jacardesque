#!/usr/bin/env node
/**
 * Node test for JqDx7 compact 6-op FM core.
 * Run: node docs/js/engines/dx7-core.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext, Script } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "dx7-core.js"), "utf8");

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
createContext(sandbox);
new Script(src).runInContext(sandbox);

const JqDx7 = sandbox.globalThis.JqDx7;
if (!JqDx7) {
  console.error("FAIL: globalThis.JqDx7 not set");
  process.exit(1);
}

const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

const { init, createState, trigger, render, SIN_LEN } = JqDx7;

assert(SIN_LEN === 4096, "SIN_LEN === 4096");
init();
assert(typeof createState === "function", "createState exported");

const tables = JqDx7.getTables();
assert(tables.ROUTE && tables.ROUTE.length === 32 * 6, "ROUTE table 32*6");
assert(tables.FB_OP && tables.FB_OP.length === 32, "FB_OP length 32");
assert(tables.SIN_LUT && tables.SIN_LUT.length === 4096, "SIN_LUT 4096");

// Algo 32 (index 31) — all carriers
assert(tables.IS_OUT[31 * 6 + 0] === 1, "algo32 op1 is out");
assert(tables.IS_OUT[31 * 6 + 5] === 1, "algo32 op6 is out");
// Algo 1 — only op1 out, stack
assert(tables.IS_OUT[0] === 1, "algo1 op1 is out");
assert(tables.IS_OUT[1] === 0, "algo1 op2 not out");
assert(tables.FB_OP[0] === 5, "algo1 fb on op6");

const sr = 48000;
const state = createState();
assert(
  state.phases && typeof state.phases.length === "number" && state.phases.BYTES_PER_ELEMENT === 4,
  "phases Float32Array-like",
);
assert(state.phases.length === 6, "6 phases");

// C4 ≈ 261.6256 Hz
const note = {
  frequency: 261.625565,
  midi: 60,
  modulationIndex: 2.5,
  modulatorRatio: 2.0, // algo = (8)|0 % 32 = 8 → algorithm 9
  feedback: 1.2,
  modulatorDecay: 0.25,
  carrierAttack: 0.005,
  carrierRelease: 0.4,
  duration: 1.0,
  level: 0.9,
};

trigger(state, note, sr);

const N = 1000;
let peak = 0;
let sumAbs = 0;
let allFinite = true;
let nonZero = 0;
for (let i = 0; i < N; i++) {
  const t = i / sr;
  // simple outer gate
  const envC = t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.1);
  const s = render(state, t, envC);
  if (!Number.isFinite(s)) allFinite = false;
  const a = Math.abs(s);
  if (a > peak) peak = a;
  sumAbs += a;
  if (a > 1e-8) nonZero++;
}

assert(allFinite, "all samples finite");
assert(nonZero > N * 0.5, "majority non-zero samples: " + nonZero);
assert(peak > 0.001, "peak > 0.001 got " + peak);
assert(peak < 2, "peak < 2 got " + peak);
assert(sumAbs > 0, "not all zeros");

// Spot-check a few algorithms produce audio
for (const ratio of [0.25, 1, 2, 4, 7.5]) {
  const st = createState();
  trigger(
    st,
    {
      frequency: 440,
      modulationIndex: 3,
      modulatorRatio: ratio,
      feedback: 0.5,
      modulatorDecay: 0.3,
      carrierAttack: 0.002,
      carrierRelease: 0.5,
      level: 1,
    },
    sr,
  );
  let p = 0;
  for (let i = 0; i < 2000; i++) {
    const s = Math.abs(render(st, i / sr, 1));
    if (s > p) p = s;
  }
  assert(p > 0.001, "algo ratio=" + ratio + " peak " + p);
}

// Timing: 1 second of audio, one voice
const bench = createState();
trigger(bench, note, sr);
const samples = sr;
const t0 = performance.now();
for (let i = 0; i < samples; i++) {
  render(bench, i / sr, 1);
}
const t1 = performance.now();
const ms = t1 - t0;
console.log("dx7-core: 1s @ " + sr + "Hz one voice: " + ms.toFixed(2) + " ms");
console.log("  peak(1000 samples C4)=" + peak.toFixed(4) + " nonZero=" + nonZero);
console.log("  algorithms=" + tables.FB_OP.length + " SIN_LEN=" + SIN_LEN);

// Memory footprint estimate
const voiceBytes =
  6 * 4 * 8 + // phases,inc,opOut,modAccum,env,envAtk,envDec,envPeak
  6 + // envStage
  64; // scalars rough
const sharedBytes =
  4096 * 4 + // SIN_LUT
  32 * 6 + // ROUTE
  32 * 6 + // MOD_SRC
  32 * 6 + // IS_OUT
  32; // FB_OP
console.log(
  "  mem est: shared ~" +
    (sharedBytes / 1024).toFixed(1) +
    " KB, per-voice ~" +
    voiceBytes +
    " B",
);

if (fails.length) {
  console.error("FAILED (" + fails.length + "):");
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log("OK — all dx7-core assertions passed");
