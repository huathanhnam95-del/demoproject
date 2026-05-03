const crypto = require('crypto');
const { SYNCABLE_COLLECTIONS, listSyncableCollections } = require('./sync-from-prod-config');

const DEFAULT_MAX_DOCS = 500;
const MAX_DOCS_LIMIT = 10000;
const BATCH_SIZE = 400;

const SYNC_FROM_PROD_MAX_STAGED_DOCS = Number(process.env.SYNC_FROM_PROD_MAX_STAGED_DOCS) || 250000;
const SYNC_FROM_PROD_MAX_BACKUP_DOCS = Number(process.env.SYNC_FROM_PROD_MAX_BACKUP_DOCS) || 250000;

function createJobStore() {
    const jobs = new Map();
    let activeJobId = null;
    let lastJobId = null;

    return {
        create(job) {
            jobs.set(job.jobId, job);
            activeJobId = job.jobId;
        },
        get(jobId) {
            return jobs.get(jobId) || null;
        },
        update(jobId, updater) {
            const current = jobs.get(jobId);
            if (!current) return null;
            updater(current);
            return current;
        },
        finish(jobId) {
            if (activeJobId === jobId) {
                activeJobId = null;
            }
            lastJobId = jobId;
        },
        getActive() {
            return activeJobId ? jobs.get(activeJobId) || null : null;
        },
        getLatest() {
            const active = this.getActive();
            if (active) return active;
            return lastJobId ? jobs.get(lastJobId) || null : null;
        }
    };
}

function buildJobId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function nowIso() {
    return new Date().toISOString();
}

function isDocumentReference(value) {
    return !!value
        && typeof value === 'object'
        && typeof value.path === 'string'
        && typeof value.id === 'string'
        && typeof value.collection === 'function';
}

function isTimestampLike(value) {
    return !!value
        && typeof value === 'object'
        && typeof value.toDate === 'function'
        && typeof value.toMillis === 'function';
}

function isGeoPointLike(value) {
    return !!value
        && typeof value === 'object'
        && typeof value.latitude === 'number'
        && typeof value.longitude === 'number';
}

function isBytesLike(value) {
    return !!value
        && typeof value === 'object'
        && typeof value.toBase64 === 'function';
}

function normalizeFirestoreValue(value, localDb) {
    if (value === null || typeof value !== 'object') return value;
    if (Buffer.isBuffer(value) || value instanceof Date || value instanceof Uint8Array) return value;
    if (isDocumentReference(value)) return localDb.doc(value.path);
    if (isTimestampLike(value) || isGeoPointLike(value) || isBytesLike(value)) return value;
    if (Array.isArray(value)) return value.map((entry) => normalizeFirestoreValue(entry, localDb));

    const out = {};
    for (const [key, entry] of Object.entries(value)) {
        out[key] = normalizeFirestoreValue(entry, localDb);
    }
    return out;
}

function createQuery(collectionRef, adminRef, limitCount) {
    let query = collectionRef;
    if (adminRef?.firestore?.FieldPath?.documentId) {
        query = query.orderBy(adminRef.firestore.FieldPath.documentId());
    } else if (typeof query.orderBy === 'function') {
        query = query.orderBy('__name__');
    }
    if (typeof limitCount === 'number' && typeof query.limit === 'function') {
        query = query.limit(limitCount);
    }
    return query;
}

async function listChildCollections(docRef) {
    if (!docRef || typeof docRef.listCollections !== 'function') {
        return [];
    }
    const childCollections = await docRef.listCollections();
    return Array.isArray(childCollections) ? childCollections : [];
}

async function stageCollectionTree({ collectionRef, adminRef, localDb, stagedDocs, limit }) {
    const query = createQuery(collectionRef, adminRef);
    const snapshot = await (typeof limit === 'number' ? query.limit(limit) : query).get();

    for (const doc of snapshot.docs) {
        stagedDocs.push({
            path: doc.ref.path,
            data: normalizeFirestoreValue(doc.data(), localDb)
        });

        if (typeof limit === 'number' && stagedDocs.length >= limit) {
            return;
        }

        const childCollections = await listChildCollections(doc.ref);
        for (const childCollectionRef of childCollections) {
            await stageCollectionTree({
                collectionRef: childCollectionRef,
                adminRef,
                localDb,
                stagedDocs,
                limit
            });
            if (typeof limit === 'number' && stagedDocs.length >= limit) {
                return;
            }
        }
    }
}

