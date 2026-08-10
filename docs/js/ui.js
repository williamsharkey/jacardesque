// Interactive Jacquard UI — score plane, panels, value bars, transport.

import {
  Pitch,
  ParamTargets,
  DelayTime,
  PatchBank,
  CellKind,
  NoteTile,
  ParamTile,
  CycleGateTile,
  ProbGateTile,
  ChannelTile,
  JumpTile,
  JumpDestTile,
  TerminatorTile,
  Terminator,
  gp,
  gpEq,
  gpOffset,
} from "./core.js";
import { Style } from "./style.js";
import { InstrumentNames, InstrumentKeys } from "./instruments.js";
import { PlaceMenu, buildGroundObjectCategories } from "./place-menu.js";
import {
  ensureFxLists,
  findFxAt,
  findTriggerAt,
  autoParamDef,
  fxCenter,
  fxOccupies,
  FxTypes,
  computeFxLiveState,
  formatAutoShort,
  formatAutoLong,
  triggerAdjacentToAnyLane,
} from "./fx-model.js";

// ---------------------------------------------------------------------------
// Value bar ranges
// ---------------------------------------------------------------------------

export function makeRange({
  low, high, curve = 1, snap = 0, scale = 1, unit = null, digits = 2, display = null,
}) {
  return { low, high, curve, snap, scale, unit, digits, display, bipolar: low < 0 && high > 0 };
}

export const Ranges = {
  amount(low, high) {
    return makeRange({ low, high });
  },
  seconds(low, high) {
    return makeRange({ low, high, curve: 3, scale: 1000, unit: "ms", digits: 0 });
  },
  ofParam(target) {
    const low = ParamTargets.min(target);
    const high = ParamTargets.max(target);
    switch (target) {
      case ParamTargets.ModDecay:
      case ParamTargets.CarAttack:
      case ParamTargets.CarRelease:
      case ParamTargets.PitchDecay:
        return this.seconds(low, high);
      case ParamTargets.Gate:
        return makeRange({ low, high, curve: 2, scale: 100, unit: "%", digits: 0 });
      case ParamTargets.Pan:
        return makeRange({
          low, high, scale: 100, digits: 0,
          display: (v) => {
            const amount = Math.round(Math.min(1, Math.max(-1, v)) * 100);
            return amount === 0 ? "C" : (amount < 0 ? "L " : "R ") + Math.abs(amount);
          },
        });
      default:
        return this.amount(low, high);
    }
  },
  relative(target) {
    const r = this.ofParam(target);
    const span = r.high - r.low;
    return makeRange({
      low: -span, high: span, curve: r.curve, snap: r.snap,
      scale: r.scale, unit: r.unit, digits: r.digits,
    });
  },
};

function toValue(range, position) {
  if (!range.bipolar) {
    return range.low + (range.high - range.low) * Math.pow(position, range.curve);
  }
  const signed = position * 2 - 1;
  const depth = Math.pow(Math.abs(signed), range.curve);
  return (signed < 0 ? range.low : range.high) * depth;
}

function toPosition(range, value) {
  if (!range.bipolar) {
    if (range.high === range.low) return 0;
    const t = Math.min(1, Math.max(0, (value - range.low) / (range.high - range.low)));
    return Math.pow(t, 1 / range.curve);
  }
  const denom = value < 0 ? range.low : range.high;
  const depth = denom === 0 ? 0 : Math.min(1, Math.max(0, value / denom));
  const signed = Math.sign(value || 0) * Math.pow(depth, 1 / range.curve);
  return (signed + 1) * 0.5;
}

function formatRange(range, value) {
  if (range.display) return range.display(value);
  const n = (value * range.scale).toFixed(range.digits);
  return range.unit ? n + " " + range.unit : n;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Matches Unity ValueBar: relative drag (right = up = more), shift for fine,
// double-click types an exact value (not clamped to the bar range).
const DRAG_DISTANCE = 100; // px of travel for full bar span
const FINE_DRAG_SCALE = 0.12;
const DOUBLE_CLICK_MS = 350;

/**
 * Value bar. options:
 *   onDragOut(value, clientX, clientY) — vertical drag leaves bar → create trigger
 *   getTicks() — array of values for vertical tick marks (param triggers)
 */
export function createValueBar(range, get, set, settled, options = {}) {
  const root = el("div", "value-bar");
  const fill = el("div", "value-bar-fill");
  const ticks = el("div", "value-bar-ticks");
  const read = el("div", "value-bar-readout");
  const input = el("input", "value-bar-input");
  input.type = "text";
  input.spellcheck = false;
  input.classList.add("hidden");
  root.append(fill, ticks, read, input);

  let dragging = false;
  let scrubbed = false;
  let draggingOut = false;
  let dragOrigin = { x: 0, y: 0 };
  let dragPosition = 0;
  let dragFine = false;
  let lastClick = 0;
  let editing = false;
  let ghost = null;

  function paintTicks() {
    ticks.innerHTML = "";
    const list = options.getTicks?.() || [];
    for (const v of list) {
      const pos = toPosition(range, v);
      const mark = el("div", "value-bar-tick");
      mark.style.left = (pos * 100) + "%";
      ticks.append(mark);
    }
  }

  function paint() {
    if (editing) return;
    const value = get();
    const pos = toPosition(range, value);
    if (range.bipolar) {
      const mid = 0.5;
      if (pos >= mid) {
        fill.style.left = (mid * 100) + "%";
        fill.style.width = ((pos - mid) * 100) + "%";
      } else {
        fill.style.left = (pos * 100) + "%";
        fill.style.width = ((mid - pos) * 100) + "%";
      }
    } else {
      fill.style.left = "0";
      fill.style.width = (pos * 100) + "%";
    }
    read.textContent = formatRange(range, value);
    paintTicks();
  }

  function round(value) {
    return range.snap > 0 ? Math.round(value / range.snap) * range.snap : value;
  }

  function applyDrag(e) {
    if (draggingOut) return;
    const fine = !!e.shiftKey;
    if (fine !== dragFine) {
      dragFine = fine;
      dragOrigin = { x: e.clientX, y: e.clientY };
      dragPosition = toPosition(range, get());
    }
    const dx = e.clientX - dragOrigin.x;
    const dy = e.clientY - dragOrigin.y;
    // Vertical leave with drag-out support → param chip mode
    if (options.onDragOut && Math.abs(dy) > Math.abs(dx) + 10 && Math.abs(dy) > 14) {
      draggingOut = true;
      scrubbed = false;
      ghost = el("div", "dock-note-ghost", formatRange(range, get()));
      document.body.append(ghost);
      ghost.style.left = e.clientX + 8 + "px";
      ghost.style.top = e.clientY + 8 + "px";
      return;
    }
    let travel = (dx - dy) / DRAG_DISTANCE;
    if (dragFine) travel *= FINE_DRAG_SCALE;
    if (dx * dx + dy * dy > 16) scrubbed = true;
    const pos = Math.min(1, Math.max(0, dragPosition + travel));
    set(round(toValue(range, pos)));
    paint();
  }

  function beginEdit() {
    editing = true;
    dragging = false;
    root.classList.remove("active");
    read.classList.add("hidden");
    fill.classList.add("hidden");
    ticks.classList.add("hidden");
    input.classList.remove("hidden");
    const value = get();
    input.value = range.scale && range.scale !== 1
      ? String(+(value * range.scale).toFixed(range.digits + 2))
      : String(value);
    input.focus();
    input.select();
  }

  function endEdit(commit) {
    if (!editing) return;
    editing = false;
    input.classList.add("hidden");
    read.classList.remove("hidden");
    fill.classList.remove("hidden");
    ticks.classList.remove("hidden");
    if (commit) {
      let typed = parseFloat(input.value);
      if (!Number.isNaN(typed)) {
        if (range.scale && range.scale !== 1) typed /= range.scale;
        // Typing is deliberately not clamped to the useful bar range.
        set(typed);
        settled?.();
      }
    }
    paint();
  }

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || editing) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastClick < DOUBLE_CLICK_MS) {
      lastClick = 0;
      beginEdit();
      return;
    }
    lastClick = now;
    dragging = true;
    scrubbed = false;
    draggingOut = false;
    dragFine = !!e.shiftKey;
    dragOrigin = { x: e.clientX, y: e.clientY };
    dragPosition = toPosition(range, get());
    root.classList.add("active");
    root.setPointerCapture(e.pointerId);
  });

  root.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (draggingOut && ghost) {
      ghost.style.left = e.clientX + 8 + "px";
      ghost.style.top = e.clientY + 8 + "px";
      // Opacity hint via optional validator
      const ok = options.isDragOutValid?.(e.clientX, e.clientY);
      ghost.classList.toggle("valid", !!ok);
      ghost.style.opacity = ok ? "1" : "0.5";
      return;
    }
    applyDrag(e);
  });

  root.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("active");
    try {
      root.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (draggingOut) {
      draggingOut = false;
      options.onDragOut?.(get(), e.clientX, e.clientY);
      return;
    }
    // Settled only after a scrub
    if (scrubbed) settled?.();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      endEdit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      endEdit(false);
    }
    e.stopPropagation();
  });
  input.addEventListener("focusout", () => endEdit(true));
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  root.sync = paint;
  paint();
  return root;
}

function barRow(label, range, get, set, settled, options) {
  const row = el("div", "control-row");
  row.append(el("div", "control-label", label));
  const bar = createValueBar(range, get, set, settled, options);
  row.append(bar);
  row.sync = () => bar.sync();
  return row;
}

