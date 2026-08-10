// Main-thread bridge to the Jacquard AudioWorklet.

import { SendFx } from "./core.js";

export class AudioEngine {
  constructor({ maxVoices = 24, lookahead = 0.12 } = {}) {
    this.maxVoices = maxVoices;
    this.lookahead = lookahead;
    this.context = null;
    this.node = null;
    this.ready = false;
    this.currentSample = 0;
    this.sampleRate = 48000;
    this.status = {
      activeVoices: 0,
      queuedNotes: 0,
      droppedNotes: 0,
      stolenNotes: 0,
      cancelledNotes: 0,
    };
    this._lastFx = null;
    this._lastGraphKey = null;
    this._lastDspSample = 0;
    this._lastReportTime = null;
    this._contextAnchorTime = null;
    this._contextAnchorSample = 0;
  }

  get lookaheadSamples() {
    return Math.floor(this.lookahead * this.sampleRate);
  }

  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.context = new AC({ latencyHint: "interactive" });
    this.sampleRate = this.context.sampleRate;

    // Classic worklet scripts share one global scope — load engine cores first.
    // (DX7 / granular / multi-sample: plain JS attaching globalThis.Jq*)
    const workletModules = [
      "./engines/dx7-core.js",
      "./engines/granular-core.js",
      "./engines/sampler-core.js",
      "./processor.js",
    ];
    for (const rel of workletModules) {
      await this.context.audioWorklet.addModule(new URL(rel, import.meta.url).href);
    }

    this.node = new AudioWorkletNode(this.context, "jacquard-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { maxVoices: this.maxVoices },
    });

    this.node.port.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type === "status") {
        this._lastDspSample = msg.dspSample;
        this._lastReportTime = performance.now();
        this.currentSample = msg.dspSample;
        if (this.context) {
          this._contextAnchorTime = this.context.currentTime;
          this._contextAnchorSample = msg.dspSample;
        }
        this.status = {
          activeVoices: msg.activeVoices,
          queuedNotes: msg.queuedNotes,
          droppedNotes: msg.droppedNotes,
          stolenNotes: msg.stolenNotes,
          cancelledNotes: msg.cancelledNotes,
        };
      }
    };

    this.node.connect(this.context.destination);
    this.ready = true;
  }

  async resume() {
    if (!this.ready) await this.init();
    if (this.context.state !== "running") await this.context.resume();
    // Seed the clock if the worklet has not reported yet so Play is not stuck at 0.
    if (this._lastReportTime == null) {
      this._lastDspSample = 0;
      this._lastReportTime = performance.now();
    }
  }

  // Extrapolate between worklet status reports so the sequencer keeps advancing.
  // Prefer AudioContext time once we have a sample anchor from the worklet.
  pollSample() {
    if (!this.ready) return 0;
    if (this._lastReportTime == null) return 0;
    // Blend wall-clock extrapolation with AudioContext for steadier transport.
    const wall = (performance.now() - this._lastReportTime) / 1000;
    let sample = this._lastDspSample + Math.floor(wall * this.sampleRate);
    if (this.context && this._contextAnchorTime != null) {
      const ctxElapsed = this.context.currentTime - this._contextAnchorTime;
      const fromCtx = this._contextAnchorSample + Math.floor(ctxElapsed * this.sampleRate);
      // Prefer context clock when it is ahead of a stale report (typical case).
      if (fromCtx > sample) sample = fromCtx;
    }
    return sample;
  }

  schedule(note) {
    if (!this.node) return;
    this.node.port.postMessage({ type: "note", note });
  }

  scheduleMany(notes) {
    if (!this.node || !notes.length) return;
    this.node.port.postMessage({ type: "notes", notes });
  }

  setFx(fx, tempo) {
    if (!this.node) return;
    const runtime = {
      reverbSize: fx.reverbSize,
      reverbDamp: fx.reverbDamp,
      reverbWidth: fx.reverbWidth,
      delaySamples: SendFx.delaySeconds(fx, tempo) * this.sampleRate,
      delayFeedback: fx.delayFeedback,
      delayTone: fx.delayTone,
      delaySpread: fx.delaySpread,
    };
    if (this._lastFx && fxEqual(this._lastFx, runtime)) return;
    this._lastFx = runtime;
    this.node.port.postMessage({ type: "fx", fx: runtime });
  }

  /** Push modular grid FX graph (modules, path opens, chains). */
  setFxGraph(graph) {
    if (!this.node) return;
    const key = JSON.stringify(graph);
    if (key === this._lastGraphKey) return;
    this._lastGraphKey = key;
    this.node.port.postMessage({ type: "fxgraph", graph });
  }

  /** Compact master bus: userGain, auto-attenuate, limiter. */
  setMaster(master) {
    if (!this.node || !master) return;
    const key = JSON.stringify(master);
    if (key === this._lastMasterKey) return;
    this._lastMasterKey = key;
    this.node.port.postMessage({
      type: "master",
      userGain: master.userGain,
      autoAtten: master.autoAtten,
      limiter: master.limiter,
    });
  }
}

function fxEqual(a, b) {
  return a.reverbSize === b.reverbSize &&
    a.reverbDamp === b.reverbDamp &&
    a.reverbWidth === b.reverbWidth &&
    a.delaySamples === b.delaySamples &&
    a.delayFeedback === b.delayFeedback &&
    a.delayTone === b.delayTone &&
    a.delaySpread === b.delaySpread;
}
