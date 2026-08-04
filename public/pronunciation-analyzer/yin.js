/**
 * Minimal YIN pitch detector used by the local-analysis fallback.
 *
 * Keeping this implementation local is intentional: the pronunciation app
 * must boot when the browser cannot reach a third-party module CDN. The
 * server-side Praat path remains the production analysis authority.
 */
const DEFAULTS = {
    threshold: 0.1,
    probabilityThreshold: 0.1,
    sampleRate: 44100
};

export function YIN(options = {}) {
    const config = { ...DEFAULTS, ...options };

    return function detectPitch(audio) {
        if (!audio || audio.length < 4) return null;

        let bufferSize = 1;
        while (bufferSize * 2 <= audio.length) bufferSize *= 2;
        const bufferLength = Math.floor(bufferSize / 2);
        if (bufferLength < 3) return null;

        const yinBuffer = new Float32Array(bufferLength);
        for (let tau = 1; tau < bufferLength; tau += 1) {
            let difference = 0;
            for (let index = 0; index < bufferLength; index += 1) {
                const delta = audio[index] - audio[index + tau];
                difference += delta * delta;
            }
            yinBuffer[tau] = difference;
        }

        yinBuffer[0] = 1;
        yinBuffer[1] = 1;
        let runningSum = 0;
        for (let tau = 1; tau < bufferLength; tau += 1) {
            runningSum += yinBuffer[tau];
            yinBuffer[tau] = runningSum > 0
                ? yinBuffer[tau] * tau / runningSum
                : 1;
        }

        let tau = 2;
        while (tau < bufferLength && yinBuffer[tau] >= config.threshold) tau += 1;
        if (tau === bufferLength) return null;

        while (tau + 1 < bufferLength && yinBuffer[tau + 1] < yinBuffer[tau]) tau += 1;
        const probability = 1 - yinBuffer[tau];
        if (probability < config.probabilityThreshold) return null;

        const previous = yinBuffer[tau - 1];
        const current = yinBuffer[tau];
        const next = yinBuffer[Math.min(tau + 1, bufferLength - 1)];
        const denominator = 2 * (2 * current - next - previous);
        const refinedTau = denominator === 0
            ? tau
            : tau + (next - previous) / denominator;
        return refinedTau > 0 ? config.sampleRate / refinedTau : null;
    };
}