function button(label, onClick, width) {
  const b = el("button", "btn", label);
  if (width) b.style.minWidth = width + "px";
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

function chooser(label, names, getIndex, setIndex) {
  const row = el("div", "control-row chooser");
  row.append(el("div", "control-label", label));
  const value = el("div", "chooser-value");
  const prev = button("‹", () => {
    const i = Math.max(0, getIndex() - 1);
    setIndex(i);
    paint();
  }, 28);
  const next = button("›", () => {
    const i = Math.min(names.length - 1, getIndex() + 1);
    setIndex(i);
    paint();
  }, 28);
  function paint() {
    value.textContent = names[getIndex()] ?? "";
  }
  row.append(prev, value, next);
  row.sync = paint;
  paint();
  return row;
}

// ---------------------------------------------------------------------------
// Score plane (canvas)
// ---------------------------------------------------------------------------

export class ScoreView {
  constructor(canvas, scroll) {
    this.canvas = canvas;
    this.scroll = scroll;
    this.ctx = canvas.getContext("2d");
    this.score = null;
    this.sequencer = null;
    this.cursor = gp(1, 1);
    this.columns = 48;
    this.rows = 28;
    this.dpr = 1;

    this.onCursorMoved = null;
    this.onDoubleClick = null;
    this.onTilesDropped = null;
    this.onLaneDropped = null;
    this.onKey = null;
    /** (point) => boolean — host decides if cell can take a new tile */
    this.canPlaceAt = null;
    /** (point) => 'lane'|'ground'|null */
    this.menuModeAt = null;
    /** () => number — centre pitch for place menu notes */
    this.placeCentreNote = null;
    /** ({ point, place }) => void — commit from place menu */
    this.onPlaceCommit = null;
    /** currently selected fx module id */
    this.selectedFxId = null;
    /** currently selected automation node id */
    this.selectedAutoId = null;
    /** currently selected path-send route id */
    this.selectedPathId = null;
    /** (fxId) => void */
    this.onFxSelect = null;
    /** (triggerId) => void */
    this.onAutoSelect = null;
    /** (pathId) => void */
    this.onPathSelect = null;
    /** ({ kind, fxId, paramKey?, value?, point }) => void */
    this.onTriggerPlaced = null;
    /** (commit?: boolean) => void */
    this.onFxParamChanged = null;
    /** (point) => boolean */
    this.onIsValidTrigger = null;

    this._grabbed = null;
    this._grabOrigin = null;
    this._dragging = false;
    this._dropPoint = null;
    this._dropCells = [];
    this._ghostDelta = { x: 0, y: 0 };
    this._playheads = [];
    this._liftCount = 1;
    this._placing = false;
    this.placeMenu = null;
    /** Empty-ground morphic shell: { origin, phase:'shell'|'lane'|'object', path, cats, catIndex, itemIndex } */
    this._groundGesture = null;
    this._trigDrag = null;
    this._sliderDrag = null;
    this._fxMoveDrag = null;
    this._panning = false;
    this._panArmed = false; // true only after drag exceeds threshold
    this._captureEl = null;
    this._captureId = null;
    this._loopDrag = null;
    this._anim = 0;
    /** Live FX state from audio tick (active paths, autos, dimmed pedals). */
    this.fxLive = null;
    /** Hover tooltip target: { kind:'auto'|'path'|'fx', id, text, x, y } */
    this._hoverTip = null;

    this._bind();
    if (!ScoreView._sharedAnim) {
      ScoreView._sharedAnim = true;
      const tick = () => {
        // Bump a global phase so circular tape-loops + FX pulses animate.
        for (const v of ScoreView._instances || []) {
          v._anim = (v._anim || 0) + 1;
          const need =
            v.score?.lanes?.some((l) => l.circular) ||
            (v.sequencer?.isPlaying &&
              ((v.score?.fxTriggers?.length || 0) > 0 ||
                (v.score?.fxModules?.length || 0) > 0));
          if (need) v.paint();
        }
        requestAnimationFrame(tick);
      };
      ScoreView._instances = ScoreView._instances || [];
      requestAnimationFrame(tick);
    }
    ScoreView._instances = ScoreView._instances || [];
    if (!ScoreView._instances.includes(this)) ScoreView._instances.push(this);
  }

  _bind() {
    const c = this.canvas;
    c.tabIndex = 0;

    c.addEventListener("pointerdown", (e) => this._pointerDown(e));
    c.addEventListener("pointermove", (e) => this._pointerMove(e));
    c.addEventListener("pointerup", (e) => this._pointerUp(e));
    c.addEventListener("pointercancel", (e) => this._pointerUp(e));
    c.addEventListener("pointerleave", () => {
      if (this._hoverTip) {
        this._hoverTip = null;
        this.canvas.title = "";
        this.paint();
      }
    });
    c.addEventListener("lostpointercapture", () => {
      // Safety: never leave pan "stuck" if capture is lost.
      this._panning = false;
      this._panArmed = false;
    });
    c.addEventListener("keydown", (e) => {
      if (this.onKey?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  _capture(el, pointerId) {
    this._releaseCapture();
    try {
      el.setPointerCapture(pointerId);
      this._captureEl = el;
      this._captureId = pointerId;
    } catch (_) { /* ignore */ }
  }

  _releaseCapture() {
    if (this._captureEl != null && this._captureId != null) {
      try {
        if (this._captureEl.hasPointerCapture?.(this._captureId)) {
          this._captureEl.releasePointerCapture(this._captureId);
        }
      } catch (_) { /* ignore */ }
    }
    this._captureEl = null;
    this._captureId = null;
  }

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width) / this.dpr,
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height) / this.dpr,
    };
  }

  setCursor(point) {
    const W = this.columns;
    const H = this.rows;
    point = gp(
      ((point.x % W) + W) % W,
      ((point.y % H) + H) % H,
    );
    if (gpEq(point, this.cursor)) return;
    this.cursor = point;
    this.onCursorMoved?.();
    this.paint();
    this._revealCursor();
  }

  moveCursor(dx, dy) {
    this.setCursor(gpOffset(this.cursor, dx, dy));
  }

  _revealCursor() {
    const r = Style.cellRect(this.cursor);
    const pad = Style.Padding;
    const left = r.x - pad;
    const top = r.y - pad;
    const right = r.x + r.w + pad;
    const bottom = r.y + r.h + pad;
    const s = this.scroll;
    if (left < s.scrollLeft) s.scrollLeft = left;
    if (top < s.scrollTop) s.scrollTop = top;
    if (right > s.scrollLeft + s.clientWidth) s.scrollLeft = right - s.clientWidth;
    if (bottom > s.scrollTop + s.clientHeight) s.scrollTop = bottom - s.clientHeight;
  }

  rebuild() {
    this._endDrag();
    this._endPlace(false);
    this._loopDrag = null;
    // Fixed toroidal grid (Pac-Man); default 32×16, min 2×2.
    this.columns = Math.max(2, this.score?.gridW || 32);
    this.rows = Math.max(2, this.score?.gridH || 16);
    const size = Style.planeSize(this.columns, this.rows);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = size.w + "px";
    this.canvas.style.height = size.h + "px";
    this.canvas.width = Math.floor(size.w * this.dpr);
    this.canvas.height = Math.floor(size.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paint();
  }

  refreshPlayheads() {
    const next = [];
    if (this.sequencer?.isPlaying) {
      for (const runner of this.sequencer.runners) {
        if (runner.playingLane && runner.playingStep >= 0) {
          next.push({ lane: runner.playingLane, step: runner.playingStep });
        }
      }
    }
    if (samePlayheads(next, this._playheads)) return;
    this._playheads = next;
    this.paint();
  }

  _pointerDown(e) {
    if (e.button !== 0) return;
    this.canvas.focus();
    const pos = this.localPoint(e);
    const point = Style.cellAt(pos);
    this.setCursor(point);
    ensureFxLists(this.score);

    // FX widget hits: grip (move), ON/OFF pads, param sliders (scrub or drag-out)
    const fxHit = this._hitFxWidget(pos);
    if (fxHit) {
      e.preventDefault();
      this.selectedFxId = fxHit.fxId;
      this.selectedAutoId = null;
      this.selectedPathId = null;
      this.onFxSelect?.(fxHit.fxId);
      if (fxHit.kind === "grip") {
        const mod = this.score.fxModules.find((m) => m.id === fxHit.fxId);
        this._fxMoveDrag = {
          fxId: fxHit.fxId,
          origin: pos,
          startX: mod?.x ?? 0,
          startY: mod?.y ?? 0,
          grabCell: point,
          armed: false,
        };
      } else if (fxHit.kind === "on" || fxHit.kind === "off") {
        this._trigDrag = {
          kind: fxHit.kind,
          fxId: fxHit.fxId,
          origin: pos,
          point,
          insideFx: true,
        };
      } else if (fxHit.kind === "slider") {
        // Immediate scrub to click position; drag-out when leaving the pedal
        const mod = this.score.fxModules.find((m) => m.id === fxHit.fxId);
        const def = FxTypes[mod?.type];
        const p = def?.params?.find((x) => x.key === fxHit.paramKey);
        let value = fxHit.hitValue;
        if (mod && p) {
          value = Math.min(p.max, Math.max(p.min, fxHit.hitValue));
          mod.params[fxHit.paramKey] = value;
        }
        this._sliderDrag = {
          fxId: fxHit.fxId,
          paramKey: fxHit.paramKey,
          bar: fxHit.bar,
          origin: pos,
          value,
          scrubbing: true,
          draggingOut: false,
          insideFx: true,
          point,
        };
        this._capture(this.canvas, e.pointerId);
        this.paint();
        return;
      }
      this._capture(this.canvas, e.pointerId);
      this.paint();
      return;
    }

    // Trigger pad on ground
    const trig = findTriggerAt(this.score, point);
    if (trig) {
      e.preventDefault();
      this.selectedAutoId = trig.id;
      this.selectedFxId = null;
      this.selectedPathId = null;
      this.onAutoSelect?.(trig.id);
      this.paint();
      return;
    }

    // Lane start (dal segno) or end (loop-back): click selects, drag reshapes
    const cellHit = this.score.at(point);
    if (cellHit.kind === CellKind.Head || cellHit.kind === CellKind.Term) {
      e.preventDefault();
      this.selectedAutoId = null;
      this.selectedFxId = null;
      this.selectedPathId = null;
      this.onAutoSelect?.(null);
      this._loopDrag = {
        lane: cellHit.lane,
        which: cellHit.kind === CellKind.Head ? "start" : "end",
        origin: pos,
        armed: false,
        hover: null,
        snap: cellHit.lane.snapshot(),
      };
      this._capture(this.canvas, e.pointerId);
      this.onCursorMoved?.();
      this.paint();
      return;
    }

    // Hit FX module body (select; drag from grip to move — body click selects)
    const fx = findFxAt(this.score, point);
    if (fx) {
      e.preventDefault();
      this.selectedFxId = fx.id;
      this.selectedAutoId = null;
      this.selectedPathId = null;
      this.onFxSelect?.(fx.id);
      // Allow dragging whole pedal from body if not on a control (pattern modules, etc.)
      this._fxMoveDrag = {
        fxId: fx.id,
        origin: pos,
        startX: fx.x,
        startY: fx.y,
        grabCell: point,
        armed: false,
      };
      this._capture(this.canvas, e.pointerId);
      this.paint();
      return;
    }

    const cell = this.score.at(point);

    // Double-click still quick-places a note on a free lane cell.
    if (e.detail >= 2 && this.score.placementLane(point)) {
      this.onDoubleClick?.();
      return;
    }

    // Lane place menu OR empty-ground morphic shell.
    const menuMode = this.menuModeAt?.(point)
      ?? (this.canPlaceAt?.(point)
        ? (this.score.placementLane(point) ? "lane" : "ground")
        : null);
    if (menuMode === "lane") {
      e.preventDefault();
      this.selectedAutoId = null;
      this.selectedFxId = null;
      this.selectedPathId = null;
      this.onAutoSelect?.(null);
      this._placing = true;
      const centre = this.placeCentreNote?.() ?? 60;
      this.placeMenu?.begin("lane", point, e, centre);
      this._capture(this.canvas, e.pointerId);
      this.paint();
      return;
    }
    if (menuMode === "ground") {
      e.preventDefault();
      this.selectedAutoId = null;
      this.selectedFxId = null;
      this.selectedPathId = null;
      this.onAutoSelect?.(null);
      this._groundGesture = {
        origin: { x: point.x, y: point.y },
        phase: "shell", // shell | lane | object
        path: [{ x: point.x, y: point.y }],
        cats: buildGroundObjectCategories(),
        catIndex: 0,
        itemIndex: -1,
        hover: { x: point.x, y: point.y },
      };
      this._capture(this.canvas, e.pointerId);
      this.paint();
      return;
    }

    // Space+drag or middle button could pan later; left-drag on inert cells pans
    // only after a movement threshold (see _pointerMove).
    if (cell.kind !== CellKind.Tile && cell.kind !== CellKind.Head) {
      e.preventDefault();
      this.selectedAutoId = null;
      this.selectedFxId = null;
      this.selectedPathId = null;
      this.onAutoSelect?.(null);
      this._panning = true;
      this._panArmed = false;
      this._panOrigin = {
        x: e.clientX,
        y: e.clientY,
        sl: this.scroll.scrollLeft,
        st: this.scroll.scrollTop,
      };
      this._capture(this.canvas, e.pointerId);
      return;
    }

    e.preventDefault();
    this.selectedAutoId = null;
    this.selectedFxId = null;
    this.selectedPathId = null;
    this.onAutoSelect?.(null);
    this._grabbed = cell;
    this._grabOrigin = pos;
    this._dragging = false;
    this._capture(this.canvas, e.pointerId);
  }

  _pointerMove(e) {
    // Hover tooltip when idle (no drag gesture)
    if (
      !this._loopDrag && !this._trigDrag && !this._sliderDrag && !this._fxMoveDrag &&
      !this._placing && !this._groundGesture && !this._panning && !this._grabbed
    ) {
      this._updateHoverTip(this.localPoint(e));
    }

    if (this._groundGesture) {
      this._updateGroundGesture(e);
      this.paint();
      return;
    }

    if (this._fxMoveDrag) {
      const pos = this.localPoint(e);
      const d = this._fxMoveDrag;
      const dist = Math.hypot(pos.x - d.origin.x, pos.y - d.origin.y);
      if (!d.armed) {
        if (dist < 5) return;
        d.armed = true;
      }
      const point = Style.cellAt(pos);
      const dx = point.x - d.grabCell.x;
      const dy = point.y - d.grabCell.y;
      const nx = d.startX + dx;
      const ny = d.startY + dy;
      d.hoverX = nx;
      d.hoverY = ny;
      // Live preview: apply if free, else keep last good
      if (this.onFxMovePreview?.(d.fxId, nx, ny)) {
        d.lastX = nx;
        d.lastY = ny;
      }
      this.paint();
      return;
    }

    if (this._trigDrag) {
      const pos = this.localPoint(e);
      const point = Style.cellAt(pos);
      this._trigDrag.point = point;
      const mod = this.score.fxModules.find((m) => m.id === this._trigDrag.fxId);
      this._trigDrag.insideFx = mod ? this._pointInFxPixels(mod, pos) : false;
      this.paint();
      return;
    }

    if (this._sliderDrag) {
      const pos = this.localPoint(e);
      const d = this._sliderDrag;
      const mod = this.score.fxModules.find((m) => m.id === d.fxId);
      const point = this.score.wrap(Style.cellAt(pos));
      d.point = point;
      const inside = mod ? this._pointInFxPixels(mod, pos) : false;
      d.insideFx = inside;
      const dist = Math.hypot(pos.x - d.origin.x, pos.y - d.origin.y);

      // Leave the pedal (or drag far) → drag-out a param trigger chip
      if ((!inside && dist > 6) || dist > Math.max(40, (d.bar?.w || 40) * 0.6)) {
        // Prefer drag-out when clearly outside; if still inside but moved a lot
        // vertically, also allow drag-out
        const dy = Math.abs(pos.y - d.origin.y);
        const dx = Math.abs(pos.x - d.origin.x);
        if (!inside || (dy > dx + 12 && dy > 16)) {
          d.draggingOut = true;
          d.scrubbing = false;
        }
      }

      if (!d.draggingOut && d.bar && mod) {
        d.scrubbing = true;
        const t = Math.min(1, Math.max(0, (pos.x - d.bar.x) / (d.bar.w || 1)));
        const def = FxTypes[mod.type];
        const p = def?.params?.find((x) => x.key === d.paramKey);
        if (p) {
          const v = p.min + t * (p.max - p.min);
          mod.params[d.paramKey] = v;
          d.value = v;
          // Lightweight repaint only — avoid full commit/resync mid-scrub
          this.paint();
          return;
        }
      }
      this.paint();
      return;
    }

    if (this._loopDrag) {
      const pos = this.localPoint(e);
      if (!this._loopDrag.armed) {
        if (Math.hypot(pos.x - this._loopDrag.origin.x, pos.y - this._loopDrag.origin.y) < 6) {
          return;
        }
        this._loopDrag.armed = true;
      }
      const point = this.score.wrap(Style.cellAt(pos));
      this._loopDrag.hover = point;
      // Live update start/end + active window every move
      this._applyLoopDragPreview();
      this.paint();
      return;
    }
    if (this._placing) {
      this.placeMenu?.update(e);
      this.paint();
      return;
    }
    if (this._panning) {
      const dx = e.clientX - this._panOrigin.x;
      const dy = e.clientY - this._panOrigin.y;
      // Require a real drag before scrolling — a click must not stick pan mode.
      if (!this._panArmed) {
        if (Math.hypot(dx, dy) < 6) return;
        this._panArmed = true;
      }
      this.scroll.scrollLeft = this._panOrigin.sl - dx;
      this.scroll.scrollTop = this._panOrigin.st - dy;
      return;
    }
    if (!this._grabbed) return;
    const pos = this.localPoint(e);
    const dx = pos.x - this._grabOrigin.x;
    const dy = pos.y - this._grabOrigin.y;
    if (!this._dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      this._dragging = true;
      this._dropPoint = this._grabbed.kind === CellKind.Head
        ? this._grabbed.lane.headPoint
        : this._grabbed.lane.cellPoint(this._grabbed.step, this._grabbed.depth);
      this._resolveDrop();
    }
    this._ghostDelta = { x: dx, y: dy };
    const point = Style.cellAt(pos);
    if (!gpEq(point, this._dropPoint)) {
      this._dropPoint = point;
      this._resolveDrop();
    }
    this.paint();
  }

  _pointerUp(e) {
    // Always release capture first so pan can never stick after mouse-up.
    this._releaseCapture();

    if (this._loopDrag) {
      const d = this._loopDrag;
      this._loopDrag = null;
      if (d.armed && d.hover) {
        // Restore original then hard-commit (truncate inactive / keep grow)
        if (d.snap) d.lane.restore(d.snap);
        this.score.commitReshape(d.lane, d.which, d.hover);
        this.onLoopReshaped?.();
      } else if (d.snap) {
        // Click without drag — restore any accidental preview
        d.lane.restore(d.snap);
      }
      this.paint();
      return;
    }
    if (this._fxMoveDrag) {
      const d = this._fxMoveDrag;
      this._fxMoveDrag = null;
      if (d.armed) {
        const x = d.lastX ?? d.startX;
        const y = d.lastY ?? d.startY;
        this.onFxMoved?.(d.fxId, x, y);
      }
      this.paint();
      return;
    }
    if (this._trigDrag) {
      const d = this._trigDrag;
      this._trigDrag = null;
      // Cancel if dropped back on the effect body
      if (!d.insideFx && d.point) {
        this.onTriggerPlaced?.({
          kind: d.kind,
          fxId: d.fxId,
          point: d.point,
        });
      }
      this.paint();
      return;
    }
    if (this._sliderDrag) {
      const d = this._sliderDrag;
      this._sliderDrag = null;
      if (d.draggingOut && !d.insideFx && d.point) {
        const mod = this.score.fxModules.find((m) => m.id === d.fxId);
        const val = mod?.params?.[d.paramKey] ?? d.value;
        this.onTriggerPlaced?.({
          kind: "param",
          fxId: d.fxId,
          paramKey: d.paramKey,
          value: val,
          point: d.point,
        });
      } else if (d.scrubbing) {
        this.onFxParamChanged?.(true);
      }
      this.paint();
      return;
    }
    if (this._groundGesture) {
      this._endGroundGesture(true);
      return;
    }
    if (this._placing) {
      this._endPlace(true);
      return;
    }
    if (this._panning) {
      this._panning = false;
      this._panArmed = false;
      return;
    }
    if (!this._grabbed) return;
    const grabbed = this._grabbed;
    const point = this._dropPoint;
    const dropped = this._dragging;
    this._endDrag();
    if (!dropped) return;
    if (grabbed.kind === CellKind.Head) this.onLaneDropped?.(grabbed.lane, point);
    else this.onTilesDropped?.(grabbed, point);
  }

  _endPlace(commit) {
    if (!this._placing) return;
    this._placing = false;
    if (commit && this.placeMenu) {
      const result = this.placeMenu.end();
      if (result) this.onPlaceCommit?.(result);
    } else {
      this.placeMenu?.cancel();
    }
    this.paint();
  }

  /** Apply live start/end reshape preview from current loop-drag hover. */
  _applyLoopDragPreview() {
    const d = this._loopDrag;
    if (!d?.lane || !d.hover || !d.snap) return;
    d.lane.restore(d.snap);
    if (d.which === "end") this.score.previewReshapeEnd(d.lane, d.hover);
    else this.score.previewReshapeStart(d.lane, d.hover);
  }

  // ---------------------------------------------------------------------------
  // Empty-ground morphic shell (create lane L/U/R · create object ↓)
  // ---------------------------------------------------------------------------

  _updateGroundGesture(e) {
    const g = this._groundGesture;
    if (!g || !this.score) return;
    const point = this.score.wrap(Style.cellAt(this.localPoint(e)));
    g.hover = point;
    const o = g.origin;
    const dx = point.x - o.x;
    const dy = point.y - o.y;
    // Toroidal-shortest for direction? Use raw for shell; path uses wrap cells.

    if (g.phase === "shell") {
      // Commit direction once we leave the origin cell
      if (point.x === o.x && point.y === o.y) return;
      // Down into the row below → object menu (locked for this gesture)
      if (dy > 0 && Math.abs(dy) >= Math.abs(dx)) {
        g.phase = "object";
        g.catIndex = 0;
        g.itemIndex = -1;
        this._syncGroundObjectSelection(g, point);
        return;
      }
      // Left / up / right → lane path (locked for this gesture)
      if (dx !== 0 || dy < 0) {
        g.phase = "lane";
        g.path = [{ x: o.x, y: o.y }];
        this._extendGroundLanePath(g, point);
        return;
      }
    }

    if (g.phase === "lane") {
      this._extendGroundLanePath(g, point);
      return;
    }

    if (g.phase === "object") {
      this._syncGroundObjectSelection(g, point);
    }
  }

  _extendGroundLanePath(g, target) {
    if (!this.score) return;
    target = this.score.wrap(target);
    let last = g.path[g.path.length - 1];
    // Already at end
    if (last.x === target.x && last.y === target.y) return;

    // Walk Manhattan toward target, appending free cells (or cells already in path)
    let guard = 0;
    const max = (this.score.gridW || 32) * (this.score.gridH || 16);
    while ((last.x !== target.x || last.y !== target.y) && guard++ < max) {
      // Prefer horizontal then vertical (toroidal shortest)
      const td = (() => {
        // simple non-toroidal step first for freeform feel
        let sx = Math.sign(target.x - last.x);
        let sy = Math.sign(target.y - last.y);
        if (sx === 0 && sy === 0) return null;
        // prefer larger delta axis
        if (Math.abs(target.x - last.x) >= Math.abs(target.y - last.y) && sx !== 0) {
          return { x: last.x + sx, y: last.y };
        }
        if (sy !== 0) return { x: last.x, y: last.y + sy };
        return { x: last.x + sx, y: last.y };
      })();
      if (!td) break;
      const np = this.score.wrap(gp(td.x, td.y));
      // Backtrack onto path: trim to that cell
      const back = g.path.findIndex((p) => p.x === np.x && p.y === np.y);
      if (back >= 0) {
        g.path = g.path.slice(0, back + 1);
        last = g.path[g.path.length - 1];
        continue;
      }
      // Blocked by existing content (except free ground)
      if (!this.score.isFree(np)) break;
      g.path.push({ x: np.x, y: np.y });
      last = np;
    }
  }

  _syncGroundObjectSelection(g, point) {
    // Menu is centered on the cell one row below origin
    const ox = g.origin.x;
    const menuY = g.origin.y + 1;
    const cats = g.cats;
    // Category row at menuY: two cells around ox (FX leftish, META rightish)
    // Horizontal: relative to ox → cat index
    const relX = point.x - ox;
    if (point.y <= g.origin.y) {
      // Still on origin row or above → dismiss band
      g.itemIndex = -1;
      g.catIndex = Math.min(cats.length - 1, Math.max(0, relX <= 0 ? 0 : 1));
      return;
    }
    // Category from horizontal offset
    let cat = relX <= 0 ? 0 : 1;
    cat = Math.min(cats.length - 1, Math.max(0, cat));
    g.catIndex = cat;
    // Items start at menuY + 1 (two rows below origin)
    const itemRow = point.y - (menuY + 1);
    if (itemRow < 0) {
      g.itemIndex = -1; // on category band — not yet armed
    } else {
      const items = cats[cat].items;
      g.itemIndex = Math.min(items.length - 1, Math.max(0, itemRow));
    }
  }

  _endGroundGesture(commit) {
    const g = this._groundGesture;
    this._groundGesture = null;
    if (!g || !commit) {
      this.paint();
      return;
    }

    if (g.phase === "lane" && g.path.length >= 1) {
      this.onPlaceCommit?.({
        point: g.origin,
        place: { kind: "LANE_PATH", path: g.path.slice() },
        mode: "ground",
      });
    } else if (g.phase === "object" && g.itemIndex >= 0) {
      const item = g.cats[g.catIndex]?.items[g.itemIndex];
      if (item) {
        this.onPlaceCommit?.({
          point: g.origin,
          place: item.place,
          mode: "ground",
        });
      }
    }
    // shell-only click (no commit direction) → dismiss
    this.paint();
  }

  /** Esc / cancel: abort menus and all drag modes. */
  cancelGestures() {
    this._releaseCapture();
    this._placing = false;
    this.placeMenu?.cancel();
    this._groundGesture = null;
    if (this._loopDrag?.snap) {
      this._loopDrag.lane.restore(this._loopDrag.snap);
    }
    if (this._fxMoveDrag) {
      const d = this._fxMoveDrag;
      const mod = this.score?.fxModules?.find((m) => m.id === d.fxId);
      if (mod) {
        mod.x = d.startX;
        mod.y = d.startY;
      }
    }
    this._loopDrag = null;
    this._trigDrag = null;
    this._sliderDrag = null;
    this._fxMoveDrag = null;
    this._panning = false;
    this._panArmed = false;
    this._endDrag();
    this.paint();
  }

  _endDrag() {
    this._grabbed = null;
    this._dragging = false;
    this._dropCells = [];
    this._ghostDelta = { x: 0, y: 0 };
  }

  _countLiftedTiles(target) {
    if (!this._grabbed || this._grabbed.kind === CellKind.Head) return 0;
    const drop = this.score.dropLane(target);
    if (drop && drop.lane === this._grabbed.lane && drop.step === this._grabbed.step) return 1;
    return this._grabbed.lane.steps[this._grabbed.step].tiles.length - this._grabbed.depth;
  }

  _resolveDrop() {
    this._dropCells = [];
    if (!this._grabbed) return;
    if (this._grabbed.kind === CellKind.Head) {
      const lane = this._grabbed.lane;
      if (this.score.canMoveLane(lane, this._dropPoint)) {
        const dx = this._dropPoint.x - lane.headX;
        const dy = this._dropPoint.y - lane.y;
        for (const cell of lane.occupiedCells()) {
          this._dropCells.push(gpOffset(cell, dx, dy));
        }
      }
    } else {
      this._liftCount = this._countLiftedTiles(this._dropPoint);
      const move = this.score.planMove(this._grabbed, this._dropPoint);
      if (move) {
        for (let i = 0; i < move.count; i++) {
          this._dropCells.push(move.lane.cellPoint(move.step, move.depth + i));
        }
      }
    }
  }

  paint() {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = Style.Background;
    ctx.fillRect(0, 0, w, h);
    if (!this.score) return;

    this._drawLattice(ctx);
    this._drawRails(ctx);
    this._drawChains(ctx);
    this._drawLinks(ctx);
    this._drawMarkers(ctx);
    this._drawTiles(ctx);
    this._drawFxWorld(ctx);
    this._drawPlayheads(ctx);
    this._drawCursor(ctx);
    this._drawDropCells(ctx);
    if (this._dragging && this._grabbed) this._drawGhosts(ctx);
    this._drawGestureGhosts(ctx);
    this._drawGroundShell(ctx);
  }

  /**
   * Morphic ground shell: L/U/R = create lane, one row below = create object.
   * Drawn on the grid at 0.8 opacity so the gesture is integral to the plane.
   */
  _drawGroundShell(ctx) {
    const g = this._groundGesture;
    if (!g) return;
    const o = g.origin;
    const shellAlpha = 0.8;

    // Origin cell highlight
    {
      const r = Style.cellRect(o);
      ctx.fillStyle = withAlpha("#f2f2ee", 0.12);
      roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
      ctx.fill();
      ctx.strokeStyle = withAlpha("#f2f2ee", 0.55);
      ctx.lineWidth = 1.5;
      roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
      ctx.stroke();
    }

    // Create-lane shells: left, above, right (while still deciding or as legend)
    if (g.phase === "shell" || g.phase === "lane") {
      const laneCells = [
        { x: o.x - 1, y: o.y },
        { x: o.x, y: o.y - 1 },
        { x: o.x + 1, y: o.y },
      ];
      for (const c of laneCells) {
        const p = this.score.wrap(gp(c.x, c.y));
        // Don't paint shell on occupied cells
        if (!this.score.isFree(p) && !(p.x === o.x && p.y === o.y)) continue;
        const r = Style.cellRect(p);
        const hot = g.phase === "lane" ||
          (g.hover && g.hover.x === p.x && g.hover.y === p.y);
        ctx.globalAlpha = shellAlpha;
        ctx.fillStyle = hot ? withAlpha("#6ee7b7", 0.35) : withAlpha("#34d399", 0.18);
        roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
        ctx.fill();
        ctx.strokeStyle = withAlpha("#6ee7b7", hot ? 0.95 : 0.55);
        ctx.lineWidth = hot ? 1.5 : 1;
        roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
        ctx.stroke();
        ctx.fillStyle = withAlpha("#d1fae5", 0.95);
        ctx.font = "600 8px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("create", r.x + r.w / 2, r.y + r.h / 2 - 5);
        ctx.fillText("lane", r.x + r.w / 2, r.y + r.h / 2 + 6);
        ctx.globalAlpha = 1;
      }
    }

    // Lane path preview
    if (g.phase === "lane" && g.path.length) {
      ctx.strokeStyle = withAlpha("#6ee7b7", 0.9);
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < g.path.length; i++) {
        const c = Style.cellCenter(g.path[i]);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      }
      ctx.stroke();
      for (let i = 0; i < g.path.length; i++) {
        const r = Style.cellRect(g.path[i]);
        ctx.fillStyle = withAlpha("#34d399", i === 0 ? 0.35 : 0.22);
        roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 4);
        ctx.fill();
        ctx.fillStyle = withAlpha("#ecfdf5", 0.95);
        ctx.font = "700 9px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i), r.x + r.w / 2, r.y + r.h / 2);
      }
      // Foot hint
      const last = g.path[g.path.length - 1];
      const lr = Style.cellRect(last);
      ctx.fillStyle = withAlpha("#a7f3d0", 0.9);
      ctx.font = "600 9px system-ui,sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("release → new lane (" + g.path.length + " steps)", lr.x, lr.y + lr.h + 4);
    }

    // Create-object shell: centered one row below origin
    if (g.phase === "shell" || g.phase === "object") {
      const menuY = o.y + 1;
      const cats = g.cats;
      // Category band spans roughly 3 cells centered under origin
      for (let i = 0; i < cats.length; i++) {
        const cx = o.x + (i === 0 ? -1 : 1);
        const p = this.score.wrap(gp(cx, menuY));
        // For single-cell center option when 2 cats: also paint middle
        const r = Style.cellRect(p);
        const catHot = g.phase === "object" && g.catIndex === i;
        ctx.globalAlpha = shellAlpha;
        ctx.fillStyle = catHot ? withAlpha("#c4b5fd", 0.4) : withAlpha("#8b7cf7", 0.2);
        roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
        ctx.fill();
        ctx.strokeStyle = withAlpha("#c4b5fd", catHot ? 0.95 : 0.55);
        ctx.lineWidth = catHot ? 1.5 : 1;
        roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
        ctx.stroke();
        ctx.fillStyle = withAlpha("#ede9fe", 0.95);
        ctx.font = "700 9px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cats[i].label, r.x + r.w / 2, r.y + r.h / 2 - 5);
        if (g.phase === "shell") {
          ctx.font = "600 7px system-ui,sans-serif";
          ctx.fillText("object", r.x + r.w / 2, r.y + r.h / 2 + 6);
        }
        ctx.globalAlpha = 1;
      }
      // Center cell under origin: "create object" label in shell phase
      {
        const p = this.score.wrap(gp(o.x, menuY));
        const r = Style.cellRect(p);
        ctx.globalAlpha = shellAlpha;
        ctx.fillStyle = withAlpha("#a78bfa", g.phase === "object" ? 0.28 : 0.16);
        roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
        ctx.fill();
        ctx.strokeStyle = withAlpha("#ddd6fe", 0.6);
        ctx.lineWidth = 1;
        roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
        ctx.stroke();
        ctx.fillStyle = withAlpha("#f5f3ff", 0.95);
        ctx.font = "600 8px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("create", r.x + r.w / 2, r.y + r.h / 2 - 5);
        ctx.fillText("object", r.x + r.w / 2, r.y + r.h / 2 + 6);
        ctx.globalAlpha = 1;
      }

      // Object items cascade below category row when in object phase
      if (g.phase === "object") {
        const cat = cats[g.catIndex];
        const colX = o.x + (g.catIndex === 0 ? -1 : 1);
        for (let i = 0; i < cat.items.length; i++) {
          const p = this.score.wrap(gp(colX, menuY + 1 + i));
          const r = Style.cellRect(p);
          const armed = g.itemIndex === i;
          ctx.globalAlpha = shellAlpha;
          ctx.fillStyle = armed ? withAlpha("#fde68a", 0.45) : withAlpha("#3f3f46", 0.55);
          roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
          ctx.fill();
          ctx.strokeStyle = armed ? withAlpha("#fbbf24", 0.95) : withAlpha("#a1a1aa", 0.4);
          ctx.lineWidth = armed ? 1.5 : 1;
          roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
          ctx.stroke();
          ctx.fillStyle = armed ? "#1c1917" : withAlpha("#e4e4e7", 0.95);
          ctx.font = "600 8px system-ui,sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const label = cat.items[i].label;
          ctx.fillText(label.length > 8 ? label.slice(0, 7) + "…" : label, r.x + r.w / 2, r.y + r.h / 2);
          ctx.globalAlpha = 1;
        }
        if (g.itemIndex >= 0) {
          const item = cat.items[g.itemIndex];
          const tip = Style.cellRect(this.score.wrap(gp(colX, menuY + 1 + g.itemIndex)));
          ctx.fillStyle = withAlpha("#fde68a", 0.95);
          ctx.font = "600 9px system-ui,sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText("release → " + item.label, tip.x, tip.y + tip.h + 3);
        } else {
          const tip = Style.cellRect(this.score.wrap(gp(o.x, menuY)));
          ctx.fillStyle = withAlpha("#c4b5fd", 0.9);
          ctx.font = "600 9px system-ui,sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText("↓ items · release on origin = dismiss", tip.x, tip.y + tip.h + 3);
        }
      }
    }
  }

  /** Pixel rect of an FX module on the canvas. */
  _fxPixelRect(mod) {
    const o = Style.cellOrigin({ x: mod.x, y: mod.y });
    return {
      x: o.x,
      y: o.y,
      w: mod.w * Style.StrideX - Style.Gap,
      h: mod.h * Style.StrideY - Style.Gap,
    };
  }

  _pointInFxPixels(mod, pos) {
    const r = this._fxPixelRect(mod);
    // Small pad so "leave pedal" for drag-out is unambiguous
    return pos.x >= r.x && pos.x <= r.x + r.w &&
      pos.y >= r.y && pos.y <= r.y + r.h;
  }

  /**
   * Shared layout for FX chrome — hit-testing and drawing MUST use this.
   * Top strip: [ON 24] [grip flex] [OFF 24]
   * Then param rows of 18px each.
   */
  _fxLayout(mod) {
    const def = FxTypes[mod.type] || FxTypes.delay;
    const o = Style.cellOrigin({ x: mod.x, y: mod.y });
    const w = mod.w * Style.StrideX - Style.Gap;
    const h = mod.h * Style.StrideY - Style.Gap;
    const isPat = !!def.patternOp;
    const pad = 4;
    const topH = 18;
    const onW = 26;
    const offW = 26;
    const on = { x: o.x + pad, y: o.y + pad, w: onW, h: topH };
    const off = { x: o.x + w - pad - offW, y: o.y + pad, w: offW, h: topH };
    const grip = isPat
      ? { x: o.x + pad, y: o.y + pad, w: w - pad * 2, h: topH }
      : {
        x: on.x + on.w + 3,
        y: o.y + pad,
        w: Math.max(16, off.x - (on.x + on.w + 6)),
        h: topH,
      };
    const bars = [];
    let y = o.y + pad + topH + 4;
    const rowH = 18;
    for (const p of def.params || []) {
      bars.push({
        key: p.key,
        label: p.label,
        min: p.min,
        max: p.max,
        def: p.def,
        row: { x: o.x + pad, y, w: w - pad * 2, h: rowH },
        bar: { x: o.x + pad + 2, y: y + 3, w: w - pad * 2 - 4, h: 12 },
      });
      y += rowH;
    }
    return { def, o, w, h, isPat, on, off, grip, bars, pad, topH };
  }

  _hitRect(pos, r) {
    return pos.x >= r.x && pos.x <= r.x + r.w &&
      pos.y >= r.y && pos.y <= r.y + r.h;
  }

  /** Hit grip, ON/OFF pads, or param sliders on any FX module. */
  _hitFxWidget(pos) {
    if (!this.score) return null;
    ensureFxLists(this.score);
    for (let i = this.score.fxModules.length - 1; i >= 0; i--) {
      const mod = this.score.fxModules[i];
      const L = this._fxLayout(mod);
      // Outside module?
      if (pos.x < L.o.x || pos.x > L.o.x + L.w ||
          pos.y < L.o.y || pos.y > L.o.y + L.h) continue;

      // Param sliders first (most of the body) — generous row hit
      if (!L.isPat) {
        for (const row of L.bars) {
          if (this._hitRect(pos, row.row)) {
            const t = Math.min(1, Math.max(0, (pos.x - row.bar.x) / (row.bar.w || 1)));
            const hitValue = row.min + t * (row.max - row.min);
            return {
              kind: "slider",
              fxId: mod.id,
              paramKey: row.key,
              value: mod.params[row.key] ?? row.def,
              bar: row.bar,
              hitValue,
            };
          }
        }
        if (this._hitRect(pos, L.on)) return { kind: "on", fxId: mod.id };
        if (this._hitRect(pos, L.off)) return { kind: "off", fxId: mod.id };
      }
      if (this._hitRect(pos, L.grip)) return { kind: "grip", fxId: mod.id };
      // Anywhere else on the pedal = grip/move
      return { kind: "grip", fxId: mod.id };
    }
    return null;
  }

  /** Resolve live FX state (from audio tick, or compute fallback for paint). */
  _fxLiveState() {
    if (this.fxLive) return this.fxLive;
    if (!this.score) return null;
    const playing = !!this.sequencer?.isPlaying;
    return computeFxLiveState(
      this.score,
      this.sequencer?.runners,
      playing,
      null,
      null,
    );
  }

  _updateHoverTip(pos) {
    if (!this.score) return;
    ensureFxLists(this.score);
    const point = Style.cellAt(pos);
    let tip = null;

    const trig = findTriggerAt(this.score, point);
    if (trig) {
      tip = {
        kind: "trig",
        id: trig.id,
        text: formatAutoLong(this.score, trig),
        x: pos.x,
        y: pos.y,
      };
    } else {
      const fx = findFxAt(this.score, point);
      if (fx) {
        const def = FxTypes[fx.type] || FxTypes.delay;
        const status = def.patternOp
          ? ""
          : (fx.on ? " · ON (insert)" : " · off (bypass)");
        tip = {
          kind: "fx",
          id: fx.id,
          text: def.name + status + " — drag ON/OFF pads or a slider value onto the grid",
          x: pos.x,
          y: pos.y,
        };
      }
    }

    const prev = this._hoverTip;
    const same =
      (!prev && !tip) ||
      (prev && tip && prev.kind === tip.kind && prev.id === tip.id && prev.text === tip.text);
    this._hoverTip = tip;
    this.canvas.title = tip?.text || "";
    if (!same) this.paint();
  }

  _drawFxWorld(ctx) {
    if (!this.score) return;
    ensureFxLists(this.score);
    const live = this._fxLiveState();
    const phase = (this._anim || 0) * 0.12;
    const pulse = 0.55 + 0.45 * Math.sin(phase);

    // Modules first
    for (const mod of this.score.fxModules) {
      this._drawFxModule(ctx, mod, mod.id === this.selectedFxId, live, pulse);
    }

    // Adjacency triggers (ON / OFF / param)
    for (const trig of this.score.fxTriggers) {
      this._drawTrigger(ctx, trig, live, pulse);
    }

    if (this._hoverTip?.text) {
      this._drawHoverTip(ctx, this._hoverTip);
    }
  }

  _drawTrigger(ctx, trig, live, pulse) {
    const selected = trig.id === this.selectedAutoId;
    const firing = !!live?.activeTrigIds?.has(trig.id);
    const near = triggerAdjacentToAnyLane(this.score, trig);
    const alpha = near ? 1 : 0.5;
    const o = Style.cellOrigin(trig);
    const cx = o.x + Style.CellWidth / 2;
    const cy = o.y + Style.CellHeight / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    let fill = "#a3a3a3";
    let label = "?";
    if (trig.kind === "on") {
      fill = firing ? "#86efac" : "#4ade80";
      label = "ON";
    } else if (trig.kind === "off") {
      fill = firing ? "#fca5a5" : "#f87171";
      label = "OFF";
    } else if (trig.kind === "chan") {
      // Cyan: instrument / channel param
      fill = firing ? "#a5f3fc" : "#22d3ee";
      label = formatAutoShort(trig.paramKey, trig.value);
    } else {
      // Gold: FX param
      fill = firing ? "#fde68a" : "#fbbf24";
      label = formatAutoShort(trig.paramKey, trig.value);
    }

    if (firing) {
      ctx.shadowColor = fill;
      ctx.shadowBlur = 10 + 6 * pulse;
    }
    const r = Style.cellRect(trig);
    roundRect(ctx, r.x + 3, r.y + 5, r.w - 6, r.h - 10, 4);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = selected ? "#fff" : withAlpha("#000", 0.35);
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#1c1917";
    ctx.font = "700 " + (label.length > 3 ? "8" : "9") + "px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  _drawFxModule(ctx, mod, selected, live, pulse) {
    const L = this._fxLayout(mod);
    const { def, o, w, h, isPat, on: onR, off: offR, grip, bars } = L;
    const powered = !!mod.on;
    const patternOn = !!live?.activePatternIds?.has(mod.id);

    // Body (never dim controls below — only tint body when bypassed)
    ctx.save();
    ctx.fillStyle = selected
      ? (isPat ? "#1a2e24" : "#2a2438")
      : (isPat ? "#152018" : "#1e1e28");
    if (!isPat && !powered) ctx.globalAlpha = 0.72;
    ctx.strokeStyle = selected
      ? (isPat ? "#6ee7b7" : "#e9e5ff")
      : (powered || patternOn
        ? (isPat ? "#6ee7b7" : "#c4b5fd")
        : (isPat ? "#3f6b55" : "#6d6a7a"));
    ctx.lineWidth = selected ? 2.5 : (powered || patternOn ? 1.8 : 1);
    if (selected) {
      ctx.shadowColor = "#f2f2ee";
      ctx.shadowBlur = 10;
    } else if (powered || patternOn) {
      ctx.shadowColor = isPat ? "#34d399" : "#a78bfa";
      ctx.shadowBlur = 8 + 4 * pulse;
    }
    roundRect(ctx, o.x, o.y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Selection ring (replaces cell cursor for multi-cell objects)
    if (selected) {
      ctx.strokeStyle = "#f2f2ee";
      ctx.lineWidth = 2;
      roundRect(ctx, o.x - 3, o.y - 3, w + 6, h + 6, 8);
      ctx.stroke();
    }

    if (!isPat) {
      // ON
      ctx.fillStyle = powered ? "#4ade80" : "#3f3f46";
      roundRect(ctx, onR.x, onR.y, onR.w, onR.h, 3);
      ctx.fill();
      ctx.strokeStyle = powered ? "#bbf7d0" : "#52525b";
      ctx.lineWidth = 1;
      roundRect(ctx, onR.x + 0.5, onR.y + 0.5, onR.w - 1, onR.h - 1, 3);
      ctx.stroke();
      ctx.fillStyle = powered ? "#14532d" : "#d4d4d8";
      ctx.font = "700 9px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ON", onR.x + onR.w / 2, onR.y + onR.h / 2);

      // OFF
      ctx.fillStyle = !powered ? "#f87171" : "#3f3f46";
      roundRect(ctx, offR.x, offR.y, offR.w, offR.h, 3);
      ctx.fill();
      ctx.strokeStyle = !powered ? "#fecaca" : "#52525b";
      roundRect(ctx, offR.x + 0.5, offR.y + 0.5, offR.w - 1, offR.h - 1, 3);
      ctx.stroke();
      ctx.fillStyle = !powered ? "#7f1d1d" : "#d4d4d8";
      ctx.fillText("OFF", offR.x + offR.w / 2, offR.y + offR.h / 2);

      // Grip — bright so it's obvious
      ctx.fillStyle = selected ? "#71717a" : "#52525b";
      roundRect(ctx, grip.x, grip.y, grip.w, grip.h, 3);
      ctx.fill();
      ctx.strokeStyle = "#a1a1aa";
      ctx.lineWidth = 1;
      roundRect(ctx, grip.x + 0.5, grip.y + 0.5, grip.w - 1, grip.h - 1, 3);
      ctx.stroke();
      const gcx = grip.x + grip.w / 2;
      const gcy = grip.y + grip.h / 2;
      ctx.fillStyle = "#e4e4e7";
      for (let col = -2; col <= 2; col++) {
        for (let row = -1; row <= 1; row++) {
          ctx.beginPath();
          ctx.arc(gcx + col * 3.5, gcy + row * 3.5, 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = selected ? "#3f6b55" : "#2a4034";
      roundRect(ctx, grip.x, grip.y, grip.w, grip.h, 3);
      ctx.fill();
      ctx.fillStyle = "#86efac";
      ctx.font = "600 9px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.label + " · drag", grip.x + grip.w / 2, grip.y + grip.h / 2);
    }

    // Param bars
    const liveP = live?.liveParams?.get(mod.id) || mod.params;
    const ticksByParam = new Map();
    for (const t of this.score.fxTriggers) {
      if (t.targetFxId !== mod.id || t.kind !== "param") continue;
      if (!ticksByParam.has(t.paramKey)) ticksByParam.set(t.paramKey, []);
      ticksByParam.get(t.paramKey).push(t.value);
    }

    for (const row of bars) {
      const val = liveP[row.key] ?? mod.params[row.key] ?? row.def;
      const t = (val - row.min) / (row.max - row.min || 1);
      const b = row.bar;
      ctx.fillStyle = "#18181b";
      roundRect(ctx, b.x, b.y, b.w, b.h, 2);
      ctx.fill();
      ctx.fillStyle = "#8b7cf7";
      const fw = Math.max(2, b.w * Math.min(1, Math.max(0, t)));
      roundRect(ctx, b.x, b.y, fw, b.h, 2);
      ctx.fill();
      // ticks
      for (const tv of ticksByParam.get(row.key) || []) {
        const tt = (tv - row.min) / (row.max - row.min || 1);
        const tx = b.x + b.w * Math.min(1, Math.max(0, tt));
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(tx, b.y - 1);
        ctx.lineTo(tx, b.y + b.h + 1);
        ctx.stroke();
      }
      ctx.fillStyle = "#e4e4e7";
      ctx.font = "600 8px system-ui,sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        row.label + " " + formatAutoShort(row.key, val),
        b.x + 3,
        b.y + b.h / 2,
      );
    }
    ctx.restore();
  }


  _drawHoverTip(ctx, tip) {
    const pad = 6;
    ctx.font = "600 11px system-ui,sans-serif";
    const tw = ctx.measureText(tip.text).width;
    const x = Math.min(
      tip.x + 14,
      this.columns * Style.StrideX + Style.Padding - tw - pad * 2 - 8,
    );
    const y = Math.max(Style.Padding + 4, tip.y - 28);
    const w = tw + pad * 2;
    const h = 20;
    ctx.fillStyle = withAlpha("#0c0c10", 0.92);
    ctx.strokeStyle = withAlpha("#fbbf24", 0.55);
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f5f5f4";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(tip.text, x + pad, y + h / 2);
  }

  _drawGestureGhosts(ctx) {
    // ON/OFF/param drag ghost
    if (this._trigDrag?.point && !this._trigDrag.insideFx) {
      const pt = this._trigDrag.point;
      const o = Style.cellCenter(pt);
      const valid = this.onIsValidTrigger?.(pt) !== false;
      ctx.globalAlpha = valid ? 1 : 0.5;
      ctx.fillStyle = this._trigDrag.kind === "on" ? "#4ade80"
        : this._trigDrag.kind === "off" ? "#f87171" : "#fbbf24";
      roundRect(ctx, o.x - 12, o.y - 8, 24, 16, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1c1917";
      ctx.font = "700 9px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this._trigDrag.kind === "param" ? "P" : this._trigDrag.kind.toUpperCase(), o.x, o.y);
    }
    if (this._sliderDrag?.draggingOut && this._sliderDrag.point && !this._sliderDrag.insideFx) {
      const pt = this._sliderDrag.point;
      const o = Style.cellCenter(pt);
      const short = formatAutoShort(this._sliderDrag.paramKey, this._sliderDrag.value);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#fbbf24";
      roundRect(ctx, o.x - 14, o.y - 8, 28, 16, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1c1917";
      ctx.font = "700 8px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(short, o.x, o.y);
    }
    if (this._fxMoveDrag?.armed) {
      const mod = this.score.fxModules.find((m) => m.id === this._fxMoveDrag.fxId);
      if (mod) {
        const x = this._fxMoveDrag.hoverX ?? mod.x;
        const y = this._fxMoveDrag.hoverY ?? mod.y;
        const o = Style.cellOrigin({ x, y });
        const w = mod.w * Style.StrideX - Style.Gap;
        const h = mod.h * Style.StrideY - Style.Gap;
        ctx.strokeStyle = withAlpha("#c4b5fd", 0.9);
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        roundRect(ctx, o.x, o.y, w, h, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawLattice(ctx) {
    ctx.fillStyle = Style.Dot;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.columns; x++) {
        const point = gp(x, y);
        if (this.score.at(point).kind !== CellKind.Empty) continue;
        const c = Style.cellCenter(point);
        const s = Style.LatticeDot;
        ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s);
      }
    }
  }

  _drawRails(ctx) {
    for (const lane of this.score.lanes) {
      lane.ensurePath();
      if (lane.circular && lane.path.length >= 2) {
        this._drawCircularRail(ctx, lane);
        continue;
      }
      // Polyline rail: active segments full opacity, inactive at 0.5
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      for (let i = 0; i < lane.path.length - 1; i++) {
        const a = Style.cellCenter(lane.path[i]);
        const b = Style.cellCenter(lane.path[i + 1]);
        const on = lane.isStepActive(i) && lane.isStepActive(i + 1);
        ctx.strokeStyle = withAlpha(Style.NoteLine, on ? Style.RailOpacity : Style.RailOpacity * 0.5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Single-step rail tick
      if (lane.path.length === 1) {
        const c = Style.cellCenter(lane.path[0]);
        const on = lane.isStepActive(0);
        ctx.strokeStyle = withAlpha(Style.NoteLine, on ? Style.RailOpacity : Style.RailOpacity * 0.5);
        ctx.beginPath();
        ctx.moveTo(c.x - 4, c.y);
        ctx.lineTo(c.x + 4, c.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Drop target highlight while reshaping
      if (this._loopDrag?.lane === lane && this._loopDrag.hover && this._loopDrag.armed) {
        const h = Style.cellRect(this._loopDrag.hover);
        ctx.strokeStyle = withAlpha(Style.Cursor, 0.85);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        roundRect(ctx, h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1, Style.Radius);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawCircularRail(ctx, lane) {
    // Seamless tape-loop: points around centroid, animated dash offset
    const pts = lane.path.map((p) => Style.cellCenter(p));
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    // If path is nearly collinear, invent a small loop radius from length
    let spread = 0;
    for (const p of pts) spread = Math.max(spread, Math.hypot(p.x - cx, p.y - cy));
    const r = Math.max(Style.StrideX * 1.2, spread * 0.9 + Style.CellWidth);

    ctx.strokeStyle = withAlpha(Style.NoteLine, 0.55);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -((this._anim || 0) * 0.6) % 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Step ticks around the circle (flowing forever)
    const n = lane.path.length;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + ((this._anim || 0) * 0.01);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ctx.fillStyle = Style.NoteLine;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawChains(ctx) {
    ctx.strokeStyle = Style.NoteLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const lane of this.score.lanes) {
      for (let i = 0; i < lane.steps.length; i++) {
        for (let d = 1; d < lane.steps[i].depth; d++) {
          const origin = Style.cellOrigin(lane.cellPoint(i, d));
          const x = origin.x + Math.floor(Style.CellWidth / 2) + 0.5;
          ctx.moveTo(x, origin.y - Style.Gap - 1);
          ctx.lineTo(x, origin.y + 1);
        }
      }
    }
    ctx.stroke();
  }

  _drawLinks(ctx) {
    ctx.strokeStyle = Style.Link;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const lane of this.score.lanes) {
      if (!lane.jumpSource) continue;
      const source = this.score.locate(lane.jumpSource);
      if (!source) continue;
      const a = Style.cellCenter(source);
      const b = Style.cellCenter(lane.headPoint);
      const midY = Style.cellCenter(gpOffset(lane.headPoint, 0, -1)).y + Style.LinkOffset;
      const pts = [
        { x: a.x + Style.LinkOffset, y: a.y },
        { x: a.x + Style.LinkOffset, y: midY },
        { x: b.x + Style.LinkOffset, y: midY },
        { x: b.x + Style.LinkOffset, y: b.y },
      ];
      ctx.beginPath();
      roundedPath(ctx, pts, Style.LinkRadius);
      ctx.stroke();
    }
  }

  _drawMarkers(ctx) {
    for (const lane of this.score.lanes) {
      for (let i = 0; i < lane.steps.length; i++) {
        if (!lane.steps[i].isEmpty) continue;
        const active = lane.isStepActive(i);
        ctx.fillStyle = withAlpha(Style.Marker, active ? 1 : 0.5);
        const o = Style.cellOrigin(lane.cellPoint(i, 0));
        const x = o.x + Math.floor((Style.CellWidth - 7) / 2);
        const y = o.y + Math.floor((Style.CellHeight - 9) / 2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 7, y + 4.5);
        ctx.lineTo(x, y + 9);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  _drawTiles(ctx) {
    for (const lane of this.score.lanes) {
      lane.ensurePath();
      if (lane.circular) {
        this._drawCircularJoin(ctx, lane.headPoint);
      } else {
        this._drawStartMark(ctx, lane.headPoint, lane.head);
        this._drawTile(ctx, Terminator, lane.termPoint, 1);
      }
      for (let i = 0; i < lane.steps.length; i++) {
        const active = lane.isStepActive(i);
        // Deselected (outside start–end window): still readable at half opacity
        const alpha = active ? 1 : 0.5;
        for (let d = 0; d < lane.steps[i].depth; d++) {
          const lifted = this._isLifted(lane, i, d);
          this._drawTile(
            ctx,
            lane.steps[i].tiles[d],
            lane.cellPoint(i, d),
            lifted ? 0.2 : alpha,
          );
        }
        // Empty inactive rails: faint cell outline so the strip stays visible
        if (lane.steps[i].isEmpty && !active) {
          const r = Style.cellRect(lane.path[i]);
          ctx.strokeStyle = withAlpha(Style.NoteLine, 0.35);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, Style.Radius);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  /** Dal segno-style return mark at lane start (before first beat). */
  _drawStartMark(ctx, point, head) {
    const r = Style.cellRect(point);
    ctx.save();
    ctx.strokeStyle = Style.NoteLine;
    ctx.fillStyle = Style.ControlBackground;
    ctx.lineWidth = 1;
    roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
    ctx.fill();
    ctx.stroke();
    // Segno-like S with dots + channel abbr
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.fillStyle = Style.NoteText;
    ctx.font = "700 13px Georgia,serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("𝄋", cx, cy - 4);
    if (head && head.shortName) {
      ctx.font = "600 8px system-ui,sans-serif";
      ctx.fillText(head.shortName, cx, cy + 9);
    }
    ctx.restore();
  }

  /** Combined start/end when loop is circular — two mating triangles. */
  _drawCircularJoin(ctx, point) {
    const r = Style.cellRect(point);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.save();
    ctx.fillStyle = Style.ControlBackground;
    ctx.strokeStyle = Style.NoteLine;
    ctx.lineWidth = 1;
    roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
    ctx.fill();
    ctx.stroke();
    // Upper-left triangle and lower-right triangle that mate
    ctx.fillStyle = Style.NoteText;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 8);
    ctx.lineTo(cx + 2, cy - 8);
    ctx.lineTo(cx - 8, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy + 8);
    ctx.lineTo(cx - 2, cy + 8);
    ctx.lineTo(cx + 8, cy - 2);
    ctx.closePath();
    ctx.fill();
    // Tiny infinity / loop cue
    ctx.strokeStyle = withAlpha(Style.NoteLine, 0.7);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 5, 3, -0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _isLifted(lane, step, depth) {
    if (!this._dragging || !this._grabbed) return false;
    if (this._grabbed.kind === CellKind.Head) {
      return this._grabbed.lane === lane;
    }
    if (this._grabbed.lane !== lane || this._grabbed.step !== step) return false;
    const count = this._liftCount;
    return depth >= this._grabbed.depth && depth < this._grabbed.depth + count;
  }

  _drawTile(ctx, tile, point, alpha) {
    const r = Style.cellRect(point);
    ctx.save();
    ctx.globalAlpha = alpha;
    const control = isControlTile(tile);
    if (control) {
      roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
      ctx.fillStyle = Style.ControlBackground;
      ctx.fill();
    } else {
      ctx.strokeStyle = Style.NoteLine;
      ctx.lineWidth = 1;
      roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
      ctx.stroke();
    }
    drawTileContent(ctx, tile, r);
    ctx.restore();
  }

  _drawPlayheads(ctx) {
    ctx.fillStyle = Style.Playhead;
    for (const { lane, step } of this._playheads) {
      if (step < 0 || step >= lane.steps.length) continue;
      const origin = Style.cellOrigin(lane.cellPoint(step, 0));
      const depth = Math.max(1, lane.steps[step].depth);
      const height = depth * Style.StrideY - Style.Gap;
      ctx.fillRect(origin.x - Style.Gap + 1, origin.y, 3, height);
    }
  }

  _drawCursor(ctx) {
    // When an FX pedal is selected, selection ring is drawn on the module itself
    // — never paint a single-cell cursor on top of multi-cell objects.
    ensureFxLists(this.score);
    if (this.selectedFxId) {
      // optional: no cell outline at all while FX is selected
    } else {
      const r = Style.cellRect(this.cursor);
      ctx.strokeStyle = Style.Cursor;
      ctx.lineWidth = 1;
      roundRect(ctx, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, Style.Radius + 2);
      ctx.stroke();
    }

    // While the place menu is open, fill the target cell so the "empty slot" is obvious.
    if (this._placing && this.placeMenu?.point) {
      const pr = Style.cellRect(this.placeMenu.point);
      ctx.fillStyle = withAlpha(Style.Cursor, 0.12);
      roundRect(ctx, pr.x, pr.y, pr.w, pr.h, Style.Radius);
      ctx.fill();
      ctx.strokeStyle = withAlpha(Style.Cursor, 0.85);
      ctx.setLineDash([3, 3]);
      roundRect(ctx, pr.x + 0.5, pr.y + 0.5, pr.w - 1, pr.h - 1, Style.Radius);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _drawDropCells(ctx) {
    if (!this._dropCells.length) return;
    for (const point of this._dropCells) {
      const r = Style.cellRect(point);
      ctx.fillStyle = withAlpha(Style.Cursor, 0.14);
      roundRect(ctx, r.x, r.y, r.w, r.h, Style.Radius);
      ctx.fill();
      ctx.strokeStyle = withAlpha(Style.Cursor, 0.7);
      ctx.lineWidth = 1;
      roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, Style.Radius);
      ctx.stroke();
    }
  }

  _drawGhosts(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(this._ghostDelta.x, this._ghostDelta.y);
    if (this._grabbed.kind === CellKind.Head) {
      const lane = this._grabbed.lane;
      this._drawTile(ctx, lane.head, lane.headPoint, 1);
      this._drawTile(ctx, Terminator, lane.termPoint, 1);
      for (let i = 0; i < lane.steps.length; i++) {
        for (let d = 0; d < lane.steps[i].depth; d++) {
          this._drawTile(ctx, lane.steps[i].tiles[d], lane.cellPoint(i, d), 1);
        }
      }
    } else {
      const tiles = this._grabbed.lane.steps[this._grabbed.step].tiles;
      const count = this._liftCount;
      for (let i = 0; i < count; i++) {
        this._drawTile(
          ctx,
          tiles[this._grabbed.depth + i],
          this._grabbed.lane.cellPoint(this._grabbed.step, this._grabbed.depth + i),
          1,
        );
      }
    }
    ctx.restore();
  }
}

function samePlayheads(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].lane !== b[i].lane || a[i].step !== b[i].step) return false;
  }
  return true;
}

function isControlTile(tile) {
  return tile instanceof ParamTile ||
    tile instanceof CycleGateTile ||
    tile instanceof ProbGateTile ||
    tile instanceof TerminatorTile ||
    tile instanceof JumpTile ||
    tile instanceof JumpDestTile;
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundedPath(ctx, points, radius) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const a = toward(points[i], points[i - 1], radius);
    const b = toward(points[i], points[i + 1], radius);
    ctx.lineTo(a.x, a.y);
    ctx.quadraticCurveTo(points[i].x, points[i].y, b.x, b.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function toward(from, to, distance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-5);
  const t = Math.min(distance, length / 2) / length;
  return { x: from.x + dx * t, y: from.y + dy * t };
}

// ---------------------------------------------------------------------------
// Tile icons / labels
// ---------------------------------------------------------------------------

function drawTileContent(ctx, tile, r) {
  if (tile instanceof NoteTile) {
    drawNote(ctx, tile, r);
    return;
  }
  if (tile instanceof ChannelTile) {
    ctx.fillStyle = Style.NoteText;
    const abbr = tile.shortName || ("CH" + tile.channel);
    const size = abbr.length > 3 ? 9 : abbr.length > 2 ? 10 : 11;
    ctx.font = "600 " + size + "px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(abbr, r.x + r.w / 2, r.y + r.h / 2);
    return;
  }
  if (tile instanceof CycleGateTile) {
    drawCycle(ctx, tile, r);
    return;
  }
  if (tile instanceof ProbGateTile) {
    drawProb(ctx, tile, r);
    return;
  }
  if (tile instanceof ParamTile) {
    drawParam(ctx, tile, r);
    return;
  }
  if (tile instanceof TerminatorTile) {
    drawUTurn(ctx, r);
    return;
  }
  if (tile instanceof JumpTile) {
    drawZigzag(ctx, r);
    return;
  }
  if (tile instanceof JumpDestTile) {
    drawEntry(ctx, r);
  }
}

function drawNote(ctx, tile, r) {
  const name = Pitch.toClassName(tile.note);
  const letter = name[0];
  const sharp = name.length > 1;
  const octave = String(Pitch.toOctave(tile.note));
  ctx.fillStyle = Style.NoteText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 - (tile.hasDefaultLength ? 0 : 4);
  ctx.font = "600 15px system-ui,sans-serif";
  if (sharp) {
    ctx.fillText(letter, cx - 5, cy);
    ctx.font = "600 9px system-ui,sans-serif";
    ctx.fillText("♯", cx + 1, cy - 4);
    ctx.font = "600 15px system-ui,sans-serif";
    ctx.fillText(octave, cx + 8, cy);
  } else {
    ctx.fillText(letter + octave, cx, cy);
  }
  if (!tile.hasDefaultLength) {
    ctx.font = "500 9px system-ui,sans-serif";
    ctx.fillStyle = Style.Marker;
    ctx.fillText(String(tile.length), cx, r.y + r.h - 8);
  }
}

function drawCycle(ctx, gate, r) {
  const period = gate.period;
  const span = Style.CellWidth - 3;
  const gap = period > 6 ? 1 : 2;
  const w = Math.min(5, Math.floor((span + gap) / period) - gap);
  const total = period * (w + gap) - gap + 1;
  const h = 8;
  const ox = r.x + Math.floor((Style.CellWidth - total) / 2);
  const oy = r.y + Math.floor((Style.CellHeight - (h + 1)) / 2);
  ctx.strokeStyle = Style.NoteText;
  ctx.fillStyle = Style.NoteText;
  ctx.lineWidth = 1;
  for (let i = 0; i < period; i++) {
    const x = ox + i * (w + gap) + 0.5;
    const y = oy + 0.5;
    if (i === gate.index - 1) ctx.fillRect(x, y, w, h);
    else ctx.strokeRect(x, y, w, h);
  }
}

function drawProb(ctx, gate, r) {
  const c = 5.5;
  const rad = 5;
  const ox = r.x + Math.floor((Style.CellWidth - 11) / 2);
  const oy = r.y + Math.floor((Style.CellHeight - 11) / 2);
  const cx = ox + c;
  const cy = oy + c;
  ctx.fillStyle = Style.NoteText;
  ctx.strokeStyle = Style.NoteText;
  ctx.lineWidth = 1;
  if (gate.percent >= 100) {
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  } else if (gate.percent > 0) {
    const a = (gate.percent / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - rad);
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + a);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.stroke();
}

function drawParam(ctx, tile, r) {
  const o = {
    x: r.x + Math.floor((Style.CellWidth - 15) / 2),
    y: r.y + Math.floor((Style.CellHeight - 15) / 2),
  };
  ctx.strokeStyle = Style.NoteText;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cx = tile.absolute ? 7.5 : 4.5;
  const cy = 6;
  const kw = 6;
  const kh = 3;
  const top = cy - kh / 2;
  const bottom = cy + kh / 2;
  ctx.beginPath();
  ctx.moveTo(o.x + cx, o.y + 1.5);
  ctx.lineTo(o.x + cx, o.y + top);
  ctx.moveTo(o.x + cx, o.y + bottom);
  ctx.lineTo(o.x + cx, o.y + 13.5);
  ctx.stroke();
  ctx.strokeRect(o.x + cx - kw / 2, o.y + top, kw, kh);
  if (!tile.absolute) {
    const ux = 11.5;
    ctx.beginPath();
    ctx.moveTo(o.x + ux, o.y + 1.5);
    ctx.lineTo(o.x + ux, o.y + 13.5);
    ctx.stroke();
    // chevrons
    ctx.beginPath();
    ctx.moveTo(o.x + ux - 2, o.y + 1.5 + 2.8);
    ctx.lineTo(o.x + ux, o.y + 1.5);
    ctx.lineTo(o.x + ux + 2, o.y + 1.5 + 2.8);
    ctx.moveTo(o.x + ux - 2, o.y + 13.5 - 2.8);
    ctx.lineTo(o.x + ux, o.y + 13.5);
    ctx.lineTo(o.x + ux + 2, o.y + 13.5 - 2.8);
    ctx.stroke();
  }
}

function drawUTurn(ctx, r) {
  const o = {
    x: r.x + Math.floor((Style.CellWidth - 15) / 2),
    y: r.y + Math.floor((Style.CellHeight - 15) / 2),
  };
  ctx.strokeStyle = Style.NoteText;
  ctx.fillStyle = Style.NoteText;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const y0 = 2.5;
  const y1 = 10.5;
  const xr = 9.5;
  ctx.beginPath();
  ctx.moveTo(o.x + 2.5, o.y + y0);
  ctx.lineTo(o.x + xr, o.y + y0);
  ctx.arc(o.x + xr, o.y + (y0 + y1) / 2, (y1 - y0) / 2, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(o.x + 4.4, o.y + y1);
  ctx.stroke();
  // arrow head left
  ctx.beginPath();
  ctx.moveTo(o.x + 2, o.y + y1);
  ctx.lineTo(o.x + 5, o.y + y1 - 2.4);
  ctx.lineTo(o.x + 5, o.y + y1 + 2.4);
  ctx.closePath();
  ctx.fill();
}

function drawZigzag(ctx, r) {
  const o = {
    x: r.x + Math.floor((Style.CellWidth - 15) / 2),
    y: r.y + Math.floor((Style.CellHeight - 15) / 2),
  };
  ctx.strokeStyle = Style.NoteText;
  ctx.fillStyle = Style.NoteText;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const y0 = 3.5;
  const y1 = 10.5;
  const x0 = 2.5;
  const x1 = 10.5;
  const x2 = 4.5;
  const x3 = 10.4;
  const rad = 1.7;
  const length = Math.hypot(x2 - x1, y1 - y0);
  const ux = (x2 - x1) / length * rad;
  const uy = (y1 - y0) / length * rad;
  ctx.beginPath();
  ctx.moveTo(o.x + x0, o.y + y0);
  ctx.lineTo(o.x + x1 - rad, o.y + y0);
  ctx.quadraticCurveTo(o.x + x1, o.y + y0, o.x + x1 + ux, o.y + y0 + uy);
  ctx.lineTo(o.x + x2 - ux, o.y + y1 - uy);
  ctx.quadraticCurveTo(o.x + x2, o.y + y1, o.x + x2 + rad, o.y + y1);
  ctx.lineTo(o.x + x3, o.y + y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(o.x + x3 + 3, o.y + y1);
  ctx.lineTo(o.x + x3, o.y + y1 - 2.2);
  ctx.lineTo(o.x + x3, o.y + y1 + 2.2);
  ctx.closePath();
  ctx.fill();
}

function drawEntry(ctx, r) {
  const o = {
    x: r.x + Math.floor((Style.CellWidth - 15) / 2),
    y: r.y + Math.floor((Style.CellHeight - 15) / 2),
  };
  ctx.strokeStyle = Style.NoteText;
  ctx.fillStyle = Style.NoteText;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x + 3.5, o.y + 2);
  ctx.lineTo(o.x + 3.5, o.y + 13);
  ctx.moveTo(o.x + 3.5, o.y + 7.5);
  ctx.lineTo(o.x + 11, o.y + 7.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(o.x + 13, o.y + 7.5);
  ctx.lineTo(o.x + 10, o.y + 5.3);
  ctx.lineTo(o.x + 10, o.y + 9.7);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const KINDS = ["NOTE", "PABS", "PREL", "GCYC", "GPRB", "JUMP"];

// Drag ranges match Unity InspectorPanel; typing may still go outside.
const PitchRange = makeRange({
  low: 24,
  high: 108,
  snap: 1,
  digits: 0,
  display: (v) => Math.round(v) + " " + Pitch.toName(Math.round(v)),
});
const LengthRange = makeRange({
  low: 0.25, high: 8, snap: 0.25, digits: 2, unit: "steps",
});

/** 3-octave piano + octave −/+ + pitch slider for note tiles. */
function createPitchEditor(tile, editor, onPaint) {
  const root = el("div", "pitch-editor");

  const setNote = (n, preview = true) => {
    tile.note = Math.round(Math.min(Pitch.Highest, Math.max(Pitch.Lowest, n)));
    editor.rememberNote(tile);
    editor.touch();
    paintKeys();
    bar.sync();
    onPaint?.();
    if (preview) editor.preview(tile.note);
  };

  const head = el("div", "pitch-head");
  const octDown = button("oct −", () => setNote(tile.note - 12), 48);
  const read = el("div", "pitch-readout");
  const octUp = button("oct +", () => setNote(tile.note + 12), 48);
  head.append(octDown, read, octUp);
  root.append(head);

  const kb = el("div", "piano");
  root.append(kb);

  function paintKeys() {
    read.textContent = Pitch.toName(tile.note);
    // Three octaves: C of (noteOct − 1) through almost C of (noteOct + 2)
    const noteOct = Pitch.toOctave(tile.note);
    let start = (noteOct - 1 + 1) * 12;
    if (start < 24) start = 24;
    if (start + 35 > 108) start = 108 - 35;
    kb.innerHTML = "";
    const whites = el("div", "piano-whites");
    const blacks = el("div", "piano-blacks");
    const keys = [];
    for (let i = 0; i < 36; i++) keys.push(start + i);
    const whiteNotes = keys.filter((n) => !Pitch.isSharp(n));
    whiteNotes.forEach((n) => {
      const key = el("button", "piano-key white" + (n === tile.note ? " active" : ""));
      key.type = "button";
      key.title = Pitch.toName(n);
      key.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setNote(n);
      });
      whites.appendChild(key);
    });
    keys.filter((n) => Pitch.isSharp(n)).forEach((n) => {
      const key = el("button", "piano-key black" + (n === tile.note ? " active" : ""));
      key.type = "button";
      key.title = Pitch.toName(n);
      const whitesLeft = whiteNotes.filter((w) => w < n).length;
      key.style.left = `calc(${(whitesLeft / Math.max(1, whiteNotes.length)) * 100}% - 5px)`;
      key.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setNote(n);
      });
      blacks.appendChild(key);
    });
    kb.append(whites, blacks);
  }

  const bar = createValueBar(
    PitchRange,
    () => tile.note,
    (v) => {
      tile.note = Math.round(Math.min(Pitch.Highest, Math.max(Pitch.Lowest, v)));
      editor.rememberNote(tile);
      editor.touch();
      paintKeys();
      onPaint?.();
    },
    () => editor.preview(tile.note),
  );
  const barWrap = el("div", "control-row");
  barWrap.append(el("div", "control-label", "Pitch"));
  barWrap.append(bar);
  root.append(barWrap);

  paintKeys();
  root.sync = () => {
    paintKeys();
    bar.sync();
  };
  return root;
}
const PeriodRange = makeRange({ low: 2, high: 8, snap: 1, digits: 0 });
const FiresOnRange = makeRange({ low: 1, high: 8, snap: 1, digits: 0 });
const PercentRange = makeRange({ low: 0, high: 100, snap: 1, digits: 0, unit: "%" });
const ChannelRange = makeRange({ low: 1, high: PatchBank.Channels, snap: 1, digits: 0 });
const TempoRange = makeRange({ low: 40, high: 240, digits: 1 });

export class JacquardUI {
  constructor(root, app) {
    this.app = app;
    this.editor = app.editor;
    this.message = app.store.listing();

    root.innerHTML = "";
    root.classList.add("jacquard-root");

    this.transport = el("div", "transport");
    root.append(this.transport);

    this.body = el("div", "body");
    root.append(this.body);

    this.scroll = el("div", "score-scroll");
    this.canvas = el("canvas", "score-canvas");
    this.scroll.append(this.canvas);
    this.body.append(this.scroll);

    this.view = new ScoreView(this.canvas, this.scroll);
    this.view.score = app.project.score;
    this.view.sequencer = app.sequencer;
    this.view.placeMenu = new PlaceMenu(this.body);
    this.view.canPlaceAt = (point) => this.editor.canPlaceAt(point);
    this.view.menuModeAt = (point) => this.editor.menuModeAt(point);
    this.view.placeCentreNote = () => this.editor.lastNotePitch;
    this.view.onPlaceCommit = ({ point, place }) => {
      this.editor.put(place, point);
      this.canvas.focus();
    };
    this.view.onFxSelect = (id) => {
      this.editor.clearObjectSelection();
      this.editor.selectedFxId = id;
      this.view.selectedFxId = id;
      this.view.selectedAutoId = null;
      this.view.selectedPathId = null;
      this.refreshPanels(true);
    };
    this.view.onAutoSelect = (id) => {
      this.editor.clearObjectSelection();
      this.editor.selectedAutoId = id;
      this.view.selectedAutoId = id;
      this.view.selectedFxId = null;
      this.view.selectedPathId = null;
      this.refreshPanels(true);
    };
    this.view.onTriggerPlaced = ({ kind, fxId, paramKey, value, point }) => {
      this.editor.placeTrigger({
        kind,
        targetFxId: fxId,
        paramKey,
        value,
        point,
      });
    };
    this.view.onFxParamChanged = (commit) => {
      if (commit) this.editor.commit();
      else {
        this.editor.touch();
        this.view.paint();
      }
    };
    this.view.onFxMovePreview = (id, x, y) => {
      const ok = this.editor.previewMoveFx(id, x, y);
      if (ok) this.view.paint();
      return ok;
    };
    this.view.onFxMoved = (id, x, y) => {
      this.editor.commitMoveFx(id, x, y);
    };
    this.view.onIsValidTrigger = (point) => this.editor.isValidTriggerCell(point);
    this.view.onCursorMoved = () => this.refreshPanels();
    this.view.onDoubleClick = () => this.editor.placeNote();
    this.view.onTilesDropped = (s, t) => this.editor.dropTiles(s, t);
    this.view.onLaneDropped = (l, h) => this.editor.dropLane(l, h);
    this.view.onLoopReshaped = () => {
      this.editor.commit();
    };
    this.view.onKey = (e) => {
      if (e.key === " ") {
        e.preventDefault();
        this.app.togglePlay();
        return true;
      }
      if (e.key === "Escape") {
        this.view.cancelGestures();
        return true;
      }
      return this.editor.handleKey(e);
    };

    this.editor.getCursor = () => this.view.cursor;
    this.editor.setCursor = (p) => this.view.setCursor(p);
    this.editor.onChanged = () => this.onChanged();
    this.editor.onTouched = () => {
      this.view.paint();
      this.app.scheduleSave();
    };

    this.right = el("div", "panel-column right");
    this.left = el("div", "panel-column left");
    this.body.append(this.right, this.left);

    this.tilePanel = el("div", "panel");
    this.soundPanel = el("div", "panel hidden");
    this.lockPanel = el("div", "panel hidden");
    this.fxPanel = el("div", "panel hidden");
    this.right.append(this.tilePanel, this.soundPanel, this.lockPanel, this.fxPanel);

    this._buildTransport();
    this._buildDockKeyboard();
    this.refreshPanels(true);
    this.view.rebuild();
    this.canvas.focus();
  }

  /** Fixed bottom keyboard: audition focus lane, drag keys onto steps. */
  _buildDockKeyboard() {
    this.dock = el("div", "dock-keyboard");
    this.body.append(this.dock);

    const laneRow = el("div", "dock-lane-row");
    laneRow.append(button("‹", () => {
      this.editor.cycleFocusLane(-1);
      this._refreshDockLaneLabel();
      this.canvas.focus();
    }, 28));
    this.dockLaneLabel = el("div", "dock-lane-label", "Lane");
    laneRow.append(this.dockLaneLabel);
    laneRow.append(button("›", () => {
      this.editor.cycleFocusLane(1);
      this._refreshDockLaneLabel();
      this.canvas.focus();
    }, 28));
    this.dock.append(laneRow);

    const kb = el("div", "dock-keys");
    this.dock.append(kb);
    // C3–C5 white keys + blacks
    const lows = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
    const blacks = [
      { n: 49, after: 0 }, { n: 51, after: 1 },
      { n: 54, after: 3 }, { n: 56, after: 4 }, { n: 58, after: 5 },
      { n: 61, after: 7 }, { n: 63, after: 8 },
      { n: 66, after: 10 }, { n: 68, after: 11 }, { n: 70, after: 12 },
    ];
    const whiteWrap = el("div", "dock-whites");
    const blackWrap = el("div", "dock-blacks");
    kb.append(whiteWrap, blackWrap);

    lows.forEach((note, i) => {
      const key = el("button", "dock-key white");
      key.type = "button";
      key.textContent = Pitch.toName(note).replace(/\d+$/, "");
      key.title = Pitch.toName(note);
      this._bindDockKey(key, note);
      whiteWrap.append(key);
    });
    blacks.forEach(({ n, after }) => {
      const key = el("button", "dock-key black");
      key.type = "button";
      key.title = Pitch.toName(n);
      key.style.left = `calc(${(after + 0.65) * (100 / lows.length)}% - 8px)`;
      this._bindDockKey(key, n);
      blackWrap.append(key);
    });

    this._refreshDockLaneLabel();
  }

  _refreshDockLaneLabel() {
    const lane = this.editor.focusLane;
    if (!this.dockLaneLabel) return;
    if (!lane) {
      this.dockLaneLabel.textContent = "No lane";
      return;
    }
    const name = lane.channel?.displayName || lane.channel?.shortName || "Lane";
    const i = this.editor.score.channelLanes.indexOf(lane) + 1;
    this.dockLaneLabel.textContent = i + " · " + name;
  }

  _bindDockKey(key, note) {
    key.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.editor.auditionNote(note);
      key.setPointerCapture(e.pointerId);
      this._dockDrag = {
        note,
        originX: e.clientX,
        originY: e.clientY,
        armed: false,
        ghost: null,
      };
      const move = (ev) => {
        const d = this._dockDrag;
        if (!d) return;
        if (!d.armed && Math.hypot(ev.clientX - d.originX, ev.clientY - d.originY) > 8) {
          d.armed = true;
          d.ghost = el("div", "dock-note-ghost", Pitch.toName(note));
          document.body.append(d.ghost);
        }
        if (d.ghost) {
          d.ghost.style.left = ev.clientX + 8 + "px";
          d.ghost.style.top = ev.clientY + 8 + "px";
          const point = this.view.score && Style.cellAt(this.view.localPoint(ev));
          const valid = point && this.editor.canPlaceTileAt(point);
          d.ghost.classList.toggle("valid", !!valid);
          d.ghost.style.opacity = valid ? "1" : "0.5";
        }
      };
      const up = (ev) => {
        key.releasePointerCapture(e.pointerId);
        key.removeEventListener("pointermove", move);
        key.removeEventListener("pointerup", up);
        const d = this._dockDrag;
        this._dockDrag = null;
        if (d?.ghost) d.ghost.remove();
        if (d?.armed) {
          const point = Style.cellAt(this.view.localPoint(ev));
          if (this.editor.canPlaceTileAt(point)) {
            this.editor.placeNoteAt(point, note);
          }
        }
        this.canvas.focus();
      };
      key.addEventListener("pointermove", move);
      key.addEventListener("pointerup", up);
    });
  }

  _buildTransport() {
    this.transport.innerHTML = "";
    this.playBtn = button("Play", () => this.app.togglePlay(), 54);
    this.transport.append(this.playBtn);

    const tempoRow = barRow("bpm", TempoRange,
      () => this.editor.project.tempo,
      (v) => {
        this.editor.project.tempo = v;
        this.app.scheduleSave();
      });
    tempoRow.classList.add("tempo-row");
    this.tempoBar = tempoRow;
    this.transport.append(tempoRow);

    // Sketch browser: ‹ title ›  +  New  (auto-save; no Load/Save)
    this.transport.append(el("div", "transport-sep"));
    this.transport.append(button("‹", () => {
      this.app.prevSketch();
      this.canvas.focus();
    }, 32));
    this.sketchLabel = el("div", "sketch-label");
    this.transport.append(this.sketchLabel);
    this.transport.append(button("›", () => {
      this.app.nextSketch();
      this.canvas.focus();
    }, 32));
    this.transport.append(button("+", () => {
      this.app.duplicateSketch();
      this.canvas.focus();
    }, 32));
    this.plusBtn = this.transport.lastChild;
    this.plusBtn.title = "Duplicate sketch";
    this.transport.append(button("New", () => {
      this.app.newSketch();
      this.canvas.focus();
    }, 44));

    this.status = el("div", "status");
    this.transport.append(this.status);

    // Haiku sticky (reads project.meta)
    this.sticky = el("div", "haiku-sticky hidden");
    this.body.append(this.sticky);

    this.onSketchMetaChanged();
  }

  onSketchMetaChanged() {
    const p = this.app.project;
    const title = this.app.store.displayName(p);
    const n = this.app.store.listing();
    if (this.sketchLabel) {
      this.sketchLabel.textContent = title;
      this.sketchLabel.title = this.app.store.name + " · " + n;
    }
    if (this.sticky) {
      if (p.haiku) {
        this.sticky.classList.remove("hidden");
        const lines = p.haiku.split(/\s*\/\s*/);
        this.sticky.innerHTML = "";
        if (p.title) this.sticky.append(el("div", "sticky-title", p.title));
        for (const line of lines) {
          this.sticky.append(el("div", "sticky-line", line.trim()));
        }
      } else {
        this.sticky.classList.add("hidden");
        this.sticky.innerHTML = "";
      }
    }
  }

  onChanged() {
    this.view.score = this.app.project.score;
    this.view.sequencer = this.app.sequencer;
    this.view.selectedFxId = this.editor.selectedFxId;
    this.view.selectedAutoId = this.editor.selectedAutoId;
    this.view.selectedPathId = this.editor.selectedPathId;
    this.view.rebuild();
    this.refreshPanels(true);
    this.onSketchMetaChanged();
    this.app.scheduleSave();
  }

  refreshPanels(force = false) {
    this.buildTilePanel();
    this.buildSoundPanel();
    this.buildLockPanel();
    this.buildFxPanel();
  }

  buildTilePanel() {
    const panel = this.tilePanel;
    panel.innerHTML = "";
    ensureFxLists(this.editor.score);
    this._refreshDockLaneLabel?.();

    // Trigger pad inspector
    const trig = this.editor.score.fxTriggers.find(
      (t) => t.id === this.editor.selectedAutoId,
    );
    if (trig) {
      this._buildTriggerInspector(panel, trig);
      return;
    }

    panel.append(el("div", "panel-title", "Tile"));
    const body = el("div", "panel-body");
    panel.append(body);

    const tile = this.editor.selected;
    const lane = this.editor.selectedLane;
    const cell = this.editor.cell;
    body.append(el("div", "caption", describeCell(cell, tile, lane)));

    if (this.editor.canPlace) {
      body.append(el("div", "divider"));
      body.append(el("div", "caption",
        "← → category, ↓ choose, release. Drag notes from the bottom keyboard onto steps. " +
        "FX triggers: drag ON/OFF or a slider value off a pedal onto empty cells next to a lane."));
      const grid = el("div", "palette");
      for (const kind of KINDS) {
        grid.append(button(kind, () => {
          this.editor.put(kind);
          this.canvas.focus();
        }, 52));
      }
      body.append(grid);
      return;
    }

    // Head / term handles (no tile body — still need lane controls)
    if (cell.kind === CellKind.Head && lane) {
      body.append(el("div", "divider"));
      body.append(el("div", "caption", "Drag to move start. Click shows this panel."));
      const steps = el("div", "control-row");
      steps.append(el("div", "control-label", "Steps"));
      const value = el("div", "chooser-value");
      const paintSteps = () => {
        value.textContent = String(lane.steps.length);
      };
      steps.append(
        button("−", () => {
          this.editor.resizeLane(-1);
          paintSteps();
          this.canvas.focus();
        }, 28),
        value,
        button("+", () => {
          this.editor.resizeLane(1);
          paintSteps();
          this.canvas.focus();
        }, 28),
      );
      paintSteps();
      body.append(steps);
      body.append(el("div", "divider"));
      body.append(button("Delete lane", () => {
        this.editor.delete();
        this.canvas.focus();
      }, 74));
      return;
    }

    if (cell.kind === CellKind.Term && lane) {
      body.append(el("div", "divider"));
      body.append(el("div", "caption",
        "Drag to move loop end. Stack on start for a circular tape loop."));
      body.append(el("div", "divider"));
      body.append(button("Delete lane", () => {
        this.editor.setCursor(lane.headPoint);
        this.editor.delete();
        this.canvas.focus();
      }, 74));
      return;
    }

    if (cell.kind === CellKind.Rail && lane) {
      body.append(el("div", "divider"));
      body.append(el("div", "caption",
        "Empty step. Place a tile, or ⌥/⌘-drag to an FX pedal for a path send."));
      return;
    }

    if (!tile) {
      body.append(el("div", "divider"));
      body.append(button("New lane", () => {
        this.editor.newChannelLane();
        this.canvas.focus();
      }, 66));
      return;
    }

    body.append(el("div", "divider"));
    if (tile instanceof NoteTile) {
      body.append(createPitchEditor(tile, this.editor, () => this.view.paint()));
      body.append(barRow("Length", LengthRange,
        () => tile.length,
        (v) => {
          tile.length = Math.min(64, Math.max(0.05, v));
          this.editor.rememberNote(tile);
          this.editor.touch();
        }));
    } else if (tile instanceof CycleGateTile) {
      body.append(barRow("Period", PeriodRange,
        () => tile.period,
        (v) => {
          tile.period = Math.round(v);
          this.editor.touch();
        }));
      body.append(barRow("Fires on", FiresOnRange,
        () => tile.index,
        (v) => {
          tile.index = Math.round(v);
          this.editor.touch();
        }));
    } else if (tile instanceof ProbGateTile) {
      body.append(barRow("Chance", PercentRange,
        () => tile.percent,
        (v) => {
          tile.percent = v;
          this.editor.touch();
        }));
    } else if (tile instanceof ChannelTile) {
      body.append(el("div", "caption", "Name on grid: " + tile.shortName));
      const nameRow = el("div", "control-row");
      nameRow.append(el("div", "control-label", "Name"));
      const nameInput = el("input", "name-input");
      nameInput.type = "text";
      nameInput.placeholder = "e.g. Kick1";
      nameInput.value = tile.label || "";
      nameInput.addEventListener("input", () => {
        tile.label = nameInput.value;
        this.editor.touch();
        this.view.paint();
      });
      nameInput.addEventListener("change", () => {
        this.editor.commit();
        this.buildTilePanel();
      });
      nameInput.addEventListener("keydown", (e) => e.stopPropagation());
      nameRow.append(nameInput);
      body.append(nameRow);
      body.append(barRow("Channel", ChannelRange,
        () => tile.channel,
        (v) => {
          tile.channel = Math.round(v);
          this.editor.touch();
        },
        () => this.refreshPanels(true)));
      body.append(chooser(
        "Step",
        ChannelTile.Divisions.map((d) => "1/" + d),
        () => {
          const i = ChannelTile.Divisions.indexOf(tile.division);
          return i < 0 ? 7 : i;
        },
        (i) => {
          tile.division = ChannelTile.Divisions[i];
          this.editor.touch();
        },
      ));
    }

    body.append(el("div", "divider"));
    body.append(button("Delete", () => {
      this.editor.delete();
      this.canvas.focus();
    }, 54));
  }

  _buildTriggerInspector(panel, trig) {
    const score = this.editor.score;
    const mod = score.fxModules.find((m) => m.id === trig.targetFxId);
    const fxDef = mod ? (FxTypes[mod.type] || FxTypes.delay) : null;
    const near = triggerAdjacentToAnyLane(score, trig);

    const title = trig.kind === "on" ? "ON trigger"
      : trig.kind === "off" ? "OFF trigger"
        : trig.kind === "chan" ? "Instrument param"
          : "FX param";
    panel.append(el("div", "panel-title", title));
    const body = el("div", "panel-body");
    panel.append(body);

    body.append(el("div", "caption", formatAutoLong(score, trig)));
    body.append(el("div", "divider"));
    body.append(el("div", "caption",
      near
        ? "Adjacent to a lane — opacity 1; fires when a neighbor step lights."
        : "Not next to a lane (opacity 0.5) — move beside a step cell."));

    if (trig.kind === "param" || trig.kind === "chan") {
      const pDef = autoParamDef(score, trig);
      const min = pDef?.min ?? 0;
      const max = pDef?.max ?? 1;
      const range = (trig.paramKey === "time" ||
        trig.paramKey === "moddecay" ||
        trig.paramKey === "carattack" ||
        trig.paramKey === "carrelease" ||
        trig.paramKey === "pitchdecay")
        ? Ranges.seconds(min, max)
        : Ranges.amount(min, max);
      body.append(barRow(
        pDef?.label || trig.paramKey,
        range,
        () => trig.value,
        (v) => {
          trig.value = v;
          this.editor.touch();
          this.view.paint();
        },
      ));
    }

    if (trig.kind === "chan") {
      body.append(el("div", "caption", "Channel " + (trig.channel | 0) + " instrument"));
    } else {
      body.append(el("div", "caption",
        "Target: " + (fxDef ? fxDef.name : "?") +
        (mod ? (mod.on ? " · insert ON" : " · insert off") : "")));
    }

    body.append(el("div", "divider"));
    body.append(button("Delete", () => {
      this.editor.deleteSelectedAuto();
      this.view.selectedAutoId = null;
      this.canvas.focus();
    }, 54));
  }

  buildSoundPanel() {
    const tile = this.editor.selected;
    const channel = tile instanceof ChannelTile ? tile.channel : 0;
    if (!channel) {
      this.soundPanel.classList.add("hidden");
      return;
    }
    this.soundPanel.classList.remove("hidden");
    this.soundPanel.innerHTML = "";
    this.soundPanel.append(el("div", "panel-title", "Sound"));
    const body = el("div", "panel-body");
    this.soundPanel.append(body);
    body.append(el("div", "caption",
      "Channel " + channel + " — scrub a bar, or drag vertically off a bar " +
      "onto the grid (next to a lane step) to place an instrument param trigger."));
    body.append(el("div", "divider"));
    const patch = PatchBank.get(this.editor.project.patches, channel);
    ensureFxLists(this.editor.score);
    body.append(chooser(
      "Instrument",
      InstrumentNames,
      () => Math.min(InstrumentNames.length - 1, Math.max(0, patch.instrument | 0)),
      (i) => {
        patch.instrument = i;
        this.app.scheduleSave();
      },
    ));
    for (let t = 0; t < ParamTargets.Count; t++) {
      const target = t;
      const key = ParamTargets.key(target);
      body.append(barRow(
        ParamTargets.name(target),
        Ranges.ofParam(target),
        () => ParamTargets.get(patch, target),
        (v) => {
          ParamTargets.set(patch, target, v);
          this.app.scheduleSave();
        },
        () => this.editor.preview(60, channel),
        {
          getTicks: () => this.editor.score.fxTriggers
            .filter((tr) => tr.kind === "chan" &&
              (tr.channel | 0) === channel &&
              tr.paramKey === key)
            .map((tr) => tr.value),
          isDragOutValid: (cx, cy) => {
            const point = Style.cellAt(this.view.localPoint({ clientX: cx, clientY: cy }));
            return this.editor.isValidTriggerCell(point);
          },
          onDragOut: (value, cx, cy) => {
            const point = Style.cellAt(this.view.localPoint({ clientX: cx, clientY: cy }));
            if (!this.editor.isValidTriggerCell(point)) return;
            this.editor.placeTrigger({
              kind: "chan",
              channel,
              paramKey: key,
              value,
              point,
            });
            this.canvas.focus();
          },
        },
      ));
    }
    body.append(el("div", "divider"));
    body.append(button("Audition", () => this.editor.preview(60, channel), 70));
  }

  buildLockPanel() {
    const tile = this.editor.selected;
    if (!(tile instanceof ParamTile)) {
      this.lockPanel.classList.add("hidden");
      return;
    }
    this.lockPanel.classList.remove("hidden");
    this.lockPanel.innerHTML = "";
    this.lockPanel.append(el("div", "panel-title", "Lock"));
    const body = el("div", "panel-body");
    this.lockPanel.append(body);
    const channel = this.editor.channel;
    body.append(el("div", "caption", "Channel " + channel));
    body.append(el("div", "divider"));
    const patch = PatchBank.get(this.editor.project.patches, channel);
    for (let t = 0; t < ParamTargets.Count; t++) {
      const target = t;
      const range = tile.absolute ? Ranges.ofParam(target) : Ranges.relative(target);
      const row = el("div", "control-row lock-row");
      const label = el("button", "lock-label", ParamTargets.name(target));
      label.title = "Click to release";
      label.addEventListener("click", () => {
        tile.release(target);
        this.editor.commit();
        this.buildLockPanel();
      });
      const bar = createValueBar(
        range,
        () => (tile.isEngaged(target)
          ? tile.amount(target)
          : (tile.absolute ? ParamTargets.get(patch, target) : 0)),
        (v) => {
          tile.engage(target, v);
          this.editor.touch();
        },
      );
      if (!tile.isEngaged(target)) bar.classList.add("released");
      row.append(label, bar);
      body.append(row);
    }
  }

  buildFxPanel() {
    const panel = this.fxPanel;
    ensureFxLists(this.editor.score);
    // Hide FX panel when an auto/path inspector owns the tile panel.
    if (this.editor.selectedAutoId || this.editor.selectedPathId) {
      panel.classList.add("hidden");
      return;
    }
    const mod = this.editor.score.fxModules.find((m) => m.id === this.editor.selectedFxId);
    if (!mod) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML = "";
    const def = FxTypes[mod.type] || FxTypes.delay;
    panel.append(el("div", "panel-title", def.name));
    const body = el("div", "panel-body");
    panel.append(body);
    if (def.patternOp) {
      body.append(el("div", "caption",
        "Pattern control. Playhead column on this block → change pattern. " +
        "P+ / P− step bank; P→ jump to #. Beat clock keeps running."));
    } else {
      body.append(el("div", "caption",
        "Insert pedal (master bus). ON = engaged, OFF = bypass (mix ramps to 0). " +
        "Drag top-left ON or top-right OFF onto a cell beside a lane step. " +
        "Scrub a slider, or drag a value off the slider to place a param trigger. " +
        "Drop back on the pedal to cancel."));
      // Toggle on from panel
      body.append(button(mod.on ? "Bypass (off)" : "Engage (on)", () => {
        mod.on = !mod.on;
        this.editor.commit();
        this.view.paint();
        this.buildFxPanel();
      }, 90));
    }
    body.append(el("div", "divider"));
    for (const p of def.params) {
      const range = p.key === "n"
        ? makeRange({
          low: p.min,
          high: p.max,
          snap: 1,
          digits: 0,
          display: (v) => "#" + (Math.round(v) + 1),
        })
        : (p.key === "time"
          ? Ranges.seconds(p.min, p.max)
          : Ranges.amount(p.min, p.max));
      body.append(barRow(
        p.label,
        range,
        () => mod.params[p.key] ?? p.def,
        (v) => {
          mod.params[p.key] = p.key === "n" ? Math.round(v) : v;
          this.app.scheduleSave();
          this.view.paint();
        },
      ));
    }
    body.append(el("div", "divider"));
    body.append(button("Delete", () => {
      this.editor.deleteAtCursor();
      this.editor.clearObjectSelection();
      this.view.selectedFxId = null;
      this.view.selectedAutoId = null;
      this.view.selectedPathId = null;
      this.refreshPanels(true);
      this.canvas.focus();
    }, 70));
  }

  update() {
    this.view.refreshPlayheads();
    const playing = this.app.sequencer.isPlaying;
    this.playBtn.textContent = playing ? "Stop" : "Play";
    this.playBtn.classList.toggle("active", playing);
    this.tempoBar.sync?.();
    const st = this.app.audio.status;
    const listing = this.app.store.listing();
    const beat = this.app.sequencer?.isPlaying
      ? " · ♩" + (this.app.globalBeat | 0)
      : "";
    this.status.textContent =
      listing +
      beat +
      (this.app.message ? " · " + this.app.message : "") +
      (st ? ` · v${st.activeVoices}` : "");
  }
}

function describe(tile) {
  if (!tile) return "Empty cell — free ground or free step.";
  if (tile instanceof NoteTile) {
    return "Note. Triggers a voice at this pitch when the playhead hits the step. " +
      "Length is in steps (can span past the next cells).";
  }
  if (tile instanceof ParamTile) {
    return tile.absolute
      ? "Absolute lock (PABS). Overrides channel synth params to fixed values while active."
      : "Relative lock (PREL). Offsets channel synth params from the patch defaults.";
  }
  if (tile instanceof CycleGateTile) {
    return "Cycle gate (GCYC). Passes only every Nth visit (period), on the chosen fire index.";
  }
  if (tile instanceof ProbGateTile) {
    return "Probability gate (GPRB). Randomly allows the step with the set chance %.";
  }
  if (tile instanceof ChannelTile) {
    return "Channel head. Chooses instrument channel, step division, and display name for this lane.";
  }
  if (tile instanceof TerminatorTile) {
    return "Lane end (TERM). Marks where the lane stops or loops back.";
  }
  if (tile instanceof JumpTile) {
    return "Jump (JUMP). Branches the runner onto a linked side lane.";
  }
  if (tile instanceof JumpDestTile) {
    return "Jump destination (JDST). Landing cell for a jump branch.";
  }
  return tile.token || "Tile";
}

function describeCell(cell, tile, lane) {
  if (cell?.kind === CellKind.Head) {
    return "Lane start (dal segno 𝄋). Play begins here each loop. " +
      "Drag to reshape start; drag onto the end handle for a circular tape loop.";
  }
  if (cell?.kind === CellKind.Term) {
    return "Lane end (loop-back). Runner returns to start after this cell. " +
      "Drag to resize the loop.";
  }
  if (cell?.kind === CellKind.Rail && !tile) {
    return "Empty rail step on a lane. Notes and gates go here.";
  }
  return describe(tile);
}
