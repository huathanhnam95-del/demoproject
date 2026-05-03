const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const { ENTRANCE_TESTS, CRM_LEADS, CRM_STUDENTS } = require('../../crm/collections');
const { ensureCrmIdOnDoc } = require('../../crm/business-id-service');
const { buildLeadStageSyncPatch, mapLeadRecord } = require('../../crm/lead-service');
const { mapStudentRecord } = require('../../crm/student-service');
const { buildEntranceTestLinks } = require('../../crm/public-origin');
const { buildEntranceTestAdminList } = require('../../crm/entrance-test-link-recovery');
const { getStorage } = require('firebase-admin/storage');
const {
    TEST_36PLUS,
    TEST_VERSION,
    hashTokenToTestId,
    extensionFromContentType,
    normalizeAsrContentType,
    computeWordAccuracyPercent,
    buildPublicSession,
    scoreSubmission
} = require('../../entrance-test/test36plus');

const VALID_TEST_TYPES = new Set([
    'entrance_test_36plus_v1',
    'segmental_screening_v1'
]);
const DEFAULT_TEST_TYPE = 'entrance_test_36plus_v1';
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
const ASR_MODEL = process.env.ENTRANCE_TEST_ASR_MODEL || 'openai/whisper-large-v3';

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function getSpeakingQuestionExpectedText(questionId) {
    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const q = speaking?.questions?.find((x) => x.id === questionId) || null;
    const expected = q?.expectedText ? String(q.expectedText) : '';
    return expected.trim() || null;
}

function resolveStorageBucket(preferredBucketName) {
    try {
        const bucketName = cleanOptionalString(preferredBucketName)
            || cleanOptionalString(process.env.CLIENT_FIREBASE_STORAGE_BUCKET);
        if (!bucketName) return null;
        return getStorage().bucket(bucketName);
    } catch (error) {
        console.warn('[CRM EntranceTests] Storage init failed:', error?.message || error);
        return null;
    }
}

async function transcribeAudio(buffer, contentType) {
    if (!HF_TOKEN) {
        throw new Error('HUGGINGFACE_API_KEY is not configured on the server.');
    }
    const asrContentType = normalizeAsrContentType(contentType) || 'application/octet-stream';
    const url = `https://router.huggingface.co/hf-inference/models/${ASR_MODEL}`;
    const res = await axios({
        method: 'POST',
        url,
        headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            Accept: 'application/json',
            'Content-Type': asrContentType,
            'User-Agent': 'Mozilla/5.0'
        },
        httpsAgent: new https.Agent({ family: 4 }),
        data: buffer,
        timeout: 120000,
        validateStatus: () => true
    });

    if (res.status !== 200 || !res.data || typeof res.data.text !== 'string') {
        const errMsg = res.data?.error || `ASR failed with status ${res.status}`;
        throw new Error(String(errMsg));
    }

    return res.data.text;
}

async function generateUniqueTestIdentity(db) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const token = crypto.randomBytes(32).toString('base64url');
        const testId = hashTokenToTestId(token);
        const snap = await db.collection(ENTRANCE_TESTS).doc(testId).get();
        if (!snap.exists) {
            return { token, testId };
        }
    }
    throw new Error('Failed to generate a unique token.');
}

async function loadTestContext(db, testId) {
    const testSnap = await db.collection(ENTRANCE_TESTS).doc(testId).get();
    if (!testSnap.exists) return null;
    const test = testSnap.data() || {};

    const leadId = cleanOptionalString(test.leadId);
    const studentId = cleanOptionalString(test.studentId);

    const [leadSnap, studentSnap] = await Promise.all([
        leadId ? db.collection(CRM_LEADS).doc(leadId).get() : Promise.resolve(null),
        studentId ? db.collection(CRM_STUDENTS).doc(studentId).get() : Promise.resolve(null)
    ]);

    const lead = leadSnap && leadSnap.exists ? { id: leadId, ...mapLeadRecord(leadSnap, leadId) } : null;
    const student = studentSnap && studentSnap.exists ? { id: studentId, ...mapStudentRecord(studentSnap, studentId) } : null;

    return {
        testId,
        test,
        lead,
        student
    };
}

