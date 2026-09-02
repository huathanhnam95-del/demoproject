const crypto = require('node:crypto');

const CONFIG_KEYS = Object.freeze([
    'CRM_BOOKS_DOCUMENT_AI_PROCESSOR',
    'CRM_BOOKS_DOCUMENT_AI_LOCATION',
    'CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION'
]);

const DEFAULT_PARSE_LIMITS = Object.freeze({
    maxShards: 1000,
    maxShardBytes: 50 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
    maxPages: 500,
    maxAnchorSegments: 500000
});

function fail(code, message) {
    throw new Error(`${code}: ${message}`);
}

function requiredString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail('DOCUMENT_AI_CONFIG_INVALID', `${name} is required`);
    }
    return value.trim();
}

function requiredExactString(value, name) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
        fail('DOCUMENT_AI_SOURCE_INVALID', `${name} is required and must be exact`);
    }
    return value;
}

function validateRevisionId(revisionId) {
    const value = requiredExactString(revisionId, 'revisionId');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
        fail('DOCUMENT_AI_SOURCE_INVALID', 'revisionId contains invalid path characters');
    }
    return value;
}

function validateSourceSha256(sourceSha256) {
    const value = requiredExactString(sourceSha256, 'sourceSha256');
    if (!/^[a-f0-9]{64}$/i.test(value)) {
        fail('DOCUMENT_AI_SOURCE_INVALID', 'sourceSha256 must be a 64-character hexadecimal SHA-256');
    }
    return value.toLowerCase();
}

function validateImmutableSourceUri(sourceUri, revisionId) {
    validateGsPdfUri(sourceUri, 'sourceUri');
    if (!sourceUri.includes(`/text-revisions/${revisionId}/source/`)) {
        fail('DOCUMENT_AI_SOURCE_INVALID', 'sourceUri must be under the immutable text-revisions source path');
    }
    return sourceUri;
}

function resolveDocumentAiConfig(env = process.env) {
    const processor = requiredString(env.CRM_BOOKS_DOCUMENT_AI_PROCESSOR, 'CRM_BOOKS_DOCUMENT_AI_PROCESSOR');
    const location = requiredString(env.CRM_BOOKS_DOCUMENT_AI_LOCATION, 'CRM_BOOKS_DOCUMENT_AI_LOCATION');
    const processorVersion = requiredString(
        env.CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION,
        'CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION'
    );

    const processorMatch = /^projects\/([^/]+)\/locations\/([^/]+)\/processors\/([^/]+)$/.exec(processor);
    if (!processorMatch) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'CRM_BOOKS_DOCUMENT_AI_PROCESSOR must be a processor resource');
    }
    const versionMatch = /^projects\/([^/]+)\/locations\/([^/]+)\/processors\/([^/]+)\/processorVersions\/([^/]+)$/.exec(processorVersion);
    if (!versionMatch) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'CRM_BOOKS_DOCUMENT_AI_PROCESSOR_VERSION must be a complete processor version resource');
    }
    if (processorMatch[1] !== versionMatch[1]) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'processor and processor version projects do not match');
    }
    if (processorMatch[2] !== location || versionMatch[2] !== location) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'configured location and processor resources do not match');
    }
    if (processorMatch[3] !== versionMatch[3]) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'processor and processor version resources do not match');
    }

    return { processor, location, processorVersion };
}

function createDocumentProcessorClient({ config, clientFactory } = {}) {
    const resolvedConfig = config || resolveDocumentAiConfig();
    const options = { apiEndpoint: `${resolvedConfig.location}-documentai.googleapis.com` };
    if (typeof clientFactory === 'function') {
        return clientFactory(options);
    }

    // Require the SDK only when a real client is requested. Tests and callers
    // that inject a client can therefore run without credentials or a network.
    const documentai = require('@google-cloud/documentai');
    const Client = documentai.v1 && documentai.v1.DocumentProcessorServiceClient
        ? documentai.v1.DocumentProcessorServiceClient
        : documentai.DocumentProcessorServiceClient;
    if (typeof Client !== 'function') {
        fail('DOCUMENT_AI_CLIENT_UNAVAILABLE', 'DocumentProcessorServiceClient v1 is not exported by the SDK');
    }
    return new Client(options);
}

