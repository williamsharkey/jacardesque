// Ten factory sketches — each a haiku and a sequence that *sounds like* it.
// Seeded once into localStorage; users can edit and auto-save freely.
//
// Drums: one TR kit instrument per drum section (engine 14, pad MIDI).
// Melodic: catalog keys (fm-lead, bass-sub, pad-warm, bell-chime, pluck-nylon…).
// Lanes bind via setLaneInstrument; pad MIDI selects kick/snare/hat/etc.

import {
  Project,
  ChannelTile,
  NoteTile,
  ParamTile,
  CycleGateTile,
  ProbGateTile,
  ParamTargets,
  PatchBank,
  Pitch,
} from "./core.js";
import { patchFor } from "./instruments.js";
import {
  createInstrumentModule,
  setLaneInstrument,
  ensureInstruments,
} from "./inst-model.js";

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

/**
 * Place a grid instrument (TR kit or melodic) and load its patch bank slot.
 * Drum lanes share one kit module; melodic voices each get their own.
 */
function placeKit(p, type, x, y, channel, id, overrides = {}) {
  ensureInstruments(p.score);
  const m = createInstrumentModule(type, x, y, { id, channel });
  p.score.instruments.push(m);
  Object.assign(PatchBank.get(p.patches, channel), patchFor(type, overrides));
  return m;
}

/** Bind lane → instrument; restore a short display label after setLaneInstrument. */
function bindLane(p, lane, inst, label) {
  setLaneInstrument(p.score, lane, inst);
  if (label) lane.channel.label = label;
  return lane;
}

function baseProject({ title, haiku, tempo = 120, fx = {} }) {
  const project = new Project();
  project.title = title;
  project.haiku = haiku;
  project.tempo = tempo;
  project.gridW = 32;
  project.gridH = 16;
  project.syncGrid();
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
  ensureInstruments(project.score);
  // Neutral leftover channels (unused slots stay quiet-ish)
  for (let c = 1; c <= 8; c++) {
    Object.assign(PatchBank.get(project.patches, c), patchFor("fm-lead", { level: 0.4 }));
  }
  return project;
}

// Pad MIDI reference (TR kits, engine 14):
// kick=C2(36) snare=D2(38) rim=F2(41) clap=G#2(44)
// tomL=C3(48) tomM=A#3(58) tomH=G#4(68) hatC≈F#5/D5 hatO=G#5 perc=F6

// ---------------------------------------------------------------------------
// 1. Rain on tin — soft 606 hats + bell droplets
// ---------------------------------------------------------------------------
function rainOnTin() {
  const p = baseProject({
    title: "Rain on tin",
    haiku: "Soft rain on tin roof / each drop a tiny bell note / cat blinks twice, waits",
    tempo: 96,
    fx: { reverbSize: 0.55, reverbDamp: 0.35, delayBeats: 0.375, delayFeedback: 0.25 },
  });
  const kit = placeKit(p, "tr-606", 20, 1, 1, "rain-kit", {
    level: 0.28,
    reverbSend: 0.22,
  });
  const bells = placeKit(p, "bell-chime", 20, 5, 2, "rain-bell", {
    level: 0.32,
    reverbSend: 0.5,
    delaySend: 0.15,
  });

  const hats = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  bindLane(p, hats, kit, "Hats");
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) fill(hats, i, new NoteTile(N("F#5"), 0.25));
    else if (i % 4 === 3) fill(hats, i, new ProbGateTile(40), new NoteTile(N("A5"), 0.2));
  }

  // Soft rim ticks — sparse rain on the sill
  const rim = p.score.addLane(1, 3, ch(1, 16, "Rim"), 16);
  bindLane(p, rim, kit, "Rim");
  fill(rim, 5, new ProbGateTile(45), new NoteTile(N("F2"), 0.2));
  fill(rim, 11, new ProbGateTile(35), new NoteTile(N("F2"), 0.15));
  fill(rim, 15, new ProbGateTile(50), new NoteTile(N("F2"), 0.2));

  const bellLane = p.score.addLane(1, 5, ch(2, 8, "Bells"), 8);
  bindLane(p, bellLane, bells, "Bells");
  fill(bellLane, 0, new NoteTile(N("E5"), 2));
  fill(bellLane, 2, new NoteTile(N("B4"), 1.5));
  fill(bellLane, 4, new NoteTile(N("G#4"), 2));
  fill(bellLane, 6, new ProbGateTile(60), new NoteTile(N("C#5"), 1));
  return p;
}

