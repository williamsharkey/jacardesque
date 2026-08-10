// Air Drawn Dagger — four-pattern polyrhythmic dance suite.
// Long hypermeters (3 / 5 / 7 / 15 / 16 / 21) so layers realign only after many bars.
// Patterns jump A → B → C → D → A via patgo chips (by sketch id).
// Heavy automation: insert ON/OFF, FX params, channel instrument chips,
// chords, cycle gates, probabilistic hats, param locks, lane jumps.

import {
  Project,
  ChannelTile,
  NoteTile,
  CycleGateTile,
  ProbGateTile,
  ParamTile,
  JumpTile,
  JumpDestTile,
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
import {
  createInstrumentModule,
  ensureInstruments,
  syncInstrumentPatch,
} from "./inst-model.js";

function N(name) {
  return Pitch.tryParse(name) ?? 60;
}

function ch(num, div, label) {
  return new ChannelTile(num, div, label);
}

function fill(lane, step, ...tiles) {
  if (!lane.steps[step]) return;
  for (const t of tiles) {
    if (t) lane.steps[step].tiles.push(t);
  }
}

function setPatch(project, chNum, instrument, overrides) {
  Object.assign(PatchBank.get(project.patches, chNum), patchFor(instrument, overrides));
}

function lock(abs, target, amount) {
  const t = new ParamTile(abs);
  t.engage(target, amount);
  return t;
}

function chord(lane, step, names, len = 1, extras = []) {
  fill(lane, step, ...extras, ...names.map((n) => new NoteTile(N(n), len)));
}

export const AIR_DAGGER_IDS = {
  a: "air-dagger-a",
  b: "air-dagger-b",
  c: "air-dagger-c",
  d: "air-dagger-d",
};

function base(letter, title, haiku, nextId) {
  const p = new Project();
  p.title = title;
  p.haiku = haiku;
  p.tempo = 128;
  p.gridW = 48;
  p.gridH = 24;
  p.syncGrid();
  ensureFxLists(p.score);
  p._suiteId = "air-dagger";
  p._suiteLetter = letter;
  p._suiteNext = nextId;
  for (let c = 1; c <= 8; c++) {
    setPatch(p, c, "fm", { level: 0.35 });
  }
  return p;
}

function addPedal(p, type, x, y, params, on, id) {
  const m = createFxModule(type, x, y, id);
  Object.assign(m.params, params);
  m.on = !!on;
  p.score.fxModules.push(m);
  return m;
}

function trig(p, spec) {
  p.score.fxTriggers.push(createFxTrigger(spec));
}

/** Place patgo under the last step of a form lane so A→B→C→D→A advances. */
function placeFormJump(p, formLane, nextId, id) {
  formLane.ensurePath();
  const last = formLane.path[formLane.path.length - 1];
  trig(p, {
    x: last.x,
    y: last.y + 1,
    kind: "patgo",
    targetPattern: nextId,
    id,
  });
}

function paintInstruments(p) {
  setPatch(p, 1, "kick", { level: 0.78, reverbSend: 0.05 });
  setPatch(p, 2, "hat", { level: 0.38, pan: 0.15, reverbSend: 0.12 });
  setPatch(p, 3, "bass", { level: 0.55, modulationIndex: 1.4 });
  setPatch(p, 4, "pad", { level: 0.28, carrierAttack: 0.08, carrierRelease: 0.6 });
  setPatch(p, 5, "snare", { level: 0.48, reverbSend: 0.2 });
  setPatch(p, 6, "pluck", { level: 0.36, pan: -0.25 });
  setPatch(p, 7, "bell", { level: 0.22, reverbSend: 0.35 });
  setPatch(p, 8, "fm", { level: 0.0 }); // silent form lane
}

/** Grid instrument pedals — lanes bind by nearest term → left corner. */
function placeVoice(p, type, channel, x, y, id) {
  ensureInstruments(p.score);
  const m = createInstrumentModule(type, x, y, { id, channel });
  p.score.instruments.push(m);
  syncInstrumentPatch(p, m);
  // Preserve intentional patch tweaks already applied via setPatch
  return m;
}

function placeVoiceBank(p, letter) {
  // Place just under each voice’s term so nearest-left-corner association is stable
  // (many lanes → one instrument still works when terms cluster).
  // Keep clear of FX pedals around x≥20,y≤4.
  const tag = "ad-" + letter.toLowerCase();
  placeVoice(p, "kick", 1, 18, 2, tag + "-kik");   // kick term ~17,1
  placeVoice(p, "hat", 2, 17, 4, tag + "-hat");     // hats term ~16,3
  placeVoice(p, "bass", 3, 16, 6, tag + "-bas");    // bass term ~15,5
  placeVoice(p, "pad", 4, 23, 8, tag + "-pad");     // pad term ~22,7
  placeVoice(p, "snare", 5, 12, 4, tag + "-snr");
  placeVoice(p, "pluck", 6, 11, 10, tag + "-plk");
  placeVoice(p, "bell", 7, 7, 12, tag + "-bel");
}

// ---------------------------------------------------------------------------
// A — Foundation: 4/4 kick, 15-hat, 14-bass, 21-pad; delay room opens
// ---------------------------------------------------------------------------
function patternA() {
  const p = base("A", "Air Dagger · A",
    "Black pulse under glass / fifteens scrape against the kick / seven never lands",
    AIR_DAGGER_IDS.b);
  paintInstruments(p);
  placeVoiceBank(p, "A");

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  for (const i of [0, 4, 8, 12]) fill(kick, i, new NoteTile(N("C2"), 0.85));
  fill(kick, 6, new CycleGateTile(5, 3), new NoteTile(N("C2"), 0.35));
  fill(kick, 10, new ProbGateTile(40), new NoteTile(N("C2"), 0.25));
  fill(kick, 14, new CycleGateTile(3, 2), new NoteTile(N("C2"), 0.4));

  // Hats — length 15 (phase vs 16)
  const hats = p.score.addLane(1, 3, ch(2, 16, "Hats"), 15);
  for (let i = 0; i < 15; i++) {
    if (i % 3 === 0) fill(hats, i, new NoteTile(N("F#5"), 0.18));
    else if (i % 5 === 0) fill(hats, i, new ProbGateTile(55), new NoteTile(N("G#5"), 0.12));
    else fill(hats, i, new ProbGateTile(28), new NoteTile(N("F#5"), 0.1));
  }

  // Bass — length 14 (2×7)
  const bass = p.score.addLane(1, 5, ch(3, 8, "Bass"), 14);
  const bassNotes = ["C2", "C2", "Eb2", "C2", "G1", "G1", "Bb1",
    "C2", "Eb2", "F2", "Eb2", "C2", "Bb1", "G1"];
  bassNotes.forEach((n, i) => {
    fill(bass, i,
      i % 7 === 0 ? lock(false, ParamTargets.Level, 0.12) : null,
      i % 5 === 3 ? lock(true, ParamTargets.ModIndex, 2.4) : null,
      i % 3 === 2 ? new ProbGateTile(70) : null,
      new NoteTile(N(n), 0.9),
    );
  });

  // Pad chords — length 21 (3×7)
  const pad = p.score.addLane(1, 7, ch(4, 8, "Pad"), 21);
  chord(pad, 0, ["C3", "Eb3", "G3", "Bb3"], 2.5);
  chord(pad, 7, ["Ab2", "C3", "Eb3", "G3"], 2.2, [new CycleGateTile(3, 1)]);
  chord(pad, 14, ["Bb2", "D3", "F3", "Ab3"], 2.0, [new ProbGateTile(80)]);

  // Form — 16 @ div 4 ≈ 4 bars → jump to B
  const form = p.score.addLane(1, 10, ch(8, 4, "Form"), 16);
  placeFormJump(p, form, AIR_DAGGER_IDS.b, "ad-a-patgo");

  const dly = addPedal(p, "delay", 20, 1, {
    mix: 0.22, time: 0.375, feedback: 0.38, tone: 0.4,
  }, false, "ad-a-dly");
  const rvb = addPedal(p, "reverb", 26, 1, {
    mix: 0.18, size: 0.55, damp: 0.4,
  }, true, "ad-a-rvb");
  const flt = addPedal(p, "filter", 32, 1, {
    mix: 1, cutoff: 0.7, reso: 0.18,
  }, true, "ad-a-flt");

  trig(p, { x: 5, y: 2, kind: "on", targetFxId: dly.id, id: "ad-a-dly-on" });
  trig(p, { x: 13, y: 2, kind: "off", targetFxId: dly.id, id: "ad-a-dly-off" });
  trig(p, { x: 3, y: 2, kind: "param", targetFxId: dly.id, paramKey: "mix", value: 0.45, id: "ad-a-mix-hi" });
  trig(p, { x: 11, y: 2, kind: "param", targetFxId: dly.id, paramKey: "mix", value: 0.12, id: "ad-a-mix-lo" });
  trig(p, { x: 7, y: 2, kind: "param", targetFxId: dly.id, paramKey: "feedback", value: 0.62, id: "ad-a-fbk" });
  trig(p, { x: 9, y: 2, kind: "param", targetFxId: flt.id, paramKey: "cutoff", value: 0.35, id: "ad-a-cut" });
  trig(p, { x: 4, y: 6, kind: "chan", channel: 3, paramKey: "level", value: 0.7, id: "ad-a-bs-hi" });
  trig(p, { x: 10, y: 6, kind: "chan", channel: 3, paramKey: "level", value: 0.35, id: "ad-a-bs-lo" });
  trig(p, { x: 2, y: 4, kind: "chan", channel: 2, paramKey: "pan", value: -0.6, id: "ad-a-hat-l" });
  trig(p, { x: 8, y: 4, kind: "chan", channel: 2, paramKey: "pan", value: 0.6, id: "ad-a-hat-r" });
  trig(p, { x: 22, y: 3, kind: "param", targetFxId: rvb.id, paramKey: "mix", value: 0.4, id: "ad-a-rvb-mix" });

  return p;
}

// ---------------------------------------------------------------------------
// B — Pressure: snare lattice of 5, 7-cycle kicks, filter wound, pluck 3s
// ---------------------------------------------------------------------------
function patternB() {
  const p = base("B", "Air Dagger · B",
    "Snare of five teeth / filter winds the minor third / three-pluck needles",
    AIR_DAGGER_IDS.c);
  paintInstruments(p);
  placeVoiceBank(p, "B");
  setPatch(p, 1, "kick", { level: 0.72 });
  setPatch(p, 5, "snare", { level: 0.55 });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  for (const i of [0, 3, 8, 11]) fill(kick, i, new NoteTile(N("C2"), 0.8));
  fill(kick, 5, new CycleGateTile(7, 2), new NoteTile(N("C2"), 0.3));
  fill(kick, 13, new CycleGateTile(7, 5), new NoteTile(N("C2"), 0.35));
  fill(kick, 15, new ProbGateTile(50), new NoteTile(N("C2"), 0.2));

  const snare = p.score.addLane(1, 3, ch(5, 16, "Snare"), 10);
  fill(snare, 4, new NoteTile(N("D3"), 0.4));
  fill(snare, 9, new NoteTile(N("D3"), 0.35));
  fill(snare, 2, new ProbGateTile(45), new NoteTile(N("D3"), 0.2));
  fill(snare, 6, new CycleGateTile(5, 3), new NoteTile(N("D3"), 0.25));
  fill(snare, 7, new ProbGateTile(30), new NoteTile(N("D3"), 0.15));

  const hats = p.score.addLane(1, 5, ch(2, 16, "Hats"), 21);
  for (let i = 0; i < 21; i++) {
    if (i % 7 === 0) fill(hats, i, new NoteTile(N("F#5"), 0.2));
    else if (i % 3 === 0) fill(hats, i, new ProbGateTile(60), new NoteTile(N("A5"), 0.12));
    else fill(hats, i, new ProbGateTile(18), new NoteTile(N("F#5"), 0.08));
  }

  const bass = p.score.addLane(1, 7, ch(3, 8, "Bass"), 15);
  ["C2", "Eb2", "G2", "C2", "Bb1", "Ab1", "G1", "C2",
    "Eb2", "F2", "G2", "Bb1", "C2", "Eb2", "C2"].forEach((n, i) => {
    fill(bass, i,
      i % 5 === 0 ? lock(false, ParamTargets.ModIndex, 0.8) : null,
      i % 3 === 1 ? new ProbGateTile(85) : null,
      new NoteTile(N(n), 0.85),
    );
  });

  const pluck = p.score.addLane(1, 9, ch(6, 12, "Pluck"), 9);
  ["G4", "Bb4", "C5", "Eb5", "C5", "Bb4", "G4", "F4", "Eb4"].forEach((n, i) => {
    fill(pluck, i, new CycleGateTile(3, (i % 3) + 1), new NoteTile(N(n), 0.5));
  });

  const pad = p.score.addLane(18, 9, ch(4, 8, "Pad"), 7);
  chord(pad, 0, ["C3", "G3", "Bb3"], 1.5);
  chord(pad, 3, ["Eb3", "Ab3", "C4"], 1.2, [new ProbGateTile(65)]);
  chord(pad, 5, ["F3", "Ab3", "C4", "Eb4"], 1.0, [new CycleGateTile(5, 2)]);

  const form = p.score.addLane(1, 12, ch(8, 4, "Form"), 16);
  placeFormJump(p, form, AIR_DAGGER_IDS.c, "ad-b-patgo");

  const dly = addPedal(p, "delay", 22, 1, {
    mix: 0.3, time: 0.28, feedback: 0.45, tone: 0.3,
  }, true, "ad-b-dly");
  const dst = addPedal(p, "distort", 28, 1, {
    mix: 0.0, drive: 0.55,
  }, false, "ad-b-dst");
  const flt = addPedal(p, "filter", 33, 1, {
    mix: 1, cutoff: 0.55, reso: 0.35,
  }, true, "ad-b-flt");
  const panFx = addPedal(p, "pan", 38, 1, {
    mix: 1, pan: 0, width: 0.6,
  }, true, "ad-b-pan");

  trig(p, { x: 5, y: 2, kind: "on", targetFxId: dst.id, id: "ad-b-dst-on" });
  trig(p, { x: 12, y: 2, kind: "off", targetFxId: dst.id, id: "ad-b-dst-off" });
  trig(p, { x: 3, y: 2, kind: "param", targetFxId: dst.id, paramKey: "mix", value: 0.4, id: "ad-b-dst-mix" });
  trig(p, { x: 7, y: 2, kind: "param", targetFxId: flt.id, paramKey: "cutoff", value: 0.22, id: "ad-b-cut-lo" });
  trig(p, { x: 14, y: 2, kind: "param", targetFxId: flt.id, paramKey: "cutoff", value: 0.85, id: "ad-b-cut-hi" });
  trig(p, { x: 9, y: 2, kind: "param", targetFxId: flt.id, paramKey: "reso", value: 0.7, id: "ad-b-reso" });
  trig(p, { x: 4, y: 4, kind: "param", targetFxId: panFx.id, paramKey: "pan", value: -0.8, id: "ad-b-pan-l" });
  trig(p, { x: 8, y: 4, kind: "param", targetFxId: panFx.id, paramKey: "pan", value: 0.8, id: "ad-b-pan-r" });
  trig(p, { x: 6, y: 4, kind: "param", targetFxId: dly.id, paramKey: "time", value: 0.5, id: "ad-b-time" });
  trig(p, { x: 5, y: 8, kind: "chan", channel: 3, paramKey: "index", value: 3.5, id: "ad-b-mod" });
  trig(p, { x: 11, y: 8, kind: "chan", channel: 3, paramKey: "index", value: 0.6, id: "ad-b-mod2" });
  trig(p, { x: 3, y: 6, kind: "chan", channel: 2, paramKey: "level", value: 0.55, id: "ad-b-hat-lv" });

  return p;
}

// ---------------------------------------------------------------------------
// C — Hollow: sparse kick, jump branch, long reverb, bells of 5, bass of 21
// ---------------------------------------------------------------------------
function patternC() {
  const p = base("C", "Air Dagger · C",
    "Hollow bar of seven / branch eats the snare then returns / bells of five remain",
    AIR_DAGGER_IDS.d);
  paintInstruments(p);
  placeVoiceBank(p, "C");
  setPatch(p, 1, "kick", { level: 0.55 });
  setPatch(p, 7, "bell", { level: 0.32, reverbSend: 0.45 });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  fill(kick, 0, new NoteTile(N("C2"), 1.0));
  fill(kick, 8, new CycleGateTile(3, 1), new NoteTile(N("C2"), 0.6));
  fill(kick, 12, new ProbGateTile(40), new NoteTile(N("C2"), 0.3));

  const snare = p.score.addLane(1, 3, ch(5, 16, "Snare"), 16);
  fill(snare, 4, new NoteTile(N("D3"), 0.4));
  const jump = new JumpTile();
  fill(snare, 8, new CycleGateTile(4, 3), jump);
  fill(snare, 12, new ProbGateTile(55), new NoteTile(N("D3"), 0.25));

  const dest = p.score.addLane(14, 5, new JumpDestTile(), 6);
  dest.jumpSource = jump;
  fill(dest, 0, new NoteTile(N("F3"), 0.3), new NoteTile(N("Ab3"), 0.3));
  fill(dest, 2, new ProbGateTile(70), new NoteTile(N("D3"), 0.35));
  fill(dest, 3, lock(true, ParamTargets.Level, 0.65), new NoteTile(N("D3"), 0.5));
  fill(dest, 4, new NoteTile(N("C3"), 0.25));

  const hats = p.score.addLane(1, 7, ch(2, 16, "Hats"), 7);
  for (let i = 0; i < 7; i++) {
    fill(hats, i, new ProbGateTile(35 + i * 5), new NoteTile(N(i % 2 ? "A5" : "F#5"), 0.1));
  }

  const bass = p.score.addLane(1, 9, ch(3, 8, "Bass"), 21);
  const scale = ["C1", "C1", "Eb1", "G1", "Bb1", "C2", "Eb2"];
  for (let i = 0; i < 21; i++) {
    fill(bass, i,
      new CycleGateTile(7, (i % 7) + 1),
      i % 5 === 0 ? lock(false, ParamTargets.Level, -0.15) : null,
      new NoteTile(N(scale[i % 7]), 1.1),
    );
  }

  const bells = p.score.addLane(1, 11, ch(7, 8, "Bells"), 5);
  ["G5", "Bb5", "C6", "Eb6", "G6"].forEach((n, i) => {
    fill(bells, i, new ProbGateTile(50 + i * 8), new NoteTile(N(n), 0.6));
  });

  const pad = p.score.addLane(12, 11, ch(4, 4, "Pad"), 15);
  chord(pad, 0, ["C3", "Eb3", "G3"], 3);
  chord(pad, 5, ["Ab2", "C3", "Eb3", "G3"], 3, [new ProbGateTile(75)]);
  chord(pad, 10, ["Bb2", "D3", "F3"], 3, [new CycleGateTile(3, 2)]);

  const form = p.score.addLane(1, 14, ch(8, 4, "Form"), 16);
  placeFormJump(p, form, AIR_DAGGER_IDS.d, "ad-c-patgo");

  const rvb = addPedal(p, "reverb", 22, 1, {
    mix: 0.1, size: 0.75, damp: 0.3,
  }, false, "ad-c-rvb");
  const dly = addPedal(p, "delay", 28, 1, {
    mix: 0.35, time: 0.66, feedback: 0.5, tone: 0.55,
  }, true, "ad-c-dly");
  const flt = addPedal(p, "filter", 34, 1, {
    mix: 1, cutoff: 0.4, reso: 0.25,
  }, true, "ad-c-flt");

  trig(p, { x: 2, y: 2, kind: "on", targetFxId: rvb.id, id: "ad-c-rvb-on" });
  trig(p, { x: 14, y: 2, kind: "off", targetFxId: rvb.id, id: "ad-c-rvb-off" });
  trig(p, { x: 5, y: 2, kind: "param", targetFxId: rvb.id, paramKey: "mix", value: 0.55, id: "ad-c-rvb-hi" });
  trig(p, { x: 10, y: 2, kind: "param", targetFxId: rvb.id, paramKey: "mix", value: 0.15, id: "ad-c-rvb-lo" });
  trig(p, { x: 6, y: 2, kind: "param", targetFxId: dly.id, paramKey: "feedback", value: 0.72, id: "ad-c-fbk" });
  trig(p, { x: 11, y: 2, kind: "param", targetFxId: dly.id, paramKey: "feedback", value: 0.2, id: "ad-c-fbk2" });
  trig(p, { x: 4, y: 8, kind: "param", targetFxId: flt.id, paramKey: "cutoff", value: 0.15, id: "ad-c-cut" });
  trig(p, { x: 8, y: 8, kind: "param", targetFxId: flt.id, paramKey: "cutoff", value: 0.9, id: "ad-c-cut2" });
  trig(p, { x: 3, y: 12, kind: "chan", channel: 7, paramKey: "level", value: 0.5, id: "ad-c-bell-lv" });
  trig(p, { x: 5, y: 10, kind: "chan", channel: 3, paramKey: "pan", value: -0.5, id: "ad-c-bs-pan" });
  trig(p, { x: 12, y: 10, kind: "chan", channel: 3, paramKey: "pan", value: 0.5, id: "ad-c-bs-pan2" });

  return p;
}

// ---------------------------------------------------------------------------
// D — Peak: everything stacked, 3×5×7 density, then jump home to A
// ---------------------------------------------------------------------------
function patternD() {
  const p = base("D", "Air Dagger · D",
    "All cycles collide / dagger drawn across the bus / four bars then return",
    AIR_DAGGER_IDS.a);
  paintInstruments(p);
  placeVoiceBank(p, "D");
  setPatch(p, 1, "kick", { level: 0.82 });
  setPatch(p, 5, "snare", { level: 0.58 });
  setPatch(p, 6, "pluck", { level: 0.42 });
  setPatch(p, 4, "pad", { level: 0.34 });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  for (const i of [0, 4, 8, 12]) fill(kick, i, new NoteTile(N("C2"), 0.9));
  fill(kick, 2, new ProbGateTile(35), new NoteTile(N("C2"), 0.25));
  fill(kick, 6, new CycleGateTile(3, 2), new NoteTile(N("C2"), 0.3));
  fill(kick, 10, new CycleGateTile(5, 4), new NoteTile(N("C2"), 0.35));
  fill(kick, 14, new CycleGateTile(7, 6), new NoteTile(N("C2"), 0.3));

  const snare = p.score.addLane(1, 3, ch(5, 16, "Snare"), 16);
  fill(snare, 4, new NoteTile(N("D3"), 0.45));
  fill(snare, 12, new NoteTile(N("D3"), 0.45));
  fill(snare, 6, new ProbGateTile(40), new NoteTile(N("D3"), 0.2));
  fill(snare, 10, new CycleGateTile(5, 2), new NoteTile(N("D3"), 0.25));
  fill(snare, 14, new ProbGateTile(60), new NoteTile(N("D3"), 0.2));

  const hats = p.score.addLane(1, 5, ch(2, 16, "Hats"), 15);
  for (let i = 0; i < 15; i++) {
    fill(hats, i,
      i % 3 === 0 ? new NoteTile(N("F#5"), 0.15) : new ProbGateTile(40),
      i % 3 !== 0 ? new NoteTile(N(i % 5 === 0 ? "A5" : "F#5"), 0.1) : null,
    );
  }

  const bass = p.score.addLane(1, 7, ch(3, 8, "Bass"), 14);
  ["C2", "Eb2", "G2", "C3", "Bb2", "G2", "F2",
    "Eb2", "C2", "G1", "Bb1", "C2", "Eb2", "G2"].forEach((n, i) => {
    fill(bass, i,
      lock(i % 2 === 0, ParamTargets.Level, i % 2 === 0 ? 0.15 : 0.5),
      i % 7 === 3 ? lock(true, ParamTargets.ModIndex, 3.2) : null,
      new NoteTile(N(n), 0.8),
    );
  });

  const pluck = p.score.addLane(1, 9, ch(6, 12, "Pluck"), 21);
  const arp = ["C5", "Eb5", "G5", "Bb5", "C6", "Bb5", "G5"];
  for (let i = 0; i < 21; i++) {
    fill(pluck, i,
      new CycleGateTile(3, (i % 3) + 1),
      new ProbGateTile(50 + (i % 7) * 5),
      new NoteTile(N(arp[i % 7]), 0.4),
    );
  }

  const pad = p.score.addLane(1, 11, ch(4, 8, "Pad"), 7);
  chord(pad, 0, ["C3", "Eb3", "G3", "Bb3", "D4"], 1.8);
  chord(pad, 3, ["Ab2", "C3", "Eb3", "G3", "C4"], 1.5, [new ProbGateTile(90)]);
  chord(pad, 5, ["Bb2", "D3", "F3", "Ab3", "C4"], 1.5, [new CycleGateTile(5, 1)]);

  const bells = p.score.addLane(18, 11, ch(7, 8, "Bells"), 5);
  ["C6", "Eb6", "G6", "Bb6", "C7"].forEach((n, i) => {
    fill(bells, i, new ProbGateTile(70), new NoteTile(N(n), 0.5));
  });

  const form = p.score.addLane(1, 14, ch(8, 4, "Form"), 16);
  placeFormJump(p, form, AIR_DAGGER_IDS.a, "ad-d-patgo");

  const dly = addPedal(p, "delay", 22, 1, {
    mix: 0.4, time: 0.33, feedback: 0.48, tone: 0.35,
  }, true, "ad-d-dly");
  const rvb = addPedal(p, "reverb", 28, 1, {
    mix: 0.3, size: 0.65, damp: 0.35,
  }, true, "ad-d-rvb");
  const dst = addPedal(p, "distort", 34, 1, {
    mix: 0.15, drive: 0.6,
  }, true, "ad-d-dst");
  const flt = addPedal(p, "filter", 39, 1, {
    mix: 1, cutoff: 0.6, reso: 0.4,
  }, true, "ad-d-flt");

  // Dense automation lattice along kick
  for (let i = 0; i < 8; i++) {
    const x = 2 + i * 2;
    trig(p, {
      x, y: 2,
      kind: "param",
      targetFxId: flt.id,
      paramKey: "cutoff",
      value: 0.2 + (i / 7) * 0.7,
      id: "ad-d-cut-" + i,
    });
  }
  trig(p, { x: 3, y: 2, kind: "param", targetFxId: dly.id, paramKey: "mix", value: 0.55, id: "ad-d-mix-hi" });
  trig(p, { x: 11, y: 2, kind: "param", targetFxId: dly.id, paramKey: "mix", value: 0.18, id: "ad-d-mix-lo" });
  trig(p, { x: 5, y: 2, kind: "param", targetFxId: dst.id, paramKey: "mix", value: 0.45, id: "ad-d-dst-hi" });
  trig(p, { x: 13, y: 2, kind: "param", targetFxId: dst.id, paramKey: "mix", value: 0.05, id: "ad-d-dst-lo" });
  trig(p, { x: 7, y: 2, kind: "param", targetFxId: rvb.id, paramKey: "mix", value: 0.5, id: "ad-d-rvb" });
  trig(p, { x: 4, y: 4, kind: "chan", channel: 5, paramKey: "level", value: 0.7, id: "ad-d-sn-hi" });
  trig(p, { x: 12, y: 4, kind: "chan", channel: 5, paramKey: "level", value: 0.3, id: "ad-d-sn-lo" });
  trig(p, { x: 6, y: 8, kind: "chan", channel: 3, paramKey: "index", value: 4.0, id: "ad-d-mod" });
  trig(p, { x: 3, y: 6, kind: "chan", channel: 2, paramKey: "pan", value: -0.9, id: "ad-d-hat-l" });
  trig(p, { x: 9, y: 6, kind: "chan", channel: 2, paramKey: "pan", value: 0.9, id: "ad-d-hat-r" });
  trig(p, { x: 2, y: 10, kind: "chan", channel: 6, paramKey: "level", value: 0.55, id: "ad-d-pl-hi" });
  trig(p, { x: 10, y: 10, kind: "chan", channel: 6, paramKey: "level", value: 0.15, id: "ad-d-pl-lo" });

  return p;
}

export function buildAirDaggerSuite() {
  return [
    { id: AIR_DAGGER_IDS.a, build: patternA },
    { id: AIR_DAGGER_IDS.b, build: patternB },
    { id: AIR_DAGGER_IDS.c, build: patternC },
    { id: AIR_DAGGER_IDS.d, build: patternD },
  ];
}

export const AIR_DAGGER_SKETCHES = buildAirDaggerSuite();

export function buildAirDaggerPattern(id) {
  const entry = AIR_DAGGER_SKETCHES.find((s) => s.id === id);
  return entry ? entry.build() : null;
}
