/* eslint-disable no-console */
const { FieldValue } = require('firebase-admin/firestore');
const {
    getGeminiModel,
    normalizeScalar,
    shouldUseGeminiFallback
} = require('../geminiVertexModels');
const {
    extractJsonObject,
    extractGeneratedText,
    truncateForLog
} = require('../assessWriting.helpers');
const { retrieveTopChunks } = require('./book-retrieval');
const { CRM_BOOKS } = require('./collections');
const { recordUsage, checkBudget } = require('./book-usage-tracker');

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const MAX_HISTORY_MESSAGES = 6;
const ROLLING_SUMMARY_INTERVAL = 10;
const MAX_DAILY_CHATS = 200;
const SNIPPET_LENGTH = 200;

function getModels() {
    const primary = normalizeScalar(process.env.CRM_BOOKS_GEMINI_MODEL) || DEFAULT_MODEL;
    const fallback = normalizeScalar(process.env.CRM_BOOKS_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
    const location = normalizeScalar(process.env.CRM_BOOKS_VERTEX_LOCATION) || 'global';
    return {
        primary: getGeminiModel({
            modelName: primary,
            location,
            generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        }),
        fallback: getGeminiModel({
            modelName: fallback,
            location,
            generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        }),
        primaryName: primary,
        fallbackName: fallback
    };
}

function buildChatPrompt(question, chunks, history, rollingSummary, bookTitle) {
    const excerpts = chunks.map((c, i) => {
        const pages = c.pageStart === c.pageEnd ? `page ${c.pageStart}` : `pages ${c.pageStart}-${c.pageEnd}`;
        return `[C${i + 1}] (${pages}) ${c.text}`;
    }).join('\n\n');

    let historyText = '';
    if (rollingSummary) {
        historyText += `Previous conversation summary: ${rollingSummary}\n\n`;
    }
    if (history.length > 0) {
        historyText += 'Recent messages:\n' + history.map((m) =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text.slice(0, 500)}`
        ).join('\n') + '\n\n';
    }

    return `You are a knowledgeable assistant that answers questions about the book "${bookTitle}".
You must ONLY use the provided excerpts to answer. If the excerpts don't contain enough information to answer, say so honestly.
NEVER invent or guess page numbers — only reference markers [C1], [C2], etc. that appear in the excerpts.

EXCERPTS FROM THE BOOK:
${excerpts}

${historyText}USER QUESTION: ${question}

Return a JSON object:
{
  "answer": "Your answer text. Reference excerpts using markers like [C1], [C2] inline.",
  "citations": [
    {
      "marker": "C1",
      "quote": "A short verbatim sentence or clause from the cited excerpt. Use the exact wording from the excerpt."
    }
  ],
  "answered": true
}

For every citation, quote the shortest exact sentence or clause that supports the answer. Never paraphrase the quote. Use only markers that appear in the excerpts.

If the excerpts don't answer the question, set answered to false and explain what you found instead.`;
}

function extractUsage(result) {
    const u = result?.usageMetadata;
    return {
        inputTokens: u?.promptTokenCount || 0,
        outputTokens: u?.candidatesTokenCount || 0
    };
}

async function generateWithFallback(models, prompt) {
    let rawText = '';
    try {
        const result = await models.primary.generateContent(prompt);
        rawText = await extractGeneratedText(result);
        return { json: extractJsonObject(rawText), model: models.primaryName, usage: extractUsage(result) };
    } catch (error) {
        if (!shouldUseGeminiFallback(error)) throw error;
        console.log('[book-chat] Falling back to', models.fallbackName);
        try {
            const result = await models.fallback.generateContent(prompt);
            rawText = await extractGeneratedText(result);
            return { json: extractJsonObject(rawText), model: models.fallbackName, usage: extractUsage(result) };
        } catch (fallbackError) {
            console.error('[book-chat] Fallback failed:', truncateForLog(fallbackError?.message));
            throw fallbackError;
        }
    }
}

function normalizeCitationText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function validateCitations(rawCitations, sentChunks) {
    if (!Array.isArray(rawCitations)) return [];

    const chunkMap = new Map();
    sentChunks.forEach((c, i) => {
        chunkMap.set(`C${i + 1}`, c);
    });

    const validated = [];
    const seenMarkers = new Set();
    for (const cit of rawCitations) {
        const marker = String(cit.marker || '').trim();
        const chunk = chunkMap.get(marker);
        if (!chunk) continue;
        if (seenMarkers.has(marker)) continue;
        seenMarkers.add(marker);

        const rawQuote = String(cit.quote || cit.highlightText || '').trim();
        const normalizedQuote = normalizeCitationText(rawQuote);
        const normalizedChunk = normalizeCitationText(chunk.text);
        const highlightText = normalizedQuote && normalizedChunk.includes(normalizedQuote)
            ? rawQuote
            : null;

        validated.push({
            marker,
            chunkId: chunk.chunkId,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            snippet: chunk.text.slice(0, SNIPPET_LENGTH),
            highlightText
        });
    }

    return validated;
}

async function checkQuota(db, uid) {
    const maxDaily = Number(process.env.CRM_BOOKS_MAX_DAILY_CHATS) || MAX_DAILY_CHATS;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};

    const today = new Date().toISOString().split('T')[0];
    let stats = userData.crmBooksChatStats || { lastDate: '', count: 0 };
    if (stats.lastDate !== today) stats = { lastDate: today, count: 0 };

    if (stats.count >= maxDaily) {
        return { allowed: false, remaining: 0, limit: maxDaily };
    }

    return { allowed: true, remaining: maxDaily - stats.count, limit: maxDaily, stats };
}

async function incrementQuota(db, uid) {
    const today = new Date().toISOString().split('T')[0];
    const userRef = db.collection('users').doc(uid);
    await userRef.set({
        crmBooksChatStats: {
            lastDate: today,
            count: FieldValue.increment(1)
        }
    }, { merge: true });
}

async function handleChatMessage(db, { bookId, threadId, question, uid }) {
    const startMs = Date.now();

    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) throw Object.assign(new Error('Book not found'), { code: 'not-found' });
    const bookData = bookSnap.data();
    if (bookData.status !== 'ready') throw Object.assign(new Error('Book not ready'), { code: 'failed-precondition' });

    const threadRef = db.collection(CRM_BOOKS).doc(bookId).collection('threads').doc(threadId);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) throw Object.assign(new Error('Thread not found'), { code: 'not-found' });
    const threadData = threadSnap.data() || {};

    const quota = await checkQuota(db, uid);
    if (!quota.allowed) {
        throw Object.assign(new Error(`Daily chat limit (${quota.limit}) reached. Resets tomorrow.`), { code: 'resource-exhausted' });
    }

    const chunks = await retrieveTopChunks(db, bookId, question, { bookTitle: bookData.title });

    const messagesCol = threadRef.collection('messages');
    const recentSnap = await messagesCol.orderBy('createdAt', 'desc').limit(MAX_HISTORY_MESSAGES).get();
    const history = recentSnap.docs.map((d) => d.data()).reverse();

    const budget = await checkBudget(db);
    if (!budget.allowed) {
        throw Object.assign(
            new Error(`Monthly AI budget ($${budget.budgetLimitUsd.toFixed(2)}) exceeded. Admin approval required.`),
            { code: 'resource-exhausted', budgetExceeded: true }
        );
    }

    const models = getModels();
    const prompt = buildChatPrompt(question, chunks, history, threadData.rollingSummary, bookData.title);
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'chat', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-chat] Usage tracking failed:', err?.message));

    const citations = validateCitations(json.citations, chunks);
    const latencyMs = Date.now() - startMs;

    const userMsgRef = messagesCol.doc();
    const assistantMsgRef = messagesCol.doc();

    const userMsg = {
        role: 'user',
        text: question,
        citations: [],
        createdAt: FieldValue.serverTimestamp()
    };

    const assistantMsg = {
        role: 'assistant',
        text: json.answer || '',
        citations,
        answered: json.answered !== false,
        retrieval: {
            chunkIds: chunks.map((c) => c.chunkId),
            distances: chunks.map((c) => c.distance),
            strategy: chunks[0]?.strategy || 'unknown'
        },
        model,
        latencyMs,
        createdAt: FieldValue.serverTimestamp()
    };

    const batch = db.batch();
    batch.set(userMsgRef, userMsg);
    batch.set(assistantMsgRef, assistantMsg);

    const totalMessages = (threadData.messageCount || 0) + 2;
    batch.update(threadRef, {
        messageCount: totalMessages,
        updatedAt: FieldValue.serverTimestamp()
    });
    await batch.commit();

    await incrementQuota(db, uid);

    if (totalMessages > 0 && totalMessages % ROLLING_SUMMARY_INTERVAL === 0) {
        generateRollingSummary(db, bookId, threadId, totalMessages).catch((err) =>
            console.error('[book-chat] Rolling summary failed:', err?.message)
        );
    }

    return {
        userMessage: { messageId: userMsgRef.id, ...userMsg, createdAt: new Date() },
        assistantMessage: { messageId: assistantMsgRef.id, ...assistantMsg, createdAt: new Date() },
        quota: { remaining: quota.remaining - 1, limit: quota.limit }
    };
}

