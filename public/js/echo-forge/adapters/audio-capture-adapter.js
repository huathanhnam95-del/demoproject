export function encodeAudioBufferToWav(buffer) {
  if (!buffer || typeof buffer.getChannelData !== 'function' || !Number.isFinite(buffer.sampleRate)) {
    throw new TypeError('a decoded AudioBuffer is required');
  }
  const channelData = buffer.getChannelData(0);
  const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
  const view = new DataView(wavBuffer);
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, channelData.length * 2, true);
  let offset = 44;
  for (const value of channelData) {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

export async function prepareWavBlob(blob, {
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  OfflineAudioContextClass = globalThis.OfflineAudioContext,
  sampleRate = 16000,
} = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('audio blob is required');
  if (globalThis.AudioDspPipeline && typeof globalThis.AudioDspPipeline.enhance === 'function') {
    try {
      const result = await globalThis.AudioDspPipeline.enhance(blob, { targetSampleRate: sampleRate });
      if (result && result.wavBlob) return result.wavBlob;
    } catch (e) {
      console.warn('[EchoForge] AudioDspPipeline enhancement failed, falling back:', e);
    }
  }
  if (blob.type === 'audio/wav' || blob.type === 'audio/wave') return blob;
  if (typeof AudioContextClass !== 'function' || typeof OfflineAudioContextClass !== 'function') {
    throw new Error('WAV conversion is unavailable in this browser');
  }
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
    const offline = new OfflineAudioContextClass(1, frameCount, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    return encodeAudioBufferToWav(await offline.startRendering());
  } finally {
    if (typeof context.close === 'function') await context.close().catch(() => undefined);
  }
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

export function createAudioCapture({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  wavOptions = {},
} = {}) {
  let state = 'idle';
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = null;

  return Object.freeze({
    get state() { return state; },
    get stream() { return stream; },
    async start() {
      if (state === 'recording') throw new Error('recording is already active');
      if (!mediaDevices?.getUserMedia || typeof MediaRecorderClass !== 'function') {
        throw new Error('microphone recording is unsupported');
      }
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      chunks = [];
      recorder = new MediaRecorderClass(stream);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.start();
      startedAt = clock();
      state = 'recording';
    },
    async stop() {
      if (state !== 'recording' || !recorder) throw new Error('no active recording');
      state = 'stopping';
      const rawBlob = await new Promise((resolve, reject) => {
        recorder.addEventListener('stop', () => {
          try {
            resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' }));
          } catch (error) {
            reject(error);
          }
        }, { once: true });
        try { recorder.stop(); } catch (error) { reject(error); }
      });
      const durationMs = Math.max(0, clock() - startedAt);
      stopTracks(stream);
      stream = null;
      recorder = null;
      const blob = await prepareWavBlob(rawBlob, wavOptions);
      state = 'stopped';
      return Object.freeze({ blob, durationMs, byteCount: blob.size, mimeType: blob.type });
    },
    cancel() {
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch { /* best-effort cancellation */ }
      }
      stopTracks(stream);
      stream = null;
      recorder = null;
      chunks = [];
      state = 'cancelled';
    },
  });
}
