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
const MIND_MAP_CITATION_SCHEMA_VERSION = 1;

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

function buildStudyNotesPrompt(chapterChunks, sectionTitle, pageStart, pageEnd, bookTitle) {
    const text = chapterChunks.map((c) => {
        const pageLabel = c.pageStart === c.pageEnd ? `[page ${c.pageStart}]` : `[pages ${c.pageStart}-${c.pageEnd}]`;
        return `${pageLabel}\n${c.text}`;
    }).join('\n\n');

    return `You are generating an exhaustive, clear, and organized set of study notes based on this chapter/section from the book "${bookTitle || 'Book'}".

SECTION TITLE: "${sectionTitle}" (Pages ${pageStart}-${pageEnd})

RESOURCE TEXT:
${text}

INSTRUCTIONS:
Create a comprehensive, clear, and organized set of study notes based on the provided resource.
Ensure that ALL key terms, concepts, nuances, and practical examples are included.
The notes should cover definitions, detailed explanations, principles, and related examples.
Structure the notes logically with headings and subheadings to enhance readability.
Include detailed explanations of key terms, principles, and examples to illustrate complex ideas.
Aim for maximum clarity, precision, and depth to help students thoroughly master the material.

Return a JSON object with this exact structure:
{
  "title": "Comprehensive Study Notes: ${sectionTitle}",
  "sectionIndex": ${pageStart},
  "pageStart": ${pageStart},
  "pageEnd": ${pageEnd},
  "overview": "A 2-3 sentence overview of this study module",
  "content": "Full detailed study notes formatted in GitHub-flavored Markdown. Use # for main heading, ## for sections, ### for sub-sections, bold text for key terms, blockquotes for key takeaways, and bulleted lists for examples and definitions.",
  "keyTerms": [
    {
      "term": "Term or concept name",
      "definition": "Clear, precise definition",
      "example": "Practical example if available"
    }
  ]
}`;
}

async function generateChapterStudyNotes(db, bookId, sectionIndex) {
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) {
        throw new Error(`Book ${bookId} not found`);
    }
    const bookData = bookSnap.data() || {};

    const sectionRef = db.collection(CRM_BOOKS).doc(bookId)
        .collection('sections').doc(String(sectionIndex));
    const sectionSnap = await sectionRef.get();
    if (!sectionSnap.exists) {
        throw new Error(`Section ${sectionIndex} not found for book ${bookId}`);
    }
    const sectionData = sectionSnap.data() || {};
    const pageStart = sectionData.pageStart || 1;
    const pageEnd = sectionData.pageEnd || 1;

    const chunksSnap = await db.collection(CRM_BOOKS).doc(bookId)
        .collection('chunks')
        .orderBy('index')
        .get();

    const allChunks = chunksSnap.docs.map((doc) => doc.data());
    const chapterChunks = allChunks.filter(
        (c) => c.pageStart <= pageEnd && c.pageEnd >= pageStart
    );

    if (chapterChunks.length === 0) {
        throw new Error(`No text chunks found for section "${sectionData.title || sectionIndex}" (pages ${pageStart}-${pageEnd}). The book may need re-ingestion.`);
    }

    const chunksToUse = chapterChunks;

    const models = getModels();
    const prompt = buildStudyNotesPrompt(
        chunksToUse,
        sectionData.title || `Section ${Number(sectionIndex) + 1}`,
        pageStart,
        pageEnd,
        bookData.title || ''
    );

    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'study_module', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed for study notes:', err?.message));

    const studyNotes = {
        title: json.title || `Study Notes: ${sectionData.title || `Section ${Number(sectionIndex) + 1}`}`,
        sectionIndex: Number(sectionIndex),
        pageStart,
        pageEnd,
        overview: json.overview || '',
        content: json.content || '',
        keyTerms: Array.isArray(json.keyTerms) ? json.keyTerms : [],
        model,
        generatedAt: new Date()
    };

    await db.collection(CRM_BOOKS).doc(bookId)
        .collection('sections').doc(String(sectionIndex))
        .collection('artifacts').doc('study_notes')
        .set(studyNotes);

    return studyNotes;
}

