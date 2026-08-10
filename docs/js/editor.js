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
  createPathRoute,
  createFxRoute,
  createAutoNode,
  ensureFxLists,
  findFxAt,
  removeFxModule,
  FxTypes,
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
    if (!point) return false;
    ensureFxLists(this.score);
    if (findFxAt(this.score, point)) return false;
    const cell = this.score.at(point);
    if (cell.kind === CellKind.Tile || cell.kind === CellKind.Head) return false;
    // Free ground may receive an FX pedal (not only lanes).
    if (this.score.placementLane(point) != null) return true;
    // Bare ground free of lanes + fx for pedal placement
    return this.score.isFree(point);
  }

  canPlaceTileAt(point) {
    if (!point) return false;
    const cell = this.score.at(point);
    if (cell.kind === CellKind.Tile || cell.kind === CellKind.Head) return false;
    return this.score.placementLane(point) != null;
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
      this.score.fxModules.push(mod);
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

  placeAutoNode(targetFxId, paramKey, value, point) {
    ensureFxLists(this.score);
    // Replace existing auto at same cell
    this.score.autoNodes = this.score.autoNodes.filter(
      (a) => !(a.x === point.x && a.y === point.y),
    );
    this.score.autoNodes.push(createAutoNode({
      x: point.x,
      y: point.y,
      targetFxId,
      paramKey,
      value,
    }));
    this.commit();
  }

  placePathRoute(laneIndex, fromStep, toStep, targetFxId, amount = 0.55) {
    ensureFxLists(this.score);
    this.score.pathRoutes.push(createPathRoute({
      laneIndex,
      fromStep,
      toStep,
      targetFxId,
      amount,
    }));
    this.commit();
  }

  placeFxRoute(fromFxId, toFxId, amount = 1) {
    ensureFxLists(this.score);
    this.score.fxRoutes.push(createFxRoute({ fromFxId, toFxId, amount }));
    this.commit();
  }

  deleteAtCursor() {
    ensureFxLists(this.score);
    const point = this.getCursor();
    const fx = findFxAt(this.score, point);
    if (fx) {
      removeFxModule(this.score, fx.id);
      if (this.selectedFxId === fx.id) this.selectedFxId = null;
      this.commit();
      return;
    }
    const auto = this.score.autoNodes.find((a) => a.x === point.x && a.y === point.y);
    if (auto) {
      this.score.autoNodes = this.score.autoNodes.filter((a) => a.id !== auto.id);
      this.commit();
      return;
    }
    this.delete();
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

  newChannelLane() {
    const point = this.score.findFreeRow(this.getCursor(), 16);
    this.score.addLane(point.x, point.y, new ChannelTile(this.channel), 16);
    this.commit();
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

