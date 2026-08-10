// Offline integration: load all three advanced engines + emulate Voice switch.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console, Math, Float32Array, Uint8Array, Int8Array, Int32Array };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const f of ["dx7-core.js", "granular-core.js", "sampler-core.js"]) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), sandbox);
}

const { JqDx7, JqGranular, JqSampler } = sandbox;
if (!JqDx7 || !JqGranular || !JqSampler) {
  console.error("FAIL: missing engines", { JqDx7: !!JqDx7, JqGranular: !!JqGranular, JqSampler: !!JqSampler });
  process.exit(1);
}

const sr = 48000;
JqDx7.init();
JqGranular.init(sr);
JqSampler.init(sr);

function noteBase(overrides = {}) {
  return {
    startSample: 0,
    midi: 60,
    frequency: 261.63,
    level: 0.4,
    pan: 0,
    duration: 0.4,
    priority: 4,
    instrument: 11,
    modulatorRatio: 2,
    modulationIndex: 2.5,
    feedback: 0.6,
    modulatorDecay: 0.3,
    carrierAttack: 0.01,
    carrierRelease: 0.2,
    pitchSweep: 0,
    pitchDecay: 0.05,
    reverbSend: 0.1,
    delaySend: 0.05,
    ...overrides,
  };
}

function renderEngine(engineId, nFrames = 4800) {
  const note = noteBase({ instrument: engineId });
  let peak = 0;
  let energy = 0;
  let s;
  if (engineId === 11) {
    s = JqDx7.createState();
    JqDx7.trigger(s, note, sr);
    for (let i = 0; i < nFrames; i++) {
      const t = i / sr;
      const env = t < note.duration ? 1 : Math.max(0, 1 - (t - note.duration) / note.carrierRelease);
      const v = JqDx7.render(s, t, env);
      if (!Number.isFinite(v)) throw new Error("non-finite dx7 @ " + i);
      const a = Math.abs(v);
      if (a > peak) peak = a;
      energy += a;
    }
  } else if (engineId === 12) {
    s = JqGranular.createState();
    JqGranular.trigger(s, note, sr);
    for (let i = 0; i < nFrames; i++) {
      const t = i / sr;
      const env = t < note.duration ? 1 : Math.max(0, 1 - (t - note.duration) / note.carrierRelease);
      const v = JqGranular.render(s, t, env);
      if (!Number.isFinite(v)) throw new Error("non-finite granular @ " + i);
      const a = Math.abs(v);
      if (a > peak) peak = a;
      energy += a;
    }
  } else if (engineId === 13) {
    s = JqSampler.createState();
    JqSampler.trigger(s, {
      midi: note.midi,
      frequency: note.frequency,
      sampleRate: sr,
      modulatorRatio: note.modulatorRatio,
      modulationIndex: note.modulationIndex,
      feedback: note.feedback,
      modulatorDecay: note.modulatorDecay,
    });
    for (let i = 0; i < nFrames; i++) {
      const t = i / sr;
      const env = t < note.duration ? 1 : Math.max(0, 1 - (t - note.duration) / note.carrierRelease);
      const v = JqSampler.render(s, env);
      if (!Number.isFinite(v)) throw new Error("non-finite sampler @ " + i);
      const a = Math.abs(v);
      if (a > peak) peak = a;
      energy += a;
    }
  }
  return { peak, energy };
}

const t0 = performance.now();
const dx = renderEngine(11);
const gr = renderEngine(12);
const sa = renderEngine(13);
const ms = performance.now() - t0;

function ok(label, r) {
  if (r.peak < 0.001 || r.peak > 3) {
    throw new Error(`${label} peak out of range: ${r.peak}`);
  }
  if (r.energy < 1) throw new Error(`${label} energy too low: ${r.energy}`);
  console.log(`  ${label}: peak=${r.peak.toFixed(4)} energy=${r.energy.toFixed(1)}`);
}

ok("dx7", dx);
ok("granular", gr);
ok("sampler", sa);

const mem =
  (JqGranular.memBytes?.() && typeof JqGranular.memBytes() === "object"
    ? JqGranular.memBytes().shared
    : 0) +
  (JqSampler.memBytes?.() || 0) +
  17000; // dx7 sin lut ~16KB
console.log(`shared mem estimate ~${(mem / 1024).toFixed(1)} KB`);
console.log(`3×100ms offline: ${ms.toFixed(2)} ms`);
console.log("integration: ALL PASS");
