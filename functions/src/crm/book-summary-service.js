/* eslint-disable no-console */
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
const { CRM_BOOKS } = require('./collections');
const { recordUsage } = require('./book-usage-tracker');

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const SECTION_TARGET_CHARS = 25000;
const JSON_GENERATION_CONFIG = {
    responseMimeType: 'application/json',
    temperature: 0.2
};

function getModels() {
    const primary = normalizeScalar(process.env.CRM_BOOKS_GEMINI_MODEL) || DEFAULT_MODEL;
    const fallback = normalizeScalar(process.env.CRM_BOOKS_GEMINI_FALLBACK_MODEL) || FALLBACK_MODEL;
    const location = normalizeScalar(process.env.CRM_BOOKS_VERTEX_LOCATION) || 'global';
    return {
        primary: getGeminiModel({ modelName: primary, location, generationConfig: JSON_GENERATION_CONFIG }),
        fallback: getGeminiModel({ modelName: fallback, location, generationConfig: JSON_GENERATION_CONFIG }),
        primaryName: primary,
        fallbackName: fallback
    };
}

function groupChunksIntoSections(chunks) {
    const sections = [];
    let current = { chunks: [], charCount: 0, startIndex: 0 };

    for (const chunk of chunks) {
        if (current.charCount + chunk.charCount > SECTION_TARGET_CHARS && current.chunks.length > 0) {
            sections.push(current);
            current = { chunks: [], charCount: 0, startIndex: chunk.index };
        }
        current.chunks.push(chunk);
        current.charCount += chunk.charCount;
    }
    if (current.chunks.length > 0) {
        sections.push(current);
    }

    return sections;
}

function buildMapPrompt(sectionChunks, sectionIndex, totalSections) {
    const text = sectionChunks.map((c) => {
        const pageLabel = c.pageStart === c.pageEnd ? `[page ${c.pageStart}]` : `[pages ${c.pageStart}-${c.pageEnd}]`;
        return `${pageLabel}\n${c.text}`;
    }).join('\n\n');

    return `You are analyzing section ${sectionIndex + 1} of ${totalSections} from a book. Extract structured information from this section.

TEXT:
${text}

Return a JSON object with:
{
  "title": "A short title for this section (2-8 words)",
  "gist": "A 1-2 sentence summary of what this section covers",
  "keyPoints": ["array of 3-6 key points from this section"],
  "topics": ["array of main topics discussed"],
  "notableTerms": ["important terms or concepts introduced"],
  "pageStart": ${sectionChunks[0]?.pageStart || 1},
  "pageEnd": ${sectionChunks[sectionChunks.length - 1]?.pageEnd || 1}
}`;
}

function buildReducePrompt(sectionDigests, bookTitle, bookAuthor) {
    const digestsText = sectionDigests.map((d, i) =>
        `Section ${i + 1}: "${d.title}" (pages ${d.pageStart}-${d.pageEnd})\nGist: ${d.gist}\nKey points: ${(d.keyPoints || []).join('; ')}\nTopics: ${(d.topics || []).join(', ')}`
    ).join('\n\n');

    return `You are generating a comprehensive summary of a book.
Title: "${bookTitle}"${bookAuthor ? `\nAuthor: ${bookAuthor}` : ''}

Here are digests from each section of the book:

${digestsText}

Generate a JSON object with this exact structure:
{
  "oneLiner": "A single compelling sentence that captures what this book is about",
  "overview": "A 2-3 paragraph overview of the book's content and approach (plain text, use \\n\\n between paragraphs)",
  "audience": "Who is this book written for? (1-2 sentences)",
  "keyTopics": [
    {
      "topic": "Topic name",
      "why": "Why this topic matters in the context of the book (1 sentence)",
      "pages": [1, 15, 42]
    }
  ],
  "outline": [
    {
      "title": "Section or chapter title",
      "pageStart": 1,
      "pageEnd": 30,
      "summary": "1-2 sentence summary of this part",
      "children": []
    }
  ]
}

Guidelines:
- keyTopics should have 5-10 entries covering the book's most important themes
- outline should reflect the book's natural structure (parts, chapters, major sections)
- outline children can be nested one level deep for sub-sections
- pages in keyTopics should reference the most relevant page numbers
- Keep the overview informative but concise`;
}

