// Jacquardesque AudioWorklet — sample-accurate FM voice pool, Freeverb, delay.
// Faithful port of Assets/Core/Synth + Assets/Jacquard/Audio.

class FastMath {
  static Pi = 3.14159265;
  static TwoPi = 6.28318531;
  static HalfPi = 1.57079633;
  static Root2 = 1.41421356;

  static floor(x) {
    const i = x | 0;
    return x < 0 && x !== i ? i - 1 : i;
  }

  static frac(x) {
    return x - this.floor(x);
  }

  static sin(x) {
    let turns = x * (1 / this.TwoPi);
    turns -= this.floor(turns + 0.5);
    let r = turns * this.TwoPi;
    if (r > this.HalfPi) r = this.Pi - r;
    else if (r < -this.HalfPi) r = -this.Pi - r;
    const s = r * r;
    return r * (1 + s * (-0.166666667 +
      s * (0.00833333333 +
      s * (-0.000198412698 +
      s * 2.75573192e-6))));
  }

  static cos(x) {
    return this.sin(x + this.HalfPi);
  }

  static exp(x) {
    const t = x * 1.44269504;
    const i = this.floor(t) | 0;
    const f = t - i;
    const p = 1 + f * (0.693147181 +
      f * (0.240226507 +
      f * (0.0555041087 +
      f * (0.00961812911 +
      f * 0.00133335581))));
    return p * this.exp2(i);
  }

  static exp2(exponent) {
    let result = 1;
    if (exponent > 64) return Number.MAX_VALUE;
    if (exponent < -64) return 0;
    while (exponent > 0) {
      result *= 2;
      exponent--;
    }
    while (exponent < 0) {
      result *= 0.5;
      exponent++;
    }
    return result;
  }

  static pow2(x) {
    return this.exp(x * 0.693147181);
  }
}

const FmCurve = {
  Curve: 5,
  Tail: 0.006737947,
  SnapCurve: 16,
  SnapTail: 1.1253517e-7,
  fade(x) {
    return (FastMath.exp(-this.Curve * x) - this.Tail) / (1 - this.Tail);
  },
  snap(x) {
    return (FastMath.exp(-this.SnapCurve * x) - this.SnapTail) / (1 - this.SnapTail);
  },
};

function totalDuration(note) {
  return note.duration + note.carrierRelease;
}

function panGains(note) {
  const position = Math.min(1, Math.max(-1, note.pan));
  const angle = (position + 1) * (FastMath.HalfPi * 0.5);
  return {
    left: FastMath.cos(angle) * FastMath.Root2,
    right: FastMath.sin(angle) * FastMath.Root2,
  };
}

function attackLevel(note, time) {
  return time < note.carrierAttack ? time / note.carrierAttack : 1;
}

function carrierLevel(note, time) {
  if (time < note.duration) return attackLevel(note, time);
  const t = time - note.duration;
  if (t >= note.carrierRelease) return 0;
  return attackLevel(note, note.duration) * FmCurve.fade(t / note.carrierRelease);
}

function modulatorLevel(note, time) {
  return time >= note.modulatorDecay ? 0 : FmCurve.fade(time / note.modulatorDecay);
}

function pitchScale(note, time) {
  return time >= note.pitchDecay
    ? 1
    : FastMath.pow2(note.pitchSweep * FmCurve.snap(time / note.pitchDecay));
}

// Multi-timbre voice: FM lead + procedural kick/snare/hat/bass/pad/bell/pluck.
// Cleaner than the prototype defaults: lower indices, softer clip, gentle tone filter.
class Voice {
  constructor() {
    this.active = false;
    this.note = null;
    this.carrierPhase = 0;
    this.modulatorPhase = 0;
    this.phase2 = 0;
    this.increment = 0;
    this.feedback1 = 0;
    this.feedback2 = 0;
    this.noise = 0;
    this.filter = 0;
    this.seed = 1;
  }

  trigger(note, sampleRate) {
    this.note = note;
    this.active = true;
    this.carrierPhase = 0;
    this.modulatorPhase = 0;
    this.phase2 = 0.37;
    this.feedback1 = 0;
    this.feedback2 = 0;
    this.noise = 0;
    this.filter = 0;
    this.seed = (note.startSample * 1103515245 + 12345) >>> 0 || 1;
    this.increment = note.frequency / sampleRate;
  }

  release() {
    this.active = false;
  }

  endSample(sampleRate) {
    return this.note.startSample + Math.floor(totalDuration(this.note) * sampleRate);
  }

  // xorshift-ish noise in [-1, 1]
  rand() {
    let x = this.seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (x | 0) / 2147483648;
  }

