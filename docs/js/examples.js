// Ten factory sketches — each a haiku and a sequence that *sounds like* it.
// Seeded once into localStorage; users can edit and auto-save freely.

import {
  Project,
  Score,
  ChannelTile,
  JumpDestTile,
  JumpTile,
  NoteTile,
  ParamTile,
  CycleGateTile,
  ProbGateTile,
  ParamTargets,
  PatchBank,
  Pitch,
} from "./core.js";
import { patchFor, Instruments } from "./instruments.js";

function N(name) {
  return Pitch.tryParse(name) ?? 60;
}

/** Named channel head — shortName auto-abbreviates on the grid (Kick1 → K1). */
function ch(num, div, label) {
  return new ChannelTile(num, div, label);
}

function fill(lane, step, ...tiles) {
  lane.steps[step].tiles.push(...tiles);
}

function lock(abs, target, amount) {
  const t = new ParamTile(abs);
  t.engage(target, amount);
  return t;
}

function setPatch(project, ch, instrument, overrides) {
  const p = patchFor(instrument, overrides);
  Object.assign(PatchBank.get(project.patches, ch), p);
}

function baseProject({ title, haiku, tempo = 120, fx = {} }) {
  const project = new Project();
  project.title = title;
  project.haiku = haiku;
  project.tempo = tempo;
  Object.assign(project.fx, {
    reverbSize: 0.45,
    reverbDamp: 0.4,
    reverbWidth: 0.9,
    delayBeats: 0.5,
    delayFeedback: 0.28,
    delayTone: 0.35,
    delaySpread: 0.15,
    ...fx,
  });
  // clear default empty-ish bank by applying neutral fm everywhere
  for (let c = 1; c <= 8; c++) setPatch(project, c, "fm", { level: 0.4 });
  return project;
}

// ---------------------------------------------------------------------------
// 1. Rain on tin — soft hats + bell droplets
// ---------------------------------------------------------------------------
function rainOnTin() {
  const p = baseProject({
    title: "Rain on tin",
    haiku: "Soft rain on tin roof / each drop a tiny bell note / cat blinks twice, waits",
    tempo: 96,
    fx: { reverbSize: 0.55, reverbDamp: 0.35, delayBeats: 0.375, delayFeedback: 0.25 },
  });
  setPatch(p, 1, "hat", { level: 0.22, reverbSend: 0.2 });
  setPatch(p, 2, "bell", { level: 0.32, reverbSend: 0.5, delaySend: 0.15 });

  const hats = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(hats, i, new NoteTile(N("F#5"), 0.25));
    else if (i % 4 === 3) fill(hats, i, new ProbGateTile(40), new NoteTile(N("G#5"), 0.2));
  }

  const bells = p.score.addLane(1, 4, ch(2, 8, "Bells"), 8);
  fill(bells, 0, new NoteTile(N("E5"), 2));
  fill(bells, 2, new NoteTile(N("B4"), 1.5));
  fill(bells, 4, new NoteTile(N("G#4"), 2));
  fill(bells, 6, new ProbGateTile(60), new NoteTile(N("C#5"), 1));
  return p;
}

// ---------------------------------------------------------------------------
// 2. Night market — kick + bass groove, neon lead
// ---------------------------------------------------------------------------
function nightMarket() {
  const p = baseProject({
    title: "Night market",
    haiku: "Lantern steam rises / oil and sugar in the air / bass walks home alone",
    tempo: 108,
    fx: { delayBeats: 0.5, delayFeedback: 0.32, reverbSize: 0.35 },
  });
  setPatch(p, 1, "kick");
  setPatch(p, 2, "bass", { level: 0.55 });
  setPatch(p, 3, "fm", { level: 0.38, modulationIndex: 1.8, reverbSend: 0.2, delaySend: 0.18 });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  fill(kick, 0, new NoteTile(N("C2"), 0.5));
  fill(kick, 4, new NoteTile(N("C2"), 0.5));
  fill(kick, 8, new NoteTile(N("C2"), 0.5));
  fill(kick, 10, new NoteTile(N("G1"), 0.4));
  fill(kick, 12, new NoteTile(N("C2"), 0.5));
  fill(kick, 14, new ProbGateTile(50), new NoteTile(N("C2"), 0.3));

  const bass = p.score.addLane(1, 3, ch(2, 16, "Bass"), 16);
  fill(bass, 0, new NoteTile(N("C2"), 2));
  fill(bass, 4, new NoteTile(N("Eb2"), 1));
  fill(bass, 6, new NoteTile(N("F2"), 1));
  fill(bass, 8, new NoteTile(N("G2"), 2));
  fill(bass, 12, new NoteTile(N("Bb1"), 2));

  const lead = p.score.addLane(1, 6, ch(3, 16, "Lead"), 16);
  fill(lead, 2, new NoteTile(N("G4"), 1));
  fill(lead, 4, new NoteTile(N("Bb4"), 0.5));
  fill(lead, 5, new NoteTile(N("C5"), 1.5));
  fill(lead, 9, new NoteTile(N("Eb5"), 1));
  fill(lead, 12, new NoteTile(N("D5"), 2));
  return p;
}

