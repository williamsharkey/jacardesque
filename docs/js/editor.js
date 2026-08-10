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
    const cell = this.cell;
    if (cell.kind === CellKind.Tile || cell.kind === CellKind.Head) return false;
    return this.score.placementLane(this.getCursor()) != null;
  }

  put(kind) {
    let tile;
    switch (kind) {
      case "PABS":
        tile = new ParamTile(true);
        break;
      case "PREL":
        tile = new ParamTile(false);
        break;
      case "GCYC":
        tile = new CycleGateTile(4, 1);
        break;
      case "GPRB":
        tile = new ProbGateTile(50);
        break;
      case "JUMP":
        tile = new JumpTile();
        break;
      default:
        tile = new NoteTile(this._notePitch, this._noteLength);
        break;
    }

    if (!this.canPlace || !this.score.place(this.getCursor(), tile)) return;

    if (tile instanceof JumpTile) {
      const below = gp(Math.max(1, this.getCursor().x - 4), this.score.height + 1);
      this.score.addBranchLane(tile, below, 4);
    }

    if (tile instanceof NoteTile) this.preview(tile.note);
    this.commit();
  }

  placeNote() {
    this.put("NOTE");
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
    this.commit();
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
        this.delete();
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

