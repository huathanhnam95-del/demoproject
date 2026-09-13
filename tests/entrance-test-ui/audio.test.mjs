import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioController } from '../../public/js/entrance-test-ui/audio.js';

class FakeTrack {
  constructor() { this.stopped = false; }
  stop() { this.stopped = true; }
}

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream) { this.stream = stream; this.mimeType = 'audio/webm'; this.state = 'inactive'; this.listeners = {}; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  emit(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.emit('dataavailable', { data: new Blob(['raw'], { type: this.mimeType }) }); this.emit('stop'); }
}

const urlApi = { createObjectURL: () => 'blob:demo-take', revokeObjectURL() {} };

test('audio controller enhances a completed recording and exposes lifecycle states', async () => {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track] };
  const states = [];
  const enhanceCalls = [];
  const controller = createAudioController({
    mediaDevices: { getUserMedia: async () => stream },
    MediaRecorderCtor: FakeMediaRecorder,
    dsp: async (blob, options) => { enhanceCalls.push({ blob, options }); return { wavBlob: new Blob(['wav'], { type: 'audio/wav' }), audioBuffer: { duration: 1.25 }, stats: { sampleRate: 16000 } }; },
    urlApi,
    onChange: (state) => states.push(state.status)
  });

  await controller.start('speaking_q1');
  assert.equal(controller.getState().status, 'recording');
  const result = await controller.stop();
  assert.equal(result.blob.type, 'audio/wav');
  assert.equal(result.durationMs, 1250);
  assert.equal(result.url, 'blob:demo-take');
  assert.equal(enhanceCalls[0].options.targetSampleRate, 16000);
  assert.deepEqual(states, ['requesting', 'recording', 'processing', 'saved']);
  assert.equal(track.stopped, true);
});

test('audio controller reports permission failure and can recover with a later attempt', async () => {
  let calls = 0;
  const controller = createAudioController({
    mediaDevices: { getUserMedia: async () => { calls += 1; throw new Error('denied'); } },
    MediaRecorderCtor: FakeMediaRecorder,
    onChange: () => {}
  });
  await assert.rejects(() => controller.start('speaking_q1'), /denied/);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error, 'permission');
  assert.equal(calls, 1);
});
