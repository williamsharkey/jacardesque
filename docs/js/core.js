// Jacquardesque core — faithful port of Assets/Core (engine-free).
// Model, pitch, param targets, FM patch/events, format, sequencer.

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

export const Pitch = {
  Lowest: 12,
  Highest: 120,
  Names: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],

  mod(a, b) {
    return ((a % b) + b) % b;
  },

  toName(note) {
    return this.Names[this.mod(note, 12)] + (Math.floor(note / 12) - 1);
  },

  toClassName(note) {
    return this.Names[this.mod(note, 12)];
  },

  toOctave(note) {
    return Math.floor(note / 12) - 1;
  },

  isSharp(note) {
    return this.Names[this.mod(note, 12)].length > 1;
  },

  toFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  },

  tryParse(text) {
    if (!text) return null;
    const names = this.Names;
    const letter = text[0].toUpperCase();
    let index = names.indexOf(letter);
    if (index < 0) return null;
    let i = 1;
    if (i < text.length && (text[i] === "#" || text[i] === "s")) {
      index++;
      i++;
    }
    if (i >= text.length) return null;
    const octave = parseInt(text.slice(i), 10);
    if (Number.isNaN(octave)) return null;
    const note = (octave + 1) * 12 + index;
    if (note < 0 || note >= 128) return null;
    return note;
  },
};

// ---------------------------------------------------------------------------
// Param targets / patch bank
// ---------------------------------------------------------------------------

export const ParamTargets = {
  Level: 0,
  Pan: 1,
  Gate: 2,
  ModIndex: 3,
  ModRatio: 4,
  Feedback: 5,
  ModDecay: 6,
  CarAttack: 7,
  CarRelease: 8,
  PitchSweep: 9,
  PitchDecay: 10,
  ReverbSend: 11,
  DelaySend: 12,
  Count: 13,

  Names: [
    "Level", "Pan", "Gate ratio", "Mod index", "Mod ratio", "Feedback",
    "Mod decay", "Car attack", "Car release", "Pitch sweep", "Pitch decay",
    "Reverb", "Delay",
  ],

  Keys: [
    "level", "pan", "gate", "index", "ratio", "feedback",
    "moddecay", "carattack", "carrelease", "pitchsweep", "pitchdecay",
    "rsend", "dsend",
  ],

  name(t) {
    return t >= 0 && t < this.Count ? this.Names[t] : "?";
  },

  key(t) {
    return t >= 0 && t < this.Count ? this.Keys[t] : "level";
  },

  parse(key) {
    return this.Keys.indexOf(key);
  },

  min(t) {
    switch (t) {
      case this.ModRatio: return 0.25;
      case this.Gate: return 0.05;
      case this.ModDecay: return 0.005;
      case this.CarAttack: return 0.001;
      case this.Pan: return -1;
      case this.PitchSweep: return -8;
      default: return 0;
    }
  },

  max(t) {
    switch (t) {
      case this.Level: return 1;
      case this.Gate: return 4;
      case this.ModIndex: return 12;
      case this.ModRatio: return 8;
      case this.Feedback: return 8;
      case this.ModDecay: return 1;
      case this.CarAttack: return 0.5;
      case this.CarRelease: return 4;
      case this.PitchSweep: return 8;
      case this.PitchDecay: return 1;
      default: return 1;
    }
  },

  get(patch, t) {
    switch (t) {
      case this.Level: return patch.level;
      case this.Pan: return patch.pan;
      case this.Gate: return patch.gateScale;
      case this.ModIndex: return patch.modulationIndex;
      case this.ModRatio: return patch.modulatorRatio;
      case this.Feedback: return patch.feedback;
      case this.ModDecay: return patch.modulatorDecay;
      case this.CarAttack: return patch.carrierAttack;
      case this.CarRelease: return patch.carrierRelease;
      case this.PitchSweep: return patch.pitchSweep;
      case this.PitchDecay: return patch.pitchDecay;
      case this.ReverbSend: return patch.reverbSend;
      case this.DelaySend: return patch.delaySend;
      default: return 0;
    }
  },

  set(patch, t, value) {
    value = Math.min(this.max(t), Math.max(this.min(t), value));
    switch (t) {
      case this.Level: patch.level = value; break;
      case this.Pan: patch.pan = value; break;
      case this.Gate: patch.gateScale = value; break;
      case this.ModIndex: patch.modulationIndex = value; break;
      case this.ModRatio: patch.modulatorRatio = value; break;
      case this.Feedback: patch.feedback = value; break;
      case this.ModDecay: patch.modulatorDecay = value; break;
      case this.CarAttack: patch.carrierAttack = value; break;
      case this.CarRelease: patch.carrierRelease = value; break;
      case this.PitchSweep: patch.pitchSweep = value; break;
      case this.PitchDecay: patch.pitchDecay = value; break;
      case this.ReverbSend: patch.reverbSend = value; break;
      case this.DelaySend: patch.delaySend = value; break;
    }
  },

  add(patch, t, delta) {
    this.set(patch, t, this.get(patch, t) + delta);
  },
};

export function defaultPatch() {
  return {
    instrument: 0, // 0=fm … see instruments.js
    level: 0.5,
    pan: 0,
    gateScale: 1,
    modulatorRatio: 2,
    modulationIndex: 1.4,
    feedback: 0.15,
    modulatorDecay: 0.14,
    carrierAttack: 0.005,
    carrierRelease: 0.16,
    pitchSweep: 0,
    pitchDecay: 0.05,
    reverbSend: 0.1,
    delaySend: 0.05,
  };
}

export function clonePatch(p) {
  return { ...p };
}

export const PatchBank = {
  Channels: 8,
  clamp(ch) {
    return Math.min(this.Channels, Math.max(1, ch | 0));
  },
  create() {
    return Array.from({ length: this.Channels }, () => defaultPatch());
  },
  get(bank, ch) {
    return bank[this.clamp(ch) - 1];
  },
  set(bank, ch, patch) {
    bank[this.clamp(ch) - 1] = patch;
  },
};

// ---------------------------------------------------------------------------
// Send FX / delay times
// ---------------------------------------------------------------------------

export const DelayTime = {
  Names: ["1/32", "1/16T", "1/16", "1/8T", "1/16D", "1/8", "1/4T", "1/8D", "1/4"],
  Beats: [0.125, 1 / 6, 0.25, 1 / 3, 0.375, 0.5, 2 / 3, 0.75, 1],
  Default: 5,
  LongestSeconds: 3,

  nearest(beats) {
    let nearest = this.Default;
    let distance = Infinity;
    for (let i = 0; i < this.Beats.length; i++) {
      const d = Math.abs(this.Beats[i] - beats);
      if (d < distance) {
        nearest = i;
        distance = d;
      }
    }
    return nearest;
  },
};

export function defaultSendFx() {
  return {
    reverbSize: 0.5,
    reverbDamp: 0.5,
    reverbWidth: 1,
    delayBeats: DelayTime.Beats[DelayTime.Default],
    delayFeedback: 0.35,
    delayTone: 0.4,
    delaySpread: 0,
  };
}

export const SendFx = {
  MaxFeedback: 0.95,
  delaySeconds(fx, tempo) {
    return fx.delayBeats * 60 / Math.max(tempo, 1);
  },
};

// ---------------------------------------------------------------------------
// FastMath + note event helpers (shared with scheduling path)
// ---------------------------------------------------------------------------

export const FastMath = {
  Pi: 3.14159265,
  TwoPi: 6.28318531,
  HalfPi: 1.57079633,
  Root2: 1.41421356,

  floor(x) {
    const i = x | 0;
    return x < 0 && x !== i ? i - 1 : i;
  },

  frac(x) {
    return x - this.floor(x);
  },

  sin(x) {
    let turns = x * (1 / this.TwoPi);
    turns -= this.floor(turns + 0.5);
    let r = turns * this.TwoPi;
    if (r > this.HalfPi) r = this.Pi - r;
    else if (r < -this.HalfPi) r = -this.Pi - r;
    const s = r * r;
    return r * (1 + s * (-0.166666667 +
      s * (0.00833333333 +
      s * (-0.000198412698 +
      s * 2.75573192e-6))));
  },

  cos(x) {
    return this.sin(x + this.HalfPi);
  },

  exp(x) {
    const t = x * 1.44269504;
    const i = this.floor(t) | 0;
    const f = t - i;
    const p = 1 + f * (0.693147181 +
      f * (0.240226507 +
      f * (0.0555041087 +
      f * (0.00961812911 +
      f * 0.00133335581))));
    return p * this.exp2(i);
  },

  exp2(exponent) {
    let result = 1;
    if (exponent > 64) return Number.MAX_VALUE;
    if (exponent < -64) return 0;
    while (exponent > 0) {
      result *= 2;
      exponent--;
    }
    while (exponent < 0) {
      result *= 0.5;
      exponent++;
    }
    return result;
  },

  pow2(x) {
    return this.exp(x * 0.693147181);
  },
};

