// Grid instrument objects — pedals like FX inserts, many lanes → one instrument.
// Association: each lane's end/repeat (term) binds to the nearest instrument
// measured by Manhattan distance to the instrument's left-corner cell (x, y).
// Visual: underlight the NESW staircase of grid cells from term → corner.

import { ParamTargets, PatchBank } from "./core.js";
import {
  InstrumentKeys,
  InstrumentNames,
  InstrumentCatalog,
  parseInstrument,
  instrumentKey,
  catalogEntry,
  patchFor,
  isDrumRole,
} from "./instruments.js";
import { newFxId, fxOccupies, findFxAt } from "./fx-model.js";
export { isDrumRole } from "./instruments.js";

/**
 * All instrument params (paginated on the pedal: 3 bars + page dots).
 * Labels ~12–18 chars (readable on the 4-cell-wide pedal; value on the right).
 */
export const InstParamBars = [
  { key: "level", label: "Output Level", target: ParamTargets.Level, min: 0, max: 1, def: 0.45 },
  { key: "pan", label: "Stereo Pan", target: ParamTargets.Pan, min: -1, max: 1, def: 0 },
  { key: "index", label: "Modulation Index", target: ParamTargets.ModIndex, min: 0, max: 8, def: 1.0 },
  { key: "moddecay", label: "Modulator Decay", target: ParamTargets.ModDecay, min: 0.01, max: 2, def: 0.18 },
  { key: "ratio", label: "Modulator Ratio", target: ParamTargets.ModRatio, min: 0.25, max: 8, def: 2 },
  { key: "feedback", label: "Operator Feedback", target: ParamTargets.Feedback, min: 0, max: 4, def: 0.15 },
  { key: "carattack", label: "Carrier Attack", target: ParamTargets.CarAttack, min: 0.001, max: 1, def: 0.005 },
  { key: "carrelease", label: "Carrier Release", target: ParamTargets.CarRelease, min: 0.01, max: 3, def: 0.18 },
  { key: "pitchsweep", label: "Pitch Env Sweep", target: ParamTargets.PitchSweep, min: -8, max: 8, def: 0 },
  { key: "pitchdecay", label: "Pitch Env Decay", target: ParamTargets.PitchDecay, min: 0.01, max: 1, def: 0.05 },
  { key: "gate", label: "Note Gate Scale", target: ParamTargets.Gate, min: 0.05, max: 4, def: 1 },
  { key: "rsend", label: "Reverb Send Amt", target: ParamTargets.ReverbSend, min: 0, max: 1, def: 0.1 },
  { key: "dsend", label: "Delay Send Amt", target: ParamTargets.DelaySend, min: 0, max: 1, def: 0.05 },
];

/** Params visible per page on the pedal (excluding grip + page strip). */
export const INST_PARAMS_PER_PAGE = 3;

/** Footprint wide enough for readable param names (~16–20 chars). */
export const INST_FOOTPRINT_W = 4;
export const INST_FOOTPRINT_H = 4;

export const InstTypes = Object.fromEntries(
  InstrumentCatalog.map((p) => [p.key, {
    label: abbreviateInst(p.name),
    name: p.name,
    instrument: p.engine,
    catalogKey: p.key,
    category: p.category,
    role: p.role || (isDrumRole(p) ? "drum" : "synth"),
    w: INST_FOOTPRINT_W,
    // grip + 3 bars + page strip
    h: INST_FOOTPRINT_H,
  }]),
);
// Legacy aliases so old sketches / dock keys still resolve → kits or synths
for (const [legacy, key] of Object.entries({
  fm: "fm-lead",
  kick: "kit-punch", snare: "kit-punch", hat: "kit-punch",
  "kick-punch": "kit-punch", "snare-crisp": "kit-punch", "hat-closed": "kit-punch",
  bass: "bass-sub", pad: "pad-warm", bell: "bell-chime", pluck: "pluck-nylon",
})) {
  if (InstTypes[key] && !InstTypes[legacy]) {
    InstTypes[legacy] = { ...InstTypes[key], catalogKey: key };
  }
}

export function isDrumInstrumentType(typeKey) {
  const def = InstTypes[typeKey];
  return !!(def && def.role === "drum");
}

