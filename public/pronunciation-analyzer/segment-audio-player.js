/**
 * SegmentAudioPlayer
 * Plays strictly bounded PCM clips via Web Audio AudioBufferSourceNode.
 * Guarantees zero neighbour sample bleed without timer polling or early pause hacks.
 */

export class SegmentAudioPlayer {
  constructor(audioContext, onState = () => {}) {
    this.context = audioContext;
    this.onState = onState;
    this.source = null;
    this.resolveCompletion = null;
    this.token = 0;
    this.disposed = false;
  }

  notify(event) {
    try {
      this.onState(event);
    } catch (_) {
      // UI cannot break audio lifecycle
    }
  }

  stop() {
    this.token += 1;
    const old = this.source;
    this.source = null;
    const complete = this.resolveCompletion;
    this.resolveCompletion = null;
    if (old) {
      old.onended = null;
      try {
        old.stop();
      } catch (_) {
        // already stopped
      }
      try {
        old.disconnect();
      } catch (_) {
        // already disconnected
      }
    }
    complete?.({ state: 'cancelled' });
    this.notify({ state: 'stopped' });
  }

  async play({ buffer, span, clipId = null, expectedAudioHash = null }) {
    if (this.disposed) throw new Error('PLAYER_DISPOSED');
    if (!buffer) throw new Error('AUDIO_BUFFER_REQUIRED');

    const start = span?.startSample;
    const end = span?.endSample;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end <= start || end > buffer.length) {
      throw new Error('INVALID_CLIP_SPAN');
    }

    this.stop();
    const ticket = this.token;

    if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
      try {
        await this.context.resume();
      } catch (_) {
        // Ignore resume error
      }
    }

    if (this.disposed || ticket !== this.token) {
      return { started: false, ended: Promise.resolve({ state: 'cancelled' }) };
    }

    // Allocate exact buffer for the slice
    const clipLength = end - start;
    const clip = this.context.createBuffer(1, clipLength, buffer.sampleRate);
    clip.copyToChannel(buffer.getChannelData(0).subarray(start, end), 0);

    const source = this.context.createBufferSource();
    source.buffer = clip;
    source.playbackRate.value = 1.0;
    source.connect(this.context.destination);
    this.source = source;

    const ended = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });

    source.onended = () => {
      if (this.source !== source) return;
      try {
        source.disconnect();
      } catch (_) {}
      this.source = null;
      const complete = this.resolveCompletion;
      this.resolveCompletion = null;
      complete?.({ state: 'ended', clipId });
      this.notify({ state: 'ended', clipId });
    };

    try {
      source.start();
    } catch (err) {
      source.onended = null;
      try {
        source.disconnect();
      } catch (_) {}
      if (this.source === source) this.source = null;
      this.resolveCompletion?.({ state: 'failed', clipId });
      this.resolveCompletion = null;
      throw err;
    }

    this.notify({ state: 'playing', clipId });
    return { started: true, ended };
  }

  dispose() {
    this.stop();
    this.disposed = true;
  }
}

if (typeof window !== 'undefined') {
  window.SegmentAudioPlayer = SegmentAudioPlayer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SegmentAudioPlayer };
}
