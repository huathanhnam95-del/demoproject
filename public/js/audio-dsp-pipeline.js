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
      : (typeof globalThis !== 'undefined' ? (globalThis.AudioContext || globalThis.webkitAudioContext) : null);
    if (!AudioContextCtor) {
      const channels = [];
      for (let c = 0; c < numberOfChannels; c++) {
        channels.push(new Float32Array(length));
      }
      return {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch) => channels[ch] || channels[0]
      };
    }
    const ctx = new AudioContextCtor();
    try {
      return ctx.createBuffer(numberOfChannels, length, sampleRate);
    } finally {
      if (typeof ctx.close === 'function') ctx.close().catch(() => {});
    }
  }

  /**
   * Detects speech boundaries using frame-based RMS energy and Zero-Crossing Rate (ZCR).
   * Returns { firstSampleIndex, lastSampleIndex, speechDurationMs, frameRms, zcrRate, maxRms, threshold }
   * or null if no speech is detected.
   */
  function detectSpeechBoundaries(channelData, sampleRate, options = {}) {
    const totalSamples = channelData.length;
    const frameDurationSec = options.frameDurationSec || 0.01; // 10ms default
    const frameSize = Math.max(1, Math.round(sampleRate * frameDurationSec));
    const frameDurationMs = (frameSize / sampleRate) * 1000;
    const frameRms = [];
    const zcrRate = [];

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const end = Math.min(totalSamples, offset + frameSize);
      let energy = 0;
      let zcrCount = 0;
      for (let i = offset; i < end; i++) {
        const val = channelData[i];
        energy += val * val;
        if (i > offset && ((val >= 0 && channelData[i - 1] < 0) || (val < 0 && channelData[i - 1] >= 0))) {
          zcrCount++;
        }
      }
      const count = Math.max(1, end - offset);
      frameRms.push(Math.sqrt(energy / count));
      zcrRate.push(zcrCount / Math.max(1, count - 1));
    }

    const maxRms = frameRms.reduce((highest, val) => Math.max(highest, val), 0);
    const minFrameRms = options.minFrameRms || 0.01;
    if (maxRms < minFrameRms) return null;

    const minFrameThreshold = options.minFrameThreshold || 0.008;
    const frameRmsFraction = options.frameRmsFraction || 0.18;
    const threshold = Math.max(minFrameThreshold, maxRms * frameRmsFraction);

    // Calculate baseline noise floor for low-energy unvoiced fricative ZCR gating
    const sortedRms = [...frameRms].sort((a, b) => a - b);
    const noiseFloor = sortedRms.length > 0 ? sortedRms[Math.floor(sortedRms.length * 0.10)] : 0.001;
    const zcrNoiseThreshold = Math.max(0.001, noiseFloor * 1.5);
    const zcrThreshold = typeof options.zcrThreshold === 'number' ? options.zcrThreshold : 0.18;

    let firstSpeechFrame = -1;
    let lastSpeechFrame = -1;
    let speechFrameCount = 0;

    for (let i = 0; i < frameRms.length; i++) {
      const isSpeechRms = frameRms[i] >= threshold;
      const isSpeechZcr = zcrRate[i] >= zcrThreshold && frameRms[i] >= zcrNoiseThreshold;
      if (isSpeechRms || isSpeechZcr) {
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
      zcrRate,
      maxRms,
      threshold
    };
  }

  /**
   * Trims leading and trailing silence from an AudioBuffer while strictly
   * preserving all internal inter-word pauses to protect fluency scoring.
   */
  function trimSilence(audioBuffer, options = {}) {
    const paddingMs = typeof options.paddingMs === 'number' ? options.paddingMs : 200;
    const minRemovalRatio = typeof options.minRemovalRatio === 'number' ? options.minRemovalRatio : 0.02;
    const minRemovedMs = typeof options.minRemovedMs === 'number' ? options.minRemovedMs : 400;
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const boundaries = detectSpeechBoundaries(channelData, sampleRate, options);

    if (!boundaries) return audioBuffer;

    const paddingSamples = Math.round((paddingMs / 1000) * sampleRate);
    const trimStart = Math.max(0, boundaries.firstSampleIndex - paddingSamples);
    const trimEnd = Math.min(channelData.length, boundaries.lastSampleIndex + 1 + paddingSamples);
    const trimmedLength = trimEnd - trimStart;
    const removedSamples = channelData.length - trimmedLength;
    const removedMs = (removedSamples / sampleRate) * 1000;

    // Trim whenever removed duration is >= 400ms (or passes caller minRemovalRatio)
    if (trimmedLength <= 0 || (removedMs < minRemovedMs && removedSamples < channelData.length * minRemovalRatio)) {
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
   * @param {boolean} [options.clarity=true]
   * @param {number} [options.lowShelfFreq=180]
   * @param {number} [options.lowShelfGain=-4.0]
   * @param {number} [options.presenceFreq=2800]
   * @param {number} [options.presenceGain=2.0]
   * @param {number} [options.paddingMs=200]
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
    const shouldApplyClarity = options.clarity !== false;
    const paddingMs = typeof options.paddingMs === 'number' ? options.paddingMs : 200;
    const timeoutMs = options.timeoutMs || 3000;

    let audioContext = null;
    try {
      const arrayBuffer = await rawBlob.arrayBuffer();
      const AudioContextCtor = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : (typeof globalThis !== 'undefined' ? (globalThis.AudioContext || globalThis.webkitAudioContext) : null);

      if (!AudioContextCtor) {
        const fallbackUrl = shouldCreateUrl && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(rawBlob) : null;
        return { wavBlob: rawBlob, audioUrl: fallbackUrl, audioBuffer: null, stats: null };
      }

      audioContext = new AudioContextCtor();
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const originalDurationMs = Math.round(decoded.duration * 1000);

      const outputLength = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
      const OfflineCtxCtor = typeof window !== 'undefined'
        ? (window.OfflineAudioContext || window.webkitOfflineAudioContext)
        : (typeof globalThis !== 'undefined' ? (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext) : null);

      if (!OfflineCtxCtor) {
        const fallbackUrl = shouldCreateUrl && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(rawBlob) : null;
        return { wavBlob: rawBlob, audioUrl: fallbackUrl, audioBuffer: null, stats: null };
      }

      const offline = new OfflineCtxCtor(1, outputLength, targetSampleRate);

      // DSP graph: source → 80 Hz high-pass → 180 Hz low-shelf (de-mud) → 2800 Hz presence bell → destination
      const source = offline.createBufferSource();
      source.buffer = decoded;

      let lastNode = source;

      if (highpassFreq > 0) {
        const highpass = offline.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = highpassFreq;
        highpass.Q.value = 0.707; // 2nd-order Butterworth
        lastNode.connect(highpass);
        lastNode = highpass;
      }

      if (shouldApplyClarity) {
        // 180 Hz Low Shelf (-4 dB) cuts proximity boom while preserving vowel F1
        const lowShelf = offline.createBiquadFilter();
        lowShelf.type = 'lowshelf';
        lowShelf.frequency.value = typeof options.lowShelfFreq === 'number' ? options.lowShelfFreq : 180;
        lowShelf.gain.value = typeof options.lowShelfGain === 'number' ? options.lowShelfGain : -4.0;
        lastNode.connect(lowShelf);
        lastNode = lowShelf;

        // 2,800 Hz Presence Bell (+2 dB, Q=1.0) lifts consonant plosives and F2/F3 formant transitions
        const presenceBell = offline.createBiquadFilter();
        presenceBell.type = 'peaking';
        presenceBell.frequency.value = typeof options.presenceFreq === 'number' ? options.presenceFreq : 2800;
        presenceBell.Q.value = typeof options.presenceQ === 'number' ? options.presenceQ : 1.0;
        presenceBell.gain.value = typeof options.presenceGain === 'number' ? options.presenceGain : 2.0;
        lastNode.connect(presenceBell);
        lastNode = presenceBell;
      }

      lastNode.connect(offline.destination);
      source.start(0);

      // Timeout fallback for iOS Safari screen-lock or background suspension
      let rendered;
      let renderTimer = null;
      try {
        rendered = await Promise.race([
          offline.startRendering(),
          new Promise((_, reject) => {
            renderTimer = setTimeout(() => reject(new Error('OfflineAudioContext rendering timeout')), timeoutMs);
            if (renderTimer && typeof renderTimer.unref === 'function') renderTimer.unref();
          })
        ]);
      } catch (renderTimeout) {
        console.warn('[AudioDspPipeline] OfflineAudioContext timed out, using bounded basic resample:', renderTimeout.message);
        const fallbackOffline = new OfflineCtxCtor(1, outputLength, targetSampleRate);
        const fbSrc = fallbackOffline.createBufferSource();
        fbSrc.buffer = decoded;
        fbSrc.connect(fallbackOffline.destination);
        fbSrc.start(0);
        let fbTimer = null;
        rendered = await Promise.race([
          fallbackOffline.startRendering(),
          new Promise((_, reject) => {
            fbTimer = setTimeout(() => reject(new Error('Fallback timeout')), timeoutMs);
            if (fbTimer && typeof fbTimer.unref === 'function') fbTimer.unref();
          })
        ]).catch(() => decoded);
        if (fbTimer) clearTimeout(fbTimer);
      } finally {
        if (renderTimer) clearTimeout(renderTimer);
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
      const trimmedSilenceMs = Math.max(0, originalDurationMs - trimmedDurationMs);

      // Estimate mudRatio: energy in low-mid (differences across samples) vs overall
      let lowMidSum = 0;
      let midHighSum = 0;
      const step = Math.max(1, Math.floor(finalData.length / 5000));
      for (let i = 0; i < finalData.length - 1; i += step) {
        const s0 = finalData[i];
        const s1 = finalData[i + 1];
        const diff = Math.abs(s1 - s0); // high frequency proxy
        const raw = Math.abs(s0);       // low-mid dominance proxy
        lowMidSum += raw;
        midHighSum += diff;
      }
      const mudRatio = midHighSum > 0 ? Number((lowMidSum / midHighSum).toFixed(2)) : 1.0;

      return {
        wavBlob,
        audioUrl,
        audioBuffer: finalBuffer,
        stats: {
          originalDurationMs,
          trimmedDurationMs,
          trimmedSilenceMs,
          peakBefore,
          peakAfter,
          sampleRate: targetSampleRate,
          clarityApplied: shouldApplyClarity,
          mudRatio
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
      const isPromptMode = options.modeId === 'repeat_sentence' || options.modeId === 'retell_lecture';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: isPromptMode ? { ideal: true } : { ideal: false },
            noiseSuppression: { ideal: false },
            autoGainControl: { ideal: true }
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

          let enhanced = null;
          let preparationError = null;
          const rawOnly = options.audioPreparation === 'raw-only';
          if (!rawOnly) {
            try {
              enhanced = options.audioPreparation === 'format-only'
                ? await prepareForAssessment(rawBlob)
                : await enhance(rawBlob, options.dspOptions);
            } catch (error) {
              preparationError = error;
            }
          }
          state = 'inactive';
          mediaRecorder = null;

          if (isCancelled) {
            if (enhanced && enhanced.audioUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) {
              URL.revokeObjectURL(enhanced.audioUrl);
            }
            resolve(null);
            return;
          }

          const enhancedWav = !!enhanced?.audioBuffer && !!enhanced?.wavBlob;
          const result = {
            rawBlob,
            wavBlob: enhanced?.wavBlob || null,
            outputBlob: enhanced?.outputBlob || (enhancedWav ? enhanced.wavBlob : null),
            outputMimeType: enhanced?.outputMimeType || (enhancedWav ? enhanced.wavBlob.type : (rawOnly ? rawMime : null)),
            outputFormat: enhanced?.outputFormat || (rawOnly ? 'raw' : (enhancedWav ? 'wav' : 'unavailable')),
            audioUrl: enhanced?.audioUrl || null,
            audioBuffer: enhanced?.audioBuffer || null,
            processingStatus: enhanced?.processingStatus || (rawOnly ? 'raw-only' : (enhancedWav ? 'complete' : 'format-conversion-failed')),
            fallback: enhanced ? (enhanced.fallback === true || !enhancedWav) : !rawOnly,
            appliedStages: enhanced?.appliedStages || [],
            skippedStages: enhanced?.skippedStages || [],
            stats: enhanced?.stats || null,
            error: enhanced?.error || preparationError?.message || null
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
    prepareForAssessment,
    createRecorder,
    detectSpeechBoundaries,
    trimSilence,
    isValidMono16kWav,
    encodeAudioBufferToWav,
    createAudioBuffer
  });
});
  function readAscii(view, offset, length) {
    let value = '';
    for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
    return value;
  }

  async function parseMono16kPcmWav(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength < 12) return null;
    const view = new DataView(bytes);
    if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') return null;

    const riffEnd = 8 + view.getUint32(4, true);
    if (riffEnd !== bytes.byteLength || riffEnd < 12) return null;
    let cursor = 12;
    let format = null;
    const dataChunks = [];
    let dataByteLength = 0;

    while (cursor < riffEnd) {
      if (cursor + 8 > riffEnd) return null;
      const chunkId = readAscii(view, cursor, 4);
      const chunkLength = view.getUint32(cursor + 4, true);
      const chunkStart = cursor + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (chunkEnd > riffEnd) return null;

      if (chunkId === 'fmt ') {
        if (format || chunkLength < 16) return null;
        format = {
          audioFormat: view.getUint16(chunkStart, true),
          channels: view.getUint16(chunkStart + 2, true),
          sampleRate: view.getUint32(chunkStart + 4, true),
          byteRate: view.getUint32(chunkStart + 8, true),
          blockAlign: view.getUint16(chunkStart + 12, true),
          bitsPerSample: view.getUint16(chunkStart + 14, true)
        };
      } else if (chunkId === 'data') {
        dataChunks.push(new Uint8Array(bytes, chunkStart, chunkLength));
        dataByteLength += chunkLength;
      }

      cursor = chunkEnd + (chunkLength & 1);
      if (cursor > riffEnd) return null;
    }

    if (!format
      || !dataChunks.length
      || dataByteLength <= 0
      || (dataByteLength & 1) !== 0
      || format.audioFormat !== 1
      || format.channels !== 1
      || format.sampleRate !== 16000
      || format.byteRate !== 32000
      || format.blockAlign !== 2
      || format.bitsPerSample !== 16) {
      return null;
    }

    let canonical = blob.type === 'audio/wav'
      && dataChunks.length === 1
      && dataByteLength === bytes.byteLength - 44
      && readAscii(view, 12, 4) === 'fmt '
      && view.getUint32(16, true) === 16
      && view.getUint16(20, true) === 1
      && view.getUint16(22, true) === 1
      && view.getUint32(24, true) === 16000
      && view.getUint32(28, true) === 32000
      && view.getUint16(32, true) === 2
      && view.getUint16(34, true) === 16
      && readAscii(view, 36, 4) === 'data'
      && view.getUint32(40, true) === dataByteLength;

    let pcmBytes;
    if (dataChunks.length === 1) {
      pcmBytes = dataChunks[0];
    } else {
      pcmBytes = new Uint8Array(dataByteLength);
      let offset = 0;
      for (const chunk of dataChunks) {
        pcmBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    return { pcmBytes, sampleCount: dataByteLength / 2, canonical };
  }

  function encodePcmBytesAsCanonicalWav(pcmBytes) {
    const dataLength = pcmBytes.byteLength;
    const wavBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(wavBuffer);
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    new Uint8Array(wavBuffer, 44).set(pcmBytes);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  function resampleMono(samples, inputRate, outputRate) {
    if (inputRate === outputRate) return samples;
    const outputLength = Math.max(1, Math.round(samples.length * outputRate / inputRate));
    const output = new Float32Array(outputLength);
    const inputPerOutput = inputRate / outputRate;
    const cutoff = Math.min(1, outputRate / inputRate);
    const radius = 16;
    const sinc = (value) => Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);

    for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
      const center = outIndex * inputPerOutput;
      const first = Math.max(0, Math.ceil(center - radius));
      const last = Math.min(samples.length - 1, Math.floor(center + radius));
      let weighted = 0;
      let weightTotal = 0;
      for (let inIndex = first; inIndex <= last; inIndex += 1) {
        const distance = center - inIndex;
        const windowPosition = distance / radius;
        const window = Math.abs(windowPosition) >= 1
          ? 0
          : 0.42 + 0.5 * Math.cos(Math.PI * windowPosition) + 0.08 * Math.cos(2 * Math.PI * windowPosition);
        const weight = cutoff * sinc(distance * cutoff) * window;
        weighted += samples[inIndex] * weight;
        weightTotal += weight;
      }
      output[outIndex] = weightTotal ? weighted / weightTotal : 0;
    }
    return output;
  }

  function makeMonoAudioBuffer(samples, sampleRate) {
    return {
      numberOfChannels: 1,
      length: samples.length,
      sampleRate,
      duration: samples.length / sampleRate,
      getChannelData: (channel) => {
        if (channel !== 0) throw new RangeError('Channel index is out of range.');
        return samples;
      }
    };
  }

  /**
   * Converts an original recording only when the scorer requires mono 16 kHz PCM WAV.
   * This opt-in path never filters, normalizes, suppresses noise, compresses, or trims.
   * Compatible PCM WAV input keeps its exact sample bytes; other formats are decoded,
   * averaged to mono, resampled directly to 16 kHz if needed, then PCM-encoded.
   */
  function encodeAssessmentAudioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);
    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength * 2, true);
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
    view.setUint32(40, dataLength * 2, true);
    for (let index = 0; index < dataLength; index += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  async function prepareForAssessment(rawBlob) {
    if (!(rawBlob instanceof Blob)) {
      throw new TypeError('[AudioDspPipeline.prepareForAssessment] Input must be a valid Blob');
    }

    let audioContext = null;
    try {
      const compatibleWav = await parseMono16kPcmWav(rawBlob);
      if (compatibleWav) {
        const outputBlob = compatibleWav.canonical
          ? rawBlob
          : encodePcmBytesAsCanonicalWav(compatibleWav.pcmBytes);
        const audioBuffer = makeMonoAudioBuffer(new Float32Array(compatibleWav.sampleCount), 16000);
        const samples = audioBuffer.getChannelData(0);
        const view = new DataView(compatibleWav.pcmBytes.buffer, compatibleWav.pcmBytes.byteOffset, compatibleWav.pcmBytes.byteLength);
        for (let index = 0; index < compatibleWav.sampleCount; index += 1) {
          const sample = view.getInt16(index * 2, true);
          samples[index] = sample < 0 ? sample / 32768 : sample / 32767;
        }
        return {
          rawBlob,
          wavBlob: outputBlob,
          outputBlob,
          outputMimeType: 'audio/wav',
          outputFormat: 'wav',
          processingStatus: compatibleWav.canonical ? 'format-preserved' : 'wav-container-rebuilt',
          audioUrl: null,
          audioBuffer,
          sampleCount: compatibleWav.sampleCount,
          fallback: false,
          appliedStages: compatibleWav.canonical ? [] : ['wav-container-rebuild'],
          skippedStages: ['highpass', 'clarity-eq', 'peak-normalize', 'trim', 'noise-suppression', 'compression'],
          stats: {
            originalDurationMs: compatibleWav.sampleCount * 1000 / 16000,
            outputDurationMs: compatibleWav.sampleCount * 1000 / 16000,
            removedLeadingMs: 0,
            removedTrailingMs: 0,
            removedTotalMs: 0,
            inputSampleRateHz: 16000,
            outputSampleRateHz: 16000,
            outputChannels: 1,
            sampleCount: compatibleWav.sampleCount,
            appliedStages: compatibleWav.canonical ? [] : ['wav-container-rebuild'],
            skippedStages: ['highpass', 'clarity-eq', 'peak-normalize', 'trim', 'noise-suppression', 'compression']
          }
        };
      }

      const AudioContextCtor = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!AudioContextCtor) throw new Error('audio-decoder-unavailable');
      audioContext = new AudioContextCtor();
      const sourceBytes = await rawBlob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(sourceBytes.slice(0));
      if (!decoded
        || !Number.isInteger(decoded.numberOfChannels)
        || decoded.numberOfChannels < 1
        || !Number.isInteger(decoded.length)
        || decoded.length < 1
        || !Number.isFinite(decoded.sampleRate)
        || decoded.sampleRate <= 0) {
        throw new Error('decoded-audio-invalid');
      }

      const mono = new Float32Array(decoded.length);
      const channelData = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
      for (let index = 0; index < decoded.length; index += 1) {
        let sum = 0;
        for (const channel of channelData) {
          const sample = channel[index];
          if (!Number.isFinite(sample)) throw new Error('decoded-audio-non-finite-sample');
          sum += sample;
        }
        mono[index] = sum / channelData.length;
      }

      const converted = decoded.sampleRate === 16000 ? mono : resampleMono(mono, decoded.sampleRate, 16000);
      if (!converted.length || converted.some((sample) => !Number.isFinite(sample))) {
        throw new Error('resampled-audio-invalid');
      }
      const audioBuffer = makeMonoAudioBuffer(converted, 16000);
      const outputBlob = encodeAssessmentAudioBufferToWav(audioBuffer);
      const appliedStages = ['decode'];
      if (decoded.numberOfChannels !== 1) appliedStages.push('channel-average-to-mono');
      if (decoded.sampleRate !== 16000) appliedStages.push('resample-to-16000-hz');
      appliedStages.push('pcm16-encode');
      const durationMs = decoded.length * 1000 / decoded.sampleRate;
      return {
        rawBlob,
        wavBlob: outputBlob,
        outputBlob,
        outputMimeType: 'audio/wav',
        outputFormat: 'wav',
        processingStatus: 'format-converted',
        audioUrl: null,
        audioBuffer,
        sampleCount: converted.length,
        fallback: false,
        appliedStages,
        skippedStages: ['highpass', 'clarity-eq', 'peak-normalize', 'trim', 'noise-suppression', 'compression'],
        stats: {
          originalDurationMs: durationMs,
          outputDurationMs: converted.length * 1000 / 16000,
          removedLeadingMs: 0,
          removedTrailingMs: 0,
          removedTotalMs: 0,
          inputSampleRateHz: decoded.sampleRate,
          outputSampleRateHz: 16000,
          outputChannels: 1,
          sampleCount: converted.length,
          appliedStages: appliedStages.slice(),
          skippedStages: ['highpass', 'clarity-eq', 'peak-normalize', 'trim', 'noise-suppression', 'compression']
        }
      };
    } catch (error) {
      const failure = new Error('Audio format conversion failed. The original recording is available, but scoring is unavailable.');
      failure.name = 'AudioPreparationError';
      failure.code = 'AUDIO_FORMAT_CONVERSION_FAILED';
      failure.cause = error;
      throw failure;
    } finally {
      if (audioContext && typeof audioContext.close === 'function') {
        await audioContext.close().catch(() => {});
      }
    }
  }

  /**
   * Confirms that a pipeline result is a real mono 16 kHz PCM WAV. The legacy
   * `wavBlob` alias may contain the untouched raw recording on fallback, so
   * callers must check both the result contract and the encoded header before
   * sending audio to a WAV-only assessment endpoint.
   */
  async function isValidMono16kWav(result) {
    const blob = result && result.outputBlob;
    const audioBuffer = result && result.audioBuffer;
    if (!blob
      || typeof blob.slice !== 'function'
      || typeof blob.size !== 'number'
      || typeof blob.arrayBuffer !== 'function'
      || blob.type !== 'audio/wav'
      || result.outputFormat !== 'wav'
      || result.outputMimeType !== 'audio/wav'
      || result.fallback === true) {
      return false;
    }

    try {
      const parsed = await parseMono16kPcmWav(blob);
      if (!parsed) return false;
      const sampleCount = parsed.sampleCount;
      if (Number.isInteger(result.sampleCount) && result.sampleCount !== sampleCount) return false;
      if (Number.isInteger(result.stats?.sampleCount) && result.stats.sampleCount !== sampleCount) return false;
      if (audioBuffer && (audioBuffer.sampleRate !== 16000
        || audioBuffer.numberOfChannels !== 1
        || audioBuffer.length !== sampleCount)) return false;
      return sampleCount > 0;
    } catch (_) {
      return false;
    }
  }
