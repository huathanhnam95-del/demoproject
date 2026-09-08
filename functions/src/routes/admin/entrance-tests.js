const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const { ENTRANCE_TESTS, CRM_LEADS, CRM_STUDENTS, CRM_COUNTERS } = require('../../crm/collections');
const { formatCrmId } = require('../../crm/business-id-service');
const { auditSaved } = require('../../crm/workflow-write-service');
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
const { transcribeAudio, alignAudioWithAzure } = require('../../entrance-test/asr-service');

const VALID_TEST_TYPES = new Set([
    'entrance_test_36plus_v1',
    'segmental_screening_v1'
]);
const DEFAULT_TEST_TYPE = 'entrance_test_36plus_v1';

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function getSpeakingQuestionExpectedText(questionId, entry = null) {
    const fromEntry = cleanOptionalString(entry?.expectedText);
    if (fromEntry) return fromEntry;

    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const cleanId = String(questionId || '').trim();
    const promptNum = cleanId.replace(/^speaking_q?|^q/, '');
    const q = speaking?.questions?.find((x) => (
        x.id === cleanId
        || x.id === `speaking_${cleanId}`
        || (promptNum && String(x.promptNumber) === promptNum)
    )) || null;
    const expected = q?.expectedText ? String(q.expectedText) : '';
    return cleanOptionalString(expected);
}

