#!/usr/bin/env node
// Offline factory-pattern smoke tests.
//
// Discovers sketches from examples.js / examples-fx.js / examples-lab.js /
// examples-tr.js (optional) / examples-airdagger.js, builds each project,
// schedules ~6s of notes through Sequencer with a fixed RNG, and asserts
// finite note fields + structural sanity.
//
// Usage:
//   node docs/js/test-patterns.mjs

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Sequencer, noteEventFromPatch, PatchBank } from "./core.js";
import { SongSimulator } from "./sim-engine.js";
import { FACTORY_SKETCHES } from "./examples.js";
import { FX_FACTORY_SKETCHES } from "./examples-fx.js";
import { LAB_FACTORY_SKETCHES } from "./examples-lab.js";
import { AIR_DAGGER_SKETCHES } from "./examples-airdagger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 48000;
const LOOKAHEAD = SAMPLE_RATE * 6; // ~6 seconds
const fails = [];
const warnings = [];

function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

/**
 * Load examples-tr.js if present. If missing, wait once (~30s) and retry
 * (another agent may still be writing it).
 */
async function loadTrModule() {
  const path = join(__dir, "examples-tr.js");
  const url = () => pathToFileURL(path).href + `?t=${Date.now()}`;

  if (existsSync(path)) {
    try {
      return await import(url());
    } catch (err) {
      fails.push(`examples-tr.js present but failed to import: ${err?.message || err}`);
      return null;
    }
  }

  console.log("  examples-tr.js not present — will retry after other suites (~30s)…");
  return { _deferred: true, path, url };
}

async function retryTrModule(deferred) {
  await new Promise((r) => setTimeout(r, 30000));
  if (!existsSync(deferred.path)) {
    console.log("  examples-tr.js still missing — skipping TR sketches");
    return null;
  }
  try {
    const mod = await import(deferred.url());
    console.log("  examples-tr.js loaded on retry");
    return mod;
  } catch (err) {
    fails.push(`examples-tr.js import error on retry: ${err?.message || err}`);
    return null;
  }
}

function sketchesFrom(list, source, opts = {}) {
  /** @type {{ id: string, build: Function, source: string, allowZeroNotes: boolean }[]} */
  const out = [];
  if (!Array.isArray(list)) {
    if (list != null) fails.push(`${source}: expected sketch array, got ${typeof list}`);
    return out;
  }
  for (const s of list) {
    if (!s?.id || typeof s.build !== "function") {
      fails.push(`${source}: bad sketch entry ${JSON.stringify(s && s.id)}`);
      continue;
    }
    out.push({
      id: s.id,
      build: s.build,
      source,
      allowZeroNotes: !!opts.allowZeroNotes,
    });
  }
  return out;
}

function trSketchesFrom(mod) {
  if (!mod || mod._deferred) return [];
  const trList =
    mod.TR_FACTORY_SKETCHES ||
    mod.default ||
    null;
  return sketchesFrom(trList, "examples-tr");
}

function laneStats(project) {
  const lanes = project?.score?.lanes || [];
  const channelLanes = project?.score?.channelLanes || [];
  return {
    lanes: lanes.length,
    channelLanes: channelLanes.length,
  };
}

