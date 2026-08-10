// Grid FX: insert pedals with adjacency-triggered ON/OFF and param pads.
// Channel instrument params use the same adjacency chips (kind "chan").
// No path sends, no cables — drag pads/values next to a lane cell.

import { ParamTargets, PatchBank } from "./core.js";

let _id = 1;
export function newFxId(prefix = "fx") {
  return prefix + "-" + (_id++) + "-" + (Math.random() * 1e6 | 0).toString(36);
}

/** Pedal types available on the grid (audio = inserts; pat* = pattern control). */
export const FxTypes = {
  delay: {
    label: "DLY",
    name: "Delay",
    w: 4,
    h: 4, // room for ON/OFF/grip + 4 param bars
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 0.35 },
      { key: "time", label: "Time", min: 0.05, max: 1.5, def: 0.35 },
      { key: "feedback", label: "Fbk", min: 0, max: 0.92, def: 0.35 },
      { key: "tone", label: "Tone", min: 0, max: 1, def: 0.4 },
    ],
  },
  reverb: {
    label: "RVB",
    name: "Reverb",
    w: 4,
    h: 3,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 0.3 },
      { key: "size", label: "Size", min: 0, max: 1, def: 0.5 },
      { key: "damp", label: "Damp", min: 0, max: 1, def: 0.4 },
    ],
  },
  distort: {
    label: "DST",
    name: "Distort",
    w: 3,
    h: 3,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 0.4 },
      { key: "drive", label: "Drive", min: 0, max: 1, def: 0.45 },
    ],
  },
  filter: {
    label: "FLT",
    name: "Filter",
    w: 3,
    h: 3,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 1 },
      { key: "cutoff", label: "Cut", min: 0, max: 1, def: 0.55 },
      { key: "reso", label: "Res", min: 0, max: 1, def: 0.2 },
    ],
  },
  pan: {
    label: "PAN",
    name: "Pan",
    w: 3,
    h: 3,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 1 },
      { key: "pan", label: "Pan", min: -1, max: 1, def: 0 },
      { key: "width", label: "Wid", min: 0, max: 1, def: 0.5 },
    ],
  },
  "pat+": {
    label: "P+",
    name: "Pattern +",
    w: 2,
    h: 2,
    params: [],
    patternOp: "inc",
  },
  "pat-": {
    label: "P−",
    name: "Pattern −",
    w: 2,
    h: 2,
    params: [],
    patternOp: "dec",
  },
  patgo: {
    label: "P→",
    name: "Pattern jump",
    w: 2,
    h: 2,
    params: [
      { key: "n", label: "To #", min: 0, max: 63, def: 0 },
    ],
    patternOp: "jump",
  },
};

export const FxTypeKeys = Object.keys(FxTypes);

export function defaultParams(type) {
  const def = FxTypes[type];
  const params = {};
  if (!def) return params;
  for (const p of def.params) params[p.key] = p.def;
  return params;
}

export function createFxModule(type, x, y, id = null) {
  const def = FxTypes[type] || FxTypes.delay;
  return {
    id: id || newFxId(type),
    type: FxTypes[type] ? type : "delay",
    x: x | 0,
    y: y | 0,
    w: def.w,
    h: def.h,
    params: defaultParams(type),
    /** Insert engaged. When false, audio is bypassed (effective mix → 0). */
    on: false,
  };
}

export function isPatternModule(mod) {
  return !!FxTypes[mod?.type]?.patternOp;
}

export function patternOpOf(mod) {
  return FxTypes[mod?.type]?.patternOp || null;
}

/**
 * Trigger pad on free ground (not on a lane cell).
 * kind: "on" | "off" | "param" | "chan" | "pat+" | "pat-"
 *   on/off/param → FX insert
 *   chan → instrument patch param for a channel
 *   pat+/pat- → pattern bank step (adjacency fire)
 * Fires when orthogonally adjacent to a playhead-lit step cell.
 */
export function createFxTrigger({
  x,
  y,
  kind,
  targetFxId = null,
  channel = 0,
  paramKey = null,
  value = 0,
  id = null,
}) {
  const allowed = ["on", "off", "param", "chan", "pat+", "pat-"];
  const k = allowed.includes(kind) ? kind : "on";
  const isPat = k === "pat+" || k === "pat-";
  const isChan = k === "chan";
  const isValue = k === "param" || isChan;
  return {
    id: id || newFxId("tr"),
    x: x | 0,
    y: y | 0,
    kind: k,
    targetFxId: (isChan || isPat) ? null : targetFxId,
    channel: isChan ? Math.max(1, channel | 0) : 0,
    paramKey: isValue ? String(paramKey || (isChan ? "level" : "mix")) : null,
    value: isValue ? +value || 0 : 0,
  };
}

