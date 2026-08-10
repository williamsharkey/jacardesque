// Ten factory sketches that live in the FX dimension:
// pedals on the grid, path-windowed sends, chains, automation diamonds.

import {
  Project,
  ChannelTile,
  NoteTile,
  CycleGateTile,
  ProbGateTile,
  PatchBank,
  Pitch,
} from "./core.js";
import { patchFor } from "./instruments.js";
import {
  createFxModule,
  createPathRoute,
  createFxRoute,
  createAutoNode,
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

function setPatch(project, ch, instrument, overrides) {
  Object.assign(PatchBank.get(project.patches, ch), patchFor(instrument, overrides));
}

function base({ title, haiku, tempo = 110 }) {
  const p = new Project();
  p.title = title;
  p.haiku = haiku;
  p.tempo = tempo;
  ensureFxLists(p.score);
  for (let c = 1; c <= 8; c++) setPatch(p, c, "fm", { level: 0.4, reverbSend: 0, delaySend: 0 });
  return p;
}

function addPedal(p, type, x, y, params = {}) {
  const m = createFxModule(type, x, y);
  Object.assign(m.params, params);
  p.score.fxModules.push(m);
  return m;
}

// 1. Echo hallway — delay only while walking steps 0–7
function echoHallway() {
  const p = base({
    title: "Echo hallway",
    haiku: "Footsteps in a hall / only the middle four rooms / throw the sound back twice",
    tempo: 100,
  });
  setPatch(p, 1, "pluck", { level: 0.45 });
  const lane = p.score.addLane(1, 2, ch(1, 16, "Pluck"), 16);
  const melody = ["C4", "E4", "G4", "A4", "G4", "E4", "D4", "C4", "E4", "G4", "C5", "B4", "A4", "G4", "E4", "C4"];
  melody.forEach((n, i) => fill(lane, i, new NoteTile(N(n), 0.8)));
  const dly = addPedal(p, "delay", 10, 5, { mix: 0.45, time: 0.38, feedback: 0.4, tone: 0.35 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 4, toStep: 11, targetFxId: dly.id, amount: 0.7,
  }));
  p.score.autoNodes.push(createAutoNode({
    x: 1 + 8, y: 1, targetFxId: dly.id, paramKey: "time", value: 0.18,
  }));
  p.score.autoNodes.push(createAutoNode({
    x: 1 + 12, y: 1, targetFxId: dly.id, paramKey: "time", value: 0.55,
  }));
  return p;
}

// 2. Tape bloom — delay → reverb chain, windowed from kick lane
function tapeBloom() {
  const p = base({
    title: "Tape bloom",
    haiku: "Kick opens a gate / tape spins a second room / bloom then folds away",
    tempo: 96,
  });
  setPatch(p, 1, "kick");
  setPatch(p, 2, "bass", { level: 0.5 });
  const kick = p.score.addLane(1, 1, ch(1, 8, "Kick"), 8);
  fill(kick, 0, new NoteTile(N("C2")));
  fill(kick, 4, new NoteTile(N("C2")));
  const bass = p.score.addLane(1, 3, ch(2, 8, "Bass"), 8);
  fill(bass, 0, new NoteTile(N("C2"), 3));
  fill(bass, 4, new NoteTile(N("G1"), 3));
  const dly = addPedal(p, "delay", 12, 1, { mix: 0.4, time: 0.5, feedback: 0.45 });
  const rvb = addPedal(p, "reverb", 16, 1, { mix: 0.5, size: 0.7, damp: 0.3 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 2, targetFxId: dly.id, amount: 0.8,
  }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: dly.id, toFxId: rvb.id, amount: 0.85 }));
  return p;
}

// 3. Distorted dusk — filter + distort automation
function distortedDusk() {
  const p = base({
    title: "Distorted dusk",
    haiku: "Sun rasps on metal / filter opens like a wound / night irons it shut",
    tempo: 88,
  });
  setPatch(p, 1, "pad", { level: 0.35 });
  const pad = p.score.addLane(1, 2, ch(1, 4, "Pad"), 8);
  fill(pad, 0, new NoteTile(N("D3"), 4), new NoteTile(N("A3"), 4));
  fill(pad, 4, new NoteTile(N("F3"), 4), new NoteTile(N("C4"), 4));
  const flt = addPedal(p, "filter", 12, 2, { mix: 1, cutoff: 0.25, reso: 0.35 });
  const dst = addPedal(p, "distort", 16, 2, { mix: 0.35, drive: 0.3 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 7, targetFxId: flt.id, amount: 1,
  }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: flt.id, toFxId: dst.id, amount: 1 }));
  p.score.autoNodes.push(createAutoNode({
    x: 3, y: 1, targetFxId: flt.id, paramKey: "cutoff", value: 0.8,
  }));
  p.score.autoNodes.push(createAutoNode({
    x: 7, y: 1, targetFxId: flt.id, paramKey: "cutoff", value: 0.15,
  }));
  p.score.autoNodes.push(createAutoNode({
    x: 5, y: 5, targetFxId: dst.id, paramKey: "drive", value: 0.75,
  }));
  return p;
}

