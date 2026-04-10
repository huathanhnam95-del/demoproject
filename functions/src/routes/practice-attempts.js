const express = require('express');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { resolvePracticeAccessForUid } = require('../crm/practice-access-service');

const SPEAKING_ATTEMPTS = 'speakingAttempts';
const SPEAKING_ATTEMPT_SHARES = 'speakingAttemptShares';

const RETENTION = {
    student: 'student_permanent',
    promoted: 'promoted_student',
    nonstudentTtl: 'nonstudent_ttl',
    nonstudentBookmarked: 'nonstudent_bookmarked'
};

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, maxLen) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (Number.isFinite(maxLen) && maxLen > 0) return text.slice(0, maxLen);
    return text;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
}

async function isReviewer(db, uid) {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return false;
    const data = snap.data() || {};
    return data.isAdmin === true || String(data.crmRole || '') === 'teacher';
}

function buildShareUrl(req, shareId, token) {
    const proto = req.protocol || 'https';
    const host = req.get('host');
    return `${proto}://${host}/api/shared/practice-attempts/${encodeURIComponent(shareId)}?token=${encodeURIComponent(token)}`;
}

async function signReadUrl(bucket, storagePath, options = {}) {
    const expiresMinutes = Number.isFinite(options.expiresMinutes) ? options.expiresMinutes : 15;
    const expires = Date.now() + expiresMinutes * 60 * 1000;
    const [url] = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires
    });
    return url;
}

function sanitizePromptSnapshot(input) {
    const prompt = isPlainObject(input) ? input : {};
    return {
        promptId: cleanString(prompt.promptId, 128),
        title: cleanString(prompt.title, 200),
        text: cleanString(prompt.text, 4000),
        source: cleanString(prompt.source, 200)
    };
}

function pickReasonableMode(input) {
    const mode = cleanString(input, 64);
    if (!mode) return null;
    // Keep open-ended for future speaking modes, but prevent absurd values.
    if (!/^[a-z0-9_]+$/i.test(mode)) return null;
    return mode;
}

function ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer }) {
    if (!attempt) return { ok: false, code: 'NOT_FOUND', message: 'Attempt not found.' };
    if (String(attempt.ownerUid || '') === String(uid || '')) return { ok: true };
    if (reviewer) return { ok: true };
    return { ok: false, code: 'FORBIDDEN', message: 'Access denied.' };
}

