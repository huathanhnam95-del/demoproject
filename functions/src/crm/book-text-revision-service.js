const crypto = require('node:crypto');

const CRM_BOOKS = 'crmBooks';
const TEXT_REVISIONS = 'textRevisions';
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_PAGE_COUNT = 500;
const DEFAULT_LEASE_DURATION_MS = 9 * 60 * 1000;
const DEFAULT_TRANSIENT_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60 * 1000;
const DEFAULT_MAX_LRO_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MONTHLY_PAGE_LIMIT = 5000;
const DEFAULT_MAX_ACTIVE_OCR = 2;
const DEFAULT_DEFER_DELAY_MS = 60 * 1000;
const MAX_OUTPUT_SHARD_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_TOTAL_BYTES = 200 * 1024 * 1024;
const DEFAULT_QUEUE_BATCH_SIZE = 20;
const EXPECTED_DEFER_CODES = new Set([
    'OCR_ACTIVE_LIMIT_EXCEEDED',
    'OCR_BUDGET_EXCEEDED',
    'OCR_QUOTA_EXCEEDED'
]);
const STAGE_ORDER = Object.freeze([
    'ocr_submit',
    'ocr_wait',
    'ocr_parse',
    'candidate_chunk'
]);
const REVISION_STAGES = Object.freeze({
    OCR_SUBMIT: 'ocr_submit',
    OCR_WAIT: 'ocr_wait',
    OCR_PARSE: 'ocr_parse',
    CANDIDATE_CHUNK: 'candidate_chunk'
});

class TextRevisionError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'TextRevisionError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(code, message, details) {
    throw new TextRevisionError(code, message, details);
}

function requiredId(value, name) {
    if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
        fail('REVISION_INPUT_INVALID', `${name} is required and must be a safe document identifier`);
    }
    return value;
}

function requiredString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail('REVISION_INPUT_INVALID', `${name} is required`);
    }
    return value.trim();
}

function parseBoundedInteger(value, name, min, max) {
    let parsed = value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) parsed = Number(value.trim());
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        fail('SOURCE_METADATA_INVALID', `${name} must be an integer from ${min} through ${max}`);
    }
    return parsed;
}

function sourcePageCount(metadata, fallbackPageCount) {
    const custom = metadata && typeof metadata.metadata === 'object' && metadata.metadata !== null
        ? metadata.metadata
        : {};
    const value = metadata?.pageCount ?? metadata?.page_count
        ?? custom.pageCount ?? custom.page_count ?? fallbackPageCount;
    return parseBoundedInteger(value, 'pageCount', 1, MAX_PAGE_COUNT);
}

function validateSourceMetadata(metadata, fallbackPageCount) {
    if (!metadata || typeof metadata !== 'object') {
        fail('SOURCE_METADATA_INVALID', 'storage metadata is required');
    }
    if (metadata.contentType !== 'application/pdf') {
        fail('SOURCE_METADATA_INVALID', 'source contentType must be exactly application/pdf');
    }
    const rawSize = metadata.size ?? metadata.sizeBytes;
    const sizeBytes = parseBoundedInteger(rawSize, 'size', 1, MAX_SOURCE_BYTES);
    const result = {
        contentType: 'application/pdf',
        sizeBytes,
        pageCount: sourcePageCount(metadata, fallbackPageCount)
    };
    const generation = metadata.generation;
    if (generation !== undefined && generation !== null && String(generation).trim() !== '') {
        result.generation = String(generation);
    }
    return result;
}

function metadataSignature(metadata, normalized) {
    const stable = {
        contentType: metadata?.contentType,
        size: metadata?.size ?? metadata?.sizeBytes,
        generation: metadata?.generation,
        metageneration: metadata?.metageneration,
        md5Hash: metadata?.md5Hash,
        crc32c: metadata?.crc32c,
        metadata: metadata?.metadata,
        pageCount: normalized.pageCount
    };
    return JSON.stringify(canonicalize(stable));
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((result, key) => {
            result[key] = canonicalize(value[key]);
            return result;
        }, {});
    }
    return value;
}

function metadataResponse(response) {
    const metadata = Array.isArray(response) ? response[0] : response;
    if (!metadata || typeof metadata !== 'object') {
        fail('SOURCE_METADATA_INVALID', 'storage metadata response is empty');
    }
    return metadata;
}

function bytesFromDownload(response) {
    const bytes = Array.isArray(response) ? response[0] : response;
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
        fail('SOURCE_DOWNLOAD_INVALID', 'source download did not return bytes');
    }
    return Buffer.from(bytes);
}

function sourceDestinationPath(bookId, revisionId) {
    return `crm-books/${bookId}/text-revisions/${revisionId}/source/source.pdf`;
}

async function snapshotImmutableSource(options = {}) {
    const bucket = options.bucket;
    if (!bucket || typeof bucket.file !== 'function') {
        fail('REVISION_INPUT_INVALID', 'bucket is required');
    }
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const sourcePath = requiredString(options.sourcePath || options.sourceStoragePath, 'sourcePath');
    const sourceFile = options.sourceFile || bucket.file(sourcePath);
    if (!sourceFile || typeof sourceFile.getMetadata !== 'function') {
        fail('REVISION_INPUT_INVALID', 'sourceFile must support getMetadata, download, and copy');
    }

    const firstMetadata = metadataResponse(await sourceFile.getMetadata());
    const first = validateSourceMetadata(firstMetadata, options.pageCount ?? options.expectedPageCount);
    const generation = first.generation;
    if (!generation) fail('SOURCE_GENERATION_MISSING', 'source metadata must include a generation');

    const pinnedSourceFile = bucket.file(sourcePath, { generation });
    if (!pinnedSourceFile || typeof pinnedSourceFile.download !== 'function'
        || typeof pinnedSourceFile.copy !== 'function') {
        fail('REVISION_INPUT_INVALID', 'pinned source file must support download and copy');
    }
    const bytes = bytesFromDownload(await pinnedSourceFile.download({ ifGenerationMatch: generation }));
    const secondMetadata = metadataResponse(await sourceFile.getMetadata());
    const second = validateSourceMetadata(secondMetadata, first.pageCount);
    if (metadataSignature(firstMetadata, first) !== metadataSignature(secondMetadata, second)
        || second.generation !== generation) {
        fail('SOURCE_CHANGED', 'source metadata or generation changed during snapshot');
    }
    if (bytes.length !== first.sizeBytes) {
        fail('SOURCE_SIZE_MISMATCH', 'downloaded source size differs from pinned metadata');
    }

    const destinationPath = sourceDestinationPath(bookId, revisionId);
    const destinationFile = bucket.file(destinationPath);
    let copied = false;
    try {
        await pinnedSourceFile.copy(destinationFile, { preconditionOpts: { ifGenerationMatch: 0 } });
        copied = true;
    } catch (error) {
        if (error && (error.code === 409 || error.code === 412 || error.code === '409' || error.code === '412')) {
            // Check if destination already exists with identical bytes (idempotent snapshot)
            try {
                const [exists] = await destinationFile.exists();
                if (exists) {
                    copied = true;
                } else {
                    fail('SOURCE_DESTINATION_CONFLICT', 'immutable source destination already exists or could not be created');
                }
            } catch {
                fail('SOURCE_DESTINATION_CONFLICT', 'immutable source destination already exists or could not be created');
            }
        } else {
            throw error;
        }
    }
    if (!destinationFile || typeof destinationFile.getMetadata !== 'function'
        || typeof destinationFile.download !== 'function') {
        fail('REVISION_INPUT_INVALID', 'destination file must support metadata and download');
    }
    const destinationMetadata = metadataResponse(await destinationFile.getMetadata());
    const destination = validateSourceMetadata(destinationMetadata, first.pageCount);
    if (!destination.generation) {
        destination.generation = generation;
    }
    const destinationBytes = bytesFromDownload(
        await destinationFile.download({ ifGenerationMatch: destination.generation })
    );
    if (destinationBytes.length !== destination.sizeBytes || destination.sizeBytes !== first.sizeBytes) {
        fail('SOURCE_DESTINATION_MISMATCH', 'immutable source destination size differs from the pinned source');
    }
    const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const destinationSha256 = crypto.createHash('sha256').update(destinationBytes).digest('hex');
    if (destinationSha256 !== sourceSha256 || !destinationBytes.equals(bytes)) {
        fail('SOURCE_DESTINATION_MISMATCH', 'immutable source destination bytes differ from the pinned source');
    }
    const bucketName = requiredString(bucket.name || bucket.id, 'bucket.name');
    return {
        sourcePath: destinationPath,
        sourceUri: `gs://${bucketName}/${destinationPath}`,
        sourceGeneration: destination.generation,
        sourceSha256,
        sourceSizeBytes: destination.sizeBytes,
        sourceContentType: destination.contentType,
        pageCount: destination.pageCount,
        originalSourceGeneration: generation,
        originalSourcePath: sourcePath,
        originalSourceUri: `gs://${bucketName}/${sourcePath}`
    };
}

