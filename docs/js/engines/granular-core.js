// Jacquardesque granular synth core — low-CPU / low-memory, no alloc in render.
// Plain JS (no ES modules). Attach: globalThis.JqGranular = { init, createState, trigger, render, memBytes }.
//
// Shared source: procedural mono pad (soft noise + 3 harmonic sines), max 8192 samples.
// Per-voice: 6 preallocated grain slots (struct-of-arrays). Hann window LUT 256.

(function (global) {
  "use strict";

  var MAX_GRAINS = 6;
  var MAX_SOURCE = 8192;
  var HANN_LEN = 256;
  // Source buffer is authored around C4 so grain rate ≈ freq / ROOT_HZ.
  var ROOT_HZ = 261.625565;

  var _sr = 0;
  var _source = null; // Float32Array
  var _sourceLen = 0;
  var _hann = null; // Float32Array length 256
  var _inited = false;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function softClip(x) {
    // Cheap cubic soft clip, no branching beyond clamp
    if (x > 1.5) return 1;
    if (x < -1.5) return -1;
    return x - (x * x * x) / 6.75;
  }

  function buildHann() {
    var h = new Float32Array(HANN_LEN);
    var n1 = HANN_LEN - 1;
    for (var i = 0; i < HANN_LEN; i++) {
      // 0.5 * (1 - cos(2π i / (N-1)))
      h[i] = 0.5 * (1 - Math.cos((6.283185307179586 * i) / n1));
    }
    // Endpoints exactly 0
    h[0] = 0;
    h[n1] = 0;
    return h;
  }

  function buildSource(sampleRate) {
    // Cap length for tiny mem; prefer worklet sampleRate for correct pitch.
    var len = Math.min(MAX_SOURCE, Math.max(256, (sampleRate * 0.17) | 0));
    var buf = new Float32Array(len);
    var invSr = 1 / sampleRate;
    var twoPi = 6.283185307179586;
    // Deterministic soft noise (LCG) so init is pure
    var seed = 0xC0FFEE ^ (sampleRate | 0);
    function rnd() {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296; // [0,1)
    }
    // Soft amplitude envelope over the whole buffer (fade edges)
    for (var i = 0; i < len; i++) {
      var t = i * invSr;
      var phase = twoPi * ROOT_HZ * t;
      // Edge fade: ~5 ms equivalent in samples (scaled to length)
      var edge = Math.min(64, (len * 0.08) | 0);
      var fade = 1;
      if (i < edge) fade = i / edge;
      else if (i >= len - edge) fade = (len - 1 - i) / edge;
      // Layered soft noise (LP-ish via one-pole on successive samples)
      var n = (rnd() * 2 - 1) * 0.22;
      // 3 harmonic sines (slight 3rd detune for pad warmth)
      var s1 = Math.sin(phase) * 0.42;
      var s2 = Math.sin(phase * 2) * 0.22;
      var s3 = Math.sin(phase * 3.01) * 0.12;
      // Mild slow AM on noise so grains don't all sound static
      var am = 0.7 + 0.3 * Math.sin(twoPi * 3.7 * t);
      buf[i] = (s1 + s2 + s3 + n * am) * fade;
    }
    // One-pole soften noise grit in-place
    var lp = 0;
    for (var j = 0; j < len; j++) {
      lp += (buf[j] - lp) * 0.35;
      // Blend harmonic core back so pitch stays clear
      buf[j] = buf[j] * 0.55 + lp * 0.45;
    }
    // Peak normalize to ~0.9
    var peak = 0;
    for (var k = 0; k < len; k++) {
      var a = buf[k] < 0 ? -buf[k] : buf[k];
      if (a > peak) peak = a;
    }
    if (peak > 1e-6) {
      var g = 0.9 / peak;
      for (var m = 0; m < len; m++) buf[m] *= g;
    }
    return buf;
  }

  /**
   * Build shared source buffer + Hann LUT. Idempotent for same sampleRate.
   * @param {number} sampleRate
   */
  function init(sampleRate) {
    var sr = sampleRate > 0 ? sampleRate : 48000;
    if (_inited && _sr === sr && _source && _hann) return;
    _sr = sr;
    _source = buildSource(sr);
    _sourceLen = _source.length;
    _hann = buildHann();
    _inited = true;
  }

  /**
   * Preallocate grain SoA + scheduler state for one voice. No further alloc in render.
   */
  function createState() {
    return {
      // Grain SoA (MAX_GRAINS)
      gPos: new Float32Array(MAX_GRAINS),
      gRate: new Float32Array(MAX_GRAINS),
      gAge: new Float32Array(MAX_GRAINS),
      gLife: new Float32Array(MAX_GRAINS),
      gAmp: new Float32Array(MAX_GRAINS),
      gActive: new Uint8Array(MAX_GRAINS),
      // Scheduler
      spawnAcc: 0,
      lastTime: 0,
      density: 0, // grains / second
      // Cached note params (set in trigger)
      baseRate: 1,
      lifeScale: 1,
      spray: 0,
      rateDrift: 0,
      fadeBias: 1,
      sampleRate: 48000,
      invSr: 1 / 48000,
      seed: 1,
      note: null,
    };
  }

  function rand01(state) {
    // xorshift32
    var x = state.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state.seed = x >>> 0 || 1;
    return (state.seed >>> 0) / 4294967296;
  }

  function findFreeSlot(state) {
    var a = state.gActive;
    for (var i = 0; i < MAX_GRAINS; i++) {
      if (!a[i]) return i;
    }
    return -1;
  }

  /**
   * Spawn one grain into slot i (or free slot if i < 0).
   * ageOffset: stagger initial grains (seconds already aged).
   */
  function spawnGrain(state, ageOffset) {
    var slot = findFreeSlot(state);
    if (slot < 0) return false;
    var len = _sourceLen;
    if (len < 2) return false;

    // Spray: randomize read position across buffer
    var spray = state.spray;
    var pos;
    if (spray > 0.001) {
      pos = rand01(state) * (len - 2) * clamp(spray, 0, 1);
    } else {
      // Mild default scatter so grains aren't phase-locked
      pos = rand01(state) * Math.min(len * 0.15, 64);
    }

    // Playback rate relative to ROOT_HZ, with small random detune for cloud
    var detune = 1 + (rand01(state) * 2 - 1) * 0.012 * (0.25 + spray);
    var rate = state.baseRate * detune;

    // Grain life: base 40–120ms scaled by lifeScale, fadeBias from release
    var baseLife = 0.035 + rand01(state) * 0.05;
    var life = baseLife * state.lifeScale * state.fadeBias;
    life = clamp(life, 0.008, 0.28);

    var amp = 0.35 + rand01(state) * 0.35;

    state.gPos[slot] = pos;
    state.gRate[slot] = rate;
    state.gAge[slot] = ageOffset > 0 ? ageOffset : 0;
    state.gLife[slot] = life;
    state.gAmp[slot] = amp;
    state.gActive[slot] = 1;
    return true;
  }

  /**
   * Map note params → grain scheduler; reset grains; spawn 2–4 initial grains.
   * @param {object} state from createState()
   * @param {object} note patch/note fields
   * @param {number} sampleRate
   */
  function trigger(state, note, sampleRate) {
    if (!_inited) init(sampleRate);

    var sr = sampleRate > 0 ? sampleRate : _sr || 48000;
    state.sampleRate = sr;
    state.invSr = 1 / sr;
    state.note = note;
    state.spawnAcc = 0;
    state.lastTime = 0;

    var freq = note && note.frequency > 0 ? note.frequency : ROOT_HZ;
    state.baseRate = freq / ROOT_HZ;

    // modulationIndex 0–8 → density (grains/sec). Cap concurrent at MAX_GRAINS.
    var index = note && note.modulationIndex != null ? note.modulationIndex : 1;
    index = clamp(index, 0, 8);
    // ~4–48 grains/sec; at max 6 slots, excess spawns replace nothing (findFree fails)
    state.density = 4 + index * 5.5;

    // modulatorRatio 0.25–8 → grain duration scale (short → long)
    var ratio = note && note.modulatorRatio != null ? note.modulatorRatio : 1;
    ratio = clamp(ratio, 0.25, 8);
    // Map log-ish: 0.25→0.35, 1→1, 8→2.4
    state.lifeScale = Math.pow(ratio, 0.55) * 0.85;

    // feedback 0–4 → spray / position randomness
    var fb = note && note.feedback != null ? note.feedback : 0;
    state.spray = clamp(fb / 4, 0, 1);

    // modulatorDecay → how fast grains die (smaller decay → shorter life)
    var mdec = note && note.modulatorDecay != null ? note.modulatorDecay : 0.18;
    mdec = clamp(mdec, 0.01, 4);
    // Higher decay value = longer grain sustain in this mapping
    state.lifeScale *= clamp(0.45 + mdec * 1.2, 0.35, 2.5);

    // carrierRelease → grain fade bias (longer release → longer grain tails)
    var rel = note && note.carrierRelease != null ? note.carrierRelease : 0.18;
    state.fadeBias = clamp(0.7 + rel * 0.9, 0.55, 2.2);

    // pitchSweep → slight grain rate drift (per-sample rate delta scale)
    var sweep = note && note.pitchSweep != null ? note.pitchSweep : 0;
    state.rateDrift = clamp(sweep, -8, 8) * 0.15;

    // Seed from startSample if available
    var ss = note && note.startSample != null ? note.startSample : 0;
    state.seed = ((ss * 1103515245 + 12345) >>> 0) || 1;

    // Reset all grains
    var act = state.gActive;
    for (var i = 0; i < MAX_GRAINS; i++) act[i] = 0;

    // Spawn 2–4 initial grains staggered in age so attack isn't a single click
    var nInit = 2 + ((state.seed >>> 8) % 3); // 2..4
    for (var g = 0; g < nInit; g++) {
      // Stagger: first grain age 0, later ones slightly aged so windows overlap
      var ageOff = g * (0.004 + (g * 0.002));
      spawnGrain(state, ageOff);
    }
  }

  /**
   * Hann window lookup at phase u in [0,1].
   */
  function hannAt(u) {
    if (u <= 0 || u >= 1) return 0;
    var x = u * (HANN_LEN - 1);
    var i0 = x | 0;
    var f = x - i0;
    var h = _hann;
    if (i0 >= HANN_LEN - 1) return h[HANN_LEN - 1];
    return h[i0] * (1 - f) + h[i0 + 1] * f;
  }

  /**
   * Render one sample at note time `time` with outer envelope `env`.
   * No allocation. Spawns grains via density accumulator.
   * @returns {number} mono sample
   */
  function render(state, time, env) {
    if (!_inited || !_source || env <= 0) {
      state.lastTime = time;
      return 0;
    }

    var dt = time - state.lastTime;
    if (dt < 0) dt = state.invSr;
    if (dt === 0) dt = state.invSr;
    // Guard pathological jumps
    if (dt > 0.05) dt = state.invSr;
    state.lastTime = time;

    // Density schedule: spawn when accumulator crosses 1
    state.spawnAcc += state.density * dt;
    while (state.spawnAcc >= 1) {
      state.spawnAcc -= 1;
      if (!spawnGrain(state, 0)) break; // all slots full
    }

    var src = _source;
    var srcLen = _sourceLen;
    var srcMax = srcLen - 1;
    var sum = 0;
    var act = state.gActive;
    var gPos = state.gPos;
    var gRate = state.gRate;
    var gAge = state.gAge;
    var gLife = state.gLife;
    var gAmp = state.gAmp;
    var drift = state.rateDrift;
    var invSr = state.invSr;

    for (var i = 0; i < MAX_GRAINS; i++) {
      if (!act[i]) continue;

      var age = gAge[i] + dt;
      var life = gLife[i];
      if (age >= life) {
        act[i] = 0;
        gAge[i] = age;
        continue;
      }
      gAge[i] = age;

      // Rate drift from pitchSweep (gentle, proportional to normalized age)
      var rate = gRate[i];
      if (drift !== 0) {
        rate *= 1 + drift * (age / life) * 0.08;
      }

      var pos = gPos[i] + rate;
      // Wrap within buffer (circular read) so long grains keep speaking
      if (pos >= srcMax) {
        pos = pos - ((pos / srcLen) | 0) * srcLen;
        if (pos < 0) pos = 0;
        if (pos >= srcMax) pos = pos % srcMax;
      } else if (pos < 0) {
        pos = 0;
      }
      gPos[i] = pos;

      var i0 = pos | 0;
      if (i0 >= srcMax) i0 = srcMax - 1;
      if (i0 < 0) i0 = 0;
      var i1 = i0 + 1;
      if (i1 >= srcLen) i1 = 0;
      var f = pos - i0;
      var s = src[i0] * (1 - f) + src[i1] * f;

      var win = hannAt(age / life);
      sum += s * win * gAmp[i];
    }

    // Scale by outer env; soft clip the cloud sum
    return softClip(sum * env * 0.55);
  }

  /**
   * Memory footprint: shared tables + one createState() voice.
   * @returns {{ shared: number, perVoice: number, sourceLen: number, sampleRate: number, totalOneVoice: number }}
   */
  function memBytes() {
    var shared =
      (_source ? _source.byteLength : 0) +
      (_hann ? _hann.byteLength : 0);
    // 5 * Float32(6) + Uint8(6) + scalar overhead ~64
    var perVoice =
      MAX_GRAINS * 4 * 5 + // pos, rate, age, life, amp
      MAX_GRAINS * 1 + // active
      64; // object scalars estimate
    return {
      shared: shared,
      perVoice: perVoice,
      sourceLen: _sourceLen,
      sampleRate: _sr,
      maxGrains: MAX_GRAINS,
      totalOneVoice: shared + perVoice,
    };
  }

  var api = {
    init: init,
    createState: createState,
    trigger: trigger,
    render: render,
    memBytes: memBytes,
    // Expose constants for tests / integration
    MAX_GRAINS: MAX_GRAINS,
    ROOT_HZ: ROOT_HZ,
  };

  global.JqGranular = api;

  // CommonJS optional export when available (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