function buildMindMapPrompt(notes, bookTitle) {
    const notesText = notes.map((n, idx) => `[Note #${idx + 1} | ID: ${n.id} | Saved: ${n.savedAt ? new Date(n.savedAt).toISOString() : 'N/A'}]\n${n.text}`).join('\n\n---\n\n');

    return `You are an expert educational synthesizer creating an interactive Mind Map for user notes from the book "${bookTitle || 'Book'}".

Analyze and group the following user notes into coherent, logical themes and subtopics.

USER NOTES:
${notesText}

INSTRUCTIONS:
1. Synthesize all notes into a high-level central concept.
2. Group the notes into 3 to 6 major categories / themes. Choose distinct color hex codes for each category (e.g. #4f46e5, #059669, #d97706, #dc2626, #7c3aed, #0891b2).
3. Inside each category, break down into logical subtopics / thought blocks. Each subtopic should reference the relevant noteId(s), provide a clear concise title, a 1-2 sentence summary, and a short supporting explanation.
4. Ensure every note is organized into at least one relevant theme.
5. IMPORTANT: Use the exact note ID strings (e.g. "note_1723537890123_abc" or "fs_abc123") from the [Note #X | ID: xxx] headers above, not invented IDs. Every subtopic MUST have a non-empty "noteIds" array containing at least one real note ID.
6. Every subtopic MUST include one or more passage-level citations that directly support its summary. Each citation must contain the real note ID and an exact, verbatim quote copied from that note. Use the shortest complete sentence or 1-3 sentence passage that provides sufficient evidence. Do not cite the entire note and do not paraphrase inside "quote".

Return a JSON object with this exact structure:
{
  "centralTopic": "Overall Mind Map Title (e.g. Core Concepts of ${bookTitle || 'Book'})",
  "summary": "Brief 1-2 sentence summary synthesizing the collected notes",
  "categories": [
    {
      "id": "cat_1",
      "title": "Category Name",
      "color": "#4f46e5",
      "subtopics": [
        {
          "id": "sub_1_1",
          "title": "Subtopic/Concept Title",
          "summary": "Brief summary of key insight",
          "noteIds": ["note_123"],
          "citations": [
            {
              "noteId": "note_123",
              "quote": "Exact verbatim passage from that note supporting this summary"
            }
          ],
          "fullText": "Short explanation of how the cited passage supports the summary"
        }
      ]
    }
  ]
}`;
}

function normalizeMindMapCitationText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeMindMapCategories(categories, notes) {
    const noteMap = new Map((Array.isArray(notes) ? notes : [])
        .filter(note => note?.id)
        .map(note => [String(note.id), note]));

    return (Array.isArray(categories) ? categories : []).map(category => ({
        ...category,
        subtopics: (Array.isArray(category?.subtopics) ? category.subtopics : []).map(subtopic => {
            const noteIds = [];
            const seenNoteIds = new Set();
            (Array.isArray(subtopic?.noteIds) ? subtopic.noteIds : []).forEach(rawId => {
                const noteId = String(rawId || '');
                if (!noteMap.has(noteId) || seenNoteIds.has(noteId)) return;
                seenNoteIds.add(noteId);
                noteIds.push(noteId);
            });

            const citations = [];
            const seenCitations = new Set();
            (Array.isArray(subtopic?.citations) ? subtopic.citations : []).forEach(citation => {
                const noteId = String(citation?.noteId || '');
                const quote = String(citation?.quote || '').trim();
                const normalizedQuote = normalizeMindMapCitationText(quote);
                const normalizedSource = normalizeMindMapCitationText(noteMap.get(noteId)?.text);
                if (!noteMap.has(noteId) || !normalizedQuote || !normalizedSource.includes(normalizedQuote)) return;

                const citationKey = `${noteId}\n${normalizedQuote}`;
                if (seenCitations.has(citationKey)) return;
                seenCitations.add(citationKey);
                citations.push({ noteId, quote });

                if (!seenNoteIds.has(noteId)) {
                    seenNoteIds.add(noteId);
                    noteIds.push(noteId);
                }
            });

            return {
                ...subtopic,
                noteIds,
                citations,
                evidenceStatus: citations.length > 0 ? 'verified' : 'insufficient'
            };
        })
    }));
}

