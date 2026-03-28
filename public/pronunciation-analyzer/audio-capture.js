export class AudioCapture {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        this.stream = null;
        this.isRecording = false;
        this._stopPromise = null;
    }

    async start() {
        try {
            // Resume AudioContext (required for iOS Safari)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            this.mediaRecorder = new MediaRecorder(this.stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            return true;
        } catch (error) {
            console.error("Error accessing microphone:", error);
            if (error.name === 'NotAllowedError') {
                throw new Error('Microphone permission denied. Please allow access.');
            }
            throw error;
        }
    }

    async blobToAudioBuffer(blob) {
        if (!blob) return null;
        const arrayBuffer = await blob.arrayBuffer();
        return this.audioContext.decodeAudioData(arrayBuffer);
    }

    /**
     * Stops recording and returns the raw audio blob (for backend analysis)
     */
    stopCapture() {
        if (this._stopPromise) {
            return this._stopPromise;
        }

        this._stopPromise = new Promise((resolve) => {
            const cleanup = () => {
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                }
                this.stream = null;
                this.mediaRecorder = null;
                this.isRecording = false;
                this._stopPromise = null;
            };

            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                const existingBlob = this.audioChunks.length > 0
                    ? new Blob(this.audioChunks, { type: 'audio/webm' })
                    : null;
                cleanup();
                resolve(existingBlob ? { blob: existingBlob } : null);
                return;
            }

            const recorder = this.mediaRecorder;
            recorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                cleanup();
                resolve({ blob: audioBlob });
            };

            try {
                recorder.stop();
            } catch (error) {
                cleanup();
                resolve(null);
            }
        });

        return this._stopPromise;
    }

    async stop() {
        const capture = await this.stopCapture();
        return capture ? this.blobToAudioBuffer(capture.blob) : null;
    }

    async stopAsBlob() {
        const capture = await this.stopCapture();
        return capture ? capture.blob : null;
    }

    cancel() {
        if (this.mediaRecorder && this.isRecording) {
            this.stopCapture().catch(() => {});
        }
    }
}
