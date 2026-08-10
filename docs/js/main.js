// Jacquardesque web app entry — full Web Audio port of keijiro/Jacquard.

import { Project, Sequencer } from "./core.js";
import { AudioEngine } from "./audio.js";
import { ScoreEditor } from "./editor.js";
import { ProjectStore } from "./store.js";
import { JacquardUI } from "./ui.js";

const LOOKAHEAD = 0.12;
const MAX_VOICES = 24;

class App {
  constructor() {
    this.project = Project.createSample();
    this.sequencer = new Sequencer();
    this.sequencer.project = this.project;
    this.audio = new AudioEngine({ maxVoices: MAX_VOICES, lookahead: LOOKAHEAD });
    this.store = new ProjectStore();
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
  }

  async boot() {
    const root = document.getElementById("app");
    this.ui = new JacquardUI(root, this);

    // Start audio on first user gesture (browser policy).
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

  save() {
    return this.store.save(this.project);
  }

  load() {
    const { project, message } = this.store.load();
    if (!project) return message;
    this.sequencer.stop();
    this.project = project;
    this.sequencer.project = project;
    this.editor.project = project;
    if (this.audio.ready) this.audio.setFx(this.project.fx, this.project.tempo);
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
// Exposed for automated tests and debugging.
window.__jacquard = app;
app.boot().catch((err) => {
  console.error(err);
  document.getElementById("app").textContent = "Failed to start: " + err.message;
});
