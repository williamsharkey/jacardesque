// Ten showcase compositions — each demonstrates a feature cluster:
// adjacency ON/OFF, FX/channel param chips, freeform lanes, gates, META, multi-channel.

import {
  Project,
  ChannelTile,
  NoteTile,
  CycleGateTile,
  ProbGateTile,
  ParamTile,
  JumpTile,
  ParamTargets,
  PatchBank,
  Pitch,
} from "./core.js";
import { patchFor } from "./instruments.js";
import {
  createFxModule,
  createFxTrigger,
  ensureFxLists,
} from "./fx-model.js";

function N(name) {
  return Pitch.tryParse(name) ?? 60;
}

function ch(num, div, label) {
  return new ChannelTile(num, div, label);
}

function fill(lane, step, ...tiles) {
  lane.steps[step].tiles.push(...tiles);
}

function setPatch(project, chNum, instrument, overrides) {
  Object.assign(PatchBank.get(project.patches, chNum), patchFor(instrument, overrides));
}

function lock(abs, target, amount) {
  const t = new ParamTile(abs);
  t.engage(target, amount);
  return t;
}

function base({ title, haiku, tempo = 110 }) {
  const p = new Project();
  p.title = title;
  p.haiku = haiku;
  p.tempo = tempo;
  ensureFxLists(p.score);
  for (let c = 1; c <= 8; c++) {
    setPatch(p, c, "fm", { level: 0.4, reverbSend: 0, delaySend: 0 });
  }
  return p;
}

function addPedal(p, type, x, y, params = {}, on = false) {
  const m = createFxModule(type, x, y);
  Object.assign(m.params, params);
  m.on = on;
  p.score.fxModules.push(m);
  return m;
}

function on(p, fx, x, y) {
  p.score.fxTriggers.push(createFxTrigger({ x, y, kind: "on", targetFxId: fx.id }));
}
function off(p, fx, x, y) {
  p.score.fxTriggers.push(createFxTrigger({ x, y, kind: "off", targetFxId: fx.id }));
}
function fxP(p, fx, x, y, paramKey, value) {
  p.score.fxTriggers.push(createFxTrigger({
    x, y, kind: "param", targetFxId: fx.id, paramKey, value,
  }));
}
function chP(p, channel, x, y, paramKey, value) {
  p.score.fxTriggers.push(createFxTrigger({
    x, y, kind: "chan", channel, paramKey, value,
  }));
}

// ---------------------------------------------------------------------------
// 1. Insert hall — ON/OFF adjacency (classic insert window)
// ---------------------------------------------------------------------------
function insertHall() {
  const p = base({
    title: "Insert hall",
    haiku: "Dry steps at the door / green ON opens the hallway / red OFF seals the air",
    tempo: 100,
  });
  setPatch(p, 1, "pluck", { level: 0.48 });
  const lane = p.score.addLane(1, 2, ch(1, 16, "Pluck"), 16);
  ["C4", "E4", "G4", "A4", "G4", "E4", "D4", "C4",
    "E4", "G4", "C5", "B4", "A4", "G4", "E4", "C4"].forEach((n, i) => {
    fill(lane, i, new NoteTile(N(n), 0.85));
  });
  const dly = addPedal(p, "delay", 6, 5, { mix: 0.5, time: 0.38, feedback: 0.42, tone: 0.35 }, false);
  // Adjacent below the rail: ON at step 4, OFF at step 12
  on(p, dly, 5, 3);
  off(p, dly, 13, 3);
  fxP(p, dly, 7, 3, "time", 0.18);
  fxP(p, dly, 11, 3, "time", 0.55);
  return p;
}

