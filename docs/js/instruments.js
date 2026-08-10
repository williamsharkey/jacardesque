// Named instrument catalog — synth engines + drum machines (kits).
// patch.instrument = engine id 0–14 (what the worklet renders).
// Drums are role:"drum" kits (engine 14), not separate kick/snare/hat engines.

import catalog from "./instrument-catalog.json" with { type: "json" };
import { DRUM_ENGINE, isDrumRole } from "./drums.js";

/** Highest engine id the worklet knows (inclusive). */
export const MAX_ENGINE = 14;

/** Engine algorithms (processor switch). */
export const Instruments = {
  fm: 0,
  kick: 1,     // legacy single-voice (old sketches)
  snare: 2,    // legacy
  hat: 3,      // legacy
  bass: 4,
  pad: 5,
  bell: 6,
  pluck: 7,
  string: 8,   // Karplus–Strong physical model
  wave: 9,     // classic wavetable morph
  organ: 10,   // additive organ
  dx7: 11,     // 6-op DX7-style FM (32 algorithms)
  granular: 12, // grain cloud over shared pad buffer
  sampler: 13, // multi-sample procedural banks
  drum: DRUM_ENGINE, // full kit — pad selected by note MIDI
};

export const EngineNames = [
  "FM", "Kick", "Snare", "Hat", "Bass", "Pad", "Bell", "Pluck",
  "String", "Wave", "Organ", "DX7", "Granular", "Sampler", "DrumKit",
];

function clampEngine(n) {
  return Math.min(MAX_ENGINE, Math.max(0, n | 0));
}

/** Full catalog of named presets (synths + drum kits). */
export const InstrumentCatalog = catalog.map((p, i) => ({
  ...p,
  index: i,
  engine: clampEngine(p.engine),
  role: p.role || (p.engine === DRUM_ENGINE ? "drum" : "synth"),
}));

export const InstrumentKeys = InstrumentCatalog.map((p) => p.key);
export const InstrumentNames = InstrumentCatalog.map((p) => p.name);

/** Synth-only entries (exclude drum machines). */
export function synthCatalog() {
  return InstrumentCatalog.filter((p) => !isDrumRole(p));
}

/** Drum kit entries only. */
export function drumCatalog() {
  return InstrumentCatalog.filter((p) => isDrumRole(p));
}

/** Legacy short keys → catalog key (for old sketches / dock). */
const LEGACY_ALIAS = {
  fm: "fm-lead",
  // Old single drum "instruments" → punch kit (pad chosen by note)
  kick: "kit-punch",
  snare: "kit-punch",
  hat: "kit-punch",
  "kick-deep": "kit-soft",
  "kick-punch": "kit-punch",
  "kick-soft": "kit-soft",
  "kick-hard": "kit-hard",
  "snare-crisp": "kit-punch",
  "snare-fat": "kit-hard",
  "snare-rim": "kit-punch",
  "snare-room": "kit-room",
  "hat-closed": "kit-punch",
  "hat-open": "kit-room",
  "hat-tight": "kit-hard",
  "hat-soft": "kit-soft",
  bass: "bass-sub",
  pad: "pad-warm",
  bell: "bell-chime",
  pluck: "pluck-nylon",
  drum: "kit-punch",
  drums: "kit-punch",
};

export { isDrumRole, DRUM_ENGINE } from "./drums.js";

export function parseInstrument(key) {
  if (key == null || key === "") return 0;
  if (typeof key === "number") {
    // Treat as engine id for legacy patches
    return clampEngine(key);
  }
  const s = String(key).toLowerCase();
  const aliased = LEGACY_ALIAS[s] || s;
  const entry = InstrumentCatalog.find((p) => p.key === aliased);
  if (entry) return entry.engine;
  const eng = Instruments[s];
  return eng != null ? eng : 0;
}

/** Catalog entry for a UI key (or engine fallback). */
export function catalogEntry(keyOrEngine) {
  if (typeof keyOrEngine === "number") {
    return InstrumentCatalog.find((p) => p.engine === keyOrEngine) || InstrumentCatalog[0];
  }
  const s = String(keyOrEngine || "").toLowerCase();
  const aliased = LEGACY_ALIAS[s] || s;
  return InstrumentCatalog.find((p) => p.key === aliased) ||
    InstrumentCatalog.find((p) => p.engine === Instruments[s]) ||
    InstrumentCatalog[0];
}

export function instrumentKey(idOrKey) {
  if (typeof idOrKey === "string") {
    const e = catalogEntry(idOrKey);
    return e.key;
  }
  // engine id → first catalog entry of that engine
  const e = InstrumentCatalog.find((p) => p.engine === (idOrKey | 0));
  return e?.key || "fm-lead";
}

/**
 * Build a patch from catalog key or engine.
 * Sets instrument = engine id for the worklet.
 */
export function patchFor(instrument, overrides = {}) {
  const entry = catalogEntry(instrument);
  const base = {
    instrument: entry.engine,
    level: entry.level ?? 0.35,
    pan: 0,
    gateScale: entry.gateScale ?? 1,
    modulatorRatio: entry.modulatorRatio ?? 2,
    modulationIndex: entry.modulationIndex ?? 1,
    feedback: entry.feedback ?? 0.1,
    modulatorDecay: entry.modulatorDecay ?? 0.18,
    carrierAttack: entry.carrierAttack ?? 0.004,
    carrierRelease: entry.carrierRelease ?? 0.18,
    pitchSweep: entry.pitchSweep ?? 0,
    pitchDecay: entry.pitchDecay ?? 0.05,
    reverbSend: entry.reverbSend ?? 0.1,
    delaySend: entry.delaySend ?? 0.04,
    /** UI catalog key (not sent to worklet as engine, stored for recall) */
    catalogKey: entry.key,
  };
  return Object.assign(base, overrides, { instrument: entry.engine });
}

export function catalogByCategory() {
  const map = {};
  for (const p of InstrumentCatalog) {
    (map[p.category] ||= []).push(p);
  }
  return map;
}

/** Group INST menu: drum kits first, then synths by category. */
export function catalogMenuGroups() {
  const drums = drumCatalog();
  const synths = synthCatalog();
  const byCat = {};
  for (const p of synths) (byCat[p.category] ||= []).push(p);
  return { drums, synthsByCategory: byCat, synths };
}
