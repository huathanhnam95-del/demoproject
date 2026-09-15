function defaultDsp(blob, options) {
  const enhance = globalThis.AudioDspPipeline?.enhance;
  return enhance ? enhance(blob, options) : Promise.resolve({ wavBlob: blob, audioBuffer: null, stats: null });
}

function defaultAudioContextFactory() {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  return typeof AudioContextCtor === 'function' ? () => new AudioContextCtor() : null;
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function chooseMime(MediaRecorderCtor) {
  if (!MediaRecorderCtor?.isTypeSupported) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorderCtor.isTypeSupported(type)) || '';
}

export function createAudioController({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderCtor = globalThis.MediaRecorder,
  dsp = defaultDsp,
  urlApi = globalThis.URL,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  audioContextFactory = defaultAudioContextFactory(),
  onChange = () => {},
  onElapsed = () => {},
  onMeter = () => {}
} = {}) {
  let state = { status: 'idle', questionId: null, error: null, elapsedMs: 0, elapsedLabel: '0:00', testUrl: null, result: null };
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let elapsedTimer = null;
  let meterTimer = null;
  let audioContext = null;
  let analyser = null;
  let analyserSource = null;
  let meterData = null;
  let cancelled = false;

  function emit(patch = {}) {
    state = { ...state, ...patch };
    onChange({ ...state });
    return state;
  }

  function releaseStream() {
    if (!stream?.getTracks) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function stopElapsedTimer() {
    if (elapsedTimer !== null) clearIntervalFn(elapsedTimer);
    elapsedTimer = null;
  }

  function stopMeter() {
    if (meterTimer !== null) clearIntervalFn(meterTimer);
    meterTimer = null;
    if (analyserSource?.disconnect) {
      try { analyserSource.disconnect(); } catch (_) {}
    }
    if (analyser?.disconnect) {
      try { analyser.disconnect(); } catch (_) {}
    }
    const context = audioContext;
    analyserSource = null;
    analyser = null;
    meterData = null;
    audioContext = null;
    if (context?.close) {
      try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
    }
  }

  function startMeter(activeStream) {
    if (typeof audioContextFactory !== 'function' || !activeStream) return;
    try {
      audioContext = audioContextFactory();
      analyserSource = audioContext?.createMediaStreamSource?.(activeStream) || null;
      analyser = audioContext?.createAnalyser?.() || null;
      if (!analyser || !analyserSource) { stopMeter(); return; }
      analyser.fftSize = 128;
      analyserSource.connect(analyser);
      meterData = new Uint8Array(analyser.fftSize || 128);
      meterTimer = setIntervalFn(() => {
        if (!analyser || !meterData) return;
        analyser.getByteTimeDomainData(meterData);
        let peak = 0;
        for (const sample of meterData) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        onMeter({ level: peak, samples: Array.from(meterData) });
      }, 33);
    } catch (_) {
      stopMeter();
    }
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    elapsedTimer = setIntervalFn(() => {
      const elapsedMs = Math.max(0, now() - startedAt);
      state = { ...state, elapsedMs, elapsedLabel: formatElapsed(elapsedMs) };
      onElapsed({ ...state });
    }, 250);
  }

  async function start(questionId = null) {
    if (state.status === 'requesting' || state.status === 'recording' || state.status === 'processing') throw new Error('A recording is already active');
    if (!mediaDevices?.getUserMedia || typeof MediaRecorderCtor !== 'function') {
      emit({ status: 'error', questionId, error: 'permission' });
      throw new Error('Microphone recording is not supported in this browser');
    }
    cancelled = false;
    emit({ status: 'requesting', questionId, error: null, elapsedMs: 0, elapsedLabel: '0:00' });
    try {
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (cancelled) { releaseStream(); emit({ status: 'idle' }); return null; }
      const mimeType = chooseMime(MediaRecorderCtor);
      recorder = mimeType ? new MediaRecorderCtor(stream, { mimeType }) : new MediaRecorderCtor(stream);
      chunks = [];
      recorder.addEventListener('dataavailable', (event) => { if (event.data?.size !== 0) chunks.push(event.data); });
      startedAt = now();
      recorder.start(250);
      startElapsedTimer();
      startMeter(stream);
      emit({ status: 'recording' });
      return state;
    } catch (error) {
      stopMeter();
      releaseStream();
      stopElapsedTimer();
      emit({ status: 'error', error: 'permission' });
      throw error;
    }
  }

  async function stop() {
    if (state.status !== 'recording' || !recorder) return null;
    emit({ status: 'processing', error: null });
    stopElapsedTimer();
    stopMeter();
    const activeRecorder = recorder;
    const durationMs = Math.max(0, now() - startedAt);
    releaseStream();
    const result = await new Promise((resolve, reject) => {
      activeRecorder.addEventListener('stop', async () => {
        try {
          const rawBlob = new Blob(chunks, { type: activeRecorder.mimeType || chunks[0]?.type || 'audio/webm' });
          const enhanced = await dsp(rawBlob, { targetSampleRate: 16000, createUrl: false });
          const blob = enhanced?.wavBlob || rawBlob;
          const exactDuration = Number(enhanced?.audioBuffer?.duration) > 0 ? Number(enhanced.audioBuffer.duration) * 1000 : durationMs;
          const url = urlApi?.createObjectURL ? urlApi.createObjectURL(blob) : null;
          resolve({ rawBlob, blob, url, durationMs: Math.round(exactDuration), mimeType: blob.type || 'audio/wav', stats: enhanced?.stats || null, audioBuffer: enhanced?.audioBuffer || null, questionId: state.questionId });
        } catch (error) { reject(error); }
      }, { once: true });
      try { activeRecorder.stop(); } catch (error) { reject(error); }
    }).catch((error) => {
      emit({ status: 'error', error: 'processing' });
      throw error;
    });
    recorder = null;
    chunks = [];
    if (cancelled) {
      if (result.url && urlApi?.revokeObjectURL) urlApi.revokeObjectURL(result.url);
      emit({ status: 'idle', result: null });
      return null;
    }
    emit({ status: 'saved', result, testUrl: result.url, elapsedMs: result.durationMs, elapsedLabel: formatElapsed(result.durationMs) });
    return result;
  }

  function cancel() {
    cancelled = true;
    stopElapsedTimer();
    stopMeter();
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
    recorder = null;
    chunks = [];
    releaseStream();
    emit({ status: 'idle', error: null, result: null });
  }

  function clearTestUrl() {
    if (state.testUrl && urlApi?.revokeObjectURL) urlApi.revokeObjectURL(state.testUrl);
    emit({ testUrl: null });
  }

  function destroy() { cancel(); clearTestUrl(); }

  return Object.freeze({ start, stop, cancel, destroy, clearTestUrl, getState: () => ({ ...state }) });
}

export { formatElapsed };
