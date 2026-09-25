/**
 * Bounded Clip Player
 * Pure AudioBuffer slice construction matching Plan V3 §11.2.
 * Strictly enforces timeline and coordinate match against the AudioManifest.
 */

export function makeBoundedClip(context, sourceBuffer, manifest, span) {
  if (!context || !sourceBuffer || !manifest || !span) {
    throw new TypeError('CLIP_INPUT_REQUIRED');
  }
  if (span.timelineId && manifest.timelineId && span.timelineId !== manifest.timelineId) {
    throw new Error('AUDIO_TIMELINE_MISMATCH');
  }
  if (
    sourceBuffer.sampleRate !== manifest.sampleRateHz ||
    sourceBuffer.length !== manifest.sampleCount ||
    sourceBuffer.numberOfChannels !== manifest.channels
  ) {
    throw new Error('DECODED_AUDIO_MISMATCH');
  }
  const { startSample: start, endSample: end } = span;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > sourceBuffer.length
  ) {
    throw new RangeError('INVALID_CLIP_SPAN');
  }

  const clipLength = end - start;
  const clip = context.createBuffer(
    sourceBuffer.numberOfChannels,
    clipLength,
    sourceBuffer.sampleRate
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    const channelData = sourceBuffer.getChannelData(channel);
    const sub = channelData.subarray(start, end);
    if (typeof clip.copyToChannel === 'function') {
      clip.copyToChannel(sub, channel);
    } else {
      clip.getChannelData(channel).set(sub);
    }
  }
  return clip;
}

/**
 * Encodes a mono Float32Array PCM into a canonical 16-bit PCM WAV Blob
 * Used for bounded fallback when Web Audio node graph is unviable.
 */
export function encodePcmWavBlob(channelData, sampleRate = 16000) {
  if (!channelData || typeof channelData.length !== 'number') {
    throw new TypeError('CHANNEL_DATA_REQUIRED');
  }
  const numSamples = channelData.length;
  const headerBytes = 44;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 for mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Write 16-bit PCM samples with float clamping
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const val = channelData[i];
    const s = Number.isFinite(val) ? Math.max(-1, Math.min(1, val)) : 0;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

const BoundedClipPlayer = {
  makeBoundedClip,
  encodePcmWavBlob
};

if (typeof globalThis !== 'undefined') {
  globalThis.BoundedClipPlayer = BoundedClipPlayer;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BoundedClipPlayer;
  module.exports.makeBoundedClip = makeBoundedClip;
  module.exports.encodePcmWavBlob = encodePcmWavBlob;
}

export default BoundedClipPlayer;
