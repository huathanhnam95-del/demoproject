/* eslint-disable no-console */
const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

function deepClone(value, seen = new Map()) {
    if (value === null || typeof value !== 'object') return value;
    if (value.__isFakeDocumentReference) return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const item of value) {
            out.push(deepClone(item, seen));
        }
        return out;
    }
    const out = {};
    seen.set(value, out);
    for (const [key, entry] of Object.entries(value)) {
        out[key] = deepClone(entry, seen);
    }
    return out;
}

class FakeDocumentReference {
    constructor(firestore, pathValue) {
        this.__isFakeDocumentReference = true;
        this.firestore = firestore;
        this.path = pathValue;
        const segments = String(pathValue || '').split('/').filter(Boolean);
        this.id = segments[segments.length - 1] || '';
    }

    collection(name) {
        return new FakeCollectionReference(this.firestore, `${this.path}/${name}`);
    }

    async listCollections() {
        return this.firestore._listSubcollections(this.path).map((collectionPath) => (
            new FakeCollectionReference(this.firestore, collectionPath)
        ));
    }

    async set(data, options = {}) {
        this.firestore._writeDoc(this.path, data, options);
    }

    async get() {
        return this.firestore._buildDocSnapshot(this.path);
    }
}

class FakeCollectionReference {
    constructor(firestore, pathValue) {
        this.firestore = firestore;
        this.path = pathValue;
        this._limit = null;
        this._orderBy = null;
    }

    orderBy() {
        return this;
    }

    limit(n) {
        this._limit = n;
        return this;
    }

    doc(id) {
        return new FakeDocumentReference(this.firestore, `${this.path}/${id}`);
    }

    async get() {
        return this.firestore._queryCollection(this.path, this._limit);
    }
}

class FakeWriteBatch {
    constructor(firestore) {
        this.firestore = firestore;
        this.operations = [];
    }

    set(ref, data, options = {}) {
        this.operations.push({ type: 'set', ref, data, options });
    }

    delete(ref) {
        this.operations.push({ type: 'delete', ref });
    }

    async commit() {
        if (typeof this.firestore.batchCommitHook === 'function') {
            await this.firestore.batchCommitHook({
                operations: this.operations.map((operation) => ({
                    ...operation,
                    ref: operation.ref ? { path: operation.ref.path } : null
                }))
            });
        }
        for (const operation of this.operations) {
            if (operation.type === 'set') {
                this.firestore._writeDoc(operation.ref.path, operation.data, operation.options);
                continue;
            }
            this.firestore._deleteDoc(operation.ref.path);
        }
        this.operations = [];
    }
}

class FakeFirestore {
    constructor(seed = {}) {
        this.seed = deepClone(seed);
        this.docs = new Map();
        this.recursiveDeleteCalls = [];
        this.collectionGetHooks = new Map();
        this.batchCommitHook = null;
        this._loadSeed(this.seed);
    }

    _loadSeed(seed) {
        for (const [docPath, data] of Object.entries(seed || {})) {
            this.docs.set(docPath, deepClone(data));
        }
    }

    collection(name) {
        return new FakeCollectionReference(this, name);
    }

    doc(pathValue) {
        return new FakeDocumentReference(this, pathValue);
    }

    batch() {
        return new FakeWriteBatch(this);
    }

    async recursiveDelete(ref) {
        this.recursiveDeleteCalls.push(ref.path);
        for (const docPath of Array.from(this.docs.keys())) {
            if (docPath === ref.path || docPath.startsWith(`${ref.path}/`)) {
                this.docs.delete(docPath);
            }
        }
    }

    _writeDoc(pathValue, data, options = {}) {
        const nextValue = deepClone(data);
        if (options && options.merge && this.docs.has(pathValue)) {
            this.docs.set(pathValue, { ...deepClone(this.docs.get(pathValue)), ...nextValue });
            return;
        }
        this.docs.set(pathValue, nextValue);
    }

    _deleteDoc(pathValue) {
        this.docs.delete(pathValue);
    }

    _buildDocSnapshot(pathValue) {
        const exists = this.docs.has(pathValue);
        const firestore = this;
        return {
            exists,
            id: pathValue.split('/').pop(),
            ref: new FakeDocumentReference(firestore, pathValue),
            data() {
                return exists ? deepClone(firestore.docs.get(pathValue)) : undefined;
            }
        };
    }

