import fs from 'fs';

/** Minimal 16-bit PCM WAV reader (mono). */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12, dataOff = -1, dataLen = 0, sampleRate = 0;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  const n = Math.floor(dataLen / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { samples: out, sampleRate };
}

const peakOf = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Peak envelope bucketed to `bins` points. */
function envelope(samples, bins) {
  const out = new Array(bins).fill(0);
  const per = samples.length / bins;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * per), end = Math.min(samples.length, Math.floor((b + 1) * per));
    let m = 0;
    for (let i = start; i < end; i++) { const a = Math.abs(samples[i]); if (a > m) m = a; }
    out[b] = m;
  }
  return out;
}

const BINS = 420;
const TARGET_PEAK = Math.pow(10, -3 / 20); // -3 dBFS, per audio-dsp-pipeline.js

const files = {
  s0_raw:       'data/before.wav',
  s1_highpass:  'data/s1_highpass.wav',
  s2_resample:  'data/s2_resample.wav',
  s4_trim:      'data/s4_trim_pre.wav',
};

const stages = {};
let maxDur = 0;
for (const [key, f] of Object.entries(files)) {
  const { samples, sampleRate } = readWav(f);
  const dur = samples.length / sampleRate;
  maxDur = Math.max(maxDur, dur);
  stages[key] = { samples, sampleRate, dur, peak: peakOf(samples) };
}

// Stage 3 = normalize stage 2 to -3 dBFS (gain applied, length unchanged)
const s2 = stages.s2_resample;
const gain = TARGET_PEAK / s2.peak;
stages.s3_normalize = {
  samples: Float32Array.from(s2.samples, (v) => v * gain),
  sampleRate: s2.sampleRate, dur: s2.dur, peak: TARGET_PEAK, gain,
};
// Stage 4 (trim) also carries the normalization gain
const t = stages.s4_trim;
const tGain = TARGET_PEAK / t.peak;
stages.s4_trim = { ...t, samples: Float32Array.from(t.samples, (v) => v * tGain), peak: TARGET_PEAK };

const order = ['s0_raw', 's1_highpass', 's2_resample', 's3_normalize', 's4_trim'];
const out = { bins: BINS, maxDur, targetPeakDb: -3, stages: {} };
for (const k of order) {
  const st = stages[k];
  out.stages[k] = {
    env: envelope(st.samples, BINS).map((v) => +v.toFixed(4)),
    dur: +st.dur.toFixed(4),
    widthFrac: +(st.dur / maxDur).toFixed(4),   // trimming visibly contracts the waveform
    sampleRate: st.sampleRate,
    peakDb: +(20 * Math.log10(st.peak)).toFixed(2),
  };
}
fs.writeFileSync('data/waveforms.json', JSON.stringify(out));
console.log('normalization gain applied: %sx (%s dB)', gain.toFixed(3), (20 * Math.log10(gain)).toFixed(2));
for (const k of order) {
  const s = out.stages[k];
  console.log('%s  dur=%ss  sr=%sHz  peak=%sdBFS', k.padEnd(13), s.dur.toFixed(3), s.sampleRate, s.peakDb);
}
