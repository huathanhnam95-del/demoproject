'use strict';

const crypto = require('crypto');

/**
 * AudioManifest specification per Plan V3 §4.2
 * Enforces canonical 16 kHz mono PCM16 audio identity and coordinate contract.
 */
const CANONICAL_SAMPLE_RATE_HZ = 16000;
const CANONICAL_CHANNELS = 1;
const CANONICAL_FORMAT = 'pcm_s16le';
const CONVERSION_VERSION = 'bel.audio.v3';

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseCanonicalWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new TypeError('BUFFER_REQUIRED');
  }
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) !== buffer.length - 8) {
    throw new TypeError('CANONICAL_WAV_REQUIRED');
  }

  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw new TypeError('INVALID_WAV_CHUNK');
    if (chunkId === 'fmt ') {
      if (fmt || size < 16) throw new TypeError('INVALID_WAV_FORMAT');
      fmt = {
        codec: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRateHz: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    } else if (chunkId === 'data') {
      if (data) throw new TypeError('MULTIPLE_WAV_DATA_CHUNKS');
      data = { offset: start, bytes: size };
    }
    offset = end + (size & 1);
  }
  if (offset !== buffer.length || !fmt || !data || data.bytes === 0 || (data.bytes & 1) ||
      fmt.codec !== 1 || fmt.channels !== 1 || fmt.sampleRateHz !== 16000 ||
      fmt.byteRate !== 32000 || fmt.blockAlign !== 2 || fmt.bitsPerSample !== 16) {
    throw new TypeError('INVALID_CANONICAL_AUDIO');
  }
  return { pcm: buffer.subarray(data.offset, data.offset + data.bytes), sampleCount: data.bytes / 2 };
}

/** Build identity only from validated 16 kHz mono PCM16 audio. */
function createAudioManifest(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError('BUFFER_REQUIRED');

  const {
    assetId = `audio-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    storageGeneration = null,
    timelineId = `tl-${crypto.randomBytes(8).toString('hex')}`,
    originalUploadBuffer = null,
    mappingRef = null
  } = options;
  const parsed = options.allowRawPcm === true
    ? { pcm: buffer, sampleCount: buffer.length / 2 }
    : parseCanonicalWav(buffer);
  if (!Number.isSafeInteger(parsed.sampleCount) || parsed.sampleCount <= 0) {
    throw new TypeError('INVALID_CANONICAL_AUDIO');
  }

  const originalUploadHash = originalUploadBuffer ? sha256Hex(originalUploadBuffer) : null;
  const canonicalFileHash = sha256Hex(buffer);
  const pcmPayloadHash = sha256Hex(parsed.pcm);

  return {
    assetId,
    storageGeneration,
    originalUploadHash,
    canonicalFileHash,
    pcmPayloadHash,
    sampleRateHz: CANONICAL_SAMPLE_RATE_HZ,
    channels: CANONICAL_CHANNELS,
    format: CANONICAL_FORMAT,
    sampleCount: parsed.sampleCount,
    conversionVersion: CONVERSION_VERSION,
    timelineId,
    originalMapping: {
      kind: mappingRef ? 'explicit' : 'unavailable',
      mappingRef
    }
  };
}

module.exports = {
  CANONICAL_SAMPLE_RATE_HZ,
  CANONICAL_CHANNELS,
  CANONICAL_FORMAT,
  CONVERSION_VERSION,
  parseCanonicalWav,
  createAudioManifest
};