/** Short owner label for chip face, e.g. DLY, PL, PAT. */
export function triggerOwnerLabel(score, trig) {
  ensureFxLists(score);
  if (trig.kind === "pat+" || trig.kind === "pat-") return "PAT";
  if (trig.kind === "chan") {
    for (const lane of score.lanes || []) {
      const ch = lane.channel;
      if (ch && (ch.channel | 0) === (trig.channel | 0)) {
        return (ch.shortName || ch.label || ("C" + ch.channel)).slice(0, 3).toUpperCase();
      }
    }
    return ("C" + (trig.channel | 0)).slice(0, 3);
  }
  const mod = score.fxModules.find((m) => m.id === trig.targetFxId);
  if (!mod) return "?";
  return (FxTypes[mod.type]?.label || mod.type || "?").slice(0, 3);
}

/** Primary action label on chip (ON, OFF, .5, P+, …). */
export function triggerActionLabel(trig) {
  if (trig.kind === "on") return "ON";
  if (trig.kind === "off") return "OFF";
  if (trig.kind === "pat+") return "P+";
  if (trig.kind === "pat-") return "P−";
  if (trig.kind === "param" || trig.kind === "chan") {
    // Inline compact format (formatAutoShort is defined later in module)
    const v = trig.value;
    const key = trig.paramKey;
    if (key === "pan") {
      const a = Math.round(Math.min(1, Math.max(-1, v)) * 100);
      if (a === 0) return "C";
      return (a < 0 ? "L" : "R") + Math.abs(a);
    }
    if (v >= 0 && v <= 1) {
      const s = Number(v).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      return s.startsWith("0") ? s.slice(1) || "0" : s;
    }
    return String(Math.round(v * 100) / 100);
  }
  return "?";
}

export function fxOccupies(mod, point) {
  return point.x >= mod.x && point.x < mod.x + mod.w &&
    point.y >= mod.y && point.y < mod.y + mod.h;
}

export function fxCenter(mod) {
  return {
    x: mod.x + (mod.w - 1) / 2,
    y: mod.y + (mod.h - 1) / 2,
  };
}