module.exports = function createPracticeAttemptsRouter(deps) {
    const { db, authMiddleware, sendSuccess, sendError, getStorageBucket } = deps;
    const router = express.Router();

    // Create an attempt record and return the upload path.
    router.post('/prepare', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const mode = pickReasonableMode(req.body?.practiceMode);
            if (!mode) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid practiceMode.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc();
            const attemptId = attemptRef.id;
            const audioPath = `practice-attempts/${uid}/${attemptId}/student.wav`;

            const promptSnapshot = sanitizePromptSnapshot(req.body?.promptSnapshot);

            await attemptRef.set({
                attemptId,
                ownerUid: uid,
                practiceMode: mode,
                promptSnapshot,
                status: 'awaiting_upload',
                createdAt: FieldValue.serverTimestamp(),
                submittedAt: null,
                audio: {
                    studentPath: audioPath,
                    contentType: 'audio/wav'
                },
                retentionState: null,
                deleteAfterAt: null,
                bookmark: {
                    active: false,
                    bookmarkedAt: null,
                    lastChangedAt: FieldValue.serverTimestamp()
                },
                accessSnapshot: null,
                promotion: null,
                shareId: null,
                deletionState: null,
                updatedAt: FieldValue.serverTimestamp()
            });

            return sendSuccess(res, {
                attemptId,
                upload: {
                    path: audioPath,
                    contentType: 'audio/wav'
                }
            });
        } catch (error) {
            return sendError(res, 500, 'PREPARE_ATTEMPT_ERROR', 'Failed to prepare attempt.', error?.message || error);
        }
    });

    // Finalize an attempt after upload exists.
    router.post('/:attemptId/complete', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (String(attempt.ownerUid || '') !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can submit this attempt.');
            }
            if (String(attempt.status || '') === 'submitted') {
                return sendSuccess(res, { attemptId }, 'Attempt already submitted.');
            }

            const audioPath = String(attempt.audio?.studentPath || '').trim();
            if (!audioPath) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing audio path.');

            const bucket = await getStorageBucket();
            const file = bucket.file(audioPath);
            const [exists] = await file.exists();
            if (!exists) return sendError(res, 400, 'UPLOAD_MISSING', 'Student audio upload not found.');

            const [meta] = await file.getMetadata().catch(() => [null]);
            const contentType = String(meta?.contentType || '').toLowerCase();
            const sizeBytes = Number(meta?.size || 0);
            if (sizeBytes <= 0) return sendError(res, 400, 'INVALID_AUDIO', 'Uploaded audio is empty.');
            if (sizeBytes > 30 * 1024 * 1024) return sendError(res, 400, 'INVALID_AUDIO', 'Uploaded audio is too large.');
            if (contentType && !contentType.includes('wav')) {
                return sendError(res, 400, 'INVALID_AUDIO', 'Uploaded audio must be WAV.');
            }

            const resolved = await resolvePracticeAccessForUid(db, uid, { now: new Date() });
            const retentionState = resolved.effectiveStatus === 'student' ? RETENTION.student : RETENTION.nonstudentTtl;
            const deleteAfterAt = resolved.effectiveStatus === 'student' ? null : addDays(new Date(), 10);

            await attemptRef.set({
                status: 'submitted',
                submittedAt: FieldValue.serverTimestamp(),
                retentionState,
                deleteAfterAt,
                accessSnapshot: {
                    resolvedAt: new Date(),
                    effectiveStatus: resolved.effectiveStatus,
                    source: resolved.source,
                    studentId: resolved.studentId || null,
                    enrollmentIds: Array.isArray(resolved.enrollmentIds) ? resolved.enrollmentIds : [],
                    effectiveWindowStartAt: resolved.effectiveWindowStartAt || null,
                    effectiveWindowEndAt: resolved.effectiveWindowEndAt || null
                },
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return sendSuccess(res, { attemptId }, 'Attempt submitted.');
        } catch (error) {
            return sendError(res, 500, 'COMPLETE_ATTEMPT_ERROR', 'Failed to complete attempt.', error?.message || error);
        }
    });

    // List attempts for the signed-in user.
    router.get('/', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const scope = String(req.query?.scope || 'mine').trim();
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const bucket = await getStorageBucket();

            if (scope === 'review') {
                const reviewer = await isReviewer(db, uid);
                if (!reviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

                const snap = await db.collection(SPEAKING_ATTEMPTS)
                    .where('status', '==', 'submitted')
                    .orderBy('submittedAt', 'desc')
                    .limit(50)
                    .get();

                const attempts = [];
                for (const doc of snap.docs) {
                    const data = doc.data() || {};
                    const studentUrl = data.audio?.studentPath
                        ? await signReadUrl(bucket, data.audio.studentPath, { expiresMinutes: 15 }).catch(() => null)
                        : null;
                    attempts.push({
                        attemptId: doc.id,
                        practiceMode: data.practiceMode || null,
                        submittedAt: data.submittedAt || null,
                        retentionState: data.retentionState || null,
                        deleteAfterAt: data.deleteAfterAt || null,
                        audio: { studentUrl }
                    });
                }

                return sendSuccess(res, { attempts });
            }

            const snap = await db.collection(SPEAKING_ATTEMPTS)
                .where('ownerUid', '==', uid)
                .orderBy('createdAt', 'desc')
                .limit(50)
                .get();

            const bookmarkedSnap = await db.collection(SPEAKING_ATTEMPTS)
                .where('ownerUid', '==', uid)
                .where('retentionState', '==', RETENTION.nonstudentBookmarked)
                .limit(10)
                .get();
            const nonStudentBookmarkCount = bookmarkedSnap.docs.length;

            const attempts = [];
            for (const doc of snap.docs) {
                const data = doc.data() || {};
                const studentUrl = data.audio?.studentPath
                    ? await signReadUrl(bucket, data.audio.studentPath, { expiresMinutes: 15 }).catch(() => null)
                    : null;
                attempts.push({
                    attemptId: doc.id,
                    practiceMode: data.practiceMode || null,
                    status: data.status || null,
                    createdAt: data.createdAt || null,
                    submittedAt: data.submittedAt || null,
                    retentionState: data.retentionState || null,
                    deleteAfterAt: data.deleteAfterAt || null,
                    bookmark: {
                        active: !!data.bookmark?.active
                    },
                    audio: { studentUrl }
                });
            }

            return sendSuccess(res, {
                attempts,
                nonStudentBookmarkCount,
                nonStudentBookmarkLimit: 5
            });
        } catch (error) {
            return sendError(res, 500, 'LIST_ATTEMPTS_ERROR', 'Failed to list attempts.', error?.message || error);
        }
    });

    // Fetch a single attempt (owner or reviewer).
    router.get('/:attemptId', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const reviewer = await isReviewer(db, uid);
            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');

            const attempt = snap.data() || {};
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.code === 'FORBIDDEN' ? 403 : 404, authz.code, authz.message);

            const bucket = await getStorageBucket();
            const studentUrl = attempt.audio?.studentPath
                ? await signReadUrl(bucket, attempt.audio.studentPath, { expiresMinutes: 15 }).catch(() => null)
                : null;

            return sendSuccess(res, {
                attempt: {
                    attemptId,
                    practiceMode: attempt.practiceMode || null,
                    promptSnapshot: attempt.promptSnapshot || null,
                    status: attempt.status || null,
                    createdAt: attempt.createdAt || null,
                    submittedAt: attempt.submittedAt || null,
                    retentionState: attempt.retentionState || null,
                    deleteAfterAt: attempt.deleteAfterAt || null,
                    bookmark: { active: !!attempt.bookmark?.active },
                    accessSnapshot: attempt.accessSnapshot || null,
                    audio: { studentUrl }
                }
            });
        } catch (error) {
            return sendError(res, 500, 'GET_ATTEMPT_ERROR', 'Failed to fetch attempt.', error?.message || error);
        }
    });

    // Bookmark/unbookmark an attempt (owner only).
    router.patch('/:attemptId/bookmark', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            const nextActive = !!req.body?.active;
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (String(attempt.ownerUid || '') !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can bookmark this attempt.');
            }

            const retentionState = String(attempt.retentionState || '');
            const isNonStudentRetention = retentionState === RETENTION.nonstudentTtl || retentionState === RETENTION.nonstudentBookmarked;
            if (!isNonStudentRetention) {
                // Permanent attempts do not require bookmarking; treat as a no-op success.
                await attemptRef.set({
                    bookmark: {
                        active: nextActive,
                        bookmarkedAt: nextActive ? FieldValue.serverTimestamp() : null,
                        lastChangedAt: FieldValue.serverTimestamp()
                    },
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
                return sendSuccess(res, { attemptId, active: nextActive });
            }

            if (nextActive) {
                const bookmarkedSnap = await db.collection(SPEAKING_ATTEMPTS)
                    .where('ownerUid', '==', uid)
                    .where('retentionState', '==', RETENTION.nonstudentBookmarked)
                    .limit(10)
                    .get();
                const existingBookmarks = bookmarkedSnap.docs
                    .map((d) => ({ attemptId: d.id, ...(d.data() || {}) }))
                    .filter((row) => row.attemptId !== attemptId);

                if (existingBookmarks.length >= 5) {
                    const summaries = existingBookmarks.slice(0, 5).map((row) => ({
                        attemptId: row.attemptId,
                        practiceMode: row.practiceMode || null,
                        submittedAt: row.submittedAt || null,
                        createdAt: row.createdAt || null
                    }));
                    return sendError(res, 409, 'BOOKMARK_LIMIT_REACHED', 'You have reached the maximum number of bookmarked submissions.', {
                        bookmarkedAttempts: summaries,
                        limit: 5
                    });
                }

                await attemptRef.set({
                    retentionState: RETENTION.nonstudentBookmarked,
                    deleteAfterAt: null,
                    bookmark: {
                        active: true,
                        bookmarkedAt: FieldValue.serverTimestamp(),
                        lastChangedAt: FieldValue.serverTimestamp()
                    },
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                return sendSuccess(res, { attemptId, active: true });
            }

            // Unbookmark: restore TTL. If TTL already passed, give a fixed 24h grace window.
            const submittedAt = attempt.submittedAt?.toDate ? attempt.submittedAt.toDate() : null;
            const ttlAt = submittedAt ? addDays(submittedAt, 10) : addDays(new Date(), 10);
            const graceAt = addDays(new Date(), 1);
            const nextDeleteAfterAt = ttlAt.getTime() > graceAt.getTime() ? ttlAt : graceAt;

            await attemptRef.set({
                retentionState: RETENTION.nonstudentTtl,
                deleteAfterAt: nextDeleteAfterAt,
                bookmark: {
                    active: false,
                    bookmarkedAt: null,
                    lastChangedAt: FieldValue.serverTimestamp()
                },
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return sendSuccess(res, { attemptId, active: false, deleteAfterAt: nextDeleteAfterAt });
        } catch (error) {
            return sendError(res, 500, 'BOOKMARK_ERROR', 'Failed to update bookmark.', error?.message || error);
        }
    });

    // Create-or-return permanent share link for an attempt (owner only).
    router.post('/:attemptId/share', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (String(attempt.ownerUid || '') !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can share this attempt.');
            }

            const existingShareId = cleanString(attempt.shareId, 128);
            if (existingShareId) {
                const shareSnap = await db.collection(SPEAKING_ATTEMPT_SHARES).doc(existingShareId).get();
                if (shareSnap.exists) {
                    const share = shareSnap.data() || {};
                    const token = cleanString(share.token, 4096);
                    if (token) {
                        return sendSuccess(res, {
                            shareId: existingShareId,
                            url: buildShareUrl(req, existingShareId, token)
                        });
                    }
                }
            }

            const shareId = crypto.randomBytes(16).toString('base64url');
            const token = crypto.randomBytes(32).toString('base64url');
            const tokenHash = sha256Hex(token);

            await db.collection(SPEAKING_ATTEMPT_SHARES).doc(shareId).set({
                shareId,
                attemptId,
                ownerUid: uid,
                token,
                tokenHash,
                status: 'active',
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            await attemptRef.set({
                shareId,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return sendSuccess(res, {
                shareId,
                url: buildShareUrl(req, shareId, token)
            });
        } catch (error) {
            return sendError(res, 500, 'SHARE_ERROR', 'Failed to create share link.', error?.message || error);
        }
    });

    // Prepare feedback (teacher/admin only).
    router.post('/:attemptId/feedback/prepare', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const reviewer = await isReviewer(db, uid);
            if (!reviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc();
            const feedbackId = feedbackRef.id;
            const audioPath = `practice-attempt-feedback/${attemptId}/${feedbackId}/${uid}.wav`;

            await feedbackRef.set({
                feedbackId,
                attemptId,
                authorUid: uid,
                status: 'awaiting_upload',
                visibility: 'private',
                text: null,
                audioPath,
                contentType: 'audio/wav',
                createdAt: FieldValue.serverTimestamp(),
                completedAt: null,
                updatedAt: FieldValue.serverTimestamp()
            });

            return sendSuccess(res, {
                feedbackId,
                upload: { path: audioPath, contentType: 'audio/wav' }
            });
        } catch (error) {
            return sendError(res, 500, 'FEEDBACK_PREPARE_ERROR', 'Failed to prepare feedback.', error?.message || error);
        }
    });

    // Complete feedback (teacher/admin only).
    router.post('/:attemptId/feedback/:feedbackId/complete', authMiddleware, async (req, res) => {
        try {
            const uid = String(req.user?.uid || '').trim();
            const attemptId = cleanString(req.params?.attemptId, 128);
            const feedbackId = cleanString(req.params?.feedbackId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId || !feedbackId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId or feedbackId.');

            const reviewer = await isReviewer(db, uid);
            if (!reviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc(feedbackId);
            const snap = await feedbackRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Feedback not found.');
            const feedback = snap.data() || {};
            if (String(feedback.authorUid || '') !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the feedback author can complete it.');
            }
            if (String(feedback.status || '') === 'completed') {
                return sendSuccess(res, { feedbackId }, 'Feedback already completed.');
            }

            const visibilityRaw = cleanString(req.body?.visibility, 16) || 'private';
            const visibility = visibilityRaw === 'shared' ? 'shared' : 'private';
            const text = cleanString(req.body?.text, 4000);
            const hasAudio = req.body?.hasAudio === true;

            let audioOk = false;
            let audioPath = cleanString(feedback.audioPath, 1024);
            if (hasAudio && audioPath) {
                const bucket = await getStorageBucket();
                const [exists] = await bucket.file(audioPath).exists();
                if (!exists) return sendError(res, 400, 'UPLOAD_MISSING', 'Feedback audio upload not found.');
                audioOk = true;
            } else if (!hasAudio) {
                audioPath = null;
            }

            if (!text && !audioOk) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Feedback must include text or audio.');
            }

            await feedbackRef.set({
                status: 'completed',
                visibility,
                text: text || null,
                audioPath: audioPath || null,
                completedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            return sendSuccess(res, { feedbackId }, 'Feedback saved.');
        } catch (error) {
            return sendError(res, 500, 'FEEDBACK_COMPLETE_ERROR', 'Failed to save feedback.', error?.message || error);
        }
    });

    return router;
};
