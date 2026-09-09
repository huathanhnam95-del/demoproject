/* global sampleRate */
'use strict';
class CrmVoicePcmCapture extends AudioWorkletProcessor {
    constructor() {
        super(); this.ratio = sampleRate / 16000; this.weight = 0; this.sum = 0; this.buffer = new Int16Array(320); this.offset = 0; this.stopped = false;
        this.port.onmessage = event => {
            const message = event.data;
            if (this.stopped || !message || message.type !== 'flush-and-stop' || typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 128) return;
            this.stopped = true;
            // Finish the final fractional sample from captured input only; do
            // not append silence. Duration is quantized upward by at most 1/16k.
            if (this.weight > 1e-8) {
                const value = Math.max(-1, Math.min(1, this.sum / this.weight));
                this.buffer[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
            }
            const pcm = this.buffer.slice(0, this.offset).buffer;
            this.offset = 0; this.weight = 0; this.sum = 0; this.buffer.fill(0);
            this.port.postMessage({ type: 'flushed', requestId: message.requestId, pcm }, [pcm]);
        };
    }
    process(inputs) {
        if (this.stopped) return false;
        const channel = inputs[0]?.[0]; if (!channel) return true;
        // Integrate across fractional source-sample boundaries, preserving
        // continuity between worklet quanta and emitting exactly 16k PCM.
        for (const sample of channel) {
            let remaining = 1;
            while (remaining > 1e-8) {
                const take = Math.min(remaining, this.ratio - this.weight); this.sum += sample * take; this.weight += take; remaining -= take;
                if (this.weight >= this.ratio - 1e-8) {
                    const value = Math.max(-1, Math.min(1, this.sum / this.ratio)); this.buffer[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767)); this.weight = 0; this.sum = 0;
                    if (this.offset === this.buffer.length) { this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]); this.buffer = new Int16Array(320); this.offset = 0; }
                }
            }
        }
        return true;
    }
}
registerProcessor('crm-voice-pcm-capture', CrmVoicePcmCapture);