function collectMindMapCitationGaps(categories) {
    const gaps = [];
    (Array.isArray(categories) ? categories : []).forEach(category => {
        (Array.isArray(category?.subtopics) ? category.subtopics : []).forEach(subtopic => {
            if (subtopic?.evidenceStatus === 'verified' && Array.isArray(subtopic.citations) && subtopic.citations.length > 0) return;
            gaps.push({
                subtopicId: String(subtopic?.id || ''),
                title: String(subtopic?.title || ''),
                summary: String(subtopic?.summary || ''),
                noteIds: Array.isArray(subtopic?.noteIds) ? subtopic.noteIds : []
            });
        });
    });
    return gaps.filter(gap => gap.subtopicId);
}

function buildMindMapCitationRepairPrompt(gaps, notes) {
    const safeGaps = Array.isArray(gaps) ? gaps : [];
    const safeNotes = Array.isArray(notes) ? notes : [];
    const requestedNoteIds = new Set(safeGaps.flatMap(gap => Array.isArray(gap?.noteIds) ? gap.noteIds.map(String) : []));
    const includesUnscopedGap = safeGaps.some(gap => !Array.isArray(gap?.noteIds) || gap.noteIds.length === 0);
    const relevantNotes = includesUnscopedGap
        ? safeNotes
        : safeNotes.filter(note => requestedNoteIds.has(String(note?.id || '')));
    const gapText = safeGaps.map(gap =>
        `[Subtopic ID: ${gap.subtopicId}]\nTitle: ${gap.title}\nSummary: ${gap.summary}\nAllowed note IDs: ${(gap.noteIds || []).join(', ') || 'Choose from the supplied notes.'}`
    ).join('\n\n');
    const notesText = relevantNotes.map(note =>
        `[Note ID: ${note.id}]\n${note.text || ''}`
    ).join('\n\n---\n\n');

    return `You are repairing source citations for an existing mind map.

For each listed subtopic, return one or more exact, verbatim source passages that directly support its existing summary. Do not change the subtopic title, summary, IDs, or structure. Do not paraphrase. If no passage supports a summary, return an empty citations array for that subtopic.

SUBTOPICS NEEDING EVIDENCE:
${gapText}

SOURCE NOTES:
${notesText}

Return JSON with this exact structure:
{
  "citations": [
    {
      "subtopicId": "sub_1_1",
      "citations": [
        { "noteId": "real-note-id", "quote": "Exact, verbatim quote from that note" }
      ]
    }
  ]
}`;
}

function mergeMindMapCitationRepairs(categories, repairJson, notes) {
    const repairMap = new Map();
    (Array.isArray(repairJson?.citations) ? repairJson.citations : []).forEach(entry => {
        const subtopicId = String(entry?.subtopicId || '');
        if (subtopicId) repairMap.set(subtopicId, Array.isArray(entry?.citations) ? entry.citations : []);
    });

    const merged = (Array.isArray(categories) ? categories : []).map(category => ({
        ...category,
        subtopics: (Array.isArray(category?.subtopics) ? category.subtopics : []).map(subtopic => {
            if (!repairMap.has(String(subtopic?.id || ''))) return subtopic;
            return { ...subtopic, citations: repairMap.get(String(subtopic.id)) };
        })
    }));
    return normalizeMindMapCategories(merged, notes);
}

async function repairMindMapCitations({ categories, notes, models, generate = generateWithFallback }) {
    const initialGaps = collectMindMapCitationGaps(categories);
    if (initialGaps.length === 0) {
        return { categories, attempted: false, repairedCount: 0, insufficientCount: 0, usage: null };
    }

    try {
        const result = await generate(models, buildMindMapCitationRepairPrompt(initialGaps, notes));
        const repairedCategories = mergeMindMapCitationRepairs(categories, result?.json, notes);
        const remainingGaps = collectMindMapCitationGaps(repairedCategories);
        return {
            categories: repairedCategories,
            attempted: true,
            repairedCount: initialGaps.length - remainingGaps.length,
            insufficientCount: remainingGaps.length,
            usage: result?.usage || null
        };
    } catch (error) {
        console.warn('[book-summary] Mind-map citation repair failed:', error?.message || String(error));
        return {
            categories,
            attempted: true,
            repairedCount: 0,
            insufficientCount: initialGaps.length,
            usage: null
        };
    }
}

