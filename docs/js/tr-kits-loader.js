// Decode packed TR drum kits (606/707/808/909) for the sample drum machine.
// Samples: free/ISC hyperreal lineage via fluid-music/open-drums (see data/tr-kits.json meta).

import packed from "./data/tr-kits.json" with { type: "json" };

const PAD_IDS = packed.meta?.pads || [
  "kick", "snare", "rim", "clap", "tomL", "tomM", "tomH", "hatC", "hatO", "perc",
];

/** @type {null | Record<string, { sampleRate: number, pads: Record<string, Float32Array> }>} */
let decoded = null;

function b64ToInt16(b64) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
  }
  return out;
}

function int16ToFloat32(i16) {
  const f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
  return f;
}

/** Decode all kits once (lazy). */
export function getTrKits() {
  if (decoded) return decoded;
  decoded = {};
  for (const [id, kit] of Object.entries(packed.kits || {})) {
    const pads = {};
    for (const pid of PAD_IDS) {
      const entry = kit.pads?.[pid];
      if (!entry?.b64) continue;
      pads[pid] = int16ToFloat32(b64ToInt16(entry.b64));
    }
    decoded[id] = { sampleRate: kit.sr || 22050, pads };
  }
  return decoded;
}

export function trKitIds() {
  return Object.keys(packed.kits || {});
}

export function trKitMeta() {
  return packed.meta || {};
}

/**
 * Build a transferable payload for the worklet:
 * { kits: { "808": { sr, pads: { kick: Float32Array, ... } } } }
 * Float32Arrays can be transferred.
 */
export function buildWorkletDrumBankPayload() {
  const kits = getTrKits();
  const out = {};
  const transfer = [];
  for (const [id, kit] of Object.entries(kits)) {
    const pads = {};
    for (const [pid, data] of Object.entries(kit.pads)) {
      // Clone so we keep main-thread copy; transfer the clone
      const copy = new Float32Array(data);
      pads[pid] = copy;
      transfer.push(copy.buffer);
    }
    out[id] = { sampleRate: kit.sampleRate, pads };
  }
  return { kits: out, transfer };
}

export const TR_PAD_IDS = PAD_IDS;
