#!/usr/bin/env node
// Automated tests for the Jacquardesque core + schedule path.

import {
  Project,
  ProjectFormat,
  Sequencer,
  Score,
  CellKind,
  gp,
  NoteTile,
  ParamTile,
  CycleGateTile,
  JumpTile,
  ChannelTile,
  ParamTargets,
  PatchBank,
  Pitch,
  noteEventFromPatch,
  noteTotalDuration,
  notePanGains,
  noteCarrierLevel,
  noteModulatorLevel,
  notePitchScale,
  FastMath,
} from "./core.js";

const fails = [];
function assert(cond, msg) {
  if (!cond) fails.push(msg);
}

// --- Sample / format ---
const p = Project.createSample();
assert(p.score.lanes.length === 3, "sample has 3 lanes");
assert(p.score.channelLanes.length === 2, "2 channel lanes");
const text = ProjectFormat.write(p);
assert(ProjectFormat.write(ProjectFormat.read(text)) === text, "format roundtrip");

// --- Jump wiring ---
const p2 = ProjectFormat.read(text);
const main = p2.score.lanes[1];
const variation = p2.score.lanes[2];
const jump = main.steps[9].tiles.find((t) => t instanceof JumpTile);
assert(!!jump, "jump present");
assert(variation.jumpSource === jump, "jump linked");
assert(p2.score.destinationOf(jump) === variation, "destinationOf");

// --- Place / remove / grow ---
const rail = main.cellPoint(1, 0);
assert(p2.score.at(rail).kind === CellKind.Rail, "empty rail");
assert(p2.score.place(rail, new NoteTile(64)), "place");
assert(p2.score.remove(rail), "remove");
const before = main.steps.length;
assert(p2.score.place(main.termPoint, new NoteTile(60)), "grow");
assert(main.steps.length === before + 1, "grew");

// --- Locks colour same-instant later lanes ---
const seq = new Sequencer();
const proj = Project.createSample();
seq.project = proj;
seq._random = () => 0;
const out = [];
seq.play(0, 0);
// Main lane is 16 sixteenths at 132bpm ≈ 1.82s/lap; GCYC4:3 needs pass==2 (~5.5s).
seq.schedule(0, 48000 * 8, 48000, out);
assert(out.length > 10, "notes over 8s: " + out.length);
const first = out.filter((n) => n.startSample === 0);
assert(first.length === 3, "chord size at t0: " + first.length);
// Accent PREL +0.2 on channel level — must lift above the unlocked bank value.
const bankLevel = proj.patches[0].level;
assert(first.every((n) => n.level > bankLevel + 0.05), "accent lock raises level");

// --- Cycle gate only on matching pass ---
// Step 8: GCYC4:3 / F4 / PREL / G#4 / C5 — all notes sit under the gate.
const f4 = Pitch.toFrequency(Pitch.tryParse("F4"));
const gNotes = out.filter((n) => Math.abs(n.frequency - f4) < 0.5);
assert(gNotes.length >= 1, "cycle gate notes present: " + gNotes.length);
// And not every lap: fewer F4 than plain G4s from open steps.
const g4 = Pitch.toFrequency(Pitch.tryParse("G4"));
const openG = out.filter((n) => Math.abs(n.frequency - g4) < 0.5);
assert(gNotes.length < openG.length, "gate fires less often than open notes");