function validateGsPdfUri(uri, name) {
    if (typeof uri !== 'string' || !/^gs:\/\/[^/\s]+\/[^?#\s]+\.pdf$/i.test(uri)) {
        fail('DOCUMENT_AI_REQUEST_INVALID', `${name} must be a private gs:// PDF URI`);
    }
    return uri;
}

function buildBatchProcessRequest({ config, sourceUri, outputUri } = {}) {
    const resolvedConfig = config || resolveDocumentAiConfig();
    if (!resolvedConfig.processorVersion) {
        fail('DOCUMENT_AI_CONFIG_INVALID', 'processor version is required');
    }
    validateGsPdfUri(sourceUri, 'sourceUri');
    if (typeof outputUri !== 'string' || !/^gs:\/\/[^/\s]+\/[^?#\s]+\/$/.test(outputUri)) {
        fail('DOCUMENT_AI_REQUEST_INVALID', 'outputUri must be a gs:// URI with a trailing slash');
    }

    return {
        name: resolvedConfig.processorVersion,
        inputDocuments: {
            gcsDocuments: {
                documents: [{ gcsUri: sourceUri, mimeType: 'application/pdf' }]
            }
        },
        documentOutputConfig: {
            gcsOutputConfig: {
                gcsUri: outputUri,
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
    };
}

function resolveClient({ client, config } = {}) {
    return client || createDocumentProcessorClient({ config });
}

function operationFromResponse(response) {
    if (Array.isArray(response)) return response[0];
    if (response && Array.isArray(response.operations)) return response.operations[0];
    return response;
}

async function submitBatchOcr({ config, client, revisionId, sourceUri, sourceGeneration, sourceSha256, outputUri } = {}) {
    const revision = validateRevisionId(revisionId);
    const generation = requiredExactString(sourceGeneration, 'sourceGeneration');
    const sourceHash = validateSourceSha256(sourceSha256);
    validateImmutableSourceUri(sourceUri, revision);
    const request = buildBatchProcessRequest({ config, sourceUri, outputUri });
    const resolvedClient = resolveClient({ client, config });
    if (!resolvedClient || typeof resolvedClient.batchProcessDocuments !== 'function') {
        fail('DOCUMENT_AI_CLIENT_INVALID', 'batchProcessDocuments is required');
    }
    const response = await resolvedClient.batchProcessDocuments(request);
    const operation = operationFromResponse(response);
    if (!operation || typeof operation.name !== 'string' || operation.name.trim() === '') {
        fail('DOCUMENT_AI_OPERATION_NAME_MISSING', 'Document AI did not return an operation name');
    }
    return {
        operationName: operation.name.trim(),
        revisionId: revision,
        sourceUri,
        sourceGeneration: generation,
        sourceSha256: sourceHash,
        outputUri,
        processorVersion: request.name,
        request
    };
}

function normalizeError(error) {
    if (!error) return null;
    if (typeof error !== 'object') return { message: String(error) };
    const normalized = {};
    if (error.code !== undefined) normalized.code = Number(error.code);
    if (error.message !== undefined) normalized.message = String(error.message);
    for (const [key, value] of Object.entries(error)) {
        if (!(key in normalized)) normalized[key] = value;
    }
    return normalized;
}

function normalizeProcessStatus(status) {
    const source = status && typeof status === 'object' ? status : {};
    const rawStatus = source.status && typeof source.status === 'object' ? source.status : {};
    const codeValue = rawStatus.code === undefined || rawStatus.code === null || rawStatus.code === ''
        ? 0
        : Number(rawStatus.code);
    const code = Number.isFinite(codeValue) ? codeValue : -1;
    const message = rawStatus.message === undefined || rawStatus.message === null
        ? ''
        : String(rawStatus.message);
    const inputGcsSource = firstDefined(source.inputGcsSource, source.input_gcs_source);
    const outputGcsDestination = firstDefined(source.outputGcsDestination, source.output_gcs_destination);
    return {
        inputGcsSource: typeof inputGcsSource === 'string' && inputGcsSource.trim() !== ''
            ? inputGcsSource.trim()
            : null,
        outputGcsDestination: typeof outputGcsDestination === 'string' && outputGcsDestination.trim() !== ''
            ? outputGcsDestination.trim()
            : null,
        status: { code, message }
    };
}

function normalizeOutputPrefix(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    const withoutTrailingSlashes = value.replace(/\/+$/, '');
    return `${withoutTrailingSlashes}/`;
}

function isOutputDestinationWithinPrefix(destination, expectedPrefix) {
    const normalizedDestination = normalizeOutputPrefix(destination);
    const normalizedPrefix = normalizeOutputPrefix(expectedPrefix);
    return normalizedDestination !== null
        && normalizedPrefix !== null
        && (normalizedDestination === normalizedPrefix || normalizedDestination.startsWith(normalizedPrefix));
}

function fallbackOutputUris(operation) {
    const fallbackCandidates = [
        operation && operation.outputUri,
        operation && operation.metadata && operation.metadata.outputUri,
        operation && operation.metadata && operation.metadata.outputUris,
        operation && operation.response && operation.response.documentOutputConfig
            && operation.response.documentOutputConfig.gcsOutputConfig
            && operation.response.documentOutputConfig.gcsOutputConfig.gcsUri,
        operation && operation.response && operation.response.outputUri,
        operation && operation.response && operation.response.outputConfig
            && operation.response.outputConfig.gcsUri
    ];
    const fallbackUris = [];
    for (const candidate of fallbackCandidates) {
        const values = Array.isArray(candidate) ? candidate : [candidate];
        for (const value of values) {
            if (typeof value === 'string' && value.trim() !== '' && !fallbackUris.includes(value.trim())) {
                fallbackUris.push(value.trim());
            }
        }
    }
    return fallbackUris;
}

async function checkBatchOcrOperation({
    operationName,
    client,
    config,
    expectedSourceUri,
    expectedOutputUri
} = {}) {
    if (typeof operationName !== 'string' || operationName.trim() === '') {
        fail('DOCUMENT_AI_OPERATION_NAME_MISSING', 'operationName is required to resume Document AI');
    }
    const requestedOperationName = operationName.trim();
    const resolvedClient = resolveClient({ client, config });
    let response;
    if (typeof resolvedClient.checkBatchProcessDocumentsProgress === 'function') {
        response = await resolvedClient.checkBatchProcessDocumentsProgress(requestedOperationName);
    } else if (resolvedClient.operationsClient && typeof resolvedClient.operationsClient.getOperation === 'function') {
        response = await resolvedClient.operationsClient.getOperation({ name: requestedOperationName });
    } else {
        fail('DOCUMENT_AI_CLIENT_INVALID', 'a progress-check method is required to resume Document AI');
    }
    const operation = operationFromResponse(response);
    if (!operation || typeof operation.name !== 'string' || operation.name.trim() === '') {
        fail('DOCUMENT_AI_OPERATION_NAME_MISSING', 'Document AI progress response did not return an operation name');
    }
    const returnedOperationName = operation.name.trim();
    const done = operation.done === true || operation.done === 'true';
    const rawStatuses = operation.metadata
        && (operation.metadata.individualProcessStatuses || operation.metadata.individual_process_statuses);
    const statuses = Array.isArray(rawStatuses) ? rawStatuses.map(normalizeProcessStatus) : [];
    const statusDestinations = [];
    for (const status of statuses) {
        if (status.outputGcsDestination && !statusDestinations.includes(status.outputGcsDestination)) {
            statusDestinations.push(status.outputGcsDestination);
        }
    }
    const outputUris = Array.isArray(rawStatuses) ? statusDestinations : fallbackOutputUris(operation);
    let error = normalizeError(operation.error);
    if (done && !error && expectedSourceUri !== undefined && expectedSourceUri !== null && statuses.length === 0) {
        error = {
            code: 'DOCUMENT_AI_PROCESS_STATUS_MISSING',
            message: 'terminal operation did not provide individual process statuses for source verification'
        };
    }
    if (done && !error) {
        if (!Array.isArray(rawStatuses) || statuses.length !== 1) {
            error = {
                code: 'DOCUMENT_AI_PROCESS_STATUS_COUNT_INVALID',
                message: 'terminal operation must contain exactly one individual process status'
            };
        } else if (typeof expectedSourceUri !== 'string' || expectedSourceUri.length === 0) {
            error = {
                code: 'DOCUMENT_AI_EXPECTED_SOURCE_MISSING',
                message: 'expected source URI is required for terminal verification'
            };
        } else if (typeof expectedOutputUri !== 'string' || expectedOutputUri.length === 0) {
            error = {
                code: 'DOCUMENT_AI_EXPECTED_OUTPUT_MISSING',
                message: 'expected output URI is required for terminal verification'
            };
        } else {
            const status = statuses[0];
            if (status.inputGcsSource !== expectedSourceUri) {
                error = {
                    code: 'DOCUMENT_AI_INPUT_SOURCE_MISMATCH',
                    message: 'terminal output input source does not match expected source URI'
                };
            } else if (status.status.code !== 0) {
                error = {
                    code: status.status.code,
                    message: status.status.message || `terminal process status code ${status.status.code}`
                };
            } else if (!status.outputGcsDestination) {
                error = {
                    code: 'DOCUMENT_AI_OUTPUT_MISSING',
                    message: 'terminal process status is missing an output destination'
                };
            } else if (!isOutputDestinationWithinPrefix(status.outputGcsDestination, expectedOutputUri)) {
                error = {
                    code: 'DOCUMENT_AI_OUTPUT_MISMATCH',
                    message: 'terminal output destination does not match expected output URI'
                };
            }
        }
    }
    return {
        done,
        operationName: returnedOperationName,
        metadata: operation.metadata || null,
        error,
        outputUri: outputUris[0] || null,
        outputUris,
        destinations: outputUris,
        statuses
    };
}

async function pollBatchOcrOperation({
    operationName,
    client,
    config,
    expectedSourceUri,
    expectedOutputUri,
    maxAttempts = 60,
    intervalMs = 1000,
    sleep
} = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        fail('DOCUMENT_AI_POLL_INVALID', 'maxAttempts must be a positive integer');
    }
    const wait = typeof sleep === 'function'
        ? sleep
        : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const status = await checkBatchOcrOperation({
            operationName,
            client,
            config,
            expectedSourceUri,
            expectedOutputUri
        });
        if (status.done) return status;
        if (attempt < maxAttempts - 1 && intervalMs > 0) await wait(intervalMs);
    }
    fail('DOCUMENT_AI_POLL_TIMEOUT', `operation ${operationName} did not complete within ${maxAttempts} checks`);
}

function parseInteger(value, name, { min = 0 } = {}) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < min) fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} is malformed`);
        return value;
    }
    if (typeof value !== 'string' || !new RegExp(`^\\d+$`).test(value.trim())) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} is malformed`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min) fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} is malformed`);
    return parsed;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function parseJsonPayload(value) {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        const raw = Buffer.from(value);
        const decoded = raw.toString('utf8');
        if (!Buffer.from(decoded, 'utf8').equals(raw)) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', 'output shard contains malformed UTF-8');
        }
        try {
            return { raw, json: JSON.parse(decoded) };
        } catch (error) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard is not valid JSON: ${error.message}`);
        }
    }
    if (typeof value === 'string') {
        const raw = Buffer.from(value, 'utf8');
        try {
            return { raw, json: JSON.parse(value) };
        } catch (error) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard is not valid JSON: ${error.message}`);
        }
    }
    return null;
}

function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((result, key) => {
            result[key] = canonicalJson(value[key]);
            return result;
        }, {});
    }
    return value;
}

function resolveParseLimits(limits = {}) {
    const aliases = {
        maxShards: ['maxShards', 'maxOutputShards'],
        maxShardBytes: ['maxShardBytes', 'maxOutputShardBytes'],
        maxTotalBytes: ['maxTotalBytes', 'maxOutputBytes'],
        maxPages: ['maxPages'],
        maxAnchorSegments: ['maxAnchorSegments']
    };
    const resolved = {};
    for (const [name, names] of Object.entries(aliases)) {
        const value = names.map((key) => limits[key]).find((candidate) => candidate !== undefined);
        resolved[name] = value === undefined ? DEFAULT_PARSE_LIMITS[name] : value;
        if (!Number.isSafeInteger(resolved[name]) || resolved[name] < 1) {
            fail('DOCUMENT_AI_LIMIT_INVALID', `${name} must be a positive integer`);
        }
    }
    return resolved;
}

function enforceRawLimits(raw, position, state, limits) {
    if (raw.length > limits.maxShardBytes) {
        fail('DOCUMENT_AI_OUTPUT_LIMIT', `shard ${position} exceeds the per-shard byte limit`);
    }
    state.totalBytes += raw.length;
    if (state.totalBytes > limits.maxTotalBytes) {
        fail('DOCUMENT_AI_OUTPUT_LIMIT', 'output shards exceed the total byte limit');
    }
}

function documentFromJson(json, position, allowWrappedDocument) {
    const hasOfficialShape = Object.prototype.hasOwnProperty.call(json, 'text')
        || Object.prototype.hasOwnProperty.call(json, 'pages');
    if (hasOfficialShape) return json;
    if (json.document && typeof json.document === 'object') {
        if (!allowWrappedDocument) {
            fail('DOCUMENT_AI_WRAPPER_INVALID', `shard ${position} must use flattened Document JSON`);
        }
        return json.document;
    }
    fail('DOCUMENT_AI_OUTPUT_INVALID', `shard ${position} has no flattened Document payload`);
}

function normalizeShard(entry, position, { allowParsedJsonForTests = false, allowWrappedDocument = false, limits, state } = {}) {
    const isObject = entry && typeof entry === 'object' && !Buffer.isBuffer(entry)
        && !(entry instanceof Uint8Array) && !Array.isArray(entry);
    const providedJson = isObject && entry.json !== undefined ? entry.json : undefined;
    const hasRaw = isObject && entry.raw !== undefined;
    const rawCandidate = hasRaw ? entry.raw : (Buffer.isBuffer(entry) || entry instanceof Uint8Array || typeof entry === 'string' ? entry : undefined);
    let json;
    let raw;
    let provenanceVerified = true;

    if (rawCandidate !== undefined) {
        raw = Buffer.isBuffer(rawCandidate) || rawCandidate instanceof Uint8Array
            ? Buffer.from(rawCandidate)
            : typeof rawCandidate === 'string' ? Buffer.from(rawCandidate, 'utf8') : null;
        if (!raw) fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard ${position} raw payload is invalid`);
        if (limits && state) enforceRawLimits(raw, position, state, limits);
        const parsed = parseJsonPayload(raw);
        json = parsed && parsed.json;
        if (!json || typeof json !== 'object') fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard ${position} is not an object`);
        if (providedJson !== undefined && JSON.stringify(canonicalJson(providedJson)) !== JSON.stringify(canonicalJson(json))) {
            fail('DOCUMENT_AI_RAW_JSON_MISMATCH', `output shard ${position} raw and wrapper JSON differ`);
        }
    } else {
        if (!allowParsedJsonForTests) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard ${position} requires authoritative raw bytes`);
        }
        json = providedJson !== undefined ? providedJson : entry;
        if (!json || typeof json !== 'object' || Buffer.isBuffer(json) || json instanceof Uint8Array) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', `output shard ${position} is not an object`);
        }
        raw = Buffer.from(JSON.stringify(json), 'utf8');
        if (limits && state) enforceRawLimits(raw, position, state, limits);
        provenanceVerified = false;
    }

    const document = documentFromJson(json, position, allowWrappedDocument);
    const info = json.shardInfo || json.shard_info || {};
    const shardIndex = parseInteger(firstDefined(info.shardIndex, info.shard_index, 0), `shard ${position} index`);
    const shardCount = parseInteger(firstDefined(info.shardCount, info.shard_count, 1), `shard ${position} count`, { min: 1 });
    const textOffset = parseInteger(firstDefined(info.textOffset, info.text_offset, 0), `shard ${position} text offset`);
    const sourceGeneration = isObject ? entry.sourceGeneration : undefined;
    const sourceSha256 = isObject ? entry.sourceSha256 : undefined;
    const anchorIndexMode = firstDefined(isObject ? entry.anchorIndexMode : undefined, 'local');
    if (anchorIndexMode !== 'local' && anchorIndexMode !== 'global') {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `shard ${position} anchorIndexMode must be local or global`);
    }
    return {
        json,
        document,
        raw,
        shardIndex,
        shardCount,
        textOffset,
        anchorIndexMode,
        provenanceVerified,
        sourceGeneration: sourceGeneration === undefined || sourceGeneration === null ? null : String(sourceGeneration),
        sourceSha256: sourceSha256 === undefined || sourceSha256 === null ? null : String(sourceSha256).toLowerCase()
    };
}

