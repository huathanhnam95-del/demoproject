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

function getBaseUrl(req) {
    const fromEnv = String(process.env.PUBLIC_BASE_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
}

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
    let isSyncing = false;

    router.post('/sync-database', authMiddleware, async (req, res) => {
        const type = String(req.body?.type || '').trim();

        if (isSyncing) {
            return sendError(res, 429, 'SYNC_IN_PROGRESS', 'A database synchronization is already in progress.');
        }
        if (!['watch', 'notes'].includes(type)) {
            return sendError(res, 400, 'INVALID_TYPE', 'Sync type must be "watch" or "notes".');
        }
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        isSyncing = true;
        try {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();

            if (type === 'watch') {
                const filePath = path.join(process.cwd(), 'public', 'database', 'watch', 'Videos.xlsx');
                await workbook.xlsx.readFile(filePath);
                const worksheet = workbook.getWorksheet(1);
                const batch = db.batch();
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
                return sendSuccess(res, { count }, `Synced ${count} videos.`);
            }

            const filePath = path.join(process.cwd(), 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = db.batch();
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
            return sendSuccess(res, { count }, `Synced ${count} notes.`);
        } catch (error) {
            console.error('[Admin-Sync] Full Error:', error);
            return sendError(res, 500, 'SYNC_ERROR', 'Failed to sync database.', error?.message || error);
        } finally {
            isSyncing = false;
        }
    });

        router.post('/students/:studentId/entrance-tests', authMiddleware, async (req, res) => {
            try {
                const studentId = String(req.params.studentId || '').trim();
                if (!studentId) {
                    return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
                }

                let token = null;
                let testId = null;

                for (let attempt = 0; attempt < 5; attempt += 1) {
                    const nextToken = crypto.randomBytes(32).toString('base64url');
                const nextTestId = hashTokenToTestId(nextToken);
                const existing = await db.collection('entranceTests').doc(nextTestId).get();
                if (!existing.exists) {
                    token = nextToken;
                    testId = nextTestId;
                    break;
                }
            }

                if (!token || !testId) {
                    return sendError(res, 500, 'TOKEN_ERROR', 'Failed to generate a unique token.');
                }

                const studentRef = db.collection('crmStudents').doc(studentId);
                const testRef = db.collection('entranceTests').doc(testId);
                await db.runTransaction(async (tx) => {
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

                    tx.set(testRef, {
                        studentId,
                        version: TEST_VERSION,
                        status: 'created',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        createdBy: req.user.uid,
                        createdByEmail: req.user.email || null,
                        startedAt: null,
                        submittedAt: null
                    });

                    if (leadRef && leadSnap?.exists) {
                        const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_scheduled', {
                            user: req.user,
                            serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
                        });
                        if (leadPatch) {
                            tx.set(leadRef, leadPatch, { merge: true });
                        }
                    }
                });

                const baseUrl = getBaseUrl(req);
                return sendSuccess(res, {
                    testId,
                    testLink: `${baseUrl}/entrance-test.html?token=${encodeURIComponent(token)}`,
                    resultLink: `${baseUrl}/crm-entrance-test-result.html?testId=${encodeURIComponent(testId)}`
                }, 'Entrance test link created.');
            } catch (error) {
                if (error?.message === 'STUDENT_NOT_FOUND') {
                    return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
                }
                console.error('[CRM] Create entrance test failed:', error);
                return sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
            }
        });

    router.get('/students/:studentId/entrance-tests', authMiddleware, async (req, res) => {
        try {
            const studentId = String(req.params.studentId || '').trim();
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }

            const snaps = await db.collection('entranceTests').where('studentId', '==', studentId).get();
            const tests = snaps.docs.map((doc) => {
                const data = doc.data() || {};
                return {
                    testId: doc.id,
                    version: data.version || null,
                    status: data.status || null,
                    createdAt: data.createdAt || null,
                    startedAt: data.startedAt || null,
                    submittedAt: data.submittedAt || null
                };
            });

            tests.sort((a, b) => {
                const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                return bMs - aMs;
            });

            const baseUrl = getBaseUrl(req);
            const testsWithLinks = tests.map((test) => ({
                ...test,
                resultLink: `${baseUrl}/crm-entrance-test-result.html?testId=${encodeURIComponent(test.testId)}`
            }));

            return sendSuccess(res, { tests: testsWithLinks });
        } catch (error) {
            console.error('[CRM] List entrance tests failed:', error);
            return sendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', error?.message || error);
        }
    });

    router.get('/entrance-tests/:testId', authMiddleware, async (req, res) => {
        try {
            const testId = String(req.params.testId || '').trim();
            if (!testId || testId.length < 20) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');
            }

            const testSnap = await db.collection('entranceTests').doc(testId).get();
            if (!testSnap.exists) {
                return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
            }

            const test = testSnap.data() || {};
            const studentId = String(test.studentId || '').trim();
            const studentSnap = studentId ? await db.collection('crmStudents').doc(studentId).get() : null;
            const student = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

            return sendSuccess(res, {
                testId,
                test,
                student: student ? { id: studentId, ...student } : null,
                session: buildPublicSession(testId)
            });
        } catch (error) {
            console.error('[CRM] Get entrance test failed:', error);
            return sendError(res, 500, 'GET_TEST_ERROR', 'Failed to fetch entrance test details.', error?.message || error);
        }
    });

    router.get('/entrance-tests/:testId/speaking/:questionId/audio-url', authMiddleware, async (req, res) => {
        try {
            const bucket = await getStorageBucket();
            if (!bucket) {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');
            }

            const testId = String(req.params.testId || '').trim();
            const questionId = String(req.params.questionId || '').trim();
            if (!testId || !questionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing testId or questionId.');
            }

            const testSnap = await db.collection('entranceTests').doc(testId).get();
            if (!testSnap.exists) {
                return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
            }

            const test = testSnap.data() || {};
            const speaking = test.speaking && typeof test.speaking === 'object' ? test.speaking : {};
            const entry = speaking[questionId] || null;
            const storagePath = entry?.audio?.storagePath || null;
            if (!storagePath) {
                return sendError(res, 404, 'AUDIO_NOT_FOUND', 'Speaking audio not found for this question.');
            }

            const bucketName = String(entry?.audio?.bucketName || '').trim();
            const targetBucket = bucketName ? admin.storage().bucket(bucketName) : bucket;
            const [url] = await targetBucket.file(storagePath).getSignedUrl({
                action: 'read',
                expires: Date.now() + 10 * 60 * 1000
            });

            return sendSuccess(res, { url });
        } catch (error) {
            console.error('[CRM] Audio URL failed:', error);
            return sendError(res, 500, 'AUDIO_URL_ERROR', 'Failed to generate audio URL.', error?.message || error);
        }
    });
}

module.exports = createCrmRouter({
    db,
    admin,
    authMiddleware,
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
