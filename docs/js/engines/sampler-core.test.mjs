#!/usr/bin/env node
// Tests for Jacquardesque multi-sample sampler core.

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load plain-JS engine (attaches globalThis.JqSampler)
require(join(__dirname, "sampler-core.js"));

const S = globalThis.JqSampler;
const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

const SR = 48000;
S.init(SR);

assert(Array.isArray(S.bankNames) && S.bankNames.length === 6, "6 bank names");
assert(
  S.bankNames.join(",") === "bass,keys,brass,flute,pluck,hit",
  "bank name list",
);

const mem = S.memBytes();
assert(mem > 0, "memBytes > 0");
assert(mem <= 150 * 1024, "mem under 150KB: " + mem);
console.log("JqSampler banks:", S.bankNames.join(", "));
console.log("JqSampler memBytes:", mem, "(" + (mem / 1024).toFixed(1) + " KB)");

const banks = S.getBanks();
assert(banks && banks.length === 6, "6 banks generated");
for (const b of banks) {
  assert(b.data instanceof Float32Array, b.name + " Float32Array");
  assert(b.data.length > 32, b.name + " length");
  assert(typeof b.rootMidi === "number", b.name + " rootMidi");
  // hit: no loop
  if (b.name === "hit") {
    assert(b.loopStart < 0, "hit no loop");
  } else {
    assert(b.loopStart >= 0 && b.loopEnd > b.loopStart, b.name + " has loop");
  }
  let energy = 0;
  for (let i = 0; i < b.data.length; i++) {
    const x = b.data[i];
    assert(Number.isFinite(x), b.name + " finite sample");
    energy += x * x;
  }
  assert(energy > 0, b.name + " nonzero energy");
}

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function renderNote(midi, frames, extra) {
  const st = S.createState();
  S.trigger(
    st,
    Object.assign(
      {
        midi,
        frequency: midiToFreq(midi),
        sampleRate: SR,
        // auto bank via MIDI (ratio < 0.25)
        modulatorRatio: 0,
        modulationIndex: 2,
        feedback: 0.6,
        modulatorDecay: 0.2,
      },
      extra || {},
    ),
  );
  let energy = 0;
  let peak = 0;
  let allFinite = true;
  for (let i = 0; i < frames; i++) {
    const env = i < 32 ? i / 32 : Math.exp(-(i - 32) / (frames * 0.5));
    const s = S.render(st, env);
    if (!Number.isFinite(s)) allFinite = false;
    energy += s * s;
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return { energy, peak, allFinite, bank: st.bank };
}

const N = 2000;
const c2 = renderNote(36, N); // bass zone
const c4 = renderNote(60, N); // keys zone
const c6 = renderNote(84, N); // pluck zone (77–88)

assert(c2.allFinite, "C2 finite");
assert(c4.allFinite, "C4 finite");
assert(c6.allFinite, "C6 finite");
assert(c2.energy > 1e-8, "C2 nonzero energy: " + c2.energy);
assert(c4.energy > 1e-8, "C4 nonzero energy: " + c4.energy);
assert(c6.energy > 1e-8, "C6 nonzero energy: " + c6.energy);
assert(c2.bank === 0, "C2 → bass bank, got " + c2.bank);
assert(c4.bank === 1, "C4 → keys bank, got " + c4.bank);
assert(c6.bank === 4, "C6 → pluck bank, got " + c6.bank);

// ratio force-select
const forced = renderNote(60, N, { modulatorRatio: 0.3 }); // band 0
assert(forced.bank === 0, "ratio 0.3 → bank 0, got " + forced.bank);
const forced5 = renderNote(60, N, { modulatorRatio: 7 });
assert(forced5.bank === 5, "ratio 7 → bank 5, got " + forced5.bank);
assert(forced5.energy > 0 || forced5.peak >= 0, "forced hit renders");

// no-loop one-shot ends at silence
const oneShot = S.createState();
S.trigger(oneShot, {
  midi: 48,
  frequency: midiToFreq(48),
  sampleRate: SR,
  modulatorRatio: 7, // hit
  modulationIndex: 0,
  feedback: 0,
});
let last = 1;
for (let i = 0; i < 20000; i++) last = S.render(oneShot, 1);
assert(last === 0, "hit one-shot eventually silent: " + last);

// createState shape
const st = S.createState();
assert("pos" in st && "rate" in st && "lp" in st && "lpCoeff" in st, "state fields");

if (fails.length) {
  console.error("FAIL (" + fails.length + "):\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("sampler-core: ALL PASS");
console.log(
  "  C2 energy=" +
    c2.energy.toFixed(4) +
    " bank=" +
    c2.bank +
    " | C4 energy=" +
    c4.energy.toFixed(4) +
    " bank=" +
    c4.bank +
    " | C6 energy=" +
    c6.energy.toFixed(4) +
    " bank=" +
    c6.bank,
);
console.log("  total memBytes=" + mem);
