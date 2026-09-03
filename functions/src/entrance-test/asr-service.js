const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiApiKey() {
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        return process.env.GEMINI_API_KEY.trim();
    }
    const candidates = [
        path.resolve(__dirname, '..', '..', '.env'),
        path.resolve(__dirname, '..', '..', '..', '.env')
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const content = fs.readFileSync(p, 'utf8');
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('GEMINI_API_KEY=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val) return val;
                    }
                }
            }
        } catch (e) {}
    }
    return null;
}

/**
 * Normalizes audio content type to standard MIME type accepted by Gemini.
 */
function resolveGeminiAudioMimeType(contentType) {
    const raw = String(contentType || '').toLowerCase();
    if (raw.includes('webm')) return 'audio/webm';
    if (raw.includes('mp4') || raw.includes('m4a') || raw.includes('aac')) return 'audio/mp4';
    if (raw.includes('wav')) return 'audio/wav';
    if (raw.includes('ogg') || raw.includes('opus')) return 'audio/ogg';
    if (raw.includes('mp3') || raw.includes('mpeg')) return 'audio/mp3';
    return 'audio/webm';
}

/**
 * Defensive post-processor to collapse repetitive hallucination loops
 * (e.g. "Yeah Yeah Yeah..." or "Các bác sĩ, các bác sĩ...")
 */
function cleanHallucinatedLoops(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();

    // Remove markdown fences or surrounding quotes if model added them
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    let prev = '';
    let iterations = 0;
    while (prev !== cleaned && iterations < 5) {
        prev = cleaned;
        iterations += 1;
        // Collapse multi-word phrase repetitions (1 to 5 words repeating)
        cleaned = cleaned.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+(?:[\s,]+[\p{L}\p{N}]+){1,4})(?:[\s,]+\1)+(?![\p{L}\p{N}])/giu, '$1');
        // Collapse single-word rapid repetitions
        cleaned = cleaned.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:[\s,]+\1)+(?![\p{L}\p{N}])/giu, '$1');
    }

    // Normalize whitespace
    return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Transcribe entrance test audio using Gemini Multimodal Audio
 * with multi-model fallback and silence loop protection.
 *
 * @param {Buffer} audioBuffer - Binary audio buffer
 * @param {string} contentType - Audio MIME type (e.g. 'audio/webm; codecs=opus')
 * @param {Object} [options]
 * @param {string} [options.expectedText] - Optional reference reading text
 * @param {number} [options.timeoutMs=35000] - Timeout per model attempt
 * @returns {Promise<string>} Cleaned English transcript
 */
async function transcribeAudio(audioBuffer, contentType, options = {}) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('Audio buffer is empty or invalid.');
    }

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const mimeType = resolveGeminiAudioMimeType(contentType);
    const base64Data = audioBuffer.toString('base64');
    const timeoutMs = options.timeoutMs || 15000;

    const primaryModel = process.env.ENTRANCE_TEST_ASR_MODEL || 'gemini-3.8-flash';
    const candidateModels = [
        primaryModel,
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.5-transcribe'
    ].filter((val, idx, self) => self.indexOf(val) === idx);

    const expectedText = options.expectedText ? String(options.expectedText).trim() : '';
    const prompt = expectedText
        ? `You are an accurate English speech-to-text transcriber for an English proficiency entrance test.\nThe candidate was asked to read the following reference passage:\n"${expectedText}"\n\nListen to the audio and transcribe what the candidate actually spoke in English verbatim.\n- Transcribe their actual spoken English words, reflecting their spoken speech even if words were omitted, mispronounced, or substituted.\n- Do NOT hallucinate words or repeat loops during silent intervals or pauses.\n- Output ONLY the plain transcription text with no commentary, no markdown code blocks, and no quotation marks.`
        : `You are an accurate English speech-to-text transcriber. Listen to the audio and transcribe what the candidate spoke in English verbatim. Do NOT hallucinate words or repeat loops during silence. Output ONLY the plain transcription text with no commentary, no markdown code blocks, and no quotation marks.`;

    let lastError = null;

    for (const modelName of candidateModels) {
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    temperature: 0.0
                }
            });

            const generatePromise = model.generateContent([
                {
                    inlineData: {
                        mimeType,
                        data: base64Data
                    }
                },
                prompt
            ]);

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`ASR timeout after ${timeoutMs}ms for ${modelName}`)), timeoutMs);
            });

            const res = await Promise.race([generatePromise, timeoutPromise]);
            const rawText = res?.response?.text() || '';
            const cleaned = cleanHallucinatedLoops(rawText);

            if (cleaned) {
                return cleaned;
            }
        } catch (err) {
            lastError = err;
            console.warn(`[EntranceTest ASR] Model ${modelName} attempt failed:`, err?.message || err);
        }
    }

    throw lastError || new Error('All Gemini ASR models failed to transcribe audio.');
}

module.exports = {
    transcribeAudio,
    cleanHallucinatedLoops,
    resolveGeminiAudioMimeType
};
