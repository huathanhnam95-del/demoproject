export class CaptureSession extends EventTarget {
  constructor() { super(); this.stream = null; this.recorder = null; this.chunks = []; this.bytes = 0; this.timer = null; this.elapsedMs = 0; this.finishing = false; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get recording() { return this.recorder?.state === 'recording'; }
  async enable(kind, cameraId, micId) {
    this.disable();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Use Chrome at the local studio URL to enable capture.');
    const audio = kind === 'photo' ? false : { deviceId: micId ? { exact: micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const video = kind === 'audio' ? false : { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 25 } };
    const generation = this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return null; }
      this.stream = stream;
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { this.emit('interrupted', 'A capture device disconnected. Review the partial take.'); if (this.recording) this.stop(); }));
      return stream;
    } catch (error) {
      const labels = { NotAllowedError: 'Camera or microphone permission was denied. Allow access in Chrome’s site controls, then try again.', NotFoundError: 'No matching camera or microphone was found. Connect it and refresh devices.', NotReadableError: 'The device is busy or unavailable. Close other camera apps and try again.', OverconstrainedError: 'The selected device is unavailable. Choose another device.' };
      throw new Error(labels[error.name] || error.message);
    }
  }
  settings() { return Object.fromEntries((this.stream?.getTracks() || []).map(track => { const { width, height, frameRate, sampleRate, channelCount, echoCancellation, noiseSuppression, autoGainControl } = track.getSettings(); return [track.kind, { width, height, frameRate, sampleRate, channelCount, echoCancellation, noiseSuppression, autoGainControl }]; })); }
  record(kind) {
    if (!this.stream?.active) throw new Error('Enable your capture devices first.');
    if (this.recording) throw new Error('A recording is already running.');
    const types = kind === 'video' ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This Chrome installation has no supported recording codec. You can still import media.');
    this.chunks = []; this.bytes = 0; this.elapsedMs = 0; this.finishing = false; this.started = performance.now(); this.recordingSettings = this.settings();
    this.recorder = new MediaRecorder(this.stream, { mimeType, ...(kind === 'video' ? { videoBitsPerSecond: 4000000, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 }) });
    this.recorder.addEventListener('dataavailable', event => { if (event.data.size) { this.chunks.push(event.data); this.bytes += event.data.size; } if (this.bytes >= 128 * 1024 * 1024 && this.recording) { this.emit('limit', '128 MiB capture limit reached. Review and save this take.'); this.stop(); } });
    this.recorder.addEventListener('error', event => { this.emit('interrupted', event.error?.message || 'Recording was interrupted.'); if (this.recording) this.stop(); });
    this.recorder.addEventListener('stop', () => { clearInterval(this.timer); this.elapsedMs = performance.now() - this.started; const blob = new Blob(this.chunks, { type: this.recorder.mimeType }); this.finishing = false; this.emit('complete', { blob, durationMs: this.elapsedMs, settings: this.recordingSettings }); this.chunks = []; });
    this.recorder.start(1000);
    this.timer = setInterval(() => { this.elapsedMs = performance.now() - this.started; this.emit('tick', this.elapsedMs); if (this.elapsedMs >= 180000) { this.emit('limit', 'Three-minute limit reached. Review and save this take.'); this.stop(); } }, 200);
  }
  stop() { if (this.recording) { this.finishing = true; this.recorder.stop(); } clearInterval(this.timer); }
  async photo(video) {
    if (!video.videoWidth || !video.videoHeight) throw new Error('Wait for the camera preview before taking a photo.');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0); // CSS mirroring of the preview never changes this original frame.
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Photo capture failed.');
    return { blob, durationMs: 0, settings: { ...this.settings(), image: { width: canvas.width, height: canvas.height } } };
  }
  disable() { this.generation = (this.generation || 0) + 1; this.stop(); if (this.stream) this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
}