  next(time) {
    const note = this.note;
    const inst = note.instrument | 0;
    const env = carrierLevel(note, time);
    if (env <= 0) return 0;

    let sample = 0;
    switch (inst) {
      case 1: sample = this.renderKick(note, time, env); break;
      case 2: sample = this.renderSnare(note, time, env); break;
      case 3: sample = this.renderHat(note, time, env); break;
      case 4: sample = this.renderBass(note, time, env); break;
      case 5: sample = this.renderPad(note, time, env); break;
      case 6: sample = this.renderBell(note, time, env); break;
      case 7: sample = this.renderPluck(note, time, env); break;
      default: sample = this.renderFm(note, time, env); break;
    }

    // Soft one-pole tone control — tames digital grit without dulling the note.
    const cutoff = inst === 3 ? 0.55 : inst === 5 ? 0.12 : 0.28;
    this.filter += (sample - this.filter) * cutoff;
    return this.filter * note.level;
  }

  renderFm(note, time, env) {
    const scale = pitchScale(note, time);
    const increment = this.increment * scale;
    const twoPi = FastMath.TwoPi;
    // Cap modulation so dense chords don't brick-wall.
    const fb = Math.min(note.feedback, 2.5);
    const mod = FastMath.sin(
      twoPi * this.modulatorPhase + fb * (this.feedback1 + this.feedback2) * 0.5,
    );
    this.feedback2 = this.feedback1;
    this.feedback1 = mod;
    const index = Math.min(note.modulationIndex, 6) * modulatorLevel(note, time);
    const out = FastMath.sin(twoPi * this.carrierPhase + mod * index) * env;
    this.carrierPhase = FastMath.frac(this.carrierPhase + increment);
    this.modulatorPhase = FastMath.frac(this.modulatorPhase + increment * note.modulatorRatio);
    return out * 0.85;
  }

  renderKick(note, time, env) {
    const scale = pitchScale(note, time);
    // Body: sine with pitch sweep. Click: short noise burst.
    const body = FastMath.sin(FastMath.TwoPi * this.carrierPhase) * env;
    this.carrierPhase = FastMath.frac(this.carrierPhase + this.increment * scale);
    const click = time < 0.004 ? this.rand() * (1 - time / 0.004) * 0.35 : 0;
    return body * 1.1 + click;
  }

  renderSnare(note, time, env) {
    const scale = pitchScale(note, time);
    const body = FastMath.sin(FastMath.TwoPi * this.carrierPhase) * env * 0.35;
    this.carrierPhase = FastMath.frac(this.carrierPhase + this.increment * scale * 1.6);
    const noiseEnv = env * Math.exp(-time * 18);
    const noise = this.rand() * noiseEnv;
    return body + noise * 0.7;
  }

  renderHat(note, time, env) {
    // Band-passed noise via crude highpass of white noise.
    const n = this.rand();
    const hp = n - this.noise;
    this.noise = n;
    const decay = Math.exp(-time * (28 + note.modulatorDecay * 40));
    return hp * env * decay * 0.55;
  }

  renderBass(note, time, env) {
    // Soft FM, mild overdrive via soft cubic.
    const raw = this.renderFm(note, time, env);
    const x = raw * 1.4;
    return x - (x * x * x) / 3;
  }

  renderPad(note, time, env) {
    // Detuned dual sine + quiet mod for warmth.
    const scale = pitchScale(note, time);
    const inc = this.increment * scale;
    const twoPi = FastMath.TwoPi;
    const a = FastMath.sin(twoPi * this.carrierPhase);
    const b = FastMath.sin(twoPi * this.phase2);
    this.carrierPhase = FastMath.frac(this.carrierPhase + inc);
    this.phase2 = FastMath.frac(this.phase2 + inc * 1.0035);
    const mod = FastMath.sin(twoPi * this.modulatorPhase) * Math.min(note.modulationIndex, 2) * 0.15;
    this.modulatorPhase = FastMath.frac(this.modulatorPhase + inc * (note.modulatorRatio || 2));
    return (a + b) * 0.45 * env * (1 + mod);
  }

  renderBell(note, time, env) {
    // Inharmonic partials: 1 : 2.76 : 5.4-ish.
    const scale = pitchScale(note, time);
    const inc = this.increment * scale;
    const twoPi = FastMath.TwoPi;
    const a = FastMath.sin(twoPi * this.carrierPhase);
    const b = FastMath.sin(twoPi * this.modulatorPhase) * 0.45 * modulatorLevel(note, time);
    const c = FastMath.sin(twoPi * this.phase2) * 0.2 * env;
    this.carrierPhase = FastMath.frac(this.carrierPhase + inc);
    this.modulatorPhase = FastMath.frac(this.modulatorPhase + inc * 2.76);
    this.phase2 = FastMath.frac(this.phase2 + inc * 5.4);
    return (a + b + c) * env * 0.7;
  }