function patchInstruments(project) {
  const set = new Set();
  const banks = new Set();
  const patches = project?.patches;
  const n = PatchBank.Channels || 8;
  if (patches) {
    for (let ch = 1; ch <= n; ch++) {
      const p = PatchBank.get(patches, ch);
      if (!p) continue;
      if (p.instrument != null) set.add(String(p.instrument));
      if (p.drumBank) banks.add(String(p.drumBank));
    }
  }
  for (const inst of project?.score?.instruments || []) {
    if (inst?.drumBank) banks.add(String(inst.drumBank));
    if (inst?.key) set.add(String(inst.key));
    if (inst?.presetKey) set.add(String(inst.presetKey));
  }
  return {
    instruments: [...set].sort(),
    drumBanks: [...banks].sort(),
  };
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Schedule one sketch offline; return row for the summary table.
 * @returns {{ id: string, source: string, lanes: number, instruments: string, notes: number, drumBanks: string, ok: boolean }}
 */
function testSketch(entry) {
  const tag = `${entry.source}/${entry.id}`;
  const failAtStart = fails.length;
  const row = {
    id: entry.id,
    source: entry.source,
    lanes: 0,
    instruments: "",
    notes: 0,
    drumBanks: "",
    ok: false,
  };

  let project;
  try {
    project = entry.build();
  } catch (err) {
    assert(false, `${tag}: build() threw: ${err?.stack || err?.message || err}`);
    return row;
  }

  assert(!!project, `${tag}: build() returned null/undefined`);
  if (!project) {
    row.ok = false;
    return row;
  }

  assert(
    typeof project.title === "string" && project.title.length > 0,
    `${tag}: missing title`,
  );
  assert(
    typeof project.tempo === "number" && project.tempo > 0,
    `${tag}: tempo must be > 0 (got ${project.tempo})`,
  );

  const ls = laneStats(project);
  row.lanes = ls.channelLanes || ls.lanes;
  assert(
    ls.channelLanes > 0 || ls.lanes > 0,
    `${tag}: no channel lanes or lab-style lanes (lanes=${ls.lanes}, channelLanes=${ls.channelLanes})`,
  );

  const { instruments, drumBanks: bankList } = patchInstruments(project);
  row.instruments = instruments.slice(0, 8).join(",") || "-";
  row.drumBanks = bankList.join(",") || "-";

  // Direct noteEventFromPatch path for drumBank fidelity
  if (bankList.length > 0) {
    for (let ch = 1; ch <= (PatchBank.Channels || 8); ch++) {
      const patch = PatchBank.get(project.patches, ch);
      if (!patch?.drumBank) continue;
      const ev = noteEventFromPatch(patch, 36, 0.1, 0, ch);
      assert(
        ev.drumBank != null && String(ev.drumBank) === String(patch.drumBank),
        `${tag}: noteEventFromPatch lost drumBank for ch${ch} (patch=${patch.drumBank}, note=${ev.drumBank})`,
      );
      assert(finite(ev.frequency), `${tag}: noteEventFromPatch frequency`);
      assert(finite(ev.level), `${tag}: noteEventFromPatch level`);
      assert(Number.isFinite(ev.instrument), `${tag}: noteEventFromPatch instrument`);
      assert(Number.isFinite(ev.startSample), `${tag}: noteEventFromPatch startSample`);
    }
  }

  // Offline schedule
  const seq = new Sequencer();
  seq.project = project;
  seq._random = () => 0.3; // deterministic ProbGateTile outcomes
  const out = [];
  try {
    seq.play(0, 0);
    seq.schedule(0, LOOKAHEAD, SAMPLE_RATE, out);
  } catch (err) {
    assert(false, `${tag}: schedule threw: ${err?.stack || err?.message || err}`);
    row.ok = fails.length === failAtStart;
    return row;
  }

  row.notes = out.length;

  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    const pfx = `${tag} note[${i}]`;
    assert(finite(n.frequency), `${pfx}: frequency not finite (${n.frequency})`);
    assert(finite(n.level), `${pfx}: level not finite (${n.level})`);
    assert(
      typeof n.instrument === "number" && Number.isFinite(n.instrument),
      `${pfx}: instrument not finite (${n.instrument})`,
    );
    assert(
      typeof n.startSample === "number" && Number.isFinite(n.startSample),
      `${pfx}: startSample not finite (${n.startSample})`,
    );
    assert(n.startSample >= 0, `${pfx}: startSample < 0`);
    assert(n.frequency > 0, `${pfx}: frequency must be > 0`);
  }

  // Scheduled notes from drumBank channels must carry the bank
  if (bankList.length > 0 && out.length > 0) {
    const bankByCh = new Map();
    for (let ch = 1; ch <= (PatchBank.Channels || 8); ch++) {
      const patch = PatchBank.get(project.patches, ch);
      if (patch?.drumBank) bankByCh.set(ch, String(patch.drumBank));
    }
    for (const n of out) {
      const expect = bankByCh.get(n.channel | 0);
      if (!expect) continue;
      assert(
        n.drumBank != null && String(n.drumBank) === expect,
        `${tag}: scheduled note on ch${n.channel} missing drumBank (want ${expect}, got ${n.drumBank})`,
      );
    }
  }

  const allMuted =
    (project.score?.channelLanes || []).length > 0 &&
    (project.score?.channelLanes || []).every((l) => l.muted);
  if (out.length === 0) {
    if (!(entry.allowZeroNotes || allMuted)) {
      warn(`${tag}: 0 notes over 6s schedule (musical sketch?)`);
    }
  }

  row.ok = fails.length === failAtStart;
  return row;
}