    _listSubcollections(docPath) {
        const docSegments = String(docPath || '').split('/').filter(Boolean);
        const names = new Set();
        for (const existingPath of this.docs.keys()) {
            const segments = String(existingPath || '').split('/').filter(Boolean);
            if (segments.length <= docSegments.length + 1) continue;
            let matches = true;
            for (let index = 0; index < docSegments.length; index += 1) {
                if (segments[index] !== docSegments[index]) {
                    matches = false;
                    break;
                }
            }
            if (!matches) continue;
            names.add(segments[docSegments.length]);
        }
        return Array.from(names)
            .sort()
            .map((name) => `${docPath}/${name}`);
    }

    _queryCollection(pathValue, limitCount) {
        const hook = this.collectionGetHooks.get(pathValue);
        const runQuery = async () => {
            const paths = Array.from(this.docs.keys())
                .filter((docPath) => isDirectChild(pathValue, docPath))
                .sort();
            const limitedPaths = typeof limitCount === 'number' ? paths.slice(0, limitCount) : paths;
            const docs = limitedPaths.map((docPath) => this._buildDocSnapshot(docPath));
            return {
                size: docs.length,
                docs
            };
        };

        if (typeof hook === 'function') {
            return hook({ path: pathValue, limit: limitCount, next: runQuery });
        }

        return runQuery();
    }

    dump() {
        return Object.fromEntries(Array.from(this.docs.entries()).sort((left, right) => left[0].localeCompare(right[0])));
    }
}

function isDirectChild(collectionPath, docPath) {
    const collectionSegments = String(collectionPath || '').split('/').filter(Boolean);
    const docSegments = String(docPath || '').split('/').filter(Boolean);
    if (docSegments.length !== collectionSegments.length + 1) return false;
    return collectionSegments.every((segment, index) => docSegments[index] === segment);
}

function buildRouterContext(options = {}) {
    const { prodDb, localDb, maxStagedDocs, maxBackupDocs, ...rest } = options;
    return {
        db: localDb,
        maxStagedDocs: maxStagedDocs !== undefined ? maxStagedDocs : 250000,
        maxBackupDocs: maxBackupDocs !== undefined ? maxBackupDocs : 250000,
        admin: {
            firestore: {
                FieldPath: {
                    documentId() {
                        return '__document_id__';
                    }
                }
            }
        },
        authMiddleware: (req, _res, next) => {
            req.user = { uid: 'u1', email: 'admin@example.com' };
            next();
        },
        sendError: (res, status, error, message, details = null) => res.status(status).json({
            success: false,
            error,
            message,
            ...(details ? { details } : {})
        }),
        getProdDb: () => prodDb
    };
}

