// Drum machines — kits of pads (not separate synth engines).
// One instrument hosts the full kit; MIDI selects the pad; pitch tunes it.

/** Pad voice ids used by the worklet drum-machine engine (14). */
export const DrumVoice = {
  kick: "kick",
  snare: "snare",
  rim: "rim",
  clap: "clap",
  tom: "tom",
  hatc: "hatc",
  hato: "hato",
  perc: "perc",
};

/**
 * Fixed kit layout (2×5 dock grid).
 * Centres are spaced ≥5 st so Tune ±2 (and usually ±4) keeps the same pad —
 * toms can be pitched independently without hopping to a neighbour.
 * Legacy sketch notes (C2 kick, D3 snare, F#5 hat) still map correctly.
 */
export const DRUM_PADS = [
  { id: "kick", label: "Kick", short: "KD", midi: 36, voice: DrumVoice.kick },   // C2
  { id: "snare", label: "Snare", short: "SN", midi: 38, voice: DrumVoice.snare }, // D2
  { id: "rim", label: "Rim", short: "RM", midi: 41, voice: DrumVoice.rim },
  { id: "clap", label: "Clap", short: "CP", midi: 44, voice: DrumVoice.clap },
  { id: "tomL", label: "Tom L", short: "T1", midi: 48, voice: DrumVoice.tom },
  { id: "tomM", label: "Tom M", short: "T2", midi: 58, voice: DrumVoice.tom },
  { id: "tomH", label: "Tom H", short: "T3", midi: 68, voice: DrumVoice.tom },
  { id: "hatC", label: "Hat C", short: "HC", midi: 74, voice: DrumVoice.hatc },
  { id: "hatO", label: "Hat O", short: "HO", midi: 80, voice: DrumVoice.hato },
  { id: "perc", label: "Perc", short: "PC", midi: 86, voice: DrumVoice.perc },
];

export const DRUM_ENGINE = 14;

const PAD_BY_ID = Object.fromEntries(DRUM_PADS.map((p) => [p.id, p]));

/** Catalog / InstTypes roles that use the pad dock (not piano). */
export function isDrumRole(entryOrKey) {
  if (!entryOrKey) return false;
  if (typeof entryOrKey === "object") {
    return entryOrKey.role === "drum" ||
      entryOrKey.category === "drums" ||
      entryOrKey.engine === DRUM_ENGINE;
  }
  const s = String(entryOrKey).toLowerCase();
  return s.startsWith("kit-") || s.startsWith("tr-") ||
    s === "drum" || s === "drums" ||
    s === "606" || s === "707" || s === "808" || s === "909";
}

export function padById(id) {
  return PAD_BY_ID[id] || DRUM_PADS[0];
}

export function padByMidiExact(midi) {
  const m = midi | 0;
  return DRUM_PADS.find((p) => p.midi === m) || null;
}

/**
 * Resolve which pad a note hits.
 * - Legacy high hats (F#5…) and D3 snare band for factory sketches
 * - Else nearest pad centre (spacing keeps Tune ±4 on the same pad)
 */
export function padFromMidi(midi) {
  const m = Math.min(127, Math.max(0, midi | 0));

  // Legacy sketches: closed/open hats on F#5 / G#5
  if (m >= 77 && m <= 90) {
    return (m % 2 === 0) ? PAD_BY_ID.hatC : PAD_BY_ID.hatO;
  }
  // Legacy factory snare on D3 only (do not swallow tom tuning)
  if (m === 50) return PAD_BY_ID.snare;
  // Very low leftovers → kick
  if (m < 34) return PAD_BY_ID.kick;

  let best = DRUM_PADS[0];
  let bestD = Infinity;
  for (const p of DRUM_PADS) {
    const d = Math.abs(p.midi - m);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Human label for a note on a drum machine (pad + optional tune). */
export function drumNoteLabel(midi) {
  const pad = padFromMidi(midi);
  const delta = (midi | 0) - pad.midi;
  if (delta === 0) return pad.label;
  const sign = delta > 0 ? "+" : "";
  return pad.short + " " + sign + delta;
}

/** Tune offset in semitones from pad centre (−12…+12). */
export function drumTuneOffset(midi) {
  const pad = padFromMidi(midi);
  return (midi | 0) - pad.midi;
}

/** Apply tune offset; clamp to sensible range around pad. */
export function midiForPadTune(padId, semitones) {
  const pad = padById(padId);
  const st = Math.min(12, Math.max(-12, Math.round(semitones) || 0));
  return Math.min(127, Math.max(0, pad.midi + st));
}

export function defaultDrumMidi() {
  return DRUM_PADS[0].midi; // Kick
}
