// Grid instrument objects — pedals like FX inserts, many lanes → one instrument.
// Association: each lane's end/repeat (term) binds to the nearest instrument
// measured by Manhattan distance to the instrument's left-corner cell (x, y).
// Visual: underlight the NESW staircase of grid cells from term → corner.

import { ParamTargets, PatchBank } from "./core.js";
import {
  InstrumentKeys,
  InstrumentNames,
  parseInstrument,
  instrumentKey,
  patchFor,
} from "./instruments.js";
import { newFxId, fxOccupies, findFxAt } from "./fx-model.js";

/** Compact param bars on the instrument pedal (map to ParamTargets / patch). */
export const InstParamBars = [
  { key: "level", label: "Lvl", target: ParamTargets.Level, min: 0, max: 1, def: 0.55 },
  { key: "pan", label: "Pan", target: ParamTargets.Pan, min: -1, max: 1, def: 0 },
  { key: "index", label: "Idx", target: ParamTargets.ModIndex, min: 0, max: 8, def: 1.2 },
  { key: "moddecay", label: "MDc", target: ParamTargets.ModDecay, min: 0.01, max: 2, def: 0.18 },
];

export const InstTypes = Object.fromEntries(
  InstrumentKeys.map((key, i) => [key, {
    label: abbreviateInst(InstrumentNames[i]),
    name: InstrumentNames[i],
    instrument: i,
    w: 3,
    h: 4, // grip + 4 param rows
  }]),
);

function abbreviateInst(name) {
  if (!name) return "?";
  if (name.length <= 3) return name.toUpperCase();
  // Kick→KIK, Snare→SNR, Hat→HAT, Bass→BAS, Pad→PAD, Bell→BEL, Pluck→PLK
  const map = {
    FM: "FM", Kick: "KIK", Snare: "SNR", Hat: "HAT",
    Bass: "BAS", Pad: "PAD", Bell: "BEL", Pluck: "PLK",
  };
  return map[name] || name.slice(0, 3).toUpperCase();
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
  return score;
}

export function createInstrumentModule(type, x, y, {
  id = null,
  channel = 1,
} = {}) {
  const key = instrumentKey(parseInstrument(type));
  const def = InstTypes[key] || InstTypes.fm;
  return {
    id: id || newFxId("inst"),
    type: key,
    x: x | 0,
    y: y | 0,
    w: def.w,
    h: def.h,
    channel: PatchBank.clamp(channel),
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
export function findInstrumentSpawnCell(score, near, w = 3, h = 4) {
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
    // Keep user-tuned level/pan; refresh voice character
    const level = patch.level;
    const pan = patch.pan;
    Object.assign(patch, preset);
    patch.level = level;
    patch.pan = pan;
  } else {
    Object.assign(patch, preset);
  }
  patch.instrument = parseInstrument(inst.type);
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

/** Instrument driven by this channel lane (many lanes may share one). */
export function laneInstrument(score, lane) {
  if (!lane?.channel) return null;
  const term = laneTermPoint(lane);
  if (!term) return null;
  return nearestInstrument(score, term);
}

/**
 * Resolve PatchBank channel for a lane:
 * instrument association wins; else ChannelTile.channel.
 */
export function resolveLaneChannel(score, lane) {
  const inst = laneInstrument(score, lane);
  if (inst) return PatchBank.clamp(inst.channel);
  return PatchBank.clamp(lane?.channel?.channel ?? 1);
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

/** All underlight paths: { lane, inst, path, color } for drawing. */
export function instrumentLinkPaths(score) {
  ensureInstruments(score);
  const out = [];
  if (!score.instruments.length) return out;
  const gw = score.gridW || 32;
  const gh = score.gridH || 16;
  for (const lane of score.channelLanes || []) {
    const inst = laneInstrument(score, lane);
    if (!inst) continue;
    const term = laneTermPoint(lane);
    if (!term) continue;
    const path = manhattanBlockPath(term, { x: inst.x, y: inst.y }, gw, gh);
    out.push({
      lane,
      inst,
      path,
      color: instrumentColor(inst),
    });
  }
  return out;
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
