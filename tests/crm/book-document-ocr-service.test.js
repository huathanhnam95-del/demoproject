const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const service = require('../../functions/src/crm/book-document-ocr-service');

const BASE_ENV = Object.freeze({
    CRM_BOOKS_DOCUMENT_AI_PROCESSOR: 'projects/example/locations/us/processors/processor-123',
    CRM_BOOKS_DOCUMENT_AI_LOCATION: 'us',
    CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION: 'projects/example/locations/us/processors/processor-123/processorVersions/v1'
});
const REVISION_ID = 'revision-20260902';
const IMMUTABLE_SOURCE_URI = `gs://private-books/text-revisions/${REVISION_ID}/source/book.pdf`;
const EXPECTED_OUTPUT_URI = 'gs://private-books/ocr/revision/';
const SOURCE_SHA256 = 'a'.repeat(64);

function anchor(startIndex, endIndex) {
    return { textSegments: [{ startIndex: String(startIndex), endIndex: String(endIndex) }] };
}

function makeShard({
    index,
    count = 1,
    textOffset = 0,
    pageOffset = 0,
    text = '',
    pages = [],
    sourceGeneration = 'generation-1',
    anchorIndexMode,
    extra = {}
}) {
    const json = {
        shardInfo: {
            shardIndex: String(index),
            shardCount: String(count),
            textOffset: String(textOffset),
            pageOffset: String(pageOffset)
        },
        sourceGeneration,
        text,
        pages,
        ...extra
    };
    return {
        json,
        raw: JSON.stringify(json),
        sourceGeneration,
        ...(anchorIndexMode ? { anchorIndexMode } : {})
    };
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

test('requires all Document AI settings and rejects inconsistent processor resources', () => {
    assert.deepEqual(service.resolveDocumentAiConfig(BASE_ENV), {
        processor: BASE_ENV.CRM_BOOKS_DOCUMENT_AI_PROCESSOR,
        location: BASE_ENV.CRM_BOOKS_DOCUMENT_AI_LOCATION,
        processorVersion: BASE_ENV.CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION
    });

    for (const key of Object.keys(BASE_ENV)) {
        const missing = { ...BASE_ENV };
        delete missing[key];
        assert.throws(() => service.resolveDocumentAiConfig(missing), new RegExp(key));
    }

    assert.throws(() => service.resolveDocumentAiConfig({
        ...BASE_ENV,
        CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION: 'projects/example/locations/eu/processors/processor-123/processorVersions/v1'
    }), /location/i);
    assert.throws(() => service.resolveDocumentAiConfig({
        ...BASE_ENV,
        CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION: 'projects/example/locations/us/processors/other/processorVersions/v1'
    }), /processor/i);
    assert.throws(() => service.resolveDocumentAiConfig({
        ...BASE_ENV,
        CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION: 'projects/example/locations/us/processors/processor-123'
    }), /processor version/i);
});

test('creates a regional v1 client lazily and permits an injected client factory', () => {
    const config = service.resolveDocumentAiConfig(BASE_ENV);
    let options;
    const injected = {};
    const result = service.createDocumentProcessorClient({
        config,
        clientFactory: (clientOptions) => {
            options = clientOptions;
            return injected;
        }
    });

    assert.equal(result, injected);
    assert.deepEqual(options, { apiEndpoint: 'us-documentai.googleapis.com' });
});

test('builds the private PDF batch request with revision output and OCR field mask', () => {
    const config = service.resolveDocumentAiConfig(BASE_ENV);
    const request = service.buildBatchProcessRequest({
        config,
        sourceUri: 'gs://private-books/source/book.pdf',
        sourceGeneration: 'generation-1',
        outputUri: 'gs://private-books/ocr/book-revision-20260902/'
    });

    assert.deepEqual(request, {
        name: config.processorVersion,
        inputDocuments: {
            gcsDocuments: {
                documents: [{
                    gcsUri: 'gs://private-books/source/book.pdf',
                    mimeType: 'application/pdf'
                }]
            }
        },
        documentOutputConfig: {
            gcsOutputConfig: {
                gcsUri: 'gs://private-books/ocr/book-revision-20260902/',
                fieldMask: { paths: ['text', 'pages'] }
            }
        },
        processOptions: {
            ocrConfig: {
                hints: { languageHints: ['en'] },
                enableNativePdfParsing: false,
                enableImageQualityScores: true
            }
        }
    });

    assert.throws(() => service.buildBatchProcessRequest({
        config,
        sourceUri: 'https://example.com/book.pdf',
        outputUri: 'gs://private-books/ocr/revision/'
    }), /gs:\/\//i);
    assert.throws(() => service.buildBatchProcessRequest({
        config,
        sourceUri: 'gs://private-books/source/book.pdf',
        outputUri: 'gs://private-books/ocr/revision'
    }), /trailing slash/i);
});

test('submits one batch request, preserves the source fence, and rejects a missing operation name', async () => {
    const config = service.resolveDocumentAiConfig(BASE_ENV);
    const calls = [];
    const client = {
        batchProcessDocuments: async (request) => {
            calls.push(request);
            return [{ name: 'operations/ocr-123' }];
        }
    };
    const result = await service.submitBatchOcr({
        config,
        client,
        sourceUri: IMMUTABLE_SOURCE_URI,
        revisionId: REVISION_ID,
        sourceGeneration: 'generation-1',
        sourceSha256: SOURCE_SHA256,
        outputUri: 'gs://private-books/ocr/revision/'
    });

    assert.equal(calls.length, 1);
    assert.equal(result.operationName, 'operations/ocr-123');
    assert.equal(result.revisionId, REVISION_ID);
    assert.equal(result.sourceUri, IMMUTABLE_SOURCE_URI);
    assert.equal(result.sourceGeneration, 'generation-1');
    assert.equal(result.sourceSha256, SOURCE_SHA256);
    assert.equal(result.outputUri, 'gs://private-books/ocr/revision/');

    for (const invalid of [
        { revisionId: undefined },
        { sourceGeneration: undefined },
        { sourceSha256: 'not-a-sha' },
        { sourceUri: 'gs://private-books/source/book.pdf' },
        { sourceUri: `gs://private-books/text-revisions/other/source/book.pdf` }
    ]) {
        const candidate = {
            sourceUri: IMMUTABLE_SOURCE_URI,
            revisionId: REVISION_ID,
            sourceGeneration: 'generation-1',
            sourceSha256: SOURCE_SHA256,
            ...invalid
        };
        await assert.rejects(() => service.submitBatchOcr({
            config,
            client,
            sourceUri: candidate.sourceUri,
            revisionId: candidate.revisionId,
            sourceGeneration: candidate.sourceGeneration,
            sourceSha256: candidate.sourceSha256,
            outputUri: 'gs://private-books/ocr/revision/'
        }), /revision|generation|sha256|text-revisions|source/i);
    }

    await assert.rejects(() => service.submitBatchOcr({
        config,
        client: { batchProcessDocuments: async () => [{}] },
        sourceUri: IMMUTABLE_SOURCE_URI,
        revisionId: REVISION_ID,
        sourceGeneration: 'generation-1',
        sourceSha256: SOURCE_SHA256,
        outputUri: 'gs://private-books/ocr/revision/'
    }), /operation name/i);
});

test('resumes an operation through a non-billable progress check and surfaces terminal metadata/output/error', async () => {
    const config = service.resolveDocumentAiConfig(BASE_ENV);
    let batchCalls = 0;
    let progressRequest;
    const client = {
        batchProcessDocuments: async () => {
            batchCalls += 1;
            return [{ name: 'operations/should-not-be-used' }];
        },
        checkBatchProcessDocumentsProgress: async (operationName) => {
            progressRequest = operationName;
            return [{
                name: 'operations/ocr-123',
                done: true,
                metadata: {
                    state: 'SUCCEEDED',
                    pages: 211,
                    individualProcessStatuses: [
                        {
                            inputGcsSource: IMMUTABLE_SOURCE_URI,
                            outputGcsDestination: EXPECTED_OUTPUT_URI,
                            status: { code: 0, message: '' }
                        }
                    ]
                },
                response: {
                    documentOutputConfig: {
                        gcsOutputConfig: { gcsUri: 'gs://private-books/ocr/revision/' }
                    }
                },
                error: { code: 0, message: '' }
            }];
        }
    };

    const result = await service.checkBatchOcrOperation({
        config,
        client,
        operationName: '  operations/ocr-123  ',
        expectedSourceUri: IMMUTABLE_SOURCE_URI,
        expectedOutputUri: EXPECTED_OUTPUT_URI
    });

    assert.equal(progressRequest, 'operations/ocr-123');
    assert.equal(batchCalls, 0);
    assert.equal(result.done, true);
    assert.deepEqual(result.metadata, {
        state: 'SUCCEEDED',
        pages: 211,
        individualProcessStatuses: [
            {
                inputGcsSource: IMMUTABLE_SOURCE_URI,
                outputGcsDestination: EXPECTED_OUTPUT_URI,
                status: { code: 0, message: '' }
            }
        ]
    });
    assert.deepEqual(result.statuses, [
        {
            inputGcsSource: IMMUTABLE_SOURCE_URI,
            outputGcsDestination: EXPECTED_OUTPUT_URI,
            status: { code: 0, message: '' }
        }
    ]);
    assert.deepEqual(result.outputUris, [
        EXPECTED_OUTPUT_URI
    ]);
    assert.deepEqual(result.destinations, result.outputUris);
    assert.equal(result.outputUri, EXPECTED_OUTPUT_URI);
    assert.deepEqual(result.error, { code: 0, message: '' });

    const pending = await service.checkBatchOcrOperation({
        config,
        client: {
            checkBatchProcessDocumentsProgress: async () => [{
                name: 'operations/ocr-123',
                done: false,
                metadata: { state: 'RUNNING' }
            }]
        },
        operationName: 'operations/ocr-123'
    });
    assert.deepEqual(pending, {
        done: false,
        operationName: 'operations/ocr-123',
        metadata: { state: 'RUNNING' },
        error: null,
        outputUri: null,
        outputUris: [],
        destinations: [],
        statuses: []
    });
});

test('surfaces the returned operation name so a pinned production poll can reject mismatches', async () => {
    let requestedOperationName;
    const result = await service.checkBatchOcrOperation({
        client: {
            checkBatchProcessDocumentsProgress: async (operationName) => {
                requestedOperationName = operationName;
                return [{
                    name: 'operations/other',
                    done: false,
                    metadata: { state: 'RUNNING' }
                }];
            }
        },
        operationName: 'operations/pinned'
    });

    assert.equal(requestedOperationName, 'operations/pinned');
    assert.equal(result.operationName, 'operations/other');
});

test('rejects a progress response without the official operation name', async () => {
    await assert.rejects(
        () => service.checkBatchOcrOperation({
            client: {
                checkBatchProcessDocumentsProgress: async () => [{
                    done: false,
                    metadata: { state: 'RUNNING' }
                }]
            },
            operationName: 'operations/pinned'
        }),
        /operation name/i
    );
});

test('accepts nested output destinations under the requested prefix and returns the actual destination', async () => {
    const check = (outputGcsDestination, expectedOutputUri = EXPECTED_OUTPUT_URI) => service.checkBatchOcrOperation({
        client: {
            checkBatchProcessDocumentsProgress: async () => [{
                name: 'operations/ocr-nested-output',
                done: true,
                metadata: {
                    individualProcessStatuses: [{
                        inputGcsSource: IMMUTABLE_SOURCE_URI,
                        outputGcsDestination,
                        status: { code: 0, message: '' }
                    }]
                }
            }]
        },
        operationName: 'operations/ocr-nested-output',
        expectedSourceUri: IMMUTABLE_SOURCE_URI,
        expectedOutputUri
    });

    const nestedDestination = `${EXPECTED_OUTPUT_URI}operations/ocr-nested-output/input/`;
    const nested = await check(nestedDestination);
    assert.equal(nested.error, null);
    assert.equal(nested.outputUri, nestedDestination);
    assert.deepEqual(nested.outputUris, [nestedDestination]);
    assert.deepEqual(nested.destinations, [nestedDestination]);
    assert.equal(nested.statuses[0].outputGcsDestination, nestedDestination);

    for (const [destination, expectedOutputUri] of [
        ['gs://private-books/ocr-other/operations/ocr-nested-output/input/', 'gs://private-books/ocr/'],
        ['gs://other-books/ocr/revision/operations/ocr-nested-output/input/', EXPECTED_OUTPUT_URI],
        ['gs://private-books/ocr/', EXPECTED_OUTPUT_URI]
    ]) {
        const rejected = await check(destination, expectedOutputUri);
        assert.equal(rejected.error.code, 'DOCUMENT_AI_OUTPUT_MISMATCH');
    }
});

test('marks terminal individual process status failures, missing output, and wrong input as errors', async () => {
    const check = (
        statuses,
        expectedSourceUri = IMMUTABLE_SOURCE_URI,
        expectedOutputUri = EXPECTED_OUTPUT_URI
    ) => service.checkBatchOcrOperation({
        client: {
            checkBatchProcessDocumentsProgress: async () => [{
                name: 'operations/ocr-status',
                done: true,
                metadata: { individualProcessStatuses: statuses }
            }]
        },
        operationName: 'operations/ocr-status',
        expectedSourceUri,
        expectedOutputUri
    });

    const failed = await check([{
        inputGcsSource: IMMUTABLE_SOURCE_URI,
        outputGcsDestination: EXPECTED_OUTPUT_URI,
        status: { code: '13', message: 'OCR failed' }
    }]);
    assert.deepEqual(failed.error, { code: 13, message: 'OCR failed' });
    assert.deepEqual(failed.statuses, [{
        inputGcsSource: IMMUTABLE_SOURCE_URI,
        outputGcsDestination: EXPECTED_OUTPUT_URI,
        status: { code: 13, message: 'OCR failed' }
    }]);

    const missingOutput = await check([{
        inputGcsSource: IMMUTABLE_SOURCE_URI,
        status: { code: 0, message: '' }
    }]);
    assert.match(missingOutput.error.message, /output/i);
    assert.equal(missingOutput.statuses[0].outputGcsDestination, null);

    const wrongInput = await check([{
        inputGcsSource: 'gs://other-bucket/book.pdf',
        outputGcsDestination: EXPECTED_OUTPUT_URI,
        status: { code: 0, message: '' }
    }]);
    assert.match(wrongInput.error.message, /input|source/i);

    const missingStatuses = await check([]);
    assert.match(missingStatuses.error.message, /status|source/i);

    const wrongOutput = await check([{
        inputGcsSource: IMMUTABLE_SOURCE_URI,
        outputGcsDestination: 'gs://private-books/ocr/other-revision/',
        status: { code: 0, message: '' }
    }]);
    assert.match(wrongOutput.error.message, /output/i);

    const multipleStatuses = await check([
        {
            inputGcsSource: IMMUTABLE_SOURCE_URI,
            outputGcsDestination: EXPECTED_OUTPUT_URI,
            status: { code: 0, message: '' }
        },
        {
            inputGcsSource: IMMUTABLE_SOURCE_URI,
            outputGcsDestination: EXPECTED_OUTPUT_URI
        }
    ]);
    assert.match(multipleStatuses.error.message, /status|document|exactly one|multiple/i);

    const noStatus = await check([{
        inputGcsSource: IMMUTABLE_SOURCE_URI,
        outputGcsDestination: EXPECTED_OUTPUT_URI.slice(0, -1)
    }]);
    assert.equal(noStatus.error, null);
    assert.equal(noStatus.statuses[0].status.code, 0);
});

test('threads source and output fences through the resumable poll helper', async () => {
    let received;
    const result = await service.pollBatchOcrOperation({
        operationName: 'operations/ocr-poll',
        expectedSourceUri: IMMUTABLE_SOURCE_URI,
        expectedOutputUri: EXPECTED_OUTPUT_URI,
        maxAttempts: 1,
        intervalMs: 0,
        client: {
            checkBatchProcessDocumentsProgress: async (operationName) => {
                received = operationName;
                return [{
                    name: operationName,
                    done: true,
                    metadata: {
                        individualProcessStatuses: [{
                            inputGcsSource: IMMUTABLE_SOURCE_URI,
                            outputGcsDestination: EXPECTED_OUTPUT_URI
                        }]
                    }
                }];
            }
        }
    });

    assert.equal(received, 'operations/ocr-poll');
    assert.equal(result.error, null);
});

test('parses Unicode source-faithful page and word anchors across shards in physical order', () => {
    const text0 = 'A🙂B';
    const text1 = 'Café';
    const shards = [
        makeShard({
            index: 0,
            count: 2,
            text: text0,
            pages: [{
                pageNumber: 1,
                layout: { textAnchor: anchor(0, Buffer.byteLength(text0)) },
                tokens: [{
                    layout: {
                        textAnchor: anchor(1, 5),
                        confidence: 0.91,
                        boundingPoly: { normalizedVertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
                    }
                }],
                imageQualityScores: { qualityScore: 0.88 }
            }]
        }),
        makeShard({
            index: 1,
            count: 2,
            textOffset: Buffer.byteLength(text0),
            pageOffset: 1,
            anchorIndexMode: 'global',
            text: text1,
            pages: [{
                pageNumber: 2,
                // This starts in shard 0 and ends in shard 1: explicit global mode.
                layout: { textAnchor: anchor(5, 9) },
                tokens: [{
                    layout: {
                        textAnchor: anchor(6, 11),
                        boundingPoly: { vertices: [{ x: 2, y: 3 }] }
                    }
                }]
            }]
        })
    ];

    const result = service.parseDocumentAiOutput({
        shards: shards.slice().reverse(),
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    });

    assert.deepEqual(result.pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
        qualityScore: page.imageQualityScore
    })), [
        { pageNumber: 1, text: 'A🙂B', qualityScore: 0.88 },
        { pageNumber: 2, text: 'BCaf', qualityScore: null }
    ]);
    assert.equal(result.pages[0].words[0].text, '🙂');
    assert.equal(result.pages[0].words[0].confidence, 0.91);
    assert.deepEqual(result.pages[0].words[0].boundingPoly.normalizedVertices, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    assert.equal(result.pages[1].words[0].text, 'Café');
    assert.equal(result.pages[1].words[0].confidence, null);
    assert.deepEqual(result.pages[1].words[0].boundingPoly.vertices, [{ x: 2, y: 3 }]);
    assert.deepEqual(result.shardHashes, shards.map((shard) => ({
        shardIndex: Number(shard.json.shardInfo.shardIndex),
        sha256: sha256(shard.raw)
    })));
    assert.equal(result.outputSha256, sha256(shards.map((shard) => shard.raw).join('')));
});

test('adds UTF-8 local shard offsets even when an anchor crosses into a later shard', () => {
    const first = makeShard({
        index: 0,
        count: 3,
        text: 'éA',
        pages: [{ pageNumber: 1 }]
    });
    const second = makeShard({
        index: 1,
        count: 3,
        textOffset: Buffer.byteLength(first.json.text),
        text: 'BB',
        pages: [{ pageNumber: 2, layout: { textAnchor: anchor(0, 4) } }]
    });
    const third = makeShard({
        index: 2,
        count: 3,
        textOffset: Buffer.byteLength(first.json.text) + Buffer.byteLength(second.json.text),
        text: 'CC',
        pages: [{ pageNumber: 3 }]
    });

    const result = service.parseDocumentAiOutput({
        shards: [third, first, second],
        expectedPageCount: 3,
        expectedSourceGeneration: 'generation-1'
    });

    assert.equal(result.pages[1].text, 'BBCC');
});

test('uses official pageNumber without adding pageOffset or emitting a custom physical page field', () => {
    const result = service.parseDocumentAiOutput({
        shards: [makeShard({
            index: 0,
            pageOffset: 99,
            text: 'Page one',
            pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, 8) } }]
        })],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1'
    });

    assert.equal(result.pages[0].pageNumber, 1);
    assert.equal('physicalPageNumber' in result.pages[0], false);
});

