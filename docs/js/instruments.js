// Named instrument catalog — 30 presets over 8 synthesis engines.
// patch.instrument = engine id 0–7 (what the worklet renders).
// UI selection uses catalog keys (kick-deep, pad-warm, …).

import catalog from "./instrument-catalog.json" with { type: "json" };

/** Engine algorithms (processor switch). */
export const Instruments = {
  fm: 0,
  kick: 1,
  snare: 2,
  hat: 3,
  bass: 4,
  pad: 5,
  bell: 6,
  pluck: 7,
};

export const EngineNames = [
  "FM", "Kick", "Snare", "Hat", "Bass", "Pad", "Bell", "Pluck",
];

/** Full catalog of 30 named presets (agent-designed + level-tuned). */
export const InstrumentCatalog = catalog.map((p, i) => ({
  ...p,
  index: i,
  engine: Math.min(7, Math.max(0, p.engine | 0)),
}));

export const InstrumentKeys = InstrumentCatalog.map((p) => p.key);
export const InstrumentNames = InstrumentCatalog.map((p) => p.name);

/** Legacy short keys → catalog key (for old sketches / dock). */
const LEGACY_ALIAS = {
  fm: "fm-lead",
  kick: "kick-punch",
  snare: "snare-crisp",
  hat: "hat-closed",
  bass: "bass-sub",
  pad: "pad-warm",
  bell: "bell-chime",
  pluck: "pluck-nylon",
};

export function parseInstrument(key) {
  if (key == null || key === "") return 0;
  if (typeof key === "number") {
    // Treat as engine id for legacy patches
    return Math.min(7, Math.max(0, key | 0));
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
