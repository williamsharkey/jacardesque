/**
 * JqDx7 — compact 6-operator DX7-style FM core (plain JS, no imports).
 *
 * Attach: globalThis.JqDx7 = { init, createState, trigger, render, SIN_LEN }
 * Worklet-safe: no allocations on the render path after init/trigger.
 *
 * Algorithm select: algo = ((note.modulatorRatio * 4) | 0) % 32  (0..31)
 *   ratio 0.25 → algo 1, 1.0 → algo 4, 2.0 → algo 8, 4.0 → algo 16, 8.0 → algo 0/32
 * modulationIndex → global index scale (0–8, capped)
 * feedback → feedback amount on algorithm fb op (0–4 → ~0–π)
 * modulatorDecay → modulator EG decay
 * carrierAttack / carrierRelease → carrier EG
 *
 * Topology: all 32 Yamaha DX7 algorithms as packed route tables.
 * Envelopes: lightweight 2-segment (attack + decay) per op — not full 4-level DX EG.
 */
(function (global) {
  "use strict";

  var SIN_LEN = 4096;
  var SIN_MASK = SIN_LEN - 1;
  var NUM_OPS = 6;
  var NUM_ALGOS = 32;
  var TWO_PI = Math.PI * 2;

  /** @type {Float32Array|null} */
  var SIN_LUT = null;
  /**
   * ROUTE[algo*6+op]: bit0-5 = modulates those ops; bit6 = contributes to audio out.
   * @type {Uint8Array|null}
   */
  var ROUTE = null;
  /** @type {Int8Array|null} MOD_SRC[algo*6+op] primary modulator of op (-1 none) */
  var MOD_SRC = null;
  /** @type {Int8Array|null} IS_OUT[algo*6+op] */
  var IS_OUT = null;
  /** @type {Int8Array|null} FB_OP[algo] feedback op (-1 none) */
  var FB_OP = null;

  var _inited = false;

  // ---------------------------------------------------------------------------
  // DX7 algorithm topology (ops 0..5 = Yamaha 1..6)
  // Each entry: [dests for op0..op5, fbOp]
  // dest is array of target op indices; empty array means carrier (audio out only).
  // An op can be both a carrier and a modulator only if listed in dests of others;
  // carriers are ops that appear as audio outs (not exclusively intermediate).
  // ---------------------------------------------------------------------------
  // Format per algo: { d: [[targets of op0], ... [targets of op5]], fb: opIndex }
  // targets empty + is carrier: audio out. If op only modulates, no audio bit.
  // Carriers = ops that sum to the bus (standard DX7 bottom-row ops).

  function buildAlgos() {
    // Helper: chain and parallel structures as destination lists (0-indexed).
    // d[op] = list of ops this op modulates. isCarrier[op] separate.
    // Returns packed description.

    // Standard 32 algorithms (public Yamaha routing knowledge).
    // isC: which ops are carriers (audio out). fb: feedback operator.
    // edges: list of [src, dst] modulation edges (src modulates dst).
    var specs = [
      // 1: 6→5→4→3→2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 2], [2, 1], [1, 0]], fb: 5 },
      // 2: 6→5→4→3→1, 2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 2], [2, 0], [1, 0]], fb: 1 },
      // 3: 6→5→4→1, 3→2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 0], [2, 1], [1, 0]], fb: 5 },
      // 4: same as 3, FB on 4
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 0], [2, 1], [1, 0]], fb: 3 },
      // 5: 6→5→1, 4→3→1, 2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 0], [3, 2], [2, 0], [1, 0]], fb: 5 },
      // 6: same, FB on 5
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 0], [3, 2], [2, 0], [1, 0]], fb: 4 },
      // 7: 6→5→4→1, 3→1, 2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 0], [2, 0], [1, 0]], fb: 5 },
      // 8: same, FB on 4
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 0], [2, 0], [1, 0]], fb: 3 },
      // 9: same, FB on 2
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 3], [3, 0], [2, 0], [1, 0]], fb: 1 },
      // 10: 6→5→3→1, 4→3, 2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 2], [3, 2], [2, 0], [1, 0]], fb: 2 },
      // 11: same, FB on 6
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 4], [4, 2], [3, 2], [2, 0], [1, 0]], fb: 5 },
      // 12: 5→4→3→1, 6→3, 2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[4, 3], [3, 2], [2, 0], [5, 2], [1, 0]], fb: 1 },
      // 13: same, FB on 6
      { c: [1, 0, 0, 0, 0, 0], e: [[4, 3], [3, 2], [2, 0], [5, 2], [1, 0]], fb: 5 },
      // 14: 5→4→1, 6→4, 3→2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[4, 3], [3, 0], [5, 3], [2, 1], [1, 0]], fb: 5 },
      // 15: same, FB on 2
      { c: [1, 0, 0, 0, 0, 0], e: [[4, 3], [3, 0], [5, 3], [2, 1], [1, 0]], fb: 1 },
      // 16: 6→1, 5→1, 4→1, 3→2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 0], [4, 0], [3, 0], [2, 1], [1, 0]], fb: 5 },
      // 17: same, FB on 2
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 0], [4, 0], [3, 0], [2, 1], [1, 0]], fb: 1 },
      // 18: 6→1, 5→1, 4→3→2→1
      { c: [1, 0, 0, 0, 0, 0], e: [[5, 0], [4, 0], [3, 2], [2, 1], [1, 0]], fb: 5 },
      // 19: carriers 1,4 — 3→1, 2→1, 6→5→4
      { c: [1, 0, 0, 1, 0, 0], e: [[2, 0], [1, 0], [5, 4], [4, 3]], fb: 5 },
      // 20: carriers 1,2,4 — 3→1, 3→2, 6→5→4; FB3
      { c: [1, 1, 0, 1, 0, 0], e: [[2, 0], [2, 1], [5, 4], [4, 3]], fb: 2 },
      // 21: carriers 1,2,4 — 3→1, 3→2, 6→4, 5→4; FB3
      { c: [1, 1, 0, 1, 0, 0], e: [[2, 0], [2, 1], [5, 3], [4, 3]], fb: 2 },
      // 22: carriers 1,3,4 — 2→1, 6→5→3, 6→4; FB6
      { c: [1, 0, 1, 1, 0, 0], e: [[1, 0], [5, 4], [4, 2], [5, 3]], fb: 5 },
      // 23: carriers 1,3,4 — 2→1, 5→3, 6→4; FB6
      { c: [1, 0, 1, 1, 0, 0], e: [[1, 0], [4, 2], [5, 3]], fb: 5 },
      // 24: carriers 1,2,3,4 — 6→4, 6→3, 6→2; FB6 (op5 carrier)
      { c: [1, 1, 1, 1, 1, 0], e: [[5, 3], [5, 2], [5, 1]], fb: 5 },
      // 25: carriers 1,2,3,4 — 6→4, 6→3; FB6 (op5 carrier)
      { c: [1, 1, 1, 1, 1, 0], e: [[5, 3], [5, 2]], fb: 5 },
      // 26: carriers 1,2,4 — 5→4, 6→4, 3→2; FB6
      { c: [1, 1, 0, 1, 0, 0], e: [[4, 3], [5, 3], [2, 1]], fb: 5 },
      // 27: same, FB on 3
      { c: [1, 1, 0, 1, 0, 0], e: [[4, 3], [5, 3], [2, 1]], fb: 2 },
      // 28: carriers 1,3 — 2→1, 6→5→4→3; FB5
      { c: [1, 0, 1, 0, 0, 0], e: [[1, 0], [5, 4], [4, 3], [3, 2]], fb: 4 },
      // 29: carriers 1,2,3,4 — 6→5→4; FB6
      { c: [1, 1, 1, 1, 0, 0], e: [[5, 4], [4, 3]], fb: 5 },
      // 30: carriers 1,2,3 — 6→5→4; FB6
      { c: [1, 1, 1, 0, 0, 0], e: [[5, 4], [4, 3]], fb: 5 },
      // 31: carriers 1,2,3,4,5 — 6→5; FB6
      { c: [1, 1, 1, 1, 1, 0], e: [[5, 4]], fb: 5 },
      // 32: all six carriers; FB6
      { c: [1, 1, 1, 1, 1, 1], e: [], fb: 5 },
    ];

    ROUTE = new Uint8Array(NUM_ALGOS * NUM_OPS);
    MOD_SRC = new Int8Array(NUM_ALGOS * NUM_OPS);
    IS_OUT = new Int8Array(NUM_ALGOS * NUM_OPS);
    FB_OP = new Int8Array(NUM_ALGOS);

    for (var a = 0; a < NUM_ALGOS; a++) {
      var sp = specs[a];
      FB_OP[a] = sp.fb | 0;
      // reverse: who modulates each op (first wins for MOD_SRC)
      for (var o = 0; o < NUM_OPS; o++) {
        MOD_SRC[a * NUM_OPS + o] = -1;
        IS_OUT[a * NUM_OPS + o] = sp.c[o] ? 1 : 0;
        var r = sp.c[o] ? 0x40 : 0;
        ROUTE[a * NUM_OPS + o] = r;
      }
      for (var i = 0; i < sp.e.length; i++) {
        var src = sp.e[i][0];
        var dst = sp.e[i][1];
        ROUTE[a * NUM_OPS + src] |= 1 << dst;
        // MOD_SRC[dst] = last (or first) modulator — keep first for stability
        if (MOD_SRC[a * NUM_OPS + dst] < 0) {
          MOD_SRC[a * NUM_OPS + dst] = src;
        }
      }
    }
  }

  function init() {
    if (_inited) return;
    SIN_LUT = new Float32Array(SIN_LEN);
    for (var i = 0; i < SIN_LEN; i++) {
      SIN_LUT[i] = Math.sin((TWO_PI * i) / SIN_LEN);
    }
    buildAlgos();
    _inited = true;
  }

  /**
   * Linear-interpolated sine from phase fraction 0..1 (wrapped).
   * @param {number} phase
   */
  function sinLUT(phase) {
    // phase may be outside 0..1; wrap via trunc trick on scaled index
    var x = phase * SIN_LEN;
    // force positive fractional via wrap
    x = x - Math.floor(x / SIN_LEN) * SIN_LEN;
    if (x < 0) x += SIN_LEN;
    var i0 = x | 0;
    var f = x - i0;
    var s0 = SIN_LUT[i0 & SIN_MASK];
    var s1 = SIN_LUT[(i0 + 1) & SIN_MASK];
    return s0 + (s1 - s0) * f;
  }

  /**
   * Soft clip — cubic (cheaper than tanh).
   * @param {number} x
   */
  function softclip(x) {
    if (x > 1.5) return 1.0;
    if (x < -1.5) return -1.0;
    return x - (x * x * x) * 0.148148148; // ~1/6.75
  }

  /**
   * Preallocate flat voice state. Call once per voice.
   */
  function createState() {
    return {
      // oscillator
      phases: new Float32Array(NUM_OPS),
      increments: new Float32Array(NUM_OPS),
      // per-op output (feedback + routing)
      opOut: new Float32Array(NUM_OPS),
      // modulation accumulator (cleared each sample)
      modAccum: new Float32Array(NUM_OPS),
      // envelopes: level amp, attack rate, decay rate, current env, stage (0=atk,1=dec)
      env: new Float32Array(NUM_OPS),
      envAtk: new Float32Array(NUM_OPS),
      envDec: new Float32Array(NUM_OPS),
      envPeak: new Float32Array(NUM_OPS),
      envStage: new Int8Array(NUM_OPS), // 0 attack, 1 decay/sustain-fall
      // feedback
      fbPrev: 0,
      fbAmt: 0,
      // algorithm + index
      algo: 0,
      indexScale: 1,
      outGain: 0.7,
      // carrier mask / pre-sliced route base
      routeBase: 0,
      fbOp: 5,
      // sample rate stash
      sampleRate: 48000,
      // note level
      level: 1,
    };
  }

  /**
   * Note-on: configure ratios, EG, algorithm from patch knobs.
   * @param {object} state from createState()
   * @param {object} note
   * @param {number} sampleRate
   */
  function trigger(state, note, sampleRate) {
    if (!_inited) init();
    var sr = sampleRate > 0 ? sampleRate : 48000;
    state.sampleRate = sr;

    var freq = note.frequency > 0 ? note.frequency : 261.625565;
    var baseInc = freq / sr;

    // Algorithm from modulatorRatio (documented mapping)
    var ratio = note.modulatorRatio != null ? note.modulatorRatio : 1;
    var algo = ((ratio * 4) | 0) % NUM_ALGOS;
    if (algo < 0) algo += NUM_ALGOS;
    state.algo = algo;
    state.routeBase = algo * NUM_OPS;
    state.fbOp = FB_OP[algo];

    // Ratios: classic stacked EP/brass-ish + note ratio on op4
    var r4 = ratio;
    if (r4 < 0.5) r4 = 0.5;
    if (r4 > 8) r4 = 8;
    // light detune from feedback knob
    var fbKnob = note.feedback != null ? note.feedback : 0;
    if (fbKnob < 0) fbKnob = 0;
    if (fbKnob > 4) fbKnob = 4;
    var det = 1 + fbKnob * 0.0015;

    // Ratios: op1 carrier 1.0, op2 detuned, op3=2, op4=note ratio, op5=3, op6=4
    state.phases[0] = 0;
    state.phases[1] = 0.17;
    state.phases[2] = 0.31;
    state.phases[3] = 0.47;
    state.phases[4] = 0.63;
    state.phases[5] = 0.79;

    state.increments[0] = baseInc * 1.0;
    state.increments[1] = baseInc * (1.0 * det);
    state.increments[2] = baseInc * 2.0;
    state.increments[3] = baseInc * r4;
    state.increments[4] = baseInc * 3.0;
    state.increments[5] = baseInc * 4.0;

    // Global index (cap for dense chords)
    var idx = note.modulationIndex != null ? note.modulationIndex : 1;
    if (idx < 0) idx = 0;
    if (idx > 8) idx = 8;
    state.indexScale = idx * 0.55;

    // Feedback amount → ~0..π scale on unit-ish op out
    state.fbAmt = fbKnob * 0.7;
    state.fbPrev = 0;

    // Output gain from note level
    var lvl = note.level != null ? note.level : 1;
    if (lvl < 0) lvl = 0;
    if (lvl > 2) lvl = 2;
    state.level = lvl;
    state.outGain = 0.55 * lvl;

    // Envelopes: 2-segment. Carriers use carrierAttack/Release; modulators use fast atk + modulatorDecay.
    var cAtk = note.carrierAttack != null ? note.carrierAttack : 0.01;
    var cRel = note.carrierRelease != null ? note.carrierRelease : 0.3;
    var mDec = note.modulatorDecay != null ? note.modulatorDecay : 0.2;
    if (cAtk < 0.001) cAtk = 0.001;
    if (cRel < 0.01) cRel = 0.01;
    if (mDec < 0.01) mDec = 0.01;

    // Rate = level change per sample. Attack goes 0→peak; decay goes peak→0 asymptotically-ish.
    // Simple linear attack, exponential-ish decay via constant subtract of fraction.
    var isOut;
    for (var op = 0; op < NUM_OPS; op++) {
      isOut = IS_OUT[state.routeBase + op];
      state.env[op] = 0;
      state.envStage[op] = 0;
      state.opOut[op] = 0;
      state.modAccum[op] = 0;

      if (isOut) {
        // carrier: slower attack, release-scale decay; peak near 1
        state.envPeak[op] = 1;
        state.envAtk[op] = 1 / (cAtk * sr);
        // decay rate toward 0 over ~cRel seconds (linear for simplicity)
        state.envDec[op] = 1 / (cRel * sr);
      } else {
        // modulator: very fast attack, decay from modulatorDecay; peak scales with index
        state.envPeak[op] = 1;
        state.envAtk[op] = 1 / (0.004 * sr);
        state.envDec[op] = 1 / (mDec * sr);
      }
    }

    // Mild velocity/level influence on modulator peaks
    var modPeak = 0.65 + Math.min(idx, 6) * 0.12;
    for (var m = 0; m < NUM_OPS; m++) {
      if (!IS_OUT[state.routeBase + m]) {
        state.envPeak[m] = modPeak;
      }
    }
  }

  /**
   * Render one mono sample.
   * @param {object} state
   * @param {number} time seconds since note on (unused for EG — sample-accurate env inside)
   * @param {number} envCarrier outer gate envelope 0..1
   * @returns {number}
   */
  function render(state, time, envCarrier) {
    var gate = envCarrier;
    if (gate <= 0) return 0;

    var base = state.routeBase;
    var idxScale = state.indexScale;
    var fbOp = state.fbOp;
    var fbAmt = state.fbAmt;
    var phases = state.phases;
    var incs = state.increments;
    var opOut = state.opOut;
    var accum = state.modAccum;
    var env = state.env;
    var envAtk = state.envAtk;
    var envDec = state.envDec;
    var envPeak = state.envPeak;
    var envStage = state.envStage;

    // clear accumulators
    accum[0] = 0;
    accum[1] = 0;
    accum[2] = 0;
    accum[3] = 0;
    accum[4] = 0;
    accum[5] = 0;

    // --- envelopes (sample-accurate 2-segment) ---
    for (var e = 0; e < NUM_OPS; e++) {
      if (envStage[e] === 0) {
        env[e] += envAtk[e];
        if (env[e] >= envPeak[e]) {
          env[e] = envPeak[e];
          envStage[e] = 1;
        }
      } else {
        env[e] -= envDec[e];
        if (env[e] < 0) env[e] = 0;
      }
    }

    // --- operators high → low (6 → 1) so modulators feed before carriers read ---
    var audio = 0;
    var fbSample = state.fbPrev;

    // Unrolled op loop for 6 ops (5 down to 0)
    // Op 5
    {
      var pm5 = accum[5];
      if (fbOp === 5) pm5 += fbSample * fbAmt;
      var s5 = sinLUT(phases[5] + pm5) * env[5];
      opOut[5] = s5;
      phases[5] += incs[5];
      if (phases[5] >= 1) phases[5] -= 1;
      var r5 = ROUTE[base + 5];
      var scaled5 = s5 * idxScale;
      if (r5 & 1) accum[0] += scaled5;
      if (r5 & 2) accum[1] += scaled5;
      if (r5 & 4) accum[2] += scaled5;
      if (r5 & 8) accum[3] += scaled5;
      if (r5 & 16) accum[4] += scaled5;
      if (r5 & 32) accum[5] += scaled5;
      if (r5 & 0x40) audio += s5;
      if (fbOp === 5) fbSample = s5;
    }
    // Op 4
    {
      var pm4 = accum[4];
      if (fbOp === 4) pm4 += fbSample * fbAmt;
      var s4 = sinLUT(phases[4] + pm4) * env[4];
      opOut[4] = s4;
      phases[4] += incs[4];
      if (phases[4] >= 1) phases[4] -= 1;
      var r4 = ROUTE[base + 4];
      var scaled4 = s4 * idxScale;
      if (r4 & 1) accum[0] += scaled4;
      if (r4 & 2) accum[1] += scaled4;
      if (r4 & 4) accum[2] += scaled4;
      if (r4 & 8) accum[3] += scaled4;
      if (r4 & 16) accum[4] += scaled4;
      if (r4 & 32) accum[5] += scaled4;
      if (r4 & 0x40) audio += s4;
      if (fbOp === 4) fbSample = s4;
    }
    // Op 3
    {
      var pm3 = accum[3];
      if (fbOp === 3) pm3 += fbSample * fbAmt;
      var s3 = sinLUT(phases[3] + pm3) * env[3];
      opOut[3] = s3;
      phases[3] += incs[3];
      if (phases[3] >= 1) phases[3] -= 1;
      var r3 = ROUTE[base + 3];
      var scaled3 = s3 * idxScale;
      if (r3 & 1) accum[0] += scaled3;
      if (r3 & 2) accum[1] += scaled3;
      if (r3 & 4) accum[2] += scaled3;
      if (r3 & 8) accum[3] += scaled3;
      if (r3 & 16) accum[4] += scaled3;
      if (r3 & 32) accum[5] += scaled3;
      if (r3 & 0x40) audio += s3;
      if (fbOp === 3) fbSample = s3;
    }
    // Op 2
    {
      var pm2 = accum[2];
      if (fbOp === 2) pm2 += fbSample * fbAmt;
      var s2 = sinLUT(phases[2] + pm2) * env[2];
      opOut[2] = s2;
      phases[2] += incs[2];
      if (phases[2] >= 1) phases[2] -= 1;
      var r2 = ROUTE[base + 2];
      var scaled2 = s2 * idxScale;
      if (r2 & 1) accum[0] += scaled2;
      if (r2 & 2) accum[1] += scaled2;
      if (r2 & 4) accum[2] += scaled2;
      if (r2 & 8) accum[3] += scaled2;
      if (r2 & 16) accum[4] += scaled2;
      if (r2 & 32) accum[5] += scaled2;
      if (r2 & 0x40) audio += s2;
      if (fbOp === 2) fbSample = s2;
    }
    // Op 1
    {
      var pm1 = accum[1];
      if (fbOp === 1) pm1 += fbSample * fbAmt;
      var s1 = sinLUT(phases[1] + pm1) * env[1];
      opOut[1] = s1;
      phases[1] += incs[1];
      if (phases[1] >= 1) phases[1] -= 1;
      var r1 = ROUTE[base + 1];
      var scaled1 = s1 * idxScale;
      if (r1 & 1) accum[0] += scaled1;
      if (r1 & 2) accum[1] += scaled1;
      if (r1 & 4) accum[2] += scaled1;
      if (r1 & 8) accum[3] += scaled1;
      if (r1 & 16) accum[4] += scaled1;
      if (r1 & 32) accum[5] += scaled1;
      if (r1 & 0x40) audio += s1;
      if (fbOp === 1) fbSample = s1;
    }
    // Op 0 (usually primary carrier)
    {
      var pm0 = accum[0];
      if (fbOp === 0) pm0 += fbSample * fbAmt;
      var s0 = sinLUT(phases[0] + pm0) * env[0];
      opOut[0] = s0;
      phases[0] += incs[0];
      if (phases[0] >= 1) phases[0] -= 1;
      var r0 = ROUTE[base + 0];
      // op0 rarely modulates others, but handle fully
      var scaled0 = s0 * idxScale;
      if (r0 & 1) accum[0] += scaled0;
      if (r0 & 2) accum[1] += scaled0;
      if (r0 & 4) accum[2] += scaled0;
      if (r0 & 8) accum[3] += scaled0;
      if (r0 & 16) accum[4] += scaled0;
      if (r0 & 32) accum[5] += scaled0;
      if (r0 & 0x40) audio += s0;
      if (fbOp === 0) fbSample = s0;
    }

    state.fbPrev = fbSample;

    // Normalize multi-carrier algos a bit (count carriers via IS_OUT not free)
    // Soft clip + outer gate
    var out = softclip(audio * state.outGain) * gate;
    return out;
  }

  // Expose tables for tests / debug (not required by worklet)
  function getTables() {
    return { ROUTE: ROUTE, MOD_SRC: MOD_SRC, IS_OUT: IS_OUT, FB_OP: FB_OP, SIN_LUT: SIN_LUT };
  }

  global.JqDx7 = {
    init: init,
    createState: createState,
    trigger: trigger,
    render: render,
    SIN_LEN: SIN_LEN,
    getTables: getTables,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