test('uses a non-empty fallback anchor when a preferred anchor is present but empty', () => {
    const text = 'Fallback';
    const result = service.parseDocumentAiOutput({
        shards: [makeShard({
            index: 0,
            text,
            pages: [{
                pageNumber: 1,
                layout: { textAnchor: { textSegments: [] } },
                textAnchor: anchor(0, Buffer.byteLength(text)),
                tokens: [{
                    layout: { textAnchor: { textSegments: [] } },
                    textAnchor: anchor(0, Buffer.byteLength(text))
                }]
            }]
        })],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1'
    });

    assert.equal(result.pages[0].text, text);
    assert.equal(result.pages[0].words[0].text, text);
});

test('accepts directly supplied parsed JSON output shards', () => {
    const shard = makeShard({
        index: 0,
        text: 'Direct JSON',
        pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, 11) } }]
    });
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [shard.json],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1'
    }), /raw|allowParsedJsonForTests/i);
    const result = service.parseDocumentAiOutput({
        shards: [shard.json],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1',
        allowParsedJsonForTests: true
    });

    assert.equal(result.pages[0].text, 'Direct JSON');
    assert.equal(result.provenanceVerified, false);
});

test('parses a direct raw flattened Buffer with the default local anchor mode', () => {
    const text = 'Raw buffer';
    const payload = {
        shardInfo: { shardIndex: '0', shardCount: '1', textOffset: '0' },
        text,
        pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, Buffer.byteLength(text)) } }]
    };
    const result = service.parseDocumentAiOutput({
        shards: [Buffer.from(JSON.stringify(payload), 'utf8')],
        expectedPageCount: 1
    });

    assert.equal(result.pages[0].text, text);
    assert.equal(result.provenanceVerified, true);
});

