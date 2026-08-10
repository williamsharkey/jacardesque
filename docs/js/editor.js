// Score editing operations — port of ScoreEditor.cs

import {
  ParamTile,
  CycleGateTile,
  ProbGateTile,
  JumpTile,
  NoteTile,
  ChannelTile,
  CellKind,
  gp,
  noteEventFromPatch,
  Pitch,
  PatchBank,
} from "./core.js";
import {
  createFxModule,
  createFxTrigger,
  ensureFxLists,
  findFxAt,
  findTriggerAt,
  removeFxModule,
  FxTypes,
  triggerAdjacentToAnyLane,
} from "./fx-model.js";

export class ScoreEditor {
  constructor({ project, sequencer, audio, getCursor, setCursor }) {
    this.project = project;
    this.sequencer = sequencer;
    this.audio = audio;
    this.getCursor = getCursor;
    this.setCursor = setCursor;
    this.onChanged = null;
    this.onTouched = null; // lightweight: score mutated, no structural rebuild
    this._notePitch = 60;
    this._noteLength = 1;
    this.selectedFxId = null;
    this.selectedAutoId = null; // selected trigger id
    this.selectedPathId = null;
    this.focusLaneIndex = 0; // dock keyboard target lane
  }

  clearObjectSelection() {
    this.selectedFxId = null;
    this.selectedAutoId = null;
    this.selectedPathId = null;
  }

  get focusLane() {
    const lanes = this.score.channelLanes;
    if (!lanes.length) return null;
    const i = ((this.focusLaneIndex % lanes.length) + lanes.length) % lanes.length;
    return lanes[i];
  }

  cycleFocusLane(delta) {
    const n = this.score.channelLanes.length;
    if (!n) return;
    this.focusLaneIndex = ((this.focusLaneIndex + delta) % n + n) % n;
    this.onTouched?.();
  }

  get score() {
    return this.project.score;
  }

  get cell() {
    return this.score.at(this.getCursor());
  }

  get selected() {
    return this.cell.tile;
  }

  get selectedLane() {
    const cell = this.cell;
    if (cell.lane) return cell.lane;
    const cursor = this.getCursor();
    for (const lane of this.score.lanes) {
      if (lane.isOnRail(cursor)) return lane;
    }
    return null;
  }

  get channel() {
    return this.score.channelOf(this.selectedLane);
  }

  get canPlace() {
    return this.canPlaceAt(this.getCursor());
  }

  canPlaceAt(point) {
    return this.canPlaceTileAt(point) || this.canOpenGroundMenu(point);
  }

  canPlaceTileAt(point) {
    if (!point) return false;
    ensureFxLists(this.score);
    if (findFxAt(this.score, point)) return false;
    if (findTriggerAt(this.score, point)) return false;
    const cell = this.score.at(point);
    if (cell.kind === CellKind.Tile || cell.kind === CellKind.Head) return false;
    return this.score.placementLane(point) != null;
  }

  /** Empty world cell — ground menu (new lane, FX, META), not pan. */
  canOpenGroundMenu(point) {
    if (!point) return false;
    ensureFxLists(this.score);
    if (findFxAt(this.score, point)) return false;
    if (findTriggerAt(this.score, point)) return false;
    const cell = this.score.at(point);
    if (cell.kind !== CellKind.Empty) return false;
    return this.score.isFree(point);
  }

  menuModeAt(point) {
    if (findTriggerAt(this.score, point)) return null;
    if (findFxAt(this.score, point)) return null;
    if (this.canPlaceTileAt(point)) return "lane";
    if (this.canOpenGroundMenu(point)) return "ground";
    return null;
  }

  /**
   * Place from a palette kind string or a place-menu spec
   * { kind, note?, period?, index?, percent? }.
   */
  put(kindOrSpec, atPoint = null) {
    const spec = typeof kindOrSpec === "string"
      ? { kind: kindOrSpec }
      : (kindOrSpec || { kind: "NOTE" });

    if (atPoint) this.setCursor(atPoint);
    const point = this.getCursor();

    if (spec.kind === "NEW_LANE") {
      const steps = spec.steps ?? 16;
      const free = this.score.findFreeRow(point, steps);
      const lane = this.score.addLane(
        free.x,
        free.y,
        new ChannelTile(this.channel, 16, ""),
        steps,
      );
      this.setCursor(gp(lane.headX, lane.y));
      this.commit();
      return true;
    }

    // Freeform lane from ground L/U/R drag path
    if (spec.kind === "LANE_PATH" && spec.path?.length) {
      return this.createLaneFromPath(spec.path);
    }

    // FX pedals land on free ground (not on lane cells).
    if (spec.kind === "FX") {
      ensureFxLists(this.score);
      if (findFxAt(this.score, point)) return false;
      // Claim a small rect free of lanes
      const type = spec.fxType || "delay";
      const def = FxTypes[type] || FxTypes.delay;
      for (let dy = 0; dy < def.h; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          const p = gp(point.x + dx, point.y + dy);
          if (!this.score.isFree(p) || findFxAt(this.score, p)) return false;
        }
      }
      const mod = createFxModule(type, point.x, point.y);
      if (spec.n != null && mod.params) mod.params.n = spec.n | 0;
      this.score.fxModules.push(mod);
      this.clearObjectSelection();
      this.selectedFxId = mod.id;
      this.commit();
      return true;
    }