const FmCurve = {
  Curve: 5,
  Tail: 0.006737947,
  SnapCurve: 16,
  SnapTail: 1.1253517e-7,

  fade(x) {
    return (FastMath.exp(-this.Curve * x) - this.Tail) / (1 - this.Tail);
  },

  snap(x) {
    return (FastMath.exp(-this.SnapCurve * x) - this.SnapTail) / (1 - this.SnapTail);
  },
};

export function noteEventFromPatch(patch, midiNote, gateSeconds, startSample, channel = 1) {
  const level = Math.min(1, Math.max(0, patch.level));
  const pan = Math.min(1, Math.max(-1, patch.pan));
  return {
    startSample: startSample | 0,
    midi: midiNote | 0,
    channel: channel | 0,
    frequency: Pitch.toFrequency(midiNote),
    level,
    pan,
    duration: Math.max(gateSeconds * (patch.gateScale ?? 1), 0.005),
    priority: Math.round(level * 8),
    instrument: patch.instrument | 0,
    modulatorRatio: patch.modulatorRatio,
    modulationIndex: patch.modulationIndex,
    feedback: patch.feedback,
    modulatorDecay: patch.modulatorDecay,
    carrierAttack: patch.carrierAttack,
    carrierRelease: patch.carrierRelease,
    pitchSweep: patch.pitchSweep,
    pitchDecay: patch.pitchDecay,
    reverbSend: Math.min(1, Math.max(0, patch.reverbSend ?? 0)),
    delaySend: Math.min(1, Math.max(0, patch.delaySend ?? 0)),
  };
}

export function noteTotalDuration(note) {
  return note.duration + note.carrierRelease;
}

export function notePanGains(note) {
  const position = Math.min(1, Math.max(-1, note.pan));
  const angle = (position + 1) * (FastMath.HalfPi * 0.5);
  return {
    left: FastMath.cos(angle) * FastMath.Root2,
    right: FastMath.sin(angle) * FastMath.Root2,
  };
}

export function noteCarrierLevel(note, time) {
  if (time < note.duration) return noteAttackLevel(note, time);
  const t = time - note.duration;
  if (t >= note.carrierRelease) return 0;
  return noteAttackLevel(note, note.duration) * FmCurve.fade(t / note.carrierRelease);
}

function noteAttackLevel(note, time) {
  return time < note.carrierAttack ? time / note.carrierAttack : 1;
}

export function noteModulatorLevel(note, time) {
  return time >= note.modulatorDecay ? 0 : FmCurve.fade(time / note.modulatorDecay);
}