// 4. Sidewalk radio — pan sweeps via automation diamonds
function sidewalkRadio() {
  const p = base({
    title: "Sidewalk radio",
    haiku: "Cars pass left then right / a song walks between the lanes / stereo is a street",
    tempo: 120,
  });
  setPatch(p, 1, "fm", { level: 0.4, modulationIndex: 1.6 });
  const lead = p.score.addLane(1, 2, ch(1, 16, "Lead"), 16);
  ["A4", "C5", "E5", "A4", "G4", "E4", "C5", "B4"].forEach((n, i) => {
    fill(lead, i * 2, new NoteTile(N(n), 0.7));
  });
  const pan = addPedal(p, "pan", 12, 5, { pan: 0, width: 0.7 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 15, targetFxId: pan.id, amount: 1,
  }));
  for (let i = 0; i < 8; i++) {
    p.score.autoNodes.push(createAutoNode({
      x: 1 + i * 2,
      y: 1,
      targetFxId: pan.id,
      paramKey: "pan",
      value: (i % 2 === 0) ? -0.85 : 0.85,
    }));
  }
  return p;
}

// 5. Glass delay — short window slapbacks
function glassDelay() {
  const p = base({
    title: "Glass delay",
    haiku: "One bright struck note / three reflections in the glass / then only the room",
    tempo: 92,
  });
  setPatch(p, 1, "bell", { level: 0.4 });
  const bells = p.score.addLane(1, 2, ch(1, 8, "Bells"), 8);
  fill(bells, 0, new NoteTile(N("E5"), 2));
  fill(bells, 3, new NoteTile(N("B4"), 1));
  fill(bells, 5, new NoteTile(N("G#5"), 2));
  const dly = addPedal(p, "delay", 12, 2, { mix: 0.5, time: 0.22, feedback: 0.25, tone: 0.2 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 1, targetFxId: dly.id, amount: 0.9,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 5, toStep: 6, targetFxId: dly.id, amount: 0.7,
  }));
  return p;
}

// 6. Pedalboard hymn — three pedals chained
function pedalboardHymn() {
  const p = base({
    title: "Pedalboard hymn",
    haiku: "Board of three boxes / each box a room inside rooms / signal finds a pew",
    tempo: 76,
  });
  setPatch(p, 1, "pad", { level: 0.32 });
  setPatch(p, 2, "pluck", { level: 0.35 });
  const pad = p.score.addLane(1, 1, ch(1, 4, "Pad"), 4);
  fill(pad, 0, new NoteTile(N("G3"), 4), new NoteTile(N("D4"), 4));
  const pluck = p.score.addLane(1, 4, ch(2, 8, "Pluck"), 8);
  fill(pluck, 2, new NoteTile(N("B4"), 1));
  fill(pluck, 6, new NoteTile(N("D5"), 1));
  const dst = addPedal(p, "distort", 12, 1, { mix: 0.2, drive: 0.25 });
  const dly = addPedal(p, "delay", 16, 1, { mix: 0.35, time: 0.6, feedback: 0.4 });
  const rvb = addPedal(p, "reverb", 20, 1, { mix: 0.45, size: 0.75, damp: 0.25 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 3, targetFxId: dst.id, amount: 0.8,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 1, fromStep: 0, toStep: 7, targetFxId: dly.id, amount: 0.5,
  }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: dst.id, toFxId: dly.id, amount: 0.7 }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: dly.id, toFxId: rvb.id, amount: 0.9 }));
  return p;
}

// 7. Metric mirror — delay time locked by autos on the beat
function metricMirror() {
  const p = base({
    title: "Metric mirror",
    haiku: "Each bar a new tape / speed written on the diamond / echo keeps the score",
    tempo: 128,
  });
  setPatch(p, 1, "kick");
  setPatch(p, 2, "hat");
  setPatch(p, 3, "pluck", { level: 0.4 });
  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  for (let i = 0; i < 16; i += 4) fill(kick, i, new NoteTile(N("C2")));
  const hat = p.score.addLane(1, 3, ch(2, 16, "Hats"), 16);
  for (let i = 0; i < 16; i += 2) fill(hat, i, new NoteTile(N("F#5"), 0.2));
  const pl = p.score.addLane(1, 5, ch(3, 16, "Pluck"), 16);
  fill(pl, 0, new NoteTile(N("E4"), 1));
  fill(pl, 4, new NoteTile(N("G4"), 1));
  fill(pl, 8, new NoteTile(N("A4"), 1));
  fill(pl, 12, new NoteTile(N("B4"), 1));
  const dly = addPedal(p, "delay", 12, 7, { mix: 0.4, time: 0.25, feedback: 0.3 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 2, fromStep: 0, toStep: 15, targetFxId: dly.id, amount: 0.65,
  }));
  const times = [0.2, 0.35, 0.15, 0.5];
  times.forEach((t, i) => {
    p.score.autoNodes.push(createAutoNode({
      x: 1 + i * 4, y: 7, targetFxId: dly.id, paramKey: "time", value: t,
    }));
  });
  return p;
}

