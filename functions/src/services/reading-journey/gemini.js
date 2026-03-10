const { VertexAI } = require('@google-cloud/vertexai');
const { safeJsonParse, countWords, trimToMaxWords } = require('./json');

const DEFAULT_MODEL = 'gemini-1.5-pro';
const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-flash';
const ALLOWED_LEVELS = new Set(['A2', 'B1', 'B2', 'C1']);

const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;

const OPEN_PRODUCTION_PROMPT = 'In 1–2 sentences: summarize what happened, then say what you do next (investigate, ask, or wait) and why.';
const CANONICAL_CHOICE_IDS = Object.freeze(['investigate', 'ask', 'wait']);

const TOPIC_TAG_TAXONOMY = Object.freeze([
    'adventure', 'animals', 'art', 'community', 'cooking', 'creativity', 'culture', 'education', 'curiosity', 'environment', 'family', 'festival', 'food', 'friendship', 'games', 'health', 'hobbies', 'humor', 'language_learning', 'mystery', 'nature', 'problem_solving', 'school', 'science', 'space', 'sports', 'technology', 'teamwork', 'travel', 'weather', 'work', 'writing'
]);

function normalizeScalar(value) { return String(value ?? '').trim(); }
function normalizeLevel(level) {
    const value = normalizeScalar(level).toUpperCase();
    return ALLOWED_LEVELS.has(value) ? value : 'B1';
}

function getModelName() { return normalizeScalar(process.env.READING_JOURNEY_GEMINI_MODEL) || DEFAULT_MODEL; }
function getFallbackModelName() { return normalizeScalar(process.env.READING_JOURNEY_GEMINI_FALLBACK_MODEL) || DEFAULT_FALLBACK_MODEL; }

function getClient() {
    const project = normalizeScalar(process.env.FIREBASE_PROJECT_ID)
        || normalizeScalar(process.env.GCLOUD_PROJECT)
        || normalizeScalar(process.env.GCP_PROJECT)
        || normalizeScalar(process.env.GOOGLE_CLOUD_PROJECT);
    const location = normalizeScalar(process.env.GOOGLE_CLOUD_LOCATION) || 'us-central1';
    if (!project) throw new Error('Missing project ID for Vertex AI — set FIREBASE_PROJECT_ID or GCLOUD_PROJECT');
    return new VertexAI({ project, location });
}

let cachedClient = null;
const modelCacheByName = new Map();

function getCachedClient() {
    if (cachedClient) return cachedClient;
    cachedClient = getClient();
    return cachedClient;
}

function getModelForName(name) {
    const modelName = normalizeScalar(name) || DEFAULT_MODEL;
    const cached = modelCacheByName.get(modelName);
    if (cached) return cached;
    const client = getCachedClient();
    const model = client.getGenerativeModel({ model: modelName });
    modelCacheByName.set(modelName, model);
    return model;
}

let forceFallback = false;
let forceFallbackReason = '';

function shouldForceFallback(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('[429') || msg.includes('quota exceeded') || msg.includes('[404') || msg.includes('not found') || msg.includes('not supported');
}

function getEffectiveModelName() { return forceFallback ? getFallbackModelName() : getModelName(); }

function extractText(response) {
    if (typeof response.text === 'function') return response.text();
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts) && parts.length > 0) return parts.map(p => p.text || '').join('');
    throw new Error('No text found in Vertex AI response');
}

async function generateJson(prompt, { temperature = 0.7 } = {}) {
    const primaryModelName = getModelName();
    const fallbackModelName = getFallbackModelName();
    let activeModelName = forceFallback ? fallbackModelName : primaryModelName;
    let lastErr = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptTemp = attempt === 0 ? temperature : 0.2;
        const attemptPrompt = attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Return ONLY valid raw JSON.`;

        try {
            const model = getModelForName(activeModelName);
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: attemptPrompt }] }],
                generationConfig: { temperature: attemptTemp, responseMimeType: 'application/json' }
            });
            const response = await result.response;
            return safeJsonParse(extractText(response));
        } catch (e) {
            if (!forceFallback && activeModelName === primaryModelName && fallbackModelName && shouldForceFallback(e)) {
                forceFallback = true;
                forceFallbackReason = String(e?.message || e);
                activeModelName = fallbackModelName;
                attempt -= 1; continue;
            }
            lastErr = e;
        }
    }
    throw lastErr || new Error('Failed to generate JSON');
}

async function generateTopicTags({ keywords, level = 'B1', language = 'en' } = {}) {
    const keywordText = (Array.isArray(keywords) ? keywords : [keywords]).map(normalizeScalar).filter(Boolean).join(', ');
    const prompt = `Return raw JSON only. Task: pick 3 to 6 topic tags from [${TOPIC_TAG_TAXONOMY.join(', ')}] that best match "${keywordText}". JSON: { "topicTags": [] }`;
    const json = await generateJson(prompt, { temperature: 0.2 });
    const tags = (Array.isArray(json?.topicTags) ? json.topicTags : []).map(t => normalizeScalar(t).toLowerCase().replace(/\s+/g, '_')).filter(t => TOPIC_TAG_TAXONOMY.includes(t));
    return Array.from(new Set(tags)).slice(0, 6);
}

async function generateOutline({ keywords, topicTags, level = 'B1', language = 'en' } = {}) {
    const prompt = `Return raw JSON only. Design a 5-beat story outline for ${normalizeLevel(level)} English learners. Keywords: ${keywords}. Tags: ${topicTags}. Follow standard Reading Journey schema.`;
    const json = await generateJson(prompt, { temperature: 0.6 });
    return { formatVersion: 2, ...json };
}

async function generateBeat({ outline, beatNumber, path, questionType, storySoFar, level = 'B1', language = 'en' } = {}) {
    const prompt = `Return raw JSON only. Write beat ${beatNumber} for the story "${outline.title}". questionType: ${questionType}. Story so far: ${storySoFar}. Follow standard Reading Journey schema.`;
    const json = await generateJson(prompt, { temperature: 0.6 });
    return { formatVersion: 2, ...json };
}

async function assessStory({ storyText, level = 'B1' }) {
    const prompt = `Return raw JSON only. Assess this story for ${normalizeLevel(level)} learners: ${storyText.slice(0, 5000)}`;
    const json = await generateJson(prompt, { temperature: 0.2 });
    return { ...json, cefrFit: json.cefrFit || level };
}

module.exports = {
    TOPIC_TAG_TAXONOMY, normalizeLevel, getModelName, getFallbackModelName, getEffectiveModelName, getForceFallbackReason: () => forceFallbackReason, generateTopicTags, generateOutline, generateBeat, assessStory
};