test('rejects malformed UTF-8 in authoritative raw output bytes', () => {
    const prefix = Buffer.from('{"shardInfo":{"shardIndex":"0","shardCount":"1","textOffset":"0"},"text":"', 'utf8');
    const suffix = Buffer.from('","pages":[{"pageNumber":1}]}', 'utf8');
    const malformed = Buffer.concat([prefix, Buffer.from([0xc3]), suffix]);

    assert.throws(() => service.parseDocumentAiOutput({ shards: [malformed] }), /utf-8|encoding|raw/i);
});

test('parses official flattened Document JSON from authoritative raw bytes', () => {
    const payload = {
        shardInfo: { shardIndex: '0', shardCount: '1', textOffset: '0', pageOffset: '0' },
        sourceGeneration: 'untrusted-json-generation',
        sourceSha256: 'untrusted-json-sha',
        text: 'Résumé',
        pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, Buffer.byteLength('Résumé')) } }]
    };
    const result = service.parseDocumentAiOutput({
        shards: [{
            raw: Buffer.from(JSON.stringify(payload), 'utf8'),
            sourceGeneration: 'generation-1',
            sourceSha256: SOURCE_SHA256
        }],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1',
        expectedSourceSha256: SOURCE_SHA256
    });

    assert.equal(result.pages[0].text, 'Résumé');
    assert.equal(result.provenanceVerified, true);
    assert.equal(result.sourceGeneration, 'generation-1');
    assert.equal(result.sourceSha256, SOURCE_SHA256);
});