function resolveStorageBucket(preferredBucketName) {
    try {
        const bucketName = cleanOptionalString(preferredBucketName)
            || cleanOptionalString(process.env.CLIENT_FIREBASE_STORAGE_BUCKET);
        const storage = getStorage();
        return bucketName ? storage.bucket(bucketName) : storage.bucket();
    } catch (error) {
        console.warn('[CRM EntranceTests] Storage init failed:', error?.message || error);
        return null;
    }
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
        deliveryToken: deliveryToken || null
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

    async function createEntranceTest(req, res, targetKind) {
        try {
            const isLead = targetKind === 'lead';
            const targetId = cleanOptionalString(isLead ? req.params.leadId : req.params.studentId);
            if (!targetId) return sendError(res, 400, 'VALIDATION_ERROR', `Missing ${targetKind}Id.`);
            const testType = cleanOptionalString(req.body?.testType) || DEFAULT_TEST_TYPE;
            if (!VALID_TEST_TYPES.has(testType)) return sendError(res, 400, 'INVALID_TEST_TYPE', `Invalid test type: ${testType}`);
            const { token, testId } = await generateUniqueTestIdentity(db);
            const testRef = db.collection(ENTRANCE_TESTS).doc(testId);
            const targetRef = db.collection(isLead ? CRM_LEADS : CRM_STUDENTS).doc(targetId);
            const metadata = await db.runTransaction(async (tx) => {
                const targetSnap = await tx.get(targetRef);
                if (!targetSnap.exists) throw Object.assign(new Error(`${isLead ? 'Lead' : 'Student profile'} not found.`), { status: 404, code: isLead ? 'LEAD_NOT_FOUND' : 'STUDENT_NOT_FOUND' });
                const target = targetSnap.data() || {};
                const leadId = isLead ? targetId : cleanOptionalString(target.leadId);
                const leadRef = isLead ? targetRef : (leadId ? db.collection(CRM_LEADS).doc(leadId) : null);
                const leadSnap = isLead ? targetSnap : (leadRef ? await tx.get(leadRef) : null);
                const lead = leadSnap?.exists ? leadSnap.data() : null;
                const studentId = isLead ? cleanOptionalString(target.studentId) : targetId;
                const existingTest = await tx.get(testRef);
                if (existingTest.exists) throw new Error('TOKEN_ERROR');
                let crmId = cleanOptionalString(target.crmId) || cleanOptionalString(lead?.crmId);
                let counterRef;
                let nextIndex;
                if (!crmId) {
                    counterRef = db.collection(CRM_COUNTERS).doc('crmId');
                    const counter = await tx.get(counterRef);
                    const value = Number(counter.data()?.nextIndex);
                    nextIndex = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
                    crmId = formatCrmId(nextIndex);
                }
                if (counterRef) tx.set(counterRef, { nextIndex: nextIndex + 1, lastAllocatedCrmId: crmId, updatedAt: serverTimestamp() }, { merge: true });
                if (!cleanOptionalString(target.crmId)) tx.set(targetRef, { crmId, updatedAt: serverTimestamp(), updatedBy: req.user.uid }, { merge: true });
                if (leadRef && lead) {
                    const patch = buildLeadStageSyncPatch(lead, 'test_scheduled', { user: req.user, serverTimestamp }) || {};
                    if (!cleanOptionalString(lead.crmId)) patch.crmId = crmId;
                    if (Object.keys(patch).length) tx.set(leadRef, patch, { merge: true });
                }
                tx.set(testRef, {
                    leadId, studentId, crmId, testType,
                    version: testType === 'segmental_screening_v1' ? 'segmental_screening_v1' : TEST_VERSION,
                    status: 'created', deliveryToken: token, createdAt: serverTimestamp(),
                    createdBy: req.user.uid, createdByEmail: req.user.email || null,
                    startedAt: null, submittedAt: null
                });
                return { leadId, studentId };
            });
            const warnings = await auditSaved(writeAuditLog, { action: 'entrance_test.create', entityType: 'entrance_test', entityId: testId, metadata }, { user: req.user });
            const links = buildEntranceTestLinks(req, { deliveryToken: token, testId });
            return sendSuccess(res, { testId, testLink: links.testLink, resultLink: links.resultLink, ...(warnings.length ? { warnings } : {}) }, 'Entrance test link created.');
        } catch (error) {
            if (error.status) return sendError(res, error.status, error.code, error.message);
            return sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
        }
    }

    router.post('/leads/:leadId/entrance-tests', ...requireAdminHandlers, (req, res) => createEntranceTest(req, res, 'lead'));
    router.post('/students/:studentId/entrance-tests', ...requireAdminHandlers, (req, res) => createEntranceTest(req, res, 'student'));

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
                let words = null;
                let accuracy = null;
                let asrError = null;
                let accuracyScore = null;
                let effectiveAccuracy = null;

                try {
                    const [audioBuffer] = await targetBucket.file(storagePath).download();
                    const asrRes = await transcribeAudio(audioBuffer, contentType, { expectedText });
                    transcript = typeof asrRes === 'object' && asrRes ? (asrRes.text || String(asrRes)) : String(asrRes || '');
                    words = Array.isArray(asrRes?.words) ? asrRes.words : null;
                    if (expectedText) {
                        accuracy = computeWordAccuracyPercent(expectedText, transcript);
                    }

                    if (Number.isFinite(Number(asrRes?.accuracyScore))) {
                        accuracyScore = Number(asrRes.accuracyScore);
                    } else if (Number.isFinite(Number(words?.accuracyScore))) {
                        accuracyScore = Number(words.accuracyScore);
                    } else if (Array.isArray(words) && words.length > 0) {
                        const validScores = words
                            .map((w) => (typeof w === 'object' && w != null && Number.isFinite(Number(w.accuracyScore))) ? Number(w.accuracyScore) : null)
                            .filter((n) => n !== null);
                        if (validScores.length > 0) {
                            accuracyScore = Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10;
                        }
                    }
                    effectiveAccuracy = accuracyScore != null ? accuracyScore : (accuracy?.percent ?? null);
                } catch (error) {
                    asrError = error?.message || String(error);
                }

                await testRef.update({
                    [`speaking.${questionId}.transcript`]: transcript,
                    [`speaking.${questionId}.words`]: words || null,
                    [`speaking.${questionId}.accuracyPercent`]: effectiveAccuracy,
                    [`speaking.${questionId}.accuracyScore`]: accuracyScore,
                    [`speaking.${questionId}.wordMatchAccuracy`]: accuracy?.percent ?? null,
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
                    accuracyPercent: effectiveAccuracy,
                    accuracyScore: accuracyScore,
                    asrError: asrError || null
                });
            }

            return sendSuccess(res, { testId, retried }, 'Speaking ASR retried.');
        } catch (error) {
            return sendError(res, 500, 'RETRY_ASR_ERROR', 'Failed to retry speaking ASR.', error?.message || error);
        }
    });

    router.post('/:testId/speaking/align-words', async (req, res) => {
        try {
            const testId = cleanOptionalString(req.params?.testId);
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
                return sendSuccess(res, { testId, aligned: [] }, 'No speaking answers to align.');
            }

            const aligned = [];
            const updates = {};

            for (const questionId of questionIds) {
                const entry = speaking[questionId] || null;
                const storagePath = entry?.audio?.storagePath || null;
                const transcript = String(entry?.transcript || '').trim();
                const expectedText = getSpeakingQuestionExpectedText(questionId, entry);
                const alignTarget = expectedText || transcript;
                if (!storagePath || !alignTarget) continue;

                const bucketName = cleanOptionalString(entry?.audio?.bucketName);
                const targetBucket = resolveStorageBucket(bucketName) || bucket;
                const contentType = cleanOptionalString(entry?.audio?.contentType) || 'application/octet-stream';

                try {
                    const [audioBuffer] = await targetBucket.file(storagePath).download();
                    const words = await alignAudioWithAzure(audioBuffer, alignTarget, contentType);
                    if (Array.isArray(words) && words.length > 0) {
                        let accuracyScore = null;
                        if (Number.isFinite(Number(words.accuracyScore))) {
                            accuracyScore = Number(words.accuracyScore);
                        } else {
                            const validScores = words
                                .map((w) => (typeof w === 'object' && w != null && Number.isFinite(Number(w.accuracyScore))) ? Number(w.accuracyScore) : null)
                                .filter((n) => n !== null);
                            if (validScores.length > 0) {
                                accuracyScore = Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10;
                            }
                        }

                        updates[`speaking.${questionId}.words`] = words;
                        updates[`speaking.${questionId}.wordsAlignedAt`] = serverTimestamp();
                        if (accuracyScore != null) {
                            updates[`speaking.${questionId}.accuracyPercent`] = accuracyScore;
                            updates[`speaking.${questionId}.accuracyScore`] = accuracyScore;
                        }
                        aligned.push({ questionId, wordCount: words.length, accuracyPercent: accuracyScore, ok: true });
                    } else {
                        aligned.push({ questionId, wordCount: 0, ok: false, error: 'No words aligned' });
                    }
                } catch (err) {
                    aligned.push({ questionId, wordCount: 0, ok: false, error: err?.message || String(err) });
                }
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = serverTimestamp();
                await testRef.update(updates);
            }

            return sendSuccess(res, { testId, aligned }, 'Speaking words aligned.');
        } catch (error) {
            return sendError(res, 500, 'ALIGN_WORDS_ERROR', 'Failed to align speaking words.', error?.message || error);
        }
    });

    // --- Segmental screening submit route ---
    router.post('/entrance-tests/submit-segmental', async (req, res) => {
        try {
            const token = cleanOptionalString(req.body?.token);
            if (!token || token.length < 10) {
                return sendError(res, 400, 'INVALID_TOKEN', 'Missing or invalid token.');
            }

            const testId = hashTokenToTestId(token);
            const ref = db.collection(ENTRANCE_TESTS).doc(testId);

            const result = await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) {
                    return { ok: false, status: 404, error: 'TEST_NOT_FOUND', message: 'This link is invalid.' };
                }

                const data = snap.data() || {};
                if (data.testType !== 'segmental_screening_v1') {
                    return { ok: false, status: 400, error: 'WRONG_TEST_TYPE', message: 'This endpoint is only for segmental screening tests.' };
                }
                if (data.status === 'submitted' || data.status === 'revoked') {
                    return { ok: false, status: 410, error: 'TEST_LINK_USED', message: 'This link has already been used.' };
                }

                const results = req.body?.results || null;
                const contrastSummaries = req.body?.contrastSummaries || null;

                const leadId = cleanOptionalString(data.leadId);
                const studentId = cleanOptionalString(data.studentId);

                // Sync lead stage to test_completed
                if (leadId) {
                    const leadRef = db.collection(CRM_LEADS).doc(leadId);
                    const leadSnap = await tx.get(leadRef);
                    if (leadSnap.exists) {
                        const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_completed', {
                            user: { uid: 'public-entrance-test', email: null },
                            serverTimestamp
                        });
                        if (leadPatch) {
                            tx.set(leadRef, leadPatch, { merge: true });
                        }
                    }
                }

                tx.set(ref, {
                    status: 'submitted',
                    startedAt: data.startedAt || serverTimestamp(),
                    submittedAt: serverTimestamp(),
                    segmentalResults: results,
                    segmentalSummaries: contrastSummaries,
                    submittedMeta: {
                        ip: req.ip || null,
                        userAgent: req.headers['user-agent'] || null
                    },
                    updatedAt: serverTimestamp()
                }, { merge: true });

                return { ok: true };
            });

            if (!result.ok) {
                return sendError(res, result.status, result.error, result.message);
            }

            return sendSuccess(res, { testId }, 'Segmental screening submitted.');
        } catch (e) {
            console.error('[CRM EntranceTests] /submit-segmental error:', e);
            return sendError(res, 500, 'SUBMIT_ERROR', 'Failed to submit segmental screening.', e?.message || String(e));
        }
    });
};