export function notePitchScale(note, time) {
  return time >= note.pitchDecay
    ? 1
    : FastMath.pow2(note.pitchSweep * FmCurve.snap(time / note.pitchDecay));
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export class NoteTile {
  constructor(note = 60, length = 1) {
    this.kind = "note";
    this.note = note;
    this.length = length;
  }

  get hasDefaultLength() {
    return Math.abs(this.length - 1) < 1e-4;
  }

  get token() {
    return this.hasDefaultLength
      ? Pitch.toName(this.note)
      : Pitch.toName(this.note) + "/" + formatNum(this.length, 3);
  }
}

export class ParamTile {
  constructor(absolute) {
    this.kind = absolute ? "pabs" : "prel";
    this.absolute = absolute;
    this.engaged = new Array(ParamTargets.Count).fill(false);
    this.amounts = new Array(ParamTargets.Count).fill(0);
  }

  get token() {
    return this.absolute ? "PABS" : "PREL";
  }

  isEngaged(t) {
    return t >= 0 && t < ParamTargets.Count && this.engaged[t];
  }

  amount(t) {
    return this.isEngaged(t) ? this.amounts[t] : 0;
  }

  engage(t, amount) {
    if (t < 0 || t >= ParamTargets.Count) return;
    this.engaged[t] = true;
    this.amounts[t] = amount;
  }

  release(t) {
    if (t < 0 || t >= ParamTargets.Count) return;
    this.engaged[t] = false;
    this.amounts[t] = 0;
  }

  get isEmpty() {
    return !this.engaged.some(Boolean);
  }
}

export class CycleGateTile {
  constructor(period = 4, index = 1) {
    this.kind = "gcyc";
    this._period = 4;
    this._index = 1;
    this.period = period;
    this.index = index;
  }

  get period() {
    return this._period;
  }

  set period(v) {
    this._period = Math.min(8, Math.max(2, v | 0));
    this._index = Math.min(this._period, Math.max(1, this._index));
  }

  get index() {
    return this._index;
  }

  set index(v) {
    this._index = Math.min(this._period, Math.max(1, v | 0));
  }

  evaluate(pass) {
    return ((pass % this._period) + this._period) % this._period === this._index - 1;
  }

  get token() {
    return "GCYC" + this._period + ":" + this._index;
  }
}

export class ProbGateTile {
  constructor(percent = 50) {
    this.kind = "gprb";
    this._percent = 50;
    this.percent = percent;
  }

  get percent() {
    return this._percent;
  }

  set percent(v) {
    this._percent = Math.min(100, Math.max(0, v));
  }

  evaluate(_pass, random) {
    return random() * 100 < this._percent;
  }

  get token() {
    return "GPRB:" + formatNum(this._percent, 1);
  }
}

/**
 * Shorten a channel label for the 30px grid cell.
 * Kick1 → K1, HiHat → HH, BassDrum → BD, Lead → Ld
 */
export function abbreviateName(name, maxLetters = 2) {
  if (!name || !String(name).trim()) return "";
  const raw = String(name).trim();
  const m = raw.match(/^(.*?)(\d*)$/);
  const base = (m[1] || raw).replace(/[_\-]+/g, " ");
  const digits = m[2] || "";
  const parts = base
    .split(/\s+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .map((p) => p.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);
  let letters;
  if (parts.length >= 2) {
    letters = parts.map((p) => p[0]).join("");
  } else if (parts.length === 1) {
    const w = parts[0];
    // Single word + digits → first letter only (Kick1 → K1); else first two (Bass → Ba)
    letters = digits ? w[0] : w.slice(0, Math.min(2, w.length));
  } else {
    letters = raw.slice(0, 2);
  }
  letters = letters.toUpperCase().slice(0, maxLetters);
  const out = letters + digits;
  return out.slice(0, 4);
}

export class ChannelTile {
  static Divisions = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

  constructor(channel = 1, division = 16, label = "") {
    this.kind = "chan";
    this._channel = 1;
    this._division = 16;
    this.label = label || "";
    this.channel = channel;
    this.division = division;
  }

  /** Full display name; falls back to CH{n}. */
  get displayName() {
    return (this.label && this.label.trim()) || ("CH" + this._channel);
  }

  /** Grid cell abbreviation. */
  get shortName() {
    if (this.label && this.label.trim()) return abbreviateName(this.label);
    return "CH" + this._channel;
  }

  get channel() {
    return this._channel;
  }

  set channel(v) {
    this._channel = PatchBank.clamp(v);
  }

  get division() {
    return this._division;
  }

  set division(v) {
    let best = 16;
    for (const d of ChannelTile.Divisions) {
      if (Math.abs(d - v) < Math.abs(best - v)) best = d;
    }
    this._division = best;
  }

  stepSeconds(tempo) {
    return (60 / Math.max(tempo, 1)) * 4 / this._division;
  }

  get token() {
    return this.shortName;
  }
}

export class TerminatorTile {
  constructor() {
    this.kind = "term";
  }

  get token() {
    return "TERM";
  }
}

export class JumpTile {
  constructor() {
    this.kind = "jump";
  }

  get token() {
    return "JUMP";
  }
}

export class JumpDestTile {
  constructor() {
    this.kind = "jdst";
  }

  get token() {
    return "JDST";
  }
}

export const Terminator = new TerminatorTile();

// ---------------------------------------------------------------------------
// Grid / Lane / Score
// ---------------------------------------------------------------------------

export function gp(x, y) {
  return { x: x | 0, y: y | 0 };
}

export function gpEq(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

export function gpOffset(p, dx, dy) {
  return gp(p.x + dx, p.y + dy);
}

/** Toroidal wrap helpers (Pac-Man grid). */
export function wrapCoord(v, size) {
  const s = Math.max(2, size | 0);
  return ((v % s) + s) % s;
}

export function wrapPoint(p, gridW, gridH) {
  return gp(wrapCoord(p.x, gridW), wrapCoord(p.y, gridH));
}

export function toroidalDelta(from, to, gridW, gridH) {
  // Shortest signed delta on a torus.
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (dx > gridW / 2) dx -= gridW;
  if (dx < -gridW / 2) dx += gridW;
  if (dy > gridH / 2) dy -= gridH;
  if (dy < -gridH / 2) dy += gridH;
  return { dx, dy };
}

export class Step {
  constructor() {
    this.tiles = [];
  }

  get depth() {
    return this.tiles.length;
  }

  get isEmpty() {
    return this.tiles.length === 0;
  }

  at(depth) {
    return depth >= 0 && depth < this.tiles.length ? this.tiles[depth] : null;
  }
}

/**
 * A lane is a path of step cells plus start (repeat) and end (loop-back) markers.
 * X----Y with 4 dashes = 4 steps; start is before the first beat, end after the last.
 * When start and end occupy the same cell → circular tape-loop.
 */
export class Lane {
  constructor(x, y, head) {
    this.x = x; // first-step x (legacy + path origin)
    this.y = y;
    this.head = head;
    this.steps = [];
    /** @type {{x:number,y:number}[]} world positions of each step */
    this.path = [];
    this.circular = false;
    this.jumpSource = null;
    // Gray-out window: inactive prefix/suffix while reshaping (indices into path)
    this.activeFrom = 0;
    this.activeTo = null; // exclusive; null = steps.length
  }

  get channel() {
    return this.head instanceof ChannelTile ? this.head : null;
  }

  get isBranch() {
    return this.head instanceof JumpDestTile;
  }

  /** Ensure path[i] matches each step; default straight horizontal. */
  ensurePath() {
    if (this.path.length === this.steps.length && this.path.length > 0) return;
    if (this.path.length > this.steps.length) {
      this.path.length = this.steps.length;
    }
    while (this.path.length < this.steps.length) {
      const i = this.path.length;
      if (i === 0) this.path.push(gp(this.x, this.y));
      else {
        const prev = this.path[i - 1];
        this.path.push(gp(prev.x + 1, prev.y));
      }
    }
    if (this.steps.length) {
      this.x = this.path[0].x;
      this.y = this.path[0].y;
    }
    if (this.activeTo == null || this.activeTo > this.steps.length) {
      this.activeTo = this.steps.length;
    }
  }

  get activeStart() {
    return Math.max(0, Math.min(this.activeFrom | 0, Math.max(0, this.steps.length - 1)));
  }

  get activeEnd() {
    const end = this.activeTo == null ? this.steps.length : this.activeTo;
    return Math.max(this.activeStart + 1, Math.min(this.steps.length, end));
  }

  isStepActive(i) {
    return i >= this.activeStart && i < this.activeEnd;
  }

  get headX() {
    return this.headPoint.x;
  }

  get termX() {
    return this.termPoint.x;
  }

  /** Start marker — dal segno / return-to (before first active beat). */
  get headPoint() {
    this.ensurePath();
    if (!this.path.length) return gp(this.x - 1, this.y);
    const p0 = this.path[0];
    // Direction opposite the first edge (or left if single step)
    let dx = -1;
    let dy = 0;
    if (this.path.length > 1) {
      const p1 = this.path[1];
      dx = Math.sign(p0.x - p1.x) || (p0.y === p1.y ? -1 : 0);
      dy = Math.sign(p0.y - p1.y) || 0;
      if (dx === 0 && dy === 0) {
        dx = -1;
        dy = 0;
      }
    }
    // Circular: start/end share the joint cell before the first beat (not a step).
    return gp(p0.x + dx, p0.y + dy);
  }

  /** End marker — loop-back (after last active beat). Circular: same as head. */
  get termPoint() {
    this.ensurePath();
    if (!this.path.length) return gp(this.x, this.y);
    if (this.circular) return this.headPoint;
    const last = this.path[this.path.length - 1];
    if (this.path.length > 1) {
      const prev = this.path[this.path.length - 2];
      const dx = Math.sign(last.x - prev.x) || 1;
      const dy = Math.sign(last.y - prev.y) || 0;
      return gp(last.x + dx, last.y + dy);
    }
    return gp(last.x + 1, last.y);
  }

  cellPoint(step, depth) {
    this.ensurePath();
    if (step < 0 || step >= this.path.length) {
      return gp(this.x + step, this.y + depth);
    }
    const p = this.path[step];
    return gp(p.x, p.y + depth);
  }

  stepIndexAt(point) {
    this.ensurePath();
    for (let i = 0; i < this.path.length; i++) {
      if (this.path[i].x === point.x && this.path[i].y === point.y) return i;
    }
    return -1;
  }

  stepAt(index) {
    return index >= 0 && index < this.steps.length ? this.steps[index] : null;
  }

  addStep(atPoint = null) {
    const step = new Step();
    this.steps.push(step);
    this.ensurePath();
    if (atPoint) {
      this.path[this.path.length - 1] = gp(atPoint.x, atPoint.y);
      this.x = this.path[0].x;
      this.y = this.path[0].y;
    }
    this.activeTo = this.steps.length;
    return step;
  }

  /** Truncate to n steps (from the end). */
  setLength(n) {
    n = Math.max(1, n | 0);
    while (this.steps.length > n) {
      this.steps.pop();
      this.path.pop();
    }
    while (this.steps.length < n) this.addStep();
    this.activeFrom = 0;
    this.activeTo = this.steps.length;
    this.circular = false;
  }

  /** Shorten from the end to end at step index lastInclusive. */
  truncateEndTo(lastInclusive) {
    const n = Math.max(1, (lastInclusive | 0) + 1);
    this.setLength(n);
  }

  /** Shorten from the start — drop steps before firstInclusive. */
  truncateStartTo(firstInclusive) {
    this.ensurePath();
    const i = Math.max(0, Math.min(this.steps.length - 1, firstInclusive | 0));
    if (i === 0) return;
    this.steps.splice(0, i);
    this.path.splice(0, i);
    this.x = this.path[0].x;
    this.y = this.path[0].y;
    this.activeFrom = 0;
    this.activeTo = this.steps.length;
    this.circular = false;
  }

  *occupiedCells() {
    this.ensurePath();
    if (!this.circular) {
      yield this.headPoint;
      yield this.termPoint;
    } else {
      yield this.headPoint; // combined start/end
    }
    for (let i = 0; i < this.steps.length; i++) {
      yield this.path[i];
      for (let d = 1; d < this.steps[i].depth; d++) {
        yield this.cellPoint(i, d);
      }
    }
  }

  owns(point) {
    this.ensurePath();
    if (gpEq(point, this.headPoint) || gpEq(point, this.termPoint)) return true;
    for (let i = 0; i < this.path.length; i++) {
      if (this.path[i].x === point.x && this.path[i].y === point.y) return true;
      for (let d = 1; d < this.steps[i].depth; d++) {
        if (gpEq(point, this.cellPoint(i, d))) return true;
      }
    }
    return false;
  }

  isOnRail(point) {
    this.ensurePath();
    if (gpEq(point, this.headPoint) || gpEq(point, this.termPoint)) return true;
    return this.stepIndexAt(point) >= 0;
  }

  /** Sync legacy x,y from path[0]. */
  syncOrigin() {
    this.ensurePath();
    if (this.path.length) {
      this.x = this.path[0].x;
      this.y = this.path[0].y;
    }
  }
}

export const CellKind = {
  Empty: "empty",
  Rail: "rail",
  Head: "head",
  Term: "term",
  Tile: "tile",
};

export function emptyCell() {
  return { kind: CellKind.Empty, lane: null, step: 0, depth: 0, tile: null };
}

export class Score {
  constructor() {
    this.lanes = [];
    // Grid-native FX world (pedals, path sends, chains, automation).
    this.fxModules = [];
    this.pathRoutes = [];
    this.fxRoutes = [];
    this.autoNodes = [];
    // Torus size (Pac-Man). Min 2×2.
    this.gridW = 32;
    this.gridH = 16;
  }

  wrap(point) {
    return wrapPoint(point, this.gridW, this.gridH);
  }

  at(point) {
    point = this.wrap(point);
    for (const lane of this.lanes) {
      lane.ensurePath();
      if (gpEq(point, lane.headPoint)) {
        return {
          kind: lane.circular ? CellKind.Head : CellKind.Head,
          lane,
          step: -1,
          depth: 0,
          tile: lane.head,
          circular: lane.circular,
        };
      }
      if (!lane.circular && gpEq(point, lane.termPoint)) {
        return { kind: CellKind.Term, lane, step: lane.steps.length, depth: 0, tile: Terminator };
      }
      for (let i = 0; i < lane.path.length; i++) {
        const p = lane.path[i];
        if (p.x === point.x && p.y === point.y) {
          const tile = lane.steps[i].at(0);
          if (tile) return { kind: CellKind.Tile, lane, step: i, depth: 0, tile };
          return { kind: CellKind.Rail, lane, step: i, depth: 0, tile: null };
        }
        for (let d = 1; d < lane.steps[i].depth; d++) {
          const cp = lane.cellPoint(i, d);
          if (cp.x === point.x && cp.y === point.y) {
            const tile = lane.steps[i].at(d);
            if (tile) return { kind: CellKind.Tile, lane, step: i, depth: d, tile };
          }
        }
      }
    }
    return emptyCell();
  }

  isFree(point, except = null) {
    point = this.wrap(point);
    for (const lane of this.lanes) {
      if (lane !== except && lane.owns(point)) return false;
    }
    return true;
  }

  hasRoomToGrow(lane, toward = null) {
    lane.ensurePath();
    if (toward) return this.isFree(this.wrap(toward), lane);
    return this.isFree(lane.termPoint, lane);
  }

  locate(tile) {
    for (const lane of this.lanes) {
      if (lane.head === tile) return lane.headPoint;
      for (let i = 0; i < lane.steps.length; i++) {
        const depth = lane.steps[i].tiles.indexOf(tile);
        if (depth >= 0) return lane.cellPoint(i, depth);
      }
    }
    return null;
  }

  laneOf(tile) {
    for (const lane of this.lanes) {
      if (lane.head === tile) return lane;
      for (const step of lane.steps) {
        if (step.tiles.includes(tile)) return lane;
      }
    }
    return null;
  }

  channelOf(lane) {
    for (let guard = 0; lane && guard < 64; guard++) {
      if (lane.channel) return lane.channel.channel;
      if (!lane.jumpSource) break;
      lane = this.laneOf(lane.jumpSource);
    }
    return 1;
  }

  destinationOf(jump) {
    for (const lane of this.lanes) {
      if (lane.jumpSource === jump) return lane;
    }
    return null;
  }

  get channelLanes() {
    return this.lanes
      .filter((l) => l.channel)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  get width() {
    return this.gridW;
  }

  get height() {
    return this.gridH;
  }

  place(point, tile) {
    point = this.wrap(point);
    const placement = this.placementLane(point);
    if (!placement) return false;
    let { lane, step, depth } = placement;
    if (step === lane.steps.length) lane.addStep(point);
    const tiles = lane.steps[step].tiles;
    if (depth < tiles.length) tiles[depth] = tile;
    else tiles.push(tile);
    return true;
  }

  placementLane(point) {
    point = this.wrap(point);
    for (const lane of this.lanes) {
      lane.ensurePath();
      for (let i = 0; i < lane.path.length; i++) {
        const p = lane.path[i];
        if (p.x !== point.x) continue;
        const depth = point.y - p.y;
        if (depth < 0) continue;
        if (depth > lane.steps[i].depth) continue;
        if (depth === lane.steps[i].depth && !this.isFree(point, lane)) continue;
        return { lane, step: i, depth };
      }
      if (!lane.circular && gpEq(point, lane.termPoint)) {
        if (!this.isFree(point, lane)) continue;
        return { lane, step: lane.steps.length, depth: 0 };
      }
    }
    return null;
  }

  remove(point) {
    const cell = this.at(point);
    if (cell.kind !== CellKind.Tile) return false;
    if (cell.tile instanceof JumpTile) {
      const branch = this.destinationOf(cell.tile);
      if (branch) this.removeLane(branch, false);
    }
    cell.lane.steps[cell.step].tiles.splice(cell.depth, 1);
    return true;
  }

  sourceStep(source) {
    const step = source.lane?.stepAt(source.step);
    return step && step.at(source.depth) === source.tile ? step : null;
  }

  dropLane(point) {
    point = this.wrap(point);
    // Prefer exact step hits; allow drop on term to grow
    const place = this.placementLane(point);
    if (place) return place;
    for (const lane of this.lanes) {
      lane.ensurePath();
      for (let i = 0; i < lane.path.length; i++) {
        const p = lane.path[i];
        if (p.x === point.x && point.y >= p.y && point.y <= p.y + lane.steps[i].depth) {
          return { lane, step: i, depth: Math.min(lane.steps[i].depth, point.y - p.y) };
        }
      }
    }
    return null;
  }

  planMove(source, target) {
    if (source.kind !== CellKind.Tile) return null;
    const from = this.sourceStep(source);
    if (!from) return null;
    const drop = this.dropLane(target);
    if (!drop) return null;
    let { lane, step, depth } = drop;
    const tiles = from.tiles;
    const same = lane === source.lane && step === source.step;
    if (same && depth === source.depth) return null;
    const count = same ? 1 : tiles.length - source.depth;
    if (same) {
      depth = Math.min(depth, tiles.length - 1);
    } else {
      const grown = lane.stepAt(step)?.depth ?? 0;
      for (let i = 0; i < count; i++) {
        if (!this.isFree(lane.cellPoint(step, grown + i), lane)) return null;
      }
    }
    return { lane, step, depth, count };
  }

  applyMove(source, move) {
    if (!move) return false;
    const from = this.sourceStep(source);
    if (!from || source.depth + move.count > from.tiles.length) return false;
    const moved = from.tiles.splice(source.depth, move.count);
    if (move.step === move.lane.steps.length) move.lane.addStep();
    const into = move.lane.steps[move.step].tiles;
    into.splice(Math.min(move.depth, into.length), 0, ...moved);
    return true;
  }

  canMoveLane(lane, head) {
    if (!lane || !this.lanes.includes(lane)) return false;
    head = this.wrap(head);
    lane.ensurePath();
    const cur = lane.headPoint;
    const dx = head.x - cur.x;
    const dy = head.y - cur.y;
    // Use toroidal shortest delta for move test
    const d = toroidalDelta(cur, head, this.gridW, this.gridH);
    if (d.dx === 0 && d.dy === 0) return false;
    for (const cell of lane.occupiedCells()) {
      const np = this.wrap(gp(cell.x + d.dx, cell.y + d.dy));
      if (!this.isFree(np, lane)) return false;
    }
    return true;
  }

  moveLane(lane, head) {
    if (!this.canMoveLane(lane, head)) return false;
    lane.ensurePath();
    const d = toroidalDelta(lane.headPoint, this.wrap(head), this.gridW, this.gridH);
    for (let i = 0; i < lane.path.length; i++) {
      lane.path[i] = this.wrap(gp(lane.path[i].x + d.dx, lane.path[i].y + d.dy));
    }
    lane.syncOrigin();
    return true;
  }

  addLane(x, y, head, steps) {
    x = wrapCoord(x, this.gridW);
    y = wrapCoord(y, this.gridH);
    const lane = new Lane(x, y, head);
    for (let i = 0; i < steps; i++) lane.addStep();
    lane.ensurePath();
    this.lanes.push(lane);
    return lane;
  }

  /**
   * Drag end handle to a cell: shorten (if on existing path) or extend
   * following free cells. Stacking on start → circular tape loop.
   */
  reshapeLaneEnd(lane, target) {
    if (!lane) return false;
    target = this.wrap(target);
    lane.ensurePath();

    // Circular: drop end on start marker
    if (gpEq(target, lane.headPoint) && lane.steps.length >= 1) {
      lane.circular = true;
      return true;
    }

    // Hit an existing path step → truncate there
    const hit = lane.stepIndexAt(target);
    if (hit >= 0) {
      lane.circular = false;
      lane.truncateEndTo(hit);
      return true;
    }

    // Adjacent grow from last step (or from current term if free trail)
    const last = lane.path[lane.path.length - 1];
    const d = toroidalDelta(last, target, this.gridW, this.gridH);
    // Walk Manhattan path from last toward target, appending free cells
    let cx = last.x;
    let cy = last.y;
    let guard = 0;
    const maxSteps = this.gridW * this.gridH;
    while ((cx !== target.x || cy !== target.y) && guard++ < maxSteps) {
      const td = toroidalDelta(gp(cx, cy), target, this.gridW, this.gridH);
      if (Math.abs(td.dx) >= Math.abs(td.dy) && td.dx !== 0) {
        cx = wrapCoord(cx + Math.sign(td.dx), this.gridW);
      } else if (td.dy !== 0) {
        cy = wrapCoord(cy + Math.sign(td.dy), this.gridH);
      } else break;
      const np = gp(cx, cy);
      if (gpEq(np, lane.headPoint) && lane.steps.length >= 1) {
        lane.circular = true;
        return true;
      }
      if (!this.isFree(np, lane) && lane.stepIndexAt(np) < 0) return true; // stop cleanly
      if (lane.stepIndexAt(np) >= 0) {
        lane.truncateEndTo(lane.stepIndexAt(np));
        return true;
      }
      lane.addStep(np);
      lane.circular = false;
    }
    return true;
  }

  /**
   * Drag start handle: shorten from front, or move start (reshape).
   * Stacking on end → circular.
   */
  reshapeLaneStart(lane, target) {
    if (!lane) return false;
    target = this.wrap(target);
    lane.ensurePath();

    if (gpEq(target, lane.termPoint) && !lane.circular && lane.steps.length >= 1) {
      lane.circular = true;
      return true;
    }

    const hit = lane.stepIndexAt(target);
    if (hit >= 0) {
      lane.circular = false;
      lane.truncateStartTo(hit);
      return true;
    }

    // Grow/prepend backward from first step toward target
    const first = lane.path[0];
    let cx = first.x;
    let cy = first.y;
    let guard = 0;
    const maxSteps = this.gridW * this.gridH;
    const newCells = [];
    while ((cx !== target.x || cy !== target.y) && guard++ < maxSteps) {
      const td = toroidalDelta(gp(cx, cy), target, this.gridW, this.gridH);
      // step toward target
      if (Math.abs(td.dx) >= Math.abs(td.dy) && td.dx !== 0) {
        cx = wrapCoord(cx + Math.sign(td.dx), this.gridW);
      } else if (td.dy !== 0) {
        cy = wrapCoord(cy + Math.sign(td.dy), this.gridH);
      } else break;
      const np = gp(cx, cy);
      if (gpEq(np, lane.termPoint)) {
        lane.circular = true;
        return true;
      }
      if (!this.isFree(np, lane) && lane.stepIndexAt(np) < 0) break;
      if (lane.stepIndexAt(np) >= 0) {
        lane.truncateStartTo(lane.stepIndexAt(np));
        return true;
      }
      newCells.push(np);
    }
    // Prepend path cells (reverse order of walk = order from new start to old first)
    if (newCells.length) {
      // walk went from first toward target, so newCells[0] is next to first...
      // actually we want cells from target back to first
      newCells.reverse();
      for (const c of newCells) {
        const step = new Step();
        lane.steps.unshift(step);
        lane.path.unshift(c);
      }
      lane.syncOrigin();
      lane.circular = false;
      lane.activeFrom = 0;
      lane.activeTo = lane.steps.length;
    }
    return true;
  }

  addBranchLane(jump, near, steps) {
    const point = this.findFreeRow(near, steps);
    const lane = this.addLane(point.x, point.y, new JumpDestTile(), steps);
    lane.jumpSource = jump;
    return lane;
  }

  removeLane(lane, removeJumpSource = true) {
    const idx = this.lanes.indexOf(lane);
    if (idx < 0) return;
    this.lanes.splice(idx, 1);
    if (removeJumpSource && lane.jumpSource) {
      const point = this.locate(lane.jumpSource);
      if (point) {
        const cell = this.at(point);
        if (cell.kind === CellKind.Tile) {
          cell.lane.steps[cell.step].tiles.splice(cell.depth, 1);
        }
      }
    }
    for (const step of lane.steps) {
      for (const tile of [...step.tiles]) {
        if (tile instanceof JumpTile) {
          const branch = this.destinationOf(tile);
          if (branch) this.removeLane(branch, false);
        }
      }
    }
  }

  findFreeRow(hint, steps) {
    const x = Math.max(1, hint.x);
    for (let y = Math.max(1, hint.y); y < hint.y + 256; y++) {
      let free = true;
      for (let i = -1; i <= steps + 1 && free; i++) {
        for (let dy = -1; dy <= 0 && free; dy++) {
          free = this.isFree(gp(x - 1 + i, y + dy));
        }
      }
      if (free) return gp(x, y);
    }
    return gp(x, hint.y);
  }
}

function bottomOf(lane) {
  let depth = 1;
  for (const step of lane.steps) depth = Math.max(depth, step.depth);
  return lane.y + depth;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export class Project {
  constructor() {
    this.tempo = 132;
    this.beatsPerBar = 4;
    this.beatUnit = 4;
    this.fx = defaultSendFx();
    this.score = new Score();
    this.patches = PatchBank.create();
    this.title = "";
    this.haiku = ""; // three lines separated by " / "
    // Torus defaults (customizable, min 2×2)
    this.gridW = 32;
    this.gridH = 16;
  }

  syncGrid() {
    this.gridW = Math.max(2, this.gridW | 0);
    this.gridH = Math.max(2, this.gridH | 0);
    this.score.gridW = this.gridW;
    this.score.gridH = this.gridH;
  }

  static createEmpty() {
    const project = new Project();
    project.score.addLane(1, 1, new ChannelTile(), 16);
    return project;
  }

  static createSample() {
    const project = new Project();
    const score = project.score;

    const accent = score.addLane(1, 1, new ChannelTile(1), 4);
    fill(accent, 0, lock(new ParamTile(false), ParamTargets.Level, 0.2));
    fill(accent, 2, lock(new ParamTile(false), ParamTargets.Level, -0.35));

    const main = score.addLane(1, 3, new ChannelTile(1), 16);
    fill(main, 0, new NoteTile(n("C4"), 4), new NoteTile(n("E4")), new NoteTile(n("G4")));
    fill(main, 2, new NoteTile(n("F#4"), 0.5));
    fill(main, 3, lock(new ParamTile(true), ParamTargets.ModIndex, 7), new NoteTile(n("A4")));
    fill(main, 5, new NoteTile(n("G4")));
    fill(
      main, 8,
      new CycleGateTile(4, 3),
      new NoteTile(n("F4")),
      lock(new ParamTile(false), ParamTargets.ModIndex, 3),
      new NoteTile(n("G#4"), 1.5),
      new NoteTile(n("C5")),
    );

    const jump = new JumpTile();
    fill(main, 9, new CycleGateTile(4, 4), jump);
    fill(main, 10, new NoteTile(n("A#4")));
    fill(main, 11, new ProbGateTile(35), new NoteTile(n("B4")), new NoteTile(n("D5")));
    fill(main, 13, lock(new ParamTile(false), ParamTargets.ModDecay, 0.5), new NoteTile(n("E5"), 2));

    const variation = score.addLane(6, 9, new JumpDestTile(), 6);
    variation.jumpSource = jump;
    fill(variation, 0, new NoteTile(n("D#5")), new NoteTile(n("C5")), new NoteTile(n("G#4")));
    fill(variation, 2, new NoteTile(n("A#4"), 0.5));
    fill(variation, 3, new ProbGateTile(70), new NoteTile(n("G4")));
    fill(variation, 4, new NoteTile(n("F4")));

    return project;
  }
}

function fill(lane, step, ...tiles) {
  lane.steps[step].tiles.push(...tiles);
}

function lock(tile, target, amount) {
  tile.engage(target, amount);
  return tile;
}

function n(name) {
  return Pitch.tryParse(name) ?? 60;
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const ProjectFormat = {
  // v11: freeform lane paths, circular loops, torus grid size.
  Version: 11,
  Extension: ".jacquard",

  write(project) {
    const lines = [];
    project.syncGrid?.();
    lines.push("jacquard " + this.Version);
    lines.push("tempo " + F(project.tempo));
    lines.push("meter " + project.beatsPerBar + " " + project.beatUnit);
    lines.push("grid " + (project.gridW || 32) + " " + (project.gridH || 16));
    if (project.title) {
      lines.push("meta title " + String(project.title).replace(/\s+/g, " ").trim());
    }
    if (project.haiku) {
      lines.push("meta haiku " + String(project.haiku).replace(/\s+/g, " ").trim());
    }
    lines.push("fx " + writeFx(project.fx));
    for (let ch = 1; ch <= PatchBank.Channels; ch++) {
      lines.push("patch " + ch + " " + writePatch(PatchBank.get(project.patches, ch)));
    }
    for (const lane of project.score.lanes) {
      writeLane(lines, project.score, lane);
    }
    writeFxWorld(lines, project.score);
    return lines.join("\n") + "\n";
  },

  read(text) {
    const project = new Project();
    project.syncGrid();
    const score = project.score;
    let lane = null;
    const links = [];
    const lines = text.split("\n");

    for (let number = 0; number < lines.length; number++) {
      const tokens = lines[number].trim().split(/[ \t\r]+/).filter(Boolean);
      if (!tokens.length || tokens[0].startsWith("#")) continue;

      switch (tokens[0]) {
        case "jacquard":
          if (tokens[1] && readInt(tokens[1]) > this.Version) {
            throw fail(number, "file is from a newer version");
          }
          break;
        case "tempo":
          project.tempo = readFloat(arg(tokens, 1, number));
          break;
        case "meter":
          project.beatsPerBar = readInt(arg(tokens, 1, number));
          project.beatUnit = readInt(arg(tokens, 2, number));
          break;
        case "grid":
          project.gridW = Math.max(2, readInt(arg(tokens, 1, number)));
          project.gridH = Math.max(2, readInt(arg(tokens, 2, number)));
          project.syncGrid();
          break;
        case "meta": {
          const key = arg(tokens, 1, number);
          const rest = tokens.slice(2).join(" ");
          if (key === "title") project.title = rest;
          else if (key === "haiku") project.haiku = rest;
          break;
        }
        case "fx":
          readFx(project.fx, tokens);
          break;
        case "patch":
          readPatchLine(project, tokens);
          break;
        case "lane":
          lane = readLane(score, tokens, number, links);
          break;
        case "step":
          if (!lane) throw fail(number, "step outside a lane");
          readStep(lane.addStep(), tokens, number);
          break;
        case "fxmod":
          readFxMod(score, tokens, number);
          break;
        case "pathroute":
          readPathRoute(score, tokens, number);
          break;
        case "fxroute":
          readFxRoute(score, tokens, number);
          break;
        case "auto":
          readAutoNode(score, tokens, number);
          break;
        default:
          throw fail(number, "unknown keyword " + tokens[0]);
      }
    }

    for (const { branch, point } of links) {
      const tile = score.at(point).tile;
      if (tile instanceof JumpTile) branch.jumpSource = tile;
    }

    project.syncGrid();
    for (const lane of score.lanes) {
      // Align path length to steps after all steps are read.
      if (lane.path.length !== lane.steps.length) {
        const saved = lane.path.slice();
        lane.path = [];
        lane.ensurePath();
        for (let i = 0; i < Math.min(saved.length, lane.path.length); i++) {
          lane.path[i] = saved[i];
        }
        lane.syncOrigin();
      } else {
        lane.ensurePath();
      }
    }

    return project;
  },
};

function writeLane(lines, score, lane) {
  let head;
  lane.ensurePath();
  if (lane.channel) {
    head = "CHAN:" + lane.channel.channel + " div=" + lane.channel.division;
    if (lane.channel.label) {
      head += " name=" + encodeLaneName(lane.channel.label);
    }
  } else {
    head = "JDST";
    if (lane.jumpSource) {
      const source = score.locate(lane.jumpSource);
      if (source) head += " from=" + source.x + "," + source.y;
    }
  }
  if (lane.circular) head += " circular=1";
  if (lane.path.length) {
    head += " path=" + lane.path.map((p) => p.x + "," + p.y).join(";");
  }
  lines.push("lane " + lane.x + " " + lane.y + " " + head);
  for (const step of lane.steps) {
    let line = "  step";
    for (const tile of step.tiles) line += " " + writeTile(tile);
    lines.push(line);
  }
}

function writeTile(tile) {
  if (tile instanceof NoteTile) {
    return tile.hasDefaultLength
      ? Pitch.toName(tile.note)
      : Pitch.toName(tile.note) + "/" + F(tile.length);
  }
  if (tile instanceof ParamTile) return (tile.absolute ? "PABS" : "PREL") + writeLock(tile);
  if (tile instanceof CycleGateTile) return "GCYC:" + tile.period + "," + tile.index;
  if (tile instanceof ProbGateTile) return "GPRB:" + F(tile.percent);
  if (tile instanceof JumpTile) return "JUMP";
  return tile.token;
}

function writeLock(tile) {
  let text = "";
  for (let t = 0; t < ParamTargets.Count; t++) {
    if (!tile.isEngaged(t)) continue;
    text += (text ? "," : ":") + ParamTargets.key(t) + "," + F(tile.amount(t));
  }
  return text;
}

function writePatch(p) {
  const inst = p.instrument | 0;
  const names = ["fm", "kick", "snare", "hat", "bass", "pad", "bell", "pluck"];
  return "instrument=" + (names[inst] || "fm") +
    " level=" + F(p.level) +
    " pan=" + F(p.pan) +
    " gate=" + F(p.gateScale) +
    " mratio=" + F(p.modulatorRatio) +
    " index=" + F(p.modulationIndex) +
    " fb=" + F(p.feedback) +
    " md=" + F(p.modulatorDecay) +
    " ca=" + F(p.carrierAttack) +
    " cr=" + F(p.carrierRelease) +
    " ps=" + F(p.pitchSweep) +
    " pd=" + F(p.pitchDecay) +
    " rsend=" + F(p.reverbSend) +
    " dsend=" + F(p.delaySend);
}

function writeFx(fx) {
  return "rsize=" + F(fx.reverbSize) +
    " rdamp=" + F(fx.reverbDamp) +
    " rwidth=" + F(fx.reverbWidth) +
    " dbeats=" + F(fx.delayBeats) +
    " dfb=" + F(fx.delayFeedback) +
    " dtone=" + F(fx.delayTone) +
    " dspread=" + F(fx.delaySpread);
}

function writeFxWorld(lines, score) {
  for (const m of score.fxModules || []) {
    let s = "fxmod " + m.type + " " + m.x + " " + m.y + " id=" + m.id;
    for (const [k, v] of Object.entries(m.params || {})) s += " " + k + "=" + F(v);
    lines.push(s);
  }
  for (const r of score.pathRoutes || []) {
    lines.push(
      "pathroute lane=" + r.laneIndex +
      " from=" + r.fromStep +
      " to=" + r.toStep +
      " target=" + r.targetFxId +
      " amount=" + F(r.amount) +
      " id=" + r.id,
    );
  }
  for (const r of score.fxRoutes || []) {
    lines.push(
      "fxroute from=" + r.fromFxId +
      " to=" + r.toFxId +
      " amount=" + F(r.amount) +
      " id=" + r.id,
    );
  }
  for (const a of score.autoNodes || []) {
    lines.push(
      "auto " + a.x + " " + a.y +
      " target=" + a.targetFxId +
      " param=" + a.paramKey +
      " value=" + F(a.value) +
      " id=" + a.id,
    );
  }
}

function readFxMod(score, tokens, number) {
  const type = arg(tokens, 1, number);
  const x = readInt(arg(tokens, 2, number));
  const y = readInt(arg(tokens, 3, number));
  let id = null;
  const params = {};
  for (let i = 4; i < tokens.length; i++) {
    const [k, v] = split(tokens[i]);
    if (k === "id") id = v;
    else params[k] = readFloat(v);
  }
  if (!score.fxModules) score.fxModules = [];
  const isPat = type === "pat+" || type === "pat-" || type === "patgo" || type === "pan";
  const isTall = type === "delay" || type === "reverb";
  score.fxModules.push({
    id: id || ("fx-" + score.fxModules.length),
    type,
    x,
    y,
    w: isPat || type === "pan" ? 2 : 3,
    h: isTall ? 3 : 2,
    params: Object.keys(params).length
      ? params
      : (type.startsWith("pat") ? (type === "patgo" ? { n: 0 } : {}) : { mix: 0.35 }),
  });
}

function readPathRoute(score, tokens) {
  const r = {
    id: "pr",
    laneIndex: 0,
    fromStep: 0,
    toStep: 4,
    targetFxId: "",
    amount: 0.5,
  };
  for (let i = 1; i < tokens.length; i++) {
    const [k, v] = split(tokens[i]);
    if (k === "lane") r.laneIndex = readInt(v);
    else if (k === "from") r.fromStep = readInt(v);
    else if (k === "to") r.toStep = readInt(v);
    else if (k === "target") r.targetFxId = v;
    else if (k === "amount") r.amount = readFloat(v);
    else if (k === "id") r.id = v;
  }
  if (!score.pathRoutes) score.pathRoutes = [];
  score.pathRoutes.push(r);
}

function readFxRoute(score, tokens) {
  const r = { id: "fr", fromFxId: "", toFxId: "", amount: 1 };
  for (let i = 1; i < tokens.length; i++) {
    const [k, v] = split(tokens[i]);
    if (k === "from") r.fromFxId = v;
    else if (k === "to") r.toFxId = v;
    else if (k === "amount") r.amount = readFloat(v);
    else if (k === "id") r.id = v;
  }
  if (!score.fxRoutes) score.fxRoutes = [];
  score.fxRoutes.push(r);
}

function readAutoNode(score, tokens, number) {
  const a = {
    id: "au",
    x: readInt(arg(tokens, 1, number)),
    y: readInt(arg(tokens, 2, number)),
    targetFxId: "",
    paramKey: "mix",
    value: 0,
  };
  for (let i = 3; i < tokens.length; i++) {
    const [k, v] = split(tokens[i]);
    if (k === "target") a.targetFxId = v;
    else if (k === "param") a.paramKey = v;
    else if (k === "value") a.value = readFloat(v);
    else if (k === "id") a.id = v;
  }
  if (!score.autoNodes) score.autoNodes = [];
  score.autoNodes.push(a);
}

function readLane(score, tokens, number, links) {
  const x = readInt(arg(tokens, 1, number));
  const y = readInt(arg(tokens, 2, number));
  const head = arg(tokens, 3, number);
  let tile;
  if (head.startsWith("CHAN")) {
    const channel = new ChannelTile();
    const colon = head.indexOf(":");
    if (colon >= 0) channel.channel = readInt(head.slice(colon + 1));
    tile = channel;
  } else if (head === "JDST") {
    tile = new JumpDestTile();
  } else {
    throw fail(number, "a lane head must be CHAN or JDST");
  }
  const lane = score.addLane(x, y, tile, 0);
  for (let i = 4; i < tokens.length; i++) {
    const [key, value] = split(tokens[i]);
    if (key === "div" && tile instanceof ChannelTile) tile.division = readInt(value);
    else if (key === "name" && tile instanceof ChannelTile) tile.label = decodeLaneName(value);
    else if (key === "from") links.push({ branch: lane, point: readPoint(value, number) });
    else if (key === "circular") lane.circular = value === "1" || value === "true";
    else if (key === "path") {
      lane.path = value.split(";").filter(Boolean).map((pair) => {
        const [px, py] = pair.split(",");
        return gp(readInt(px), readInt(py));
      });
    }
  }
  return lane;
}

function encodeLaneName(name) {
  return String(name).trim().replace(/\s+/g, "_");
}

function decodeLaneName(value) {
  return String(value || "").replace(/_/g, " ");
}

function readStep(step, tokens, number) {
  for (let i = 1; i < tokens.length; i++) {
    const tile = readTile(tokens[i], number);
    if (tile) step.tiles.push(tile);
  }
}

const Retired = ["detune", "cardecay", "carsustain"];

function readTile(token, number) {
  const colon = token.indexOf(":");
  const head = colon < 0 ? token : token.slice(0, colon);
  const args = colon < 0 ? "" : token.slice(colon + 1);

  switch (head) {
    case "PABS":
      return readLock(new ParamTile(true), args, number);
    case "PREL":
    case "PACC":
      return readLock(new ParamTile(false), args, number);
    case "GCYC": {
      const parts = args.split(",");
      const gate = new CycleGateTile();
      if (parts[0]) gate.period = readInt(parts[0]);
      if (parts[1]) gate.index = readInt(parts[1]);
      return gate;
    }
    case "GPRB":
      return new ProbGateTile(readFloat(args));
    case "JUMP":
      return new JumpTile();
  }

  const slash = token.indexOf("/");
  const name = slash < 0 ? token : token.slice(0, slash);
  const note = Pitch.tryParse(name);
  if (note == null) throw fail(number, "cannot read the tile " + token);
  return new NoteTile(note, slash < 0 ? 1 : readFloat(token.slice(slash + 1)));
}

function readLock(tile, args, number) {
  if (!args) return tile;
  const parts = args.split(",");
  for (let i = 0; i < parts.length; i += 2) {
    const target = ParamTargets.parse(parts[i]);
    if (target < 0) {
      if (!Retired.includes(parts[i])) throw fail(number, "unknown lock target " + parts[i]);
      continue;
    }
    tile.engage(target, i + 1 < parts.length ? readFloat(parts[i + 1]) : 0);
  }
  return tile.isEmpty ? null : tile;
}

function readPatchLine(project, tokens) {
  if (tokens.length > 1 && tokens[1].indexOf("=") < 0) {
    const channel = PatchBank.clamp(readInt(tokens[1]));
    readPatch(PatchBank.get(project.patches, channel), tokens, 2);
    return;
  }
  for (let ch = 1; ch <= PatchBank.Channels; ch++) {
    readPatch(PatchBank.get(project.patches, ch), tokens, 1);
  }
}

function readPatch(patch, tokens, from) {
  for (let i = from; i < tokens.length; i++) {
    const [key, text] = split(tokens[i]);
    if (key === "instrument") {
      const names = ["fm", "kick", "snare", "hat", "bass", "pad", "bell", "pluck"];
      const idx = names.indexOf(String(text).toLowerCase());
      patch.instrument = idx >= 0 ? idx : (readInt(text) || 0);
      continue;
    }
    const value = readFloat(text);
    switch (key) {
      case "level": patch.level = value; break;
      case "pan": patch.pan = value; break;
      case "gate": patch.gateScale = value; break;
      case "mratio": patch.modulatorRatio = value; break;
      case "index": patch.modulationIndex = value; break;
      case "fb": patch.feedback = value; break;
      case "md": patch.modulatorDecay = value; break;
      case "ca": patch.carrierAttack = value; break;
      case "cr": patch.carrierRelease = value; break;
      case "ps": patch.pitchSweep = value; break;
      case "pd": patch.pitchDecay = value; break;
      case "rsend": patch.reverbSend = value; break;
      case "dsend": patch.delaySend = value; break;
    }
  }
}

function readFx(fx, tokens) {
  for (let i = 1; i < tokens.length; i++) {
    const [key, text] = split(tokens[i]);
    const value = readFloat(text);
    switch (key) {
      case "rsize": fx.reverbSize = value; break;
      case "rdamp": fx.reverbDamp = value; break;
      case "rwidth": fx.reverbWidth = value; break;
      case "dbeats": fx.delayBeats = value; break;
      case "dfb": fx.delayFeedback = value; break;
      case "dtone": fx.delayTone = value; break;
      case "dspread": fx.delaySpread = value; break;
    }
  }
}

function split(token) {
  const eq = token.indexOf("=");
  return eq < 0 ? [token, ""] : [token.slice(0, eq), token.slice(eq + 1)];
}

function arg(tokens, index, number) {
  if (index < tokens.length) return tokens[index];
  throw fail(number, "missing argument");
}

function readPoint(text, number) {
  const parts = text.split(",");
  if (parts.length !== 2) throw fail(number, "expected x,y");
  return gp(readInt(parts[0]), readInt(parts[1]));
}

function readInt(text) {
  const v = parseInt(text, 10);
  return Number.isNaN(v) ? 0 : v;
}

function readFloat(text) {
  const v = parseFloat(text);
  return Number.isNaN(v) ? 0 : v;
}

function fail(line, message) {
  return new Error("line " + (line + 1) + ": " + message);
}

function F(value) {
  return formatNum(value, 5);
}

function formatNum(value, maxFrac) {
  if (Object.is(value, -0)) value = 0;
  let s = value.toFixed(maxFrac);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s || "0";
}

// ---------------------------------------------------------------------------
// Sequencer
// ---------------------------------------------------------------------------

export class Runner {
  constructor(origin, order, startSample) {
    this.originLane = origin;
    this.order = order;
    this.lane = origin;
    this.stepIndex = 0;
    this.pass = 0;
    this.nextSample = startSample;
    this.playingLane = null;
    this.playingStep = -1;
    this._scheduled = [];
  }

  get channel() {
    return this.originLane.channel?.channel ?? 1;
  }

  stepSeconds(tempo) {
    return this.originLane.channel?.stepSeconds(tempo) ?? 0.125;
  }

  record(sample, lane, step) {
    this._scheduled.push({ sample, lane, step });
  }

  advancePlayhead(currentSample) {
    while (this._scheduled.length && this._scheduled[0].sample <= currentSample) {
      const marker = this._scheduled.shift();
      this.playingLane = marker.lane;
      this.playingStep = marker.step;
    }
  }

  clearPlayhead() {
    this._scheduled.length = 0;
    this.playingLane = null;
    this.playingStep = -1;
  }
}

export class Sequencer {
  constructor() {
    this.project = null;
    this._playing = false;
    this._runners = [];
    this._previous = [];
    this._slice = [];
    this._working = PatchBank.create();
    this._random = Math.random;
  }

  get isPlaying() {
    return this._playing;
  }

  get runners() {
    return this._runners;
  }

  play(currentSample, lookaheadSamples) {
    this.stop();
    const start = currentSample + lookaheadSamples;
    let order = 0;
    for (const lane of this.project.score.channelLanes) {
      this._runners.push(new Runner(lane, order++, start));
    }
    this._playing = this._runners.length > 0;
  }

  /**
   * Phase-align runners to a continuous song clock so pattern switches
   * never restart time — only remap step positions onto the same sample timeline.
   *
   * songOriginSample: sample when transport first started (monotonic anchor).
   * currentSample: now.
   */
  playAligned(currentSample, lookaheadSamples, songOriginSample, sampleRate) {
    this._playing = false;
    for (const r of this._runners) r.clearPlayhead();
    this._runners.length = 0;

    const origin = songOriginSample;
    const now = currentSample;
    let order = 0;

    for (const lane of this.project.score.channelLanes) {
      const stepSamples = Math.max(
        1,
        lane.channel.stepSeconds(this.project.tempo) * sampleRate,
      );
      const n = Math.max(1, lane.steps.length);
      // How many complete steps have elapsed since song origin.
      const elapsed = Math.max(0, now - origin);
      const totalSteps = Math.floor(elapsed / stepSamples);
      const stepIndex = ((totalSteps % n) + n) % n;
      const pass = Math.floor(totalSteps / n);
      // Next boundary on the global grid — never behind "now".
      let next = origin + (totalSteps + 1) * stepSamples;
      if (next < now + 1) next = now + stepSamples;

      const runner = new Runner(lane, order++, next);
      runner.stepIndex = stepIndex;
      runner.pass = pass;
      runner.lane = lane;
      // Playhead shows the step currently sounding (the one we are in).
      runner.playingLane = lane;
      runner.playingStep = stepIndex;
      this._runners.push(runner);
    }

    this._playing = this._runners.length > 0;
  }

  stop() {
    this._playing = false;
    for (const r of this._runners) r.clearPlayhead();
    this._runners.length = 0;
  }

  resync() {
    if (!this._playing) return;
    this._previous = this._runners.slice();
    this._runners.length = 0;
    let order = 0;
    for (const lane of this.project.score.channelLanes) {
      let runner = this._previous.find((r) => r.originLane === lane);
      if (!runner) {
        const start = this._previous.length ? this._previous[0].nextSample : 0;
        runner = new Runner(lane, order, start);
      }
      if (!this.project.score.lanes.includes(runner.lane)) runner.lane = lane;
      if (runner.stepIndex >= runner.lane.steps.length) runner.stepIndex = 0;
      runner.order = order++;
      this._runners.push(runner);
    }
    this._playing = this._runners.length > 0;
  }

  schedule(currentSample, lookaheadSamples, sampleRate, output) {
    for (const runner of this._runners) runner.advancePlayhead(currentSample);
    if (!this._playing) return;
    const horizon = currentSample + lookaheadSamples;
    for (let guard = 0; guard < 1024; guard++) {
      let next = Infinity;
      for (const runner of this._runners) {
        if (runner.nextSample < next) next = runner.nextSample;
      }
      if (next >= horizon) break;
      this.runSlice(next, sampleRate, output);
    }
  }

  runSlice(time, sampleRate, output) {
    const startSample = Math.floor(time);
    this._slice.length = 0;
    for (const runner of this._runners) {
      if (runner.nextSample < time + 0.5) this._slice.push(runner);
    }
    this._slice.sort((a, b) => a.order - b.order);

    for (let ch = 1; ch <= PatchBank.Channels; ch++) {
      this._working[ch - 1] = clonePatch(PatchBank.get(this.project.patches, ch));
    }

    for (const runner of this._slice) {
      this.execute(runner, startSample, sampleRate, output);
    }
  }

  execute(runner, startSample, sampleRate, output) {
    const stepSeconds = runner.stepSeconds(this.project.tempo);
    const lane = runner.lane;
    const step = lane.stepAt(runner.stepIndex);
    runner.record(startSample, lane, runner.stepIndex);
    const destination = step
      ? this.descend(step, runner, startSample, stepSeconds, output)
      : null;
    if (destination) {
      runner.lane = destination;
      runner.stepIndex = 0;
    } else {
      this.advance(runner);
    }
    runner.nextSample += stepSeconds * sampleRate;
  }

  descend(step, runner, startSample, stepSeconds, output) {
    const channel = runner.channel;
    let destination = null;
    for (const tile of step.tiles) {
      if ((tile instanceof CycleGateTile || tile instanceof ProbGateTile) &&
          !tile.evaluate(runner.pass, this._random)) {
        break;
      }
      if (tile instanceof ParamTile) {
        this.apply(tile, channel);
      } else if (tile instanceof NoteTile) {
        output.push(noteEventFromPatch(
          this._working[channel - 1],
          tile.note,
          tile.length * stepSeconds,
          startSample,
          channel,
        ));
      } else if (tile instanceof JumpTile) {
        const branch = this.project.score.destinationOf(tile);
        if (branch && branch.steps.length > 0) destination = branch;
      }
    }
    return destination;
  }

  advance(runner) {
    runner.stepIndex++;
    if (runner.stepIndex < runner.lane.steps.length) return;
    runner.lane = runner.originLane;
    runner.stepIndex = 0;
    runner.pass++;
  }

  apply(param, channel) {
    const patch = this._working[channel - 1];
    for (let t = 0; t < ParamTargets.Count; t++) {
      if (!param.isEngaged(t)) continue;
      if (param.absolute) ParamTargets.set(patch, t, param.amount(t));
      else ParamTargets.add(patch, t, param.amount(t));
    }
  }
}
