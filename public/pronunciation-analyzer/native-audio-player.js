function hasFiniteSegment(startTime, endTime) {
    return Number.isFinite(startTime) &&
        Number.isFinite(endTime) &&
        endTime > startTime;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export class NativeAudioPlayer {
    constructor(audioContext, audioElement = null, fetchImpl = (input, init) => fetch(input, init)) {
        this.audioContext = audioContext;
        this.audioElement = audioElement;
        this.fetchImpl = fetchImpl;
        this.sourceUrl = null;
        this.audioBuffer = null;
        this.loadPromise = null;
        this.activeSource = null;
        this.elementStopTimeout = null;
    }

    setAudioElement(audioElement) {
        this.audioElement = audioElement;
    }

    clearSource() {
        this.stop();
        this.sourceUrl = null;
        this.audioBuffer = null;
        this.loadPromise = null;
    }

    async preload(url) {
        if (!url) {
            this.clearSource();
            return null;
        }

        if (this.sourceUrl === url && this.audioBuffer) {
            return this.audioBuffer;
        }

        if (this.sourceUrl === url && this.loadPromise) {
            return this.loadPromise;
        }

        this.sourceUrl = url;
        this.audioBuffer = null;

        const pendingLoad = (async () => {
            const response = await this.fetchImpl(url);
            if (!response.ok) {
                throw new Error(`Native audio request failed (${response.status})`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const decoded = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));

            if (this.sourceUrl === url) {
                this.audioBuffer = decoded;
            }

            return decoded;
        })();

        this.loadPromise = pendingLoad;

        try {
            return await pendingLoad;
        } finally {
            if (this.loadPromise === pendingLoad) {
                this.loadPromise = null;
            }
        }
    }

    async playSegment(url, startTime, endTime) {
        if (!url || !hasFiniteSegment(startTime, endTime)) {
            return false;
        }

        this.stop();

        try {
            const audioBuffer = await this.preload(url);
            await this.resumeContext();

            if (this.playBufferedSegment(audioBuffer, startTime, endTime)) {
                return true;
            }
        } catch (_error) {
            // Fall back to the visible audio element when buffer playback is unavailable.
        }

        return this.playElementSegment(url, startTime, endTime);
    }

    async resumeContext() {
        if (this.audioContext?.state === 'suspended' && typeof this.audioContext.resume === 'function') {
            await this.audioContext.resume();
        }
    }

    playBufferedSegment(audioBuffer, startTime, endTime) {
        if (!audioBuffer || typeof this.audioContext?.createBufferSource !== 'function') {
            return false;
        }

        const clippedStart = clamp(startTime, 0, audioBuffer.duration || endTime);
        const clippedEnd = clamp(endTime, clippedStart, audioBuffer.duration || endTime);
        const clippedDuration = clippedEnd - clippedStart;

        if (!(clippedDuration > 0)) {
            return false;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        if (typeof source.connect === 'function' && this.audioContext.destination) {
            source.connect(this.audioContext.destination);
        }

        source.onended = () => {
            if (this.activeSource === source) {
                this.activeSource = null;
            }
            if (typeof source.disconnect === 'function') {
                source.disconnect();
            }
        };

        this.activeSource = source;
        source.start(0, clippedStart, clippedDuration);
        return true;
    }

    playElementSegment(url, startTime, endTime) {
        if (!this.audioElement || !hasFiniteSegment(startTime, endTime)) {
            return false;
        }

        if (this.audioElement.src !== url) {
            this.audioElement.src = url;
        }

        this.audioElement.pause();
        this.audioElement.currentTime = startTime;

        const playResult = this.audioElement.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch(() => {});
        }

        this.elementStopTimeout = globalThis.setTimeout(() => {
            this.audioElement.pause();
            this.elementStopTimeout = null;
        }, (endTime - startTime) * 1000);

        return true;
    }

    stop() {
        if (this.activeSource) {
            try {
                this.activeSource.stop();
            } catch (_error) {
                // Ignore stop races from already-ended clips.
            }

            if (typeof this.activeSource.disconnect === 'function') {
                this.activeSource.disconnect();
            }

            this.activeSource = null;
        }

        if (this.elementStopTimeout) {
            globalThis.clearTimeout(this.elementStopTimeout);
            this.elementStopTimeout = null;
        }

        if (this.audioElement) {
            this.audioElement.pause();
        }
    }
}