  renderPluck(note, time, env) {
    // Bright FM that collapses quickly to sine — guitar-ish attack.
    const bright = Math.exp(-time * 14);
    const scale = pitchScale(note, time);
    const increment = this.increment * scale;
    const twoPi = FastMath.TwoPi;
    const mod = FastMath.sin(twoPi * this.modulatorPhase) * note.modulationIndex * bright;
    const out = FastMath.sin(twoPi * this.carrierPhase + mod) * env;
    this.carrierPhase = FastMath.frac(this.carrierPhase + increment);
    this.modulatorPhase = FastMath.frac(this.modulatorPhase + increment * note.modulatorRatio);
    return out * 0.9;
  }
}

class VoicePool {
  constructor(maxVoices) {
    this.voices = Array.from({ length: maxVoices }, () => new Voice());
    this.queue = [];
    this.dropped = 0;
    this.stolen = 0;
    this.cancelled = 0;
  }

  activeCount() {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  enqueue(note) {
    if (this.queue.length >= 256) {
      this.dropped++;
      return;
    }
    this.queue.push(note);
  }

  // channelMono: optional array of 8 mono bus Float32Arrays for path-sends.
  render(dryL, dryR, reverbIn, delayIn, frameCount, bufferStart, sampleRate, channelMono) {
    const bufferEnd = bufferStart + frameCount;
    while (true) {
      let next = -1;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].startSample >= bufferEnd) continue;
        if (next < 0 || this.queue[i].startSample < this.queue[next].startSample) next = i;
      }
      if (next < 0) break;
      this.trigger(this.queue[next], sampleRate);
      this.queue[next] = this.queue[this.queue.length - 1];
      this.queue.pop();
    }

    const dt = 1 / sampleRate;
    for (const voice of this.voices) {
      if (!voice.active) continue;
      const note = voice.note;
      const total = totalDuration(note);
      const gains = panGains(note);
      const ch = Math.min(8, Math.max(1, note.channel | 1)) - 1;
      for (let frame = 0; frame < frameCount; frame++) {
        const time = (bufferStart + frame - note.startSample) * dt;
        if (time < 0) continue;
        if (time >= total) {
          voice.release();
          break;
        }
        const sample = voice.next(time);
        dryL[frame] += sample * gains.left;
        dryR[frame] += sample * gains.right;
        reverbIn[frame] += sample * note.reverbSend;
        delayIn[frame] += sample * note.delaySend;
        if (channelMono && channelMono[ch]) channelMono[ch][frame] += sample;
      }
    }
  }

  trigger(note, sampleRate) {
    let target = -1;
    for (let i = 0; i < this.voices.length; i++) {
      if (!this.voices[i].active) {
        target = i;
        break;
      }
    }
    if (target < 0) {
      let lowest = Infinity;
      let earliestEnd = Infinity;
      for (let i = 0; i < this.voices.length; i++) {
        const priority = this.voices[i].note.priority;
        const end = this.voices[i].endSample(sampleRate);
        if (priority > lowest) continue;
        if (priority === lowest && end >= earliestEnd) continue;
        target = i;
        lowest = priority;
        earliestEnd = end;
      }
      if (note.priority < lowest) {
        this.cancelled++;
        return;
      }
      this.stolen++;
    }
    this.voices[target].trigger(note, sampleRate);
  }
}

class ReverbBus {
  static CombCount = 8;
  static AllpassCount = 4;
  static CombTuning = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  static AllpassTuning = [556, 441, 341, 225];
  static StereoSpread = 23;
  static ReferenceRate = 44100;
  static MinFeedback = 0.7;
  static FeedbackSpan = 0.28;
  static DampSpan = 0.4;
  static AllpassFeedback = 0.5;
  static InputGain = 0.015;
  static OutputGain = 3;
  static SmoothingSeconds = 0.03;

  constructor(sampleRate) {
    this.perChannel = ReverbBus.CombCount + ReverbBus.AllpassCount;
    this.lineCount = this.perChannel * 2;
    this.starts = new Int32Array(this.lineCount + 1);
    this.cursors = new Int32Array(this.lineCount);
    this.stores = new Float32Array(ReverbBus.CombCount * 2);
    this.smooth = new Float32Array(3);
    this.smooth[0] = -1;
    let total = 0;
    for (let line = 0; line < this.lineCount; line++) {
      this.starts[line] = total;
      total += this.length(line, sampleRate);
    }
    this.starts[this.lineCount] = total;
    this.lines = new Float32Array(total);
  }

