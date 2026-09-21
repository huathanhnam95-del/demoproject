/**
 * AudioDspPipeline — Universal Client-Side Audio DSP Enhancement Engine
 *
 * Provides a standardized, hardware-accelerated DSP audio processing pipeline
 * for all current and future recording practice modes across the platform.
 *
 * Signal Chain:
 * Raw mic blob (webm/mp4/ogg)
 *   → decodeAudioData
 *   → 80 Hz 2nd-order Butterworth High-Pass Filter (eliminates AC hum, plosives, desk thumps)
 *   → 16 kHz Mono Resampling via OfflineAudioContext (sinc resample, cuts HF hiss > 8kHz)
 *   → Peak Normalization to -3 dBFS (calibrated SNR without clipping or AGC pumping)
 *   → Leading & Trailing Silence Trimming with 150ms temporal safety padding
 *   → 16-bit PCM WAV Encoding
 *
 * Resilience & Portability:
 * - 3-second Promise.race timeout for iOS Safari screen-lock / backgrounding
 * - Native AudioBuffer constructor prioritized (zero-overhead allocation)
 * - Temporary AudioContext instances strictly closed in try/finally blocks
 * - Graceful fallback to raw blob on any decoding/hardware exception
 */
(function (root, factory) {
  const api = factory();
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.AudioDspPipeline = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  /**
   * Safely creates a mono or multi-channel AudioBuffer using the native constructor
   * where available, falling back to a temporary AudioContext that is closed immediately.
   */
  function createAudioBuffer(numberOfChannels, length, sampleRate) {
    if (typeof AudioBuffer === 'function') {
      try {
        return new AudioBuffer({ numberOfChannels, length, sampleRate });
      } catch (_) {
        // Fallback for older WebKit / browsers
      }
    }
    const AudioContextCtor = typeof window !== 'undefined'
      ? (window.AudioContext || window.webkitAudioContext)
      : null;
    if (!AudioContextCtor) return null;
    const ctx = new AudioContextCtor();
    try {
      return ctx.createBuffer(numberOfChannels, length, sampleRate);
    } finally {
      if (typeof ctx.close === 'function') ctx.close().catch(() => {});
    }
  }

  /**
   * Detects speech boundaries using frame-based RMS energy thresholding.
   * Returns { firstSampleIndex, lastSampleIndex, speechDurationMs, frameRms, maxRms, threshold }
   * or null if no speech is detected.
   */
  function detectSpeechBoundaries(channelData, sampleRate, options = {}) {
    const totalSamples = channelData.length;
    const frameDurationSec = options.frameDurationSec || 0.01; // 10ms default
    const frameSize = Math.max(1, Math.round(sampleRate * frameDurationSec));
    const frameDurationMs = (frameSize / sampleRate) * 1000;
    const frameRms = [];

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const end = Math.min(totalSamples, offset + frameSize);
      let energy = 0;
      for (let i = offset; i < end; i++) {
        const val = channelData[i];
        energy += val * val;
      }
      frameRms.push(Math.sqrt(energy / Math.max(1, end - offset)));
    }

    const maxRms = frameRms.reduce((highest, val) => Math.max(highest, val), 0);
    const minFrameRms = options.minFrameRms || 0.01;
    if (maxRms < minFrameRms) return null;

    const minFrameThreshold = options.minFrameThreshold || 0.008;
    const frameRmsFraction = options.frameRmsFraction || 0.18;
    const threshold = Math.max(minFrameThreshold, maxRms * frameRmsFraction);

    let firstSpeechFrame = -1;
    let lastSpeechFrame = -1;
    let speechFrameCount = 0;

    for (let i = 0; i < frameRms.length; i++) {
      if (frameRms[i] >= threshold) {
        speechFrameCount++;
        if (firstSpeechFrame === -1) firstSpeechFrame = i;
        lastSpeechFrame = i;
      }
    }

    if (firstSpeechFrame === -1 || lastSpeechFrame === -1) return null;

    const firstSampleIndex = firstSpeechFrame * frameSize;
    const lastSampleIndex = Math.min(totalSamples - 1, (lastSpeechFrame + 1) * frameSize - 1);
    const speechDurationMs = Math.round((lastSpeechFrame - firstSpeechFrame + 1) * frameDurationMs);

    return {
      firstSampleIndex,
      lastSampleIndex,
      speechDurationMs,
      speechFrameCount,
      frameRms,
      maxRms,
      threshold
    };
  }

  /**
   * Trims leading and trailing silence from an AudioBuffer while strictly
   * preserving all internal inter-word pauses to protect fluency scoring.
   */
  function trimSilence(audioBuffer, options = {}) {
    const paddingMs = typeof options.paddingMs === 'number' ? options.paddingMs : 150;
    const minRemovalRatio = typeof options.minRemovalRatio === 'number' ? options.minRemovalRatio : 0.10;
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const boundaries = detectSpeechBoundaries(channelData, sampleRate, options);

    if (!boundaries) return audioBuffer;

    const paddingSamples = Math.round((paddingMs / 1000) * sampleRate);
    const trimStart = Math.max(0, boundaries.firstSampleIndex - paddingSamples);
    const trimEnd = Math.min(channelData.length, boundaries.lastSampleIndex + 1 + paddingSamples);
    const trimmedLength = trimEnd - trimStart;

    // Skip trimming if it would remove less than 10% of total samples (not worth the overhead)
    if (trimmedLength <= 0 || trimmedLength >= channelData.length * (1 - minRemovalRatio)) {
      return audioBuffer;
    }

    const trimmedBuffer = createAudioBuffer(1, trimmedLength, sampleRate);
    if (!trimmedBuffer) return audioBuffer;

    const trimmedData = trimmedBuffer.getChannelData(0);
    for (let i = 0; i < trimmedLength; i++) {
      trimmedData[i] = channelData[trimStart + i];
    }
    return trimmedBuffer;
  }

  /**
   * Serializes a mono AudioBuffer to a standard 16-bit PCM RIFF WAV Blob.
   */
  function encodeAudioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true);  // NumChannels (1 = Mono)
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true);  // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(36, 'data');
    view.setUint32(40, dataLength * 2, true);

    let offset = 44;
    for (let i = 0; i < dataLength; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  /**
   * Full client-side DSP pipeline:
   * 80 Hz highpass → 16 kHz resample → -3 dBFS normalize → lead/trail trim → WAV
   *
   * @param {Blob} rawBlob - Input audio recording blob (webm, mp4, etc.)
   * @param {Object} [options]
   * @param {number} [options.targetSampleRate=16000]
   * @param {number} [options.highpassFreq=80]
   * @param {number} [options.targetPeakDb=-3]
   * @param {boolean} [options.trim=true]
   * @param {boolean} [options.createUrl=true]
   * @param {number} [options.paddingMs=150]
   * @param {number} [options.timeoutMs=3000]
   * @returns {Promise<{ wavBlob: Blob, audioUrl: string, audioBuffer: AudioBuffer, stats: Object }>}
   */
  async function enhance(rawBlob, options = {}) {
    if (!(rawBlob instanceof Blob)) {
      throw new TypeError('[AudioDspPipeline] Input must be a valid Blob');
    }

    const targetSampleRate = options.targetSampleRate || 16000;
    const highpassFreq = typeof options.highpassFreq === 'number' ? options.highpassFreq : 80;
    const targetPeakDb = typeof options.targetPeakDb === 'number' ? options.targetPeakDb : -3;
    const shouldTrim = options.trim !== false;
    const shouldCreateUrl = options.createUrl !== false;
    const paddingMs = typeof options.paddingMs === 'number' ? options.paddingMs : 150;
    const timeoutMs = options.timeoutMs || 3000;

    let audioContext = null;
    try {
      const arrayBuffer = await rawBlob.arrayBuffer();
      const AudioContextCtor = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;

      if (!AudioContextCtor) {
        const fallbackUrl = shouldCreateUrl && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(rawBlob) : null;
        return { wavBlob: rawBlob, audioUrl: fallbackUrl, audioBuffer: null, stats: null };
      }

      audioContext = new AudioContextCtor();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const originalDurationMs = Math.round(decoded.duration * 1000);

      const outputLength = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
      const offline = new OfflineAudioContext(1, outputLength, targetSampleRate);

      // DSP graph: source → 80 Hz high-pass filter → destination
      const source = offline.createBufferSource();
      source.buffer = decoded;

      if (highpassFreq > 0) {
        const highpass = offline.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = highpassFreq;
        highpass.Q.value = 0.707; // 2nd-order Butterworth (maximally flat passband)
        source.connect(highpass);
        highpass.connect(offline.destination);
      } else {
        source.connect(offline.destination);
      }
      source.start(0);

      // Timeout fallback for iOS Safari screen-lock or background suspension
      let rendered;
      try {
        rendered = await Promise.race([
          offline.startRendering(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('OfflineAudioContext rendering timeout')), timeoutMs)
          )
        ]);
      } catch (renderTimeout) {
        console.warn('[AudioDspPipeline] OfflineAudioContext timed out, using bounded basic resample:', renderTimeout.message);
        const fallbackOffline = new OfflineAudioContext(1, outputLength, targetSampleRate);
        const fbSrc = fallbackOffline.createBufferSource();
        fbSrc.buffer = decoded;
        fbSrc.connect(fallbackOffline.destination);
        fbSrc.start(0);
        rendered = await Promise.race([
          fallbackOffline.startRendering(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fallback timeout')), timeoutMs))
        ]).catch(() => decoded);
      }

      // Close decode context as soon as rendering resolves
      if (typeof audioContext.close === 'function') {
        await audioContext.close().catch(() => {});
        audioContext = null;
      }

      // Peak normalization to targetPeakDb (default -3 dBFS = ~0.7079)
      const channelData = rendered.getChannelData(0);
      let maxPeak = 0;
      for (let i = 0; i < channelData.length; i++) {
        const absVal = Math.abs(channelData[i]);
        if (absVal > maxPeak) maxPeak = absVal;
      }
      const peakBefore = maxPeak;
      if (maxPeak > 0) {
        const targetPeak = Math.pow(10, targetPeakDb / 20);
        const gain = targetPeak / maxPeak;
        // Only apply if gain adjustment differs from unity by > 1%
        if (gain < 0.99 || gain > 1.01) {
          for (let i = 0; i < channelData.length; i++) {
            channelData[i] = Math.max(-1, Math.min(1, channelData[i] * gain));
          }
        }
      }

      // Leading & trailing silence trimming
      let finalBuffer = rendered;
      if (shouldTrim) {
        finalBuffer = trimSilence(rendered, { paddingMs });
      }

      const wavBlob = encodeAudioBufferToWav(finalBuffer);
      const audioUrl = shouldCreateUrl && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(wavBlob) : null;
      const finalData = finalBuffer.getChannelData(0);
      let peakAfter = 0;
      for (let i = 0; i < finalData.length; i++) {
        const absVal = Math.abs(finalData[i]);
        if (absVal > peakAfter) peakAfter = absVal;
      }
      const trimmedDurationMs = Math.round((finalBuffer.length / finalBuffer.sampleRate) * 1000);

      return {
        wavBlob,
        audioUrl,
        audioBuffer: finalBuffer,
        stats: {
          originalDurationMs,
          trimmedDurationMs,
          peakBefore,
          peakAfter,
          sampleRate: targetSampleRate
        }
      };
    } catch (error) {
      console.warn('[AudioDspPipeline] Audio enhancement failed, falling back to raw blob:', error);
      const fallbackUrl = shouldCreateUrl && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(rawBlob) : null;
      return {
        wavBlob: rawBlob,
        audioUrl: fallbackUrl,
        audioBuffer: null,
        stats: null,
        error: error.message
      };
    } finally {
      if (audioContext && typeof audioContext.close === 'function') {
        audioContext.close().catch(() => {});
      }
    }
  }

  /**
   * Creates an automated, lifecycle-managed audio recorder that acquires
   * microphone input and automatically runs the DSP enhancement pipeline on stop.
   *
   * @param {Object} [options]
   * @param {Function} [options.onDataAvailable]
   * @param {Function} [options.onStop] - Called with ({ rawBlob, wavBlob, audioUrl, stats })
   * @returns {Object} Recorder controller { start, stop, cancel, getState }
   */
  function createRecorder(options = {}) {
    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let state = 'inactive'; // 'inactive' | 'recording' | 'processing'
    let isCancelled = false;
    let isAcquiring = false;

    async function start() {
      if (isAcquiring || state !== 'inactive') {
        throw new Error('[AudioDspPipeline.createRecorder] Recorder is already active.');
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('[AudioDspPipeline.createRecorder] Microphone access is not supported.');
      }

      isAcquiring = true;
      isCancelled = false;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (err) {
        isAcquiring = false;
        state = 'inactive';
        throw err;
      } finally {
        isAcquiring = false;
      }

      if (isCancelled) {
        if (stream && typeof stream.getTracks === 'function') {
          stream.getTracks().forEach((t) => t.stop());
        }
        state = 'inactive';
        return;
      }

      mediaStream = stream;
      if (typeof options.onStream === 'function') {
        try { options.onStream(stream); } catch (_) {}
      }
      recordedChunks = [];
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported
        ? (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((mt) => MediaRecorder.isTypeSupported(mt)) || '')
        : '';

      mediaRecorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);

      mediaRecorder.addEventListener('dataavailable', (evt) => {
        if (evt.data && evt.data.size > 0) {
          recordedChunks.push(evt.data);
          if (typeof options.onDataAvailable === 'function') {
            options.onDataAvailable(evt.data);
          }
        }
      });

      mediaRecorder.start(options.timeslice || 250);
      state = 'recording';
    }

    function cleanupStream() {
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
    }

    async function stop() {
      if (state !== 'recording' || !mediaRecorder) {
        return null;
      }

      state = 'processing';
      const recorder = mediaRecorder;
      cleanupStream();

      return new Promise((resolve) => {
        recorder.addEventListener('stop', async () => {
          const rawMime = recorder.mimeType || recordedChunks[0]?.type || 'audio/webm';
          const rawBlob = new Blob(recordedChunks, { type: rawMime });

          // Run DSP enhancement pipeline
          const enhanced = await enhance(rawBlob, options.dspOptions);
          state = 'inactive';
          mediaRecorder = null;

          if (isCancelled) {
            if (enhanced && enhanced.audioUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
              URL.revokeObjectURL(enhanced.audioUrl);
            }
            resolve(null);
            return;
          }

          const result = {
            rawBlob,
            wavBlob: enhanced.wavBlob,
            audioUrl: enhanced.audioUrl,
            audioBuffer: enhanced.audioBuffer,
            stats: enhanced.stats
          };

          if (typeof options.onStop === 'function') {
            try { options.onStop(result); } catch (_) { /* ignore */ }
          }
          resolve(result);
        }, { once: true });

        try {
          recorder.stop();
        } catch (_) {
          state = 'inactive';
          mediaRecorder = null;
          resolve(null);
        }
      });
    }

    function cancel() {
      isAcquiring = false;
      isCancelled = true;
      cleanupStream();
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (_) { /* ignore */ }
      }
      mediaRecorder = null;
      state = 'inactive';
      recordedChunks = [];
    }

    return Object.freeze({
      start,
      stop,
      cancel,
      getState: () => state,
      getStream: () => mediaStream
    });
  }

  return Object.freeze({
    enhance,
    createRecorder,
    detectSpeechBoundaries,
    trimSilence,
    encodeAudioBufferToWav,
    createAudioBuffer
  });
});