function validateSha256(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
        fail('REVISION_SOURCE_INVALID', 'sourceSha256 must be a 64-character hexadecimal SHA-256');
    }
    return value.toLowerCase();
}

function validateProcessor(processor) {
    if (!processor || typeof processor !== 'object') {
        fail('REVISION_PROCESSOR_INVALID', 'pinned processor metadata is required');
    }
    const result = {};
    for (const key of ['processor', 'location', 'processorVersion']) {
        result[key] = requiredString(processor[key], `processor.${key}`);
    }
    return result;
}

function buildRevisionRecord({ bookId, revisionId, source, processor, now = new Date() } = {}) {
    const id = requiredId(bookId, 'bookId');
    const revision = requiredId(revisionId, 'revisionId');
    if (!source || typeof source !== 'object') fail('REVISION_SOURCE_INVALID', 'source snapshot is required');
    const sourceUri = requiredString(source.sourceUri || source.uri, 'sourceUri');
    const generation = requiredString(source.sourceGeneration || source.generation, 'sourceGeneration');
    const sourceSizeBytes = parseBoundedInteger(
        source.sourceSizeBytes ?? source.sizeBytes,
        'sourceSizeBytes',
        1,
        MAX_SOURCE_BYTES
    );
    const pageCount = parseBoundedInteger(source.pageCount, 'pageCount', 1, MAX_PAGE_COUNT);
    const sourceContentType = source.sourceContentType || source.contentType;
    if (sourceContentType !== 'application/pdf') {
        fail('REVISION_SOURCE_INVALID', 'sourceContentType must be exactly application/pdf');
    }
    const timestamp = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(timestamp.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');

    return {
        bookId: id,
        revisionId: revision,
        stage: 'ocr_submit',
        status: 'running',
        source: {
            uri: sourceUri,
            generation,
            sha256: validateSha256(source.sourceSha256 || source.sha256),
            sizeBytes: sourceSizeBytes,
            contentType: sourceContentType,
            pageCount
        },
        processor: validateProcessor(processor),
        submit: { status: 'not_started' },
        lease: { workerId: null, expiresAt: null, fence: 0 },
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function normalizeDbOptions(dbOrOptions, maybeOptions) {
    if (dbOrOptions && typeof dbOrOptions.runTransaction === 'function') {
        return { ...maybeOptions, db: dbOrOptions };
    }
    if (dbOrOptions && dbOrOptions.db && typeof dbOrOptions.db.runTransaction === 'function') {
        return dbOrOptions;
    }
    fail('REVISION_INPUT_INVALID', 'Firestore db is required');
}

function revisionRef(db, bookId, revisionId) {
    return db.collection(CRM_BOOKS).doc(bookId).collection(TEXT_REVISIONS).doc(revisionId);
}

async function createRevision(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const source = await snapshotImmutableSource(options);
    const record = buildRevisionRecord({
        bookId,
        revisionId,
        source,
        processor: options.processor,
        now: options.now
    });
    const bookRef = options.db.collection(CRM_BOOKS).doc(bookId);
    const textRevisionRef = revisionRef(options.db, bookId, revisionId);
    const timestamp = record.createdAt;
    await options.db.runTransaction(async (transaction) => {
        const bookSnap = await transaction.get(bookRef);
        const revisionSnap = await transaction.get(textRevisionRef);
        if (!bookSnap.exists) fail('BOOK_NOT_FOUND', `book ${bookId} does not exist`);
        if (revisionSnap.exists) fail('REVISION_EXISTS', `revision ${revisionId} already exists`);
        transaction.create(textRevisionRef, record);
        const bookData = bookSnap.data() || {};
        if (bookData.processingTextRevisionId && bookData.processingTextRevisionId !== revisionId) {
            fail('REVISION_PROCESSING_ACTIVE', 'another text revision is already processing for this book');
        }
        transaction.update(bookRef, {
            processingTextRevisionId: revisionId,
            processingTextRevisionUpdatedAt: timestamp,
            updatedAt: timestamp
        });
    });
    return record;
}

function asMillis(value) {
    if (value instanceof Date) return value.getTime();
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Number.NaN : parsed;
    }
    return Number.NaN;
}

function leaseIsActive(lease, now) {
    if (!lease || !lease.workerId) return false;
    if (lease.expiresAt === null || lease.expiresAt === undefined) return true;
    const expiresAt = asMillis(lease.expiresAt);
    return !Number.isNaN(expiresAt) && expiresAt > now.getTime();
}

async function claimRevision(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const workerId = requiredString(options.workerId, 'workerId');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    const duration = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isSafeInteger(duration) || duration <= 0) {
        fail('REVISION_INPUT_INVALID', 'leaseDurationMs must be a positive integer');
    }
    const ref = revisionRef(options.db, bookId, revisionId);
    return options.db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) fail('REVISION_NOT_FOUND', `revision ${revisionId} does not exist`);
        const data = snap.data() || {};
        if (data.bookId !== bookId || data.revisionId !== revisionId) {
            fail('REVISION_IDENTITY_MISMATCH', 'revision document identity does not match its path');
        }
        if (data.status !== 'running') return null;
        if (leaseIsActive(data.lease, now)) {
            fail('REVISION_LEASE_ACTIVE', `revision ${revisionId} has an active lease`);
        }
        const previousFence = data.lease && data.lease.fence;
        const fence = Number.isSafeInteger(previousFence) && previousFence >= 0 ? previousFence + 1 : 1;
        if (!Number.isSafeInteger(fence)) fail('REVISION_FENCE_EXHAUSTED', 'revision lease fence is exhausted');
        const lease = {
            workerId,
            expiresAt: new Date(now.getTime() + duration),
            fence
        };
        transaction.update(ref, { lease, updatedAt: now });
        return { ...data, lease, updatedAt: now };
    });
}

function applyPatch(target, patch) {
    const result = { ...target };
    for (const [key, value] of Object.entries(patch)) {
        if (key === 'updatedAt') continue;
        if (!key.includes('.')) {
            result[key] = value;
            continue;
        }
        const segments = key.split('.');
        let cursor = result;
        for (let index = 0; index < segments.length - 1; index += 1) {
            cursor[segments[index]] = { ...(cursor[segments[index]] || {}) };
            cursor = cursor[segments[index]];
        }
        cursor[segments[segments.length - 1]] = value;
    }
    return result;
}

function validateStageTransition(currentStage, targetStage) {
    if (!STAGE_ORDER.includes(currentStage) || !STAGE_ORDER.includes(targetStage)) {
        fail('REVISION_STAGE_INVALID', 'revision stage is not supported');
    }
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    const targetIndex = STAGE_ORDER.indexOf(targetStage);
    if (targetIndex > currentIndex + 1 || targetIndex < currentIndex) {
        fail('REVISION_STAGE_INVALID', 'revision stages must move forward one step at a time');
    }
}