function formatTable(rows) {
  const cols = ["id", "lanes", "instruments", "notes", "drumBanks", "ok"];
  const widths = {};
  for (const c of cols) {
    widths[c] = Math.max(
      c.length,
      ...rows.map((r) => String(r[c] ?? "").length),
    );
  }
  const line = (r) =>
    cols.map((c) => String(r[c] ?? "").padEnd(widths[c])).join(" | ");
  const header = line(Object.fromEntries(cols.map((c) => [c, c])));
  const sep = cols.map((c) => "-".repeat(widths[c])).join("-+-");
  return [header, sep, ...rows.map(line)].join("\n");
}

function displayId(row) {
  if (row.source === "examples") return row.id;
  const short = row.source.replace(/^examples-?/, "") || row.source;
  return `${short}:${row.id}`;
}

async function main() {
  console.log("test-patterns: discovering factory sketches…");

  const trOrDeferred = await loadTrModule();

  let sketches = [
    ...sketchesFrom(FACTORY_SKETCHES, "examples"),
    ...sketchesFrom(FX_FACTORY_SKETCHES, "examples-fx"),
    // Lab lanes start muted — 0 notes is expected
    ...sketchesFrom(LAB_FACTORY_SKETCHES, "examples-lab", { allowZeroNotes: true }),
    ...sketchesFrom(AIR_DAGGER_SKETCHES, "examples-airdagger"),
    ...trSketchesFrom(trOrDeferred && !trOrDeferred._deferred ? trOrDeferred : null),
  ];

  assert(sketches.length > 0, "no factory sketches discovered");
  console.log(`  found ${sketches.length} sketches (TR may still be pending)`);

  const rows = [];
  for (const entry of sketches) {
    rows.push(testSketch(entry));
  }

  // Deferred TR load after primary suite
  if (trOrDeferred?._deferred) {
    const trMod = await retryTrModule(trOrDeferred);
    const trList = trSketchesFrom(trMod);
    if (trList.length) {
      console.log(`\ntest-patterns: +${trList.length} TR sketches`);
      for (const entry of trList) {
        sketches.push(entry);
        rows.push(testSketch(entry));
      }
    }
  }

  // SongSimulator optional path (1–2 sketches with notes)
  console.log("\ntest-patterns: SongSimulator smoke…");
  {
    const candidates = sketches.filter((s) => !s.allowZeroNotes).slice(0, 2);
    if (candidates.length >= 1) {
      try {
        const sim = new SongSimulator({
          patterns: candidates.map((s) => ({ id: s.id, build: s.build })),
          seed: 7,
          sampleRate: SAMPLE_RATE,
        });
        const result = sim.run({ seconds: 4 });
        assert(!!result && Array.isArray(result.events), "SongSimulator: events array");
        assert(
          result.stats && typeof result.stats.notes === "number",
          "SongSimulator: stats.notes",
        );
        if (result.stats.notes === 0) {
          warn(
            "SongSimulator: 0 notes over 4s for " +
              candidates.map((c) => c.id).join(","),
          );
        }
        console.log(
          `  SongSimulator ok: patterns=${candidates.map((c) => c.id).join(",")} ` +
            `notes=${result.stats.notes} trigs=${result.stats.trigs}`,
        );
      } catch (err) {
        assert(false, `SongSimulator threw: ${err?.stack || err?.message || err}`);
      }
    } else {
      warn("SongSimulator: no non-lab sketches to run");
    }
  }

  console.log(
    "\n" +
      formatTable(
        rows.map((r) => ({
          id: displayId(r),
          lanes: r.lanes,
          instruments: r.instruments,
          notes: r.notes,
          drumBanks: r.drumBanks,
          ok: r.ok ? "yes" : "NO",
        })),
      ),
  );

  if (warnings.length) {
    console.log("\nWARNINGS (" + warnings.length + "):");
    for (const w of warnings) console.log("  - " + w);
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => !r.ok).length;

  if (fails.length) {
    console.error("\nFAIL (" + fails.length + "):\n - " + fails.join("\n - "));
    console.error(`\ntest-patterns: ${failed} sketch(es) failed, ${passed} passed`);
    process.exit(1);
  }

  console.log(`\ntest-patterns: ALL PASS (${passed}/${rows.length} sketches)`);
}

main().catch((err) => {
  console.error("test-patterns: fatal", err);
  process.exit(1);
});