test('rejects a wrapper JSON mismatch and never trusts OCR-embedded source hashes', () => {
    const shard = makeShard({
        index: 0,
        text: 'Authoritative',
        pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, 13) } }]
    });
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [{
            raw: Buffer.from(shard.raw, 'utf8'),
            json: { ...shard.json, text: 'Tampered' },
            sourceGeneration: 'generation-1',
            sourceSha256: SOURCE_SHA256
        }],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1',
        expectedSourceSha256: SOURCE_SHA256
    }), /raw.*json|mismatch/i);
});

test('rejects configured shard, byte, page, and anchor limits before accepting output', () => {
    const first = makeShard({
        index: 0,
        count: 2,
        text: 'one',
        pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, 3) } }]
    });
    const second = makeShard({
        index: 1,
        count: 2,
        textOffset: 3,
        text: 'two',
        pages: [{ pageNumber: 2, layout: { textAnchor: anchor(0, 3) } }]
    });
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [first, second], limits: { maxShards: 1 }
    }), /max.*shard/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [first], limits: { maxShardBytes: 1 }
    }), /shard.*byte|max.*byte/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [first, second], limits: { maxTotalBytes: 1 }
    }), /total.*byte|max.*byte/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [makeShard({ index: 0, text: 'one', pages: [{ pageNumber: 1 }, { pageNumber: 2 }] })],
        limits: { maxPages: 1 }
    }), /max.*pages|page limit/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [makeShard({
            index: 0,
            text: 'one',
            pages: [{ pageNumber: 1, layout: { textAnchor: { textSegments: [
                { startIndex: '0', endIndex: '1' },
                { startIndex: '1', endIndex: '3' }
            ] } } }]
        })],
        limits: { maxAnchorSegments: 1 }
    }), /anchor.*segment|max.*anchor/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [makeShard({ index: 0, text: 'one', pages: [] })], expectedPageCount: 501
    }), /max.*pages|500|page limit/i);
});

