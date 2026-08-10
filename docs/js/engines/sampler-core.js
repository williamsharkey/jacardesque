// Jacquardesque multi-sample sampler core — procedural banks, low CPU/memory.
// Plain JS (no ES modules). Attaches globalThis.JqSampler.

(function (global) {
  "use strict";

  var TWO_PI = 6.283185307179586;
  var MAX_FLOAT_BYTES = 150 * 1024; // hard cap ~150KB of float samples

  var BANK_NAMES = ["bass", "keys", "brass", "flute", "pluck", "hit"];
  // Suggested roots: C2, C4, C3, G4, A3, C3
  var ROOT_MIDI = [36, 60, 48, 67, 57, 48];
  // Nominal durations (s); trimmed at init so total stays under MAX_FLOAT_BYTES
  var NOMINAL_DUR = [0.2, 0.25, 0.2, 0.18, 0.12, 0.08];

  /** @type {{ name:string, data:Float32Array, rootMidi:number, loopStart:number, loopEnd:number }[]} */
  var banks = null;
  var sampleRate = 48000;
  var totalMemBytes = 0;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function softClip(x) {
    if (x > 1.5) return 1;
    if (x < -1.5) return -1;
    var s = x * x;
    return x * (27 + s) / (27 + 9 * s);
  }

  // Deterministic hash noise (no Math.random alloc / non-determinism in banks)
  function hashNoise(i) {
    var n = (i * 374761393 + 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n & 0xffff) / 0x8000) - 1;
  }

  function applyEnv(data, attack, decayExp) {
    var n = data.length;
    var aN = Math.max(1, (attack * n) | 0);
    for (let i = 0; i < n; i++) {
      var env;
      if (i < aN) env = i / aN;
      else {
        var u = (i - aN) / (n - aN || 1);
        env = Math.exp(-decayExp * u);
      }
      data[i] *= env;
    }
  }

  function normalizePeak(data, peak) {
    var max = 0;
    for (let i = 0; i < data.length; i++) {
      var a = data[i] < 0 ? -data[i] : data[i];
      if (a > max) max = a;
    }
    if (max < 1e-12) return;
    var g = peak / max;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }

  /** Bandlimited saw via additive partials (odd+even). */
  function genSaw(data, sr, freq, nHarm, bright) {
    var n = data.length;
    for (let i = 0; i < n; i++) {
      var t = i / sr;
      var s = 0;
      var w = TWO_PI * freq * t;
      for (let h = 1; h <= nHarm; h++) {
        var amp = (1 / h) * Math.pow(bright, h - 1);
        s += Math.sin(w * h) * amp;
      }
      data[i] = s;
    }
  }

  /** FM electric-piano-ish: carrier + modulator partials. */
  function genKeys(data, sr, freq) {
    var n = data.length;
    for (let i = 0; i < n; i++) {
      var t = i / sr;
      var mod = Math.sin(TWO_PI * freq * 14 * t) * Math.exp(-t * 12);
      var c1 = Math.sin(TWO_PI * freq * t + mod * 2.2);
      var c2 = Math.sin(TWO_PI * freq * 2 * t + mod) * 0.35 * Math.exp(-t * 6);
      var c3 = Math.sin(TWO_PI * freq * 3 * t) * 0.12 * Math.exp(-t * 10);
      data[i] = c1 + c2 + c3;
    }
  }

  /** Bright saw with simple formant humps (resonant sine mix). */
  function genBrass(data, sr, freq) {
    var n = data.length;
    var form1 = freq * 3.2;
    var form2 = freq * 5.1;
    for (let i = 0; i < n; i++) {
      var t = i / sr;
      var w = TWO_PI * freq * t;
      var s = 0;
      for (let h = 1; h <= 10; h++) s += Math.sin(w * h) / h;
      var f =
        Math.sin(TWO_PI * form1 * t) * 0.22 * Math.exp(-t * 4) +
        Math.sin(TWO_PI * form2 * t) * 0.12 * Math.exp(-t * 7);
      data[i] = s * 0.7 + f;
    }
  }

  /** Sine + breath noise. */
  function genFlute(data, sr, freq) {
    var n = data.length;
    var lp = 0;
    for (let i = 0; i < n; i++) {
      var t = i / sr;
      var tone = Math.sin(TWO_PI * freq * t);
      var h2 = Math.sin(TWO_PI * freq * 2 * t) * 0.08;
      var breath = hashNoise(i + 17) * 0.18;
      lp += (breath - lp) * 0.35;
      // slight vibrato-ish AM on breath layer only
      data[i] = tone * 0.85 + h2 + lp * (0.6 + 0.4 * tone);
    }
  }

  /** Karplus-ish: noise burst through lowpass delay. */
  function genPluck(data, sr, freq) {
    var n = data.length;
    var period = Math.max(2, Math.round(sr / Math.max(freq, 1)));
    var buf = new Float32Array(period);
    for (let i = 0; i < period; i++) buf[i] = hashNoise(i + 99) * 0.95;
    var pos = 0;
    var prev = 0;
    for (let i = 0; i < n; i++) {
      var i1 = (pos + 1) % period;
      var y = (buf[pos] + buf[i1]) * 0.5 * 0.996;
      y = y * 0.85 + prev * 0.15;
      buf[pos] = y;
      prev = y;
      data[i] = y;
      pos = i1;
    }
  }

  /** Noise click + low sine body. */
  function genHit(data, sr, freq) {
    var n = data.length;
    var lp = 0;
    for (let i = 0; i < n; i++) {
      var t = i / sr;
      var click = hashNoise(i + 3) * Math.exp(-t * 180);
      lp += (click - lp) * 0.4;
      var body = Math.sin(TWO_PI * freq * t) * Math.exp(-t * 28);
      data[i] = click * 0.55 + lp * 0.35 + body * 0.7;
    }
  }

  function makeBank(name, idx, sr, nSamples) {
    var data = new Float32Array(nSamples);
    var rootMidi = ROOT_MIDI[idx];
    var freq = midiToFreq(rootMidi);
    var loopStart = -1;
    var loopEnd = -1;

    switch (idx) {
      case 0: // bass — bandlimited saw + decay
        genSaw(data, sr, freq, 12, 0.88);
        applyEnv(data, 0.02, 3.5);
        // loop sustain middle
        loopStart = (nSamples * 0.25) | 0;
        loopEnd = (nSamples * 0.72) | 0;
        break;
      case 1: // keys — FM EP
        genKeys(data, sr, freq);
        applyEnv(data, 0.005, 2.8);
        loopStart = (nSamples * 0.22) | 0;
        loopEnd = (nSamples * 0.7) | 0;
        break;
      case 2: // brass
        genBrass(data, sr, freq);
        applyEnv(data, 0.04, 2.5);
        loopStart = (nSamples * 0.28) | 0;
        loopEnd = (nSamples * 0.75) | 0;
        break;
      case 3: // flute
        genFlute(data, sr, freq);
        applyEnv(data, 0.06, 2.2);
        loopStart = (nSamples * 0.3) | 0;
        loopEnd = (nSamples * 0.78) | 0;
        break;
      case 4: // pluck — short, can loop lightly
        genPluck(data, sr, freq);
        applyEnv(data, 0.002, 4.5);
        loopStart = (nSamples * 0.15) | 0;
        loopEnd = (nSamples * 0.65) | 0;
        break;
      case 5: // hit — no loop
      default:
        genHit(data, sr, freq);
        applyEnv(data, 0.001, 6);
        loopStart = -1;
        loopEnd = -1;
        break;
    }

    // Gentle DC block + peak normalize
    var dc = 0;
    for (let i = 0; i < nSamples; i++) dc += data[i];
    dc /= nSamples || 1;
    for (let i = 0; i < nSamples; i++) data[i] = softClip(data[i] - dc);
    normalizePeak(data, 0.9);

    if (loopStart >= 0 && loopEnd <= loopStart + 4) {
      loopStart = -1;
      loopEnd = -1;
    }

    return {
      name: name,
      data: data,
      rootMidi: rootMidi,
      loopStart: loopStart,
      loopEnd: loopEnd,
    };
  }

  /**
   * Build shared multi-sample banks at the given sample rate.
   * Total float sample storage is capped under ~150KB.
   */
  function init(sr) {
    sampleRate = sr > 0 ? sr : 48000;
    var weights = NOMINAL_DUR.slice();
    var sumW = 0;
    for (let i = 0; i < weights.length; i++) sumW += weights[i];
    var maxSamples = (MAX_FLOAT_BYTES / 4) | 0;
    var lengths = new Array(weights.length);
    var used = 0;
    for (let i = 0; i < weights.length; i++) {
      // leave remainder for last bank
      if (i === weights.length - 1) {
        lengths[i] = Math.max(64, maxSamples - used);
      } else {
        var n = Math.max(64, Math.round((weights[i] / sumW) * maxSamples));
        lengths[i] = n;
        used += n;
      }
    }
    // Safety: re-clamp total
    var total = 0;
    for (let i = 0; i < lengths.length; i++) total += lengths[i];
    if (total > maxSamples) {
      var scale = maxSamples / total;
      total = 0;
      for (let i = 0; i < lengths.length; i++) {
        lengths[i] = Math.max(64, (lengths[i] * scale) | 0);
        total += lengths[i];
      }
      // fix last
      if (total > maxSamples) lengths[lengths.length - 1] -= total - maxSamples;
    }

    banks = [];
    totalMemBytes = 0;
    for (let i = 0; i < BANK_NAMES.length; i++) {
      var b = makeBank(BANK_NAMES[i], i, sampleRate, lengths[i]);
      banks.push(b);
      totalMemBytes += b.data.byteLength;
    }
    return banks;
  }

  function createState() {
    return {
      bank: 0,
      pos: 0,
      rate: 1,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      end: 0,
      // one-pole LPF
      lp: 0,
      lpCoeff: 0.35,
      // optional amp decay while gated
      amp: 1,
      ampDecay: 0,
      _data: null,
    };
  }

  /** Default multi-sample zones by MIDI note. */
  function bankIndexFromMidi(midi) {
    var m = midi | 0;
    if (m < 40) return 0; // bass
    if (m <= 52) return 2; // brass
    if (m <= 64) return 1; // keys
    if (m <= 76) return 3; // flute
    if (m <= 88) return 4; // pluck
    return 5; // hit (else keys-ish / hit)
  }

  /**
   * Force bank from modulatorRatio knob bands:
   * bank = clamp(floor((ratio - 0.25) / 1.3), 0, 5)
   */
  function bankIndexFromRatio(ratio) {
    return clamp(Math.floor((ratio - 0.25) / 1.3), 0, 5) | 0;
  }

  /**
   * Pick bank: MIDI zones by default; modulatorRatio overrides when outside "auto".
   * Auto band: ratio in [0, 0.25) (below first bank band) uses MIDI map.
   * When ratio >= 0.25, always force bank from formula.
   */
  function pickBank(midi, ratio) {
    if (ratio != null && isFinite(ratio) && ratio >= 0.25) {
      return bankIndexFromRatio(ratio);
    }
    return bankIndexFromMidi(midi != null ? midi : 60);
  }

  /**
   * Trigger / re-attack a voice.
   * opts: {
   *   midi, frequency, sampleRate?,
   *   modulatorRatio, modulationIndex, feedback, modulatorDecay,
   *   bank?  // optional explicit 0–5
   * }
   */
  function trigger(state, opts) {
    if (!banks) init(opts && opts.sampleRate ? opts.sampleRate : sampleRate);
    opts = opts || {};

    var midi = opts.midi != null ? opts.midi : 60;
    var ratio = opts.modulatorRatio;
    var idx =
      opts.bank != null && isFinite(opts.bank)
        ? clamp(opts.bank | 0, 0, banks.length - 1)
        : pickBank(midi, ratio);
    var bank = banks[idx];
    var data = bank.data;
    var n = data.length;

    var index = opts.modulationIndex != null ? opts.modulationIndex : 1;
    // start offset 0–0.4 of length from index (typical 0–8 → map softly)
    var startFrac = clamp(index / 10, 0, 0.4);
    var startPos = startFrac * n;

    // brightness → one-pole LPF coefficient (higher = brighter / more open)
    // index high → coeff near 1; low → darker
    var bright = clamp(0.12 + (index / 8) * 0.85, 0.08, 0.98);

    var freq =
      opts.frequency != null && opts.frequency > 0
        ? opts.frequency
        : midiToFreq(midi);
    var rootFreq = midiToFreq(bank.rootMidi);
    var rate = freq / rootFreq;

    var feedback = opts.feedback != null ? opts.feedback : 0;
    var canLoop = bank.loopStart >= 0 && bank.loopEnd > bank.loopStart;
    var loop = canLoop && feedback > 0.5;

    var dec = opts.modulatorDecay != null ? opts.modulatorDecay : 0;
    // extra amp decay while gated (per-sample approx set in render via ampDecay)
    // dec ~0.05–0.5s-ish → convert to per-sample multiply later using sr
    var sr = opts.sampleRate > 0 ? opts.sampleRate : sampleRate;
    var ampDecay = dec > 0 ? Math.exp(-1 / (dec * sr)) : 1;

    state.bank = idx;
    state.pos = startPos;
    state.rate = rate;
    state.loop = loop;
    state.loopStart = bank.loopStart;
    state.loopEnd = bank.loopEnd;
    state.end = n;
    state.lp = 0;
    state.lpCoeff = bright;
    state.amp = 1;
    state.ampDecay = ampDecay;
    state._data = data;
  }

  /**
   * Render one sample. No allocations.
   * Linear interp, optional loop wrap, one-pole LPF, * env.
   */
  function render(state, env) {
    var data = state._data;
    if (!data) return 0;
    var pos = state.pos;
    var end = state.end;
    if (!state.loop && pos >= end) return 0;

    if (state.loop) {
      var ls = state.loopStart;
      var le = state.loopEnd;
      if (le > ls && pos >= le) {
        // wrap into loop region
        var span = le - ls;
        pos = ls + ((pos - ls) % span);
        if (pos < ls) pos = ls;
      }
    } else if (pos >= end) {
      return 0;
    }

    // linear interpolation
    var i0 = pos | 0;
    if (i0 < 0) i0 = 0;
    if (i0 >= end) {
      if (!state.loop) {
        state.pos = pos + state.rate;
        return 0;
      }
      i0 = (state.loopStart | 0);
    }
    var frac = pos - i0;
    var i1 = i0 + 1;
    if (state.loop) {
      var le2 = state.loopEnd | 0;
      var ls2 = state.loopStart | 0;
      if (i0 >= le2) i0 = ls2;
      if (i1 >= le2) i1 = ls2;
      if (i1 >= end) i1 = ls2;
    } else {
      if (i1 >= end) i1 = end - 1;
    }
    if (i0 >= end) i0 = end - 1;
    if (i1 < 0) i1 = 0;

    var s0 = data[i0];
    var s1 = data[i1];
    var s = s0 + (s1 - s0) * frac;

    // advance
    pos += state.rate;
    if (state.loop) {
      var ls3 = state.loopStart;
      var le3 = state.loopEnd;
      if (le3 > ls3 && pos >= le3) {
        pos = ls3 + ((pos - ls3) % (le3 - ls3));
      }
    }
    state.pos = pos;

    // one-pole LPF brightness
    var c = state.lpCoeff;
    state.lp += (s - state.lp) * c;
    s = state.lp;

    // optional amp decay while gated
    if (state.ampDecay > 0 && state.ampDecay < 1) {
      state.amp *= state.ampDecay;
      s *= state.amp;
    }

    var e = env == null ? 1 : env;
    return s * e;
  }

  function memBytes() {
    return totalMemBytes;
  }

  var api = {
    init: init,
    createState: createState,
    trigger: trigger,
    render: render,
    memBytes: memBytes,
    bankNames: BANK_NAMES,
    // helpers exposed for tests / UI
    bankIndexFromMidi: bankIndexFromMidi,
    bankIndexFromRatio: bankIndexFromRatio,
    pickBank: pickBank,
    getBanks: function () {
      return banks;
    },
  };

  global.JqSampler = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
