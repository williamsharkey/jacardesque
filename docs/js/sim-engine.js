// Offline song simulator — same sequencing + FX trigger logic as the live app,
// no Web Audio, not real-time. Emits a tracker-style event log (JSONL).
//
// Deterministic when given a seed (ProbGateTile uses Sequencer._random).

import { Sequencer, createSeededRandom } from "./core.js";
import {
  ensureFxLists,
  applyFxTriggers,
  collectPatternTriggers,
  playheadCells,
} from "./fx-model.js";
import { resolveLaneChannel, ensureInstruments } from "./inst-model.js";

/**
 * @typedef {object} SimPattern
 * @property {string} id
 * @property {import('./core.js').Project} project
 */

/**
 * Format one event as a tracker-style tab-separated line:
 *   step  sample  type  key=value ...
 * Also available as structured objects via events[].
 */
export function formatEventLine(ev) {
  const parts = [
    String(ev.step ?? 0),
    String(ev.sample ?? 0),
    ev.type || "?",
  ];
  for (const [k, v] of Object.entries(ev)) {
    if (k === "step" || k === "sample" || k === "type") continue;
    if (v == null) continue;
    if (typeof v === "number") {
      parts.push(k + "=" + (Number.isInteger(v) ? v : +v.toFixed(5)));
    } else {
      parts.push(k + "=" + String(v).replace(/\s+/g, "_"));
    }
  }
  return parts.join("\t");
}

export function eventsToJsonl(events) {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
}

export function eventsToTracker(events) {
  return events.map(formatEventLine).join("\n") + (events.length ? "\n" : "");
}

/**
 * Run the Jacquard sequencing + adjacency-trigger engine offline.
 *
 * Same code paths as main.js:
 *   Sequencer.schedule → note events
 *   applyFxTriggers → ON/OFF/param/chan
 *   collectPatternTriggers → pattern switches (with playAligned)
 */
export class SongSimulator {
  /**
   * @param {object} opts
   * @param {SimPattern[]} opts.patterns  ordered bank
   * @param {number} [opts.seed=1]
   * @param {number} [opts.sampleRate=48000]
   * @param {number} [opts.lookaheadSec=0.05]
   * @param {number} [opts.startIndex=0]
   */
  constructor({
    patterns,
    seed = 1,
    sampleRate = 48000,
    lookaheadSec = 0.05,
    startIndex = 0,
  }) {
    if (!patterns?.length) throw new Error("SongSimulator: patterns required");
    this.patterns = patterns.map((p) => ({
      id: p.id,
      // Fresh project per run so automation mutations don't leak across tests
      project: typeof p.build === "function" ? p.build() : p.project,
    }));
    this.seed = seed;
    this.sampleRate = sampleRate | 0;
    this.lookaheadSamples = Math.max(64, Math.round(lookaheadSec * this.sampleRate));
    this.index = ((startIndex % this.patterns.length) + this.patterns.length) % this.patterns.length;
    this.events = [];
    this.sequencer = new Sequencer();
    this.sequencer.setRandomSeed(seed);
    this.sequencer._laneChannelResolver = (score, lane) => {
      ensureInstruments(score);
      return resolveLaneChannel(score, lane);
    };
    this._fxAutoLatch = new Map();
    this._fxTrigFired = new Map();
    this._patternFire = new Map();
    this.songOriginSample = 0;
    this.globalStep = 0; // monotonic sixteenth at active tempo
    this._switching = false;
    this._load(this.index, { aligned: false, sample: 0 });
  }

  get project() {
    return this.patterns[this.index].project;
  }

  get patternId() {
    return this.patterns[this.index].id;
  }

  _load(index, { aligned, sample }) {
    this.index = ((index % this.patterns.length) + this.patterns.length) % this.patterns.length;
    const slot = this.patterns[this.index];
    slot.project.syncGrid?.();
    ensureFxLists(slot.project.score);
    this.sequencer.project = slot.project;
    this._patternFire.clear();
    // Keep latch/fired across seamless switches (sample-and-hold continuity)
    if (!aligned) {
      this._fxAutoLatch.clear();
      this._fxTrigFired.clear();
      this.sequencer.play(sample, 0);
    } else {
      this.sequencer.playAligned(
        sample,
        this.lookaheadSamples,
        this.songOriginSample,
        this.sampleRate,
      );
    }
  }

  _emit(partial) {
    const tempo = Math.max(1, this.project.tempo);
    const samplesPer16th = (60 / tempo) * (4 / 16) * this.sampleRate;
    const sample = partial.sample | 0;
    const step = samplesPer16th > 0
      ? Math.floor(Math.max(0, sample - this.songOriginSample) / samplesPer16th)
      : 0;
    this.globalStep = Math.max(this.globalStep, step);
    this.events.push({
      step,
      sample,
      pattern: this.patternId,
      patternIndex: this.index,
      ...partial,
    });
  }

