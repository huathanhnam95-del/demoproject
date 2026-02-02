export class AudioCapture {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        this.stream = null;
        this.isRecording = false;
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

    stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder) {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                this.stream.getTracks().forEach(track => track.stop());
                this.isRecording = false;

                resolve(audioBuffer);
            };

            this.mediaRecorder.stop();
        });
    }

    /**
     * Stops recording and returns the raw audio blob (for backend analysis)
     */
    stopAsBlob() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder) {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.stream.getTracks().forEach(track => track.stop());
                this.isRecording = false;
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
        });
    }

    cancel() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.stream.getTracks().forEach(track => track.stop());
            this.isRecording = false;
        }
    }
}