async function generateBookMindMap(db, bookId, force = false, noteIds = null) {
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) {
        throw new Error(`Book ${bookId} not found`);
    }
    const bookData = bookSnap.data() || {};

    if (!force && !noteIds) {
        const existing = await db.collection(CRM_BOOKS).doc(bookId)
            .collection('artifacts').doc('mind_map').get();
        if (existing.exists) {
            return existing.data();
        }
    }

    const notesSnap = await db.collection(CRM_BOOKS).doc(bookId)
        .collection('user_notes')
        .orderBy('savedAt', 'desc')
        .limit(200)
        .get();

    let notes = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (noteIds && noteIds.length > 0) {
        const idSet = new Set(noteIds);
        notes = notes.filter(n => idSet.has(n.id));
    }
    if (notes.length === 0) {
        throw new Error('No saved notes found for this book. Save some notes first to generate a Mind Map.');
    }

    const models = getModels();
    const prompt = buildMindMapPrompt(notes, bookData.title || '');
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'mind_map', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed for mind map:', err?.message));

    const initialCategories = normalizeMindMapCategories(json.categories, notes);
    const citationRepair = await repairMindMapCitations({
        categories: initialCategories,
        notes,
        models
    });

    if (citationRepair.usage) {
        recordUsage(db, {
            type: 'mind_map_citation_repair',
            inputTokens: citationRepair.usage.inputTokens || 0,
            outputTokens: citationRepair.usage.outputTokens || 0
        }).catch(err => console.error('[book-summary] Usage tracking failed for citation repair:', err?.message));
    }

    console.info('[book-summary] Mind-map citation validation', {
        initialGapCount: collectMindMapCitationGaps(initialCategories).length,
        repairAttempted: citationRepair.attempted,
        repairedCount: citationRepair.repairedCount,
        insufficientCount: citationRepair.insufficientCount
    });

    const mindMap = {
        bookId,
        bookTitle: bookData.title || '',
        centralTopic: json.centralTopic || `Mind Map: ${bookData.title || 'Book Notes'}`,
        summary: json.summary || '',
        citationSchemaVersion: MIND_MAP_CITATION_SCHEMA_VERSION,
        categories: citationRepair.categories,
        noteCount: notes.length,
        model,
        generatedAt: new Date()
    };

    if (!noteIds) {
        await db.collection(CRM_BOOKS).doc(bookId)
            .collection('artifacts').doc('mind_map')
            .set(mindMap, { merge: true });
    }

    return mindMap;
}

function buildNodeExpandPrompt(nodeTitle, nodeSummary, contextChunks) {
    const context = contextChunks.map(c => {
        const pageLabel = c.pageStart === c.pageEnd ? `[page ${c.pageStart}]` : `[pages ${c.pageStart}-${c.pageEnd}]`;
        return `${pageLabel}\n${c.text}`;
    }).join('\n\n');

    return `You are a knowledge assistant analyzing a book. A mind map node titled "${nodeTitle}" has this summary: "${nodeSummary || 'No summary provided'}".

Using ONLY the book excerpts below, generate 3-5 child subtopics that expand on this node. Each subtopic must be grounded in the source material.

Book excerpts:
${context}

Return JSON:
{
  "subtopics": [
    {
      "title": "short title",
      "summary": "1-2 sentence summary grounded in the book",
      "pageRef": "page number or range where this is discussed"
    }
  ]
}`;
}

async function expandMindMapNode(db, bookId, nodeTitle, nodeSummary) {
    const { retrieveTopChunks } = require('./book-retrieval');
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) throw Object.assign(new Error('Book not found'), { code: 'not-found' });
    const bookData = bookSnap.data();

    const chunks = await retrieveTopChunks(db, bookId, `${nodeTitle} ${nodeSummary || ''}`, { bookTitle: bookData.title });
    const models = getModels();
    const prompt = buildNodeExpandPrompt(nodeTitle, nodeSummary, chunks);
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'mind_map_expand', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed:', err?.message));

    const subtopics = Array.isArray(json.subtopics) ? json.subtopics : [];
    return {
        subtopics: subtopics.map(s => ({
            title: String(s.title || ''),
            summary: String(s.summary || ''),
            pageRef: String(s.pageRef || '')
        })),
        model
    };
}

