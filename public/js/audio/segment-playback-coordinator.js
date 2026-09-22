/**
 * Segment Playback Coordinator
 * Coordinates mutual exclusion across media elements, waveforms, and bounded segment players.
 * Implements a memory-limited LRU AudioBuffer cache (max 3 items, 32 MiB budget) with active-playback pinning.
 */

export const MAX_CACHED_RECORDINGS = 3;
export const MAX_CACHE_BYTES = 32 * 1024 * 1024; // 32 MiB

export class LruAudioBufferCache {
  constructor({ maxEntries = MAX_CACHED_RECORDINGS, maxBytes = MAX_CACHE_BYTES } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.cache = new Map(); // key -> { buffer, byteSize, lastAccessed, pinned }
    this.currentBytes = 0;
    this.counter = 0;
  }

  computeByteSize(buffer) {
    if (!buffer) return 0;
    // Web Audio buffers use Float32Array (4 bytes per sample per channel)
    return buffer.numberOfChannels * buffer.length * 4;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccessed = ++this.counter;
      return entry.buffer;
    }
    return null;
  }

  set(key, buffer) {
    if (!key || !buffer) return;
    const byteSize = this.computeByteSize(buffer);
    if (byteSize > this.maxBytes) return;

    let wasPinned = false;
    // If already present, remove old size first and preserve pin state
    if (this.cache.has(key)) {
      const existing = this.cache.get(key);
      wasPinned = Boolean(existing.pinned);
      this.currentBytes -= existing.byteSize;
      this.cache.delete(key);
    }

    // Evict if needed before adding
    this.evict(byteSize);

    this.cache.set(key, {
      buffer,
      byteSize,
      lastAccessed: ++this.counter,
      pinned: wasPinned
    });
    this.currentBytes += byteSize;
  }

  pin(key, isPinned = true) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.pinned = Boolean(isPinned);
    }
  }

  evict(neededBytes = 0) {
    while (
      (this.cache.size >= this.maxEntries || (this.currentBytes + neededBytes > this.maxBytes)) &&
      this.cache.size > 0
    ) {
      // Find oldest non-pinned entry
      let oldestKey = null;
      let oldestTime = Number.POSITIVE_INFINITY;

      for (const [k, entry] of this.cache.entries()) {
        if (!entry.pinned && entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestKey = k;
        }
      }

      if (!oldestKey) {
        // All entries are pinned; cannot evict
        break;
      }

      const entry = this.cache.get(oldestKey);
      this.currentBytes -= entry.byteSize;
      this.cache.delete(oldestKey);
    }
  }

  clear() {
    this.cache.clear();
    this.currentBytes = 0;
  }
}

export class SegmentPlaybackCoordinator {
  constructor() {
    this.audioContext = null;
    this.cache = new LruAudioBufferCache();
    this.registeredPlayers = new Set();
    this.activeToken = 0;
    this.currentPlaybackKey = null;
    this.activeSourceNode = null;
  }

  getAudioContext() {
    if (!this.audioContext) {
      const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
      }
    }
    return this.audioContext;
  }

  /**
   * Unlock AudioContext inside a synchronous user interaction.
   */
  unlockUserGesture() {
    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
  }

  registerPlayer(player) {
    if (player && typeof player.stop === 'function') {
      this.registeredPlayers.add(player);
    }
  }

  unregisterPlayer(player) {
    this.registeredPlayers.delete(player);
  }

  /**
   * Stops all active audio elements and registered players.
   */
  stopAll() {
    this.activeToken += 1;

    // Unpin currently active playback in cache
    if (this.currentPlaybackKey) {
      this.cache.pin(this.currentPlaybackKey, false);
      this.currentPlaybackKey = null;
    }

    // Stop native source node if active
    if (this.activeSourceNode) {
      try {
        this.activeSourceNode.onended = null;
        this.activeSourceNode.stop();
        this.activeSourceNode.disconnect();
      } catch (_) {}
      this.activeSourceNode = null;
    }

    // Stop all registered players (e.g. WaveSurfer, HTML audio, segment players)
    for (const p of this.registeredPlayers) {
      try {
        p.stop();
      } catch (_) {}
    }

    // Pause all global HTMLAudioElements in DOM if window/document exists
    if (typeof document !== 'undefined') {
      const mediaEls = document.querySelectorAll('audio, video');
      mediaEls.forEach(el => {
        try {
          if (!el.paused) el.pause();
        } catch (_) {}
      });
    }
  }

  /**
   * Retrieves or decodes an AudioBuffer for a given URL, utilizing the LRU cache.
   */
  async getDecodedBuffer(audioUrl) {
    if (!audioUrl) return null;

    const cached = this.cache.get(audioUrl);
    if (cached) return cached;

    const ctx = this.getAudioContext();
    if (!ctx) return null;

    try {
      const response = await fetch(audioUrl);
      const arrayBuf = await response.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      this.cache.set(audioUrl, decoded);
      return decoded;
    } catch (err) {
      console.warn('[PlaybackCoordinator] Error decoding audio:', audioUrl, err);
      return null;
    }
  }

  /**
   * Plays a bounded slice of an audio URL with mutual exclusion.
   */
  async playSegment({ audioUrl, startMs, endMs, onEnded = null }) {
    this.unlockUserGesture();
    this.stopAll();

    const ticket = this.activeToken;
    const buffer = await this.getDecodedBuffer(audioUrl);
    if (!buffer || ticket !== this.activeToken) return false;

    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startMs * sampleRate / 1000));
    const endSample = Math.min(buffer.length, Math.ceil(endMs * sampleRate / 1000));

    if (endSample <= startSample) return false;

    const ctx = this.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (_) {}
    }
    if (ticket !== this.activeToken) return false;

    // Pin cache entry while playing
    this.currentPlaybackKey = audioUrl;
    this.cache.pin(audioUrl, true);

    // Create bounded clip
    const clipLength = endSample - startSample;
    const clip = ctx.createBuffer(buffer.numberOfChannels, clipLength, sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      clip.copyToChannel(buffer.getChannelData(c).subarray(startSample, endSample), c);
    }

    const source = ctx.createBufferSource();
    source.buffer = clip;
    source.connect(ctx.destination);
    this.activeSourceNode = source;

    source.onended = () => {
      if (this.activeToken === ticket) {
        this.cache.pin(audioUrl, false);
        this.currentPlaybackKey = null;
        this.activeSourceNode = null;
        if (typeof onEnded === 'function') onEnded();
      }
    };

    try {
      source.start();
      return true;
    } catch (err) {
      this.cache.pin(audioUrl, false);
      this.currentPlaybackKey = null;
      this.activeSourceNode = null;
      return false;
    }
  }
}

export const defaultCoordinator = new SegmentPlaybackCoordinator();

if (typeof window !== 'undefined') {
  window.SegmentPlaybackCoordinator = {
    SegmentPlaybackCoordinator,
    LruAudioBufferCache,
    defaultCoordinator,
    MAX_CACHED_RECORDINGS,
    MAX_CACHE_BYTES
  };
}
