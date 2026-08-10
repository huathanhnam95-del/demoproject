const express = require('express');
const axios = require('axios');
const https = require('https');
const { FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { db } = require('../utils/firebase_admin_init');
const { sendError, sendSuccess } = require('../crm/http-contracts');
const { CRM_LEADS } = require('../crm/collections');
const { buildLeadStageSyncPatch } = require('../crm/lead-service');
const {
    TEST_36PLUS,
    TEST_VERSION,
    hashTokenToTestId,
    extensionFromContentType,
    normalizeAsrContentType,
    computeWordAccuracyPercent,
    buildPublicSession,
    scoreSubmission
} = require('../entrance-test/test36plus');

const router = express.Router();

const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;
const ASR_MODEL = process.env.ENTRANCE_TEST_ASR_MODEL || 'openai/whisper-large-v3';

function resolveStorageBucket() {
    try {
        const bucketName = String(process.env.CLIENT_FIREBASE_STORAGE_BUCKET || '').trim();
        const storage = getStorage();
        return bucketName ? storage.bucket(bucketName) : storage.bucket();
    } catch (error) {
        console.warn('[EntranceTest] Storage init failed:', error?.message || error);
        return null;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeQuestionAnswers(value) {
    if (!Array.isArray(value)) return null;
    return value
        .slice(0, 24)
        .map((item) => String(item ?? '').trim());
}

function sanitizeSectionResponses(rawSection, prefix) {
    if (!isPlainObject(rawSection)) return {};
    const out = {};
    for (const [questionId, answers] of Object.entries(rawSection)) {
        if (!questionId.startsWith(`${prefix}_`)) continue;
        const normalizedAnswers = sanitizeQuestionAnswers(answers);
        if (!normalizedAnswers) continue;
        out[questionId] = normalizedAnswers;
    }
    return out;
}

function sanitizeProgressResponses(rawResponses) {
    const responses = isPlainObject(rawResponses) ? rawResponses : {};
    return {
        vocab: sanitizeSectionResponses(responses.vocab, 'vocab'),
        grammar: sanitizeSectionResponses(responses.grammar, 'grammar'),
        listen_write: sanitizeSectionResponses(responses.listen_write, 'listen_write')
    };
}

function sanitizeProgressDraft(rawProgress) {
    if (!isPlainObject(rawProgress)) return null;
    const stepIndexValue = Number(rawProgress.stepIndex);
    const stepIndex = Number.isFinite(stepIndexValue) ? Math.max(0, Math.floor(stepIndexValue)) : 0;
    return {
        stepIndex,
        responses: sanitizeProgressResponses(rawProgress.responses)
    };
}

function getSpeakingQuestionById(questionId) {
    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const q = speaking?.questions?.find((x) => x.id === questionId) || null;
    return q;
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

router.get('/session', async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');

        const token = String(req.query.token || '').trim();
        if (!token || token.length < 10) {
            return sendError(res, 400, 'INVALID_TOKEN', 'Missing or invalid token.');
        }

        const testId = hashTokenToTestId(token);
        const ref = db.collection('entranceTests').doc(testId);
        const snap = await ref.get();

        if (!snap.exists) {
            return sendError(res, 404, 'TEST_NOT_FOUND', 'This link is invalid.');
        }

        const data = snap.data() || {};
        if (data.version && data.version !== TEST_VERSION) {
            return sendError(res, 400, 'TEST_VERSION_MISMATCH', 'This entrance test link uses an unsupported version.');
        }

        if (data.status === 'submitted' || data.status === 'revoked') {
            return sendError(res, 410, 'TEST_LINK_USED', 'This link has already been used.');
        }

        if (!data.startedAt) {
            await ref.set({
                status: 'started',
                startedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }

        const session = buildPublicSession(testId);
        const progress = sanitizeProgressDraft(data.progress);
        return sendSuccess(res, { testId, session, progress });
    } catch (e) {
        console.error('[EntranceTest] /session error:', e);
        return sendError(res, 500, 'SESSION_ERROR', 'Failed to start session.', e?.message || String(e));
    }
});

router.post('/progress', async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');

        const token = String(req.body?.token || '').trim();
        if (!token || token.length < 10) {
            return sendError(res, 400, 'INVALID_TOKEN', 'Missing or invalid token.');
        }

        const draft = sanitizeProgressDraft({
            stepIndex: req.body?.stepIndex,
            responses: req.body?.responses
        });
        if (!draft) {
            return sendError(res, 400, 'INVALID_PROGRESS', 'Missing progress payload.');
        }

        const testId = hashTokenToTestId(token);
        const ref = db.collection('entranceTests').doc(testId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) {
                return { ok: false, status: 404, error: 'TEST_NOT_FOUND', message: 'This link is invalid.' };
            }

            const data = snap.data() || {};
            if (data.version && data.version !== TEST_VERSION) {
                return { ok: false, status: 400, error: 'TEST_VERSION_MISMATCH', message: 'This entrance test link uses an unsupported version.' };
            }

            if (data.status === 'submitted' || data.status === 'revoked') {
                return { ok: false, status: 410, error: 'TEST_LINK_USED', message: 'This link has already been used.' };
            }

            tx.set(ref, {
                status: data.status === 'created' ? 'started' : (data.status || 'started'),
                startedAt: data.startedAt || FieldValue.serverTimestamp(),
                progress: {
                    stepIndex: draft.stepIndex,
                    responses: draft.responses,
                    updatedAt: FieldValue.serverTimestamp()
                },
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return {
                ok: true,
                testId,
                stepIndex: draft.stepIndex
            };
        });

        if (!result.ok) {
            return sendError(res, result.status, result.error, result.message);
        }

        return sendSuccess(res, {
            testId: result.testId,
            stepIndex: result.stepIndex
        }, 'Progress saved.');
    } catch (e) {
        console.error('[EntranceTest] /progress error:', e);
        return sendError(res, 500, 'PROGRESS_SAVE_ERROR', 'Failed to save progress.', e?.message || String(e));
    }
});

router.post('/speaking/upload', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const bucket = resolveStorageBucket();
        if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');

        const token = String(req.query.token || '').trim();
        const questionId = String(req.query.questionId || '').trim();

        if (!token || token.length < 10) {
            return sendError(res, 400, 'INVALID_TOKEN', 'Missing or invalid token.');
        }
        if (!questionId) {
            return sendError(res, 400, 'INVALID_QUESTION', 'Missing questionId.');
        }

        const question = getSpeakingQuestionById(questionId);
        if (!question) {
            return sendError(res, 400, 'INVALID_QUESTION', 'Unknown speaking questionId.');
        }

        const audioBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        if (!audioBuffer || audioBuffer.length < 200) {
            return sendError(res, 400, 'INVALID_AUDIO', 'Audio payload is empty.');
        }

        const testId = hashTokenToTestId(token);
        const ref = db.collection('entranceTests').doc(testId);
        const snap = await ref.get();
        if (!snap.exists) {
            return sendError(res, 404, 'TEST_NOT_FOUND', 'This link is invalid.');
        }

        const data = snap.data() || {};
        if (data.status === 'submitted' || data.status === 'revoked') {
            return sendError(res, 410, 'TEST_LINK_USED', 'This link has already been used.');
        }
        if (data.version && data.version !== TEST_VERSION) {
            return sendError(res, 400, 'TEST_VERSION_MISMATCH', 'This entrance test link uses an unsupported version.');
        }
        const studentId = String(data.studentId || '').trim();
        const leadId = String(data.leadId || '').trim();
        const storageOwnerId = studentId || leadId;
        if (!storageOwnerId) {
            return sendError(res, 500, 'DATA_ERROR', 'Lead or student binding is missing for this test.');
        }

        const contentType = String(req.headers['content-type'] || 'application/octet-stream');
        const ext = extensionFromContentType(contentType);
        const fileName = `audio_${String(question.promptNumber).padStart(2, '0')}.${ext}`;
        const storageScope = studentId ? 'crmStudents' : 'crmLeads';
        const storagePath = `${storageScope}/${storageOwnerId}/entranceTests/${testId}/speaking/${fileName}`;

        const file = bucket.file(storagePath);
        await file.save(audioBuffer, {
            resumable: false,
            metadata: {
                contentType
            }
        });

        let transcript = null;
        let accuracy = null;
        let asrError = null;

        try {
            transcript = await transcribeAudio(audioBuffer, contentType);
            accuracy = computeWordAccuracyPercent(question.expectedText, transcript);
        } catch (e) {
            asrError = e?.message || String(e);
            console.warn('[EntranceTest] ASR failed:', asrError);
        }

        const updatePayload = {
            status: data.status === 'created' ? 'started' : (data.status || 'started'),
            startedAt: data.startedAt || FieldValue.serverTimestamp(),
            speaking: {
                [questionId]: {
                    audio: {
                        bucketName: bucket.name || null,
                        storagePath,
                        contentType,
                        bytes: audioBuffer.length
                    },
                    transcript,
                    accuracyPercent: accuracy?.percent ?? null,
                    expectedCount: accuracy?.expectedCount ?? null,
                    transcriptCount: accuracy?.transcriptCount ?? null,
                    distance: accuracy?.distance ?? null,
                    asrError: asrError || null,
                    uploadedAt: FieldValue.serverTimestamp()
                }
            },
            updatedAt: FieldValue.serverTimestamp()
        };

        await ref.set(updatePayload, { merge: true });

        return sendSuccess(res, {
            transcript,
            accuracyPercent: accuracy?.percent ?? null,
            asrError: asrError || null
        });
    } catch (e) {
        console.error('[EntranceTest] /speaking/upload error:', e);
        return sendError(res, 500, 'UPLOAD_ERROR', 'Failed to upload speaking audio.', e?.message || String(e));
    }
});

