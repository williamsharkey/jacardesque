// Grid-native place gestures.
// Lane cells: floating category menu (tiles).
// Empty ground: canvas shell — L/U/R create lane, ↓ create object (see ScoreView).

import { Pitch } from "./core.js";

const CAT_PX = 52;
const ITEM_PX = 28;
const DEAD_Y = 22;
const ARM_Y = 8;

/**
 * Lane place menu — tiles only.
 * Notes: prefer the dock keyboard. FX triggers drag from pedals.
 */
export function buildLaneCategories(centreNote = 60) {
  const centre = Math.min(Pitch.Highest - 6, Math.max(Pitch.Lowest + 6, centreNote | 0));
  const notes = [];
  for (let d = -6; d <= 6; d++) {
    const n = centre + d;
    notes.push({ label: Pitch.toName(n), place: { kind: "NOTE", note: n } });
  }

  return [
    {
      id: "note",
      label: "NOTE",
      items: notes,
    },
    {
      id: "gate",
      label: "GATE",
      items: [
        { label: "GCYC 2:1", place: { kind: "GCYC", period: 2, index: 1 } },
        { label: "GCYC 4:1", place: { kind: "GCYC", period: 4, index: 1 } },
        { label: "GCYC 4:2", place: { kind: "GCYC", period: 4, index: 2 } },
        { label: "GCYC 8:1", place: { kind: "GCYC", period: 8, index: 1 } },
        { label: "25%", place: { kind: "GPRB", percent: 25 } },
        { label: "50%", place: { kind: "GPRB", percent: 50 } },
        { label: "75%", place: { kind: "GPRB", percent: 75 } },
      ],
    },
    {
      id: "lock",
      label: "LOCK",
      items: [
        { label: "PABS", place: { kind: "PABS" } },
        { label: "PREL", place: { kind: "PREL" } },
      ],
    },
    {
      id: "flow",
      label: "FLOW",
      items: [{ label: "JUMP", place: { kind: "JUMP" } }],
    },
  ];
}

/**
 * Empty-ground object menu (no LANE — lanes are drawn by L/U/R drag).
 * Used when the pointer commits downward into the object shell.
 */
export function buildGroundObjectCategories() {
  return [
    {
      id: "fx",
      label: "FX",
      items: [
        { label: "DELAY", place: { kind: "FX", fxType: "delay" } },
        { label: "REVERB", place: { kind: "FX", fxType: "reverb" } },
        { label: "DISTORT", place: { kind: "FX", fxType: "distort" } },
        { label: "FILTER", place: { kind: "FX", fxType: "filter" } },
        { label: "PAN", place: { kind: "FX", fxType: "pan" } },
      ],
    },
    {
      id: "meta",
      label: "META",
      items: metaItems(),
    },
  ];
}

/** @deprecated */
export function buildGroundCategories() {
  return buildGroundObjectCategories();
}

function metaItems() {
  return [
    { label: "PAT +", place: { kind: "FX", fxType: "pat+" } },
    { label: "PAT −", place: { kind: "FX", fxType: "pat-" } },
    { label: "PAT →1", place: { kind: "FX", fxType: "patgo", n: 0 } },
    { label: "PAT →2", place: { kind: "FX", fxType: "patgo", n: 1 } },
    { label: "PAT →3", place: { kind: "FX", fxType: "patgo", n: 2 } },
    { label: "PAT →4", place: { kind: "FX", fxType: "patgo", n: 3 } },
    { label: "PAT →5", place: { kind: "FX", fxType: "patgo", n: 4 } },
    { label: "PAT →6", place: { kind: "FX", fxType: "patgo", n: 5 } },
  ];
}

/** @deprecated use buildLaneCategories */
export function buildPlaceCategories(centreNote = 60) {
  return buildLaneCategories(centreNote);
}

/**
 * Floating gesture menu for *lane* tile placement only.
 * Ground uses ScoreView._groundGesture (canvas-native shell).
 */
export class PlaceMenu {
  constructor(host) {
    this.host = host;
    this.root = document.createElement("div");
    this.root.className = "place-menu hidden";
    this.root.setAttribute("aria-hidden", "true");
    host.appendChild(this.root);

    this.active = false;
    this.mode = "lane";
    this.point = null;
    this.origin = { x: 0, y: 0 };
    this.categories = buildLaneCategories(60);
    this.catIndex = 0;
    this.itemIndex = -1;
    this._moved = false;
    this.pointerId = null;
  }

