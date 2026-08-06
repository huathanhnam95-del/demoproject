/* eslint-disable no-console */
const { getGenAiClient } = require('../geminiVertexModels');

const DEFAULT_EMBED_MODEL = 'gemini-embedding-001';
const DEFAULT_EMBED_DIM = 768;
const DEFAULT_EMBED_BATCH = 16;
const DEFAULT_SINGLE_CONCURRENCY = 5;

function getConfig() {
    return {
        model: process.env.CRM_BOOKS_EMBED_MODEL || DEFAULT_EMBED_MODEL,
        dimensions: Number(process.env.CRM_BOOKS_EMBED_DIM) || DEFAULT_EMBED_DIM,
        batchSize: Number(process.env.CRM_BOOKS_EMBED_BATCH) || DEFAULT_EMBED_BATCH,
        location: process.env.CRM_BOOKS_VERTEX_LOCATION || 'global'
    };
}

function l2Normalize(vector) {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vector;
    const result = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        result[i] = vector[i] / norm;
    }
    return result;
}

function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

let forceSingleMode = false;

async function embedTexts(texts, options = {}) {
    const cfg = getConfig();
    const model = options.model || cfg.model;
    const dimensions = options.dimensions || cfg.dimensions;
    const taskType = options.taskType || 'RETRIEVAL_DOCUMENT';
    const title = options.title || undefined;
    const client = getGenAiClient(cfg.location);

    if (forceSingleMode || texts.length === 1) {
        return embedSingle(client, texts, { model, dimensions, taskType, title });
    }

    try {
        const res = await client.models.embedContent({
            model,
            contents: texts.map((t) => ({ parts: [{ text: t }] })),
            config: { taskType, outputDimensionality: dimensions, title }
        });
        const embeddings = (res.embeddings || []).map((e) => l2Normalize(e.values.slice(0, dimensions)));
        return embeddings;
    } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('INVALID_ARGUMENT') || msg.includes('instances')) {
            console.log('[book-embeddings] Batch rejected, switching to single-item mode');
            forceSingleMode = true;
            return embedSingle(client, texts, { model, dimensions, taskType, title });
        }
        throw err;
    }
}

async function embedSingle(client, texts, { model, dimensions, taskType, title }) {
    const results = [];
    const concurrency = DEFAULT_SINGLE_CONCURRENCY;

    for (let i = 0; i < texts.length; i += concurrency) {
        const batch = texts.slice(i, i + concurrency);
        const promises = batch.map(async (text) => {
            const res = await client.models.embedContent({
                model,
                contents: [{ parts: [{ text }] }],
                config: { taskType, outputDimensionality: dimensions, title }
            });
            return l2Normalize(res.embeddings[0].values.slice(0, dimensions));
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
    }

    return results;
}

async function embedQuery(text, options = {}) {
    const result = await embedTexts([text], {
        ...options,
        taskType: 'RETRIEVAL_QUERY'
    });
    return result[0];
}

module.exports = {
    embedTexts,
    embedQuery,
    l2Normalize,
    cosineSimilarity,
    getConfig,
    DEFAULT_EMBED_MODEL,
    DEFAULT_EMBED_DIM,
    DEFAULT_EMBED_BATCH
};
