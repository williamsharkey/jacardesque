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
    this._lastDspSample = 0;
    this._lastReportTime = null;
  }

  get lookaheadSamples() {
    return Math.floor(this.lookahead * this.sampleRate);
  }

  async init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.context = new AC({ latencyHint: "interactive" });
    this.sampleRate = this.context.sampleRate;

    const workletUrl = new URL("./processor.js", import.meta.url);
    await this.context.audioWorklet.addModule(workletUrl.href);

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
  }

  // Extrapolate between worklet status reports so the sequencer keeps advancing.
  pollSample() {
    if (!this.ready) return 0;
    if (this._lastReportTime == null) return this._lastDspSample;
    const elapsed = (performance.now() - this._lastReportTime) / 1000;
    return this._lastDspSample + Math.floor(elapsed * this.sampleRate);
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