  get currentCategory() {
    return this.categories[this.catIndex];
  }

  get currentItem() {
    if (this.itemIndex < 0) return null;
    return this.currentCategory?.items[this.itemIndex] ?? null;
  }

  get isDismiss() {
    return this.itemIndex < 0;
  }

  /**
   * @param {'lane'|'ground'} mode  ground kept for compat but host uses canvas shell
   * @param {{x:number,y:number}} gridPoint
   * @param {{clientX:number,clientY:number,pointerId?:number}} pointer
   * @param {number} centreNote
   */
  begin(mode, gridPoint, pointer, centreNote = 60) {
    this.active = true;
    this.mode = mode === "ground" ? "ground" : "lane";
    this.point = { x: gridPoint.x, y: gridPoint.y };
    this.origin = { x: pointer.clientX, y: pointer.clientY };
    this.pointerId = pointer.pointerId ?? null;
    this.categories = this.mode === "ground"
      ? buildGroundObjectCategories()
      : buildLaneCategories(centreNote);
    this.catIndex = 0;
    this.itemIndex = -1;
    this._moved = false;
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this._position(pointer.clientX, pointer.clientY);
    this._render();
  }

  update(pointer) {
    if (!this.active) return;
    const dx = pointer.clientX - this.origin.x;
    const dy = pointer.clientY - this.origin.y;
    if (Math.hypot(dx, dy) > ARM_Y) this._moved = true;

    let cat = Math.round(dx / CAT_PX);
    cat = Math.min(this.categories.length - 1, Math.max(0, cat));
    this.catIndex = cat;

    if (dy < DEAD_Y) {
      this.itemIndex = -1;
    } else {
      const items = this.currentCategory.items;
      const idx = Math.floor((dy - DEAD_Y) / ITEM_PX);
      this.itemIndex = Math.min(items.length - 1, Math.max(0, idx));
    }

    this._position(pointer.clientX, pointer.clientY);
    this._render();
  }

  end() {
    if (!this.active) return null;
    const point = this.point;
    const item = this.itemIndex >= 0 ? this.currentItem : null;
    const result = item ? { point, place: item.place, mode: this.mode } : null;
    this.cancel();
    return result;
  }

  cancel() {
    this.active = false;
    this.point = null;
    this.pointerId = null;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = "";
  }

  _position(clientX, clientY) {
    const pad = 12;
    const w = 210;
    const h = 260;
    let left = clientX + 14;
    let top = clientY + 14;
    if (left + w > window.innerWidth - pad) left = clientX - w - 14;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, clientY - h - 8);
    this.root.style.left = left + "px";
    this.root.style.top = top + "px";
  }

  _render() {
    const cat = this.currentCategory;
    this.root.innerHTML = "";

    const hint = document.createElement("div");
    hint.className = "place-menu-hint";
    hint.textContent = "← → category · ↓ choose · release";
    this.root.appendChild(hint);

    const dismiss = document.createElement("div");
    dismiss.className = "place-menu-dismiss" + (this.isDismiss ? " active" : "");
    dismiss.textContent = "Dismiss";
    this.root.appendChild(dismiss);

    const cats = document.createElement("div");
    cats.className = "place-menu-cats";
    this.categories.forEach((c, i) => {
      const chip = document.createElement("div");
      chip.className = "place-menu-cat" + (i === this.catIndex ? " active" : "");
      chip.textContent = c.label;
      cats.appendChild(chip);
    });
    this.root.appendChild(cats);

    const list = document.createElement("div");
    list.className = "place-menu-items";
    let activeRow = null;
    cat.items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "place-menu-item" + (i === this.itemIndex ? " active" : "");
      row.textContent = item.label;
      if (i === this.itemIndex) activeRow = row;
      list.appendChild(row);
    });
    this.root.appendChild(list);
    if (activeRow) {
      queueMicrotask(() => activeRow.scrollIntoView({ block: "nearest" }));
    }

    const foot = document.createElement("div");
    foot.className = "place-menu-foot";
    if (this.itemIndex >= 0) {
      foot.textContent = "release → " + cat.items[this.itemIndex].label;
    } else {
      foot.textContent = "release → dismiss";
    }
    this.root.appendChild(foot);
  }
}