// ---------------------------------------------------------------------------
// 3. Empty station — sparse pad + distant pluck
// ---------------------------------------------------------------------------
function emptyStation() {
  const p = baseProject({
    title: "Empty station",
    haiku: "Midnight platform hum / one suitcase on cold concrete / train that never comes",
    tempo: 72,
    fx: { reverbSize: 0.75, reverbDamp: 0.25, delayBeats: 0.75, delayFeedback: 0.4, delaySpread: 0.5 },
  });
  setPatch(p, 1, "pad", { level: 0.3, reverbSend: 0.6 });
  setPatch(p, 2, "pluck", { level: 0.35, delaySend: 0.25, reverbSend: 0.3 });

  const pad = p.score.addLane(1, 2, ch(1, 4, "Pad"), 8);
  fill(pad, 0, new NoteTile(N("A3"), 4), new NoteTile(N("E4"), 4));
  fill(pad, 4, new NoteTile(N("F3"), 4), new NoteTile(N("C4"), 4));

  const pluck = p.score.addLane(1, 5, ch(2, 8, "Pluck"), 16);
  fill(pluck, 3, new NoteTile(N("E5"), 0.5));
  fill(pluck, 7, new NoteTile(N("A4"), 1));
  fill(pluck, 11, new ProbGateTile(45), new NoteTile(N("C5"), 0.5));
  fill(pluck, 15, new NoteTile(N("B4"), 2));
  return p;
}

// ---------------------------------------------------------------------------
// 4. Crow at dawn — snare ticks + bright bell call
// ---------------------------------------------------------------------------
function crowAtDawn() {
  const p = baseProject({
    title: "Crow at dawn",
    haiku: "Wire against peach sky / one crow argues with the sun / wires answer back",
    tempo: 118,
    fx: { reverbSize: 0.4, delayBeats: 0.25, delayFeedback: 0.2 },
  });
  setPatch(p, 1, "snare", { level: 0.35 });
  setPatch(p, 2, "hat", { level: 0.2 });
  setPatch(p, 3, "bell", { level: 0.4, modulatorRatio: 4.2 });

  const snare = p.score.addLane(1, 1, ch(1, 16, "Snare"), 16);
  fill(snare, 4, new NoteTile(N("D3"), 0.3));
  fill(snare, 12, new NoteTile(N("D3"), 0.3));
  fill(snare, 14, new ProbGateTile(35), new NoteTile(N("D3"), 0.2));

  const hat = p.score.addLane(1, 3, ch(2, 16, "Hats"), 16);
  for (let i = 0; i < 16; i += 2) fill(hat, i, new NoteTile(N("F#5"), 0.2));

  const crow = p.score.addLane(1, 5, ch(3, 8, "Crow"), 8);
  fill(crow, 0, new NoteTile(N("G5"), 0.5));
  fill(crow, 1, new NoteTile(N("Eb5"), 0.5));
  fill(crow, 2, new NoteTile(N("G5"), 1));
  fill(crow, 5, new CycleGateTile(2, 1), new NoteTile(N("Bb5"), 0.5));
  return p;
}

// ---------------------------------------------------------------------------
// 5. Tide clock — kick pulse, bass undertow, pad swell
// ---------------------------------------------------------------------------
function tideClock() {
  const p = baseProject({
    title: "Tide clock",
    haiku: "Moon pulls the harbour / wooden piles count the seconds / salt rewrites the wood",
    tempo: 88,
    fx: { reverbSize: 0.65, delayBeats: 0.666, delayFeedback: 0.35, delaySpread: 0.4 },
  });
  setPatch(p, 1, "kick", { pitchSweep: -2.8, level: 0.55 });
  setPatch(p, 2, "bass", { level: 0.5 });
  setPatch(p, 3, "pad", { level: 0.28, reverbSend: 0.55 });

  const kick = p.score.addLane(1, 1, ch(1, 8, "Kick"), 8);
  fill(kick, 0, new NoteTile(N("C2"), 1));
  fill(kick, 4, new NoteTile(N("C2"), 1));

  const bass = p.score.addLane(1, 3, ch(2, 8, "Bass"), 8);
  fill(bass, 0, new NoteTile(N("C2"), 3));
  fill(bass, 4, new NoteTile(N("Ab1"), 3));

  const pad = p.score.addLane(1, 5, ch(3, 4, "Pad"), 4);
  fill(pad, 0, new NoteTile(N("G3"), 4), new NoteTile(N("C4"), 4), new NoteTile(N("Eb4"), 4));
  return p;
}