  _switchFromTrigger(t, sample) {
    if (this._switching) return;
    this._switching = true;
    try {
      let next = this.index;
      if (t.op === "inc") next = this.index + 1;
      else if (t.op === "dec") next = this.index - 1;
      else if (t.op === "jumpId" && t.targetPattern) {
        const i = this.patterns.findIndex((p) => p.id === t.targetPattern);
        if (i >= 0) next = i;
      } else if (t.op === "jump" || t.op === "jumpId") {
        next = t.n | 0;
      }
      next = ((next % this.patterns.length) + this.patterns.length) % this.patterns.length;
      if (next === this.index) return;
      this._emit({
        type: "pattern",
        sample,
        from: this.patternId,
        to: this.patterns[next].id,
        op: t.op,
        triggerId: t.id,
      });
      this._load(next, { aligned: true, sample });
    } finally {
      this._switching = false;
    }
  }

  /**
   * Simulate for a wall-clock duration (audio time), no audio rendering.
   * @param {object} opts
   * @param {number} [opts.seconds=32]
   * @param {boolean} [opts.logPlayhead=false]  emit playhead rows (verbose)
   * @returns {{ events: object[], lines: string, jsonl: string, stats: object }}
   */
  run({ seconds = 32, logPlayhead = false } = {}) {
    const end = Math.round(seconds * this.sampleRate);
    let current = 0;
    this.songOriginSample = 0;
    this.events = [];
    this._emit({
      type: "meta",
      sample: 0,
      seed: this.seed,
      sampleRate: this.sampleRate,
      tempo: this.project.tempo,
      patterns: this.patterns.map((p) => p.id).join(","),
    });
    this._emit({
      type: "pattern",
      sample: 0,
      from: null,
      to: this.patternId,
      op: "start",
    });

    let guard = 0;
    const maxIters = Math.ceil(end / this.lookaheadSamples) + this.patterns.length * 8 + 64;

    while (current < end && guard++ < maxIters) {
      const notes = [];
      this.sequencer.schedule(
        current,
        this.lookaheadSamples,
        this.sampleRate,
        notes,
      );

      for (const n of notes) {
        this._emit({
          type: "note",
          sample: n.startSample | 0,
          ch: n.channel | 0,
          midi: n.midi | 0,
          freq: +n.frequency.toFixed(3),
          level: +n.level.toFixed(4),
          dur: +n.duration.toFixed(4),
          pan: +n.pan.toFixed(3),
          inst: n.instrument | 0,
        });
      }

      // FX + pattern triggers — same as main.js tick
      ensureFxLists(this.project.score);
      const playing = this.sequencer.isPlaying;
      const { fires } = applyFxTriggers(
        this.project.score,
        this.sequencer.runners,
        playing,
        this._fxAutoLatch,
        this._fxTrigFired,
        this.project.patches,
      );

      for (const f of fires) {
        this._emit({
          type: "trig",
          sample: current,
          kind: f.kind,
          id: f.id,
          target: f.targetFxId || null,
          fx: f.fxType || null,
          ch: f.channel ?? null,
          param: f.paramKey || null,
          value: f.value != null ? +Number(f.value).toFixed(5) : null,
        });
      }

      const patternHits = collectPatternTriggers(
        this.project.score,
        this.sequencer.runners,
        this._patternFire,
      );
      // Prune stale pattern debounce (mirror main.js)
      const live = new Set(patternHits.map((t) => t.id));
      const cells = playheadCells(this.sequencer.runners);
      for (const id of [...this._patternFire.keys()]) {
        if (live.has(id)) continue;
        // Drop when no longer adjacent / under column
        let still = false;
        const mod = this.project.score.fxModules.find((m) => m.id === id);
        if (mod) {
          for (const c of cells) {
            if (c.x >= mod.x && c.x < mod.x + mod.w) {
              still = true;
              break;
            }
          }
        } else {
          const trig = this.project.score.fxTriggers.find((t) => t.id === id);
          if (trig) {
            for (const c of cells) {
              if (Math.abs(c.x - trig.x) + Math.abs(c.y - trig.y) === 1) {
                still = true;
                break;
              }
            }
          }
        }
        if (!still) this._patternFire.delete(id);
      }

      if (patternHits.length) {
        this._switchFromTrigger(patternHits[0], current);
      }

      if (logPlayhead) {
        for (const c of cells) {
          this._emit({
            type: "playhead",
            sample: current,
            x: c.x,
            y: c.y,
            ch: c.channel,
            laneStep: c.step,
          });
        }
      }

      current += this.lookaheadSamples;
    }

    const stats = this._stats();
    return {
      events: this.events,
      lines: eventsToTracker(this.events),
      jsonl: eventsToJsonl(this.events),
      stats,
    };
  }

  _stats() {
    const byType = {};
    const patterns = new Set();
    let notes = 0;
    let trigs = 0;
    let switches = 0;
    for (const e of this.events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      if (e.pattern) patterns.add(e.pattern);
      if (e.type === "note") notes++;
      if (e.type === "trig") trigs++;
      if (e.type === "pattern" && e.op !== "start") switches++;
    }
    return {
      total: this.events.length,
      notes,
      trigs,
      switches,
      patterns: [...patterns],
      byType,
      seed: this.seed,
    };
  }
}

/**
 * Convenience: build suite from factory entries `{id, build}` and run.
 */
export function simulateSuite(entries, {
  seed = 1,
  seconds = 32,
  sampleRate = 48000,
  logPlayhead = false,
} = {}) {
  const sim = new SongSimulator({
    patterns: entries,
    seed,
    sampleRate,
  });
  return sim.run({ seconds, logPlayhead });
}

export { createSeededRandom };
