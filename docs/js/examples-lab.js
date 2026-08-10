// Instrument lab — one muted lane per catalog preset for A/B rating.
// Turn ON mute switches one-at-a-time to audition.

import {
  Project,
  ChannelTile,
  NoteTile,
  Pitch,
  PatchBank,
} from "./core.js";
import { InstrumentCatalog, patchFor } from "./instruments.js";
import {
  createInstrumentModule,
  ensureInstruments,
  syncInstrumentPatch,
  setLaneInstrument,
} from "./inst-model.js";

function N(name) {
  return Pitch.tryParse(name) ?? 60;
}

function ch(num, div, label) {
  return new ChannelTile(num, div, label);
}

/** Rating-friendly pitches per category. */
const DEMO_NOTE = {
  drums: "C2", // kick pad on kit
  bass: "C2",
  pad: "C3",
  bell: "E5",
  pluck: "A4",
  fm: "E4",
  string: "A3",
  wave: "C4",
  organ: "C3",
  dx7: "E4",
  granular: "G3",
  sampler: "C3",
};

export function instrumentLab() {
  const p = new Project();
  p.title = "Instrument lab";
  p.haiku = "Catalog voices muted / flip ON one switch at a time / rate what you keep";
  p.tempo = 100;
  p.gridW = 48;
  p.gridH = 40;
  p.syncGrid();
  p.master = { userGain: 0.75, autoAtten: true, limiter: true };
  ensureInstruments(p.score);

  // Clear default empty-ish state — start with no lanes
  p.score.lanes = [];

  const catalog = InstrumentCatalog;
  const perRow = 1;
  let y = 1;
  let channel = 1;

  for (let i = 0; i < catalog.length; i++) {
    const preset = catalog[i];
    if (channel > PatchBank.Channels) break;

    const noteName = DEMO_NOTE[preset.category] || "C4";
    const x = 3;
    // Instrument pedal to the right
    const instX = 20;
    const inst = createInstrumentModule(preset.key, instX, y, {
      id: "lab-" + preset.key,
      channel,
    });
    p.score.instruments.push(inst);
    Object.assign(PatchBank.get(p.patches, channel), patchFor(preset.key));
    syncInstrumentPatch(p, inst);

    // 4-step lane: note on 0 and 2
    const lane = p.score.addLane(x, y, ch(channel, 8, preset.name), 4);
    lane.muted = true; // all start muted — flip ON one at a time
    setLaneInstrument(p.score, lane, inst);
    lane.steps[0].tiles.push(new NoteTile(N(noteName), 0.9));
    lane.steps[2].tiles.push(new NoteTile(N(noteName), 0.5));

    y += 3;
    channel++;
  }

  return p;
}

export const LAB_FACTORY_SKETCHES = [
  { id: "instrument-lab", build: instrumentLab },
];
