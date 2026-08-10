// Interactive Jacquard UI — score plane, panels, value bars, transport.

import {
  Pitch,
  ParamTargets,
  DelayTime,
  SendFx,
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

export function createValueBar(range, get, set, settled) {
  const root = el("div", "value-bar");
  const fill = el("div", "value-bar-fill");
  const read = el("div", "value-bar-readout");
  root.append(fill, read);

  let dragging = false;
  let last = get();

  function paint() {
    const value = get();
    last = value;
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
  }

  function setFromClientX(clientX) {
    const rect = root.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let value = toValue(range, pos);
    if (range.snap > 0) value = Math.round(value / range.snap) * range.snap;
    set(value);
    paint();
  }

  root.addEventListener("pointerdown", (e) => {
    if (e.detail >= 2) {
      e.preventDefault();
      const typed = prompt("Value", String(get() * (range.scale || 1)));
      if (typed == null) return;
      let value = parseFloat(typed);
      if (Number.isNaN(value)) return;
      if (range.scale && range.scale !== 1) value /= range.scale;
      set(value);
      paint();
      settled?.();
      return;
    }
    dragging = true;
    root.classList.add("active");
    root.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  });

  root.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setFromClientX(e.clientX);
  });

  root.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("active");
    try {
      root.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    settled?.();
  });

  root.sync = paint;
  paint();
  return root;
}