router.post('/submit', async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');

        const token = String(req.body?.token || '').trim();
        const responses = req.body?.responses || null;

        if (!token || token.length < 10) {
            return sendError(res, 400, 'INVALID_TOKEN', 'Missing or invalid token.');
        }

        const testId = hashTokenToTestId(token);
        const ref = db.collection('entranceTests').doc(testId);

        const result = await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) {
                return { ok: false, status: 404, error: 'TEST_NOT_FOUND', message: 'This link is invalid.' };
            }

            const data = snap.data() || {};
            if (data.version && data.version !== TEST_VERSION) {
                return { ok: false, status: 400, error: 'TEST_VERSION_MISMATCH', message: 'This entrance test link uses an unsupported version.' };
            }

            if (data.status === 'submitted' || data.status === 'revoked') {
                return { ok: false, status: 410, error: 'TEST_LINK_USED', message: 'This link has already been used.' };
            }

            const scoring = scoreSubmission(responses);
            const studentId = String(data.studentId || '').trim();
            const leadId = String(data.leadId || '').trim();
            if (studentId) {
                const studentRef = db.collection('crmStudents').doc(studentId);
                const studentSnap = await tx.get(studentRef);
                const leadId = studentSnap.exists ? String(studentSnap.data()?.leadId || '').trim() : '';
                if (leadId) {
                    const leadRef = db.collection(CRM_LEADS).doc(leadId);
                    const leadSnap = await tx.get(leadRef);
                    if (leadSnap.exists) {
                        const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_completed', {
                            user: { uid: 'public-entrance-test', email: null },
                            serverTimestamp: () => FieldValue.serverTimestamp()
                        });
                        if (leadPatch) {
                            tx.set(leadRef, leadPatch, { merge: true });
                        }
                    }
                }
            } else if (leadId) {
                const leadRef = db.collection(CRM_LEADS).doc(leadId);
                const leadSnap = await tx.get(leadRef);
                if (leadSnap.exists) {
                    const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_completed', {
                        user: { uid: 'public-entrance-test', email: null },
                        serverTimestamp: () => FieldValue.serverTimestamp()
                    });
                    if (leadPatch) {
                        tx.set(leadRef, leadPatch, { merge: true });
                    }
                }
            }

            tx.set(ref, {
                status: 'submitted',
                startedAt: data.startedAt || FieldValue.serverTimestamp(),
                submittedAt: FieldValue.serverTimestamp(),
                responses: responses || null,
                scoring,
                submittedMeta: {
                    ip: req.ip || null,
                    userAgent: req.headers['user-agent'] || null
                },
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return { ok: true, scoringSummary: scoring.overall };
        });

        if (!result.ok) {
            return sendError(res, result.status, result.error, result.message);
        }

        return sendSuccess(res, {
            testId,
            scoring: result.scoringSummary
        }, 'Submitted successfully.');
    } catch (e) {
        console.error('[EntranceTest] /submit error:', e);
        return sendError(res, 500, 'SUBMIT_ERROR', 'Failed to submit entrance test.', e?.message || String(e));
    }
});

module.exports = router;