    if (!this.canPlaceTileAt(point)) return false;

    let tile;
    switch (spec.kind) {
      case "PABS":
        tile = new ParamTile(true);
        break;
      case "PREL":
        tile = new ParamTile(false);
        break;
      case "GCYC":
        tile = new CycleGateTile(spec.period ?? 4, spec.index ?? 1);
        break;
      case "GPRB":
        tile = new ProbGateTile(spec.percent ?? 50);
        break;
      case "JUMP":
        tile = new JumpTile();
        break;
      default: {
        const note = spec.note != null ? spec.note : this._notePitch;
        const length = spec.length != null ? spec.length : this._noteLength;
        tile = new NoteTile(note, length);
        break;
      }
    }

    if (!this.score.place(point, tile)) return false;

    if (tile instanceof JumpTile) {
      const below = gp(Math.max(1, point.x - 4), this.score.height + 1);
      this.score.addBranchLane(tile, below, 4);
    }

    if (tile instanceof NoteTile) {
      this.rememberNote(tile);
      this.preview(tile.note);
    }
    this.commit();
    return true;
  }

  /**
   * Place ON / OFF / param / chan trigger on free ground.
   * Returns false if cell is occupied or on a lane body.
   */
  placeTrigger({ kind, targetFxId, channel, paramKey, value, point }) {
    ensureFxLists(this.score);
    if (!point) return false;
    if (findFxAt(this.score, point)) return false;
    const cell = this.score.at(point);
    if (cell.kind === CellKind.Tile || cell.kind === CellKind.Head ||
        cell.kind === CellKind.Term || cell.kind === CellKind.Rail) {
      return false;
    }
    // Replace any trigger on same cell
    this.score.fxTriggers = this.score.fxTriggers.filter(
      (t) => !(t.x === point.x && t.y === point.y),
    );
    const trig = createFxTrigger({
      x: point.x,
      y: point.y,
      kind,
      targetFxId,
      channel,
      paramKey,
      value,
    });
    this.score.fxTriggers.push(trig);
    this.clearObjectSelection();
    this.selectedAutoId = trig.id;
    this.setCursor(point);
    this.commit();
    return true;
  }

  /** @deprecated */
  placeAutoNode(targetFxId, paramKey, value, point) {
    return this.placeTrigger({
      kind: "param",
      targetFxId,
      paramKey,
      value,
      point,
    });
  }

  placePathRoute() { /* removed */ }
  placeFxRoute() { /* removed */ }

  deleteSelectedAuto() {
    ensureFxLists(this.score);
    const id = this.selectedAutoId;
    if (!id) return false;
    const n = this.score.fxTriggers.length;
    this.score.fxTriggers = this.score.fxTriggers.filter((t) => t.id !== id);
    if (this.score.fxTriggers.length === n) return false;
    this.selectedAutoId = null;
    this.commit();
    return true;
  }

  deleteSelectedPath() {
    return false;
  }

  deleteAtCursor() {
    ensureFxLists(this.score);
    const point = this.getCursor();
    const fx = findFxAt(this.score, point);
    if (fx) {
      removeFxModule(this.score, fx.id);
      if (this.selectedFxId === fx.id) this.selectedFxId = null;
      this.selectedAutoId = null;
      this.commit();
      return;
    }
    const trig = findTriggerAt(this.score, point);
    if (trig) {
      this.score.fxTriggers = this.score.fxTriggers.filter((t) => t.id !== trig.id);
      if (this.selectedAutoId === trig.id) this.selectedAutoId = null;
      this.commit();
      return;
    }
    this.delete();
  }

  /** Place note at grid point if it's a free/valid lane step. */
  placeNoteAt(point, note) {
    if (!point) return false;
    this.setCursor(point);
    this._notePitch = note;
    return this.put({ kind: "NOTE", note });
  }

  /** Preview pitch on focus lane channel. */
  auditionNote(note) {
    const lane = this.focusLane || this.selectedLane;
    const ch = lane?.channel?.channel ?? this.channel ?? 1;
    this.preview(note, ch);
    this._notePitch = note;
  }

  isValidTriggerCell(point) {
    ensureFxLists(this.score);
    if (!point) return false;
    if (findFxAt(this.score, point)) return false;
    if (findTriggerAt(this.score, point)) return true; // replace ok
    const cell = this.score.at(point);
    if (cell.kind !== CellKind.Empty) return false;
    return this.score.isFree(point);
  }

  triggerLooksLive(trig) {
    return triggerAdjacentToAnyLane(this.score, trig);
  }

  placeNote() {
    this.put("NOTE");
  }

  /** Last note pitch for centering the place-menu Note column. */
  get lastNotePitch() {
    return this._notePitch;
  }

  delete() {
    const cell = this.cell;
    if (cell.kind === CellKind.Head && cell.lane) {
      this.score.removeLane(cell.lane);
      this.commit();
      return;
    }
    if (this.score.remove(this.getCursor())) this.commit();
  }

  // Keyboard Delete prefers FX/auto when under cursor.
  deleteSmart() {
    this.deleteAtCursor();
  }

  rememberNote(note) {
    this._notePitch = note.note;
    this._noteLength = note.length;
  }

  transpose(semitones) {
    const tile = this.selected;
    if (!(tile instanceof NoteTile)) return;
    tile.note = Math.min(Pitch.Highest, Math.max(Pitch.Lowest, tile.note + semitones));
    this.rememberNote(tile);
    this.preview(tile.note);
    this.touch();
    this.onChanged?.(); // refresh tile panel caption / pitch bar
  }

  newChannelLane(steps = 16) {
    const point = this.score.findFreeRow(this.getCursor(), steps);
    this.score.addLane(point.x, point.y, new ChannelTile(this.channel, 16, ""), steps);
    this.commit();
  }

  /**
   * Create a channel lane whose step path follows freeform grid cells.
   * path[0] is first step; head marker sits before it.
   */
  createLaneFromPath(pathPoints) {
    if (!pathPoints?.length) return false;
    const pts = [];
    const seen = new Set();
    for (const raw of pathPoints) {
      const p = this.score.wrap(raw);
      const key = p.x + "," + p.y;
      if (seen.has(key)) continue;
      if (!this.score.isFree(p) && pts.length) break;
      if (!this.score.isFree(p) && !pts.length) continue;
      seen.add(key);
      pts.push(gp(p.x, p.y));
    }
    if (!pts.length) return false;
    // Need at least one step; if only origin, extend right if free
    if (pts.length === 1) {
      const next = this.score.wrap(gp(pts[0].x + 1, pts[0].y));
      if (this.score.isFree(next)) pts.push(next);
      else {
        const n2 = this.score.wrap(gp(pts[0].x, pts[0].y + 1));
        if (this.score.isFree(n2)) pts.push(n2);
      }
    }
    if (pts.length < 1) return false;

    const lane = this.score.addLane(
      pts[0].x,
      pts[0].y,
      new ChannelTile(this.channel, 16, ""),
      pts.length,
    );
    lane.path = pts.map((p) => gp(p.x, p.y));
    lane.syncOrigin();
    lane.circular = false;
    lane.activeFrom = 0;
    lane.activeTo = lane.steps.length;
    this.setCursor(lane.headPoint);
    this.focusLaneIndex = this.score.channelLanes.indexOf(lane);
    this.commit();
    return true;
  }

  resizeLane(delta) {
    const lane = this.selectedLane;
    if (!lane) return;
    if (delta > 0) {
      if (!this.score.hasRoomToGrow(lane)) return;
      lane.addStep();
    } else if (lane.steps.length > 1) {
      lane.steps.pop();
    }
    this.commit();
  }

  dropTiles(source, target) {
    const move = this.score.planMove(source, target);
    if (!this.score.applyMove(source, move)) return;
    this.commit();
    this.setCursor(move.lane.cellPoint(move.step, move.depth));
  }

  dropLane(lane, head) {
    if (!this.score.moveLane(lane, head)) return;
    this.commit();
    this.setCursor(head);
  }

  preview(note, channel = this.channel) {
    if (!this.audio?.ready) return;
    const patch = PatchBank.get(this.project.patches, channel);
    const start = this.audio.pollSample() + Math.floor(this.audio.sampleRate / 20);
    const length = 60 / Math.max(this.project.tempo, 1) / 4;
    this.audio.schedule(noteEventFromPatch(patch, note, length, start));
  }

  // Structural edit: rebuild the plane.
  commit() {
    this.sequencer?.resync();
    this.onChanged?.();
  }

  // In-place field edit while a bar is scrubbed: keep the plane, repaint cells.
  touch() {
    this.sequencer?.resync();
    this.onTouched?.();
  }

  handleKey(evt) {
    const shift = evt.shiftKey;
    const command = evt.metaKey || evt.ctrlKey;

    switch (evt.key) {
      case "ArrowLeft":
        this.moveCursor(-1, 0);
        return true;
      case "ArrowRight":
        this.moveCursor(1, 0);
        return true;
      case "ArrowUp":
        if (shift) this.transpose(command ? 12 : 1);
        else this.moveCursor(0, -1);
        return true;
      case "ArrowDown":
        if (shift) this.transpose(command ? -12 : -1);
        else this.moveCursor(0, 1);
        return true;
      case "Delete":
      case "Backspace":
        this.deleteSmart();
        return true;
      case "Enter":
        if (this.selected instanceof NoteTile) this.preview(this.selected.note);
        return true;
      case " ":
        return false; // transport handles space
      case "#":
      case "+":
        this.transpose(1);
        return true;
      case "-":
        this.transpose(-1);
        return true;
    }
    return false;
  }

  moveCursor(dx, dy) {
    const c = this.getCursor();
    this.setCursor(gp(c.x + dx, c.y + dy));
  }
}