  length(line, sampleRate) {
    const channel = Math.floor(line / this.perChannel);
    const index = line % this.perChannel;
    const tuning = index < ReverbBus.CombCount
      ? ReverbBus.CombTuning[index]
      : ReverbBus.AllpassTuning[index - ReverbBus.CombCount];
    const scaled = Math.floor(tuning * sampleRate / ReverbBus.ReferenceRate) +
      channel * ReverbBus.StereoSpread;
    return Math.max(scaled, 1);
  }

  process(input, wetL, wetR, frameCount, sampleRate, size, damp, width) {
    this.approach(size, damp, width, frameCount / sampleRate);
    const feedback = ReverbBus.MinFeedback + ReverbBus.FeedbackSpan * clamp01(this.smooth[0]);
    const damping = ReverbBus.DampSpan * clamp01(this.smooth[1]);
    const spread = clamp01(this.smooth[2]);
    const direct = ReverbBus.OutputGain * (spread * 0.5 + 0.5);
    const crossed = ReverbBus.OutputGain * (1 - spread) * 0.5;

    for (let frame = 0; frame < frameCount; frame++) {
      const x = input[frame] * ReverbBus.InputGain;
      let left = 0;
      let right = 0;
      for (let i = 0; i < ReverbBus.CombCount; i++) {
        left += this.comb(i, x, feedback, damping);
        right += this.comb(this.perChannel + i, x, feedback, damping);
      }
      for (let i = 0; i < ReverbBus.AllpassCount; i++) {
        left = this.allpass(ReverbBus.CombCount + i, left);
        right = this.allpass(this.perChannel + ReverbBus.CombCount + i, right);
      }
      wetL[frame] += left * direct + right * crossed;
      wetR[frame] += right * direct + left * crossed;
    }
  }

  approach(size, damp, width, blockSeconds) {
    if (this.smooth[0] < 0) {
      this.smooth[0] = size;
      this.smooth[1] = damp;
      this.smooth[2] = width;
      return;
    }
    const rate = 1 - Math.exp(-blockSeconds / ReverbBus.SmoothingSeconds);
    this.smooth[0] += (size - this.smooth[0]) * rate;
    this.smooth[1] += (damp - this.smooth[1]) * rate;
    this.smooth[2] += (width - this.smooth[2]) * rate;
  }

  comb(line, input, feedback, damping) {
    const index = this.starts[line] + this.cursors[line];
    const output = this.lines[index];
    const storeIndex = Math.floor(line / this.perChannel) * ReverbBus.CombCount +
      (line % this.perChannel);
    const store = output * (1 - damping) + this.stores[storeIndex] * damping;
    this.stores[storeIndex] = store;
    this.lines[index] = input + store * feedback;
    this.advance(line);
    return output;
  }

  allpass(line, input) {
    const index = this.starts[line] + this.cursors[line];
    const buffered = this.lines[index];
    this.lines[index] = input + buffered * ReverbBus.AllpassFeedback;
    this.advance(line);
    return buffered - input;
  }

  advance(line) {
    let cursor = this.cursors[line] + 1;
    const len = this.starts[line + 1] - this.starts[line];
    this.cursors[line] = cursor >= len ? 0 : cursor;
  }
}

class DelayBus {
  static MaxTapRate = 0.25;
  static MinTap = 2;
  static MaxFeedback = 0.95;
  static LongestSeconds = 3;

  constructor(sampleRate) {
    this.capacity = Math.floor(DelayBus.LongestSeconds * sampleRate) + 4;
    this.lines = new Float32Array(this.capacity * 2);
    this.write = 0;
    this.tap = 0;
    this.lowpassL = 0;
    this.lowpassR = 0;
  }

  process(input, wetL, wetR, frameCount, tapSamples, feedback, tone, spread) {
    const target = Math.min(this.capacity - DelayBus.MinTap,
      Math.max(DelayBus.MinTap, tapSamples));
    if (this.tap <= 0) this.tap = target;
    feedback = Math.min(DelayBus.MaxFeedback, Math.max(0, feedback));
    spread = clamp01(spread);
    const bright = 1 - clamp01(tone);
    const cutoff = bright * bright * 0.98 + 0.02;
    let write = this.write;
    let tap = this.tap;

    for (let frame = 0; frame < frameCount; frame++) {
      const delta = Math.min(DelayBus.MaxTapRate, Math.max(-DelayBus.MaxTapRate, target - tap));
      tap += delta;
      let read = write - tap;
      if (read < 0) read += this.capacity;
      const left = this.read(0, read);
      const right = this.read(this.capacity, read);
      wetL[frame] += left;
      wetR[frame] += right;
      this.lowpassL += (left - this.lowpassL) * cutoff;
      this.lowpassR += (right - this.lowpassR) * cutoff;
      const backL = this.lowpassL * feedback;
      const backR = this.lowpassR * feedback;
      const dry = input[frame];
      this.lines[write] = dry + backL * (1 - spread) + backR * spread;
      this.lines[this.capacity + write] =
        dry * (1 - spread) + backR * (1 - spread) + backL * spread;
      write++;
      if (write >= this.capacity) write = 0;
    }
    this.write = write;
    this.tap = tap;
  }