async function updateWithFence(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const workerId = requiredString(options.workerId, 'workerId');
    if (!Number.isSafeInteger(options.fence) || options.fence < 1) {
        fail('REVISION_INPUT_INVALID', 'fence must be a positive integer');
    }
    const patch = options.patch || options.fields;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        fail('REVISION_INPUT_INVALID', 'patch is required');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'bookId')
        || Object.prototype.hasOwnProperty.call(patch, 'revisionId')
        || Object.prototype.hasOwnProperty.call(patch, 'lease')
        || Object.keys(patch).some((key) => key === 'lease.workerId' || key === 'lease.fence')) {
        fail('REVISION_INPUT_INVALID', 'patch cannot change revision identity or lease ownership');
    }
    if (patch.stage !== undefined) {
        const currentStage = options.currentStage;
        if (currentStage !== undefined && !STAGE_ORDER.includes(currentStage)) {
            fail('REVISION_STAGE_INVALID', `unknown current revision stage ${currentStage}`);
        }
        if (!STAGE_ORDER.includes(patch.stage)) {
            fail('REVISION_STAGE_INVALID', `unknown target revision stage ${patch.stage}`);
        }
    }
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    const ref = revisionRef(options.db, bookId, revisionId);
    return options.db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists) fail('REVISION_NOT_FOUND', `revision ${revisionId} does not exist`);
        const data = snap.data() || {};
        const lease = data.lease || {};
        if (data.bookId !== bookId || data.revisionId !== revisionId
            || lease.workerId !== workerId || lease.fence !== options.fence) {
            fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
        }
        if (patch.stage !== undefined) {
            validateStageTransition(data.stage, patch.stage);
        }
        const update = { ...patch, updatedAt: now };
        if (options.releaseLease === true) {
            update.lease = { workerId: null, expiresAt: null, fence: lease.fence };
        }
        transaction.update(ref, update);
        return applyPatch({ ...data, updatedAt: now }, update);
    });
}

function revisionDocumentFromSnapshot(snap, bookId, revisionId) {
    if (!snap || !snap.exists) fail('REVISION_NOT_FOUND', `revision ${revisionId} does not exist`);
    const data = snap.data() || {};
    if (data.bookId !== bookId || data.revisionId !== revisionId) {
        fail('REVISION_IDENTITY_MISMATCH', 'revision document identity does not match its path');
    }
    return data;
}

async function readRevision(db, bookId, revisionId) {
    const ref = revisionRef(db, requiredId(bookId, 'bookId'), requiredId(revisionId, 'revisionId'));
    return db.runTransaction(async (transaction) => revisionDocumentFromSnapshot(
        await transaction.get(ref), bookId, revisionId
    ));
}

function revisionLeaseMatches(data, workerId, fence) {
    const lease = data && data.lease ? data.lease : {};
    return data && data.status === 'running'
        && lease.workerId === workerId
        && lease.fence === fence;
}

function normalizeMonthKey(value, now) {
    if (value !== undefined && value !== null) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
            fail('OCR_BUDGET_INVALID', 'monthKey must use YYYY-MM format');
        }
        return value;
    }
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function quotaDenied(result) {
    if (result === false) return true;
    return Boolean(result && typeof result === 'object' && result.allowed === false);
}

async function checkOcrQuota(options, context) {
    const checker = options.checkQuota
        || options.deps?.checkQuota
        || (typeof options.quota === 'function' ? options.quota : null)
        || (options.quota && (options.quota.check || options.quota.assert));
    if (!checker) {
        if (options.quota && quotaDenied(options.quota)) {
            fail('OCR_QUOTA_EXCEEDED', 'OCR quota denied this submission');
        }
        return;
    }
    const result = await checker(context);
    if (quotaDenied(result)) fail('OCR_QUOTA_EXCEEDED', 'OCR quota denied this submission');
    if (result && typeof result === 'object' && Number.isFinite(result.remainingPages)
        && context.pages > result.remainingPages) {
        fail('OCR_QUOTA_EXCEEDED', 'OCR quota has insufficient remaining pages');
    }
}

function revisionBudgetRef(db, monthKey) {
    return db.collection('crmOcrBudgets').doc(monthKey);
}

function budgetNumber(data, ...keys) {
    for (const key of keys) {
        const value = data && data[key];
        if (value !== undefined && value !== null) {
            if (!Number.isSafeInteger(value) || value < 0) fail('OCR_BUDGET_INVALID', `${key} must be a non-negative integer`);
            return value;
        }
    }
    return 0;
}

function positiveLimitFromEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    if (!/^\d+$/.test(raw.trim())) fail('OCR_BUDGET_INVALID', `${name} must be a positive integer`);
    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value) || value < 1) fail('OCR_BUDGET_INVALID', `${name} must be a positive integer`);
    return value;
}

function resolveOcrLimits(options = {}) {
    const monthlyPageLimit = options.monthlyLimit
        ?? options.monthlyPageLimit
        ?? options.monthlyBudgetLimit
        ?? positiveLimitFromEnv('CRM_BOOKS_OCR_MONTHLY_PAGE_LIMIT', DEFAULT_MONTHLY_PAGE_LIMIT);
    const maxActiveOcr = options.maxActiveOcr
        ?? options.maxActiveOcrCount
        ?? positiveLimitFromEnv('CRM_BOOKS_OCR_MAX_ACTIVE', DEFAULT_MAX_ACTIVE_OCR);
    if (!Number.isSafeInteger(monthlyPageLimit) || monthlyPageLimit < 1
        || !Number.isSafeInteger(maxActiveOcr) || maxActiveOcr < 1) {
        fail('OCR_BUDGET_INVALID', 'OCR production limits must be positive integers');
    }
    return { monthlyPageLimit, maxActiveOcr };
}

async function reserveOcrSubmission(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const workerId = requiredString(options.workerId, 'workerId');
    const fence = options.fence;
    if (!Number.isSafeInteger(fence) || fence < 1) fail('REVISION_INPUT_INVALID', 'fence must be a positive integer');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    const monthKey = normalizeMonthKey(options.monthKey, now);
    const revision = await readRevision(options.db, bookId, revisionId);
    if (!revisionLeaseMatches(revision, workerId, fence)) {
        fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
    }
    const currentSubmit = revision.submit || {};
    const currentState = currentSubmit.state || currentSubmit.status || 'not_started';
    if (currentState === 'submitted' || currentSubmit.operationName) {
        return { record: revision, alreadySubmitted: true, reservationId: currentSubmit.reservationId || null };
    }
    if (currentState === 'in_flight') {
        fail('OCR_SUBMIT_IN_FLIGHT', 'submission is already in flight and requires reconciliation');
    }
    if (currentState !== 'not_started') {
        fail('OCR_SUBMIT_STATE_INVALID', `cannot reserve submission from state ${currentState}`);
    }

    const pages = options.estimatedPages ?? revision.source?.pageCount;
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > MAX_PAGE_COUNT) {
        fail('OCR_BUDGET_INVALID', 'estimatedPages must be a positive bounded page count');
    }
    await checkOcrQuota(options, { bookId, revisionId, monthKey, pages, revision });
    const limits = resolveOcrLimits(options);
    const limit = limits.monthlyPageLimit;
    const maxActiveOcr = limits.maxActiveOcr;
    const reservationId = options.reservationId || `${bookId}/${revisionId}/${monthKey}`;
    const ref = revisionRef(options.db, bookId, revisionId);
    const budgetRef = options.budgetRef || revisionBudgetRef(options.db, monthKey);
    return options.db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(ref);
        const budgetSnap = await transaction.get(budgetRef);
        const fresh = revisionDocumentFromSnapshot(freshSnap, bookId, revisionId);
        if (!revisionLeaseMatches(fresh, workerId, fence)) {
            fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
        }
        const submit = fresh.submit || {};
        const state = submit.state || submit.status || 'not_started';
        if (state === 'submitted' || submit.operationName) {
            return { record: fresh, alreadySubmitted: true, reservationId: submit.reservationId || null };
        }
        if (state === 'in_flight') fail('OCR_SUBMIT_IN_FLIGHT', 'submission is already in flight and requires reconciliation');
        if (state !== 'not_started') fail('OCR_SUBMIT_STATE_INVALID', `cannot reserve submission from state ${state}`);

        const budget = budgetSnap.exists ? (budgetSnap.data() || {}) : {};
        const reservations = budget.reservations && typeof budget.reservations === 'object'
            ? budget.reservations
            : {};
        const existing = reservations[reservationId];
        const usedPages = budgetNumber(budget, 'usedPages', 'consumedPages', 'completedPages');
        const reservedPages = budgetNumber(budget, 'reservedPages', 'pendingPages');
        const activeCount = budgetNumber(budget, 'activeCount', 'activeOcrCount');
        const resolvedLimit = options.monthlyLimit ?? options.monthlyPageLimit ?? options.monthlyBudgetLimit
            ?? budget.monthlyLimit ?? budget.limit ?? limit;
        if (resolvedLimit !== undefined && (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1)) {
            fail('OCR_BUDGET_INVALID', 'monthly budget limit must be a positive integer');
        }
        const alreadyReserved = existing && existing.pages === pages;
        if (!alreadyReserved && resolvedLimit !== undefined
            && usedPages + reservedPages + pages > resolvedLimit) {
            fail('OCR_BUDGET_EXCEEDED', 'monthly OCR budget would be exceeded');
        }
        if (!alreadyReserved && activeCount >= maxActiveOcr) {
            fail('OCR_ACTIVE_LIMIT_EXCEEDED', 'maximum active OCR operation count has been reached');
        }
        const nextReservations = {
            ...reservations,
            [reservationId]: { pages, bookId, revisionId, reservedAt: now }
        };
        const nextReservedPages = alreadyReserved ? reservedPages : reservedPages + pages;
        const nextSubmit = {
            ...submit,
            status: 'in_flight',
            state: 'in_flight',
            reservationId,
            monthKey,
            reservedPages: pages,
            reservedAt: now
        };
        transaction.update(ref, { submit: nextSubmit, updatedAt: now });
        transaction.set(budgetRef, {
            monthKey,
            monthlyLimit: resolvedLimit ?? null,
            reservedPages: nextReservedPages,
            activeCount: alreadyReserved ? activeCount : activeCount + 1,
            maxActiveOcr,
            reservations: nextReservations,
            updatedAt: now
        }, { merge: true });
        return {
            record: { ...fresh, submit: nextSubmit, updatedAt: now },
            alreadySubmitted: false,
            reservationId
        };
    });
}