/** Orthogonal adjacency (not diagonal). */
export function isAdjacent(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

export function ensureFxLists(score) {
  if (!score.fxModules) score.fxModules = [];
  if (!score.fxTriggers) score.fxTriggers = [];
  // Legacy lists kept empty for format compat
  if (!score.pathRoutes) score.pathRoutes = [];
  if (!score.fxRoutes) score.fxRoutes = [];
  if (!score.autoNodes) score.autoNodes = [];
  // Migrate old autoNodes → param triggers once
  if (score.autoNodes.length && !score._autoMigrated) {
    for (const a of score.autoNodes) {
      score.fxTriggers.push(createFxTrigger({
        x: a.x,
        y: a.y,
        kind: "param",
        targetFxId: a.targetFxId,
        paramKey: a.paramKey,
        value: a.value,
        id: a.id,
      }));
    }
    score.autoNodes = [];
    score._autoMigrated = true;
  }
  for (const m of score.fxModules) {
    if (m.on == null) m.on = false;
    // Keep footprint in sync with type definition (layout for controls)
    const def = FxTypes[m.type];
    if (def) {
      m.w = def.w;
      m.h = def.h;
    }
  }
  return score;
}

export function findFxAt(score, point) {
  ensureFxLists(score);
  for (let i = score.fxModules.length - 1; i >= 0; i--) {
    if (fxOccupies(score.fxModules[i], point)) return score.fxModules[i];
  }
  return null;
}

export function findTriggerAt(score, point) {
  ensureFxLists(score);
  return score.fxTriggers.find((t) => t.x === point.x && t.y === point.y) || null;
}

/** @deprecated use findTriggerAt */
export function findAutoAt(score, point) {
  return findTriggerAt(score, point);
}

export function findPathRouteAt() {
  return null;
}

export function autoParamDef(score, autoOrTrig) {
  if (!autoOrTrig) return null;
  ensureFxLists(score);
  const key = autoOrTrig.paramKey || "mix";

  // Channel / instrument param
  if (autoOrTrig.kind === "chan") {
    const t = ParamTargets.parse(key);
    if (t < 0) return { key, label: key, min: 0, max: 1, def: 0 };
    return {
      key,
      label: ParamTargets.name(t),
      min: ParamTargets.min(t),
      max: ParamTargets.max(t),
      def: 0,
      target: t,
    };
  }

  const mod = score.fxModules.find((m) => m.id === autoOrTrig.targetFxId);
  if (!mod) return { key, label: key, min: 0, max: 1, def: 0 };
  const def = FxTypes[mod.type];
  const p = def?.params?.find((x) => x.key === key);
  if (p) return p;
  return { key, label: key, min: 0, max: 1, def: 0 };
}

export function removeFxModule(score, id) {
  ensureFxLists(score);
  score.fxModules = score.fxModules.filter((m) => m.id !== id);
  score.fxTriggers = score.fxTriggers.filter((t) => t.targetFxId !== id);
  score.pathRoutes = [];
  score.fxRoutes = [];
  score.autoNodes = [];
}

export function formatAutoShort(paramKey, value) {
  if (paramKey === "pan") {
    const a = Math.round(Math.min(1, Math.max(-1, value)) * 100);
    if (a === 0) return "C";
    return (a < 0 ? "L" : "R") + Math.abs(a);
  }
  if (paramKey === "n") return "#" + (Math.round(value) + 1);
  if (paramKey === "time" || /time|decay|attack|release/i.test(paramKey)) {
    const s = Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s.startsWith("0") ? s.slice(1) : s;
  }
  if (value >= 0 && value <= 1) {
    const s = Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s.startsWith("0") ? s.slice(1) || "0" : s;
  }
  return String(Math.round(value * 100) / 100);
}

export function formatAutoLong(score, trig) {
  ensureFxLists(score);
  if (trig.kind === "pat+") {
    return "Pattern + · adjacent lit step → next sketch in bank";
  }
  if (trig.kind === "pat-") {
    return "Pattern − · adjacent lit step → previous sketch in bank";
  }
  if (trig.kind === "chan") {
    const pDef = autoParamDef(score, trig);
    const label = pDef?.label || trig.paramKey;
    let v = formatAutoShort(trig.paramKey, trig.value);
    if (trig.paramKey === "moddecay" || trig.paramKey === "carattack" ||
        trig.paramKey === "carrelease" || trig.paramKey === "pitchdecay") {
      v = Math.round(trig.value * 1000) + "ms";
    }
    return "Ch " + (trig.channel | 0) + " (" + triggerOwnerLabel(score, trig) +
      ") · " + label + " = " + v + "  (adjacent step → set instrument param)";
  }
  const mod = score.fxModules.find((m) => m.id === trig.targetFxId);
  const fxName = mod ? (FxTypes[mod.type]?.name || mod.type) : "?";
  if (trig.kind === "on") return fxName + " · ON trigger (adjacent step lights → engage insert)";
  if (trig.kind === "off") return fxName + " · OFF trigger (adjacent step lights → bypass insert)";
  const pDef = autoParamDef(score, trig);
  const label = pDef?.label || trig.paramKey;
  let v = formatAutoShort(trig.paramKey, trig.value);
  if (trig.paramKey === "time") v = Math.round(trig.value * 1000) + "ms";
  return fxName + " · " + label + " = " + v + "  (adjacent step → set)";
}

export function playheadCells(runners) {
  const out = [];
  if (!runners) return out;
  for (const r of runners) {
    if (r.playingLane == null || r.playingStep < 0) continue;
    const lane = r.playingLane;
    const step = r.playingStep | 0;
    if (step < 0 || step >= lane.steps.length) continue;
    lane.ensurePath?.();
    const pt = lane.cellPoint ? lane.cellPoint(step, 0) : { x: lane.x + step, y: lane.y };
    out.push({ lane, step, x: pt.x, y: pt.y, channel: lane.channel?.channel ?? 1 });
  }
  return out;
}

export function activePlayheadColumns(runners) {
  const cols = new Set();
  for (const c of playheadCells(runners)) cols.add(c.x);
  return cols;
}

/** True if trigger cell is orthogonally next to any lit playhead step. */
export function triggerAdjacentToPlayhead(trig, cells) {
  for (const c of cells) {
    if (isAdjacent(trig.x, trig.y, c.x, c.y)) return true;
  }
  return false;
}

/** True if trigger is next to any lane step cell (for placement validity / opacity). */
export function triggerAdjacentToAnyLane(score, trig) {
  for (const lane of score.lanes || []) {
    lane.ensurePath?.();
    for (const p of lane.path || []) {
      if (isAdjacent(trig.x, trig.y, p.x, p.y)) return true;
    }
  }
  return false;
}

/**
 * Apply adjacency triggers for this frame.
 * ON/OFF latch module.on; param/chan set values (sample-and-hold latch).
 * @param {Map} latch  key=`fxId\\0param` or `ch\\0N\\0param` → value
 * @param {Map} fired  key=triggerId → last fire key (debounce while still adjacent)
 * @param {Array|null} patches  project.patches for channel instrument triggers
 */
export function applyFxTriggers(score, runners, playing, latch = null, fired = null, patches = null) {
  ensureFxLists(score);
  const cells = playing ? playheadCells(runners) : [];
  const activeTrigIds = new Set();
  const adjTrigIds = new Set();

  if (!playing) {
    if (latch) latch.clear();
    if (fired) fired.clear();
    return { cells, activeTrigIds, adjTrigIds };
  }

  for (const trig of score.fxTriggers) {
    const nearLane = triggerAdjacentToAnyLane(score, trig);
    if (nearLane) adjTrigIds.add(trig.id);

    const hot = triggerAdjacentToPlayhead(trig, cells);
    if (!hot) {
      if (fired) fired.delete(trig.id);
      continue;
    }
    activeTrigIds.add(trig.id);

    // Debounce: fire once per continuous adjacency stretch
    const fireKey = cells.map((c) => c.x + "," + c.y).sort().join("|");
    if (fired && fired.get(trig.id) === fireKey) continue;
    if (fired) fired.set(trig.id, fireKey);

    // Pattern bank triggers are handled in collectPatternTriggers
    if (trig.kind === "pat+" || trig.kind === "pat-") continue;

    if (trig.kind === "chan") {
      if (!patches || !trig.paramKey) continue;
      const t = ParamTargets.parse(trig.paramKey);
      if (t < 0) continue;
      ParamTargets.set(PatchBank.get(patches, trig.channel | 0), t, trig.value);
      if (latch) latch.set("ch\0" + (trig.channel | 0) + "\0" + trig.paramKey, trig.value);
      continue;
    }

    const mod = score.fxModules.find((m) => m.id === trig.targetFxId);
    if (!mod) continue;

    if (trig.kind === "on") {
      mod.on = true;
    } else if (trig.kind === "off") {
      mod.on = false;
    } else if (trig.kind === "param" && trig.paramKey) {
      mod.params[trig.paramKey] = trig.value;
      if (latch) latch.set(mod.id + "\0" + trig.paramKey, trig.value);
    }
  }

  // Re-apply latched params every frame (so they stick)
  if (latch) {
    for (const [key, value] of latch) {
      if (key.startsWith("ch\0")) {
        if (!patches) continue;
        const parts = key.split("\0");
        const ch = +parts[1];
        const paramKey = parts[2];
        const t = ParamTargets.parse(paramKey);
        if (t < 0) continue;
        ParamTargets.set(PatchBank.get(patches, ch), t, value);
        continue;
      }
      const sep = key.indexOf("\0");
      if (sep < 0) continue;
      const mod = score.fxModules.find((m) => m.id === key.slice(0, sep));
      if (mod) mod.params[key.slice(sep + 1)] = value;
    }
  }

  return { cells, activeTrigIds, adjTrigIds };
}

/**
 * Live UI/audio snapshot.
 * @param {Array|null} patches  project.patches for channel instrument triggers
 */
export function computeFxLiveState(score, runners, playing, latch = null, fired = null, patches = null) {
  ensureFxLists(score);
  // Mutates module.on / params / patches via triggers
  const { cells, activeTrigIds, adjTrigIds } = applyFxTriggers(
    score, runners, playing, latch, fired, patches,
  );

  const liveParams = new Map();
  const receivingFx = new Set(); // ON inserts
  const activePatternIds = new Set();
  const autoOnParam = new Set();
  const chanOnParam = new Set(); // "chN:paramKey" for UI ticks/highlight

  for (const mod of score.fxModules) {
    liveParams.set(mod.id, { ...(mod.params || {}) });
    if (mod.on && !isPatternModule(mod)) receivingFx.add(mod.id);
  }

  if (playing && latch) {
    for (const [key, value] of latch) {
      if (key.startsWith("ch\0")) {
        const parts = key.split("\0");
        chanOnParam.add(parts[1] + ":" + parts[2]);
        continue;
      }
      const sep = key.indexOf("\0");
      if (sep < 0) continue;
      const p = liveParams.get(key.slice(0, sep));
      if (p) {
        p[key.slice(sep + 1)] = value;
        autoOnParam.add(key);
      }
    }
  }

  // Currently firing param triggers highlight
  for (const trig of score.fxTriggers) {
    if (!activeTrigIds.has(trig.id)) continue;
    if (trig.kind === "param") {
      autoOnParam.add(trig.targetFxId + "\0" + trig.paramKey);
    } else if (trig.kind === "chan") {
      chanOnParam.add((trig.channel | 0) + ":" + trig.paramKey);
    }
  }

  const cols = new Set(cells.map((c) => c.x));
  for (const mod of score.fxModules) {
    if (!patternOpOf(mod)) continue;
    for (let dx = 0; dx < mod.w; dx++) {
      if (cols.has(mod.x + dx)) {
        activePatternIds.add(mod.id);
        break;
      }
    }
  }

  return {
    cells,
    cols,
    activeTrigIds,
    adjTrigIds,
    activeAutoIds: activeTrigIds, // alias for old UI
    activePathIds: new Set(),
    receivingFx,
    activePatternIds,
    liveParams,
    autoOnParam,
    chanOnParam,
  };
}

export function collectPatternTriggers(score, runners, lastFired) {
  ensureFxLists(score);
  const triggers = [];
  if (!runners?.length) return triggers;
  const cells = playheadCells(runners);
  const cols = new Set(cells.map((c) => c.x));

  // Legacy: pattern modules on the plane (column hit). Prefer adjacency chips.
  for (const mod of score.fxModules) {
    const op = patternOpOf(mod);
    if (!op) continue;
    let hit = false;
    for (let dx = 0; dx < mod.w; dx++) {
      if (cols.has(mod.x + dx)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    const key = mod.id + "@" + [...cols].sort((a, b) => a - b).join(",");
    if (lastFired && lastFired.get(mod.id) === key) continue;
    if (lastFired) lastFired.set(mod.id, key);
    triggers.push({
      op,
      n: Math.round(mod.params?.n ?? 0),
      id: mod.id,
      key,
    });
  }

  // New: pat+ / pat- adjacency triggers (dragged from transport ‹ ›)
  for (const trig of score.fxTriggers) {
    if (trig.kind !== "pat+" && trig.kind !== "pat-") continue;
    if (!triggerAdjacentToPlayhead(trig, cells)) {
      if (lastFired) lastFired.delete(trig.id);
      continue;
    }
    const fireKey = cells.map((c) => c.x + "," + c.y).sort().join("|");
    if (lastFired && lastFired.get(trig.id) === fireKey) continue;
    if (lastFired) lastFired.set(trig.id, fireKey);
    triggers.push({
      op: trig.kind === "pat+" ? "inc" : "dec",
      n: 0,
      id: trig.id,
      key: fireKey,
    });
  }
  return triggers;
}

/**
 * Audio graph message: serial inserts for ON modules.
 * Each module gets params + on flag; worklet ramps mix to 0 when off.
 */
export function buildFxGraphMessage(project, runners, playing, latch = null, fired = null) {
  const score = project.score;
  const live = computeFxLiveState(
    score, runners, playing, latch, fired, project.patches,
  );

  const modules = (score.fxModules || [])
    .filter((m) => !isPatternModule(m))
    .map((m) => ({
      id: m.id,
      type: m.type,
      on: !!m.on,
      params: live.liveParams.get(m.id) || { ...(m.params || {}) },
    }));

  return {
    modules,
    // Inserts process master dry in series; no path sends
    pathOpens: [],
    chains: [],
    insertMode: true,
    tempo: project.tempo,
    live,
  };
}

// ---------------------------------------------------------------------------
// Legacy stubs (editor / format may still import)
// ---------------------------------------------------------------------------

export function createPathRoute() {
  return { id: newFxId("pr"), laneIndex: 0, fromStep: 0, toStep: 0, targetFxId: "", amount: 0 };
}

export function createFxRoute({ fromFxId, toFxId, amount = 1, id = null }) {
  return { id: id || newFxId("fr"), fromFxId, toFxId, amount };
}

export function createAutoNode({ x, y, targetFxId, paramKey, value, id = null }) {
  return createFxTrigger({
    x, y, kind: "param", targetFxId, paramKey, value, id,
  });
}
