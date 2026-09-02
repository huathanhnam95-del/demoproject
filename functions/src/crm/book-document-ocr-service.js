const crypto = require('crypto');
const { assessBookTextQuality } = require('./book-text-quality');

/**
 * Enterprise Document AI OCR Adapter for CRM Books
 * Pinned processor configuration, fenced batch execution with native PDF parsing disabled.
 */

const DEFAULT_OCR_PROCESSOR_VERSION = 'pretrained-ocr-v2.1-2024-08-07';

function getOcrConfig(env = process.env) {
    const processor = env.CRM_BOOKS_DOCUMENT_AI_PROCESSOR;
    const location = env.CRM_BOOKS_DOCUMENT_AI_LOCATION;
    const processorVersion = env.CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION || DEFAULT_OCR_PROCESSOR_VERSION;

    if (!processor) {
        const error = new Error('Missing required environment variable CRM_BOOKS_DOCUMENT_AI_PROCESSOR');
        error.code = 'DOCUMENT_AI_CONFIG_MISSING';
        throw error;
    }
    if (!location) {
        const error = new Error('Missing required environment variable CRM_BOOKS_DOCUMENT_AI_LOCATION');
        error.code = 'DOCUMENT_AI_CONFIG_MISSING';
        throw error;
    }

    return {
        processor,
        location,
        processorVersion,
        apiEndpoint: `${location}-documentai.googleapis.com`
    };
}

function buildBatchProcessRequest({
    sourceGcsUri,
    outputGcsUriPrefix,
    config,
    mimeType = 'application/pdf'
}) {
    if (!sourceGcsUri || !sourceGcsUri.startsWith('gs://')) {
        throw new Error('sourceGcsUri must be a valid gs:// URI');
    }
    if (!outputGcsUriPrefix || !outputGcsUriPrefix.startsWith('gs://')) {
        throw new Error('outputGcsUriPrefix must be a valid gs:// URI prefix');
    }

    const processorName = config.processorVersion
        ? (config.processor.includes('/processorVersions/')
            ? config.processor
            : `${config.processor}/processorVersions/${config.processorVersion}`)
        : config.processor;

    return {
        name: processorName,
        inputDocuments: {
            gcsDocuments: {
                documents: [
                    {
                        gcsUri: sourceGcsUri,
                        mimeType
                    }
                ]
            }
        },
        documentOutputConfig: {
            gcsOutputConfig: {
                gcsUri: outputGcsUriPrefix
            }
        },
        processOptions: {
            ocrConfig: {
                enableNativePdfParsing: false, // CRITICAL: Never reuse corrupt embedded PDF text layer!
                enableImageQualityScores: true,
                languageHints: ['en']
            }
        }
    };
}

async function submitBatchOcr({
    client,
    sourceGcsUri,
    outputGcsUriPrefix,
    config
}) {
    const request = buildBatchProcessRequest({
        sourceGcsUri,
        outputGcsUriPrefix,
        config
    });

    const [operation] = await client.batchProcessDocuments(request);
    const operationName = operation.name || operation.latestResponse?.name;

    return {
        operationName,
        submitTime: new Date().toISOString(),
        sourceGcsUri,
        outputGcsUriPrefix,
        processor: request.name,
        requestOptions: {
            enableNativePdfParsing: false,
            enableImageQualityScores: true,
            languageHints: ['en']
        }
    };
}

function extractTextFromSegments(fullText, textSegments) {
    if (!fullText || !textSegments || textSegments.length === 0) return '';
    const parts = [];
    for (const seg of textSegments) {
        const start = parseInt(seg.startIndex || 0, 10);
        const end = parseInt(seg.endIndex || 0, 10);
        if (end > start && start >= 0 && end <= fullText.length) {
            parts.push(fullText.slice(start, end));
        }
    }
    return parts.join('');
}