function extractUsage(result) {
    const resp = result?.response;
    const u = resp?.usageMetadata || result?.usageMetadata;
    return { inputTokens: u?.promptTokenCount || 0, outputTokens: u?.candidatesTokenCount || 0 };
}

async function generateWithFallback(models, prompt) {
    let rawText = '';
    try {
        const result = await models.primary.generateContent(prompt);
        rawText = await extractGeneratedText(result);
        return { json: extractJsonObject(rawText), model: models.primaryName, usage: extractUsage(result) };
    } catch (error) {
        if (!shouldUseGeminiFallback(error)) {
            console.error('[book-summary] Primary model failed:', truncateForLog(error?.message || String(error)));
            throw error;
        }
        console.log('[book-summary] Falling back to', models.fallbackName);
        try {
            const result = await models.fallback.generateContent(prompt);
            rawText = await extractGeneratedText(result);
            return { json: extractJsonObject(rawText), model: models.fallbackName, usage: extractUsage(result) };
        } catch (fallbackError) {
            console.error('[book-summary] Fallback model failed:', truncateForLog(fallbackError?.message || String(fallbackError)));
            throw fallbackError;
        }
    }
}

async function summarizeSection(db, bookId, sectionIndex, sectionChunks, totalSections) {
    const models = getModels();
    const prompt = buildMapPrompt(sectionChunks, sectionIndex, totalSections);
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'summary', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed:', err?.message));

    const digest = {
        title: json.title || `Section ${sectionIndex + 1}`,
        gist: json.gist || '',
        keyPoints: Array.isArray(json.keyPoints) ? json.keyPoints : [],
        topics: Array.isArray(json.topics) ? json.topics : [],
        notableTerms: Array.isArray(json.notableTerms) ? json.notableTerms : [],
        pageStart: json.pageStart || sectionChunks[0]?.pageStart || 1,
        pageEnd: json.pageEnd || sectionChunks[sectionChunks.length - 1]?.pageEnd || 1,
        model,
        generatedAt: new Date()
    };

    await db.collection(CRM_BOOKS).doc(bookId)
        .collection('sections').doc(String(sectionIndex))
        .set(digest);

    return digest;
}

async function reduceSummary(db, bookId) {
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    const bookData = bookSnap.data() || {};

    const sectionsSnap = await db.collection(CRM_BOOKS).doc(bookId)
        .collection('sections')
        .orderBy('pageStart')
        .get();

    const digests = sectionsSnap.docs.map((d) => d.data());
    if (digests.length === 0) {
        throw new Error('No section digests found for reduce step');
    }

    const models = getModels();
    const prompt = buildReducePrompt(digests, bookData.title || '', bookData.author || '');
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'summary', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed:', err?.message));

    const summary = {
        oneLiner: json.oneLiner || '',
        overview: json.overview || '',
        audience: json.audience || '',
        keyTopics: Array.isArray(json.keyTopics) ? json.keyTopics : [],
        outline: Array.isArray(json.outline) ? json.outline : [],
        model,
        generatedAt: new Date()
    };

    await db.collection(CRM_BOOKS).doc(bookId)
        .collection('artifacts').doc('summary')
        .set(summary);

    return summary;
}

module.exports = {
    groupChunksIntoSections,
    summarizeSection,
    reduceSummary,
    buildMapPrompt,
    buildReducePrompt,
    extractUsage,
    generateWithFallback,
    SECTION_TARGET_CHARS,
    DEFAULT_MODEL,
    FALLBACK_MODEL
};