async function settleOcrReservation(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const outcome = options.outcome === 'success' ? 'success' : 'failure';
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    const ref = revisionRef(options.db, bookId, revisionId);
    return options.db.runTransaction(async (transaction) => {
        const revisionSnap = await transaction.get(ref);
        const revision = revisionDocumentFromSnapshot(revisionSnap, bookId, revisionId);
        const submit = revision.submit || {};
        const reservationId = submit.reservationId;
        if (!reservationId) return revision;
        if (submit.settlement?.state === 'settled') return revision;
        const budgetRef = options.budgetRef || revisionBudgetRef(options.db, submit.monthKey || normalizeMonthKey(options.monthKey, now));
        const budgetSnap = await transaction.get(budgetRef);
        const budget = budgetSnap.exists ? (budgetSnap.data() || {}) : {};
        const reservations = budget.reservations && typeof budget.reservations === 'object'
            ? budget.reservations
            : {};
        const reservation = reservations[reservationId] || {};
        const pages = submit.reservedPages ?? reservation.pages ?? 0;
        if (!Number.isSafeInteger(pages) || pages < 0) fail('OCR_BUDGET_INVALID', 'reserved OCR pages are malformed');
        const reservedPages = budgetNumber(budget, 'reservedPages', 'pendingPages');
        const activeCount = budgetNumber(budget, 'activeCount', 'activeOcrCount');
        const nextReservations = {
            ...reservations,
            [reservationId]: { ...reservation, pages, state: 'settled', outcome, settledAt: now }
        };
        transaction.set(budgetRef, {
            reservedPages: Math.max(0, reservedPages - pages),
            activeCount: Math.max(0, activeCount - 1),
            usedPages: budgetNumber(budget, 'usedPages', 'consumedPages', 'completedPages')
                + (outcome === 'success' ? pages : 0),
            reservations: nextReservations,
            updatedAt: now
        }, { merge: true });
        const nextSubmit = {
            ...submit,
            settlement: { state: 'settled', outcome, settledAt: now }
        };
        transaction.update(ref, { submit: nextSubmit, updatedAt: now });
        return { ...revision, submit: nextSubmit, updatedAt: now };
    });
}

function defaultOutputUri(record) {
    const sourceUri = record.source && record.source.uri;
    if (typeof sourceUri === 'string' && sourceUri.endsWith('/source/source.pdf')) {
        return `${sourceUri.slice(0, -'/source/source.pdf'.length)}/ocr/`;
    }
    return `gs://crm-books/${record.bookId}/text-revisions/${record.revisionId}/ocr/`;
}

function errorPayload(error, fallbackCode) {
    return {
        code: error && error.code !== undefined ? error.code : fallbackCode,
        message: error && error.message ? String(error.message) : String(error)
    };
}

function asRevisionError(error, code, message) {
    if (error instanceof TextRevisionError && error.code === code) return error;
    return new TextRevisionError(code, message || (error && error.message) || code, {
        causeCode: error && error.code
    });
}

async function markSubmitUncertain(options, error) {
    const uncertain = asRevisionError(error, 'OCR_SUBMIT_UNCERTAIN', 'OCR submit outcome is ambiguous');
    try {
        await updateWithFence(options.db, {
            bookId: options.bookId,
            revisionId: options.revisionId,
            workerId: options.workerId,
            fence: options.fence,
            patch: {
                status: 'needs_reconciliation',
                error: errorPayload(uncertain, 'OCR_SUBMIT_UNCERTAIN'),
                submit: {
                    ...(options.reservedSubmit || {}),
                    status: 'in_flight',
                    state: 'in_flight'
                }
            },
            releaseLease: true,
            now: options.now
        });
    } catch (markError) {
        if (!(markError instanceof TextRevisionError)
            || markError.code !== 'REVISION_WORKER_FENCE_MISMATCH') throw markError;
    }
    throw uncertain;
}

const PRE_SUBMIT_RELEASE_CODES = new Set([
    'OCR_QUOTA_EXCEEDED',
    'OCR_BUDGET_EXCEEDED',
    'OCR_ACTIVE_LIMIT_EXCEEDED',
    'OCR_BUDGET_INVALID'
]);

async function releaseLeaseAfterReservationFailure(options, error) {
    if (!PRE_SUBMIT_RELEASE_CODES.has(error && error.code)) return;
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const deferDelayMs = options.deferDelayMs ?? DEFAULT_DEFER_DELAY_MS;
    const nextPollAt = new Date(now.getTime() + deferDelayMs);
    try {
        await updateWithFence(options.db, {
            bookId: options.bookId,
            revisionId: options.revisionId,
            workerId: options.workerId,
            fence: options.fence,
            patch: { nextPollAt },
            releaseLease: true,
            now
        });
    } catch (releaseError) {
        // A competing worker may have replaced this lease; preserve the original
        // denial because no external OCR call was made.
        if (!(releaseError instanceof TextRevisionError)
            || releaseError.code !== 'REVISION_WORKER_FENCE_MISMATCH') throw releaseError;
    }
}