function utf8Text(value, name) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} text is not a string`);
    return value;
}

function buildGlobalText(shards) {
    let cursor = 0;
    const pieces = [];
    for (const shard of shards) {
        const text = utf8Text(shard.document.text, `shard ${shard.shardIndex}`);
        const bytes = Buffer.from(text, 'utf8');
        if (shard.textOffset !== cursor) {
            fail('DOCUMENT_AI_OUTPUT_INVALID', `shard ${shard.shardIndex} text offset is not contiguous`);
        }
        pieces.push(bytes);
        cursor += bytes.length;
    }
    return Buffer.concat(pieces);
}

function nonEmptyTextSegments(anchorValue) {
    if (!anchorValue || typeof anchorValue !== 'object') return [];
    const segments = firstDefined(anchorValue.textSegments, anchorValue.text_segments, []);
    return Array.isArray(segments) ? segments : [];
}

function pickAnchor(...values) {
    for (const value of values) {
        if (nonEmptyTextSegments(value).length > 0) return value;
    }
    return null;
}

function decodeSlice(globalBytes, start, end, name) {
    if (start < 0 || end < start || end > globalBytes.length) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} anchor is out of range`);
    }
    const slice = globalBytes.subarray(start, end);
    const text = slice.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(slice)) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} anchor splits a UTF-8 character`);
    }
    return text;
}

function segmentBounds(segment, shard, globalLength, name) {
    if (!segment || typeof segment !== 'object') fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} segment is malformed`);
    const startValue = firstDefined(segment.startIndex, segment.start_index, 0);
    const endValue = firstDefined(segment.endIndex, segment.end_index);
    if (endValue === undefined) fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} segment end is missing`);
    const start = parseInteger(startValue, `${name} segment start`);
    const end = parseInteger(endValue, `${name} segment end`);
    if (end < start) fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} segment is reversed`);

    const offset = shard.anchorIndexMode === 'global' ? 0 : shard.textOffset;
    const resolvedStart = start + offset;
    const resolvedEnd = end + offset;
    if (resolvedEnd > globalLength) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `${name} segment is out of range`);
    }
    return [resolvedStart, resolvedEnd];
}

