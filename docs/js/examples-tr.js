// TR factory sketches — one drum-machine object (pad kit) per groove,
// multiple lanes bound to the same instrumentId via pad MIDI notes.
// Melodic companions use separate instruments (dx7, grain, wave, organ, …).

import {
  Project,
  ChannelTile,
  NoteTile,
  CycleGateTile,
  ProbGateTile,
  ParamTile,
  ParamTargets,
  PatchBank,
  Pitch,
} from "./core.js";
import { patchFor } from "./instruments.js";
import {
  createInstrumentModule,
  ensureInstruments,
  setLaneInstrument,
  syncInstrumentPatch,
} from "./inst-model.js";

/** Pad centres from drums.js (engine 14). */
const PAD = {
  kick: 36,  // C2
  snare: 38, // D2
  rim: 41,
  clap: 44,
  tomL: 48,  // C3 centre
  tomM: 58,
  tomH: 68,
  hatC: 74,
  hatO: 80,
  perc: 86,
};

function N(name) {
  return Pitch.tryParse(name) ?? 60;
}

function ch(num, div, label) {
  return new ChannelTile(num, div, label);
}

function fill(lane, step, ...tiles) {
  if (!lane?.steps?.[step]) return;
  for (const t of tiles) {
    if (t) lane.steps[step].tiles.push(t);
  }
}

function lock(abs, target, amount) {
  const t = new ParamTile(abs);
  t.engage(target, amount);
  return t;
}

function base({ title, haiku, tempo = 120, fx = {} }) {
  const p = new Project();
  p.title = title;
  p.haiku = haiku;
  p.tempo = tempo;
  p.gridW = 40;
  p.gridH = 28;
  p.syncGrid();
  p.master = { userGain: 0.78, autoAtten: true, limiter: true };
  Object.assign(p.fx, {
    reverbSize: 0.4,
    reverbDamp: 0.4,
    reverbWidth: 0.9,
    delayBeats: 0.5,
    delayFeedback: 0.22,
    delayTone: 0.35,
    delaySpread: 0.12,
    ...fx,
  });
  ensureInstruments(p.score);
  // Neutral default patches (kit/melodic will overwrite used channels)
  for (let c = 1; c <= 8; c++) {
    Object.assign(PatchBank.get(p.patches, c), patchFor("fm-lead", { level: 0.25 }));
  }
  return p;
}

/**
 * Place a catalog instrument on the grid and seed its PatchBank channel.
 * @returns the instrument module
 */
function placeInst(p, type, x, y, channel, id, overrides = {}) {
  ensureInstruments(p.score);
  const m = createInstrumentModule(type, x, y, { id, channel });
  p.score.instruments.push(m);
  syncInstrumentPatch(p, m);
  if (overrides && Object.keys(overrides).length) {
    Object.assign(PatchBank.get(p.patches, channel), patchFor(type, overrides));
  }
  return m;
}

function note(midi, len = 0.4) {
  return new NoteTile(midi | 0, len);
}