function buildCompilePrompt(bookTitle, sources) {
    let context = '';
    if (sources.notes && sources.notes.length > 0) {
        context += '## User Notes\n' + sources.notes.join('\n\n---\n\n') + '\n\n';
    }
    if (sources.highlights && sources.highlights.length > 0) {
        context += '## Highlighted Passages\n' + sources.highlights.map(h =>
            `- [Page ${h.page}] "${h.text}"`
        ).join('\n') + '\n\n';
    }
    if (sources.mindMapBranches && sources.mindMapBranches.length > 0) {
        context += '## Mind Map Branches\n' + sources.mindMapBranches.join('\n\n') + '\n\n';
    }
    if (sources.chatMessages && sources.chatMessages.length > 0) {
        context += '## Chat Conversation\n' + sources.chatMessages.join('\n') + '\n\n';
    }

    return `You are a research assistant. Synthesize the following user-collected materials from the book "${bookTitle}" into a well-structured Markdown research document.

Requirements:
- Create a coherent document with clear sections and headings
- Weave together notes, highlights, mind map insights, and chat Q&A into a unified narrative
- Preserve key quotes and page references
- Add a brief executive summary at the top
- Use proper Markdown formatting (headers, lists, blockquotes for citations)
- Do NOT invent information — only use what is provided

User materials:
${context}

Return the complete Markdown document as a JSON object:
{ "markdown": "# Research: Book Title\\n\\n..." }`;
}

async function compileResearch(db, bookId, bookTitle, sources) {
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) throw Object.assign(new Error('Book not found'), { code: 'not-found' });

    const models = getModels();
    const prompt = buildCompilePrompt(bookTitle || bookSnap.data().title || 'Untitled', sources);
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'compile', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed:', err?.message));

    return {
        markdown: String(json.markdown || json.document || ''),
        model
    };
}

function buildElaboratePrompt(bookTitle, bookAuthor, snippets, chunks) {
    const snippetsText = snippets.map((s, idx) => {
        const src = s.sourceTab ? ` (from ${s.sourceTab}${s.section ? ` - ${s.section}` : ''})` : '';
        return `Highlight #${idx + 1}${src}: "${s.text}"`;
    }).join('\n\n');

    const chunksText = chunks.map((c) => {
        const pageLabel = c.pageStart === c.pageEnd ? `[Page ${c.pageStart}]` : `[Pages ${c.pageStart}-${c.pageEnd}]`;
        return `${pageLabel}\n${c.text}`;
    }).join('\n\n---\n\n');

    return `You are an expert reading tutor and analyst. The user has selected key highlights from the book "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''} and requested an in-depth elaboration.

Your goal is to thoroughly explain, unpack, and contextualize what was highlighted, abiding STRICTLY and FAITHFULLY to the source book material provided below. Do not fabricate facts or bring outside opinions that contradict or dilute the author's work.

HIGHLIGHTED EXCERPTS TO ELABORATE:
${snippetsText}

SOURCE TEXT FROM THE BOOK:
${chunksText || '(No specific chunk retrieved; rely strictly on authoritative book context)'}

INSTRUCTIONS:
1. Provide an overall "synthesis" explaining how the highlighted excerpts connect to each other and to the book's overarching theme/framework.
2. For each highlighted excerpt, generate a detailed elaboration item:
   - "snippetId": ID or index corresponding to the highlight
   - "snippetText": the exact highlighted text
   - "concept": a crisp name or title for this concept (2-8 words)
   - "detailedExplanation": a comprehensive, nuanced breakdown explaining what the author means, why it matters, how it works, and the core reasoning in the book (2-4 rich paragraphs)
   - "sourceEvidence": verbatim or faithful citations from the source text supporting the explanation
   - "pageRef": page numbers or range where this is addressed (e.g. "pp. 14-16" or "p. 42")
   - "keyTakeaways": 2-4 clear, bullet-worthy takeaways

Return a JSON object with this exact schema:
{
  "synthesis": "Comprehensive synthesis paragraph connecting the highlighted parts...",
  "elaborations": [
    {
      "snippetId": "el_1",
      "snippetText": "...",
      "concept": "...",
      "detailedExplanation": "...",
      "sourceEvidence": "...",
      "pageRef": "...",
      "keyTakeaways": ["...", "..."]
    }
  ]
}`;
}