// ---------------------------------------------------------------------------
// 2. Night market — 808 kick + bass groove, neon lead
// ---------------------------------------------------------------------------
function nightMarket() {
  const p = baseProject({
    title: "Night market",
    haiku: "Lantern steam rises / oil and sugar in the air / bass walks home alone",
    tempo: 108,
    fx: { delayBeats: 0.5, delayFeedback: 0.32, reverbSize: 0.35 },
  });
  const kit = placeKit(p, "tr-808", 20, 1, 1, "nm-kit", { level: 0.55, reverbSend: 0.08 });
  const bass = placeKit(p, "bass-sub", 20, 5, 2, "nm-bass", { level: 0.55 });
  const lead = placeKit(p, "fm-lead", 20, 9, 3, "nm-lead", {
    level: 0.38,
    modulationIndex: 1.8,
    reverbSend: 0.2,
    delaySend: 0.18,
  });

  const kick = p.score.addLane(1, 1, ch(1, 16, "Kick"), 16);
  bindLane(p, kick, kit, "Kick");
  fill(kick, 0, new NoteTile(N("C2"), 0.5));
  fill(kick, 4, new NoteTile(N("C2"), 0.5));
  fill(kick, 8, new NoteTile(N("C2"), 0.5));
  fill(kick, 10, new NoteTile(N("G1"), 0.4));
  fill(kick, 12, new NoteTile(N("C2"), 0.5));
  fill(kick, 14, new ProbGateTile(50), new NoteTile(N("C2"), 0.3));

  const snare = p.score.addLane(1, 3, ch(1, 16, "Snare"), 16);
  bindLane(p, snare, kit, "Snare");
  fill(snare, 4, new NoteTile(N("D2"), 0.35));
  fill(snare, 12, new NoteTile(N("D2"), 0.35));
  fill(snare, 15, new ProbGateTile(30), new NoteTile(N("D2"), 0.2));

  const hats = p.score.addLane(1, 4, ch(1, 16, "Hats"), 16);
  bindLane(p, hats, kit, "Hats");
  for (let i = 0; i < 16; i += 2) {
    fill(hats, i, new NoteTile(N("F#5"), i % 4 === 0 ? 0.22 : 0.14));
  }
  fill(hats, 7, new ProbGateTile(40), new NoteTile(N("A5"), 0.12));

  const bassLane = p.score.addLane(1, 6, ch(2, 16, "Bass"), 16);
  bindLane(p, bassLane, bass, "Bass");
  fill(bassLane, 0, new NoteTile(N("C2"), 2));
  fill(bassLane, 4, new NoteTile(N("Eb2"), 1));
  fill(bassLane, 6, new NoteTile(N("F2"), 1));
  fill(bassLane, 8, new NoteTile(N("G2"), 2));
  fill(bassLane, 12, new NoteTile(N("Bb1"), 2));

  const leadLane = p.score.addLane(1, 9, ch(3, 16, "Lead"), 16);
  bindLane(p, leadLane, lead, "Lead");
  fill(leadLane, 2, new NoteTile(N("G4"), 1));
  fill(leadLane, 4, new NoteTile(N("Bb4"), 0.5));
  fill(leadLane, 5, new NoteTile(N("C5"), 1.5));
  fill(leadLane, 9, new NoteTile(N("Eb5"), 1));
  fill(leadLane, 12, new NoteTile(N("D5"), 2));
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
  const pad = placeKit(p, "pad-warm", 20, 2, 1, "es-pad", {
    level: 0.3,
    reverbSend: 0.6,
  });
  const pluck = placeKit(p, "pluck-nylon", 20, 6, 2, "es-pluck", {
    level: 0.35,
    delaySend: 0.25,
    reverbSend: 0.3,
  });

  const padLane = p.score.addLane(1, 2, ch(1, 4, "Pad"), 8);
  bindLane(p, padLane, pad, "Pad");
  fill(padLane, 0, new NoteTile(N("A3"), 4), new NoteTile(N("E4"), 4));
  fill(padLane, 4, new NoteTile(N("F3"), 4), new NoteTile(N("C4"), 4));

  const pluckLane = p.score.addLane(1, 5, ch(2, 8, "Pluck"), 16);
  bindLane(p, pluckLane, pluck, "Pluck");
  fill(pluckLane, 3, new NoteTile(N("E5"), 0.5));
  fill(pluckLane, 7, new NoteTile(N("A4"), 1));
  fill(pluckLane, 11, new ProbGateTile(45), new NoteTile(N("C5"), 0.5));
  fill(pluckLane, 15, new NoteTile(N("B4"), 2));
  return p;
}

