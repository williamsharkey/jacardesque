// Jacquardesque — multi-timbre worklet, grid FX, seamless multi-pattern clock.

import { Project, Sequencer } from "./core.js";
import { AudioEngine } from "./audio.js";
import { ScoreEditor } from "./editor.js";
import { ProjectStore } from "./store.js";
import { JacquardUI } from "./ui.js";
import {
  buildFxGraphMessage,
  ensureFxLists,
  collectPatternTriggers,
} from "./fx-model.js";

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

    // Global song clock — never rewinds while transport is running.
    this.songOriginSample = 0;
    this.globalBeat = 0; // monotonic sixteenth-note count at active tempo
    this._patternFire = new Map(); // debounce pattern modules
    this._switching = false;
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
      this._patternFire.clear();
    } else {
      this.audio.setFx(this.project.fx, this.project.tempo);
      const now = this.audio.pollSample();
      // Anchor song clock at play start (lookahead so first step is clean).
      this.songOriginSample = now + this.audio.lookaheadSamples;
      this.globalBeat = 0;
      this._patternFire.clear();
      this.sequencer.play(now, this.audio.lookaheadSamples);
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

  /**
   * Load a project. If keepClock and currently playing, phase-align so the
   * global beat continues — no transport restart, no missed grid.
   */
  applyProject(project, message, { keepClock = false } = {}) {
    if (!project) {
      this.message = message || "load failed";
      return;
    }

    const playing = this.sequencer.isPlaying && keepClock;
    const now = this.audio.ready ? this.audio.pollSample() : 0;
    const origin = this.songOriginSample;
    const sr = this.audio.sampleRate || 48000;

    if (!playing) this.sequencer.stop();

    this.project = project;
    this.sequencer.project = project;
    this.editor.project = project;
    if (this.audio.ready) this.audio.setFx(this.project.fx, this.project.tempo);
    this.message = message || this.store.name;
    this.ui?.onChanged();

    if (playing) {
      // Resume on the same sample timeline; remap steps via playAligned.
      this.sequencer.playAligned(now, this.audio.lookaheadSamples, origin, sr);
      this._patternFire.clear();
    }
  }

  /** Pattern navigation with optional seamless clock (default true when playing). */
  switchPattern(op, n = 0) {
    if (this._switching) return;
    this._switching = true;
    try {
      this.store.save(this.project);
      let result;
      if (op === "inc") result = this.store.gotoPattern(1);
      else if (op === "dec") result = this.store.gotoPattern(-1);
      else if (op === "jump") result = this.store.gotoPattern(n, { absolute: true });
      else result = this.store.gotoPattern(0);

      const keepClock = this.sequencer.isPlaying;
      this.applyProject(result.project, result.message, { keepClock });
      this.message = (keepClock ? "↻ " : "") + (result.message || "");
    } finally {
      this._switching = false;
    }
  }

  prevSketch() {
    this.switchPattern("dec");
  }

  nextSketch() {
    this.switchPattern("inc");
  }

  duplicateSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.duplicate(this.project);
    this.applyProject(project, message, { keepClock: false });
  }

  newSketch() {
    this.store.save(this.project);
    const { project, message } = this.store.createEmpty();
    this.applyProject(project, message, { keepClock: false });
  }

  save() {
    return this.store.save(this.project);
  }

  load() {
    const { project, message } = this.store.load();
    this.applyProject(project, message, { keepClock: this.sequencer.isPlaying });
    return message;
  }

  _updateGlobalBeat(sample) {
    if (!this.sequencer.isPlaying) return;
    const tempo = Math.max(1, this.project.tempo);
    // Sixteenth-note beats at the active pattern tempo — monotonic while playing.
    const samplesPer16th = (60 / tempo) * (4 / 16) * this.audio.sampleRate;
    if (samplesPer16th <= 0) return;
    this.globalBeat = Math.max(
      this.globalBeat,
      Math.floor(Math.max(0, sample - this.songOriginSample) / samplesPer16th),
    );
  }

  _handlePatternModules() {
    if (!this.sequencer.isPlaying || this._switching) return;
    ensureFxLists(this.project.score);
    // Clear debounce for modules no longer under playhead
    const triggers = collectPatternTriggers(
      this.project.score,
      this.sequencer.runners,
      this._patternFire,
    );
    // Prune stale debounce keys when columns move
    const live = new Set(triggers.map((t) => t.id));
    for (const id of [...this._patternFire.keys()]) {
      if (!live.has(id)) {
        // Keep until column changes — collectPatternTriggers sets key only on fire.
        // Drop entries for modules that didn't hit this frame so re-entry can fire.
        let still = false;
        for (const r of this.sequencer.runners) {
          if (r.playingLane == null || r.playingStep < 0) continue;
          const col = r.playingLane.x + r.playingStep;
          const mod = this.project.score.fxModules.find((m) => m.id === id);
          if (!mod) continue;
          if (col >= mod.x && col < mod.x + mod.w) still = true;
        }
        if (!still) this._patternFire.delete(id);
      }
    }

    for (const t of triggers) {
      this.switchPattern(t.op, t.n | 0);
      // Only one switch per tick (avoid multi-fire cascades).
      break;
    }
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    if (!this.audio.ready) {
      this.ui?.update();
      return;
    }

    const sample = this.audio.pollSample();
    this._updateGlobalBeat(sample);

    this._pending.length = 0;
    this.sequencer.schedule(
      sample,
      this.audio.lookaheadSamples,
      this.audio.sampleRate,
      this._pending,
    );
    if (this._pending.length) this.audio.scheduleMany(this._pending);

    this._handlePatternModules();

    this.audio.setFx(this.project.fx, this.project.tempo);
    ensureFxLists(this.project.score);
    this.audio.setFxGraph(buildFxGraphMessage(
      this.project,
      this.sequencer.runners,
      this.sequencer.isPlaying,
    ));
    this.ui.update();
  }
}

const app = new App();
window.__jacquard = app;
app.boot().catch((err) => {
  console.error(err);
  document.getElementById("app").textContent = "Failed to start: " + err.message;
});