// --- Envelopes / pan law ---
const patch = PatchBank.get(proj.patches, 1);
const ev = noteEventFromPatch(patch, 60, 0.5, 0);
assert(Math.abs(ev.frequency - 261.625) < 0.1, "C4 freq");
assert(noteTotalDuration(ev) > ev.duration, "release extends");
const center = notePanGains({ pan: 0 });
assert(Math.abs(center.left - 1) < 0.02, "center pan ~1: " + center.left);
assert(Math.abs(center.left - center.right) < 1e-5, "center equal");
const left = notePanGains({ pan: -1 });
assert(left.left > left.right, "hard left");
assert(noteCarrierLevel(ev, 0) < 1, "attack start");
assert(noteCarrierLevel(ev, 0.1) === 1, "attack done");
assert(noteModulatorLevel(ev, 0) > 0.9, "mod start high");
assert(noteModulatorLevel(ev, 1) === 0, "mod ended");
const kick = noteEventFromPatch({ ...patch, pitchSweep: -4, pitchDecay: 0.05 }, 36, 0.2, 0);
assert(notePitchScale(kick, 0) > 1 || notePitchScale(kick, 0) < 1, "pitch env active");
assert(notePitchScale(kick, 1) === 1, "pitch env settled");

// --- Sub-stack plan ---
const score2 = Project.createSample().score;
const m2 = score2.lanes[1];
const gateCell = score2.at(m2.cellPoint(8, 0));
const plan2 = score2.planMove(gateCell, m2.cellPoint(4, 0));
assert(plan2 && plan2.count === 5, "substack count: " + (plan2 && plan2.count));

// --- FastMath sanity ---
assert(Math.abs(FastMath.sin(0)) < 1e-5, "sin0");
assert(Math.abs(FastMath.sin(Math.PI / 2) - 1) < 1e-4, "sin pi/2");
assert(Math.abs(FastMath.cos(0) - 1) < 1e-4, "cos0");

// --- Soft clip (Pade tanh) ---
function softClip(x) {
  const s = Math.min(x * x, 9);
  return Math.min(1, Math.max(-1, x * (27 + s) / (27 + 9 * s)));
}
assert(Math.abs(softClip(0)) < 1e-9, "clip0");
assert(softClip(10) <= 1 && softClip(10) > 0.9, "clip saturates");
assert(softClip(-10) >= -1, "clip neg");

// --- Offline FM: one note produces energy ---
function renderNote(frames = 2048, sr = 48000) {
  const note = noteEventFromPatch(defaultKickish(), 36, 0.15, 0);
  let phaseC = 0;
  let phaseM = 0;
  let fb1 = 0;
  let fb2 = 0;
  const inc = note.frequency / sr;
  let energy = 0;
  for (let i = 0; i < frames; i++) {
    const time = i / sr;
    if (time >= noteTotalDuration(note)) break;
    const scale = notePitchScale(note, time);
    const increment = inc * scale;
    const mod = FastMath.sin(
      FastMath.TwoPi * phaseM + note.feedback * (fb1 + fb2) * 0.5,
    );
    fb2 = fb1;
    fb1 = mod;
    const index = note.modulationIndex * noteModulatorLevel(note, time);
    const amp = note.level * noteCarrierLevel(note, time);
    const sample = FastMath.sin(FastMath.TwoPi * phaseC + mod * index) * amp;
    energy += sample * sample;
    phaseC = FastMath.frac(phaseC + increment);
    phaseM = FastMath.frac(phaseM + increment * note.modulatorRatio);
  }
  return energy;
}

function defaultKickish() {
  return {
    level: 0.9,
    pan: 0,
    gateScale: 1,
    modulatorRatio: 1,
    modulationIndex: 4,
    feedback: 0.5,
    modulatorDecay: 0.08,
    carrierAttack: 0.001,
    carrierRelease: 0.1,
    pitchSweep: -5,
    pitchDecay: 0.04,
    reverbSend: 0,
    delaySend: 0,
  };
}

const energy = renderNote();
assert(energy > 1, "FM offline energy: " + energy);

// --- Empty project play ---
const empty = Project.createEmpty();
const seqE = new Sequencer();
seqE.project = empty;
const outE = [];
seqE.play(0, 0);
seqE.schedule(0, 48000, 48000, outE);
assert(outE.length === 0, "empty lane silent");
assert(seqE.isPlaying, "still playing empty");

if (fails.length) {
  console.error("FAIL (" + fails.length + "):\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("test-core: ALL PASS (" + out.length + " notes / 4s sample schedule)");