// ---------------------------------------------------------------------------
// 4. Crow at dawn — 707 snare ticks + bright bell call
// ---------------------------------------------------------------------------
function crowAtDawn() {
  const p = baseProject({
    title: "Crow at dawn",
    haiku: "Wire against peach sky / one crow argues with the sun / wires answer back",
    tempo: 118,
    fx: { reverbSize: 0.4, delayBeats: 0.25, delayFeedback: 0.2 },
  });
  const kit = placeKit(p, "tr-707", 20, 1, 1, "crow-kit", {
    level: 0.38,
    reverbSend: 0.15,
  });
  const crow = placeKit(p, "bell-chime", 20, 6, 2, "crow-bell", {
    level: 0.4,
    modulatorRatio: 4.2,
  });

  const snare = p.score.addLane(1, 1, ch(1, 16, "Snare"), 16);
  bindLane(p, snare, kit, "Snare");
  fill(snare, 4, new NoteTile(N("D2"), 0.3));
  fill(snare, 12, new NoteTile(N("D2"), 0.3));
  fill(snare, 14, new ProbGateTile(35), new NoteTile(N("D2"), 0.2));
  fill(snare, 6, new ProbGateTile(25), new NoteTile(N("F2"), 0.15)); // rim ghost

  const hat = p.score.addLane(1, 3, ch(1, 16, "Hats"), 16);
  bindLane(p, hat, kit, "Hats");
  for (let i = 0; i < 16; i += 2) fill(hat, i, new NoteTile(N("F#5"), 0.2));
  fill(hat, 9, new ProbGateTile(40), new NoteTile(N("A5"), 0.15));

  const crowLane = p.score.addLane(1, 5, ch(2, 8, "Crow"), 8);
  bindLane(p, crowLane, crow, "Crow");
  fill(crowLane, 0, new NoteTile(N("G5"), 0.5));
  fill(crowLane, 1, new NoteTile(N("Eb5"), 0.5));
  fill(crowLane, 2, new NoteTile(N("G5"), 1));
  fill(crowLane, 5, new CycleGateTile(2, 1), new NoteTile(N("Bb5"), 0.5));
  return p;
}

// ---------------------------------------------------------------------------
// 5. Tide clock — 808 kick pulse, bass undertow, pad swell
// ---------------------------------------------------------------------------
function tideClock() {
  const p = baseProject({
    title: "Tide clock",
    haiku: "Moon pulls the harbour / wooden piles count the seconds / salt rewrites the wood",
    tempo: 88,
    fx: { reverbSize: 0.65, delayBeats: 0.666, delayFeedback: 0.35, delaySpread: 0.4 },
  });
  const kit = placeKit(p, "tr-808", 20, 1, 1, "tide-kit", {
    level: 0.55,
    reverbSend: 0.12,
  });
  const bass = placeKit(p, "bass-sub", 20, 5, 2, "tide-bass", { level: 0.5 });
  const pad = placeKit(p, "pad-warm", 20, 9, 3, "tide-pad", {
    level: 0.28,
    reverbSend: 0.55,
  });

  const kick = p.score.addLane(1, 1, ch(1, 8, "Kick"), 8);
  bindLane(p, kick, kit, "Kick");
  fill(kick, 0, new NoteTile(N("C2"), 1));
  fill(kick, 4, new NoteTile(N("C2"), 1));
  fill(kick, 6, new ProbGateTile(40), new NoteTile(N("C2"), 0.4));

  const clap = p.score.addLane(1, 2, ch(1, 8, "Clap"), 8);
  bindLane(p, clap, kit, "Clap");
  fill(clap, 2, new ProbGateTile(55), new NoteTile(N("G#2"), 0.3));
  fill(clap, 6, new NoteTile(N("G#2"), 0.35));

  const bassLane = p.score.addLane(1, 4, ch(2, 8, "Bass"), 8);
  bindLane(p, bassLane, bass, "Bass");
  fill(bassLane, 0, new NoteTile(N("C2"), 3));
  fill(bassLane, 4, new NoteTile(N("Ab1"), 3));

  const padLane = p.score.addLane(1, 6, ch(3, 4, "Pad"), 4);
  bindLane(p, padLane, pad, "Pad");
  fill(padLane, 0, new NoteTile(N("G3"), 4), new NoteTile(N("C4"), 4), new NoteTile(N("Eb4"), 4));
  return p;
}