function anchorText(anchorValue, shard, globalBytes, name, state, limits) {
    const segments = nonEmptyTextSegments(anchorValue);
    if (state && limits) {
        state.anchorSegments += segments.length;
        if (state.anchorSegments > limits.maxAnchorSegments) {
            fail('DOCUMENT_AI_OUTPUT_LIMIT', 'output exceeds the anchor segment limit');
        }
    }
    return segments.map((segment, index) => {
        const [start, end] = segmentBounds(segment, shard, globalBytes.length, `${name}[${index}]`);
        return decodeSlice(globalBytes, start, end, `${name}[${index}]`);
    }).join('');
}

function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function pageTokens(page, shard, globalBytes, pageNumber, state, limits) {
    const tokens = Array.isArray(page.tokens) ? page.tokens : [];
    return tokens.map((token, index) => {
        const layout = token && token.layout;
        const tokenAnchor = pickAnchor(
            layout && (layout.textAnchor || layout.text_anchor),
            token && (token.textAnchor || token.text_anchor)
        );
        const text = tokenAnchor
            ? anchorText(tokenAnchor, shard, globalBytes, `page ${pageNumber} token ${index}`, state, limits)
            : '';
        const confidence = numberOrNull(firstDefined(
            layout && layout.confidence,
            token && token.confidence
        ));
        const boundingPoly = firstDefined(
            layout && (layout.boundingPoly || layout.bounding_poly),
            token && (token.boundingPoly || token.bounding_poly),
            null
        );
        return { text, confidence, boundingPoly, box: boundingPoly };
    });
}

