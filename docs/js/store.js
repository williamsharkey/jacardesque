// Project save/load via localStorage — browser stand-in for ProjectStore.cs

import { ProjectFormat } from "./core.js";

const PREFIX = "jacquardesque:score:";

export class ProjectStore {
  constructor() {
    this.name = "sketch";
  }

  key(name = this.name) {
    return PREFIX + name;
  }

  save(project) {
    try {
      localStorage.setItem(this.key(), ProjectFormat.write(project));
      return "saved " + this.name;
    } catch (error) {
      return "could not save: " + error.message;
    }
  }

  load() {
    const raw = localStorage.getItem(this.key());
    if (raw == null) {
      return { project: null, message: "no file called " + this.name };
    }
    try {
      return { project: ProjectFormat.read(raw), message: "loaded " + this.name };
    } catch (error) {
      return { project: null, message: "could not read " + this.name + ": " + error.message };
    }
  }

  slots() {
    const names = ["sketch", "take-1", "take-2", "take-3"];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) {
        const name = key.slice(PREFIX.length);
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }

  listing() {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) found.push(key.slice(PREFIX.length));
    }
    return found.length ? "saved: " + found.join(", ") : "no saved scores";
  }
}