// ---------------------------------------------------------------------------
// 2. Stereo street — pan insert always on + pan chips
// ---------------------------------------------------------------------------
function stereoStreet() {
  const p = base({
    title: "Stereo street",
    haiku: "Left car then right car / gold chips flip the stereo / street becomes a wave",
    tempo: 118,
  });
  setPatch(p, 1, "fm", { level: 0.42, modulationIndex: 1.8 });
  const lead = p.score.addLane(1, 2, ch(1, 16, "Lead"), 16);
  ["A4", "C5", "E5", "A4", "G4", "E4", "C5", "B4"].forEach((n, i) => {
    fill(lead, i * 2, new NoteTile(N(n), 0.7));
  });
  const pan = addPedal(p, "pan", 12, 5, { mix: 1, pan: 0, width: 0.75 }, true);
  for (let i = 0; i < 8; i++) {
    fxP(p, pan, 1 + i * 2, 1, "pan", (i % 2 === 0) ? -0.9 : 0.9);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 3. Voice dial — channel Level / Mod index chips modulate the instrument
// ---------------------------------------------------------------------------
function voiceDial() {
  const p = base({
    title: "Voice dial",
    haiku: "Cyan chips on the curb / level dips then index blooms / same voice, new throat",
    tempo: 104,
  });
  setPatch(p, 1, "fm", { level: 0.45, modulationIndex: 1.2, reverbSend: 0.15 });
  const v = p.score.addLane(1, 2, ch(1, 16, "Voice"), 16);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(v, i, new NoteTile(N(i % 4 === 0 ? "C4" : "G4"), 0.9));
  }
  // Channel param triggers (cyan) above the lane
  chP(p, 1, 1, 1, "level", 0.25);
  chP(p, 1, 5, 1, "level", 0.7);
  chP(p, 1, 9, 1, "index", 0.8);
  chP(p, 1, 13, 1, "index", 6);
  return p;
}

// ---------------------------------------------------------------------------
// 4. Gate room — probability / cycle gates + reverb ON only on open hits
// ---------------------------------------------------------------------------
function gateRoom() {
  const p = base({
    title: "Gate room",
    haiku: "Most steps stay silent / when the gate opens, reverb / borrows the soft voice",
    tempo: 108,
  });
  setPatch(p, 1, "pad", { level: 0.38 });
  const lane = p.score.addLane(1, 2, ch(1, 16, "Pad"), 16);
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) fill(lane, i, new NoteTile(N("D3"), 2), new NoteTile(N("A3"), 2));
    else if (i % 4 === 2) {
      fill(lane, i, new CycleGateTile(2, 1), new NoteTile(N("G3"), 0.6));
    } else if (i % 4 === 3) {
      fill(lane, i, new ProbGateTile(45), new NoteTile(N("A3"), 0.4));
    }
  }
  const rvb = addPedal(p, "reverb", 12, 5, { mix: 0.55, size: 0.65, damp: 0.3 }, false);
  for (const s of [2, 6, 10, 14]) {
    on(p, rvb, 1 + s, 3);
    off(p, rvb, 2 + s, 3);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 5. Pedal stack — three inserts staggered ON (serial insert chain)
// ---------------------------------------------------------------------------
function pedalStack() {
  const p = base({
    title: "Pedal stack",
    haiku: "Three boxes on the floor / each ON chip wakes another / rooms inside of rooms",
    tempo: 84,
  });
  setPatch(p, 1, "pad", { level: 0.34 });
  setPatch(p, 2, "pluck", { level: 0.36 });
  const pad = p.score.addLane(1, 1, ch(1, 4, "Pad"), 4);
  fill(pad, 0, new NoteTile(N("G3"), 4), new NoteTile(N("D4"), 4));
  const pl = p.score.addLane(1, 4, ch(2, 8, "Pluck"), 8);
  fill(pl, 2, new NoteTile(N("B4"), 1));
  fill(pl, 6, new NoteTile(N("D5"), 1));
  const dst = addPedal(p, "distort", 12, 1, { mix: 0.22, drive: 0.3 }, false);
  const dly = addPedal(p, "delay", 16, 1, { mix: 0.38, time: 0.55, feedback: 0.4 }, false);
  const rvb = addPedal(p, "reverb", 12, 5, { mix: 0.4, size: 0.72, damp: 0.28 }, false);
  on(p, dst, 1, 2);
  on(p, dly, 2, 2);
  on(p, rvb, 3, 3);
  return p;
}

// ---------------------------------------------------------------------------
// 6. Metric tape — delay always on; time chips on the beat
// ---------------------------------------------------------------------------
function metricTape() {
  const p = base({
    title: "Metric tape",
    haiku: "Kick keeps the ruler / each diamond rewrites the tape / echo keeps the score",
    tempo: 126,
  });
  setPatch(p, 1, "kick");
  setPatch(p, 2, "hat", { level: 0.28 });
  setPatch(p, 3, "pluck", { level: 0.4 });
  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  for (let i = 0; i < 16; i += 4) fill(kick, i, new NoteTile(N("C2")));
  const hat = p.score.addLane(1, 3, ch(2, 16, "Hats"), 16);
  for (let i = 0; i < 16; i += 2) fill(hat, i, new NoteTile(N("F#5"), 0.2));
  const pl = p.score.addLane(1, 5, ch(3, 16, "Pluck"), 16);
  ["E4", "G4", "A4", "B4"].forEach((n, i) => fill(pl, i * 4, new NoteTile(N(n), 1)));
  const dly = addPedal(p, "delay", 12, 7, { mix: 0.42, time: 0.25, feedback: 0.32 }, true);
  [0.2, 0.35, 0.15, 0.5].forEach((t, i) => {
    fxP(p, dly, 1 + i * 4, 6, "time", t);
  });
  return p;
}

// ---------------------------------------------------------------------------
// 7. Filter wound — filter insert + cutoff chips + distort burst
// ---------------------------------------------------------------------------
function filterWound() {
  const p = base({
    title: "Filter wound",
    haiku: "Pad holds a long tone / cutoff climbs the gold ladder / grit opens mid-bar",
    tempo: 90,
  });
  setPatch(p, 1, "pad", { level: 0.36 });
  const pad = p.score.addLane(1, 2, ch(1, 8, "Pad"), 8);
  fill(pad, 0, new NoteTile(N("D3"), 4), new NoteTile(N("A3"), 4));
  fill(pad, 4, new NoteTile(N("F3"), 4), new NoteTile(N("C4"), 4));
  const flt = addPedal(p, "filter", 12, 2, { mix: 1, cutoff: 0.22, reso: 0.4 }, true);
  const dst = addPedal(p, "distort", 12, 5, { mix: 0.3, drive: 0.25 }, false);
  fxP(p, flt, 3, 1, "cutoff", 0.85);
  fxP(p, flt, 7, 1, "cutoff", 0.12);
  on(p, dst, 5, 3);
  off(p, dst, 8, 3);
  fxP(p, dst, 5, 6, "drive", 0.8);
  return p;
}

// ---------------------------------------------------------------------------
// 8. Branch river — JUMP / JDST + locks on the main stream
// ---------------------------------------------------------------------------
function branchRiverFixed() {
  const p = base({
    title: "Branch river",
    haiku: "Main stream holds the beat / JUMP spills into a side brook / locks shade the water",
    tempo: 112,
  });
  setPatch(p, 1, "bass", { level: 0.55 });
  setPatch(p, 2, "fm", { level: 0.35, modulationIndex: 2.2 });
  const main = p.score.addLane(1, 2, ch(1, 8, "Bass"), 8);
  fill(main, 0, new NoteTile(N("E2"), 2));
  fill(main, 2, lock(false, ParamTargets.Level, -0.2), new NoteTile(N("G2"), 1));
  const jump = new JumpTile();
  fill(main, 4, jump);
  fill(main, 5, new NoteTile(N("A2"), 2));
  fill(main, 7, new NoteTile(N("E2"), 1));
  const branch = p.score.addBranchLane(jump, { x: 1, y: 5 }, 4);
  // retarget branch channel
  if (branch.channel) {
    branch.channel.channel = 2;
    branch.channel.label = "Lead";
  }
  fill(branch, 0, new NoteTile(N("B4"), 1));
  fill(branch, 2, new NoteTile(N("D5"), 1));
  const dly = addPedal(p, "delay", 10, 7, { mix: 0.35, time: 0.4, feedback: 0.3 }, false);
  on(p, dly, 1, 6);
  off(p, dly, 4, 6);
  return p;
}

// ---------------------------------------------------------------------------
// 9. Pattern carousel — META P+/P→ with a short phrase bank
// ---------------------------------------------------------------------------
function patternCarousel() {
  // Single sketch that uses pattern modules; user switches via P+ on the grid.
  const p = base({
    title: "Pattern carousel",
    haiku: "P+ steps the sketch bank / transport never rewinds / phrase becomes a map",
    tempo: 120,
  });
  setPatch(p, 1, "kick");
  setPatch(p, 2, "pluck", { level: 0.4 });
  const kick = p.score.addLane(1, 1, ch(1, 8, "Kick"), 8);
  fill(kick, 0, new NoteTile(N("C2")));
  fill(kick, 4, new NoteTile(N("C2")));
  const pl = p.score.addLane(1, 3, ch(2, 8, "Pluck"), 8);
  fill(pl, 0, new NoteTile(N("E4"), 1));
  fill(pl, 2, new NoteTile(N("G4"), 1));
  fill(pl, 4, new NoteTile(N("A4"), 1));
  fill(pl, 6, new NoteTile(N("B4"), 1));
  // Pattern + / − modules (fire on column hit)
  addPedal(p, "pat+", 10, 1, {}, false);
  addPedal(p, "pat-", 12, 1, {}, false);
  const go = addPedal(p, "patgo", 14, 1, { n: 0 }, false);
  go.params.n = 2; // jump toward 3rd pattern when hit
  const rvb = addPedal(p, "reverb", 10, 5, { mix: 0.35, size: 0.5, damp: 0.4 }, true);
  return p;
}

// ---------------------------------------------------------------------------
// 10. Tape loop garden — freeform path + circular intent + dual delay chips
// ---------------------------------------------------------------------------
function tapeLoopGarden() {
  const p = base({
    title: "Tape loop garden",
    haiku: "Path bends like a vine / two delays trade feedback chips / loop never quite ends",
    tempo: 88,
  });
  setPatch(p, 1, "pluck", { level: 0.4 });
  setPatch(p, 2, "bell", { level: 0.3 });
  // Freeform-ish horizontal then we set path
  const pl = p.score.addLane(1, 2, ch(1, 12, "Pluck"), 12);
  ["D4", "F4", "A4", "C5", "A4", "F4"].forEach((n, i) => {
    fill(pl, i * 2, new NoteTile(N(n), 1.1));
  });
  // Bend path slightly (L-shape end)
  pl.ensurePath();
  for (let i = 8; i < 12; i++) {
    pl.path[i] = { x: 1 + i, y: 2 + (i - 8 > 1 ? 1 : 0) };
  }
  pl.syncOrigin();
  const bl = p.score.addLane(1, 5, ch(2, 8, "Bells"), 8);
  fill(bl, 1, new ProbGateTile(55), new NoteTile(N("D5"), 0.5));
  fill(bl, 5, new NoteTile(N("A5"), 0.5));
  const d1 = addPedal(p, "delay", 10, 7, { mix: 0.36, time: 0.7, feedback: 0.4, tone: 0.5 }, true);
  const d2 = addPedal(p, "delay", 15, 7, { mix: 0.3, time: 0.33, feedback: 0.28, tone: 0.25 }, true);
  const rvb = addPedal(p, "reverb", 20, 7, { mix: 0.28, size: 0.6, damp: 0.35 }, true);
  fxP(p, d1, 7, 1, "feedback", 0.72);
  fxP(p, d1, 11, 1, "feedback", 0.18);
  chP(p, 1, 3, 1, "level", 0.55);
  chP(p, 1, 9, 1, "level", 0.28);
  return p;
}

export const FX_FACTORY_SKETCHES = [
  { id: "insert-hall", build: insertHall },
  { id: "stereo-street", build: stereoStreet },
  { id: "voice-dial", build: voiceDial },
  { id: "gate-room", build: gateRoom },
  { id: "pedal-stack", build: pedalStack },
  { id: "metric-tape", build: metricTape },
  { id: "filter-wound", build: filterWound },
  { id: "branch-river", build: branchRiverFixed },
  { id: "pattern-carousel", build: patternCarousel },
  { id: "tape-loop-garden", build: tapeLoopGarden },
];