async function submitRevisionOcr(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const current = await readRevision(options.db, bookId, revisionId);
    const state = current.submit?.state || current.submit?.status || 'not_started';
    if (current.status === 'needs_reconciliation') {
        fail('OCR_SUBMIT_UNCERTAIN', 'OCR submission requires explicit reconciliation');
    }
    if (state === 'in_flight') {
        fail('OCR_SUBMIT_IN_FLIGHT', 'submission is already in flight and requires reconciliation');
    }
    if (state === 'submitted' || current.stage !== REVISION_STAGES.OCR_SUBMIT) return current;
    let reservation;
    try {
        reservation = await reserveOcrSubmission(options);
    } catch (error) {
        await releaseLeaseAfterReservationFailure(options, error);
        throw error;
    }
    if (reservation.alreadySubmitted) return reservation.record;
    const reserved = reservation.record;
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    let outputUri;
    try {
        outputUri = options.outputUri || options.outputPrefix
            || (typeof options.buildOutputUri === 'function'
                ? await options.buildOutputUri(reserved)
                : defaultOutputUri(reserved));
        const adapter = options.submitBatchOcr || options.deps?.submitBatchOcr
            || require('./book-document-ocr-service').submitBatchOcr;
        const submitted = await adapter({
            config: options.config || reserved.processor,
            client: options.client,
            revisionId,
            sourceUri: reserved.source.uri,
            sourceGeneration: reserved.source.generation,
            sourceSha256: reserved.source.sha256,
            outputUri
        });
        if (!submitted || typeof submitted.operationName !== 'string' || submitted.operationName.trim() === '') {
            fail('OCR_OPERATION_NAME_MISSING', 'OCR submission did not return a confirmed operation name');
        }
        if (submitted.sourceUri && submitted.sourceUri !== reserved.source.uri) {
            fail('OCR_SOURCE_MISMATCH', 'submitted operation source does not match the pinned source');
        }
        const confirmedOutputUri = submitted.outputUri || outputUri;
        if (submitted.outputUri && !outputMatchesPrefix(submitted.outputUri, outputUri)) {
            fail('OCR_OUTPUT_MISMATCH', 'submitted operation output does not match the pinned output');
        }
        const observedProcessor = submitted.processorVersion || submitted.processor;
        if (observedProcessor && observedProcessor !== reserved.processor.processorVersion) {
            fail('OCR_PROCESSOR_MISMATCH', 'submitted operation processor does not match the pinned processor');
        }
        return updateWithFence(options.db, {
            bookId,
            revisionId,
            workerId: options.workerId,
            fence: options.fence,
            patch: {
                stage: REVISION_STAGES.OCR_WAIT,
                nextPollAt: now,
                submit: {
                    ...reserved.submit,
                    status: 'submitted',
                    state: 'submitted',
                    operationName: submitted.operationName.trim(),
                    outputUri: confirmedOutputUri,
                    sourceUri: reserved.source.uri,
                    sourceGeneration: reserved.source.generation,
                    sourceSha256: reserved.source.sha256,
                    processorVersion: reserved.processor.processorVersion,
                    submittedAt: now
                }
            },
            releaseLease: true,
            now
        });
    } catch (error) {
        return markSubmitUncertain({ ...options, bookId, revisionId, now, reservedSubmit: reserved.submit }, error);
    }
}

function operationProcessorVersion(result) {
    const metadata = result && result.metadata;
    const status = result && Array.isArray(result.statuses) ? result.statuses[0] : null;
    return result?.processorVersion
        || metadata?.processorVersion
        || metadata?.processor_version
        || metadata?.processor
        || status?.processorVersion
        || status?.processor_version
        || null;
}

function operationOutputUri(result) {
    return result && (result.outputUri
        || (Array.isArray(result.outputUris) ? result.outputUris[0] : null)
        || (Array.isArray(result.destinations) ? result.destinations[0] : null));
}

function operationSourceUri(result) {
    const metadata = result && result.metadata;
    const status = result && Array.isArray(result.statuses) ? result.statuses[0] : null;
    return result?.inputGcsSource
        || result?.sourceUri
        || metadata?.inputGcsSource
        || metadata?.input_gcs_source
        || status?.inputGcsSource
        || status?.input_gcs_source
        || null;
}

function parseGsUri(uri, name) {
    if (typeof uri !== 'string' || !/^gs:\/\/[^/\s]+\/[^?#\s]+$/.test(uri)) {
        fail('OCR_OUTPUT_INVALID', `${name} must be a private gs:// URI`);
    }
    const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
    return { bucketName: match[1], prefix: match[2].replace(/\/+$/, '') + '/' };
}

function downloadedBytes(response) {
    const value = Array.isArray(response) ? response[0] : response;
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
        fail('OCR_OUTPUT_INVALID', 'OCR output file did not return raw bytes');
    }
    return Buffer.from(value);
}

function outputMetadataSize(metadata) {
    if (metadata?.size === undefined && metadata?.sizeBytes === undefined) return null;
    const value = metadata.size ?? metadata.sizeBytes;
    const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isSafeInteger(parsed) || parsed < 0) fail('OCR_OUTPUT_SIZE_INVALID', 'OCR output shard size metadata is malformed');
    return parsed;
}

async function loadRevisionOutputShards({ record, getStorageBucket, bucket, outputUri, maxShards = 1000 } = {}) {
    const source = record && record.source;
    const submit = record && record.submit;
    const resolvedOutputUri = outputUri || submit?.outputUri;
    const parsedUri = parseGsUri(resolvedOutputUri, 'outputUri');
    if (!Number.isSafeInteger(maxShards) || maxShards < 1 || maxShards > 1000) {
        fail('OCR_OUTPUT_INVALID', 'maxShards must be a positive bounded integer');
    }
    const resolvedBucket = bucket || (typeof getStorageBucket === 'function' ? await getStorageBucket() : null);
    if (!resolvedBucket || typeof resolvedBucket.getFiles !== 'function') {
        fail('OCR_OUTPUT_INVALID', 'getStorageBucket is required to load OCR output');
    }
    const resolvedBucketName = resolvedBucket.name || resolvedBucket.id;
    if (!resolvedBucketName || resolvedBucketName !== parsedUri.bucketName) {
        fail('OCR_OUTPUT_BUCKET_MISMATCH', 'OCR output bucket does not match the pinned output URI');
    }
    const listed = await resolvedBucket.getFiles({ prefix: parsedUri.prefix, maxResults: maxShards + 1, autoPaginate: false });
    const files = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
    if (!Array.isArray(files)) fail('OCR_OUTPUT_INVALID', 'OCR output file listing is malformed');
    const jsonFiles = files
        .filter((file) => file && typeof file.name === 'string'
            && file.name.startsWith(parsedUri.prefix)
            && file.name.endsWith('.json'))
        .sort((a, b) => a.name.localeCompare(b.name));
    if (jsonFiles.length === 0) fail('OCR_OUTPUT_MISSING', 'OCR output contains no JSON shards');
    if (jsonFiles.length > maxShards) fail('OCR_OUTPUT_LIMIT', 'OCR output exceeds the shard limit');
    const shards = [];
    let totalBytes = 0;
    for (const file of jsonFiles) {
        if (typeof file.download !== 'function') fail('OCR_OUTPUT_INVALID', 'listed OCR shard is not downloadable');
        let generation = null;
        let declaredSize = null;
        if (typeof file.getMetadata === 'function') {
            const metadataResponse = await file.getMetadata();
            const metadata = Array.isArray(metadataResponse) ? metadataResponse[0] : metadataResponse;
            generation = metadata?.generation === undefined || metadata?.generation === null
                ? null
                : String(metadata.generation);
            declaredSize = outputMetadataSize(metadata);
            if (declaredSize !== null && declaredSize > MAX_OUTPUT_SHARD_BYTES) {
                fail('OCR_OUTPUT_SHARD_LIMIT', 'OCR output shard exceeds the per-shard byte limit');
            }
            if (declaredSize !== null && totalBytes + declaredSize > MAX_OUTPUT_TOTAL_BYTES) {
                fail('OCR_OUTPUT_TOTAL_LIMIT', 'OCR output shards exceed the total byte limit');
            }
        }
        const raw = downloadedBytes(await file.download(generation ? { ifGenerationMatch: generation } : undefined));
        if (raw.length > MAX_OUTPUT_SHARD_BYTES) {
            fail('OCR_OUTPUT_SHARD_LIMIT', 'OCR output shard exceeds the per-shard byte limit');
        }
        if (declaredSize !== null && declaredSize !== raw.length) {
            fail('OCR_OUTPUT_SIZE_MISMATCH', 'OCR output shard size changed during download');
        }
        const sizeContribution = declaredSize === null ? raw.length : declaredSize;
        if (totalBytes + sizeContribution > MAX_OUTPUT_TOTAL_BYTES) {
            fail('OCR_OUTPUT_TOTAL_LIMIT', 'OCR output shards exceed the total byte limit');
        }
        totalBytes += sizeContribution;
        shards.push({ raw, sourceGeneration: source?.generation || null, sourceSha256: source?.sha256 || null, outputPath: file.name });
    }
    return shards;
}

function candidateArtifactPath(bookId, revisionId) {
    return `crm-books/${bookId}/text-revisions/${revisionId}/candidate/pages.json`;
}

function candidateArtifactBytes(parsed, source) {
    return Buffer.from(JSON.stringify({
        pageCount: parsed.pageCount,
        physicalPageCount: parsed.physicalPageCount,
        pages: parsed.pages,
        provenanceVerified: parsed.provenanceVerified === true,
        sourceGeneration: source.generation,
        sourceSha256: source.sha256,
        outputSha256: parsed.outputSha256 || parsed.outputHash || null,
        shardHashes: parsed.shardHashes || []
    }));
}

