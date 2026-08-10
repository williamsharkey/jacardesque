// Jacquardesque web app — multi-timbre worklet + auto-save sketches.

import { Project, Sequencer } from "./core.js";
import { AudioEngine } from "./audio.js";
import { ScoreEditor } from "./editor.js";
import { ProjectStore } from "./store.js";
import { JacquardUI } from "./ui.js";

const LOOKAHEAD = 0.12;
const MAX_VOICES = 32;
const AUTOSAVE_MS = 400;

class App {
  constructor() {
    this.store = new ProjectStore();
    const boot = this.store.bootstrap();
    this.project = boot.project || Project.createEmpty();
    this.sequencer = new Sequencer();
    this.sequencer.project = this.project;
    this.audio = new AudioEngine({ maxVoices: MAX_VOICES, lookahead: LOOKAHEAD });
    this.editor = new ScoreEditor({
      project: this.project,
      sequencer: this.sequencer,
      audio: this.audio,
      getCursor: () => ({ x: 1, y: 1 }),
      setCursor: () => {},
    });
    this.ui = null;
    this._pending = [];
    this._raf = 0;
    this._saveTimer = 0;
    this.message = boot.message || "";
  }

  async boot() {
    const root = document.getElementById("app");
    this.ui = new JacquardUI(root, this);

    const unlock = async () => {
      try {
        await this.audio.resume();
        this.audio.setFx(this.project.fx, this.project.tempo);
      } catch (err) {
        console.error(err);
        this.ui.message = "audio init failed: " + err.message;
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  async togglePlay() {
    try {
      await this.audio.resume();
    } catch (err) {
      this.ui.message = "audio: " + err.message;
      return;
    }

    if (this.sequencer.isPlaying) {
      this.sequencer.stop();
    } else {
      this.audio.setFx(this.project.fx, this.project.tempo);
      this.sequencer.play(this.audio.pollSample(), this.audio.lookaheadSamples);
    }
    this.ui.view.refreshPlayheads();
  }

  /** Debounced auto-save after any edit. */
  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.message = this.store.save(this.project);
      this.ui?.onSketchMetaChanged?.();
    }, AUTOSAVE_MS);
  }

  applyProject(project, message) {
    if (!project) {
      this.message = message || "load failed";
      return;
    }
    this.sequencer.stop();
    this.project = project;
    this.sequencer.project = project;
    this.editor.project = project;
    if (this.audio.ready) this.audio.setFx(this.project.fx, this.project.tempo);
    this.message = message || this.store.name;
    this.ui?.onChanged();
  }

  prevSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.step(-1);
    this.applyProject(project, message);
  }

  nextSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.step(1);
    this.applyProject(project, message);
  }

  duplicateSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.duplicate(this.project);
    this.applyProject(project, message);
  }

  newSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.createEmpty();
    this.applyProject(project, message);
  }

  // legacy names used by tests
  save() {
    return this.store.save(this.project);
  }

  load() {
    const { project, message } = this.store.load();
    this.applyProject(project, message);
    return message;
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    if (!this.audio.ready) {
      this.ui?.update();
      return;
    }

    const sample = this.audio.pollSample();
    this._pending.length = 0;
    this.sequencer.schedule(
      sample,
      this.audio.lookaheadSamples,
      this.audio.sampleRate,
      this._pending,
    );
    if (this._pending.length) this.audio.scheduleMany(this._pending);
    this.audio.setFx(this.project.fx, this.project.tempo);
    this.ui.update();
  }
}

const app = new App();
window.__jacquard = app;
app.boot().catch((err) => {
  console.error(err);
  document.getElementById("app").textContent = "Failed to start: " + err.message;
});
