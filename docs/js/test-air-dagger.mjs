#!/usr/bin/env node
// Deterministic offline verification for the Air Drawn Dagger suite.
//
// Usage:
//   node docs/js/test-air-dagger.mjs
//   node docs/js/test-air-dagger.mjs --seed 42 --seconds 48
//   node docs/js/test-air-dagger.mjs --seed 7 --out /tmp/air-dagger.jsonl
//   node docs/js/test-air-dagger.mjs --seed 7 --format tracker --out /tmp/ad.txt
//
// No audio. Same Sequencer + applyFxTriggers + collectPatternTriggers as live.
// Probabilities use createSeededRandom(seed) via Sequencer.setRandomSeed.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AIR_DAGGER_SKETCHES, AIR_DAGGER_IDS } from "./examples-airdagger.js";
import { simulateSuite, SongSimulator } from "./sim-engine.js";
import { createSeededRandom } from "./core.js";

const __dir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    seed: 1,
    seconds: 40,
    sampleRate: 48000,
    format: "jsonl", // jsonl | tracker
    out: null,
    playhead: false,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") out.seed = +argv[++i] || 1;
    else if (a === "--seconds") out.seconds = +argv[++i] || 40;
    else if (a === "--sr") out.sampleRate = +argv[++i] || 48000;
    else if (a === "--format") out.format = argv[++i] || "jsonl";
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--playhead") out.playhead = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Air Dagger offline sim
  --seed N         PRNG seed for ProbGateTile (default 1)
  --seconds N      simulated audio seconds (default 40)
  --sr N           sample rate (default 48000)
  --format jsonl|tracker
  --out PATH       write event log
  --playhead       also log playhead cells (verbose)
  --quiet          less stdout`);
      process.exit(0);
    }
  }
  return out;
}

const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

const args = parseArgs(process.argv);
const t0 = performance.now();

// --- Seeded RNG self-check ---
{
  const a = createSeededRandom(args.seed);
  const b = createSeededRandom(args.seed);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert(seqA.every((v, i) => v === seqB[i]), "seeded RNG is deterministic");
  assert(seqA.every((v) => v >= 0 && v < 1), "seeded RNG in [0,1)");
  const c = createSeededRandom(args.seed + 99);
  assert(c() !== seqA[0] || c() !== seqA[1], "different seeds diverge");
}

// --- Suite builds ---
{
  for (const entry of AIR_DAGGER_SKETCHES) {
    const p = entry.build();
    assert(!!p, "build " + entry.id);
    assert(p.score.lanes.length >= 4, entry.id + " has lanes: " + p.score.lanes.length);
    assert((p.score.fxTriggers || []).some((t) => t.kind === "patgo"),
      entry.id + " has patgo jump");
    assert((p.score.fxModules || []).length >= 2, entry.id + " has FX");
    assert((p.score.fxTriggers || []).some((t) => t.kind === "param" || t.kind === "chan"),
      entry.id + " has param/chan automation");
  }
}

// --- Full sim ---
const result = simulateSuite(AIR_DAGGER_SKETCHES, {
  seed: args.seed,
  seconds: args.seconds,
  sampleRate: args.sampleRate,
  logPlayhead: args.playhead,
});

const { events, stats } = result;
const notes = events.filter((e) => e.type === "note");
const trigs = events.filter((e) => e.type === "trig");
const switches = events.filter((e) => e.type === "pattern" && e.op !== "start" && e.op !== "meta");

assert(notes.length > 50, "enough notes: " + notes.length);
assert(trigs.length > 5, "automation fires: " + trigs.length);
assert(switches.length >= 1, "at least one pattern switch: " + switches.length);

// All four patterns should appear if we sim long enough (~16s per form cycle × 4)
const seen = new Set(events.map((e) => e.pattern).filter(Boolean));
if (args.seconds >= 36) {
  for (const id of Object.values(AIR_DAGGER_IDS)) {
    assert(seen.has(id), "visited pattern " + id + " (seen: " + [...seen].join(",") + ")");
  }
}

// Determinism: second run identical note/trig stream
const result2 = simulateSuite(AIR_DAGGER_SKETCHES, {
  seed: args.seed,
  seconds: Math.min(args.seconds, 12),
  sampleRate: args.sampleRate,
});
const result3 = simulateSuite(AIR_DAGGER_SKETCHES, {
  seed: args.seed,
  seconds: Math.min(args.seconds, 12),
  sampleRate: args.sampleRate,
});
const sig = (r) => r.events
  .filter((e) => e.type === "note" || e.type === "trig" || e.type === "pattern")
  .map((e) => JSON.stringify(e))
  .join("\n");
assert(sig(result2) === sig(result3), "two runs with same seed produce identical events");

// Different seed should change probabilistic outcomes (usually)
const other = simulateSuite(AIR_DAGGER_SKETCHES, {
  seed: args.seed + 12345,
  seconds: 8,
  sampleRate: args.sampleRate,
});
const noteCountA = result2.events.filter((e) => e.type === "note").length;
const noteCountB = other.events.filter((e) => e.type === "note").length;
// Soft check — extremely unlikely equal across dense GPRB lattice
if (noteCountA === noteCountB) {
  // Compare midis stream
  const mA = result2.events.filter((e) => e.type === "note").map((e) => e.midi).join(",");
  const mB = other.events.filter((e) => e.type === "note").map((e) => e.midi).join(",");
  assert(mA !== mB, "different seeds should alter note stream");
} else {
  assert(true, "seed changes note count");
}

// Chords: same sample, multiple notes on pad channel
{
  const bySample = new Map();
  for (const n of notes) {
    if ((n.ch | 0) !== 4) continue;
    const k = n.sample;
    bySample.set(k, (bySample.get(k) || 0) + 1);
  }
  const maxChord = Math.max(0, ...bySample.values());
  assert(maxChord >= 3, "pad chords (≥3 notes same sample): max=" + maxChord);
}

// Write log
const body = args.format === "tracker" ? result.lines : result.jsonl;
const outPath = args.out
  ? resolve(args.out)
  : resolve(__dir, "../../test-output/air-dagger-seed" + args.seed +
    (args.format === "tracker" ? ".txt" : ".jsonl"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, "utf8");

const ms = performance.now() - t0;

if (!args.quiet) {
  console.log("Air Dagger sim");
  console.log("  seed=" + args.seed + "  seconds=" + args.seconds +
    "  sr=" + args.sampleRate);
  console.log("  events=" + stats.total +
    "  notes=" + stats.notes +
    "  trigs=" + stats.trigs +
    "  switches=" + stats.switches);
  console.log("  patterns: " + stats.patterns.join(" → "));
  console.log("  byType:", JSON.stringify(stats.byType));
  console.log("  wrote " + outPath + " (" + body.length + " bytes)");
  console.log("  elapsed " + ms.toFixed(1) + " ms");
}

// Sample first few events for eyeballing
if (!args.quiet) {
  console.log("  sample:");
  for (const e of events.slice(0, 8)) {
    console.log("   ", JSON.stringify(e));
  }
}

if (fails.length) {
  console.error("\nFAILED " + fails.length + " checks:");
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}

if (!args.quiet) console.log("\nOK");
process.exit(0);