// ---------------------------------------------------------------------------
// 6. Kitchen radio — pluck riff + hat shuffle
// ---------------------------------------------------------------------------
function kitchenRadio() {
  const p = baseProject({
    title: "Kitchen radio",
    haiku: "Static then a song / toast pops — butter, minor third / someone hums off-key",
    tempo: 128,
    fx: { delayBeats: 0.375, delayFeedback: 0.22, reverbSize: 0.3 },
  });
  setPatch(p, 1, "hat");
  setPatch(p, 2, "pluck", { level: 0.42, delaySend: 0.15 });
  setPatch(p, 3, "kick", { level: 0.45 });

  const hat = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1) fill(hat, i, new NoteTile(N("G#5"), 0.2));
  }

  const kick = p.score.addLane(1, 3, ch(3, 16, "Kick"), 16);
  fill(kick, 0, new NoteTile(N("C2")));
  fill(kick, 6, new NoteTile(N("C2")));
  fill(kick, 8, new NoteTile(N("C2")));
  fill(kick, 14, new NoteTile(N("C2")));

  const pluck = p.score.addLane(1, 5, ch(2, 16, "Riff"), 16);
  const riff = ["A3", "C4", "E4", "A3", "G3", "C4", "E4", "G3"];
  riff.forEach((n, i) => fill(pluck, i * 2, new NoteTile(N(n), 0.6)));
  return p;
}

// ---------------------------------------------------------------------------
// 7. Glass elevator — bright FM chords rising
// ---------------------------------------------------------------------------
function glassElevator() {
  const p = baseProject({
    title: "Glass elevator",
    haiku: "City falls away / floors of light stack under us / stomach learns the sky",
    tempo: 100,
    fx: { reverbSize: 0.5, delayBeats: 0.5, delayFeedback: 0.3, delaySpread: 0.25 },
  });
  setPatch(p, 1, "fm", {
    level: 0.4,
    modulatorRatio: 2,
    modulationIndex: 1.6,
    carrierAttack: 0.02,
    carrierRelease: 0.35,
    reverbSend: 0.3,
    delaySend: 0.12,
  });
  setPatch(p, 2, "bell", { level: 0.25, reverbSend: 0.4 });

  const chords = p.score.addLane(1, 2, ch(1, 8, "Chords"), 8);
  fill(chords, 0, new NoteTile(N("C4"), 2), new NoteTile(N("E4"), 2), new NoteTile(N("G4"), 2));
  fill(chords, 2, new NoteTile(N("D4"), 2), new NoteTile(N("F#4"), 2), new NoteTile(N("A4"), 2));
  fill(chords, 4, new NoteTile(N("E4"), 2), new NoteTile(N("G#4"), 2), new NoteTile(N("B4"), 2));
  fill(chords, 6, new NoteTile(N("G4"), 2), new NoteTile(N("B4"), 2), new NoteTile(N("D5"), 2));

  const chime = p.score.addLane(1, 6, ch(2, 8, "Chime"), 8);
  fill(chime, 1, new NoteTile(N("C6"), 0.5));
  fill(chime, 3, new NoteTile(N("D6"), 0.5));
  fill(chime, 5, new NoteTile(N("E6"), 0.5));
  fill(chime, 7, new NoteTile(N("G6"), 1));
  return p;
}

// ---------------------------------------------------------------------------
// 8. After the siren — dark bass drone + sparse snare
// ---------------------------------------------------------------------------
function afterTheSiren() {
  const p = baseProject({
    title: "After the siren",
    haiku: "Red light still spinning / on an empty street corner / dogs stop mid-bark, wait",
    tempo: 70,
    fx: { reverbSize: 0.7, reverbDamp: 0.55, delayBeats: 1, delayFeedback: 0.45 },
  });
  setPatch(p, 1, "bass", {
    level: 0.5,
    modulatorRatio: 0.5,
    modulationIndex: 0.6,
    carrierAttack: 0.08,
    carrierRelease: 0.8,
    reverbSend: 0.25,
  });
  setPatch(p, 2, "snare", { level: 0.25, reverbSend: 0.35 });
  setPatch(p, 3, "pad", { level: 0.22, reverbSend: 0.5 });

  const drone = p.score.addLane(1, 2, ch(1, 2, "Drone"), 4);
  fill(drone, 0, new NoteTile(N("E1"), 4));
  fill(drone, 2, new NoteTile(N("F1"), 4));

  const snare = p.score.addLane(1, 5, ch(2, 4, "Snare"), 8);
  fill(snare, 3, new NoteTile(N("D3"), 0.4));
  fill(snare, 7, new ProbGateTile(30), new NoteTile(N("D3"), 0.3));

  const air = p.score.addLane(1, 7, ch(3, 2, "Air"), 4);
  fill(air, 0, new NoteTile(N("B3"), 4));
  return p;
}