async function backupCollection({ localDb, adminRef, collectionName, maxBackupDocs }) {
    const stagedDocs = [];
    await stageCollectionTree({
        collectionRef: localDb.collection(collectionName),
        adminRef,
        localDb,
        stagedDocs,
        limit: maxBackupDocs + 1
    });

    if (stagedDocs.length > maxBackupDocs) {
        return {
            status: 'skipped',
            reason: 'LOCAL_BACKUP_TOO_LARGE',
            message: `Local backup of ${collectionName} exceeded ${maxBackupDocs} documents.`
        };
    }

    return {
        status: 'staged',
        stagedDocs
    };
}

function sanitizeInteger(value, fieldName, defaultValue) {
    if (value === undefined || value === null || value === '') {
        return { value: defaultValue };
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DOCS_LIMIT) {
        return {
            error: {
                status: 400,
                code: 'INVALID_LIMIT',
                message: `${fieldName} must be an integer between 1 and ${MAX_DOCS_LIMIT}.`
            }
        };
    }
    return { value: parsed };
}

function sanitizeCollections(collections) {
    if (!Array.isArray(collections) || collections.length === 0) {
        return {
            error: {
                status: 400,
                code: 'INVALID_COLLECTIONS',
                message: 'Provide a non-empty array of collection names in the request body.'
            }
        };
    }

    const normalized = collections
        .map((name) => String(name || '').trim())
        .filter(Boolean);

    if (normalized.length === 0) {
        return {
            error: {
                status: 400,
                code: 'INVALID_COLLECTIONS',
                message: 'Provide a non-empty array of collection names in the request body.'
            }
        };
    }

    const unique = [...new Set(normalized)];
    const validNames = new Set(Object.keys(SYNCABLE_COLLECTIONS));
    const invalid = unique.filter((name) => !validNames.has(name));
    if (invalid.length > 0) {
        return {
            error: {
                status: 400,
                code: 'INVALID_COLLECTIONS',
                message: `Unknown collections: ${invalid.join(', ')}.`
            }
        };
    }

    return {
        value: unique
    };
}

function buildStartPayload(job) {
    return {
        jobId: job.jobId,
        status: job.status,
        mode: job.mode,
        collections: [...job.collections],
        maxDocsPerCollection: job.maxDocsPerCollection,
        maxDocsPerSubcollection: job.maxDocsPerSubcollection
    };
}

function buildPublicJob(job) {
    return {
        jobId: job.jobId,
        status: job.status,
        mode: job.mode,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        currentCollection: job.currentCollection,
        collections: [...job.collections],
        collectionsCompleted: job.collectionsCompleted,
        collectionsTotal: job.collectionsTotal,
        docs: job.docs,
        subDocs: job.subDocs,
        warnings: [...job.warnings],
        errors: [...job.errors],
        results: { ...job.results },
        maxDocsPerCollection: job.maxDocsPerCollection,
        maxDocsPerSubcollection: job.maxDocsPerSubcollection
    };
}

async function stageCollection({ prodDb, localDb, adminRef, collectionName, config, maxDocsPerCollection, maxDocsPerSubcollection, maxTotalDocs }) {
    const stagedDocs = [];
    const rootQuery = createQuery(prodDb.collection(collectionName), adminRef, maxDocsPerCollection + 1);
    const rootSnapshot = await rootQuery.get();
    if (rootSnapshot.size > maxDocsPerCollection) {
        return {
            status: 'skipped',
            reason: 'MAX_DOCS_PER_COLLECTION_EXCEEDED',
            message: `${collectionName} exceeded maxDocsPerCollection (${maxDocsPerCollection}).`
        };
    }

    for (const doc of rootSnapshot.docs) {
        stagedDocs.push({
            path: `${collectionName}/${doc.id}`,
            data: normalizeFirestoreValue(doc.data(), localDb)
        });

        if (stagedDocs.length > maxTotalDocs) {
            return {
                status: 'skipped',
                reason: 'MAX_TOTAL_DOCS_EXCEEDED',
                message: `${collectionName} total staged docs exceeded cap (${maxTotalDocs}).`
            };
        }

        const subConfigs = config.subcollections || [];
        if (subConfigs.length > 0) {
            const subPromises = subConfigs.map(async (subName) => {
                const subQuery = createQuery(
                    prodDb.collection(collectionName).doc(doc.id).collection(subName),
                    adminRef,
                    maxDocsPerSubcollection + 1
                );
                return { name: subName, snapshot: await subQuery.get() };
            });

            const subSnapshots = await Promise.all(subPromises);

            for (const { name: subName, snapshot: subSnapshot } of subSnapshots) {
                if (subSnapshot.size > maxDocsPerSubcollection) {
                    return {
                        status: 'skipped',
                        reason: 'MAX_DOCS_PER_SUBCOLLECTION_EXCEEDED',
                        message: `${collectionName}/${doc.id}/${subName} exceeded maxDocsPerSubcollection (${maxDocsPerSubcollection}).`
                    };
                }

                for (const subDoc of subSnapshot.docs) {
                    stagedDocs.push({
                        path: `${collectionName}/${doc.id}/${subName}/${subDoc.id}`,
                        data: normalizeFirestoreValue(subDoc.data(), localDb)
                    });
                    if (stagedDocs.length > maxTotalDocs) {
                        return {
                            status: 'skipped',
                            reason: 'MAX_TOTAL_DOCS_EXCEEDED',
                            message: `${collectionName} total staged docs exceeded cap (${maxTotalDocs}).`
                        };
                    }
                }
            }
        }
    }

    return {
        status: 'staged',
        docs: rootSnapshot.size,
        subDocs: stagedDocs.length - rootSnapshot.size,
        stagedDocs
    };
}