function processorErrorFromJson(json) {
    const error = json && json.error;
    if (!error) return null;
    const normalized = normalizeError(error);
    if (!normalized || normalized.code === 0 || normalized.message === '') return null;
    return normalized;
}

function parseDocumentAiOutput({
    shards,
    expectedPageCount,
    expectedSourceGeneration,
    expectedSourceSha256,
    allowParsedJsonForTests = false,
    allowWrappedDocument = false,
    limits: configuredLimits
} = {}) {
    if (!Array.isArray(shards) || shards.length === 0) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', 'at least one output shard is required');
    }
    const limits = resolveParseLimits(configuredLimits);
    if (shards.length > limits.maxShards) {
        fail('DOCUMENT_AI_OUTPUT_LIMIT', 'output exceeds the maximum shard limit');
    }
    const expectedGeneration = expectedSourceGeneration === undefined || expectedSourceGeneration === null
        ? null
        : String(expectedSourceGeneration);
    const expectedSourceHash = expectedSourceSha256 === undefined || expectedSourceSha256 === null
        ? null
        : validateSourceSha256(expectedSourceSha256);
    const state = { totalBytes: 0, anchorSegments: 0 };
    const normalized = [];
    for (let index = 0; index < shards.length; index += 1) {
        normalized.push(normalizeShard(shards[index], index, {
            allowParsedJsonForTests,
            allowWrappedDocument,
            limits,
            state
        }));
    }
    for (const shard of normalized) {
        if (expectedGeneration !== null && shard.sourceGeneration !== null
            && shard.sourceGeneration !== expectedGeneration) {
            fail('DOCUMENT_AI_SOURCE_GENERATION_MISMATCH', `shard ${shard.shardIndex} has the wrong source generation`);
        }
        if (expectedSourceHash !== null && shard.sourceSha256 !== null
            && shard.sourceSha256 !== expectedSourceHash) {
            fail('DOCUMENT_AI_SOURCE_SHA256_MISMATCH', `shard ${shard.shardIndex} has the wrong source SHA-256`);
        }
        const processorError = processorErrorFromJson(shard.json);
        if (processorError) {
            fail('DOCUMENT_AI_PROCESSOR_ERROR', processorError.message || 'Document AI processor error');
        }
    }

    const shardCount = normalized[0].shardCount;
    if (shardCount !== normalized.length) {
        fail('DOCUMENT_AI_OUTPUT_INVALID', `expected ${shardCount} output shards, received ${normalized.length}`);
    }
    const byIndex = new Map();
    for (const shard of normalized) {
        if (shard.shardCount !== shardCount) fail('DOCUMENT_AI_OUTPUT_INVALID', 'shard count differs between outputs');
        if (byIndex.has(shard.shardIndex)) fail('DOCUMENT_AI_DUPLICATE_SHARD', `duplicate shard ${shard.shardIndex}`);
        byIndex.set(shard.shardIndex, shard);
    }
    for (let index = 0; index < shardCount; index += 1) {
        if (!byIndex.has(index)) fail('DOCUMENT_AI_MISSING_SHARD', `missing shard ${index}`);
    }
    const orderedShards = [...byIndex.values()].sort((a, b) => a.shardIndex - b.shardIndex);
    const globalBytes = buildGlobalText(orderedShards);
    const pages = [];
    const pageNumbers = new Set();
    if (expectedPageCount !== undefined && expectedPageCount !== null) {
        const count = parseInteger(expectedPageCount, 'expected page count');
        if (count > limits.maxPages) fail('DOCUMENT_AI_OUTPUT_LIMIT', 'expected page count exceeds the maximum page limit');
    }

    for (const shard of orderedShards) {
        const document = shard.document;
        const shardPages = Array.isArray(document.pages) ? document.pages : [];
        for (let pageIndex = 0; pageIndex < shardPages.length; pageIndex += 1) {
            if (pages.length >= limits.maxPages) fail('DOCUMENT_AI_OUTPUT_LIMIT', 'output exceeds the maximum page limit');
            const page = shardPages[pageIndex];
            if (!page || typeof page !== 'object') fail('DOCUMENT_AI_OUTPUT_INVALID', `page ${pageIndex} is malformed`);
            const pageNumber = parseInteger(page.pageNumber, `shard ${shard.shardIndex} page number`, { min: 1 });
            if (pageNumbers.has(pageNumber)) fail('DOCUMENT_AI_DUPLICATE_PAGE', `duplicate page ${pageNumber}`);
            pageNumbers.add(pageNumber);
            const layout = page.layout;
            const pageAnchor = pickAnchor(
                layout && (layout.textAnchor || layout.text_anchor),
                page.textAnchor || page.text_anchor
            );
            const pageText = pageAnchor
                ? anchorText(pageAnchor, shard, globalBytes, `page ${pageNumber}`, state, limits)
                : '';
            const imageQualityScores = page.imageQualityScores || page.image_quality_scores;
            const qualityScore = numberOrNull(imageQualityScores && firstDefined(
                imageQualityScores.qualityScore,
                imageQualityScores.quality_score
            ));
            const words = pageTokens(page, shard, globalBytes, pageNumber, state, limits);
            pages.push({
                pageNumber,
                text: pageText,
                words,
                imageQualityScore: qualityScore,
                isBlank: pageText === '' && words.length === 0
            });
        }
    }

    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    if (expectedPageCount !== undefined && expectedPageCount !== null) {
        const count = parseInteger(expectedPageCount, 'expected page count');
        if (pages.length !== count) fail('DOCUMENT_AI_PAGE_COUNT_MISMATCH', `expected ${count} pages, received ${pages.length}`);
        for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
            if (!pageNumbers.has(pageNumber)) fail('DOCUMENT_AI_MISSING_PAGE', `missing page ${pageNumber}`);
        }
    }

    const shardHashes = orderedShards.map((shard) => ({
        shardIndex: shard.shardIndex,
        sha256: crypto.createHash('sha256').update(shard.raw).digest('hex')
    }));
    const outputSha256 = crypto.createHash('sha256')
        .update(Buffer.concat(orderedShards.map((shard) => shard.raw)))
        .digest('hex');
    return {
        pages,
        pageCount: pages.length,
        physicalPageCount: pages.length,
        sourceGeneration: expectedGeneration || normalized[0].sourceGeneration,
        sourceSha256: expectedSourceHash || normalized[0].sourceSha256,
        provenanceVerified: normalized.every((shard) => shard.provenanceVerified),
        shardHashes,
        outputSha256,
        outputHash: outputSha256
    };
}

module.exports = {
    CONFIG_KEYS,
    buildBatchProcessRequest,
    checkBatchOcrOperation,
    createDocumentProcessorClient,
    parseDocumentAiOutput,
    pollBatchOcrOperation,
    resolveDocumentAiConfig,
    submitBatchOcr
};