async function generateRollingSummary(db, bookId, threadId, throughMessage) {
    const threadRef = db.collection(CRM_BOOKS).doc(bookId).collection('threads').doc(threadId);
    const messagesSnap = await threadRef.collection('messages')
        .orderBy('createdAt', 'asc')
        .limit(throughMessage)
        .get();

    const conversation = messagesSnap.docs.map((d) => {
        const data = d.data();
        return `${data.role === 'user' ? 'User' : 'Assistant'}: ${String(data.text || '').slice(0, 300)}`;
    }).join('\n');

    const prompt = `Summarize this conversation about a book in 2-3 sentences, preserving key topics discussed and any conclusions reached:\n\n${conversation}`;

    const models = getModels();
    try {
        const result = await models.primary.generateContent(prompt);
        const rawText = await extractGeneratedText(result);
        const summary = rawText.trim().slice(0, 1000);
        await threadRef.update({
            rollingSummary: summary,
            rollingSummaryThroughMessage: throughMessage
        });
    } catch (err) {
        console.warn('[book-chat] Rolling summary generation failed:', err?.message);
    }
}

module.exports = {
    handleChatMessage,
    checkQuota,
    incrementQuota,
    validateCitations,
    normalizeCitationText,
    buildChatPrompt,
    MAX_DAILY_CHATS,
    MAX_HISTORY_MESSAGES,
    ROLLING_SUMMARY_INTERVAL
};
