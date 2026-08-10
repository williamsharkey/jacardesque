// Drum machine + TR sample kit packaging smoke test.
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
import { getTrKits, trKitIds, buildWorkletDrumBankPayload } from "./tr-kits-loader.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Pad map
assert(padFromMidi(36).id === "kick", "C2 → kick");
assert(padFromMidi(38).id === "snare", "D2 → snare");
assert(padFromMidi(48).voice === "tom", "tom L");
assert(padFromMidi(78).voice === "hatc", "F#5 legacy hat");
assert(padFromMidi(50).id === "snare", "D3 legacy snare");

for (const st of [-4, -2, 0, 2, 4]) {
  const m = midiForPadTune("tomM", st);
  assert(padFromMidi(m).id === "tomM", "tomM tune " + st);
}

// Catalog: TR machines as drum objects
const drums = drumCatalog();
const synths = synthCatalog();
assert(drums.length === 4, "4 TR kits");
assert(drums.every((p) => p.engine === DRUM_ENGINE && p.role === "drum" && p.drumBank), "kits have banks");
assert(drums.map((d) => d.drumBank).sort().join() === "606,707,808,909", "banks 606-909");
assert(!synths.some((p) => p.category === "kick"), "no loose kick synths");

assert(parseInstrument("kick") === DRUM_ENGINE, "legacy kick → drum engine");
assert(parseInstrument("tr-808") === DRUM_ENGINE, "tr-808");
assert(parseInstrument("808") === DRUM_ENGINE, "808 alias");
assert(patchFor("tr-909").drumBank === "909", "patch bank");
assert(patchFor("tr-606").instrument === DRUM_ENGINE, "606 engine");
assert(isDrumRole(catalogEntry("tr-707")), "isDrumRole");
assert(!isDrumRole(catalogEntry("fm-lead")), "fm not drum");

// Sample packs decode
const kits = getTrKits();
for (const id of ["606", "707", "808", "909"]) {
  assert(kits[id], "kit " + id);
  assert(kits[id].pads.kick?.length > 100, id + " kick samples");
  assert(kits[id].pads.snare?.length > 50, id + " snare");
  assert(kits[id].pads.hatC?.length > 20, id + " hatC");
}
assert(trKitIds().length === 4, "4 kit ids");

const payload = buildWorkletDrumBankPayload();
assert(payload.kits["808"].pads.kick instanceof Float32Array, "transferable floats");
assert(payload.transfer.length >= 40, "40 pad buffers");

assert(drumNoteLabel(36) === "Kick", "label");
assert(DRUM_PADS.length === 10, "10 pads");
assert(InstrumentCatalog.length >= 30, "catalog size");

console.log("test-drums: ALL PASS");
console.log("  machines:", drums.map((d) => d.key + "=" + d.drumBank).join(", "));
console.log("  pads/kit:", Object.keys(kits["808"].pads).join(" "));
console.log("  sample mem ~",
  (payload.transfer.reduce((a, b) => a + b.byteLength, 0) / 1024).toFixed(0), "KB float");