// ---------------------------------------------------------------------------
// 6. Kitchen radio — pluck riff + 808 hat shuffle + kick
// ---------------------------------------------------------------------------
function kitchenRadio() {
  const p = baseProject({
    title: "Kitchen radio",
    haiku: "Static then a song / toast pops — butter, minor third / someone hums off-key",
    tempo: 128,
    fx: { delayBeats: 0.375, delayFeedback: 0.22, reverbSize: 0.3 },
  });
  const kit = placeKit(p, "tr-808", 20, 1, 1, "kr-kit", { level: 0.48 });
  const pluck = placeKit(p, "pluck-nylon", 20, 6, 2, "kr-pluck", {
    level: 0.42,
    delaySend: 0.15,
  });

  const hat = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  bindLane(p, hat, kit, "Hats");
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1) fill(hat, i, new NoteTile(N("A5"), 0.2));
  }
  fill(hat, 4, new NoteTile(N("F#5"), 0.15));
  fill(hat, 12, new NoteTile(N("F#5"), 0.15));

  const kick = p.score.addLane(1, 3, ch(1, 16, "Kick"), 16);
  bindLane(p, kick, kit, "Kick");
  fill(kick, 0, new NoteTile(N("C2")));
  fill(kick, 6, new NoteTile(N("C2")));
  fill(kick, 8, new NoteTile(N("C2")));
  fill(kick, 14, new NoteTile(N("C2")));

  const snare = p.score.addLane(1, 4, ch(1, 16, "Snare"), 16);
  bindLane(p, snare, kit, "Snare");
  fill(snare, 4, new NoteTile(N("D2"), 0.3));
  fill(snare, 12, new NoteTile(N("D2"), 0.3));
  fill(snare, 10, new ProbGateTile(35), new NoteTile(N("D2"), 0.2));

  const pluckLane = p.score.addLane(1, 6, ch(2, 16, "Riff"), 16);
  bindLane(p, pluckLane, pluck, "Riff");
  const riff = ["A3", "C4", "E4", "A3", "G3", "C4", "E4", "G3"];
  riff.forEach((n, i) => fill(pluckLane, i * 2, new NoteTile(N(n), 0.6)));
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
  const chords = placeKit(p, "fm-lead", 20, 2, 1, "ge-fm", {
    level: 0.4,
    modulatorRatio: 2,
    modulationIndex: 1.6,
    carrierAttack: 0.02,
    carrierRelease: 0.35,
    reverbSend: 0.3,
    delaySend: 0.12,
  });
  const chime = placeKit(p, "bell-chime", 20, 7, 2, "ge-bell", {
    level: 0.25,
    reverbSend: 0.4,
  });

  const chordLane = p.score.addLane(1, 2, ch(1, 8, "Chords"), 8);
  bindLane(p, chordLane, chords, "Chords");
  fill(chordLane, 0, new NoteTile(N("C4"), 2), new NoteTile(N("E4"), 2), new NoteTile(N("G4"), 2));
  fill(chordLane, 2, new NoteTile(N("D4"), 2), new NoteTile(N("F#4"), 2), new NoteTile(N("A4"), 2));
  fill(chordLane, 4, new NoteTile(N("E4"), 2), new NoteTile(N("G#4"), 2), new NoteTile(N("B4"), 2));
  fill(chordLane, 6, new NoteTile(N("G4"), 2), new NoteTile(N("B4"), 2), new NoteTile(N("D5"), 2));

  const chimeLane = p.score.addLane(1, 6, ch(2, 8, "Chime"), 8);
  bindLane(p, chimeLane, chime, "Chime");
  fill(chimeLane, 1, new NoteTile(N("C6"), 0.5));
  fill(chimeLane, 3, new NoteTile(N("D6"), 0.5));
  fill(chimeLane, 5, new NoteTile(N("E6"), 0.5));
  fill(chimeLane, 7, new NoteTile(N("G6"), 1));
  return p;
}

// ---------------------------------------------------------------------------
// 8. After the siren — dark bass drone + sparse 909 snare
// ---------------------------------------------------------------------------
function afterTheSiren() {
  const p = baseProject({
    title: "After the siren",
    haiku: "Red light still spinning / on an empty street corner / dogs stop mid-bark, wait",
    tempo: 70,
    fx: { reverbSize: 0.7, reverbDamp: 0.55, delayBeats: 1, delayFeedback: 0.45 },
  });
  const bass = placeKit(p, "bass-sub", 20, 2, 1, "siren-bass", {
    level: 0.5,
    modulatorRatio: 0.5,
    modulationIndex: 0.6,
    carrierAttack: 0.08,
    carrierRelease: 0.8,
    reverbSend: 0.25,
  });
  const kit = placeKit(p, "tr-909", 20, 6, 2, "siren-kit", {
    level: 0.28,
    reverbSend: 0.35,
  });
  const pad = placeKit(p, "pad-drone", 20, 10, 3, "siren-pad", {
    level: 0.22,
    reverbSend: 0.5,
  });

  const drone = p.score.addLane(1, 2, ch(1, 2, "Drone"), 4);
  bindLane(p, drone, bass, "Drone");
  fill(drone, 0, new NoteTile(N("E1"), 4));
  fill(drone, 2, new NoteTile(N("F1"), 4));

  const snare = p.score.addLane(1, 5, ch(2, 4, "Snare"), 8);
  bindLane(p, snare, kit, "Snare");
  fill(snare, 3, new NoteTile(N("D2"), 0.4));
  fill(snare, 7, new ProbGateTile(30), new NoteTile(N("D2"), 0.3));

  const air = p.score.addLane(1, 7, ch(3, 2, "Air"), 4);
  bindLane(p, air, pad, "Air");
  fill(air, 0, new NoteTile(N("B3"), 4));
  return p;
}