async function elaborateBookSnippets(db, bookId, snippets, options = {}) {
    const { retrieveTopChunks } = require('./book-retrieval');
    const bookSnap = await db.collection(CRM_BOOKS).doc(bookId).get();
    if (!bookSnap.exists) throw Object.assign(new Error('Book not found'), { code: 'not-found' });
    const bookData = bookSnap.data();
    const textRevisionId = options?.textRevisionId || bookData.activeTextRevisionId || null;

    const cleanSnippets = Array.isArray(snippets) ? snippets.filter(s => s && String(s.text || '').trim()) : [];
    if (cleanSnippets.length === 0) {
        throw Object.assign(new Error('No valid text snippets provided for elaboration'), { code: 'invalid-argument' });
    }

    const allChunks = [];
    const seenChunkIds = new Set();

    for (const snippet of cleanSnippets) {
        try {
            const query = `${snippet.text} ${snippet.section || ''}`.trim();
            const topChunks = await retrieveTopChunks(db, bookId, query, {
                bookTitle: bookData.title,
                topK: 4,
                textRevisionId
            });
            for (const chunk of topChunks) {
                const key = chunk.chunkId || `${chunk.pageStart}-${chunk.index}`;
                if (!seenChunkIds.has(key)) {
                    seenChunkIds.add(key);
                    allChunks.push(chunk);
                }
            }
        } catch (err) {
            console.warn('[book-summary] Chunk retrieval failed for snippet:', snippet.text, err?.message);
        }
    }

    const models = getModels();
    const prompt = buildElaboratePrompt(bookData.title || 'Untitled', bookData.author || '', cleanSnippets, allChunks);
    const { json, model, usage } = await generateWithFallback(models, prompt);

    recordUsage(db, { type: 'elaborate', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        .catch(err => console.error('[book-summary] Usage tracking failed:', err?.message));

    const elaborations = Array.isArray(json.elaborations) ? json.elaborations : [];
    return {
        synthesis: String(json.synthesis || ''),
        textRevisionId: textRevisionId || 'legacy',
        elaborations: elaborations.map((el, idx) => ({
            snippetId: el.snippetId || cleanSnippets[idx]?.id || `el_${idx + 1}`,
            snippetText: el.snippetText || cleanSnippets[idx]?.text || '',
            concept: String(el.concept || cleanSnippets[idx]?.text || `Concept ${idx + 1}`),
            detailedExplanation: String(el.detailedExplanation || ''),
            sourceEvidence: String(el.sourceEvidence || ''),
            pageRef: String(el.pageRef || ''),
            keyTakeaways: Array.isArray(el.keyTakeaways) ? el.keyTakeaways.map(t => String(t)) : []
        })),
        model
    };
}

module.exports = {
    groupChunksIntoSections,
    summarizeSection,
    reduceSummary,
    generateChapterStudyNotes,
    generateBookMindMap,
    buildMapPrompt,
    buildReducePrompt,
    buildStudyNotesPrompt,
    buildMindMapPrompt,
    normalizeMindMapCategories,
    collectMindMapCitationGaps,
    buildMindMapCitationRepairPrompt,
    mergeMindMapCitationRepairs,
    repairMindMapCitations,
    MIND_MAP_CITATION_SCHEMA_VERSION,
    extractUsage,
    generateWithFallback,
    expandMindMapNode,
    buildNodeExpandPrompt,
    compileResearch,
    buildCompilePrompt,
    elaborateBookSnippets,
    buildElaboratePrompt,
    SECTION_TARGET_CHARS,
    DEFAULT_MODEL,
    FALLBACK_MODEL
};


