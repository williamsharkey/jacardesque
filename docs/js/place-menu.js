// In-place placement menu: one pointer gesture places a tile.
// ← → change category · ↓ select item · release commits.

import { Pitch } from "./core.js";

const CAT_PX = 56; // horizontal pixels per category step
const ITEM_PX = 28; // vertical pixels per item
const DEAD_Y = 18; // must drag down this far before an item arms
const ARM_Y = 10; // small jitter before we treat motion as intentional

/**
 * Build categories. Note pitches centre on the last-edited note.
 * @param {number} centreNote MIDI note for the Note column
 */
export function buildPlaceCategories(centreNote = 60) {
  const centre = Math.min(Pitch.Highest - 6, Math.max(Pitch.Lowest + 6, centreNote | 0));
  const notes = [];
  for (let d = -6; d <= 6; d++) {
    const n = centre + d;
    notes.push({
      label: Pitch.toName(n),
      place: { kind: "NOTE", note: n },
    });
  }

  return [
    {
      id: "note",
      label: "NOTE",
      items: notes,
      defaultItem: 6, // centre pitch
    },
    {
      id: "gate",
      label: "GATE",
      items: [
        { label: "GCYC 2:1", place: { kind: "GCYC", period: 2, index: 1 } },
        { label: "GCYC 3:1", place: { kind: "GCYC", period: 3, index: 1 } },
        { label: "GCYC 4:1", place: { kind: "GCYC", period: 4, index: 1 } },
        { label: "GCYC 4:2", place: { kind: "GCYC", period: 4, index: 2 } },
        { label: "GCYC 4:3", place: { kind: "GCYC", period: 4, index: 3 } },
        { label: "GCYC 4:4", place: { kind: "GCYC", period: 4, index: 4 } },
        { label: "GCYC 8:1", place: { kind: "GCYC", period: 8, index: 1 } },
        { label: "25%", place: { kind: "GPRB", percent: 25 } },
        { label: "50%", place: { kind: "GPRB", percent: 50 } },
        { label: "75%", place: { kind: "GPRB", percent: 75 } },
      ],
      defaultItem: 2,
    },
    {
      id: "lock",
      label: "LOCK",
      items: [
        { label: "PABS", place: { kind: "PABS" } },
        { label: "PREL", place: { kind: "PREL" } },
      ],
      defaultItem: 0,
    },
    {
      id: "flow",
      label: "FLOW",
      items: [
        { label: "JUMP", place: { kind: "JUMP" } },
      ],
      defaultItem: 0,
    },
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
      defaultItem: 0,
    },
  ];
}

/**
 * Floating gesture menu attached to the score body.
 * Host wires pointer events from the canvas into begin/update/end.
 */
export class PlaceMenu {
  constructor(host) {
    this.host = host; // element to append to (body)
    this.root = document.createElement("div");
    this.root.className = "place-menu hidden";
    this.root.setAttribute("aria-hidden", "true");
    host.appendChild(this.root);

    this.active = false;
    this.point = null; // grid cell
    this.origin = { x: 0, y: 0 };
    this.categories = buildPlaceCategories(60);
    this.catIndex = 0;
    this.itemIndex = -1; // -1 = category only, not yet armed
    this._moved = false;
  }

  get currentCategory() {
    return this.categories[this.catIndex];
  }

  get currentItem() {
    if (this.itemIndex < 0) return null;
    return this.currentCategory?.items[this.itemIndex] ?? null;
  }

  /**
   * @param {{x:number,y:number}} gridPoint
   * @param {{clientX:number,clientY:number}} pointer
   * @param {number} centreNote
   */
  begin(gridPoint, pointer, centreNote = 60) {
    this.active = true;
    this.point = { x: gridPoint.x, y: gridPoint.y };
    this.origin = { x: pointer.clientX, y: pointer.clientY };
    this.categories = buildPlaceCategories(centreNote);
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

    // Horizontal: category. Snap around origin so small L/R changes category.
    let cat = Math.round(dx / CAT_PX);
    cat = Math.min(this.categories.length - 1, Math.max(0, cat));
    // Also allow wrapping by continuous drag past edges
    if (dx < -CAT_PX * 0.4 && cat === 0 && this.catIndex > 0) {
      // keep floor
    }
    this.catIndex = cat;

    // Vertical down: item. Up cancels arming.
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

  /**
   * @returns {{ point, place } | null} commit payload or null if cancelled
   *
   * Only commits when the pointer has dragged far enough down to arm an item.
   * Tap / zero drag / sideways-only = leave the cell empty (cursor only).
   */
  end() {
    if (!this.active) return null;
    const point = this.point;
    const item = this.itemIndex >= 0 ? this.currentItem : null;
    const result = item ? { point, place: item.place } : null;
    this.cancel();
    return result;
  }

  cancel() {
    this.active = false;
    this.point = null;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = "";
  }

  _position(clientX, clientY) {
    // Keep menu near the finger but not under it (offset down-right of press).
    const pad = 12;
    const w = 200;
    const h = 220;
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
      row.className = "place-menu-item" +
        (i === this.itemIndex ? " active" : "") +
        (this.itemIndex < 0 && i === (cat.defaultItem ?? 0) ? " default" : "");
      row.textContent = item.label;
      if (i === this.itemIndex) activeRow = row;
      list.appendChild(row);
    });
    this.root.appendChild(list);
    if (activeRow) {
      // Keep the armed item in view as you drag down a long list.
      queueMicrotask(() => {
        activeRow.scrollIntoView({ block: "nearest" });
      });
    }

    const foot = document.createElement("div");
    foot.className = "place-menu-foot";
    if (this.itemIndex >= 0) {
      foot.textContent = "release → " + cat.items[this.itemIndex].label;
    } else {
      foot.textContent = "drag down to place · release empty";
    }
    this.root.appendChild(foot);
  }
}