function parsePageFromDocument(docPage, fullText) {
    const pageNumber = docPage.pageNumber || 1;
    let pageText = '';

    // Reconstruct page text from paragraphs or text anchors
    if (docPage.paragraphs && docPage.paragraphs.length > 0) {
        const paragraphTexts = docPage.paragraphs.map((p) => {
            const segments = p.layout?.textAnchor?.textSegments || [];
            return extractTextFromSegments(fullText, segments).trim();
        }).filter(Boolean);
        pageText = paragraphTexts.join('\n\n');
    } else if (docPage.layout?.textAnchor?.textSegments) {
        pageText = extractTextFromSegments(fullText, docPage.layout.textAnchor.textSegments).trim();
    } else if (docPage.lines && docPage.lines.length > 0) {
        const lineTexts = docPage.lines.map((l) => {
            const segments = l.layout?.textAnchor?.textSegments || [];
            return extractTextFromSegments(fullText, segments).trim();
        }).filter(Boolean);
        pageText = lineTexts.join('\n');
    }

    // Extract word/token bounding boxes and confidence
    const words = [];
    if (docPage.tokens && docPage.tokens.length > 0) {
        for (const token of docPage.tokens) {
            const segments = token.layout?.textAnchor?.textSegments || [];
            const wordText = extractTextFromSegments(fullText, segments).trim();
            const confidence = typeof token.layout?.confidence === 'number'
                ? token.layout.confidence
                : null;
            const vertices = token.layout?.boundingPoly?.normalizedVertices ||
                token.layout?.boundingPoly?.vertices || null;

            if (wordText) {
                words.push({
                    text: wordText,
                    confidence,
                    vertices
                });
            }
        }
    }

    // Extract image quality score
    const imageQuality = docPage.imageQualityScores
        ? {
            qualityScore: docPage.imageQualityScores.qualityScore ?? null,
            defects: docPage.imageQualityScores.detectedDefects || []
        }
        : null;

    return {
        pageNumber,
        text: pageText,
        words,
        imageQuality,
        dimension: docPage.dimension || null
    };
}

function parseDocumentAiShards(shards, options = {}) {
    if (!Array.isArray(shards) || shards.length === 0) {
        throw Object.assign(new Error('No OCR shards provided for parsing'), {
            code: 'OCR_EMPTY_SHARDS'
        });
    }

    const allPages = [];
    const seenPageNumbers = new Set();
    let totalChars = 0;

    for (let shardIndex = 0; shardIndex < shards.length; shardIndex++) {
        const shard = shards[shardIndex];
        const doc = shard.document || shard;
        const fullText = doc.text || '';
        const docPages = doc.pages || [];

        for (const docPage of docPages) {
            const parsedPage = parsePageFromDocument(docPage, fullText);
            const pNum = parsedPage.pageNumber;

            if (seenPageNumbers.has(pNum)) {
                throw Object.assign(
                    new Error(`Duplicate page ${pNum} detected in OCR shards (shard index ${shardIndex})`),
                    { code: 'OCR_DUPLICATE_PAGE', pageNumber: pNum }
                );
            }
            seenPageNumbers.add(pNum);
            allPages.push(parsedPage);
            totalChars += parsedPage.text.length;
        }
    }

    // Sort pages strictly by physical pageNumber ascending
    allPages.sort((a, b) => a.pageNumber - b.pageNumber);

    const totalPages = allPages.length;
    if (options.expectedPageCount && totalPages !== options.expectedPageCount) {
        throw Object.assign(
            new Error(`OCR parsed ${totalPages} pages but expected ${options.expectedPageCount}`),
            {
                code: 'OCR_PAGE_COUNT_MISMATCH',
                expected: options.expectedPageCount,
                actual: totalPages
            }
        );
    }

    // Verify no gaps in 1..totalPages
    for (let i = 0; i < totalPages; i++) {
        const expectedNum = i + 1;
        if (allPages[i].pageNumber !== expectedNum) {
            throw Object.assign(
                new Error(`Missing or out-of-order page: expected ${expectedNum}, found ${allPages[i].pageNumber}`),
                { code: 'OCR_PAGE_GAP', expected: expectedNum, actual: allPages[i].pageNumber }
            );
        }
    }

    const pageTexts = allPages.map((p) => p.text);
    const textQuality = assessBookTextQuality(pageTexts);

    // Compute deterministic hash of parsed pages content
    const pagesHash = crypto.createHash('sha256')
        .update(JSON.stringify(pageTexts))
        .digest('hex');

    return {
        totalPages,
        pages: pageTexts,
        pageDetails: allPages,
        textQuality,
        pagesHash,
        totalChars
    };
}

module.exports = {
    DEFAULT_OCR_PROCESSOR_VERSION,
    getOcrConfig,
    buildBatchProcessRequest,
    submitBatchOcr,
    extractTextFromSegments,
    parsePageFromDocument,
    parseDocumentAiShards
};