// ---------------------------------------------------------------------------
// 9. Bicycle bell — light plucks + 606 hat + tiny bell
// ---------------------------------------------------------------------------
function bicycleBell() {
  const p = baseProject({
    title: "Bicycle bell",
    haiku: "Ring through green morning / spokes blur into silver thread / wind borrows the song",
    tempo: 140,
    fx: { delayBeats: 0.25, delayFeedback: 0.18, reverbSize: 0.35 },
  });
  const kit = placeKit(p, "tr-606", 20, 1, 1, "bike-kit", { level: 0.22 });
  const bike = placeKit(p, "pluck-nylon", 20, 5, 2, "bike-pluck", { level: 0.4 });
  const bell = placeKit(p, "bell-chime", 20, 9, 3, "bike-bell", {
    level: 0.3,
    carrierRelease: 0.5,
  });

  const hat = p.score.addLane(1, 1, ch(1, 16, "Hats"), 16);
  bindLane(p, hat, kit, "Hats");
  for (let i = 0; i < 16; i += 1) {
    if (i % 4 !== 2) fill(hat, i, new NoteTile(N("F#5"), 0.15));
  }

  const bikeLane = p.score.addLane(1, 3, ch(2, 16, "Bike"), 16);
  bindLane(p, bikeLane, bike, "Bike");
  fill(bikeLane, 0, new NoteTile(N("G4"), 0.5));
  fill(bikeLane, 2, new NoteTile(N("A4"), 0.5));
  fill(bikeLane, 4, new NoteTile(N("B4"), 0.5));
  fill(bikeLane, 6, new NoteTile(N("D5"), 1));
  fill(bikeLane, 10, new NoteTile(N("B4"), 0.5));
  fill(bikeLane, 12, new NoteTile(N("A4"), 0.5));
  fill(bikeLane, 14, new NoteTile(N("G4"), 1));

  const bellLane = p.score.addLane(1, 6, ch(3, 8, "Bell"), 8);
  bindLane(p, bellLane, bell, "Bell");
  fill(bellLane, 0, new NoteTile(N("G5"), 0.3));
  fill(bellLane, 4, new CycleGateTile(2, 2), new NoteTile(N("G5"), 0.3));
  return p;
}

// ---------------------------------------------------------------------------
// 10. Snow static — noise hats, distant pad, soft 606 kick
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
  const kit = placeKit(p, "tr-606", 20, 1, 1, "snow-kit", {
    level: 0.32,
    reverbSend: 0.35,
  });
  const pad = placeKit(p, "pad-glass", 20, 6, 2, "snow-pad", {
    level: 0.26,
    reverbSend: 0.65,
    delaySend: 0.25,
  });

  const staticLane = p.score.addLane(1, 1, ch(1, 16, "Static"), 16);
  bindLane(p, staticLane, kit, "Static");
  for (let i = 0; i < 16; i++) {
    // Mix closed/open hats for white-noise snow (A5 = open via legacy map)
    const pitch = i % 3 === 0 ? "F#5" : i % 5 === 0 ? "A5" : "G5";
    fill(staticLane, i, new ProbGateTile(55), new NoteTile(N(pitch), 0.15));
  }

  const padLane = p.score.addLane(1, 4, ch(2, 4, "Pad"), 4);
  bindLane(p, padLane, pad, "Pad");
  fill(padLane, 0, new NoteTile(N("D3"), 4), new NoteTile(N("A3"), 4));
  fill(padLane, 2, lock(true, ParamTargets.Level, 0.2), new NoteTile(N("C3"), 4), new NoteTile(N("G3"), 4));

  const kick = p.score.addLane(1, 7, ch(1, 8, "Kick"), 8);
  bindLane(p, kick, kit, "Kick");
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