// ---------------------------------------------------------------------------
// 1. Acid alley — 808 kick/clap + acid bass, dark, 128
// ---------------------------------------------------------------------------
function acidAlley() {
  const p = base({
    title: "Acid alley",
    haiku: "Wet brick, neon drip / 808 kicks the gutter line / filter eats the night",
    tempo: 128,
    fx: {
      reverbSize: 0.32,
      reverbDamp: 0.55,
      delayBeats: 0.375,
      delayFeedback: 0.28,
      delayTone: 0.45,
    },
  });

  // One TR-808 machine — kick + clap + hat lanes share instrumentId
  const kit = placeInst(p, "tr-808", 20, 1, 1, "tr-acid-kit", {
    level: 0.72,
    reverbSend: 0.06,
    delaySend: 0.02,
  });
  const bass = placeInst(p, "bass-acid", 20, 10, 2, "tr-acid-bass", {
    level: 0.58,
    modulationIndex: 2.4,
    modulatorRatio: 1,
    carrierRelease: 0.35,
    reverbSend: 0.08,
    delaySend: 0.12,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  for (const i of [0, 4, 8, 12]) fill(kick, i, note(PAD.kick, 0.55));
  fill(kick, 6, new ProbGateTile(40), note(PAD.kick, 0.25));
  fill(kick, 14, new CycleGateTile(2, 1), note(PAD.kick, 0.3));

  const clap = p.score.addLane(1, 3, ch(1, 16, "Clap"), 16);
  setLaneInstrument(p.score, clap, kit);
  fill(clap, 4, note(PAD.clap, 0.45));
  fill(clap, 12, note(PAD.clap, 0.45));
  fill(clap, 15, new ProbGateTile(35), note(PAD.clap, 0.2));

  const hats = p.score.addLane(1, 5, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(hats, i, note(PAD.hatC, 0.18));
    else if (i % 4 === 3) fill(hats, i, new ProbGateTile(50), note(PAD.hatO, 0.35));
  }

  const bas = p.score.addLane(1, 8, ch(2, 16, "Acid"), 16);
  setLaneInstrument(p.score, bas, bass);
  const line = [
    ["E2", 1], ["E2", 0.5], ["G2", 0.5], ["A2", 1],
    ["E2", 0.5], ["D2", 0.5], ["E2", 1], ["G2", 0.5],
    ["A2", 0.5], ["B2", 1], ["A2", 0.5], ["G2", 0.5],
    ["E2", 1], ["D2", 0.5], ["E2", 0.5], ["G1", 1],
  ];
  line.forEach(([n, len], i) => {
    fill(
      bas,
      i,
      i % 4 === 0 ? lock(true, ParamTargets.ModIndex, 1.2 + (i % 8) * 0.15) : null,
      new NoteTile(N(n), len),
    );
  });

  return p;
}

// ---------------------------------------------------------------------------
// 2. House anthem — 909 four-on-floor + open hat + clap, warm organ
// ---------------------------------------------------------------------------
function houseAnthem() {
  const p = base({
    title: "House anthem",
    haiku: "Four on the floor still / open hats bloom like streetlamps / organ holds the room",
    tempo: 124,
    fx: {
      reverbSize: 0.55,
      reverbDamp: 0.35,
      delayBeats: 0.5,
      delayFeedback: 0.2,
    },
  });

  const kit = placeInst(p, "tr-909", 20, 1, 1, "tr-house-kit", {
    level: 0.7,
    reverbSend: 0.12,
  });
  const organ = placeInst(p, "organ-church", 20, 11, 2, "tr-house-org", {
    level: 0.32,
    carrierAttack: 0.04,
    carrierRelease: 0.55,
    reverbSend: 0.4,
    delaySend: 0.08,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  for (const i of [0, 4, 8, 12]) fill(kick, i, note(PAD.kick, 0.6));

  const clap = p.score.addLane(1, 3, ch(1, 16, "Clap"), 16);
  setLaneInstrument(p.score, clap, kit);
  fill(clap, 4, note(PAD.clap, 0.5));
  fill(clap, 12, note(PAD.clap, 0.5));

  const hats = p.score.addLane(1, 5, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1) fill(hats, i, note(PAD.hatC, 0.15));
  }
  // Open hat on off-beat eights
  fill(hats, 2, note(PAD.hatO, 0.5));
  fill(hats, 6, note(PAD.hatO, 0.55));
  fill(hats, 10, note(PAD.hatO, 0.5));
  fill(hats, 14, note(PAD.hatO, 0.6));

  const org = p.score.addLane(1, 8, ch(2, 8, "Organ"), 8);
  setLaneInstrument(p.score, org, organ);
  fill(org, 0, new NoteTile(N("A2"), 4), new NoteTile(N("E3"), 4), new NoteTile(N("A3"), 4));
  fill(org, 4, new NoteTile(N("G2"), 4), new NoteTile(N("D3"), 4), new NoteTile(N("G3"), 4));

  return p;
}

// ---------------------------------------------------------------------------
// 3. Electro pulse — tight 808 kit + wave-pulse lead
// ---------------------------------------------------------------------------
function electroPulse() {
  const p = base({
    title: "Electro pulse",
    haiku: "Chrome grid underfoot / tight snare on the half-bar / pulse wave cuts the fog",
    tempo: 116,
    fx: {
      reverbSize: 0.28,
      delayBeats: 0.25,
      delayFeedback: 0.18,
      delayTone: 0.5,
    },
  });

  const kit = placeInst(p, "tr-808", 20, 1, 1, "tr-electro-kit", {
    level: 0.68,
    reverbSend: 0.05,
  });
  const lead = placeInst(p, "wave-pulse", 20, 11, 2, "tr-electro-lead", {
    level: 0.4,
    modulationIndex: 0.8,
    carrierRelease: 0.12,
    delaySend: 0.15,
    reverbSend: 0.1,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  fill(kick, 0, note(PAD.kick, 0.5));
  fill(kick, 7, note(PAD.kick, 0.35));
  fill(kick, 8, note(PAD.kick, 0.5));
  fill(kick, 10, note(PAD.kick, 0.3));
  fill(kick, 14, new ProbGateTile(55), note(PAD.kick, 0.25));

  const snare = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  setLaneInstrument(p.score, snare, kit);
  fill(snare, 4, note(PAD.snare, 0.4));
  fill(snare, 12, note(PAD.snare, 0.4));
  fill(snare, 6, new ProbGateTile(30), note(PAD.rim, 0.2));
  fill(snare, 15, new CycleGateTile(2, 1), note(PAD.snare, 0.25));

  const hats = p.score.addLane(1, 5, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    fill(hats, i, note(i % 4 === 2 ? PAD.hatO : PAD.hatC, i % 2 === 0 ? 0.16 : 0.1));
  }

  const pulse = p.score.addLane(1, 8, ch(2, 16, "Pulse"), 16);
  setLaneInstrument(p.score, pulse, lead);
  const riff = ["C4", "C4", "Eb4", "C4", "G4", "Eb4", "F4", "G4",
    "C4", "Bb3", "C4", "Eb4", "G4", "F4", "Eb4", "C4"];
  riff.forEach((n, i) => {
    fill(pulse, i, new NoteTile(N(n), i % 4 === 0 ? 0.7 : 0.35));
  });

  return p;
}

// ---------------------------------------------------------------------------
// 4. Lo-fi rain — thin 606 + soft pad + sparse nylon pluck
// ---------------------------------------------------------------------------
function lofiRain() {
  const p = base({
    title: "Lo-fi rain",
    haiku: "Thin tin hats outside / pad fog on the window glass / one nylon note falls",
    tempo: 88,
    fx: {
      reverbSize: 0.7,
      reverbDamp: 0.28,
      delayBeats: 0.75,
      delayFeedback: 0.35,
      delaySpread: 0.45,
      delayTone: 0.55,
    },
  });

  const kit = placeInst(p, "tr-606", 20, 1, 1, "tr-lofi-kit", {
    level: 0.42,
    reverbSend: 0.28,
    delaySend: 0.08,
  });
  const pad = placeInst(p, "pad-warm", 20, 9, 2, "tr-lofi-pad", {
    level: 0.28,
    carrierAttack: 0.12,
    carrierRelease: 0.9,
    reverbSend: 0.55,
    delaySend: 0.15,
  });
  const pluck = placeInst(p, "pluck-nylon", 20, 14, 3, "tr-lofi-plk", {
    level: 0.32,
    reverbSend: 0.35,
    delaySend: 0.2,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  fill(kick, 0, note(PAD.kick, 0.6));
  fill(kick, 8, note(PAD.kick, 0.5));
  fill(kick, 11, new ProbGateTile(40), note(PAD.kick, 0.25));

  const snare = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  setLaneInstrument(p.score, snare, kit);
  fill(snare, 4, note(PAD.snare, 0.3));
  fill(snare, 12, note(PAD.snare, 0.28));
  fill(snare, 14, new ProbGateTile(30), note(PAD.rim, 0.15));

  const hats = p.score.addLane(1, 5, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(hats, i, note(PAD.hatC, 0.12));
    else fill(hats, i, new ProbGateTile(45), note(PAD.hatC, 0.08));
  }

  const soft = p.score.addLane(1, 8, ch(2, 4, "Pad"), 4);
  setLaneInstrument(p.score, soft, pad);
  fill(soft, 0, new NoteTile(N("D3"), 4), new NoteTile(N("A3"), 4));
  fill(soft, 2, new NoteTile(N("C3"), 4), new NoteTile(N("G3"), 4));

  const pk = p.score.addLane(1, 11, ch(3, 8, "Pluck"), 8);
  setLaneInstrument(p.score, pk, pluck);
  fill(pk, 1, new NoteTile(N("A4"), 0.6));
  fill(pk, 3, new ProbGateTile(55), new NoteTile(N("E4"), 0.5));
  fill(pk, 5, new NoteTile(N("G4"), 1));
  fill(pk, 7, new ProbGateTile(40), new NoteTile(N("D4"), 0.8));

  return p;
}

// ---------------------------------------------------------------------------
// 5. Warehouse tom — 707 toms at different pad midis + snare, industrial
// ---------------------------------------------------------------------------
function warehouseTom() {
  const p = base({
    title: "Warehouse tom",
    haiku: "Empty loading bay / three toms argue in the dark / snare answers once, hard",
    tempo: 108,
    fx: {
      reverbSize: 0.62,
      reverbDamp: 0.5,
      delayBeats: 0.5,
      delayFeedback: 0.25,
    },
  });

  const kit = placeInst(p, "tr-707", 20, 1, 1, "tr-wh-kit", {
    level: 0.65,
    reverbSend: 0.22,
    delaySend: 0.06,
  });
  const bass = placeInst(p, "bass-sub", 20, 12, 2, "tr-wh-bass", {
    level: 0.48,
    carrierRelease: 0.45,
    reverbSend: 0.1,
  });

  // Tune offsets stay on the same pad (± a few st)
  const tomL = PAD.tomL;
  const tomM = PAD.tomM + 2;
  const tomH = PAD.tomH - 1;

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  fill(kick, 0, note(PAD.kick, 0.55));
  fill(kick, 8, note(PAD.kick, 0.5));
  fill(kick, 3, new ProbGateTile(35), note(PAD.kick, 0.25));

  const snare = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  setLaneInstrument(p.score, snare, kit);
  fill(snare, 4, note(PAD.snare, 0.45));
  fill(snare, 12, note(PAD.snare, 0.45));
  fill(snare, 7, new ProbGateTile(40), note(PAD.rim, 0.2));
  fill(snare, 15, new CycleGateTile(2, 1), note(PAD.snare, 0.25));

  const toms = p.score.addLane(1, 5, ch(1, 16, "Toms"), 16);
  setLaneInstrument(p.score, toms, kit);
  // Industrial tom fill motif
  fill(toms, 2, note(tomH, 0.35));
  fill(toms, 3, note(tomM, 0.35));
  fill(toms, 6, note(tomL, 0.45));
  fill(toms, 10, note(tomM, 0.3));
  fill(toms, 11, note(tomH, 0.25));
  fill(toms, 13, note(tomL, 0.4));
  fill(toms, 14, note(tomM, 0.35));
  fill(toms, 15, note(tomH, 0.5));

  const hats = p.score.addLane(1, 7, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i += 2) fill(hats, i, note(PAD.hatC, 0.14));
  fill(hats, 9, new ProbGateTile(50), note(PAD.perc, 0.2));

  const bas = p.score.addLane(1, 10, ch(2, 8, "Sub"), 8);
  setLaneInstrument(p.score, bas, bass);
  fill(bas, 0, new NoteTile(N("E1"), 3));
  fill(bas, 4, new NoteTile(N("G1"), 2));
  fill(bas, 6, new NoteTile(N("A1"), 2));

  return p;
}

// ---------------------------------------------------------------------------
// 6. Neon DX — 808 drums + DX7 EP stabs (909 clap flavor via hat open)
// ---------------------------------------------------------------------------
function neonDx() {
  const p = base({
    title: "Neon DX",
    haiku: "Pink sign buzzes rain / electric piano stabs once / 808 keeps walking",
    tempo: 112,
    fx: {
      reverbSize: 0.48,
      reverbDamp: 0.38,
      delayBeats: 0.375,
      delayFeedback: 0.3,
      delaySpread: 0.25,
    },
  });

  const kit = placeInst(p, "tr-808", 20, 1, 1, "tr-neon-kit", {
    level: 0.66,
    reverbSend: 0.1,
  });
  // Optional second kit colour: 909 for open hat spice — still one object for main drums
  const ep = placeInst(p, "dx7-ep", 20, 11, 2, "tr-neon-ep", {
    level: 0.42,
    reverbSend: 0.35,
    delaySend: 0.18,
    carrierRelease: 0.4,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kit);
  for (const i of [0, 4, 8, 12]) fill(kick, i, note(PAD.kick, 0.55));
  fill(kick, 10, new ProbGateTile(45), note(PAD.kick, 0.25));

  const snare = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  setLaneInstrument(p.score, snare, kit);
  fill(snare, 4, note(PAD.snare, 0.4));
  fill(snare, 12, note(PAD.clap, 0.45)); // clap on back half for neon colour
  fill(snare, 14, new ProbGateTile(35), note(PAD.rim, 0.2));

  const hats = p.score.addLane(1, 5, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(hats, i, note(PAD.hatC, 0.15));
  }
  fill(hats, 6, note(PAD.hatO, 0.4));
  fill(hats, 14, note(PAD.hatO, 0.45));

  const stab = p.score.addLane(1, 8, ch(2, 8, "DX EP"), 8);
  setLaneInstrument(p.score, stab, ep);
  fill(stab, 0, new NoteTile(N("E3"), 1.2), new NoteTile(N("G#3"), 1.2), new NoteTile(N("B3"), 1.2));
  fill(stab, 2, new CycleGateTile(2, 1), new NoteTile(N("F#3"), 0.8), new NoteTile(N("A3"), 0.8));
  fill(stab, 4, new NoteTile(N("A3"), 1.5), new NoteTile(N("C#4"), 1.5), new NoteTile(N("E4"), 1.5));
  fill(stab, 6, new ProbGateTile(70), new NoteTile(N("G#3"), 1), new NoteTile(N("B3"), 1));

  return p;
}

// ---------------------------------------------------------------------------
// 7. Grain fog — soft 606 hats + grain-pad clouds
// ---------------------------------------------------------------------------
function grainFog() {
  const p = base({
    title: "Grain fog",
    haiku: "Hats like soft insects / grain clouds drift through cold air / kick is almost gone",
    tempo: 76,
    fx: {
      reverbSize: 0.82,
      reverbDamp: 0.22,
      delayBeats: 1,
      delayFeedback: 0.4,
      delaySpread: 0.55,
      delayTone: 0.4,
    },
  });

  const kit = placeInst(p, "tr-606", 20, 1, 1, "tr-grain-kit", {
    level: 0.35,
    reverbSend: 0.4,
    delaySend: 0.1,
  });
  const grain = placeInst(p, "grain-pad", 20, 9, 2, "tr-grain-pad", {
    level: 0.34,
    carrierAttack: 0.2,
    carrierRelease: 1.2,
    reverbSend: 0.65,
    delaySend: 0.22,
  });

  const kick = p.score.addLane(1, 1, ch(1, 8, "Kick"), 8);
  setLaneInstrument(p.score, kick, kit);
  fill(kick, 0, note(PAD.kick, 0.8));
  fill(kick, 4, new ProbGateTile(50), note(PAD.kick, 0.5));

  const hats = p.score.addLane(1, 3, ch(1, 16, "Hats"), 16);
  setLaneInstrument(p.score, hats, kit);
  for (let i = 0; i < 16; i++) {
    fill(hats, i, new ProbGateTile(40 + (i % 5) * 5), note(PAD.hatC, 0.1));
  }
  fill(hats, 8, note(PAD.hatO, 0.5));

  const perc = p.score.addLane(1, 5, ch(1, 8, "Perc"), 8);
  setLaneInstrument(p.score, perc, kit);
  fill(perc, 3, new ProbGateTile(45), note(PAD.perc, 0.25));
  fill(perc, 6, new ProbGateTile(35), note(PAD.rim, 0.2));

  const cloud = p.score.addLane(1, 8, ch(2, 4, "Grain"), 4);
  setLaneInstrument(p.score, cloud, grain);
  fill(cloud, 0, new NoteTile(N("G3"), 4), new NoteTile(N("D4"), 4));
  fill(cloud, 2, new NoteTile(N("Bb3"), 4), new NoteTile(N("F4"), 4));

  return p;
}

// ---------------------------------------------------------------------------
// 8. Switchbox — single solid groove; cycle gates flip A/B kit colour
// ---------------------------------------------------------------------------
function switchbox() {
  const p = base({
    title: "Switchbox",
    haiku: "Two rooms, one breaker / cycle flips the drum machine / bass keeps the lights on",
    tempo: 120,
    fx: {
      reverbSize: 0.4,
      delayBeats: 0.5,
      delayFeedback: 0.24,
    },
  });

  // Primary kit (808) + secondary colour kit (909) for open hats / claps
  const kitA = placeInst(p, "tr-808", 20, 1, 1, "tr-sw-a", {
    level: 0.68,
    reverbSend: 0.08,
  });
  const kitB = placeInst(p, "tr-909", 26, 1, 2, "tr-sw-b", {
    level: 0.62,
    reverbSend: 0.14,
  });
  const bass = placeInst(p, "bass-growl", 20, 12, 3, "tr-sw-bass", {
    level: 0.52,
    modulationIndex: 1.6,
    reverbSend: 0.08,
  });
  const lead = placeInst(p, "fm-lead", 26, 12, 4, "tr-sw-lead", {
    level: 0.32,
    modulationIndex: 2.0,
    delaySend: 0.14,
    reverbSend: 0.15,
  });

  // Kit A — body
  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  setLaneInstrument(p.score, kick, kitA);
  for (const i of [0, 4, 8, 12]) fill(kick, i, note(PAD.kick, 0.55));
  fill(kick, 6, new CycleGateTile(2, 0), note(PAD.kick, 0.3)); // A feel
  fill(kick, 14, new CycleGateTile(2, 1), note(PAD.kick, 0.3)); // B feel

  const snareA = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  setLaneInstrument(p.score, snareA, kitA);
  fill(snareA, 4, note(PAD.snare, 0.4));
  fill(snareA, 12, note(PAD.snare, 0.4));
  fill(snareA, 10, new CycleGateTile(2, 1), note(PAD.rim, 0.25));

  const hatsA = p.score.addLane(1, 5, ch(1, 16, "Hats A"), 16);
  setLaneInstrument(p.score, hatsA, kitA);
  for (let i = 0; i < 16; i += 2) {
    fill(hatsA, i, new CycleGateTile(2, 0), note(PAD.hatC, 0.14));
  }

  // Kit B — alternate bars (cycle period 2, phase 1)
  const clapB = p.score.addLane(1, 7, ch(2, 16, "Clap B"), 16);
  setLaneInstrument(p.score, clapB, kitB);
  fill(clapB, 4, new CycleGateTile(2, 1), note(PAD.clap, 0.45));
  fill(clapB, 12, new CycleGateTile(2, 1), note(PAD.clap, 0.45));
  fill(clapB, 15, new CycleGateTile(2, 1), new ProbGateTile(50), note(PAD.clap, 0.2));

  const hatsB = p.score.addLane(1, 9, ch(2, 16, "Hats B"), 16);
  setLaneInstrument(p.score, hatsB, kitB);
  for (let i = 1; i < 16; i += 2) {
    fill(hatsB, i, new CycleGateTile(2, 1), note(PAD.hatO, 0.35));
  }

  const bas = p.score.addLane(1, 12, ch(3, 16, "Bass"), 16);
  setLaneInstrument(p.score, bas, bass);
  const basNotes = ["A1", "A1", "C2", "A1", "E2", "C2", "D2", "E2",
    "A1", "G1", "A1", "C2", "E2", "D2", "C2", "A1"];
  basNotes.forEach((n, i) => fill(bas, i, new NoteTile(N(n), 0.85)));

  const ld = p.score.addLane(1, 15, ch(4, 8, "Lead"), 8);
  setLaneInstrument(p.score, ld, lead);
  fill(ld, 1, new CycleGateTile(2, 0), new NoteTile(N("E4"), 0.6));
  fill(ld, 3, new CycleGateTile(2, 0), new NoteTile(N("G4"), 0.5));
  fill(ld, 5, new CycleGateTile(2, 1), new NoteTile(N("A4"), 0.7));
  fill(ld, 7, new CycleGateTile(2, 1), new NoteTile(N("C5"), 0.8));

  return p;
}

// ---------------------------------------------------------------------------

export const TR_FACTORY_SKETCHES = [
  { id: "acid-alley", build: acidAlley },
  { id: "house-anthem", build: houseAnthem },
  { id: "electro-pulse", build: electroPulse },
  { id: "lofi-rain", build: lofiRain },
  { id: "warehouse-tom", build: warehouseTom },
  { id: "neon-dx", build: neonDx },
  { id: "grain-fog", build: grainFog },
  { id: "switchbox", build: switchbox },
];

export function buildTrSketch(id) {
  const entry = TR_FACTORY_SKETCHES.find((s) => s.id === id);
  return entry ? entry.build() : null;
}