function abbreviateInst(name) {
  if (!name) return "?";
  const n = String(name).trim();
  if (n.length <= 3) return n.toUpperCase();
  // "Kick Deep" → KD, "Hat Closed" → HC, "FM Lead" → FML
  const parts = n.split(/[\s\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0] + (parts[2]?.[0] || "")).toUpperCase().slice(0, 3);
  }
  return n.slice(0, 3).toUpperCase();
}

export function ensureInstruments(score) {
  if (!score.instruments) score.instruments = [];
  for (const m of score.instruments) {
    const def = InstTypes[m.type] || InstTypes.fm;
    m.w = def.w;
    m.h = def.h;
    m.channel = PatchBank.clamp(m.channel || 1);
    if (!m.type || !InstTypes[m.type]) m.type = "fm";
  }
  // One-time soft migrate: lanes with channel numbers but no instrumentId
  // get the first instrument sharing that PatchBank channel (not distance).
  if (!score._instAssocMigrated) {
    for (const lane of score.channelLanes || []) {
      if (lane.instrumentId) continue;
      if (!lane.channel) continue;
      const ch = lane.channel.channel | 0;
      const match = score.instruments.find((m) => (m.channel | 0) === ch);
      if (match) lane.instrumentId = match.id;
    }
    score._instAssocMigrated = true;
  }
  // Drop stale ids
  for (const lane of score.channelLanes || []) {
    if (!lane.instrumentId) continue;
    if (!score.instruments.some((m) => m.id === lane.instrumentId)) {
      lane.instrumentId = null;
    }
  }
  return score;
}

export function createInstrumentModule(type, x, y, {
  id = null,
  channel = 1,
} = {}) {
  const entry = catalogEntry(type);
  const key = entry.key;
  const def = InstTypes[key] || InstTypes["fm-lead"] || Object.values(InstTypes)[0];
  return {
    id: id || newFxId("inst"),
    type: key,
    x: x | 0,
    y: y | 0,
    w: def.w,
    h: def.h,
    channel: PatchBank.clamp(channel),
    paramPage: 0,
  };
}

/** "Kick1", "Kick2" — 1-based among same type in placement order. */
export function instrumentInstanceName(score, inst) {
  ensureInstruments(score);
  if (!inst) return "?";
  const base = InstTypes[inst.type]?.name || inst.type || "Inst";
  const same = score.instruments.filter((m) => m.type === inst.type);
  const idx = Math.max(0, same.findIndex((m) => m.id === inst.id)) + 1;
  return base + idx;
}

/** Compact label for dock icons / grip: K1, K2, HH, … */
export function instrumentShortLabel(score, inst) {
  ensureInstruments(score);
  if (!inst) return "?";
  const def = InstTypes[inst.type] || InstTypes.fm;
  const same = score.instruments.filter((m) => m.type === inst.type);
  const idx = Math.max(0, same.findIndex((m) => m.id === inst.id)) + 1;
  if (same.length <= 1) return def.label;
  return def.label.slice(0, 2) + idx;
}

/**
 * Find a free cell near `near` for a new instrument footprint.
 * Prefers below-right of the note/term so underlight paths stay short.
 */
export function findInstrumentSpawnCell(score, near, w = INST_FOOTPRINT_W, h = INST_FOOTPRINT_H) {
  ensureInstruments(score);
  const gw = score.gridW || 32;
  const gh = score.gridH || 16;
  const ox = near?.x ?? 1;
  const oy = near?.y ?? 1;
  const offsets = [];
  for (let r = 1; r <= 8; r++) {
    for (let dy = 0; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + dy !== r && !(dx === 0 && dy === 0)) continue;
        offsets.push({ dx, dy: dy + 1 }); // bias downward
        if (dy > 0) offsets.push({ dx, dy: -dy });
      }
    }
  }
  offsets.unshift({ dx: 1, dy: 1 }, { dx: 0, dy: 2 }, { dx: 2, dy: 0 });
  for (const { dx, dy } of offsets) {
    const x = ((ox + dx) % gw + gw) % gw;
    const y = ((oy + dy) % gh + gh) % gh;
    if (canPlaceInstrumentAt(score, x, y, w, h)) return { x, y };
  }
  // Fallback: scan
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (canPlaceInstrumentAt(score, x, y, w, h)) return { x, y };
    }
  }
  return { x: ox, y: oy };
}