async function persistCandidateArtifact({ bookId, revisionId, parsed, source, bucket, getStorageBucket } = {}) {
    const resolvedBucket = bucket || (typeof getStorageBucket === 'function' ? await getStorageBucket() : null);
    if (!resolvedBucket || typeof resolvedBucket.file !== 'function') {
        fail('OCR_OUTPUT_INVALID', 'getStorageBucket is required to persist candidate output');
    }
    const path = candidateArtifactPath(requiredId(bookId, 'bookId'), requiredId(revisionId, 'revisionId'));
    const bytes = candidateArtifactBytes(parsed, source);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const file = resolvedBucket.file(path);
    if (!file || typeof file.save !== 'function') fail('OCR_OUTPUT_INVALID', 'candidate artifact file is not writable');
    let generation;
    try {
        await file.save(bytes, {
            contentType: 'application/json',
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 }
        });
        if (typeof file.getMetadata === 'function') {
            const response = await file.getMetadata();
            generation = (Array.isArray(response) ? response[0] : response)?.generation;
        }
    } catch (error) {
        if (!(error && (error.code === 409 || error.code === 412 || error.code === '409' || error.code === '412'))) throw error;
        if (typeof file.getMetadata !== 'function' || typeof file.download !== 'function') {
            fail('OCR_CANDIDATE_CONFLICT', 'existing candidate artifact cannot be verified');
        }
        const response = await file.getMetadata();
        const metadata = Array.isArray(response) ? response[0] : response;
        generation = metadata?.generation;
        const existing = downloadedBytes(await file.download(generation ? { ifGenerationMatch: String(generation) } : undefined));
        const existingSha256 = crypto.createHash('sha256').update(existing).digest('hex');
        if (existingSha256 !== sha256 || !existing.equals(bytes)) {
            fail('OCR_CANDIDATE_CONFLICT', 'existing candidate artifact does not match the immutable parsed output');
        }
    }
    return {
        path,
        generation: generation === undefined || generation === null ? null : String(generation),
        sha256,
        sizeBytes: bytes.length,
        pageCount: parsed.pageCount,
        provenanceVerified: parsed.provenanceVerified === true
    };
}

function outputPrefix(value) {
    return typeof value === 'string' ? value.replace(/\/+$/, '') : value;
}

function outputMatchesPrefix(uri, requestedPrefix) {
    const uriPrefix = outputPrefix(uri);
    const prefix = outputPrefix(requestedPrefix);
    if (typeof uriPrefix !== 'string' || typeof prefix !== 'string') return false;
    return uriPrefix === prefix || uriPrefix.startsWith(`${prefix}/`);
}

function ensureCompletedOperation(result, record) {
    if (!result || result.done !== true) return;
    if (result.error) {
        const payload = errorPayload(result.error, 'OCR_OPERATION_FAILED');
        fail(payload.code, payload.message);
    }
    const expectedSource = record.source && record.source.uri;
    const observedSource = operationSourceUri(result);
    if (!observedSource || observedSource !== expectedSource) {
        fail('OCR_SOURCE_MISMATCH', 'OCR operation input source does not match the pinned source');
    }
    const expectedOutput = record.submit && record.submit.outputUri;
    const observedOutput = operationOutputUri(result);
    if (!outputMatchesPrefix(observedOutput, expectedOutput)) {
        fail('OCR_OUTPUT_MISMATCH', 'OCR output destination does not match the pinned output');
    }
    const observedProcessor = operationProcessorVersion(result);
    if (observedProcessor && observedProcessor !== record.processor?.processorVersion) {
        fail('OCR_PROCESSOR_MISMATCH', 'OCR operation processor does not match the pinned processor');
    }
}

async function transitionWithSettlement(options, { patch, outcome, clearProcessing = false } = {}) {
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const workerId = requiredString(options.workerId, 'workerId');
    if (!Number.isSafeInteger(options.fence) || options.fence < 1) {
        fail('REVISION_INPUT_INVALID', 'fence must be a positive integer');
    }
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    const ref = revisionRef(options.db, bookId, revisionId);
    const bookRef = options.db.collection(CRM_BOOKS).doc(bookId);
    return options.db.runTransaction(async (transaction) => {
        const revisionSnap = await transaction.get(ref);
        const revision = revisionDocumentFromSnapshot(revisionSnap, bookId, revisionId);
        if (!revisionLeaseMatches(revision, workerId, options.fence)) {
            fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
        }
        if (patch?.stage !== undefined) validateStageTransition(revision.stage, patch.stage);

        const currentSubmit = revision.submit || {};
        const alreadySettled = currentSubmit.settlement?.state === 'settled';
        const reservationId = currentSubmit.reservationId;
        let budgetRef;
        let budget;
        let reservation;
        let budgetUpdate;
        if (outcome && reservationId && !alreadySettled) {
            budgetRef = options.budgetRef || revisionBudgetRef(
                options.db,
                currentSubmit.monthKey || normalizeMonthKey(options.monthKey, now)
            );
            const budgetSnap = await transaction.get(budgetRef);
            budget = budgetSnap.exists ? (budgetSnap.data() || {}) : {};
            const reservations = budget.reservations && typeof budget.reservations === 'object'
                ? budget.reservations
                : {};
            reservation = reservations[reservationId] || {};
            const pages = currentSubmit.reservedPages ?? reservation.pages ?? 0;
            if (!Number.isSafeInteger(pages) || pages < 0) {
                fail('OCR_BUDGET_INVALID', 'reserved OCR pages are malformed');
            }
            const reservedPages = budgetNumber(budget, 'reservedPages', 'pendingPages');
            const activeCount = budgetNumber(budget, 'activeCount', 'activeOcrCount');
            const nextReservations = {
                ...reservations,
                [reservationId]: { ...reservation, pages, state: 'settled', outcome, settledAt: now }
            };
            budgetUpdate = {
                reservedPages: Math.max(0, reservedPages - pages),
                activeCount: Math.max(0, activeCount - 1),
                usedPages: budgetNumber(budget, 'usedPages', 'consumedPages', 'completedPages')
                    + (outcome === 'success' ? pages : 0),
                reservations: nextReservations,
                updatedAt: now
            };
        }

        const nextSubmit = outcome && reservationId && !alreadySettled
            ? {
                ...currentSubmit,
                ...(patch?.submit || {}),
                settlement: { state: 'settled', outcome, settledAt: now }
            }
            : patch?.submit;
        const nextPatch = { ...(patch || {}), updatedAt: now };
        if (nextSubmit) nextPatch.submit = nextSubmit;
        nextPatch.lease = { workerId: null, expiresAt: null, fence: revision.lease.fence };

        let bookSnap;
        if (clearProcessing) {
            bookSnap = await transaction.get(bookRef);
            const book = bookSnap.exists ? (bookSnap.data() || {}) : {};
            if (book.processingTextRevisionId === revisionId) {
                transaction.update(bookRef, {
                    processingTextRevisionId: null,
                    processingTextRevisionUpdatedAt: now,
                    updatedAt: now
                });
            }
        }
        if (budgetUpdate) transaction.set(budgetRef, budgetUpdate, { merge: true });
        transaction.update(ref, nextPatch);
        return applyPatch({ ...revision, updatedAt: now }, nextPatch);
    });
}

async function failRevision(options, error, attempt = 0) {
    const classified = classifyRevisionError(error, {
        attempt,
        maxAttempts: options.maxTransientRetries ?? DEFAULT_TRANSIENT_RETRIES,
        baseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
        maxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
    });
    if (classified.retry) {
        const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
        const transitioned = await updateWithFence(options.db, {
            bookId: options.bookId,
            revisionId: options.revisionId,
            workerId: options.workerId,
            fence: options.fence,
            patch: {
                retry: { attempt: attempt + 1, classification: classified.classification, lastError: errorPayload(error, classified.code) },
                nextPollAt: new Date(now.getTime() + classified.delayMs)
            },
            releaseLease: true,
            now
        });
        return transitioned;
    }
    const finalError = classified.classification === 'retry_exhausted'
        ? new TextRevisionError('RETRY_EXHAUSTED', 'transient OCR work exhausted its retry budget', { causeCode: classified.code })
        : error;
    await transitionWithSettlement({ ...options, bookId: options.bookId, revisionId: options.revisionId }, {
        patch: {
            status: 'failed',
            error: errorPayload(finalError, classified.code),
            failedAt: options.now || new Date()
        },
        outcome: options.settleReservation === false ? undefined : 'failure',
        clearProcessing: true
    });
    throw finalError;
}

