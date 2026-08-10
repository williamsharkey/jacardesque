// Named instrument presets for the multi-timbre worklet.
// Apache-2.0 / MIT research path: SpessaSynth (SF2), smplr (MIT GM banks),
// FluidSynth-WASM — we ship a self-contained multi-algorithm worklet so GitHub
// Pages stays offline-first with no multi‑MB SoundFont download. SF2 remains
// an optional upgrade path (see README).

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

export const InstrumentNames = [
  "FM", "Kick", "Snare", "Hat", "Bass", "Pad", "Bell", "Pluck",
];

export const InstrumentKeys = [
  "fm", "kick", "snare", "hat", "bass", "pad", "bell", "pluck",
];

export function parseInstrument(key) {
  if (key == null || key === "") return 0;
  if (typeof key === "number") return Math.min(7, Math.max(0, key | 0));
  const i = InstrumentKeys.indexOf(String(key).toLowerCase());
  return i < 0 ? 0 : i;
}

export function instrumentKey(id) {
  return InstrumentKeys[id] || "fm";
}

// Sensible default patches per instrument — used by example sketches.
export function patchFor(instrument, overrides = {}) {
  const base = {
    instrument: parseInstrument(instrument),
    level: 0.55,
    pan: 0,
    gateScale: 1,
    modulatorRatio: 2,
    modulationIndex: 1.2,
    feedback: 0.15,
    modulatorDecay: 0.18,
    carrierAttack: 0.004,
    carrierRelease: 0.18,
    pitchSweep: 0,
    pitchDecay: 0.05,
    reverbSend: 0.12,
    delaySend: 0.05,
  };

  switch (base.instrument) {
    case Instruments.kick:
      Object.assign(base, {
        level: 0.7,
        modulatorRatio: 0.5,
        modulationIndex: 0.4,
        feedback: 0,
        modulatorDecay: 0.04,
        carrierAttack: 0.001,
        carrierRelease: 0.22,
        pitchSweep: -3.5,
        pitchDecay: 0.045,
        reverbSend: 0.08,
        delaySend: 0,
        gateScale: 0.7,
      });
      break;
    case Instruments.snare:
      Object.assign(base, {
        level: 0.5,
        modulatorRatio: 1.5,
        modulationIndex: 0.8,
        feedback: 0.1,
        modulatorDecay: 0.05,
        carrierAttack: 0.001,
        carrierRelease: 0.16,
        pitchSweep: -0.4,
        pitchDecay: 0.03,
        reverbSend: 0.18,
        delaySend: 0.04,
        gateScale: 0.55,
      });
      break;
    case Instruments.hat:
      Object.assign(base, {
        level: 0.28,
        modulatorRatio: 7.3,
        modulationIndex: 2.5,
        feedback: 1.2,
        modulatorDecay: 0.03,
        carrierAttack: 0.001,
        carrierRelease: 0.06,
        pitchSweep: 0,
        pitchDecay: 0.01,
        reverbSend: 0.1,
        delaySend: 0.02,
        gateScale: 0.35,
      });
      break;
    case Instruments.bass:
      Object.assign(base, {
        level: 0.6,
        modulatorRatio: 1,
        modulationIndex: 0.9,
        feedback: 0.35,
        modulatorDecay: 0.25,
        carrierAttack: 0.006,
        carrierRelease: 0.2,
        reverbSend: 0.06,
        delaySend: 0.08,
      });
      break;
    case Instruments.pad:
      Object.assign(base, {
        level: 0.35,
        modulatorRatio: 1.99,
        modulationIndex: 1.4,
        feedback: 0.05,
        modulatorDecay: 0.8,
        carrierAttack: 0.12,
        carrierRelease: 0.9,
        reverbSend: 0.45,
        delaySend: 0.2,
        gateScale: 1.4,
      });
      break;
    case Instruments.bell:
      Object.assign(base, {
        level: 0.4,
        modulatorRatio: 3.5,
        modulationIndex: 2.8,
        feedback: 0,
        modulatorDecay: 0.55,
        carrierAttack: 0.002,
        carrierRelease: 1.2,
        reverbSend: 0.35,
        delaySend: 0.12,
      });
      break;
    case Instruments.pluck:
      Object.assign(base, {
        level: 0.45,
        modulatorRatio: 2,
        modulationIndex: 1.6,
        feedback: 0.4,
        modulatorDecay: 0.08,
        carrierAttack: 0.001,
        carrierRelease: 0.28,
        reverbSend: 0.15,
        delaySend: 0.1,
        gateScale: 0.7,
      });
      break;
    default: // fm lead
      Object.assign(base, {
        level: 0.45,
        modulatorRatio: 2,
        modulationIndex: 1.5,
        feedback: 0.2,
        modulatorDecay: 0.14,
        carrierAttack: 0.005,
        carrierRelease: 0.16,
        reverbSend: 0.15,
        delaySend: 0.08,
      });
  }

  return Object.assign(base, overrides);
}
