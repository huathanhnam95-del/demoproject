const { loadAudioQualityThresholds } = require('./audio-quality-thresholds');

function readAscii(view, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function parseWavBuffer(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
      return { ok: false, reason: 'decode_failed' };
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
      return { ok: false, reason: 'decode_failed' };
    }

    let offset = 12;
    let formatChunk = null;
    let dataChunk = null;

    while (offset + 8 <= view.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkEnd > view.byteLength) {
        return { ok: false, reason: 'decode_failed' };
      }

      if (chunkId === 'fmt ') {
        if (chunkSize < 16) {
          return { ok: false, reason: 'decode_failed' };
        }
        formatChunk = {
          audioFormat: view.getUint16(chunkStart, true),
          channelCount: view.getUint16(chunkStart + 2, true),
          sampleRate: view.getUint32(chunkStart + 4, true),
          bitsPerSample: view.getUint16(chunkStart + 14, true)
        };
      }

      if (chunkId === 'data') {
        dataChunk = buffer.subarray(chunkStart, chunkEnd);
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (!formatChunk || !dataChunk) {
      return { ok: false, reason: 'decode_failed' };
    }

    if (formatChunk.audioFormat !== 1 || formatChunk.channelCount !== 1 || formatChunk.bitsPerSample !== 16 || dataChunk.length < 2) {
      return { ok: false, reason: 'decode_failed' };
    }

    const sampleCount = Math.floor(dataChunk.length / 2);
    const samples = new Int16Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = dataChunk.readInt16LE(index * 2);
    }

    return {
      ok: true,
      sampleRate: formatChunk.sampleRate,
      channelCount: formatChunk.channelCount,
      bitsPerSample: formatChunk.bitsPerSample,
      samples
    };
  } catch (_) {
    return { ok: false, reason: 'decode_failed' };
  }
}

function analyzeAudioQuality(buffer) {
  const thresholds = loadAudioQualityThresholds();
  const parsed = parseWavBuffer(buffer);
  if (!parsed.ok) {
    return {
      passed: false,
      reason: parsed.reason,
      speechDurationMs: 0,
      clipped: false,
      sampleRate: null,
      maxRms: 0,
      clippedRatio: 0,
      silenceRatio: 1
    };
  }

  const { sampleRate, samples } = parsed;
  const totalSamples = samples.length;
  if (!totalSamples || !sampleRate) {
    return {
      passed: false,
      reason: 'decode_failed',
      speechDurationMs: 0,
      clipped: false,
      sampleRate: sampleRate || null,
      maxRms: 0,
      clippedRatio: 0,
      silenceRatio: 1
    };
  }

  let clippedSamples = 0;
  let maxAbs = 0;
  const normalized = new Float32Array(totalSamples);

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = samples[index];
    const absValue = Math.abs(sample);
    if (absValue >= 32760) clippedSamples += 1;
    if (absValue > maxAbs) maxAbs = absValue;
    normalized[index] = sample / 32768;
  }

  if (maxAbs < thresholds.minimumPeakAmplitude) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate,
      maxRms: 0,
      clippedRatio: clippedSamples / totalSamples,
      silenceRatio: 1
    };
  }

  const frameSize = Math.max(1, Math.round(sampleRate * 0.01));
  const frameDurationMs = (frameSize / sampleRate) * 1000;
  const frameRms = [];

  for (let offset = 0; offset < totalSamples; offset += frameSize) {
    const end = Math.min(totalSamples, offset + frameSize);
    let energy = 0;
    for (let index = offset; index < end; index += 1) {
      const sample = normalized[index];
      energy += sample * sample;
    }
    frameRms.push(Math.sqrt(energy / Math.max(1, end - offset)));
  }

  const maxRms = frameRms.reduce((highest, value) => Math.max(highest, value), 0);
  if (maxRms < thresholds.minimumFrameRms) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate,
      maxRms,
      clippedRatio: clippedSamples / totalSamples,
      silenceRatio: 1
    };
  }

  const threshold = Math.max(thresholds.minimumFrameThreshold, maxRms * thresholds.frameRmsFraction);
  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;
  let speechFrameCount = 0;

  for (let index = 0; index < frameRms.length; index += 1) {
    if (frameRms[index] >= threshold) {
      speechFrameCount += 1;
      if (firstSpeechFrame === -1) firstSpeechFrame = index;
      lastSpeechFrame = index;
    }
  }

  if (firstSpeechFrame === -1 || lastSpeechFrame === -1) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate,
      maxRms,
      clippedRatio: clippedSamples / totalSamples,
      silenceRatio: 1
    };
  }

  const speechDurationMs = Math.round((lastSpeechFrame - firstSpeechFrame + 1) * frameDurationMs);
  const clippedRatio = clippedSamples / totalSamples;
  const silenceRatio = 1 - (speechFrameCount / Math.max(1, frameRms.length));

  if (speechDurationMs < thresholds.minimumSpeechDurationMs) {
    return {
      passed: false,
      reason: 'too_short',
      speechDurationMs,
      clipped: clippedRatio >= thresholds.clippedSampleRatioThreshold,
      sampleRate,
      maxRms,
      clippedRatio,
      silenceRatio
    };
  }

  if (speechDurationMs > thresholds.maximumSpeechDurationMs) {
    return {
      passed: false,
      reason: 'too_long',
      speechDurationMs,
      clipped: clippedRatio >= thresholds.clippedSampleRatioThreshold,
      sampleRate,
      maxRms,
      clippedRatio,
      silenceRatio
    };
  }

  if (clippedRatio >= thresholds.clippedSampleRatioThreshold) {
    return {
      passed: false,
      reason: 'clipped',
      speechDurationMs,
      clipped: true,
      sampleRate,
      maxRms,
      clippedRatio,
      silenceRatio
    };
  }

  return {
    passed: true,
    reason: null,
    speechDurationMs,
    clipped: false,
    sampleRate,
    maxRms,
    clippedRatio,
    silenceRatio
  };
}

module.exports = {
  analyzeAudioQuality,
  parseWavBuffer
};