async function pollRevisionOcr(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const record = await readRevision(options.db, bookId, revisionId);
    if (record.stage !== REVISION_STAGES.OCR_WAIT || record.status !== 'running') return record;
    if (!revisionLeaseMatches(record, options.workerId, options.fence)) {
        fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
    }
    const operationName = record.submit?.operationName;
    if (!operationName) fail('OCR_OPERATION_NAME_MISSING', 'ocr_wait revision is missing its operation name');
    const check = options.checkBatchOcrOperation
        || options.deps?.checkBatchOcrOperation
        || options.pollBatchOcrOperation
        || options.deps?.pollBatchOcrOperation
        || require('./book-document-ocr-service').checkBatchOcrOperation;
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (Number.isNaN(now.getTime())) fail('REVISION_INPUT_INVALID', 'now must be a valid date');
    try {
        const maxAge = options.maxLroAgeMs ?? options.lroMaxAgeMs ?? DEFAULT_MAX_LRO_AGE_MS;
        if (!Number.isSafeInteger(maxAge) || maxAge <= 0) fail('OCR_POLL_INVALID', 'maxLroAgeMs must be a positive integer');
        if (record.submit.submittedAt) {
            const submittedAt = asMillis(record.submit.submittedAt);
            if (Number.isNaN(submittedAt)) fail('OCR_SUBMITTED_AT_INVALID', 'submittedAt must be a valid date');
            if (now.getTime() - submittedAt >= maxAge) {
                fail('OCR_LRO_TIMEOUT', 'OCR operation exceeded its maximum allowed age');
            }
        }
        const result = await check({
            operationName,
            client: options.client,
            config: options.config || record.processor,
            expectedSourceUri: record.source.uri,
            expectedOutputUri: record.submit.outputUri,
            maxAttempts: 1,
            intervalMs: 0
        });
        if (!result || result.operationName !== operationName) {
            fail('OCR_OPERATION_MISMATCH', 'returned operation name does not match the pinned operation');
        }
        if (!result || result.done !== true) {
            const interval = options.pollIntervalMs ?? 5000;
            if (!Number.isSafeInteger(interval) || interval < 0) fail('OCR_POLL_INVALID', 'pollIntervalMs must be non-negative');
            return updateWithFence(options.db, {
                bookId,
                revisionId,
                workerId: options.workerId,
                fence: options.fence,
                patch: { nextPollAt: new Date(now.getTime() + interval), poll: { state: 'incomplete', checkedAt: now } },
                releaseLease: true,
                now
            });
        }
        ensureCompletedOperation(result, record);
        return transitionWithSettlement({ ...options, bookId, revisionId, now }, {
            patch: {
                stage: REVISION_STAGES.OCR_PARSE,
                nextPollAt: null,
                poll: { state: 'complete', completedAt: now, operationName, outputUri: operationOutputUri(result) || record.submit.outputUri },
                submit: { ...record.submit, outputUri: operationOutputUri(result) || record.submit.outputUri }
            },
            outcome: 'success'
        });
    } catch (error) {
        if (error instanceof TextRevisionError && error.code === 'REVISION_WORKER_FENCE_MISMATCH') throw error;
        return failRevision({ ...options, bookId, revisionId, now }, error, record.retry?.attempt || 0);
    }
}

async function parseRevisionOcr(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const bookId = requiredId(options.bookId, 'bookId');
    const revisionId = requiredId(options.revisionId, 'revisionId');
    const record = await readRevision(options.db, bookId, revisionId);
    if (record.stage !== REVISION_STAGES.OCR_PARSE || record.status !== 'running') return record;
    if (!revisionLeaseMatches(record, options.workerId, options.fence)) {
        fail('REVISION_WORKER_FENCE_MISMATCH', 'worker lease is stale or revision identity does not match');
    }
    try {
        const getStorageBucket = options.getStorageBucket || options.deps?.getStorageBucket;
        const shards = options.shards || (typeof options.loadOutputShards === 'function'
            ? await options.loadOutputShards(record)
            : await loadRevisionOutputShards({
                record,
                getStorageBucket,
                outputUri: options.outputUri,
                maxShards: options.maxShards || 1000
            }));
        if (!Array.isArray(shards) || shards.length === 0) fail('DOCUMENT_AI_OUTPUT_INVALID', 'OCR output shards are required');
        const parse = options.parseDocumentAiOutput || options.deps?.parseDocumentAiOutput
            || require('./book-document-ocr-service').parseDocumentAiOutput;
        const limits = {
            maxPages: record.source.pageCount,
            ...(options.limits || {})
        };
        limits.maxPages = Math.min(record.source.pageCount, limits.maxPages);
        const parsed = await parse({
            shards,
            expectedPageCount: record.source.pageCount,
            expectedSourceGeneration: record.source.generation,
            expectedSourceSha256: record.source.sha256,
            limits,
            allowParsedJsonForTests: options.allowParsedJsonForTests === true
        });
        if (!parsed || !Array.isArray(parsed.pages) || parsed.pageCount !== record.source.pageCount) {
            fail('DOCUMENT_AI_PAGE_COUNT_MISMATCH', 'OCR parse did not produce the pinned page count');
        }
        if (parsed.sourceGeneration && parsed.sourceGeneration !== record.source.generation) {
            fail('DOCUMENT_AI_SOURCE_GENERATION_MISMATCH', 'parsed OCR source generation does not match the revision');
        }
        if (parsed.sourceSha256 && parsed.sourceSha256 !== record.source.sha256) {
            fail('DOCUMENT_AI_SOURCE_SHA256_MISMATCH', 'parsed OCR source hash does not match the revision');
        }
        const artifactInput = {
            bookId,
            revisionId,
            parsed,
            source: record.source,
            ...parsed
        };
        const artifact = options.persistCandidateArtifact
            ? await options.persistCandidateArtifact(artifactInput)
            : await persistCandidateArtifact({
                bookId,
                revisionId,
                parsed,
                source: record.source,
                bucket: options.bucket,
                getStorageBucket
            });
        if (!artifact || typeof artifact.path !== 'string' || typeof artifact.sha256 !== 'string') {
            fail('OCR_CANDIDATE_INVALID', 'candidate artifact persistence did not return immutable metadata');
        }
        return transitionWithSettlement({ ...options, bookId, revisionId }, {
            patch: {
                stage: REVISION_STAGES.CANDIDATE_CHUNK,
                candidate: {
                    path: artifact.path,
                    generation: artifact.generation || null,
                    sha256: artifact.sha256,
                    sizeBytes: artifact.sizeBytes,
                    pageCount: artifact.pageCount || parsed.pageCount,
                    physicalPageCount: parsed.physicalPageCount,
                    provenanceVerified: artifact.provenanceVerified ?? parsed.provenanceVerified === true,
                    sourceGeneration: record.source.generation,
                    sourceSha256: record.source.sha256,
                    outputSha256: parsed.outputSha256 || parsed.outputHash || null,
                    shardHashes: parsed.shardHashes || []
                },
                parse: { state: 'complete', parsedAt: options.now || new Date() }
            },
            outcome: 'success'
        });
    } catch (error) {
        if (error instanceof TextRevisionError && error.code === 'REVISION_WORKER_FENCE_MISMATCH') throw error;
        return failRevision({ ...options, bookId, revisionId }, error, record.retry?.attempt || 0);
    }
}