// 8. Whisper gate — path only on gated hits
function whisperGate() {
  const p = base({
    title: "Whisper gate",
    haiku: "Most notes stay dry / when the gate opens, the room / borrows your voice",
    tempo: 104,
  });
  setPatch(p, 1, "fm", { level: 0.42 });
  const lane = p.score.addLane(1, 2, ch(1, 16, "Voice"), 16);
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) fill(lane, i, new NoteTile(N("C4"), 1));
    else if (i % 4 === 2) {
      fill(lane, i, new CycleGateTile(2, 1), new NoteTile(N("G4"), 0.5));
    }
  }
  const rvb = addPedal(p, "reverb", 12, 5, { mix: 0.55, size: 0.6, damp: 0.35 });
  // Only steps that often carry the gated notes
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 2, toStep: 2, targetFxId: rvb.id, amount: 0.9,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 6, toStep: 6, targetFxId: rvb.id, amount: 0.9,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 10, toStep: 10, targetFxId: rvb.id, amount: 0.9,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 14, toStep: 14, targetFxId: rvb.id, amount: 0.9,
  }));
  return p;
}

// 9. Broken speaker — distort amount automation + filter
function brokenSpeaker() {
  const p = base({
    title: "Broken speaker",
    haiku: "Cone rips mid-chorus / grit climbs the diamond ladder / then silence mends it",
    tempo: 112,
  });
  setPatch(p, 1, "bass", { level: 0.55 });
  setPatch(p, 2, "snare", { level: 0.4 });
  const bass = p.score.addLane(1, 2, ch(1, 8, "Bass"), 8);
  fill(bass, 0, new NoteTile(N("E2"), 2));
  fill(bass, 3, new NoteTile(N("G2"), 1));
  fill(bass, 5, new NoteTile(N("A2"), 2));
  const sn = p.score.addLane(1, 4, ch(2, 8, "Snare"), 8);
  fill(sn, 2, new NoteTile(N("D3")));
  fill(sn, 6, new NoteTile(N("D3")));
  const dst = addPedal(p, "distort", 12, 2, { mix: 0.25, drive: 0.2 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 7, targetFxId: dst.id, amount: 0.85,
  }));
  [0.2, 0.5, 0.85, 0.3].forEach((v, i) => {
    p.score.autoNodes.push(createAutoNode({
      x: 1 + i * 2, y: 1, targetFxId: dst.id, paramKey: "drive", value: v,
    }));
  });
  return p;
}

// 10. Echoplex garden — long window, dual delays
function echoplexGarden() {
  const p = base({
    title: "Echoplex garden",
    haiku: "Two tapes in the leaves / one slow, one almost in step / birds edit the mix",
    tempo: 84,
  });
  setPatch(p, 1, "pluck", { level: 0.4 });
  setPatch(p, 2, "bell", { level: 0.28 });
  const pl = p.score.addLane(1, 2, ch(1, 12, "Pluck"), 12);
  ["D4", "F4", "A4", "C5", "A4", "F4"].forEach((n, i) => fill(pl, i * 2, new NoteTile(N(n), 1.2)));
  const bl = p.score.addLane(1, 5, ch(2, 8, "Bells"), 8);
  fill(bl, 1, new ProbGateTile(60), new NoteTile(N("D5"), 0.5));
  fill(bl, 5, new NoteTile(N("A5"), 0.5));
  const d1 = addPedal(p, "delay", 10, 7, { mix: 0.35, time: 0.7, feedback: 0.45, tone: 0.5 });
  const d2 = addPedal(p, "delay", 14, 7, { mix: 0.3, time: 0.33, feedback: 0.3, tone: 0.25 });
  const rvb = addPedal(p, "reverb", 18, 7, { mix: 0.35, size: 0.65, damp: 0.3 });
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 0, fromStep: 0, toStep: 11, targetFxId: d1.id, amount: 0.55,
  }));
  p.score.pathRoutes.push(createPathRoute({
    laneIndex: 1, fromStep: 0, toStep: 7, targetFxId: d2.id, amount: 0.7,
  }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: d1.id, toFxId: rvb.id, amount: 0.6 }));
  p.score.fxRoutes.push(createFxRoute({ fromFxId: d2.id, toFxId: rvb.id, amount: 0.5 }));
  p.score.autoNodes.push(createAutoNode({
    x: 7, y: 1, targetFxId: d1.id, paramKey: "feedback", value: 0.7,
  }));
  p.score.autoNodes.push(createAutoNode({
    x: 11, y: 1, targetFxId: d1.id, paramKey: "feedback", value: 0.2,
  }));
  return p;
}

export const FX_FACTORY_SKETCHES = [
  { id: "echo-hallway", build: echoHallway },
  { id: "tape-bloom", build: tapeBloom },
  { id: "distorted-dusk", build: distortedDusk },
  { id: "sidewalk-radio", build: sidewalkRadio },
  { id: "glass-delay", build: glassDelay },
  { id: "pedalboard-hymn", build: pedalboardHymn },
  { id: "metric-mirror", build: metricMirror },
  { id: "whisper-gate", build: whisperGate },
  { id: "broken-speaker", build: brokenSpeaker },
  { id: "echoplex-garden", build: echoplexGarden },
];
