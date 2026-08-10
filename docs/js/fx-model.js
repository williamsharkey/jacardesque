// Grid-native FX world: pedal modules, path sends, chains, automation nodes.
// Effects are objects on the plane — not a hidden global menu.

let _id = 1;
export function newFxId(prefix = "fx") {
  return prefix + "-" + (_id++) + "-" + (Math.random() * 1e6 | 0).toString(36);
}

/** Pedal types available on the grid. */
export const FxTypes = {
  delay: {
    label: "DLY",
    name: "Delay",
    w: 3,
    h: 3,
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
    w: 3,
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
    h: 2,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 0.4 },
      { key: "drive", label: "Drive", min: 0, max: 1, def: 0.45 },
    ],
  },
  filter: {
    label: "FLT",
    name: "Filter",
    w: 3,
    h: 2,
    params: [
      { key: "mix", label: "Mix", min: 0, max: 1, def: 1 },
      { key: "cutoff", label: "Cut", min: 0, max: 1, def: 0.55 },
      { key: "reso", label: "Res", min: 0, max: 1, def: 0.2 },
    ],
  },
  pan: {
    label: "PAN",
    name: "Pan",
    w: 2,
    h: 2,
    params: [
      { key: "pan", label: "Pan", min: -1, max: 1, def: 0 },
      { key: "width", label: "Wid", min: 0, max: 1, def: 0.5 },
    ],
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
  };
}

/**
 * Path send: while a runner is on lane steps [fromStep, toStep],
 * that channel's dry audio is also fed into targetFx.
 * Visual "pull-off" from the path into a pedal.
 */
export function createPathRoute({
  laneIndex = 0,
  fromStep = 0,
  toStep = 4,
  targetFxId,
  amount = 0.55,
  id = null,
}) {
  return {
    id: id || newFxId("pr"),
    laneIndex: laneIndex | 0,
    fromStep: Math.max(0, fromStep | 0),
    toStep: Math.max(0, toStep | 0),
    targetFxId,
    amount: Math.min(1, Math.max(0, amount)),
  };
}

/** Pedal → pedal chain cable. */
export function createFxRoute({ fromFxId, toFxId, amount = 1, id = null }) {
  return {
    id: id || newFxId("fr"),
    fromFxId,
    toFxId,
    amount: Math.min(1, Math.max(0, amount)),
  };
}

/**
 * Automation node: when any runner's playhead is at grid column x
 * (lane step cell x === node.x), set targetFx.param = value for that instant.
 */
export function createAutoNode({
  x,
  y,
  targetFxId,
  paramKey,
  value,
  id = null,
}) {
  return {
    id: id || newFxId("au"),
    x: x | 0,
    y: y | 0,
    targetFxId,
    paramKey: String(paramKey || "mix"),
    value: +value || 0,
  };
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

/** Serialize modular FX graph for the audio thread. */
export function buildFxGraphMessage(project, runners, playing) {
  const score = project.score;
  const modules = (score.fxModules || []).map((m) => ({
    id: m.id,
    type: m.type,
    params: { ...m.params },
  }));

  // Apply automation from current playheads (column-based).
  if (playing && runners) {
    const activeCols = new Set();
    for (const r of runners) {
      if (r.playingLane != null && r.playingStep >= 0) {
        activeCols.add(r.playingLane.x + r.playingStep);
      }
    }
    for (const auto of score.autoNodes || []) {
      if (!activeCols.has(auto.x)) continue;
      const mod = modules.find((m) => m.id === auto.targetFxId);
      if (!mod) continue;
      mod.params[auto.paramKey] = auto.value;
    }
  }

  // Path opens: live while a runner is on that lane inside [fromStep, toStep].
  const pathOpens = [];
  if (playing && runners) {
    for (const route of score.pathRoutes || []) {
      const lane = score.lanes[route.laneIndex];
      if (!lane) continue;
      const channel = score.channelOf(lane);
      let open = false;
      for (const r of runners) {
        if (r.playingLane !== lane) continue;
        if (r.playingStep >= route.fromStep && r.playingStep <= route.toStep) {
          open = true;
          break;
        }
      }
      if (open) {
        pathOpens.push({
          channel,
          targetFxId: route.targetFxId,
          amount: route.amount,
        });
      }
    }
  }

  const chains = (score.fxRoutes || []).map((r) => ({
    from: r.fromFxId,
    to: r.toFxId,
    amount: r.amount,
  }));

  return { modules, pathOpens, chains, tempo: project.tempo };
}

// ---------------------------------------------------------------------------
// Score helpers (attached when loading into score object)
// ---------------------------------------------------------------------------

export function ensureFxLists(score) {
  if (!score.fxModules) score.fxModules = [];
  if (!score.pathRoutes) score.pathRoutes = [];
  if (!score.fxRoutes) score.fxRoutes = [];
  if (!score.autoNodes) score.autoNodes = [];
  return score;
}

export function findFxAt(score, point) {
  ensureFxLists(score);
  for (let i = score.fxModules.length - 1; i >= 0; i--) {
    if (fxOccupies(score.fxModules[i], point)) return score.fxModules[i];
  }
  return null;
}

export function findAutoAt(score, point) {
  ensureFxLists(score);
  return score.autoNodes.find((a) => a.x === point.x && a.y === point.y) || null;
}

export function removeFxModule(score, id) {
  ensureFxLists(score);
  score.fxModules = score.fxModules.filter((m) => m.id !== id);
  score.pathRoutes = score.pathRoutes.filter((r) => r.targetFxId !== id);
  score.fxRoutes = score.fxRoutes.filter((r) => r.fromFxId !== id && r.toFxId !== id);
  score.autoNodes = score.autoNodes.filter((a) => a.targetFxId !== id);
}