// ---------------------------------------------------------------------------
// 9. Bicycle bell — light plucks + hat + tiny bell
// ---------------------------------------------------------------------------
function bicycleBell() {
  const p = baseProject({
    title: "Bicycle bell",
    haiku: "Ring through green morning / spokes blur into silver thread / wind borrows the song",
    tempo: 140,
    fx: { delayBeats: 0.25, delayFeedback: 0.18, reverbSize: 0.35 },
  });
  setPatch(p, 1, "hat", { level: 0.18 });
  setPatch(p, 2, "pluck", { level: 0.4 });
  setPatch(p, 3, "bell", { level: 0.3, carrierRelease: 0.5 });

  const hat = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  for (let i = 0; i < 16; i += 1) {
    if (i % 4 !== 2) fill(hat, i, new NoteTile(N("A5"), 0.15));
  }

  const bike = p.score.addLane(1, 3, ch(2, 16, "Bike"), 16);
  fill(bike, 0, new NoteTile(N("G4"), 0.5));
  fill(bike, 2, new NoteTile(N("A4"), 0.5));
  fill(bike, 4, new NoteTile(N("B4"), 0.5));
  fill(bike, 6, new NoteTile(N("D5"), 1));
  fill(bike, 10, new NoteTile(N("B4"), 0.5));
  fill(bike, 12, new NoteTile(N("A4"), 0.5));
  fill(bike, 14, new NoteTile(N("G4"), 1));

  const bell = p.score.addLane(1, 6, ch(3, 8, "Bell"), 8);
  fill(bell, 0, new NoteTile(N("G5"), 0.3));
  fill(bell, 4, new CycleGateTile(2, 2), new NoteTile(N("G5"), 0.3));
  return p;
}

// ---------------------------------------------------------------------------
// 10. Snow static — noise hats, distant pad, soft kick
// ---------------------------------------------------------------------------
function snowStatic() {
  const p = baseProject({
    title: "Snow static",
    haiku: "White noise on the glass / TV left on in the dark / snow fills every channel",
    tempo: 80,
    fx: {
      reverbSize: 0.8,
      reverbDamp: 0.2,
      delayBeats: 0.75,
      delayFeedback: 0.38,
      delaySpread: 0.6,
      delayTone: 0.5,
    },
  });
  setPatch(p, 1, "hat", { level: 0.15, carrierRelease: 0.12, reverbSend: 0.4 });
  setPatch(p, 2, "pad", { level: 0.26, reverbSend: 0.65, delaySend: 0.25 });
  setPatch(p, 3, "kick", { level: 0.4, pitchSweep: -2, reverbSend: 0.2 });

  const staticLane = p.score.addLane(1, 1, ch(1, 16, "Static"), 16);
  for (let i = 0; i < 16; i++) {
    fill(staticLane, i, new ProbGateTile(55), new NoteTile(N("C6"), 0.15));
  }

  const pad = p.score.addLane(1, 4, ch(2, 4, "Pad"), 4);
  fill(pad, 0, new NoteTile(N("D3"), 4), new NoteTile(N("A3"), 4));
  fill(pad, 2, lock(true, ParamTargets.Level, 0.2), new NoteTile(N("C3"), 4), new NoteTile(N("G3"), 4));

  const kick = p.score.addLane(1, 7, ch(3, 8, "Kick"), 8);
  fill(kick, 0, new NoteTile(N("C2"), 1));
  fill(kick, 4, new NoteTile(N("C2"), 1));
  return p;
}

// ---------------------------------------------------------------------------

export const FACTORY_SKETCHES = [
  { id: "rain-on-tin", build: rainOnTin },
  { id: "night-market", build: nightMarket },
  { id: "empty-station", build: emptyStation },
  { id: "crow-at-dawn", build: crowAtDawn },
  { id: "tide-clock", build: tideClock },
  { id: "kitchen-radio", build: kitchenRadio },
  { id: "glass-elevator", build: glassElevator },
  { id: "after-the-siren", build: afterTheSiren },
  { id: "bicycle-bell", build: bicycleBell },
  { id: "snow-static", build: snowStatic },
];

export function buildFactorySketch(id) {
  const entry = FACTORY_SKETCHES.find((s) => s.id === id);
  return entry ? entry.build() : null;
}

export function allFactoryProjects() {
  return FACTORY_SKETCHES.map((s) => ({ id: s.id, project: s.build() }));
}