function getTestListRow(doc) {
    const data = doc.data() || {};
    const status = cleanOptionalString(data.status) || 'created';
    const deliveryToken = cleanOptionalString(data.deliveryToken);
    return {
        testId: doc.id,
        leadId: cleanOptionalString(data.leadId),
        studentId: cleanOptionalString(data.studentId),
        crmId: cleanOptionalString(data.crmId),
        version: data.version || null,
        status,
        createdAt: data.createdAt || null,
        startedAt: data.startedAt || null,
        submittedAt: data.submittedAt || null,
        deliveryToken: (status === 'created' || status === 'started') && deliveryToken ? deliveryToken : null
    };
}

async function listTestsByField(db, field, value) {
    const snap = await db.collection(ENTRANCE_TESTS).where(field, '==', value).get();
    return snap.docs.map((doc) => getTestListRow(doc)).sort((left, right) => {
        const leftTs = left.createdAt?.toMillis ? left.createdAt.toMillis() : 0;
        const rightTs = right.createdAt?.toMillis ? right.createdAt.toMillis() : 0;
        return rightTs - leftTs;
    });
}

module.exports = function registerEntranceTestRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.post('/leads/:leadId/entrance-tests', ...requireAdminHandlers, async (req, res) => {
        try {
            const leadId = cleanOptionalString(req.params.leadId);
            if (!leadId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing leadId.');
            }

            const leadRef = db.collection(CRM_LEADS).doc(leadId);
            const leadSnap = await leadRef.get();
            if (!leadSnap.exists) {
                return sendError(res, 404, 'LEAD_NOT_FOUND', 'Lead not found.');
            }

            const leadEnsure = await ensureCrmIdOnDoc(db, leadRef, leadSnap.data() || {}, {
                user: req.user,
                serverTimestamp
            });
            const lead = { ...(leadSnap.data() || {}), crmId: leadEnsure.crmId };
            const testType = cleanOptionalString(req.body?.testType) || DEFAULT_TEST_TYPE;
            if (!VALID_TEST_TYPES.has(testType)) {
                return sendError(res, 400, 'INVALID_TEST_TYPE', `Invalid test type: ${testType}`);
            }

            const { token, testId } = await generateUniqueTestIdentity(db);
            const testRef = db.collection(ENTRANCE_TESTS).doc(testId);

            await db.runTransaction(async (tx) => {
                const existingTestSnap = await tx.get(testRef);
                if (existingTestSnap.exists) {
                    throw new Error('TOKEN_ERROR');
                }

                tx.set(testRef, {
                    leadId,
                    studentId: cleanOptionalString(lead.studentId),
                    crmId: cleanOptionalString(lead.crmId),
                    testType,
                    version: testType === 'segmental_screening_v1' ? 'segmental_screening_v1' : TEST_VERSION,
                    status: 'created',
                    deliveryToken: token,
                    createdAt: serverTimestamp(),
                    createdBy: req.user.uid,
                    createdByEmail: req.user.email || null,
                    startedAt: null,
                    submittedAt: null
                });

                const leadPatch = buildLeadStageSyncPatch(lead, 'test_scheduled', {
                    user: req.user,
                    serverTimestamp
                });
                if (leadPatch) {
                    tx.set(leadRef, leadPatch, { merge: true });
                }
            });

            await writeAuditLog?.({
                action: 'entrance_test.create',
                entityType: 'entrance_test',
                entityId: testId,
                metadata: { leadId }
            }, { user: req.user });

            const links = buildEntranceTestLinks(req, { deliveryToken: token, testId });
            return sendSuccess(res, {
                testId,
                testLink: links.testLink,
                resultLink: links.resultLink
            }, 'Entrance test link created.');
        } catch (error) {
            return sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
        }
    });

    router.post('/students/:studentId/entrance-tests', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = cleanOptionalString(req.params.studentId);
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }

            const studentRef = db.collection(CRM_STUDENTS).doc(studentId);
            const studentSnap = await studentRef.get();
            if (!studentSnap.exists) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }

            const studentEnsure = await ensureCrmIdOnDoc(db, studentRef, studentSnap.data() || {}, {
                user: req.user,
                serverTimestamp
            });
            const student = { ...(studentSnap.data() || {}), crmId: studentEnsure.crmId };
            const leadId = cleanOptionalString(student.leadId);
            const leadRef = leadId ? db.collection(CRM_LEADS).doc(leadId) : null;
            const leadSnap = leadRef ? await leadRef.get() : null;
            const lead = leadSnap && leadSnap.exists ? { ...(leadSnap.data() || {}), crmId: cleanOptionalString(leadSnap.data()?.crmId) || null } : null;
            if (leadRef && leadSnap?.exists && !cleanOptionalString(lead?.crmId)) {
                const leadEnsure = await ensureCrmIdOnDoc(db, leadRef, leadSnap.data() || {}, {
                    user: req.user,
                    serverTimestamp
                });
                lead.crmId = leadEnsure.crmId;
            }

            const testType = cleanOptionalString(req.body?.testType) || DEFAULT_TEST_TYPE;
            if (!VALID_TEST_TYPES.has(testType)) {
                return sendError(res, 400, 'INVALID_TEST_TYPE', `Invalid test type: ${testType}`);
            }

            const { token, testId } = await generateUniqueTestIdentity(db);
            const testRef = db.collection(ENTRANCE_TESTS).doc(testId);

            await db.runTransaction(async (tx) => {
                const existingTestSnap = await tx.get(testRef);
                if (existingTestSnap.exists) {
                    throw new Error('TOKEN_ERROR');
                }

                tx.set(testRef, {
                    leadId,
                    studentId,
                    crmId: cleanOptionalString(student.crmId || lead?.crmId),
                    testType,
                    version: testType === 'segmental_screening_v1' ? 'segmental_screening_v1' : TEST_VERSION,
                    status: 'created',
                    deliveryToken: token,
                    createdAt: serverTimestamp(),
                    createdBy: req.user.uid,
                    createdByEmail: req.user.email || null,
                    startedAt: null,
                    submittedAt: null
                });

                if (leadRef && lead) {
                    const leadPatch = buildLeadStageSyncPatch(lead, 'test_scheduled', {
                        user: req.user,
                        serverTimestamp
                    });
                    if (leadPatch) {
                        tx.set(leadRef, leadPatch, { merge: true });
                    }
                }
            });

            await writeAuditLog?.({
                action: 'entrance_test.create',
                entityType: 'entrance_test',
                entityId: testId,
                metadata: { studentId, leadId: leadId || null }
            }, { user: req.user });

            const links = buildEntranceTestLinks(req, { deliveryToken: token, testId });
            return sendSuccess(res, {
                testId,
                testLink: links.testLink,
                resultLink: links.resultLink
            }, 'Entrance test link created.');
        } catch (error) {
            if ((error?.message || '').includes('STUDENT_NOT_FOUND')) {
                return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
            }
            return sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
        }
    });

    router.get('/leads/:leadId/entrance-tests', ...requireAdminHandlers, async (req, res) => {
        try {
            const leadId = cleanOptionalString(req.params.leadId);
            if (!leadId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing leadId.');
            }

            const tests = await listTestsByField(db, 'leadId', leadId);
            const testsWithLinks = await buildEntranceTestAdminList(req, db, tests);
            return sendSuccess(res, { tests: testsWithLinks });
        } catch (error) {
            return sendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', error?.message || error);
        }
    });

    router.get('/students/:studentId/entrance-tests', ...requireAdminHandlers, async (req, res) => {
        try {
            const studentId = cleanOptionalString(req.params.studentId);
            if (!studentId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
            }

            const tests = await listTestsByField(db, 'studentId', studentId);
            const testsWithLinks = await buildEntranceTestAdminList(req, db, tests);
            return sendSuccess(res, { tests: testsWithLinks });
        } catch (error) {
            return sendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', error?.message || error);
        }
    });

    router.get('/entrance-tests/:testId', ...requireAdminHandlers, async (req, res) => {
        try {
            const testId = cleanOptionalString(req.params.testId);
            if (!testId || testId.length < 20) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');
            }

            const context = await loadTestContext(db, testId);
            if (!context) {
                return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
            }

            let scoring = context.test?.scoring || null;
            const responses = context.test?.responses || null;
            const testType = cleanOptionalString(context.test?.testType) || DEFAULT_TEST_TYPE;
            if (responses && testType !== 'segmental_screening_v1') {
                try {
                    scoring = scoreSubmission(responses);
                } catch (error) {
                    // Fall back to persisted scoring if recompute fails for any reason.
                    scoring = context.test?.scoring || null;
                }
            }

            return sendSuccess(res, {
                testId,
                test: {
                    ...(context.test || {}),
                    scoring
                },
                lead: context.lead,
                student: context.student,
                session: buildPublicSession(testId)
            });
        } catch (error) {
            return sendError(res, 500, 'GET_TEST_ERROR', 'Failed to fetch entrance test details.', error?.message || error);
        }
    });

    router.get('/entrance-tests/:testId/speaking/:questionId/audio-url', ...requireAdminHandlers, async (req, res) => {
        try {
            const bucket = resolveStorageBucket();
            if (!bucket) {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');
            }

            const testId = cleanOptionalString(req.params.testId);
            const questionId = cleanOptionalString(req.params.questionId);
            if (!testId || !questionId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing testId or questionId.');
            }

            const testSnap = await db.collection(ENTRANCE_TESTS).doc(testId).get();
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

            const bucketName = cleanOptionalString(entry?.audio?.bucketName);
            const targetBucket = resolveStorageBucket(bucketName) || bucket;
            const [url] = await targetBucket.file(storagePath).getSignedUrl({
                action: 'read',
                expires: Date.now() + 10 * 60 * 1000
            });

            return sendSuccess(res, { url });
        } catch (error) {
            return sendError(res, 500, 'AUDIO_URL_ERROR', 'Failed to generate audio URL.', error?.message || error);
        }
    });

    router.post('/entrance-tests/:testId/speaking/retry-asr', ...requireAdminHandlers, async (req, res) => {
        try {
            const bucket = resolveStorageBucket();
            if (!bucket) {
                return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');
            }

            const testId = cleanOptionalString(req.params.testId);
            if (!testId || testId.length < 20) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');
            }

            const testRef = db.collection(ENTRANCE_TESTS).doc(testId);
            const testSnap = await testRef.get();
            if (!testSnap.exists) {
                return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
            }

            const test = testSnap.data() || {};
            const speaking = test.speaking && typeof test.speaking === 'object' ? test.speaking : {};
            const questionIds = Object.keys(speaking);
            if (questionIds.length === 0) {
                return sendSuccess(res, { testId, retried: [] }, 'No speaking answers to retry.');
            }

            const retried = [];
            for (const questionId of questionIds) {
                const entry = speaking[questionId] || null;
                const storagePath = entry?.audio?.storagePath || null;
                if (!storagePath) continue;

                const bucketName = cleanOptionalString(entry?.audio?.bucketName);
                const targetBucket = resolveStorageBucket(bucketName) || bucket;
                const contentType = cleanOptionalString(entry?.audio?.contentType) || 'application/octet-stream';
                const expectedText = getSpeakingQuestionExpectedText(questionId);

                let transcript = null;
                let accuracy = null;
                let asrError = null;

                try {
                    const [audioBuffer] = await targetBucket.file(storagePath).download();
                    transcript = await transcribeAudio(audioBuffer, contentType);
                    if (expectedText) {
                        accuracy = computeWordAccuracyPercent(expectedText, transcript);
                    }
                } catch (error) {
                    asrError = error?.message || String(error);
                }

                await testRef.update({
                    [`speaking.${questionId}.transcript`]: transcript,
                    [`speaking.${questionId}.accuracyPercent`]: accuracy?.percent ?? null,
                    [`speaking.${questionId}.expectedCount`]: accuracy?.expectedCount ?? null,
                    [`speaking.${questionId}.transcriptCount`]: accuracy?.transcriptCount ?? null,
                    [`speaking.${questionId}.distance`]: accuracy?.distance ?? null,
                    [`speaking.${questionId}.asrError`]: asrError,
                    [`speaking.${questionId}.asrRetriedAt`]: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                retried.push({
                    questionId,
                    ok: !!transcript && !asrError,
                    accuracyPercent: accuracy?.percent ?? null,
                    asrError: asrError || null
                });
            }

            return sendSuccess(res, { testId, retried }, 'Speaking ASR retried.');
        } catch (error) {
            return sendError(res, 500, 'RETRY_ASR_ERROR', 'Failed to retry speaking ASR.', error?.message || error);
        }
    });
};
