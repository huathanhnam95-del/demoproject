const path = require('path');
const crypto = require('crypto');
const createCrmRouter = require('../../functions/src/routes/admin/create-crm-router');
const { CRM_LEADS } = require('../../functions/src/crm/collections');
const { buildLeadStageSyncPatch } = require('../../functions/src/crm/lead-service');
const { admin, db, getStorageBucket } = require('../utils/firebase');
const { sendError, sendSuccess } = require('../utils/response-helper');
const authMiddleware = require('../middleware/auth');
const {
    hashTokenToTestId,
    TEST_VERSION,
    buildPublicSession
} = require('../entrance-test/test36plus');
const { buildEntranceTestAdminList } = require('../../functions/src/crm/entrance-test-link-recovery');

const VALID_TEST_TYPES_LEGACY = new Set(['entrance_test_36plus_v1', 'segmental_screening_v1']);
const DEFAULT_TEST_TYPE_LEGACY = 'entrance_test_36plus_v1';

async function generateClassCode() {
    if (!db) {
        throw new Error('Firebase Admin not initialized.');
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 10; attempt += 1) {
        let code = '';
        for (let index = 0; index < 6; index += 1) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        const snap = await db.collection('crmStudents').where('class_code', '==', code).limit(1).get();
        if (snap.empty) {
            return code;
        }
    }

    throw new Error('Failed to generate a unique class code.');
}

async function mergeCustomClaims(uid, newClaims) {
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};
    await admin.auth().setCustomUserClaims(uid, { ...existingClaims, ...newClaims });
}

async function lookupUserByEmail(email) {
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        return {
            uid: userRecord.uid,
            email: userRecord.email,
            displayName: userRecord.displayName || 'No Name',
            photoURL: userRecord.photoURL || null
        };
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            throw new Error('User not found in Authentication system.');
        }
        throw error;
    }
}

async function forceLinkProfile(studentId, targetUid) {
    if (!db) {
        throw new Error('Firebase Admin not initialized.');
    }

    const studentRef = db.collection('crmStudents').doc(studentId);
    const snap = await studentRef.get();
    if (!snap.exists) {
        throw new Error('Student record not found.');
    }

    await studentRef.update({
        linked_user_ids: admin.firestore.FieldValue.arrayUnion(targetUid),
        updatedAt: new Date().toISOString()
    });

    await mergeCustomClaims(targetUid, { isStudent: true });
    return { success: true };
}