  read(origin, position) {
    const index = position | 0;
    const frac = position - index;
    let next = index + 1;
    if (next >= this.capacity) next -= this.capacity;
    return this.lines[origin + index] * (1 - frac) + this.lines[origin + next] * frac;
  }
}

// Gentle soft-knee clip — only engages near the rails, so normal mix stays clean.
function softClip(x) {
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  // Smooth into ±1 without the harsh Pade that made dense chords crunchy.
  const t = (a - 0.7) / 0.3;
  const y = 0.7 + 0.3 * (t / (1 + t));
  return x < 0 ? -y : y;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---------------------------------------------------------------------------
// Grid FX modules — each pedal is a lightweight stereo processor
// ---------------------------------------------------------------------------

class ModDelay {
  constructor(sampleRate) {
    this.cap = Math.floor(sampleRate * 2) + 4;
    this.bufL = new Float32Array(this.cap);
    this.bufR = new Float32Array(this.cap);
    this.w = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  process(inL, inR, outL, outR, n, params, sampleRate) {
    const mix = clamp01(params.mix ?? 0.35);
    const time = Math.min(1.8, Math.max(0.02, params.time ?? 0.35));
    const fb = Math.min(0.92, Math.max(0, params.feedback ?? 0.35));
    const tone = clamp01(params.tone ?? 0.4);
    const tap = Math.min(this.cap - 2, Math.max(2, time * sampleRate));
    const cut = (1 - tone) * (1 - tone) * 0.95 + 0.05;
    let w = this.w;
    for (let i = 0; i < n; i++) {
      let r = w - tap;
      if (r < 0) r += this.cap;
      const ri = r | 0;
      const f = r - ri;
      const n1 = ri + 1 >= this.cap ? 0 : ri + 1;
      const dl = this.bufL[ri] * (1 - f) + this.bufL[n1] * f;
      const dr = this.bufR[ri] * (1 - f) + this.bufR[n1] * f;
      this.lpL += (dl - this.lpL) * cut;
      this.lpR += (dr - this.lpR) * cut;
      outL[i] += this.lpL * mix;
      outR[i] += this.lpR * mix;
      this.bufL[w] = inL[i] + this.lpL * fb;
      this.bufR[w] = inR[i] + this.lpR * fb;
      w++;
      if (w >= this.cap) w = 0;
    }
    this.w = w;
  }
}

class ModDistort {
  process(inL, inR, outL, outR, n, params) {
    const mix = clamp01(params.mix ?? 0.4);
    const drive = 1 + clamp01(params.drive ?? 0.45) * 8;
    for (let i = 0; i < n; i++) {
      const wl = Math.tanh(inL[i] * drive);
      const wr = Math.tanh(inR[i] * drive);
      outL[i] += (inL[i] * (1 - mix) + wl * mix);
      outR[i] += (inR[i] * (1 - mix) + wr * mix);
    }
  }
}

class ModFilter {
  constructor() {
    this.zL = 0;
    this.zR = 0;
  }

  process(inL, inR, outL, outR, n, params) {
    const mix = clamp01(params.mix ?? 1);
    const cut = 0.02 + clamp01(params.cutoff ?? 0.55) * 0.7;
    const res = clamp01(params.reso ?? 0.2) * 0.9;
    for (let i = 0; i < n; i++) {
      this.zL += (inL[i] - this.zL - this.zL * res * 0.3) * cut;
      this.zR += (inR[i] - this.zR - this.zR * res * 0.3) * cut;
      outL[i] += inL[i] * (1 - mix) + this.zL * mix;
      outR[i] += inR[i] * (1 - mix) + this.zR * mix;
    }
  }
}

class ModPan {
  process(inL, inR, outL, outR, n, params) {
    const pan = Math.min(1, Math.max(-1, params.pan ?? 0));
    const width = clamp01(params.width ?? 0.5);
    const angle = (pan + 1) * (FastMath.HalfPi * 0.5);
    const gl = FastMath.cos(angle) * 1.414;
    const gr = FastMath.sin(angle) * 1.414;
    for (let i = 0; i < n; i++) {
      const mid = (inL[i] + inR[i]) * 0.5;
      const side = (inL[i] - inR[i]) * 0.5 * width;
      const l = mid + side;
      const r = mid - side;
      outL[i] += l * gl;
      outR[i] += r * gr;
    }
  }
}

class FxModuleRuntime {
  constructor(id, type, sampleRate) {
    this.id = id;
    this.type = type;
    this.params = {};
    this.inL = null;
    this.inR = null;
    this.outL = null;
    this.outR = null;
    if (type === "delay") this.engine = new ModDelay(sampleRate);
    else if (type === "reverb") this.engine = new ReverbBus(sampleRate);
    else if (type === "distort") this.engine = new ModDistort();
    else if (type === "filter") this.engine = new ModFilter();
    else if (type === "pan") this.engine = new ModPan();
    else if (type === "pat+" || type === "pat-" || type === "patgo") this.engine = null; // control only
    else this.engine = new ModDelay(sampleRate);
  }

  ensure(n) {
    if (!this.inL || this.inL.length < n) {
      this.inL = new Float32Array(n);
      this.inR = new Float32Array(n);
      this.outL = new Float32Array(n);
      this.outR = new Float32Array(n);
    } else {
      this.inL.fill(0, 0, n);
      this.inR.fill(0, 0, n);
      this.outL.fill(0, 0, n);
      this.outR.fill(0, 0, n);
    }
  }

  process(n, sampleRate) {
    if (!this.engine) return; // pattern control modules are silent
    const p = this.params;
    // Grid pedals are path-sends / chains: dry already lives on the main bus.
    // Output wet only (mix scales wet level) so we never double dry.
    if (this.type === "delay") {
      this.engine.process(this.inL, this.inR, this.outL, this.outR, n, p, sampleRate);
    } else if (this.type === "reverb") {
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) mono[i] = (this.inL[i] + this.inR[i]) * 0.5;
      const wetL = new Float32Array(n);
      const wetR = new Float32Array(n);
      this.engine.process(mono, wetL, wetR, n, sampleRate, p.size ?? 0.5, p.damp ?? 0.4, 1);
      const mix = clamp01(p.mix ?? 0.3);
      for (let i = 0; i < n; i++) {
        this.outL[i] = wetL[i] * mix;
        this.outR[i] = wetR[i] * mix;
      }
    } else if (this.type === "distort" || this.type === "filter" || this.type === "pan") {
      // These engines mix dry+wet internally; strip dry so only wet delta remains
      // would need engine changes. Instead: process into temps then wet = out - dry*(1-mix)...
      // Simpler: treat mix as wet amount and zero dry contribution by processing full wet.
      this.engine.process(this.inL, this.inR, this.outL, this.outR, n, p);
      // Engine already wrote dry*(1-mix)+wet*mix. Convert to wet-only path return:
      // out = dry*(1-mix)+wet*mix  →  we want wet*mix ≈ out - dry*(1-mix)
      const mix = clamp01(
        this.type === "pan" ? 1 : (p.mix ?? (this.type === "filter" ? 1 : 0.4)),
      );
      if (this.type !== "pan" && mix < 1) {
        const dryKeep = 1 - mix;
        for (let i = 0; i < n; i++) {
          this.outL[i] -= this.inL[i] * dryKeep;
          this.outR[i] -= this.inR[i] * dryKeep;
        }
      }
    } else {
      this.engine.process(this.inL, this.inR, this.outL, this.outR, n, p);
    }
  }
}

class GridFxGraph {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.modules = new Map(); // id -> FxModuleRuntime
    this.order = []; // module ids in insert order
    this.insertMode = true;
    this.enabled = false;
    this._workL = null;
    this._workR = null;
    this._tmpL = null;
    this._tmpR = null;
  }

  setGraph(msg) {
    if (!msg || !msg.modules) {
      this.enabled = false;
      this.order = [];
      return;
    }
    const audioMods = (msg.modules || []).filter(
      (m) => m.type !== "pat+" && m.type !== "pat-" && m.type !== "patgo",
    );
    this.enabled = audioMods.length > 0;
    this.insertMode = msg.insertMode !== false;
    this.order = [];
    const seen = new Set();
    for (const m of audioMods) {
      seen.add(m.id);
      this.order.push(m.id);
      let rt = this.modules.get(m.id);
      if (!rt || rt.type !== m.type) {
        rt = new FxModuleRuntime(m.id, m.type, this.sampleRate);
        this.modules.set(m.id, rt);
      }
      rt.params = m.params || {};
      rt.targetOn = !!m.on;
      if (rt.mixGain == null) rt.mixGain = rt.targetOn ? 1 : 0;
    }
    for (const id of [...this.modules.keys()]) {
      if (!seen.has(id)) this.modules.delete(id);
    }
  }

  _ensureWork(n) {
    if (!this._workL || this._workL.length < n) {
      this._workL = new Float32Array(n);
      this._workR = new Float32Array(n);
      this._tmpL = new Float32Array(n);
      this._tmpR = new Float32Array(n);
    }
  }

  /**
   * Insert mode: serial process dryL/R through ON pedals (mix→0 when off).
   * ~10-sample linear ramp on engage/bypass to avoid clicks.
   * Result written back into dryL/R; wet left unused for grid inserts.
   *
   * Critical: fully-bypassed pedals must not touch the chain (and must never
   * blend with non-finite wet — `NaN * 0` is NaN and silences the master).
   */
  process(channelMono, dryL, dryR, wetL, wetR, n) {
    if (!this.enabled) return;
    if (!this.insertMode) return;

    this._ensureWork(n);
    const workL = this._workL;
    const workR = this._workR;
    const tmpL = this._tmpL;
    const tmpR = this._tmpR;
    for (let i = 0; i < n; i++) {
      workL[i] = dryL[i];
      workR[i] = dryR[i];
    }

    const RAMP = 10; // samples
    for (const id of this.order) {
      const rt = this.modules.get(id);
      if (!rt || !rt.engine) continue;

      const want = rt.targetOn ? 1 : 0;
      let g = Number.isFinite(rt.mixGain) ? rt.mixGain : 0;
      // Fully bypassed: leave the dry chain untouched (no NaN wet bleed).
      if (want === 0 && g < 1e-4) {
        rt.mixGain = 0;
        continue;
      }

      rt.ensure(n);
      const step = (want - g) / RAMP;

      for (let i = 0; i < n; i++) {
        rt.inL[i] = workL[i];
        rt.inR[i] = workR[i];
      }
      rt.outL.fill(0, 0, n);
      rt.outR.fill(0, 0, n);

      // Process as full wet; we blend with user mix * engage ramp below.
      const savedMix = Number.isFinite(rt.params?.mix) ? rt.params.mix : 0.35;
      const prevParams = rt.params;
      rt.params = { ...prevParams, mix: 1 };
      this._processInsertWet(rt, n);
      rt.params = prevParams;

      const userMix = clamp01(savedMix);
      for (let i = 0; i < n; i++) {
        if (Math.abs(want - g) > 1e-6) {
          g += step;
          if ((step > 0 && g > want) || (step < 0 && g < want)) g = want;
        }
        const m = clamp01(g * userMix);
        const dry = workL[i];
        const dryR0 = workR[i];
        if (m <= 1e-6) {
          tmpL[i] = dry;
          tmpR[i] = dryR0;
          continue;
        }
        // Finite-safe wet (NaN * m would silence the whole bus)
        let wl = rt.outL[i];
        let wr = rt.outR[i];
        if (!Number.isFinite(wl)) wl = 0;
        if (!Number.isFinite(wr)) wr = 0;
        tmpL[i] = dry * (1 - m) + wl * m;
        tmpR[i] = dryR0 * (1 - m) + wr * m;
      }
      rt.mixGain = g < 1e-4 && want === 0 ? 0 : g;
      for (let i = 0; i < n; i++) {
        workL[i] = Number.isFinite(tmpL[i]) ? tmpL[i] : 0;
        workR[i] = Number.isFinite(tmpR[i]) ? tmpR[i] : 0;
      }
    }

    for (let i = 0; i < n; i++) {
      dryL[i] = workL[i];
      dryR[i] = workR[i];
    }
  }

  _processInsertWet(rt, n) {
    const p = rt.params || {};
    try {
      if (rt.type === "delay") {
        rt.engine.process(rt.inL, rt.inR, rt.outL, rt.outR, n, p, this.sampleRate);
      } else if (rt.type === "reverb") {
        const mono = new Float32Array(n);
        for (let i = 0; i < n; i++) mono[i] = (rt.inL[i] + rt.inR[i]) * 0.5;
        const wetL = new Float32Array(n);
        const wetR = new Float32Array(n);
        rt.engine.process(
          mono, wetL, wetR, n, this.sampleRate,
          p.size ?? 0.5, p.damp ?? 0.4, 1,
        );
        for (let i = 0; i < n; i++) {
          rt.outL[i] = wetL[i];
          rt.outR[i] = wetR[i];
        }
      } else if (rt.type === "distort" || rt.type === "filter") {
        // Full wet path (mix=1)
        rt.engine.process(rt.inL, rt.inR, rt.outL, rt.outR, n, { ...p, mix: 1 });
      } else if (rt.type === "pan") {
        rt.engine.process(rt.inL, rt.inR, rt.outL, rt.outR, n, p);
      } else if (rt.engine?.process) {
        rt.engine.process(rt.inL, rt.inR, rt.outL, rt.outR, n, p, this.sampleRate);
      }
    } catch (_) {
      // Leave outs at 0 on DSP failure — dry chain still passes via blend.
      rt.outL.fill(0, 0, n);
      rt.outR.fill(0, 0, n);
    }
  }
}

class JacquardProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const maxVoices = options.processorOptions?.maxVoices ?? 24;
    this.sampleRate = sampleRate;
    this.pool = new VoicePool(maxVoices);
    this.reverb = new ReverbBus(sampleRate);
    this.delay = new DelayBus(sampleRate);
    this.gridFx = new GridFxGraph(sampleRate);
    this.dspSample = 0;
    // Headroom: dense chords + sends used to slam the soft clip ("rinky dink").
    this.masterGain = 0.42;
    this.fx = {
      reverbSize: 0.5,
      reverbDamp: 0.5,
      reverbWidth: 1,
      delaySamples: sampleRate * 0.5 * 60 / 132,
      delayFeedback: 0.35,
      delayTone: 0.4,
      delaySpread: 0,
    };
    this._reportCounter = 0;
    this._bufSize = 0;
    this._dryL = null;
    this._dryR = null;
    this._reverbIn = null;
    this._delayIn = null;
    this._wetL = null;
    this._wetR = null;
    this._chMono = null;
    this.port.onmessage = (e) => this.onMessage(e.data);
    // First status immediately so the main thread can anchor its clock.
    this.port.postMessage({
      type: "status",
      dspSample: 0,
      activeVoices: 0,
      queuedNotes: 0,
      droppedNotes: 0,
      stolenNotes: 0,
      cancelledNotes: 0,
    });
  }

  ensureBuffers(frameCount) {
    if (this._bufSize >= frameCount) return;
    this._bufSize = frameCount;
    this._dryL = new Float32Array(frameCount);
    this._dryR = new Float32Array(frameCount);
    this._reverbIn = new Float32Array(frameCount);
    this._delayIn = new Float32Array(frameCount);
    this._wetL = new Float32Array(frameCount);
    this._wetR = new Float32Array(frameCount);
    this._chMono = Array.from({ length: 8 }, () => new Float32Array(frameCount));
  }

  onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "note") {
      this.pool.enqueue(msg.note);
    } else if (msg.type === "notes") {
      for (const note of msg.notes) this.pool.enqueue(note);
    } else if (msg.type === "fx") {
      this.fx = msg.fx;
    } else if (msg.type === "fxgraph") {
      this.gridFx.setGraph(msg.graph);
    } else if (msg.type === "gain") {
      this.masterGain = msg.gain;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const outL = output[0];
    const outR = output[1] || output[0];
    const frameCount = outL.length;

    this.ensureBuffers(frameCount);
    const dryL = this._dryL;
    const dryR = this._dryR;
    const reverbIn = this._reverbIn;
    const delayIn = this._delayIn;
    const wetL = this._wetL;
    const wetR = this._wetR;
    dryL.fill(0, 0, frameCount);
    dryR.fill(0, 0, frameCount);
    reverbIn.fill(0, 0, frameCount);
    delayIn.fill(0, 0, frameCount);
    wetL.fill(0, 0, frameCount);
    wetR.fill(0, 0, frameCount);
    for (const ch of this._chMono) ch.fill(0, 0, frameCount);

    const bufferStart = this.dspSample;
    this.pool.render(
      dryL, dryR, reverbIn, delayIn, frameCount, bufferStart, this.sampleRate, this._chMono,
    );

    // Grid FX pedals (path-windowed) take priority when present.
    if (this.gridFx.enabled) {
      this.gridFx.process(this._chMono, dryL, dryR, wetL, wetR, frameCount);
    } else {
      // Legacy global send buses (scores with no grid pedals).
      this.delay.process(
        delayIn, wetL, wetR, frameCount,
        this.fx.delaySamples, this.fx.delayFeedback, this.fx.delayTone, this.fx.delaySpread,
      );
      this.reverb.process(
        reverbIn, wetL, wetR, frameCount, this.sampleRate,
        this.fx.reverbSize, this.fx.reverbDamp, this.fx.reverbWidth,
      );
    }

    for (let i = 0; i < frameCount; i++) {
      outL[i] = softClip((dryL[i] + wetL[i]) * this.masterGain);
      outR[i] = softClip((dryR[i] + wetR[i]) * this.masterGain);
    }

    this.dspSample += frameCount;
    this._reportCounter += frameCount;
    // ~60 Hz status so transport/playheads stay tight.
    if (this._reportCounter >= (this.sampleRate / 60) | 0) {
      this._reportCounter = 0;
      this.port.postMessage({
        type: "status",
        dspSample: this.dspSample,
        activeVoices: this.pool.activeCount(),
        queuedNotes: this.pool.queue.length,
        droppedNotes: this.pool.dropped,
        stolenNotes: this.pool.stolen,
        cancelledNotes: this.pool.cancelled,
      });
    }

    return true;
  }
}

registerProcessor("jacquard-processor", JacquardProcessor);
