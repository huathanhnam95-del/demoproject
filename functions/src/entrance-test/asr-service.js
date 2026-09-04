const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getHuggingFaceApiKey() {
    if (process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY.trim()) {
        return process.env.HUGGINGFACE_API_KEY.trim();
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
                    if (trimmed.startsWith('HUGGINGFACE_API_KEY=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val) return val;
                    }
                }
            }
        } catch (e) {}
    }
    return null;
}

function getGeminiApiKeys() {
    const keys = [];
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        keys.push(process.env.GEMINI_API_KEY.trim());
    }
    if (process.env.GEMINI_API_KEY_BACKUP && process.env.GEMINI_API_KEY_BACKUP.trim()) {
        keys.push(process.env.GEMINI_API_KEY_BACKUP.trim());
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
                        if (val && !keys.includes(val)) keys.push(val);
                    } else if (trimmed.startsWith('GEMINI_API_KEY_BACKUP=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val && !keys.includes(val)) keys.push(val);
                    }
                }
            }
        } catch (e) {}
    }
    return keys.filter((k, i, self) => self.indexOf(k) === i);
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
 * and filter out hallucinated Vietnamese words from English tests.
 */
function cleanHallucinatedLoops(text, options = {}) {
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

    // For English tests, strip any words containing Vietnamese tone/diacritical marks
    const stripVietnamese = options.stripVietnamese !== false;
    if (stripVietnamese) {
        const vietnameseWordPattern = /(?:^|\s+)[\p{L}]*[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+[\p{L}]*(?=\s+|$)/giu;
        cleaned = cleaned.replace(vietnameseWordPattern, ' ');
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
    const apiKeys = getGeminiApiKeys();
    if (apiKeys.length === 0) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('Audio buffer is empty or invalid.');
    }

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

    for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx += 1) {
        const apiKey = apiKeys[keyIdx];
        const genAI = new GoogleGenerativeAI(apiKey.trim());

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
                const errMsg = err?.message || String(err);
                console.warn(`[EntranceTest ASR] Key #${keyIdx + 1} with model ${modelName} failed:`, errMsg);

                // If error is auth or quota exhaustion, jump immediately to the backup key
                const isKeyFailure = /API_KEY_INVALID|API key not valid|RESOURCE_EXHAUSTED|429|403|400|quota/i.test(errMsg);
                if (isKeyFailure && keyIdx < apiKeys.length - 1) {
                    console.warn(`[EntranceTest ASR] API key #${keyIdx + 1} encountered auth/quota error. Failing over to backup key #${keyIdx + 2}...`);
                    break;
                }
            }
        }
    }

    // Safety Net: If all Gemini keys and models failed, invoke hardened Hugging Face Whisper
    console.warn('[EntranceTest ASR] All Gemini keys/models exhausted. Falling back to hardened Hugging Face safety net...');
    try {
        const hfTranscript = await transcribeWithHuggingFace(audioBuffer, contentType);
        if (hfTranscript) {
            console.log('[EntranceTest ASR] Transcribed successfully using Hugging Face safety net.');
            return hfTranscript;
        }
    } catch (hfErr) {
        console.warn('[EntranceTest ASR] Hugging Face safety net failed:', hfErr?.message || hfErr);
    }

    throw lastError || new Error('All ASR providers (Gemini and Hugging Face) failed to transcribe audio.');
}

/**
 * Hardened Hugging Face Whisper ASR safety net fallback.
 * Sends audio to Whisper Large V3, then routes output through cleanHallucinatedLoops.
 *
 * @param {Buffer} audioBuffer - Binary audio buffer
 * @param {string} contentType - Audio MIME type
 * @returns {Promise<string>} Cleaned transcript
 */
async function transcribeWithHuggingFace(audioBuffer, contentType) {
    const hfKey = getHuggingFaceApiKey();
    if (!hfKey) {
        throw new Error('HUGGINGFACE_API_KEY is not configured on the server.');
    }

    const model = process.env.HUGGINGFACE_ASR_MODEL || 'openai/whisper-large-v3';
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;
    const base64Data = audioBuffer.toString('base64');

    let rawText = '';

    // Primary request: Force English language decoding via generate_kwargs
    try {
        const jsonRes = await axios({
            method: 'POST',
            url,
            headers: {
                Authorization: `Bearer ${hfKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new https.Agent({ family: 4 }),
            data: {
                inputs: base64Data,
                parameters: {
                    generate_kwargs: {
                        language: 'english'
                    }
                }
            },
            timeout: 45000,
            validateStatus: () => true
        });

        if (jsonRes.status === 200 && jsonRes.data && typeof jsonRes.data.text === 'string') {
            rawText = jsonRes.data.text;
        }
    } catch (jsonErr) {
        console.warn('[EntranceTest ASR] Hugging Face JSON language=english request failed, attempting binary fallback:', jsonErr?.message || jsonErr);
    }

    // Secondary fallback: send binary audio if JSON payload is unsupported
    if (!rawText) {
        const asrContentType = resolveGeminiAudioMimeType(contentType) || 'application/octet-stream';
        const binaryRes = await axios({
            method: 'POST',
            url,
            headers: {
                Authorization: `Bearer ${hfKey}`,
                Accept: 'application/json',
                'Content-Type': asrContentType,
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new https.Agent({ family: 4 }),
            data: audioBuffer,
            timeout: 45000,
            validateStatus: () => true
        });

        if (binaryRes.status !== 200 || !binaryRes.data || typeof binaryRes.data.text !== 'string') {
            const errMsg = binaryRes.data?.error || `Hugging Face ASR failed with status ${binaryRes.status}`;
            throw new Error(String(errMsg));
        }

        rawText = binaryRes.data.text || '';
    }

    const cleaned = cleanHallucinatedLoops(rawText, { stripVietnamese: true });
    return cleaned;
}

module.exports = {
    transcribeAudio,
    transcribeWithHuggingFace,
    cleanHallucinatedLoops,
    resolveGeminiAudioMimeType,
    getGeminiApiKeys,
    getHuggingFaceApiKey
};

