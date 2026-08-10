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

class Voice {
  constructor() {
    this.active = false;
    this.note = null;
    this.carrierPhase = 0;
    this.modulatorPhase = 0;
    this.increment = 0;
    this.feedback1 = 0;
    this.feedback2 = 0;
  }

  trigger(note, sampleRate) {
    this.note = note;
    this.active = true;
    this.carrierPhase = 0;
    this.modulatorPhase = 0;
    this.feedback1 = 0;
    this.feedback2 = 0;
    this.increment = note.frequency / sampleRate;
  }

  release() {
    this.active = false;
  }

  endSample(sampleRate) {
    return this.note.startSample + Math.floor(totalDuration(this.note) * sampleRate);
  }

  next(time) {
    const note = this.note;
    const increment = this.increment * pitchScale(note, time);
    const twoPi = FastMath.TwoPi;
    const mod = FastMath.sin(
      twoPi * this.modulatorPhase + note.feedback * (this.feedback1 + this.feedback2) * 0.5,
    );
    this.feedback2 = this.feedback1;
    this.feedback1 = mod;
    const index = note.modulationIndex * modulatorLevel(note, time);
    const amplitude = note.level * carrierLevel(note, time);
    const output = FastMath.sin(twoPi * this.carrierPhase + mod * index) * amplitude;
    this.carrierPhase = FastMath.frac(this.carrierPhase + increment);
    this.modulatorPhase = FastMath.frac(this.modulatorPhase + increment * note.modulatorRatio);
    return output;
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

  render(dryL, dryR, reverbIn, delayIn, frameCount, bufferStart, sampleRate) {
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

function softClip(x) {
  const s = Math.min(x * x, 9);
  return Math.min(1, Math.max(-1, x * (27 + s) / (27 + 9 * s)));
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

class JacquardProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const maxVoices = options.processorOptions?.maxVoices ?? 24;
    this.sampleRate = sampleRate;
    this.pool = new VoicePool(maxVoices);
    this.reverb = new ReverbBus(sampleRate);
    this.delay = new DelayBus(sampleRate);
    this.dspSample = 0;
    this.masterGain = 0.85;
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
  }

  onMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "note") {
      this.pool.enqueue(msg.note);
    } else if (msg.type === "notes") {
      for (const note of msg.notes) this.pool.enqueue(note);
    } else if (msg.type === "fx") {
      this.fx = msg.fx;
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

    const bufferStart = this.dspSample;
    this.pool.render(dryL, dryR, reverbIn, delayIn, frameCount, bufferStart, this.sampleRate);
    this.delay.process(
      delayIn, wetL, wetR, frameCount,
      this.fx.delaySamples, this.fx.delayFeedback, this.fx.delayTone, this.fx.delaySpread,
    );
    this.reverb.process(
      reverbIn, wetL, wetR, frameCount, this.sampleRate,
      this.fx.reverbSize, this.fx.reverbDamp, this.fx.reverbWidth,
    );

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