function barRow(label, range, get, set, settled) {
  const row = el("div", "control-row");
  row.append(el("div", "control-label", label));
  const bar = createValueBar(range, get, set, settled);
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

    this._grabbed = null;
    this._grabOrigin = null;
    this._dragging = false;
    this._dropPoint = null;
    this._dropCells = [];
    this._ghostDelta = { x: 0, y: 0 };
    this._playheads = [];
    this._dragCount = 1;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.tabIndex = 0;

    c.addEventListener("pointerdown", (e) => this._pointerDown(e));
    c.addEventListener("pointermove", (e) => this._pointerMove(e));
    c.addEventListener("pointerup", (e) => this._pointerUp(e));
    c.addEventListener("keydown", (e) => {
      if (this.onKey?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Wheel / trackpad pan via scroll container
    this.scroll.addEventListener("pointerdown", (e) => {
      // Allow empty-ground drags on canvas to pan via scroll: handled when grab not set
    });
  }

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width) / this.dpr,
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height) / this.dpr,
    };
  }

  setCursor(point) {
    point = gp(
      Math.min(this.columns - 1, Math.max(0, point.x)),
      Math.min(this.rows - 1, Math.max(0, point.y)),
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
    this.columns = Math.max(48, this.score.width + 10);
    this.rows = Math.max(28, this.score.height + 8);
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
    if (e.detail >= 2) this.onDoubleClick?.();

    const cell = this.score.at(point);
    if (cell.kind !== CellKind.Tile && cell.kind !== CellKind.Head) {
      // Start plane pan from free ground
      this._panning = true;
      this._panOrigin = { x: e.clientX, y: e.clientY, sl: this.scroll.scrollLeft, st: this.scroll.scrollTop };
      this.scroll.setPointerCapture?.(e.pointerId);
      return;
    }

    e.preventDefault();
    this._grabbed = cell;
    this._grabOrigin = pos;
    this._dragging = false;
    this.canvas.setPointerCapture(e.pointerId);
  }

  _pointerMove(e) {
    if (this._panning) {
      const dx = e.clientX - this._panOrigin.x;
      const dy = e.clientY - this._panOrigin.y;
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
    if (this._panning) {
      this._panning = false;
      return;
    }
    if (!this._grabbed) return;
    const grabbed = this._grabbed;
    const point = this._dropPoint;
    const dropped = this._dragging;
    this._endDrag();
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    if (!dropped) return;
    if (grabbed.kind === CellKind.Head) this.onLaneDropped?.(grabbed.lane, point);
    else this.onTilesDropped?.(grabbed, point);
  }

  _endDrag() {
    this._grabbed = null;
    this._dragging = false;
    this._dropCells = [];
    this._ghostDelta = { x: 0, y: 0 };
  }

  _dragCount(target) {
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
      this._dragCount = this._dragCount(this._dropPoint);
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
    this._drawPlayheads(ctx);
    this._drawCursor(ctx);
    this._drawDropCells(ctx);
    if (this._dragging && this._grabbed) this._drawGhosts(ctx);
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
    ctx.fillStyle = withAlpha(Style.NoteLine, Style.RailOpacity);
    for (const lane of this.score.lanes) {
      const from = Style.cellCenter(lane.headPoint).x;
      const to = Style.cellCenter(lane.termPoint).x;
      const y = Math.floor(Style.cellCenter(lane.headPoint).y) - Style.RailDot / 2;
      for (let x = from; x < to; x += Style.RailStep) {
        ctx.fillRect(x, y, Style.RailDot, Style.RailDot);
      }
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
    ctx.fillStyle = Style.Marker;
    for (const lane of this.score.lanes) {
      for (let i = 0; i < lane.steps.length; i++) {
        if (!lane.steps[i].isEmpty) continue;
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
      this._drawTile(ctx, lane.head, lane.headPoint, 1);
      this._drawTile(ctx, Terminator, lane.termPoint, 1);
      for (let i = 0; i < lane.steps.length; i++) {
        for (let d = 0; d < lane.steps[i].depth; d++) {
          const lifted = this._isLifted(lane, i, d);
          this._drawTile(ctx, lane.steps[i].tiles[d], lane.cellPoint(i, d), lifted ? 0.2 : 1);
        }
      }
    }
  }

  _isLifted(lane, step, depth) {
    if (!this._dragging || !this._grabbed) return false;
    if (this._grabbed.kind === CellKind.Head) {
      return this._grabbed.lane === lane;
    }
    if (this._grabbed.lane !== lane || this._grabbed.step !== step) return false;
    const count = this._dragCount;
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
    const r = Style.cellRect(this.cursor);
    ctx.strokeStyle = Style.Cursor;
    ctx.lineWidth = 1;
    roundRect(ctx, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, Style.Radius + 2);
    ctx.stroke();
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
      const count = this._dragCount;
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
    ctx.font = "600 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CH" + tile.channel, r.x + r.w / 2, r.y + r.h / 2);
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

const PitchRange = makeRange({
  low: Pitch.Lowest,
  high: Pitch.Highest,
  snap: 1,
  digits: 0,
  display: (v) => Math.round(v) + " " + Pitch.toName(Math.round(v)),
});
const LengthRange = makeRange({ low: 0.25, high: 64, curve: 2, digits: 2 });
const PeriodRange = makeRange({ low: 2, high: 8, snap: 1, digits: 0 });
const IndexRange = (period) => makeRange({ low: 1, high: period, snap: 1, digits: 0 });
const PercentRange = makeRange({ low: 0, high: 100, digits: 0, unit: "%" });
const ChannelRange = makeRange({ low: 1, high: PatchBank.Channels, snap: 1, digits: 0 });
const TempoRange = makeRange({ low: 40, high: 240, digits: 1 });
const StepsRange = makeRange({ low: 1, high: 64, snap: 1, digits: 0 });

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
    this.view.onCursorMoved = () => this.refreshPanels();
    this.view.onDoubleClick = () => this.editor.placeNote();
    this.view.onTilesDropped = (s, t) => this.editor.dropTiles(s, t);
    this.view.onLaneDropped = (l, h) => this.editor.dropLane(l, h);
    this.view.onKey = (e) => {
      if (e.key === " ") {
        e.preventDefault();
        this.app.togglePlay();
        return true;
      }
      return this.editor.handleKey(e);
    };

    this.editor.getCursor = () => this.view.cursor;
    this.editor.setCursor = (p) => this.view.setCursor(p);
    this.editor.onChanged = () => this.onChanged();
    this.editor.onTouched = () => {
      this.view.paint();
    };

    this.right = el("div", "panel-column right");
    this.left = el("div", "panel-column left");
    this.body.append(this.right, this.left);

    this.tilePanel = el("div", "panel");
    this.soundPanel = el("div", "panel hidden");
    this.lockPanel = el("div", "panel hidden");
    this.sendPanel = el("div", "panel hidden");
    this.right.append(this.tilePanel, this.soundPanel, this.lockPanel);
    this.left.append(this.sendPanel);

    this._buildTransport();
    this.refreshPanels(true);
    this.view.rebuild();
    this.canvas.focus();
  }

  _buildTransport() {
    this.transport.innerHTML = "";
    this.playBtn = button("Play", () => this.app.togglePlay(), 54);
    this.transport.append(this.playBtn);

    const tempoRow = barRow("bpm", TempoRange,
      () => this.editor.project.tempo,
      (v) => {
        this.editor.project.tempo = v;
      });
    tempoRow.classList.add("tempo-row");
    this.tempoBar = tempoRow;
    this.transport.append(tempoRow);

    this.sendBtn = button("Send FX", () => {
      this._sendShown = !this._sendShown;
      this.sendPanel.classList.toggle("hidden", !this._sendShown);
      this.canvas.focus();
    }, 62);
    this.transport.append(this.sendBtn);

    this._slots = this.app.store.slots();
    this.fileChooser = chooser(
      "File",
      this._slots,
      () => Math.max(0, this._slots.indexOf(this.app.store.name)),
      (i) => {
        this.app.store.name = this._slots[i];
      },
    );
    this.transport.append(this.fileChooser);
    this.transport.append(button("Save", () => {
      this.message = this.app.save();
      this._slots = this.app.store.slots();
    }, 46));
    this.transport.append(button("Load", () => {
      this.message = this.app.load();
      this.onChanged();
    }, 46));

    this.status = el("div", "status");
    this.transport.append(this.status);
    this._sendShown = false;
  }

  onChanged() {
    this.view.score = this.app.project.score;
    this.view.sequencer = this.app.sequencer;
    this.view.rebuild();
    this.refreshPanels(true);
    this.buildSendPanel();
  }

  refreshPanels(force = false) {
    this.buildTilePanel();
    this.buildSoundPanel();
    this.buildLockPanel();
    if (force) this.buildSendPanel();
  }

  buildTilePanel() {
    const panel = this.tilePanel;
    panel.innerHTML = "";
    panel.append(el("div", "panel-title", "Tile"));
    const body = el("div", "panel-body");
    panel.append(body);

    const tile = this.editor.selected;
    const lane = this.editor.selectedLane;
    body.append(el("div", "caption", describe(tile)));

    if (this.editor.canPlace) {
      body.append(el("div", "divider"));
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
      body.append(barRow("Pitch", PitchRange,
        () => tile.note,
        (v) => {
          tile.note = Math.round(Math.min(Pitch.Highest, Math.max(Pitch.Lowest, v)));
          this.editor.rememberNote(tile);
          this.editor.touch();
        },
        () => this.editor.preview(tile.note)));
      body.append(barRow("Length", LengthRange,
        () => tile.length,
        (v) => {
          tile.length = Math.min(64, Math.max(0.25, v));
          this.editor.rememberNote(tile);
          this.editor.touch();
        }));
    } else if (tile instanceof CycleGateTile) {
      body.append(barRow("Period", PeriodRange,
        () => tile.period,
        (v) => {
          tile.period = Math.round(v);
          this.editor.touch();
        },
        () => this.buildTilePanel()));
      body.append(barRow("Index", IndexRange(tile.period),
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
      body.append(barRow("Channel", ChannelRange,
        () => tile.channel,
        (v) => {
          tile.channel = Math.round(v);
          this.editor.touch();
        },
        () => this.refreshPanels(true)));
      body.append(chooser("Division", ChannelTile.Divisions.map(String),
        () => {
          const i = ChannelTile.Divisions.indexOf(tile.division);
          return i < 0 ? 7 : i;
        },
        (i) => {
          tile.division = ChannelTile.Divisions[i];
          this.editor.touch();
        }));
    }

    if (this.editor.cell.kind === CellKind.Head && lane) {
      body.append(el("div", "divider"));
      body.append(barRow("Steps", StepsRange,
        () => lane.steps.length,
        (v) => {
          const target = Math.max(1, Math.round(v));
          while (lane.steps.length < target) {
            if (!this.editor.score.hasRoomToGrow(lane)) break;
            lane.addStep();
          }
          while (lane.steps.length > target) lane.steps.pop();
          this.editor.commit();
        }));
    }

    body.append(el("div", "divider"));
    const head = this.editor.cell.kind === CellKind.Head;
    body.append(button(head ? "Delete lane" : "Delete", () => {
      this.editor.delete();
      this.canvas.focus();
    }, head ? 74 : 54));
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
    body.append(el("div", "caption", "Channel " + channel));
    body.append(el("div", "divider"));
    const patch = PatchBank.get(this.editor.project.patches, channel);
    for (let t = 0; t < ParamTargets.Count; t++) {
      const target = t;
      body.append(barRow(
        ParamTargets.name(target),
        Ranges.ofParam(target),
        () => ParamTargets.get(patch, target),
        (v) => ParamTargets.set(patch, target, v),
        () => this.editor.preview(60, channel),
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

  buildSendPanel() {
    const panel = this.sendPanel;
    const shown = !panel.classList.contains("hidden");
    panel.innerHTML = "";
    const title = el("div", "panel-title", "Send FX");
    const close = button("×", () => {
      this._sendShown = false;
      panel.classList.add("hidden");
    }, 28);
    close.classList.add("panel-close");
    title.append(close);
    panel.append(title);
    const body = el("div", "panel-body");
    panel.append(body);
    const fx = this.editor.project.fx;
    body.append(el("div", "caption", "Reverb"));
    body.append(barRow("Size", Ranges.amount(0, 1), () => fx.reverbSize, (v) => {
      fx.reverbSize = v;
    }));
    body.append(barRow("Damp", Ranges.amount(0, 1), () => fx.reverbDamp, (v) => {
      fx.reverbDamp = v;
    }));
    body.append(barRow("Width", Ranges.amount(0, 1), () => fx.reverbWidth, (v) => {
      fx.reverbWidth = v;
    }));
    body.append(el("div", "divider"));
    body.append(el("div", "caption", "Delay"));
    body.append(chooser("Time", DelayTime.Names,
      () => DelayTime.nearest(fx.delayBeats),
      (i) => {
        fx.delayBeats = DelayTime.Beats[i];
      }));
    body.append(barRow("Feedback", Ranges.amount(0, SendFx.MaxFeedback),
      () => fx.delayFeedback, (v) => {
        fx.delayFeedback = v;
      }));
    body.append(barRow("Tone", Ranges.amount(0, 1), () => fx.delayTone, (v) => {
      fx.delayTone = v;
    }));
    body.append(barRow("Spread", Ranges.amount(0, 1), () => fx.delaySpread, (v) => {
      fx.delaySpread = v;
    }));
    if (!shown && !this._sendShown) panel.classList.add("hidden");
  }

  update() {
    this.view.refreshPlayheads();
    const playing = this.app.sequencer.isPlaying;
    this.playBtn.textContent = playing ? "Stop" : "Play";
    this.playBtn.classList.toggle("active", playing);
    this.tempoBar.sync?.();
    const st = this.app.audio.status;
    this.status.textContent =
      (this.message || "") +
      (st ? ` · v${st.activeVoices} q${st.queuedNotes}` : "");
  }
}

function describe(tile) {
  if (!tile) return "Empty cell";
  if (tile instanceof NoteTile) return "Note " + tile.token;
  if (tile instanceof ParamTile) {
    return tile.absolute ? "PABS  absolute lock" : "PREL  relative lock";
  }
  if (tile instanceof CycleGateTile) return "GCYC  cycle gate";
  if (tile instanceof ProbGateTile) return "GPRB  probability gate";
  if (tile instanceof ChannelTile) return "CHAN  channel start";
  if (tile instanceof TerminatorTile) return "TERM  lane end";
  if (tile instanceof JumpTile) return "JUMP  branch out";
  if (tile instanceof JumpDestTile) return "JDST  branch target";
  return tile.token;
}