test('preserves explicit blank pages and normalizes missing confidence and quality to null', () => {
    const result = service.parseDocumentAiOutput({
        shards: [makeShard({
            index: 0,
            text: 'Visible',
            pages: [
                { pageNumber: 1, layout: { textAnchor: anchor(0, 7) }, imageQualityScores: { qualityScore: 0 } },
                { pageNumber: 2, layout: { textAnchor: { textSegments: [] } }, imageQualityScores: {} }
            ]
        })],
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    });

    assert.equal(result.pages.length, 2);
    assert.equal(result.pages[1].pageNumber, 2);
    assert.equal(result.pages[1].text, '');
    assert.equal(result.pages[1].isBlank, true);
    assert.deepEqual(result.pages[1].words, []);
    assert.equal(result.pages[0].imageQualityScore, 0);
    assert.equal(result.pages[1].imageQualityScore, null);
});

test('rejects wrong source generation, duplicate or missing shards, malformed pages, duplicate pages, and count mismatches', () => {
    const base = makeShard({ index: 0, count: 2, text: 'one', pages: [{ pageNumber: 1, layout: { textAnchor: anchor(0, 3) } }] });
    const second = makeShard({ index: 1, count: 2, textOffset: 3, text: 'two', pages: [{ pageNumber: 2, layout: { textAnchor: anchor(0, 3) } }] });

    assert.throws(() => service.parseDocumentAiOutput({
        shards: [{ ...base, sourceGeneration: 'wrong' }, second],
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    }), /source generation/i);
    const duplicateShardJson = { ...second.json, shardInfo: { ...second.json.shardInfo, shardIndex: '0' } };
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [base, { ...second, json: duplicateShardJson, raw: JSON.stringify(duplicateShardJson) }],
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    }), /duplicate shard/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [base],
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    }), /expected .*output shards|missing shard|shard count/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [makeShard({ index: 0, text: 'one', pages: [{ pageNumber: 0, layout: { textAnchor: anchor(0, 3) } }] })],
        expectedPageCount: 1,
        expectedSourceGeneration: 'generation-1'
    }), /page number/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [makeShard({
            index: 0,
            text: 'one',
            pages: [
                { pageNumber: 1, layout: { textAnchor: anchor(0, 1) } },
                { pageNumber: 1, layout: { textAnchor: anchor(0, 1) } }
            ]
        })],
        expectedPageCount: 2,
        expectedSourceGeneration: 'generation-1'
    }), /duplicate page/i);
    assert.throws(() => service.parseDocumentAiOutput({
        shards: [base, second],
        expectedPageCount: 3,
        expectedSourceGeneration: 'generation-1'
    }), /page.?count|missing page/i);
});

test('surfaces a terminal processor error without attempting a new batch request', async () => {
    let submitted = false;
    const result = await service.checkBatchOcrOperation({
        client: {
            batchProcessDocuments: async () => {
                submitted = true;
                return [{ name: 'operations/new' }];
            },
                checkBatchProcessDocumentsProgress: async () => [{
                name: 'operations/ocr-failed',
                done: true,
                error: { code: 13, message: 'processor failed' },
                metadata: { state: 'FAILED', outputUri: 'gs://private-books/ocr/revision/' }
            }]
        },
        operationName: 'operations/ocr-failed'
    });

    assert.equal(submitted, false);
    assert.equal(result.done, true);
    assert.deepEqual(result.error, { code: 13, message: 'processor failed' });
    assert.deepEqual(result.metadata, { state: 'FAILED', outputUri: 'gs://private-books/ocr/revision/' });
    assert.equal(result.outputUri, 'gs://private-books/ocr/revision/');
    assert.deepEqual(result.outputUris, ['gs://private-books/ocr/revision/']);
    assert.deepEqual(result.destinations, ['gs://private-books/ocr/revision/']);
    assert.deepEqual(result.statuses, []);
});
