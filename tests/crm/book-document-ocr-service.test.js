/* eslint-disable no-console */
const assert = require('assert');
const {
    getOcrConfig,
    buildBatchProcessRequest,
    submitBatchOcr,
    extractTextFromSegments,
    parseDocumentAiShards,
    DEFAULT_OCR_PROCESSOR_VERSION
} = require('../../functions/src/crm/book-document-ocr-service');

async function runTests() {
    console.log('Testing Document AI OCR adapter and shard parser...');

    // 1. Config validation (fail-closed)
    assert.throws(
        () => getOcrConfig({}),
        (err) => err.code === 'DOCUMENT_AI_CONFIG_MISSING',
        'Missing processor config must fail closed'
    );
    assert.throws(
        () => getOcrConfig({ CRM_BOOKS_DOCUMENT_AI_PROCESSOR: 'projects/p/locations/us/processors/proc1' }),
        (err) => err.code === 'DOCUMENT_AI_CONFIG_MISSING',
        'Missing location config must fail closed'
    );

    const validConfig = getOcrConfig({
        CRM_BOOKS_DOCUMENT_AI_PROCESSOR: 'projects/test-proj/locations/us/processors/test-proc',
        CRM_BOOKS_DOCUMENT_AI_LOCATION: 'us'
    });
    assert.strictEqual(validConfig.location, 'us');
    assert.strictEqual(validConfig.processorVersion, DEFAULT_OCR_PROCESSOR_VERSION);

    // 2. Request building with enableNativePdfParsing: false
    const request = buildBatchProcessRequest({
        sourceGcsUri: 'gs://test-bucket/crm-books/book-1/source.pdf',
        outputGcsUriPrefix: 'gs://test-bucket/crm-books/book-1/text-revisions/rev-1/ocr-output/',
        config: validConfig
    });
    assert.strictEqual(
        request.processOptions.ocrConfig.enableNativePdfParsing,
        false,
        'enableNativePdfParsing MUST be false to avoid corrupt embedded text layer'
    );
    assert.strictEqual(request.processOptions.ocrConfig.enableImageQualityScores, true);
    assert.deepStrictEqual(request.processOptions.ocrConfig.languageHints, ['en']);
    assert.ok(request.name.includes(DEFAULT_OCR_PROCESSOR_VERSION));

    // 3. Mock submitBatchOcr
    let submittedRequest = null;
    const mockClient = {
        async batchProcessDocuments(req) {
            submittedRequest = req;
            return [{ name: 'projects/test-proj/locations/us/operations/op-12345' }];
        }
    };
    const submitResult = await submitBatchOcr({
        client: mockClient,
        sourceGcsUri: 'gs://test-bucket/crm-books/book-1/source.pdf',
        outputGcsUriPrefix: 'gs://test-bucket/crm-books/book-1/text-revisions/rev-1/ocr-output/',
        config: validConfig
    });
    assert.strictEqual(submitResult.operationName, 'projects/test-proj/locations/us/operations/op-12345');
    assert.ok(submittedRequest);

    // 4. Multi-byte anchor text slicing
    const utf8Text = 'Hello 🌍 World! A Neglected Species.';
    // '🌍' is 2 code units in UTF-16
    const segSlice = extractTextFromSegments(utf8Text, [{ startIndex: 0, endIndex: 9 }]);
    assert.strictEqual(segSlice, 'Hello 🌍 ');

    // 5. Out-of-order shards reassembly and page sorting
    // Shard 2 contains page 2; Shard 1 contains page 1
    const shard2 = {
        document: {
            text: 'Teaching Pronunciation in the Communicative Classroom\n\nIntroduction and overview.',
            pages: [
                {
                    pageNumber: 2,
                    paragraphs: [
                        { layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 53 }] } } },
                        { layout: { textAnchor: { textSegments: [{ startIndex: 55, endIndex: 81 }] } } }
                    ],
                    tokens: [
                        { layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 8 }] }, confidence: 0.98 } },
                        { layout: { textAnchor: { textSegments: [{ startIndex: 9, endIndex: 22 }] }, confidence: null } }
                    ],
                    imageQualityScores: { qualityScore: 0.95, detectedDefects: [] }
                }
            ]
        }
    };
    const shard1 = {
        document: {
            text: 'Chapter 1\n\nA Neglected Species',
            pages: [
                {
                    pageNumber: 1,
                    paragraphs: [
                        { layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 9 }] } } },
                        { layout: { textAnchor: { textSegments: [{ startIndex: 11, endIndex: 30 }] } } }
                    ],
                    tokens: [
                        { layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 9 }] }, confidence: 0.99 } },
                        { layout: { textAnchor: { textSegments: [{ startIndex: 11, endIndex: 20 }] }, confidence: 0.96 } },
                        { layout: { textAnchor: { textSegments: [{ startIndex: 21, endIndex: 30 }] }, confidence: 0.97 } }
                    ],
                    imageQualityScores: { qualityScore: 0.92, detectedDefects: [] }
                }
            ]
        }
    };

    // Shards provided in reverse order [shard2, shard1]
    const parsed = parseDocumentAiShards([shard2, shard1], { expectedPageCount: 2 });
    assert.strictEqual(parsed.totalPages, 2);
    assert.strictEqual(parsed.pages.length, 2);
    assert.strictEqual(parsed.pages[0], 'Chapter 1\n\nA Neglected Species');
    assert.strictEqual(parsed.pages[1], 'Teaching Pronunciation in the Communicative Classroom\n\nIntroduction and overview.');
    assert.strictEqual(parsed.pageDetails[0].pageNumber, 1);
    assert.strictEqual(parsed.pageDetails[1].pageNumber, 2);
    assert.strictEqual(parsed.pageDetails[1].words[1].confidence, null, 'Missing confidence must be null');
    assert.ok(parsed.pagesHash, 'Hash must be generated');

    // 6. Duplicate page error
    assert.throws(
        () => parseDocumentAiShards([shard1, shard1]),
        (err) => err.code === 'OCR_DUPLICATE_PAGE',
        'Duplicate page numbers must throw OCR_DUPLICATE_PAGE'
    );

    // 7. Page count mismatch error
    assert.throws(
        () => parseDocumentAiShards([shard1], { expectedPageCount: 2 }),
        (err) => err.code === 'OCR_PAGE_COUNT_MISMATCH',
        'Page count mismatch must throw OCR_PAGE_COUNT_MISMATCH'
    );

    // 8. Missing page gap error (page 1 and page 3, missing page 2)
    const shard3 = {
        document: {
            text: 'Page 3 text',
            pages: [{ pageNumber: 3, paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 11 }] } } }] }]
        }
    };
    assert.throws(
        () => parseDocumentAiShards([shard1, shard3]),
        (err) => err.code === 'OCR_PAGE_GAP',
        'Gaps in page numbers must throw OCR_PAGE_GAP'
    );

    // 9. Empty shards error
    assert.throws(
        () => parseDocumentAiShards([]),
        (err) => err.code === 'OCR_EMPTY_SHARDS',
        'Empty shards array must throw OCR_EMPTY_SHARDS'
    );

    console.log('book Document AI OCR service tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
