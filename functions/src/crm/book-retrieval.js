/* eslint-disable no-console */
const { embedQuery, cosineSimilarity } = require('./book-embeddings');
const { CRM_BOOKS } = require('./collections');

const DEFAULT_TOP_K = 8;
const MAX_CONTEXT_CHARS = 12000;

function getStrategy() {
    return (process.env.CRM_BOOKS_VECTOR_SEARCH || 'native').toLowerCase();
}

async function retrieveTopChunks(db, bookId, question, options = {}) {
    const topK = options.topK || DEFAULT_TOP_K;
    const maxContextChars = options.maxContextChars || MAX_CONTEXT_CHARS;
    const strategy = options.strategy || getStrategy();
    const bookTitle = options.bookTitle || '';

    const queryVector = await embedQuery(question, { title: bookTitle });
    const chunksCol = db.collection(CRM_BOOKS).doc(bookId).collection('chunks');

    let results;
    if (strategy === 'bruteforce') {
        results = await bruteforceSearch(chunksCol, queryVector, topK);
    } else {
        results = await nativeSearch(chunksCol, queryVector, topK);
    }

    const expanded = await expandNeighbours(chunksCol, results);
    return trimToContextLimit(expanded, maxContextChars);
}

async function nativeSearch(chunksCol, queryVector, topK) {
    const snap = await chunksCol
        .findNearest({
            vectorField: 'embedding',
            queryVector,
            limit: topK,
            distanceMeasure: 'COSINE',
            distanceResultField: '_distance'
        })
        .get();

    return snap.docs.map((doc) => {
        const data = doc.data();
        return {
            chunkId: doc.id,
            index: data.index,
            text: data.text,
            pageStart: data.pageStart,
            pageEnd: data.pageEnd,
            charCount: data.charCount,
            distance: data._distance ?? null,
            strategy: 'native'
        };
    });
}

async function bruteforceSearch(chunksCol, queryVector, topK) {
    const snap = await chunksCol.orderBy('index').get();
    const scored = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.embedding || !Array.isArray(data.embedding)) continue;
        const rawEmbed = typeof data.embedding.toArray === 'function'
            ? data.embedding.toArray()
            : data.embedding;
        const similarity = cosineSimilarity(queryVector, rawEmbed);
        scored.push({
            chunkId: doc.id,
            index: data.index,
            text: data.text,
            pageStart: data.pageStart,
            pageEnd: data.pageEnd,
            charCount: data.charCount,
            distance: 1 - similarity,
            strategy: 'bruteforce'
        });
    }

    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, topK);
}

async function expandNeighbours(chunksCol, results) {
    if (results.length === 0) return results;

    const existingIndices = new Set(results.map((r) => r.index));
    const neighbourIndices = new Set();

    for (const r of results) {
        if (r.index > 0 && !existingIndices.has(r.index - 1)) {
            neighbourIndices.add(r.index - 1);
        }
        if (!existingIndices.has(r.index + 1)) {
            neighbourIndices.add(r.index + 1);
        }
    }

    if (neighbourIndices.size === 0) return results;

    const indexArray = [...neighbourIndices];
    const expanded = [...results];

    for (let i = 0; i < indexArray.length; i += 10) {
        const batch = indexArray.slice(i, i + 10);
        const snap = await chunksCol.where('index', 'in', batch).get();
        for (const doc of snap.docs) {
            const data = doc.data();
            expanded.push({
                chunkId: doc.id,
                index: data.index,
                text: data.text,
                pageStart: data.pageStart,
                pageEnd: data.pageEnd,
                charCount: data.charCount,
                distance: null,
                strategy: 'neighbour'
            });
        }
    }

    expanded.sort((a, b) => a.index - b.index);

    const seen = new Set();
    return expanded.filter((r) => {
        if (seen.has(r.chunkId)) return false;
        seen.add(r.chunkId);
        return true;
    });
}

function trimToContextLimit(chunks, maxChars) {
    let total = 0;
    const result = [];
    for (const chunk of chunks) {
        if (total + chunk.charCount > maxChars) break;
        result.push(chunk);
        total += chunk.charCount;
    }
    return result;
}

module.exports = {
    retrieveTopChunks,
    nativeSearch,
    bruteforceSearch,
    expandNeighbours,
    trimToContextLimit,
    DEFAULT_TOP_K,
    MAX_CONTEXT_CHARS
};