function registerLocalOnlyRoutes(router, deps) {
    const localDb = deps.db || db;
    const localAdmin = deps.admin || admin;
    const localAuthMiddleware = deps.authMiddleware || authMiddleware;
    const localSendSuccess = deps.sendSuccess || sendSuccess;
    const localSendError = deps.sendError || sendError;
    const localGetStorageBucket = deps.getStorageBucket || getStorageBucket;
    const localServerTimestamp = deps.serverTimestamp || (() => localAdmin.firestore.FieldValue.serverTimestamp());
    let isSyncing = false;

    // Mount prod → emulator sync routes (only when emulators are active)
    if (process.env.FIRESTORE_EMULATOR_HOST) {
        const { createSyncFromProdRouter } = require('./sync-from-prod');
        router.use('/', createSyncFromProdRouter({
            db: localDb,
            admin: localAdmin,
            authMiddleware: localAuthMiddleware,
            guardHandlers: deps.requireAdminHandlers || [localAuthMiddleware].filter(Boolean),
            sendError: localSendError
        }));
        console.warn('[Admin] Prod → Emulator sync routes mounted.');
    }

    router.post('/sync-database', localAuthMiddleware, async (req, res) => {
        const type = String(req.body?.type || '').trim();

        if (isSyncing) {
            return localSendError(res, 429, 'SYNC_IN_PROGRESS', 'A database synchronization is already in progress.');
        }
        if (!['watch', 'notes'].includes(type)) {
            return localSendError(res, 400, 'INVALID_TYPE', 'Sync type must be "watch" or "notes".');
        }
        if (!localDb) {
            return localSendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        isSyncing = true;
        try {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();

            if (type === 'watch') {
                const filePath = path.join(process.cwd(), 'public', 'database', 'watch', 'Videos.xlsx');
                await workbook.xlsx.readFile(filePath);
                const worksheet = workbook.getWorksheet(1);
                const batch = localDb.batch();
                let count = 0;

                worksheet.eachRow((row, rowNumber) => {
                    if (rowNumber === 1) return;
                    const videoId = row.getCell(1).value;
                    const title = row.getCell(2).value;
                    const level = row.getCell(3).value;
                    const url = row.getCell(5).value;

                    if (videoId && url) {
                        const videoRef = db.collection('watchVideos').doc(String(videoId));
                        batch.set(videoRef, {
                            id: String(videoId),
                            title: title || 'Untitled Video',
                            level: level || 'Beginner',
                            url,
                            updatedAt: new Date(),
                            syncedFromExcel: true
                        }, { merge: true });
                        count += 1;
                    }
                });

                await batch.commit();
                return localSendSuccess(res, { count }, `Synced ${count} videos.`);
            }

            const filePath = path.join(process.cwd(), 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = localDb.batch();
            let count = 0;

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const id = row.getCell(1).value;
                const transcript = row.getCell(2).value;
                const videoUrl = row.getCell(3).value;

                if (id) {
                    const entryRef = db.collection('takeNotesEntries').doc(String(id));
                    batch.set(entryRef, {
                        id: String(id),
                        transcript: transcript || '',
                        videoUrl: videoUrl || '',
                        updatedAt: new Date(),
                        syncedFromExcel: true
                    }, { merge: true });
                    count += 1;
                }
            });

            await batch.commit();
            return localSendSuccess(res, { count }, `Synced ${count} notes.`);
        } catch (error) {
            console.error('[Admin-Sync] Full Error:', error);
            return localSendError(res, 500, 'SYNC_ERROR', 'Failed to sync database.', error?.message || error);
        } finally {
            isSyncing = false;
        }
    });

    if (process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES === '1') {
        router.post('/students/:studentId/entrance-tests', localAuthMiddleware, async (req, res) => {
            try {
                const studentId = String(req.params.studentId || '').trim();
                if (!studentId) {
                    return localSendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
                }

                let token = null;
                let testId = null;

                for (let attempt = 0; attempt < 5; attempt += 1) {
                    const nextToken = crypto.randomBytes(32).toString('base64url');
                    const nextTestId = hashTokenToTestId(nextToken);
                    const existing = await localDb.collection('entranceTests').doc(nextTestId).get();
                    if (!existing.exists) {
                        token = nextToken;
                        testId = nextTestId;
                        break;
                    }
                }

                if (!token || !testId) {
                    return localSendError(res, 500, 'TOKEN_ERROR', 'Failed to generate a unique token.');
                }

                const studentRef = localDb.collection('crmStudents').doc(studentId);
                const testRef = localDb.collection('entranceTests').doc(testId);
                await localDb.runTransaction(async (tx) => {
                    const studentSnap = await tx.get(studentRef);
                    if (!studentSnap.exists) {
                        throw new Error('STUDENT_NOT_FOUND');
                    }

                    const leadId = String(studentSnap.data()?.leadId || '').trim();
                    const leadRef = leadId ? db.collection(CRM_LEADS).doc(leadId) : null;
                    const leadSnap = leadRef ? await tx.get(leadRef) : null;
                    const existingTestSnap = await tx.get(testRef);
                    if (existingTestSnap.exists) {
                        throw new Error('TOKEN_ERROR');
                    }

                    const testType = String(req.body?.testType || '').trim() || DEFAULT_TEST_TYPE_LEGACY;

                    tx.set(testRef, {
                        studentId,
                        testType,
                        version: testType === 'segmental_screening_v1' ? 'segmental_screening_v1' : TEST_VERSION,
                        status: 'created',
                        deliveryToken: token,
                        createdAt: localServerTimestamp(),
                        createdBy: req.user.uid,
                        createdByEmail: req.user.email || null,
                        startedAt: null,
                        submittedAt: null
                    });

                    if (leadRef && leadSnap?.exists) {
                        const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_scheduled', {
                            user: req.user,
                            serverTimestamp: localServerTimestamp
                        });
                        if (leadPatch) {
                            tx.set(leadRef, leadPatch, { merge: true });
                        }
                    }
                });

                const links = buildEntranceTestLinks(req, { deliveryToken: token, testId });
                return localSendSuccess(res, {
                    testId,
                    testLink: links.testLink,
                    resultLink: links.resultLink
                }, 'Entrance test link created.');
            } catch (error) {
                if (error?.message === 'STUDENT_NOT_FOUND') {
                    return localSendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
                }
                console.error('[CRM] Create entrance test failed:', error);
                return localSendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
            }
        });

        router.get('/students/:studentId/entrance-tests', localAuthMiddleware, async (req, res) => {
            try {
                const studentId = String(req.params.studentId || '').trim();
                if (!studentId) {
                    return localSendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
                }

                const snaps = await localDb.collection('entranceTests').where('studentId', '==', studentId).get();
                const tests = snaps.docs.map((doc) => {
                    const data = doc.data() || {};
                    const status = data.status || null;
                    const deliveryToken = String(data.deliveryToken || '').trim();
                    return {
                        testId: doc.id,
                        version: data.version || null,
                        status,
                        createdAt: data.createdAt || null,
                        startedAt: data.startedAt || null,
                        submittedAt: data.submittedAt || null,
                        deliveryToken: (status === 'created' || status === 'started') && deliveryToken
                            ? deliveryToken
                            : null
                    };
                });

                tests.sort((a, b) => {
                    const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return bMs - aMs;
                });

                const testsWithLinks = await buildEntranceTestAdminList(req, localDb, tests);

                return localSendSuccess(res, { tests: testsWithLinks });
            } catch (error) {
                console.error('[CRM] List entrance tests failed:', error);
                return localSendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', error?.message || error);
            }
        });

        router.get('/entrance-tests/:testId', localAuthMiddleware, async (req, res) => {
            try {
                const testId = String(req.params.testId || '').trim();
                if (!testId || testId.length < 20) {
                    return localSendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');
                }

                const testSnap = await localDb.collection('entranceTests').doc(testId).get();
                if (!testSnap.exists) {
                    return localSendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
                }

                const test = testSnap.data() || {};
                const studentId = String(test.studentId || '').trim();
                const studentSnap = studentId ? await localDb.collection('crmStudents').doc(studentId).get() : null;
                const student = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

                return localSendSuccess(res, {
                    testId,
                    test,
                    student: student ? { id: studentId, ...student } : null,
                    session: buildPublicSession(testId)
                });
            } catch (error) {
                console.error('[CRM] Get entrance test failed:', error);
                return localSendError(res, 500, 'GET_TEST_ERROR', 'Failed to fetch entrance test details.', error?.message || error);
            }
        });

        router.get('/entrance-tests/:testId/speaking/:questionId/audio-url', localAuthMiddleware, async (req, res) => {
            try {
                const bucket = await localGetStorageBucket();
                if (!bucket) {
                    return localSendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');
                }

                const testId = String(req.params.testId || '').trim();
                const questionId = String(req.params.questionId || '').trim();
                if (!testId || !questionId) {
                    return localSendError(res, 400, 'VALIDATION_ERROR', 'Missing testId or questionId.');
                }

                const testSnap = await localDb.collection('entranceTests').doc(testId).get();
                if (!testSnap.exists) {
                    return localSendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
                }

                const test = testSnap.data() || {};
                const speaking = test.speaking && typeof test.speaking === 'object' ? test.speaking : {};
                const entry = speaking[questionId] || null;
                const storagePath = entry?.audio?.storagePath || null;
                if (!storagePath) {
                    return localSendError(res, 404, 'AUDIO_NOT_FOUND', 'Speaking audio not found for this question.');
                }

                const bucketName = String(entry?.audio?.bucketName || '').trim();
                const targetBucket = bucketName ? localAdmin.storage().bucket(bucketName) : bucket;
                const [url] = await targetBucket.file(storagePath).getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 10 * 60 * 1000
                });
                return localSendSuccess(res, { url });
            } catch (error) {
                console.error('[CRM] Audio URL failed:', error);
                return localSendError(res, 500, 'AUDIO_URL_ERROR', 'Failed to generate audio URL.', error?.message || error);
            }
        });
    }

    const multer = require('multer');
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 }
    });

    let manifestQueue = Promise.resolve();
    // Ensure queue never stays permanently rejected: each write is isolated
    function enqueueManifestWrite(fn) {
        manifestQueue = manifestQueue.catch(() => {}).then(fn);
        return manifestQueue;
    }

    router.post('/dev/save-corpus-sample', localAuthMiddleware, upload.single('audio'), async (req, res) => {
        try {
            if (!process.env.FIRESTORE_EMULATOR_HOST) {
                return localSendError(res, 403, 'FORBIDDEN', 'This dev endpoint is only available in local emulator mode.');
            }

            const metadataStr = req.body.metadata;
            if (!metadataStr) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Missing metadata payload.');
            }

            let metadata;
            try {
                metadata = JSON.parse(metadataStr);
            } catch (e) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON metadata.');
            }

            const {
                sampleId,
                targetWord,
                referenceIpa,
                expectedObservedCount,
                targetSyllableCount,
                category,
                speakerCohort
            } = metadata;

            // Strict metadata validations
            if (!sampleId || typeof sampleId !== 'string' || !/^[a-z0-9-]+$/.test(sampleId)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'sampleId must match ^[a-z0-9-]+$.');
            }

            if (!targetWord || typeof targetWord !== 'string' || targetWord.trim().length === 0) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'targetWord must be a non-empty string.');
            }

            if (!referenceIpa || typeof referenceIpa !== 'string' || referenceIpa.trim().length === 0) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'referenceIpa must be a non-empty string.');
            }

            const expectedObservedCountInt = parseInt(expectedObservedCount, 10);
            if (isNaN(expectedObservedCountInt) || expectedObservedCountInt < 0 || String(expectedObservedCount) !== String(expectedObservedCountInt)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'expectedObservedCount must be a non-negative integer.');
            }

            const targetSyllableCountInt = parseInt(targetSyllableCount, 10);
            if (isNaN(targetSyllableCountInt) || targetSyllableCountInt <= 0 || String(targetSyllableCount) !== String(targetSyllableCountInt)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'targetSyllableCount must be a positive integer.');
            }

            const allowedCategories = ["clean", "omission", "insertion", "accented", "unrateable"];
            if (!allowedCategories.includes(category)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', `category must be one of: ${allowedCategories.join(', ')}`);
            }

            if (!speakerCohort || typeof speakerCohort !== 'string' || !/^[a-z0-9-]+$/.test(speakerCohort)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'speakerCohort must match ^[a-z0-9-]+$.');
            }

            // Audio validation
            if (!req.file || !req.file.buffer) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Missing audio file buffer.');
            }

            if (req.file.buffer.length > 5 * 1024 * 1024) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Audio file size exceeds the maximum allowed limit of 5 MB.');
            }

            const buffer = req.file.buffer;
            if (buffer.length < 44) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV file is too short.');
            }

            if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Invalid file format. Only WAV format is allowed.');
            }

            // Validate fmt chunk fields
            const audioFormat = buffer.readUInt16LE(20);
            if (audioFormat !== 1) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Only PCM WAV format (audioFormat=1) is accepted.');
            }

            const numChannels = buffer.readUInt16LE(22);
            if (numChannels < 1 || numChannels > 2) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV channel count must be 1 (mono) or 2 (stereo).');
            }

            const sampleRate = buffer.readUInt32LE(24);
            if (sampleRate <= 0 || sampleRate > 192000) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV sample rate must be between 1 and 192000 Hz.');
            }

            const bitsPerSample = buffer.readUInt16LE(34);
            if (![8, 16, 24, 32].includes(bitsPerSample)) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV bits per sample must be 8, 16, 24, or 32.');
            }

            // Find 'data' chunk with boundary safety
            let dataOffset = 12;
            let dataSize = -1;
            while (dataOffset + 8 <= buffer.length) {
                const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
                const chunkSize = buffer.readUInt32LE(dataOffset + 4);
                if (chunkSize < 0 || dataOffset + 8 + chunkSize > buffer.length) {
                    return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV file has malformed chunk boundaries.');
                }
                if (chunkId === 'data') {
                    dataSize = chunkSize;
                    break;
                }
                dataOffset += 8 + chunkSize;
                // Ensure word-aligned chunks (WAV spec)
                if (dataOffset % 2 !== 0) dataOffset += 1;
            }
            if (dataSize < 0) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV file is missing the data chunk.');
            }

            const bytesPerSample = (bitsPerSample / 8) * numChannels;
            if (dataSize % bytesPerSample !== 0) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV data chunk size is not aligned to the sample frame size.');
            }
            const numSamples = dataSize / bytesPerSample;
            const duration = numSamples / sampleRate;

            if (!isFinite(duration) || duration <= 0) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'WAV file has zero or invalid duration.');
            }

            if (duration > 15) {
                return localSendError(res, 400, 'VALIDATION_ERROR', `Audio duration (${duration.toFixed(2)}s) exceeds the maximum allowed limit of 15 seconds.`);
            }

            const fs = require('fs').promises;
            const corpusDir = path.join(process.cwd(), 'test-results', 'pronunciation-segmentation-corpus');

            // Ensure corpus directory exists
            await fs.mkdir(corpusDir, { recursive: true });

            // Constrain filename to sanitize path traversal
            const safeFilename = path.basename(`${sampleId}.wav`);
            if (safeFilename !== `${sampleId}.wav`) {
                return localSendError(res, 400, 'VALIDATION_ERROR', 'Invalid sample ID filename.');
            }
            const wavPath = path.join(corpusDir, safeFilename);
            await fs.writeFile(wavPath, req.file.buffer);

            // Calculate SHA-256 hash
            const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

            // Atomic manifest update using the promise queue
            const manifestPath = path.join(process.cwd(), 'tests', 'fixtures', 'pronunciation-segmentation', 'manifest.json');
            let manifestCount = 0;

            await new Promise((resolveUpdate, rejectUpdate) => {
                enqueueManifestWrite(async () => {
                    try {
                        let manifest = { version: "1.0.0", createdAt: new Date().toISOString(), entries: [] };
                        try {
                            const manifestContent = await fs.readFile(manifestPath, 'utf8');
                            manifest = JSON.parse(manifestContent);
                        } catch (err) {
                            await fs.mkdir(path.dirname(manifestPath), { recursive: true });
                        }

                        if (!Array.isArray(manifest.entries)) {
                            manifest.entries = [];
                        }

                        const newEntry = {
                            sampleId,
                            targetWord,
                            referenceIpa,
                            expectedObservedCount: expectedObservedCountInt,
                            targetSyllableCount: targetSyllableCountInt,
                            category,
                            speakerCohort,
                            sourceHash: sha256,
                            labelProvenance: "manual",
                            verifiedSpans: null
                        };

                        const existingIdx = manifest.entries.findIndex(entry => entry.sampleId === sampleId);
                        if (existingIdx !== -1) {
                            manifest.entries[existingIdx] = newEntry;
                        } else {
                            manifest.entries.push(newEntry);
                        }

                        // Atomic write: write to temp file then rename
                        const tempPath = `${manifestPath}.tmp`;
                        await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
                        await fs.rename(tempPath, manifestPath);

                        manifestCount = manifest.entries.length;
                        resolveUpdate();
                    } catch (err) {
                        rejectUpdate(err);
                    }
                });
            });

            return localSendSuccess(res, {
                sampleId,
                hash: sha256,
                manifestCount
            }, 'Corpus sample saved and manifest updated successfully.');

        } catch (error) {
            console.error('[DevCorpus] Failed to save sample:', error);
            return localSendError(res, 500, 'SAVE_ERROR', 'Failed to save corpus sample.', error?.message || error);
        }
    });
}

const localAdminRouter = createCrmRouter({
    db,
    admin,
    getStorageBucket,
    authMiddleware,
    resolveAdminStatus: async ({ req }) => ({
        // authMiddleware already enforces ADMIN_EMAIL whitelist for this server stack
        isAdmin: true,
        uid: req?.user?.uid || null,
        email: req?.user?.email || null,
        bootstrapped: false
    }),
    sendSuccess,
    sendError,
    serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    identity: {
        generateClassCode,
        lookupUserByEmail,
        forceLinkProfile
    },
    registerExtraRoutes: registerLocalOnlyRoutes
});

module.exports = localAdminRouter;
module.exports.createLocalAdminRouter = createCrmRouter;
module.exports.registerLocalOnlyRoutes = registerLocalOnlyRoutes;