export function instOccupies(mod, point) {
  return fxOccupies(mod, point);
}

export function findInstAt(score, point) {
  ensureInstruments(score);
  for (let i = score.instruments.length - 1; i >= 0; i--) {
    if (instOccupies(score.instruments[i], point)) return score.instruments[i];
  }
  return null;
}

/** Next free PatchBank channel, or 1 if all taken. */
export function nextInstrumentChannel(score) {
  ensureInstruments(score);
  const used = new Set(score.instruments.map((m) => m.channel | 0));
  for (let c = 1; c <= PatchBank.Channels; c++) {
    if (!used.has(c)) return c;
  }
  return 1;
}

/** Apply instrument type preset into the project's patch bank slot. */
export function syncInstrumentPatch(project, inst, { soft = false } = {}) {
  if (!project || !inst) return;
  const patch = PatchBank.get(project.patches, inst.channel);
  const preset = patchFor(inst.type);
  if (soft) {
    const level = patch.level;
    const pan = patch.pan;
    Object.assign(patch, preset);
    patch.level = level;
    patch.pan = pan;
  } else {
    Object.assign(patch, preset);
  }
  // Worklet engine id
  patch.instrument = catalogEntry(inst.type).engine;
  patch.catalogKey = catalogEntry(inst.type).key;
}

export function instParamValue(project, inst, key) {
  const bar = InstParamBars.find((b) => b.key === key);
  if (!bar || !project) return bar?.def ?? 0;
  return ParamTargets.get(PatchBank.get(project.patches, inst.channel), bar.target);
}

export function setInstParamValue(project, inst, key, value) {
  const bar = InstParamBars.find((b) => b.key === key);
  if (!bar || !project) return;
  ParamTargets.set(PatchBank.get(project.patches, inst.channel), bar.target, value);
}

// ---------------------------------------------------------------------------
// Association: term → nearest instrument left corner
// ---------------------------------------------------------------------------

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Toroidal Manhattan distance (shortest on the wrap grid). */
export function toroidalManhattan(ax, ay, bx, by, gridW, gridH) {
  const dx = Math.min(Math.abs(ax - bx), gridW - Math.abs(ax - bx));
  const dy = Math.min(Math.abs(ay - by), gridH - Math.abs(ay - by));
  return dx + dy;
}

/**
 * Nearest instrument to a cell, measured to the instrument's **left corner** (x, y).
 * Ties: prefer lower y, then lower x.
 */
export function nearestInstrument(score, point) {
  ensureInstruments(score);
  if (!score.instruments.length) return null;
  const gw = score.gridW || 32;
  const gh = score.gridH || 16;
  let best = null;
  let bestD = Infinity;
  for (const inst of score.instruments) {
    const d = toroidalManhattan(point.x, point.y, inst.x, inst.y, gw, gh);
    if (
      d < bestD ||
      (d === bestD && best &&
        (inst.y < best.y || (inst.y === best.y && inst.x < best.x))) ||
      (d === bestD && !best)
    ) {
      best = inst;
      bestD = d;
    }
  }
  return best;
}

/** Lane end/repeat marker (term), or head for circular loops. */
export function laneTermPoint(lane) {
  if (!lane) return null;
  lane.ensurePath?.();
  if (lane.circular) return lane.headPoint;
  return lane.termPoint;
}

/**
 * Explicit instrument association (set on create / via head-term picker).
 * No distance-based auto-routing — only the stored instrumentId.
 */
export function laneInstrument(score, lane) {
  if (!lane?.channel) return null;
  ensureInstruments(score);
  const id = lane.instrumentId;
  if (!id) return null;
  return score.instruments.find((m) => m.id === id) || null;
}

/**
 * Bind a channel lane to an instrument instance (or clear with null).
 * Syncs PatchBank channel + display label to match.
 */