async function writeStagedDocs(localDb, stagedDocs) {
    if (!Array.isArray(stagedDocs) || stagedDocs.length === 0) {
        return;
    }

    let batch = localDb.batch();
    let count = 0;
    for (const stagedDoc of stagedDocs) {
        batch.set(localDb.doc(stagedDoc.path), stagedDoc.data);
        count += 1;
        if (count >= BATCH_SIZE) {
            await batch.commit();
            batch = localDb.batch();
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
    }
}

async function commitCollection(localDb, adminRef, collectionName, stagedDocs, maxBackupDocs) {
    if (typeof localDb.recursiveDelete !== 'function') {
        throw new Error('Local Firestore does not support recursiveDelete.');
    }

    const backup = await backupCollection({
        localDb,
        adminRef,
        collectionName,
        maxBackupDocs: maxBackupDocs !== undefined ? maxBackupDocs : SYNC_FROM_PROD_MAX_BACKUP_DOCS
    });

    if (backup.status === 'skipped') {
        return backup;
    }

    const backupDocs = backup.stagedDocs;

    await localDb.recursiveDelete(localDb.collection(collectionName));

    try {
        await writeStagedDocs(localDb, stagedDocs);
        return { status: 'synced' };
    } catch (error) {
        try {
            await localDb.recursiveDelete(localDb.collection(collectionName));
            await writeStagedDocs(localDb, backupDocs);
        } catch (rollbackError) {
            const rollbackMessage = rollbackError?.message || String(rollbackError);
            error.message = `${error.message} Rollback failed: ${rollbackMessage}`;
        }
        throw error;
    }
}

function createSyncFromProdService(rawOptions = {}) {
    const options = rawOptions || {};
    const jobStore = options.jobStore || createJobStore();
    const logger = options.logger || console;

    async function runJob(job) {
        try {
            const prodDb = await options.getProdDb();
            for (const collectionName of job.collections) {
                job.currentCollection = collectionName;
                try {
                    const staged = await stageCollection({
                        prodDb,
                        localDb: options.localDb,
                        adminRef: options.admin,
                        collectionName,
                        config: SYNCABLE_COLLECTIONS[collectionName],
                        maxDocsPerCollection: job.maxDocsPerCollection,
                        maxDocsPerSubcollection: job.maxDocsPerSubcollection,
                        maxTotalDocs: options.maxStagedDocs !== undefined ? options.maxStagedDocs : SYNC_FROM_PROD_MAX_STAGED_DOCS
                    });

                    if (staged.status === 'skipped') {
                        job.results[collectionName] = {
                            status: 'skipped',
                            docs: 0,
                            subDocs: 0,
                            reason: staged.reason,
                            message: staged.message
                        };
                        job.warnings.push({
                            collection: collectionName,
                            code: staged.reason,
                            message: staged.message
                        });
                        continue;
                    }

                    const committed = await commitCollection(
                        options.localDb,
                        options.admin,
                        collectionName,
                        staged.stagedDocs,
                        options.maxBackupDocs !== undefined ? options.maxBackupDocs : SYNC_FROM_PROD_MAX_BACKUP_DOCS
                    );

                    if (committed.status === 'skipped') {
                        job.results[collectionName] = {
                            status: 'skipped',
                            docs: 0,
                            subDocs: 0,
                            reason: committed.reason,
                            message: committed.message
                        };
                        job.warnings.push({
                            collection: collectionName,
                            code: committed.reason,
                            message: committed.message
                        });
                        continue;
                    }

                    job.results[collectionName] = {
                        status: 'synced',
                        docs: staged.docs,
                        subDocs: staged.subDocs
                    };
                    job.docs += staged.docs;
                    job.subDocs += staged.subDocs;
                } catch (error) {
                    const message = error?.message || String(error);
                    logger.error(`[Sync] ${collectionName} failed: ${message}`);
                    job.results[collectionName] = {
                        status: 'skipped',
                        docs: 0,
                        subDocs: 0,
                        reason: 'SYNC_COLLECTION_FAILED',
                        message
                    };
                    job.errors.push({
                        collection: collectionName,
                        code: 'SYNC_COLLECTION_FAILED',
                        message
                    });
                } finally {
                    job.collectionsCompleted += 1;
                }
            }

            job.currentCollection = null;
            job.finishedAt = nowIso();
            job.status = job.errors.length > 0 || job.warnings.length > 0
                ? 'completed_with_issues'
                : 'completed';
        } catch (error) {
            const message = error?.message || String(error);
            logger.error(`[Sync] job failed: ${message}`);
            job.currentCollection = null;
            job.finishedAt = nowIso();
            job.status = 'failed';
            job.errors.push({
                collection: null,
                code: 'SYNC_JOB_FAILED',
                message
            });
        } finally {
            jobStore.finish(job.jobId);
        }
    }

    function validateStart(mode, payload = {}) {
        const maxDocsPerCollectionResult = sanitizeInteger(
            payload.maxDocsPerCollection !== undefined ? payload.maxDocsPerCollection : payload.limit,
            'maxDocsPerCollection',
            DEFAULT_MAX_DOCS
        );
        if (maxDocsPerCollectionResult.error) return maxDocsPerCollectionResult;

        const maxDocsPerSubcollectionResult = sanitizeInteger(
            payload.maxDocsPerSubcollection,
            'maxDocsPerSubcollection',
            maxDocsPerCollectionResult.value
        );
        if (maxDocsPerSubcollectionResult.error) return maxDocsPerSubcollectionResult;

        if (mode === 'full') {
            const sortedKeys = Object.keys(SYNCABLE_COLLECTIONS).sort();
            return {
                value: {
                    collections: sortedKeys,
                    maxDocsPerCollection: maxDocsPerCollectionResult.value,
                    maxDocsPerSubcollection: maxDocsPerSubcollectionResult.value
                }
            };
        }

        const collectionsResult = sanitizeCollections(payload.collections);
        if (collectionsResult.error) return collectionsResult;

        return {
            value: {
                collections: collectionsResult.value,
                maxDocsPerCollection: maxDocsPerCollectionResult.value,
                maxDocsPerSubcollection: maxDocsPerSubcollectionResult.value
            }
        };
    }

    function startJob(mode, payload = {}) {
        const activeJob = jobStore.getActive();
        if (activeJob) {
            return {
                error: {
                    status: 429,
                    code: 'SYNC_IN_PROGRESS',
                    message: 'A sync is already in progress. Please wait.'
                }
            };
        }

        const validated = validateStart(mode, payload);
        if (validated.error) return validated;

        const job = {
            jobId: buildJobId(),
            status: 'running',
            mode,
            collections: validated.value.collections,
            maxDocsPerCollection: validated.value.maxDocsPerCollection,
            maxDocsPerSubcollection: validated.value.maxDocsPerSubcollection,
            startedAt: nowIso(),
            finishedAt: null,
            currentCollection: null,
            collectionsCompleted: 0,
            collectionsTotal: validated.value.collections.length,
            docs: 0,
            subDocs: 0,
            warnings: [],
            errors: [],
            results: {}
        };

        jobStore.create(job);
        Promise.resolve().then(() => runJob(job));

        return { value: buildStartPayload(job) };
    }

    return {
        listCollections: listSyncableCollections,
        startJob,
        getJob(jobId) {
            const job = jobStore.get(jobId);
            return job ? buildPublicJob(job) : null;
        },
        getLatestJob() {
            const job = jobStore.getLatest();
            return job ? buildPublicJob(job) : null;
        }
    };
}

module.exports = {
    DEFAULT_MAX_DOCS,
    MAX_DOCS_LIMIT,
    createJobStore,
    createSyncFromProdService
};
