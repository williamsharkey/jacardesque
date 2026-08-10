// Sketch store — auto-save, factory seeds, prev/next, duplicate, new.

import { Project, ProjectFormat } from "./core.js";
import { FACTORY_SKETCHES, buildFactorySketch } from "./examples.js";
import { FX_FACTORY_SKETCHES } from "./examples-fx.js";

const PREFIX = "jacquardesque:v4:score:";
const INDEX_KEY = "jacquardesque:v4:index";
const CURRENT_KEY = "jacquardesque:v4:current";
const SEEDED_KEY = "jacquardesque:v4:seeded";
/** Bump to rewrite factory sketch bodies (user-named sketches stay). */
const FACTORY_REV_KEY = "jacquardesque:v4:factoryRev";
const FACTORY_REV = "showcase-10-v1";

const ALL_FACTORY = [...FACTORY_SKETCHES, ...FX_FACTORY_SKETCHES];

export class ProjectStore {
  constructor() {
    this.name = "rain-on-tin";
    this._index = null;
  }

  key(name = this.name) {
    return PREFIX + name;
  }

  /** Ordered list of sketch ids. */
  slots() {
    if (this._index) return this._index.slice();
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (raw) {
        this._index = JSON.parse(raw);
        return this._index.slice();
      }
    } catch (_) { /* fall through */ }
    this._index = ALL_FACTORY.map((s) => s.id);
    return this._index.slice();
  }

  _writeIndex(list) {
    this._index = list.slice();
    localStorage.setItem(INDEX_KEY, JSON.stringify(this._index));
  }

  currentIndex() {
    const slots = this.slots();
    const i = slots.indexOf(this.name);
    return i < 0 ? 0 : i;
  }

  /** Pattern count for modulo wrap. */
  patternCount() {
    return Math.max(1, this.slots().length);
  }

  /**
   * Jump to pattern index with wrap (never lands outside the bank).
   * delta: relative, or absolute if absolute=true.
   */
  gotoPattern(indexOrDelta, { absolute = false } = {}) {
    const slots = this.slots();
    const n = slots.length;
    if (!n) return { project: null, message: "no patterns" };
    let i = absolute
      ? ((indexOrDelta % n) + n) % n
      : ((this.currentIndex() + indexOrDelta) % n + n) % n;
    return this.load(slots[i]);
  }

  /** Seed factory sketches once; restore last current sketch. */
  bootstrap() {
    const seeded = localStorage.getItem(SEEDED_KEY);
    if (!seeded) {
      const ids = [];
      for (const entry of ALL_FACTORY) {
        const project = entry.build();
        localStorage.setItem(this.key(entry.id), ProjectFormat.write(project));
        ids.push(entry.id);
      }
      this._writeIndex(ids);
      localStorage.setItem(SEEDED_KEY, "1");
      localStorage.setItem(FACTORY_REV_KEY, FACTORY_REV);
      this.name = ids[0];
      localStorage.setItem(CURRENT_KEY, this.name);
      return this.load();
    }

    // Refresh factory bodies when FACTORY_REV changes (keeps user sketches).
    if (localStorage.getItem(FACTORY_REV_KEY) !== FACTORY_REV) {
      for (const entry of ALL_FACTORY) {
        const project = entry.build();
        localStorage.setItem(this.key(entry.id), ProjectFormat.write(project));
      }
      // Ensure factory ids remain in the index (prepend any missing).
      const slots = this.slots();
      const factoryIds = ALL_FACTORY.map((s) => s.id);
      const merged = [
        ...factoryIds,
        ...slots.filter((id) => !factoryIds.includes(id)),
      ];
      this._writeIndex(merged);
      localStorage.setItem(FACTORY_REV_KEY, FACTORY_REV);
    }

    this.slots();
    this.name = localStorage.getItem(CURRENT_KEY) || this._index[0] || "sketch";
    const result = this.load();
    if (result.project) return result;

    const first = this._index[0] || ALL_FACTORY[0].id;
    this.name = first;
    const rebuilt = buildAnyFactory(first) || Project.createEmpty();
    this.save(rebuilt);
    return { project: rebuilt, message: "restored " + first };
  }

  save(project) {
    try {
      localStorage.setItem(this.key(), ProjectFormat.write(project));
      localStorage.setItem(CURRENT_KEY, this.name);
      // Ensure name is in the index.
      const slots = this.slots();
      if (!slots.includes(this.name)) {
        slots.push(this.name);
        this._writeIndex(slots);
      }
      return "auto-saved";
    } catch (error) {
      return "could not save: " + error.message;
    }
  }

  load(name = this.name) {
    this.name = name;
    localStorage.setItem(CURRENT_KEY, this.name);
    const raw = localStorage.getItem(this.key());
    if (raw == null) {
      // Try factory rebuild
      const factory = buildAnyFactory(name);
      if (factory) {
        this.save(factory);
        return { project: factory, message: name };
      }
      return { project: null, message: "missing " + name };
    }
    try {
      return { project: ProjectFormat.read(raw), message: name };
    } catch (error) {
      return { project: null, message: "could not read " + name + ": " + error.message };
    }
  }

  /** Step to adjacent sketch and load it. */
  step(delta) {
    const slots = this.slots();
    if (!slots.length) return { project: null, message: "no sketches" };
    let i = this.currentIndex() + delta;
    if (i < 0) i = slots.length - 1;
    if (i >= slots.length) i = 0;
    return this.load(slots[i]);
  }

  /** Duplicate current sketch under a new unique id. */
  duplicate(project) {
    const base = (project.title || this.name || "sketch")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "sketch";
    let id = base + "-copy";
    let n = 2;
    const slots = this.slots();
    while (slots.includes(id) || localStorage.getItem(this.key(id))) {
      id = base + "-copy-" + n++;
    }
    const clone = ProjectFormat.read(ProjectFormat.write(project));
    if (clone.title) clone.title = clone.title + " (copy)";
    this.name = id;
    slots.push(id);
    this._writeIndex(slots);
    this.save(clone);
    return { project: clone, message: "duplicated → " + id };
  }

  /** Create a blank sketch and select it. */
  createEmpty() {
    const slots = this.slots();
    let id = "untitled";
    let n = 2;
    while (slots.includes(id) || localStorage.getItem(this.key(id))) {
      id = "untitled-" + n++;
    }
    const project = Project.createEmpty();
    project.title = "Untitled";
    project.haiku = "";
    this.name = id;
    slots.push(id);
    this._writeIndex(slots);
    this.save(project);
    return { project, message: "new " + id };
  }

  listing() {
    const slots = this.slots();
    const i = this.currentIndex();
    return (i + 1) + "/" + slots.length;
  }

  displayName(project) {
    if (project?.title) return project.title;
    return this.name;
  }
}

function buildAnyFactory(id) {
  return buildFactorySketch(id) ||
    FX_FACTORY_SKETCHES.find((s) => s.id === id)?.build() ||
    null;
}