export function setLaneInstrument(score, lane, instOrId) {
  if (!lane?.channel) return false;
  ensureInstruments(score);
  if (instOrId == null || instOrId === "") {
    lane.instrumentId = null;
    return true;
  }
  const id = typeof instOrId === "string" ? instOrId : instOrId.id;
  const inst = score.instruments.find((m) => m.id === id);
  if (!inst) {
    lane.instrumentId = null;
    return false;
  }
  lane.instrumentId = inst.id;
  lane.channel.channel = PatchBank.clamp(inst.channel);
  lane.channel.label = instrumentInstanceName(score, inst);
  return true;
}

/**
 * Resolve PatchBank channel for a lane:
 * explicit instrument association wins; else ChannelTile.channel.
 */
export function resolveLaneChannel(score, lane) {
  const inst = laneInstrument(score, lane);
  if (inst) return PatchBank.clamp(inst.channel);
  return PatchBank.clamp(lane?.channel?.channel ?? 1);
}

/** Color for drawing a lane (falls back to neutral note line). */
export function laneColor(score, lane, fallback = "#a1a1aa") {
  const inst = laneInstrument(score, lane);
  return inst ? instrumentColor(inst) : fallback;
}

/**
 * Signed unit steps along one axis on a torus (shortest direction).
 * @returns {number[]} each entry ±1
 */
function axisUnitSteps(from, to, size) {
  let d = (to - from) | 0;
  if (d > size / 2) d -= size;
  if (d < -size / 2) d += size;
  const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
  const n = Math.abs(d);
  const out = [];
  for (let i = 0; i < n; i++) out.push(sign);
  return out;
}

/**
 * NESW-only walk from `from` to `to` as a list of cells (includes both ends).
 * When both axes need travel, steps interleave into a staircase (not a straight
 * canvas line — each cell is a grid block).
 */
export function manhattanBlockPath(from, to, gridW = 32, gridH = 16) {
  const W = Math.max(2, gridW | 0);
  const H = Math.max(2, gridH | 0);
  const xs = axisUnitSteps(from.x, to.x, W);
  const ys = axisUnitSteps(from.y, to.y, H);
  const path = [{ x: from.x | 0, y: from.y | 0 }];
  let x = from.x | 0;
  let y = from.y | 0;
  let i = 0;
  let j = 0;
  // Staircase: when both remain, take one X then one Y (or vice versa next)
  while (i < xs.length && j < ys.length) {
    x = ((x + xs[i++] ) % W + W) % W;
    path.push({ x, y });
    y = ((y + ys[j++]) % H + H) % H;
    path.push({ x, y });
  }
  while (i < xs.length) {
    x = ((x + xs[i++]) % W + W) % W;
    path.push({ x, y });
  }
  while (j < ys.length) {
    y = ((y + ys[j++]) % H + H) % H;
    path.push({ x, y });
  }
  return path;
}

/**
 * @deprecated Distance underlights removed — association is explicit.
 * Kept as empty for any residual callers.
 */
export function instrumentLinkPaths(_score) {
  return [];
}

/** Stable pastel per instrument id/type for underlights. */
export function instrumentColor(inst) {
  const palette = [
    "#38bdf8", // sky
    "#a78bfa", // violet
    "#34d399", // emerald
    "#fbbf24", // amber
    "#f472b6", // pink
    "#2dd4bf", // teal
    "#fb923c", // orange
    "#e879f9", // fuchsia
  ];
  if (!inst) return palette[0];
  let h = 0;
  const s = String(inst.id || inst.type || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

/**
 * True if a rect is free of lanes, FX, and other instruments.
 */
export function canPlaceInstrumentAt(score, x, y, w, h, exceptId = null) {
  ensureInstruments(score);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const p = {
        x: ((x + dx) % (score.gridW || 32) + (score.gridW || 32)) % (score.gridW || 32),
        y: ((y + dy) % (score.gridH || 16) + (score.gridH || 16)) % (score.gridH || 16),
      };
      if (!score.isFree(p)) return false;
      if (findFxAt(score, p)) return false;
      const other = findInstAt(score, p);
      if (other && other.id !== exceptId) return false;
    }
  }
  return true;
}

export function removeInstrument(score, id) {
  ensureInstruments(score);
  score.instruments = score.instruments.filter((m) => m.id !== id);
}