function classifyRevisionError(error, {
    attempt = 0,
    maxAttempts = DEFAULT_TRANSIENT_RETRIES,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS
} = {}) {
    const code = error && error.code !== undefined ? error.code : 'UNKNOWN';
    const transientCodes = new Set([
        'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED',
        'UNAVAILABLE', 'DEADLINE_EXCEEDED', 408, 429, 500, 502, 503, 504
    ]);
    const transient = transientCodes.has(code)
        || (typeof code === 'string' && /^\d+$/.test(code) && transientCodes.has(Number(code)));
    const retryableAttempt = Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
    const boundedMax = Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : DEFAULT_TRANSIENT_RETRIES;
    const base = Number.isSafeInteger(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : DEFAULT_RETRY_BASE_DELAY_MS;
    const max = Number.isSafeInteger(maxDelayMs) && maxDelayMs >= 0 ? maxDelayMs : DEFAULT_RETRY_MAX_DELAY_MS;
    const delayMs = Math.min(max, base * (2 ** retryableAttempt));
    if (!transient) return { classification: 'permanent', retry: false, delayMs: 0, code };
    if (retryableAttempt >= boundedMax) return { classification: 'retry_exhausted', retry: false, delayMs, code };
    return { classification: 'transient', retry: true, delayMs, code };
}

function normalizeRevisionCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate.data === 'function') {
        const data = candidate.data() || {};
        return { ...data, revisionId: data.revisionId || candidate.id, ref: candidate.ref };
    }
    return candidate;
}

function queueBatchSize(options) {
    const value = options.batchSize ?? options.maxBatchSize ?? DEFAULT_QUEUE_BATCH_SIZE;
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
        fail('REVISION_INPUT_INVALID', 'batchSize must be an integer from 1 through 100');
    }
    return value;
}

function queueStagePriority(stage) {
    if (stage === REVISION_STAGES.OCR_WAIT) return 0;
    if (stage === REVISION_STAGES.OCR_PARSE) return 1;
    if (stage === REVISION_STAGES.OCR_SUBMIT) return 2;
    return 3;
}

async function listEligibleRevisions(db, options) {
    const batchSize = queueBatchSize(options);
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const isDue = (revision) => {
        if (!revision.nextPollAt) return true;
        const dueAt = asMillis(revision.nextPollAt);
        return Number.isNaN(dueAt) || dueAt <= now.getTime();
    };
    const listRevisions = options.listRevisions || options.deps?.listRevisions;
    if (typeof listRevisions === 'function') {
        const listed = await listRevisions({ db, now: options.now });
        const eligible = (listed || []).map(normalizeRevisionCandidate)
            .filter((revision) => revision && revision.status === 'running' && isDue(revision));
        return eligible
            .map((revision, index) => ({ revision, index }))
            .sort((a, b) => queueStagePriority(a.revision.stage) - queueStagePriority(b.revision.stage)
                || a.index - b.index)
            .slice(0, batchSize)
            .map(({ revision }) => revision);
    }
    if (!db || typeof db.collectionGroup !== 'function') return [];
    const snapshot = await db.collectionGroup(TEXT_REVISIONS)
        .where('status', '==', 'running')
        .limit(batchSize)
        .get();
    const eligible = (snapshot.docs || []).map(normalizeRevisionCandidate)
        .filter((revision) => revision && isDue(revision));
    return eligible
        .map((revision, index) => ({ revision, index }))
        .sort((a, b) => queueStagePriority(a.revision.stage) - queueStagePriority(b.revision.stage)
            || a.index - b.index)
        .map(({ revision }) => revision);
}

async function releaseQueueLease(db, claimed, workerId, fence, now) {
    if (!claimed || !Number.isSafeInteger(fence) || fence < 1) return;
    try {
        await updateWithFence(db, {
            bookId: claimed.bookId,
            revisionId: claimed.revisionId,
            workerId,
            fence,
            patch: {},
            releaseLease: true,
            now
        });
    } catch (error) {
        // A stage handler may have released or replaced the lease itself. A
        // missing document is also possible for injected queue fakes.
        if (error instanceof TextRevisionError
            && ['REVISION_WORKER_FENCE_MISMATCH', 'REVISION_NOT_FOUND'].includes(error.code)) return;
        throw error;
    }
}

async function deferQueueLease(db, claimed, workerId, fence, now, delayMs = DEFAULT_DEFER_DELAY_MS) {
    if (!claimed || !Number.isSafeInteger(fence) || fence < 1) return;
    const timestamp = now instanceof Date ? now : new Date(now || Date.now());
    try {
        await updateWithFence(db, {
            bookId: claimed.bookId,
            revisionId: claimed.revisionId,
            workerId,
            fence,
            patch: { nextPollAt: new Date(timestamp.getTime() + delayMs) },
            releaseLease: true,
            now: timestamp
        });
    } catch (error) {
        if (error instanceof TextRevisionError
            && ['REVISION_WORKER_FENCE_MISMATCH', 'REVISION_NOT_FOUND'].includes(error.code)) return;
        throw error;
    }
}

async function runBookTextRevisionQueue(dbOrOptions, maybeOptions) {
    const options = normalizeDbOptions(dbOrOptions, maybeOptions);
    const revisions = await listEligibleRevisions(options.db, options);
    const workerId = options.workerId || `revision-worker-${Date.now()}`;
    const results = [];
    let processed = 0;
    let skipped = 0;
    let deferred = 0;
    for (const candidate of revisions) {
        if (!candidate.bookId || !candidate.revisionId || candidate.status !== 'running') {
            skipped += 1;
            continue;
        }
        const claim = options.claim || options.deps?.claim || claimRevision;
        let claimed;
        try {
            claimed = claim !== claimRevision
                ? await claim(candidate, { ...options, workerId })
                : await claim(options.db, { ...options, bookId: candidate.bookId, revisionId: candidate.revisionId, workerId });
        } catch (error) {
            if (error instanceof TextRevisionError && error.code === 'REVISION_LEASE_ACTIVE') {
                skipped += 1;
                continue;
            }
            throw error;
        }
        if (!claimed) {
            skipped += 1;
            continue;
        }
        const handlerOptions = { ...options, bookId: claimed.bookId, revisionId: claimed.revisionId, workerId, fence: claimed.lease?.fence };
        let handler;
        if (claimed.stage === REVISION_STAGES.OCR_SUBMIT) handler = options.submit || options.deps?.submit || submitRevisionOcr;
        else if (claimed.stage === REVISION_STAGES.OCR_WAIT) handler = options.poll || options.deps?.poll || pollRevisionOcr;
        else if (claimed.stage === REVISION_STAGES.OCR_PARSE) handler = options.parse || options.deps?.parse || parseRevisionOcr;
        else {
            await releaseQueueLease(options.db, claimed, workerId, claimed.lease?.fence, options.now);
            skipped += 1;
            continue;
        }
        const injectedHandler = handler === options.submit || handler === options.poll || handler === options.parse
            || handler === options.deps?.submit || handler === options.deps?.poll || handler === options.deps?.parse;
        let result;
        let expectedDeferral = false;
        try {
            result = injectedHandler
                ? await handler(claimed, handlerOptions)
                : await handler(options.db, handlerOptions);
        } catch (error) {
            if (!EXPECTED_DEFER_CODES.has(error && error.code)) throw error;
            expectedDeferral = true;
            await deferQueueLease(options.db, claimed, workerId, claimed.lease?.fence, options.now, options.deferDelayMs);
            deferred += 1;
        } finally {
            await releaseQueueLease(options.db, claimed, workerId, claimed.lease?.fence, options.now);
        }
        if (expectedDeferral) continue;
        processed += 1;
        results.push(result);
    }
    return { processed, skipped, deferred, results };
}

module.exports = {
    TextRevisionError,
    validateSourceMetadata,
    snapshotImmutableSource,
    buildRevisionRecord,
    createRevision,
    claimRevision,
    updateWithFence,
    reserveOcrSubmission,
    settleOcrReservation,
    submitRevisionOcr,
    pollRevisionOcr,
    parseRevisionOcr,
    loadRevisionOutputShards,
    persistCandidateArtifact,
    classifyRevisionError,
    runBookTextRevisionQueue,
    REVISION_STAGES,
    MAX_SOURCE_BYTES,
    MAX_PAGE_COUNT,
    DEFAULT_LEASE_DURATION_MS,
    DEFAULT_MAX_LRO_AGE_MS,
    DEFAULT_MONTHLY_PAGE_LIMIT,
    DEFAULT_MAX_ACTIVE_OCR,
    DEFAULT_TRANSIENT_RETRIES,
    DEFAULT_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_MAX_DELAY_MS
};