async function startServer(router) {
    return new Promise((resolve) => {
        const app = express();
        app.use(express.json());
        app.use('/api/admin', router);
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`
            });
        });
    });
}

async function stopServer(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function apiJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => null);
    return { response, body };
}

async function waitForJob(baseUrl, jobId, expectedStatuses) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20000) {
        const { response, body } = await apiJson(`${baseUrl}/api/admin/sync-from-prod/jobs/${jobId}`);
        assert.strictEqual(response.status, 200, `Expected job status 200, got ${response.status}`);
        const status = body?.data?.status;
        if (expectedStatuses.includes(status)) {
            return body.data;
        }
        if (status === 'failed') {
            throw new Error(`Job ${jobId} failed: ${JSON.stringify(body.data.errors)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const { body: finalBody } = await apiJson(`${baseUrl}/api/admin/sync-from-prod/jobs/${jobId}`);
    throw new Error(`Timed out waiting for job ${jobId}. Status: ${finalBody?.data?.status}`);
}

async function run() {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

    const syncServicePath = require.resolve(path.join(process.cwd(), 'src/utils/sync-from-prod-service.js'));
    delete require.cache[syncServicePath];
    const syncRoutePath = require.resolve(path.join(process.cwd(), 'src/routes/sync-from-prod.js'));
    delete require.cache[syncRoutePath];
    const syncFromProdModule = require(syncRoutePath);
    const createSyncFromProdRouter = syncFromProdModule.createSyncFromProdRouter;

    const prodDb = new FakeFirestore({
        'crmStudents/student-1': {
            name: 'Prod Student One'
        },
        'crmStudents/student-2': {
            name: 'Prod Student Two'
        },
        'crmClassrooms/class-1': {
            title: 'Production Classroom',
            studentRef: null
        },
        'crmClassrooms/class-1/modules/module-1': {
            title: 'Module A'
        },
        'crmTemplates/template-1': {
            title: 'Welcome'
        },
        'crmAutomationRules/rule-1': {
            active: true
        },
        'crmAutomationQueue/queue-1': {
            state: 'queued'
        },
        'crmRecycleBin/recycle-1': {
            state: 'deleted'
        }
    });
    prodDb.docs.get('crmClassrooms/class-1').studentRef = prodDb.doc('crmStudents/student-1');

    const localDb = new FakeFirestore({
        'crmClassrooms/class-1': {
            title: 'Old Local Classroom',
            staleField: true
        },
        'crmClassrooms/class-1/modules/module-1': {
            title: 'Stale Module'
        },
        'crmClassrooms/class-1/classwork/task-legacy': {
            title: 'Legacy Classwork'
        },
        'crmClassrooms/class-legacy': {
            title: 'Legacy Classroom'
        },
        'crmStudents/local-only': {
            name: 'Local Only Student'
        }
    });

    const router = createSyncFromProdRouter(buildRouterContext({ prodDb, localDb }));
    const { server, baseUrl } = await startServer(router);

    try {
        let result = await apiJson(`${baseUrl}/api/admin/sync-from-prod/selective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
            body: JSON.stringify({ collections: ['crmStudents'], maxDocsPerCollection: -1 })
        });
        assert.strictEqual(result.response.status, 400, 'negative maxDocsPerCollection should be rejected');

        result = await apiJson(`${baseUrl}/api/admin/sync-from-prod/selective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
            body: JSON.stringify({ collections: ['crmStudents'], maxDocsPerCollection: 1.5 })
        });
        assert.strictEqual(result.response.status, 400, 'non-integer maxDocsPerCollection should be rejected');

        result = await apiJson(`${baseUrl}/api/admin/sync-from-prod/selective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
            body: JSON.stringify({ collections: ['crmUnknown'], maxDocsPerCollection: 10 })
        });
        assert.strictEqual(result.response.status, 400, 'unknown collections should be rejected');

        result = await apiJson(`${baseUrl}/api/admin/sync-from-prod/collections`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer test' }
        });
        assert.strictEqual(result.response.status, 200, 'collections endpoint should be available');
        const collectionNames = new Set((result.body?.data?.collections || []).map((entry) => entry.name));
        assert(collectionNames.has('crmTemplates'), 'business data collections should include crmTemplates');
        assert(collectionNames.has('crmAutomationRules'), 'business data collections should include crmAutomationRules');
        assert(!collectionNames.has('crmAutomationQueue'), 'internal queue collection should be excluded');
        assert(!collectionNames.has('crmRecycleBin'), 'recycle bin collection should be excluded');

        result = await apiJson(`${baseUrl}/api/admin/sync-from-prod/selective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
            body: JSON.stringify({
                collections: ['crmClassrooms'],
                maxDocsPerCollection: 10,
                maxDocsPerSubcollection: 10
            })
        });
        assert.strictEqual(result.response.status, 202, 'selective sync should start asynchronously');
        const replaceJob = await waitForJob(baseUrl, result.body?.data?.jobId, ['completed']);
        assert.strictEqual(replaceJob.status, 'completed');
        assert.deepStrictEqual(localDb.dump(), {
            'crmClassrooms/class-1': {
                title: 'Production Classroom',
                studentRef: localDb.doc('crmStudents/student-1')
            },
            'crmClassrooms/class-1/modules/module-1': {
                title: 'Module A'
            },
            'crmStudents/local-only': {
                name: 'Local Only Student'
            }
        }, 'replace sync should delete stale classroom docs, fields, and subcollections');
        assert.strictEqual(localDb.dump()['crmClassrooms/class-1'].studentRef.firestore, localDb, 'DocumentReference fields should point at the local Firestore instance');

        const latestActiveProdDb = new FakeFirestore({
            'crmStudents/student-1': { name: 'Delayed Student' }
        });
        latestActiveProdDb.collectionGetHooks.set('crmStudents', async ({ next }) => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return next();
        });
        const delayedLocalDb = new FakeFirestore({});
        const delayedRouter = createSyncFromProdRouter(buildRouterContext({ prodDb: latestActiveProdDb, localDb: delayedLocalDb }));
        const delayedServerContext = await startServer(delayedRouter);
        try {
            result = await apiJson(`${delayedServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                body: JSON.stringify({ collections: ['crmStudents'], maxDocsPerCollection: 10 })
            });
            assert.strictEqual(result.response.status, 202, 'delayed sync should start');
            const delayedJobId = result.body?.data?.jobId;
            const latestDuringRun = await apiJson(`${delayedServerContext.baseUrl}/api/admin/sync-from-prod/jobs/latest`, {
                method: 'GET',
                headers: { 'Authorization': 'Bearer test' }
            });
            assert.strictEqual(latestDuringRun.response.status, 200, 'jobs/latest should return active job');
            assert.strictEqual(latestDuringRun.body?.data?.jobId, delayedJobId, 'jobs/latest should point to active job while running');

            const delayedFinished = await waitForJob(delayedServerContext.baseUrl, delayedJobId, ['completed']);
            const latestAfterRun = await apiJson(`${delayedServerContext.baseUrl}/api/admin/sync-from-prod/jobs/latest`, {
                method: 'GET',
                headers: { 'Authorization': 'Bearer test' }
            });
            assert.strictEqual(latestAfterRun.body?.data?.jobId, delayedFinished.jobId, 'jobs/latest should point to last completed job after completion');
            assert.strictEqual(latestAfterRun.body?.data?.status, 'completed', 'jobs/latest should expose final status');
        } finally {
            await stopServer(delayedServerContext.server);
        }

        const overflowProdDb = new FakeFirestore({
            'crmStudents/student-1': { name: 'One' },
            'crmStudents/student-2': { name: 'Two' },
            'crmTemplates/template-1': { title: 'Template' }
        });
        const overflowLocalDb = new FakeFirestore({
            'crmStudents/local-preserved': { name: 'Preserved' },
            'crmTemplates/local-template': { title: 'Old Local Template' }
        });
        const overflowRouter = createSyncFromProdRouter(buildRouterContext({ prodDb: overflowProdDb, localDb: overflowLocalDb }));
        const overflowServerContext = await startServer(overflowRouter);
        try {
            result = await apiJson(`${overflowServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                body: JSON.stringify({
                    collections: ['crmStudents', 'crmTemplates'],
                    maxDocsPerCollection: 1,
                    maxDocsPerSubcollection: 1
                })
            });
            assert.strictEqual(result.response.status, 202, 'overflow test should start');
            const overflowJob = await waitForJob(overflowServerContext.baseUrl, result.body?.data?.jobId, ['completed_with_issues']);
            assert.strictEqual(overflowJob.status, 'completed_with_issues', 'mixed success should report completed_with_issues');
            assert.strictEqual(overflowLocalDb.recursiveDeleteCalls.includes('crmStudents'), false, 'over-limit collection should not be deleted before being skipped');
            assert.deepStrictEqual(overflowLocalDb.dump()['crmStudents/local-preserved'], { name: 'Preserved' }, 'over-limit collection should preserve existing local docs');
            assert.deepStrictEqual(overflowLocalDb.dump()['crmTemplates/template-1'], { title: 'Template' }, 'successful collections should still be replaced');
            assert(overflowJob.results.crmStudents, 'skipped collection result should be reported');
            assert(overflowJob.results.crmTemplates, 'successful collection result should be reported');
        } finally {
            await stopServer(overflowServerContext.server);
        }

        const trimmedProdDb = new FakeFirestore({
            'crmStudents/student-1': { name: 'Trimmed Student' },
            'crmTemplates/template-1': { title: 'Trimmed Template' }
        });
        const trimmedLocalDb = new FakeFirestore({
            'crmStudents/local-only': { name: 'Local Only Student' },
            'crmTemplates/local-template': { title: 'Local Only Template' }
        });
        const trimmedRouter = createSyncFromProdRouter(buildRouterContext({ prodDb: trimmedProdDb, localDb: trimmedLocalDb }));
        const trimmedServerContext = await startServer(trimmedRouter);
        try {
            result = await apiJson(`${trimmedServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                body: JSON.stringify({
                    collections: [' crmStudents ', 'crmTemplates ', 'crmStudents'],
                    maxDocsPerCollection: 10,
                    maxDocsPerSubcollection: 10
                })
            });
            assert.strictEqual(result.response.status, 202, 'collection names should be trimmed before validation');
            const trimmedJob = await waitForJob(trimmedServerContext.baseUrl, result.body?.data?.jobId, ['completed']);
            assert.strictEqual(trimmedJob.status, 'completed', 'trimmed collection sync should complete');
            assert.deepStrictEqual(trimmedLocalDb.dump(), {
                'crmStudents/student-1': { name: 'Trimmed Student' },
                'crmTemplates/template-1': { title: 'Trimmed Template' }
            }, 'trimmed and duplicated collection names should sync the expected scope');
        } finally {
            await stopServer(trimmedServerContext.server);
        }

        const rollbackProdDb = new FakeFirestore({
            'crmTemplates/template-1': { title: 'Prod Template' }
        });
        const rollbackLocalDb = new FakeFirestore({
            'crmTemplates/local-template': { title: 'Local Template' }
        });
        let rollbackCommitAttempts = 0;
        rollbackLocalDb.batchCommitHook = async () => {
            rollbackCommitAttempts += 1;
            if (rollbackCommitAttempts === 1) {
                throw new Error('Simulated batch commit failure');
            }
        };
        const rollbackRouter = createSyncFromProdRouter(buildRouterContext({ prodDb: rollbackProdDb, localDb: rollbackLocalDb }));
        const rollbackServerContext = await startServer(rollbackRouter);
        try {
            result = await apiJson(`${rollbackServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                body: JSON.stringify({
                    collections: ['crmTemplates'],
                    maxDocsPerCollection: 10,
                    maxDocsPerSubcollection: 10
                })
            });
            assert.strictEqual(result.response.status, 202, 'rollback scenario should start');
            const rollbackJob = await waitForJob(rollbackServerContext.baseUrl, result.body?.data?.jobId, ['completed_with_issues']);
            assert.strictEqual(rollbackJob.status, 'completed_with_issues', 'commit failures should surface as completed_with_issues');
            assert.deepStrictEqual(rollbackLocalDb.dump(), {
                'crmTemplates/local-template': { title: 'Local Template' }
            }, 'failed commits should restore the previous local collection state');
            assert.strictEqual(rollbackJob.results.crmTemplates.status, 'skipped', 'failed collection should be reported as skipped');
            assert.strictEqual(rollbackJob.errors[0].code, 'SYNC_COLLECTION_FAILED', 'commit failures should be reported as collection errors');
        } finally {
            await stopServer(rollbackServerContext.server);
        }
        const capProdDb = new FakeFirestore({
            'crmStudents/student-1': { name: 'One' },
            'crmStudents/student-1/sub/sub-1': { name: 'Sub One' }
        });
        const capLocalDb = new FakeFirestore({});
        const capRouter = createSyncFromProdRouter(buildRouterContext({
            prodDb: capProdDb,
            localDb: capLocalDb,
            maxStagedDocs: 0
        }));
        const capServerContext = await startServer(capRouter);
        try {
            result = await apiJson(`${capServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                body: JSON.stringify({ collections: ['crmStudents'], maxDocsPerCollection: 10 })
            });
            const capJob = await waitForJob(capServerContext.baseUrl, result.body?.data?.jobId, ['completed_with_issues']);
            assert.strictEqual(capJob.results.crmStudents.status, 'skipped');
            assert.strictEqual(capJob.results.crmStudents.reason, 'MAX_TOTAL_DOCS_EXCEEDED');

            const backupLocalDb = new FakeFirestore({ 'crmTemplates/local-1': { title: 'Local Template' } });
            const backupRouter = createSyncFromProdRouter(buildRouterContext({
                prodDb: capProdDb,
                localDb: backupLocalDb,
                maxBackupDocs: 0
            }));
            const backupServerContext = await startServer(backupRouter);
            try {
                result = await apiJson(`${backupServerContext.baseUrl}/api/admin/sync-from-prod/selective`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
                    body: JSON.stringify({ collections: ['crmTemplates'], maxDocsPerCollection: 10 })
                });
                const backupJob = await waitForJob(backupServerContext.baseUrl, result.body?.data?.jobId, ['completed_with_issues']);
                assert.strictEqual(backupJob.results.crmTemplates.status, 'skipped');
                assert.strictEqual(backupJob.results.crmTemplates.reason, 'LOCAL_BACKUP_TOO_LARGE');
            } finally {
                await stopServer(backupServerContext.server);
            }
        } finally {
            await stopServer(capServerContext.server);
        }

        result = await apiJson(`${baseUrl}/api/admin/sync-from-prod`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' }
        });
        assert.strictEqual(result.response.status, 202);
        const fullJob = await waitForJob(baseUrl, result.body?.data?.jobId, ['completed', 'completed_with_issues']);
        const jobCollections = fullJob.collections;
        const sortedCollections = [...jobCollections].sort();
        assert.deepStrictEqual(jobCollections, sortedCollections, 'Full sync job collections should be sorted alphabetically');

    } finally {
        await stopServer(server);
    }

    console.log('sync-from-prod behavior passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
