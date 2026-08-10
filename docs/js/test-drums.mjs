// Drum machine helpers + catalog packaging smoke test.
import {
  DRUM_PADS,
  padFromMidi,
  drumNoteLabel,
  midiForPadTune,
  isDrumRole,
  DRUM_ENGINE,
} from "./drums.js";
import {
  InstrumentCatalog,
  drumCatalog,
  synthCatalog,
  parseInstrument,
  patchFor,
  catalogEntry,
} from "./instruments.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Pad map
assert(padFromMidi(36).id === "kick", "C2 → kick");
assert(padFromMidi(38).id === "snare", "D2 → snare");
assert(padFromMidi(48).voice === "tom", "tom L");
assert(padFromMidi(78).voice === "hatc", "F#5 legacy hat");
assert(padFromMidi(50).id === "snare", "D3 legacy snare");

// Tune stays on the same pad (±4 around spaced centres)
for (const st of [-4, -2, 0, 2, 4]) {
  const m = midiForPadTune("tomM", st);
  assert(padFromMidi(m).id === "tomM", "tomM tune " + st + " → " + padFromMidi(m).id);
}
assert(padFromMidi(midiForPadTune("kick", -3)).id === "kick", "kick tune -3");
assert(padFromMidi(midiForPadTune("hatC", 2)).id === "hatC", "hatC tune +2");

// Catalog packaging
const drums = drumCatalog();
const synths = synthCatalog();
assert(drums.length >= 4, "has drum kits");
assert(drums.every((p) => p.engine === DRUM_ENGINE && p.role === "drum"), "kits are engine 14");
assert(!synths.some((p) => p.category === "kick"), "no loose kick synths");
assert(!InstrumentCatalog.some((p) => p.category === "snare"), "no loose snare synths");

assert(parseInstrument("kick") === DRUM_ENGINE, "legacy kick → kit engine");
assert(parseInstrument("kit-punch") === DRUM_ENGINE, "kit-punch");
assert(patchFor("kit-hard").instrument === DRUM_ENGINE, "patch engine");
assert(isDrumRole(catalogEntry("kit-room")), "isDrumRole");
assert(!isDrumRole(catalogEntry("fm-lead")), "fm not drum");

assert(drumNoteLabel(36) === "Kick", "label");
assert(DRUM_PADS.length === 10, "10 pads");

console.log("test-drums: ALL PASS");
console.log("  kits:", drums.map((d) => d.key).join(", "));
console.log("  synths:", synths.length, "pads:", DRUM_PADS.map((p) => p.short).join(" "));
