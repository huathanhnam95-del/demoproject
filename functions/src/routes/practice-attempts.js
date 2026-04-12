/* eslint-disable no-console */
const express = require('express');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { resolvePracticeAccessForUid } = require('../crm/practice-access-service');
const {
    BOOKMARK_LIMIT,
    DEFAULT_MAX_UPLOAD_BYTES,
    DEFAULT_SIGNED_READ_URL_MINUTES,
    FEEDBACK_MAX_DURATION_MS,
    NON_STUDENT_TTL_DAYS,
    UNBOOKMARK_GRACE_HOURS,
    getModeConstraints,
    normalizePracticeMode
} = require('../practice-attempts/attempt-constraints');
const { parseWavMetadata } = require('../practice-attempts/wav-audio');

const SPEAKING_ATTEMPTS = 'speakingAttempts';
const SPEAKING_ATTEMPT_SHARES = 'speakingAttemptShares';
const SPEAKING_ATTEMPT_COUNTERS = 'speakingAttemptCounters';
const SPEAKING_ATTEMPT_EVENTS = 'speakingAttemptEvents';

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

function toFiniteNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function asDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? new Date(ms) : null;
    }
    return null;
}

function addDays(date, days) {
    const out = new Date(date.getTime());
    out.setDate(out.getDate() + days);
    return out;
}

function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function buildAttemptAudioPath(uid, attemptId) {
    return `practice-attempts/${uid}/${attemptId}/student.wav`;
}

function buildFeedbackAudioPath(attemptId, feedbackId, uid) {
    return `practice-attempt-feedback/${attemptId}/${feedbackId}/${uid}.wav`;
}

function isAllowedWavContentType(contentType) {
    const lowered = String(contentType || '').trim().toLowerCase();
    if (!lowered) return false;
    return lowered === 'audio/wav'
        || lowered === 'audio/x-wav'
        || lowered.includes('wav');
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

function toConstraintSnapshot(constraints, now) {
    return {
        practiceMode: constraints.practiceMode,
        hardMaxMs: constraints.hardMaxMs,
        hardMaxSeconds: constraints.hardMaxSeconds,
        uiMaxSeconds: constraints.uiMaxSeconds,
        maxUploadBytes: constraints.maxUploadBytes,
        signedReadUrlMinutes: constraints.signedReadUrlMinutes,
        resolvedAt: now instanceof Date ? now : new Date()
    };
}

function resolveConstraintSnapshot(attempt) {
    const raw = isPlainObject(attempt?.constraintSnapshot) ? attempt.constraintSnapshot : null;
    if (raw) {
        const hardMaxMs = toFiniteNumber(raw.hardMaxMs, null);
        const hardMaxSeconds = toFiniteNumber(raw.hardMaxSeconds, null);
        const uiMaxSeconds = toFiniteNumber(raw.uiMaxSeconds, null);
        const maxUploadBytes = toFiniteNumber(raw.maxUploadBytes, null);
        const signedReadUrlMinutes = toFiniteNumber(raw.signedReadUrlMinutes, DEFAULT_SIGNED_READ_URL_MINUTES);
        const practiceMode = normalizePracticeMode(raw.practiceMode || attempt?.practiceMode);
        if (practiceMode && hardMaxMs && hardMaxSeconds && uiMaxSeconds && maxUploadBytes) {
            return {
                practiceMode,
                hardMaxMs,
                hardMaxSeconds,
                uiMaxSeconds,
                maxUploadBytes,
                signedReadUrlMinutes
            };
        }
    }
    return getModeConstraints(attempt?.practiceMode);
}

function buildShareUrl(req, shareId, token) {
    const proto = req.protocol || 'https';
    const host = req.get('host');
    return `${proto}://${host}/api/shared/practice-attempts/${encodeURIComponent(shareId)}?token=${encodeURIComponent(token)}`;
}

async function signReadUrl(bucket, storagePath, options = {}) {
    const expiresMinutes = Number.isFinite(options.expiresMinutes)
        ? options.expiresMinutes
        : DEFAULT_SIGNED_READ_URL_MINUTES;
    const expires = Date.now() + expiresMinutes * 60 * 1000;
    const [url] = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires
    });
    return url;
}

async function mapWithConcurrency(items, limit, fn) {
    const list = Array.isArray(items) ? items : [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 1, 20));
    const out = new Array(list.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(safeLimit, list.length) }, async () => {
        while (next < list.length) {
            const idx = next;
            next += 1;
            if (idx >= list.length) break;
            out[idx] = await fn(list[idx], idx);
        }
    });

    await Promise.all(workers);
    return out;
}

function createHttpError(status, code, message, details) {
    const err = new Error(message || 'Request failed');
    err.status = status;
    err.code = code || 'REQUEST_FAILED';
    err.details = details || null;
    return err;
}

function buildAccessSnapshot(resolved, now) {
    return {
        resolvedAt: now,
        effectiveStatus: resolved?.effectiveStatus || 'nonstudent',
        source: resolved?.source || 'none',
        studentId: resolved?.studentId || null,
        enrollmentIds: Array.isArray(resolved?.enrollmentIds) ? resolved.enrollmentIds : [],
        effectiveWindowStartAt: resolved?.effectiveWindowStartAt || null,
        effectiveWindowEndAt: resolved?.effectiveWindowEndAt || null
    };
}

function logRouteEvent(routeName, payload) {
    try {
        console.log('[practice-attempts]', JSON.stringify({
            routeName,
            at: new Date().toISOString(),
            ...payload
        }));
    } catch (_) {
        console.log('[practice-attempts]', routeName, payload);
    }
}

async function appendAttemptEvent(db, event) {
    try {
        await db.collection(SPEAKING_ATTEMPT_EVENTS).add({
            eventType: cleanString(event?.eventType, 80) || 'unknown',
            routeName: cleanString(event?.routeName, 120) || null,
            uid: cleanString(event?.uid, 128) || null,
            attemptId: cleanString(event?.attemptId, 128) || null,
            shareId: cleanString(event?.shareId, 128) || null,
            feedbackId: cleanString(event?.feedbackId, 128) || null,
            resultCode: cleanString(event?.resultCode, 80) || null,
            meta: isPlainObject(event?.meta) ? event.meta : {},
            createdAt: FieldValue.serverTimestamp()
        });
    } catch (error) {
        logRouteEvent('attempt-event-write-failed', {
            resultCode: 'AUDIT_WRITE_FAILED',
            error: String(error?.message || error)
        });
    }
}

async function resolveReviewerAccess(db, user) {
    const uid = cleanString(user?.uid, 128);
    const claimAdmin = user?.isAdmin === true;
    const claimTeacher = user?.isTeacher === true;

    let profileAdmin = false;
    let profileTeacher = false;
    if (uid) {
        const snap = await db.collection('users').doc(uid).get();
        const data = snap.exists ? (snap.data() || {}) : {};
        profileAdmin = data.isAdmin === true;
        profileTeacher = String(data.crmRole || '').trim().toLowerCase() === 'teacher';
    }

    const isAdmin = claimAdmin || profileAdmin;
    const isTeacher = claimTeacher || profileTeacher;
    return {
        uid,
        isAdmin,
        isTeacher,
        isReviewer: isAdmin || isTeacher
    };
}

function ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer }) {
    if (!attempt) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Attempt not found.' };
    if (String(attempt.ownerUid || '') === String(uid || '')) return { ok: true };
    if (reviewer?.isReviewer) return { ok: true };
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Access denied.' };
}

async function safeDeleteFile(bucket, path) {
    const normalized = cleanString(path, 2048);
    if (!normalized) return;
    try {
        await bucket.file(normalized).delete();
    } catch (error) {
        const code = String(error?.code || '').trim();
        if (code === '404') return;
        if ((error?.message || '').includes('No such object')) return;
        throw error;
    }
}

async function validateWavUploadFromFile(file, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_UPLOAD_BYTES;
    const maxDurationMs = Number.isFinite(options.maxDurationMs) ? options.maxDurationMs : null;

    const [exists] = await file.exists();
    if (!exists) {
        return {
            ok: false,
            status: 400,
            code: 'UPLOAD_MISSING',
            message: 'Audio upload not found.'
        };
    }

    const [meta] = await file.getMetadata().catch(() => [null]);
    const contentType = String(meta?.contentType || '').trim().toLowerCase();
    const sizeBytes = Number(meta?.size || 0);
    if (!contentType || !isAllowedWavContentType(contentType)) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_AUDIO',
            message: 'Uploaded audio must be WAV.'
        };
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_AUDIO',
            message: 'Uploaded audio is empty.'
        };
    }
    if (sizeBytes > maxBytes) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_AUDIO',
            message: 'Uploaded audio is too large.',
            details: { maxUploadBytes: maxBytes, sizeBytes }
        };
    }

    const [buffer] = await file.download().catch(() => [null]);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_AUDIO',
            message: 'Unable to read uploaded audio.'
        };
    }

    const wav = parseWavMetadata(buffer);
    if (!wav.ok || !Number.isFinite(wav.durationMs) || wav.durationMs <= 0) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_AUDIO',
            message: 'Uploaded audio is not a valid WAV file.'
        };
    }

    if (Number.isFinite(maxDurationMs) && wav.durationMs > maxDurationMs) {
        return {
            ok: false,
            status: 400,
            code: 'AUDIO_DURATION_EXCEEDED',
            message: 'Uploaded audio exceeds the allowed duration.',
            details: {
                durationMs: wav.durationMs,
                maxDurationMs
            }
        };
    }

    return {
        ok: true,
        metadata: {
            sizeBytes,
            contentType,
            durationMs: wav.durationMs,
            md5Hash: cleanString(meta?.md5Hash, 256) || null,
            generation: cleanString(meta?.generation, 128) || null,
            validatedAt: new Date()
        }
    };
}

function sanitizeVisibility(value, fallback = 'private') {
    const normalized = cleanString(value, 16);
    if (normalized === 'shared') return 'shared';
    if (normalized === 'private') return 'private';
    return fallback;
}

function summarizeAttemptForList(doc, data, signedUrl) {
    return {
        attemptId: doc.id,
        ownerUid: data.ownerUid || null,
        practiceMode: data.practiceMode || null,
        status: data.status || null,
        createdAt: data.createdAt || null,
        submittedAt: data.submittedAt || null,
        retentionState: data.retentionState || null,
        deleteAfterAt: data.deleteAfterAt || null,
        bookmark: {
            active: !!data.bookmark?.active
        },
        constraints: isPlainObject(data.constraintSnapshot) ? {
            hardMaxSeconds: data.constraintSnapshot.hardMaxSeconds || null,
            uiMaxSeconds: data.constraintSnapshot.uiMaxSeconds || null,
            maxUploadBytes: data.constraintSnapshot.maxUploadBytes || null
        } : null,
        audio: {
            studentUrl: signedUrl || null,
            durationMs: data.audio?.durationMs || null
        }
    };
}

module.exports = function createPracticeAttemptsRouter(deps) {
    const { db, sendSuccess, sendError, getStorageBucket } = deps;
    const router = express.Router();

    router.post('/prepare', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/prepare';
        try {
            const uid = cleanString(req.user?.uid, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const constraints = getModeConstraints(req.body?.practiceMode);
            if (!constraints) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid practiceMode.');
            }

            const requestedAttemptId = cleanString(req.body?.attemptId, 128);
            const promptSnapshot = sanitizePromptSnapshot(req.body?.promptSnapshot);
            const now = new Date();

            const txResult = await db.runTransaction(async (tx) => {
                const attemptId = requestedAttemptId || db.collection(SPEAKING_ATTEMPTS).doc().id;
                const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
                const existingSnap = await tx.get(attemptRef);

                if (existingSnap.exists) {
                    const existing = existingSnap.data() || {};
                    const existingOwner = cleanString(existing.ownerUid, 128);
                    if (existingOwner !== uid) {
                        throw createHttpError(409, 'ATTEMPT_ID_CONFLICT', 'attemptId belongs to another user.');
                    }

                    const existingMode = normalizePracticeMode(existing.practiceMode);
                    if (existingMode !== constraints.practiceMode) {
                        throw createHttpError(409, 'ATTEMPT_ID_MODE_MISMATCH', 'attemptId is bound to a different practiceMode.');
                    }

                    const expectedAudioPath = buildAttemptAudioPath(uid, attemptId);
                    const existingStatus = String(existing.status || '').trim();
                    const existingAudioPath = cleanString(existing.audio?.studentPath, 1024);
                    if (existingStatus === 'awaiting_upload' && existingAudioPath !== expectedAudioPath) {
                        // Keep Storage rules deterministic: prepared attempts must always use the canonical path.
                        tx.set(attemptRef, {
                            audio: {
                                studentPath: expectedAudioPath,
                                contentType: 'audio/wav'
                            },
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });
                    }

                    if (!isPlainObject(existing.constraintSnapshot)) {
                        tx.set(attemptRef, {
                            constraintSnapshot: toConstraintSnapshot(constraints, now),
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });
                    }

                    return {
                        created: false,
                        attemptId,
                        status: existingStatus || 'awaiting_upload',
                        audioPath: (existingStatus === 'awaiting_upload' ? expectedAudioPath : (existingAudioPath || expectedAudioPath)),
                        constraints: resolveConstraintSnapshot(existing) || constraints
                    };
                }

                const audioPath = buildAttemptAudioPath(uid, attemptId);
                tx.set(attemptRef, {
                    attemptId,
                    ownerUid: uid,
                    practiceMode: constraints.practiceMode,
                    promptSnapshot,
                    status: 'awaiting_upload',
                    createdAt: FieldValue.serverTimestamp(),
                    submittedAt: null,
                    audio: {
                        studentPath: audioPath,
                        contentType: 'audio/wav',
                        sizeBytes: null,
                        durationMs: null,
                        md5Hash: null,
                        generation: null,
                        validatedAt: null
                    },
                    constraintSnapshot: toConstraintSnapshot(constraints, now),
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

                return {
                    created: true,
                    attemptId,
                    status: 'awaiting_upload',
                    audioPath,
                    constraints
                };
            });

            const responsePayload = {
                attemptId: txResult.attemptId,
                status: txResult.status,
                upload: {
                    path: txResult.audioPath,
                    contentType: 'audio/wav'
                },
                constraints: {
                    hardMaxSeconds: txResult.constraints.hardMaxSeconds,
                    uiMaxSeconds: txResult.constraints.uiMaxSeconds,
                    maxUploadBytes: txResult.constraints.maxUploadBytes
                },
                created: txResult.created
            };

            logRouteEvent(routeName, {
                uid,
                attemptId: txResult.attemptId,
                resultCode: txResult.created ? 'CREATED' : 'RETURNED_EXISTING'
            });
            await appendAttemptEvent(db, {
                eventType: txResult.created ? 'attempt.prepare.created' : 'attempt.prepare.idempotent',
                routeName,
                uid,
                attemptId: txResult.attemptId,
                resultCode: txResult.created ? 'CREATED' : 'RETURNED_EXISTING'
            });

            return sendSuccess(res, responsePayload);
        } catch (error) {
            const status = Number(error?.status || 500);
            const code = cleanString(error?.code, 64) || 'PREPARE_ATTEMPT_ERROR';
            const message = status >= 500 ? 'Failed to prepare attempt.' : (error?.message || 'Invalid attempt preparation request.');
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.body?.attemptId, 128),
                resultCode: code,
                error: String(error?.message || error)
            });
            return sendError(res, status, code, message, error?.details || (status >= 500 ? (error?.message || error) : null));
        }
    });

    router.post('/:attemptId/complete', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/:attemptId/complete';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const firstSnap = await attemptRef.get();
            if (!firstSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const first = firstSnap.data() || {};

            if (cleanString(first.ownerUid, 128) !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can submit this attempt.');
            }
            if (String(first.status || '') === 'submitted') {
                logRouteEvent(routeName, { uid, attemptId, resultCode: 'ALREADY_SUBMITTED' });
                await appendAttemptEvent(db, {
                    eventType: 'attempt.complete.idempotent',
                    routeName,
                    uid,
                    attemptId,
                    resultCode: 'ALREADY_SUBMITTED'
                });
                return sendSuccess(res, { attemptId, alreadySubmitted: true }, 'Attempt already submitted.');
            }

            const constraints = resolveConstraintSnapshot(first);
            if (!constraints) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Attempt has invalid mode constraints.');
            }

            const audioPath = cleanString(first.audio?.studentPath, 1024);
            if (!audioPath) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Attempt audio path is missing.');
            }

            const bucket = await getStorageBucket();
            const file = bucket.file(audioPath);
            const validation = await validateWavUploadFromFile(file, {
                maxBytes: constraints.maxUploadBytes,
                maxDurationMs: constraints.hardMaxMs
            });
            if (!validation.ok) {
                return sendError(
                    res,
                    validation.status || 400,
                    validation.code || 'INVALID_AUDIO',
                    validation.message || 'Uploaded audio is invalid.',
                    validation.details || null
                );
            }

            const now = new Date();
            const resolved = await resolvePracticeAccessForUid(db, uid, { now });
            const retentionState = resolved?.effectiveStatus === 'student' ? RETENTION.student : RETENTION.nonstudentTtl;
            const deleteAfterAt = resolved?.effectiveStatus === 'student'
                ? null
                : addDays(now, NON_STUDENT_TTL_DAYS);
            const accessSnapshot = buildAccessSnapshot(resolved, now);

            const commitResult = await db.runTransaction(async (tx) => {
                const snap = await tx.get(attemptRef);
                if (!snap.exists) {
                    throw createHttpError(404, 'NOT_FOUND', 'Attempt not found.');
                }
                const attempt = snap.data() || {};
                if (cleanString(attempt.ownerUid, 128) !== uid) {
                    throw createHttpError(403, 'FORBIDDEN', 'Only the owner can submit this attempt.');
                }
                if (String(attempt.status || '') === 'submitted') {
                    return { alreadySubmitted: true };
                }

                tx.set(attemptRef, {
                    status: 'submitted',
                    submittedAt: FieldValue.serverTimestamp(),
                    retentionState,
                    deleteAfterAt,
                    accessSnapshot,
                    constraintSnapshot: toConstraintSnapshot(constraints, now),
                    audio: {
                        studentPath: audioPath,
                        contentType: validation.metadata.contentType,
                        sizeBytes: validation.metadata.sizeBytes,
                        durationMs: validation.metadata.durationMs,
                        md5Hash: validation.metadata.md5Hash,
                        generation: validation.metadata.generation,
                        validatedAt: validation.metadata.validatedAt
                    },
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                return { alreadySubmitted: false };
            });

            if (commitResult.alreadySubmitted) {
                logRouteEvent(routeName, { uid, attemptId, resultCode: 'ALREADY_SUBMITTED' });
                await appendAttemptEvent(db, {
                    eventType: 'attempt.complete.idempotent',
                    routeName,
                    uid,
                    attemptId,
                    resultCode: 'ALREADY_SUBMITTED'
                });
                return sendSuccess(res, { attemptId, alreadySubmitted: true }, 'Attempt already submitted.');
            }

            logRouteEvent(routeName, {
                uid,
                attemptId,
                resultCode: 'SUBMITTED',
                practiceMode: constraints.practiceMode,
                durationMs: validation.metadata.durationMs
            });
            await appendAttemptEvent(db, {
                eventType: 'attempt.complete.submitted',
                routeName,
                uid,
                attemptId,
                resultCode: 'SUBMITTED',
                meta: {
                    practiceMode: constraints.practiceMode,
                    durationMs: validation.metadata.durationMs
                }
            });

            return sendSuccess(res, {
                attemptId,
                retentionState,
                deleteAfterAt,
                audio: {
                    sizeBytes: validation.metadata.sizeBytes,
                    contentType: validation.metadata.contentType,
                    durationMs: validation.metadata.durationMs
                }
            }, 'Attempt submitted.');
        } catch (error) {
            const status = Number(error?.status || 500);
            const code = cleanString(error?.code, 64) || 'COMPLETE_ATTEMPT_ERROR';
            const message = status >= 500 ? 'Failed to complete attempt.' : (error?.message || 'Attempt completion failed.');
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: code,
                error: String(error?.message || error)
            });
            return sendError(res, status, code, message, error?.details || (status >= 500 ? (error?.message || error) : null));
        }
    });

    router.get('/', async (req, res) => {
        const routeName = 'GET /api/practice-attempts';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const scope = cleanString(req.query?.scope, 32) || 'mine';
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const bucket = await getStorageBucket();

            if (scope === 'review') {
                const reviewer = await resolveReviewerAccess(db, req.user);
                if (!reviewer.isReviewer) {
                    return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');
                }

                const snap = await db.collection(SPEAKING_ATTEMPTS)
                    .where('status', '==', 'submitted')
                    .orderBy('submittedAt', 'desc')
                    .limit(50)
                    .get();

                const rows = snap.docs.map((doc) => ({ doc, data: doc.data() || {} }));
                const urls = await mapWithConcurrency(rows, 6, async (row) => {
                    const audioPath = cleanString(row.data.audio?.studentPath, 1024);
                    if (!audioPath) return null;
                    const constraints = resolveConstraintSnapshot(row.data);
                    return signReadUrl(bucket, audioPath, {
                        expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
                    }).catch(() => null);
                });

                const attempts = rows.map((row, index) => summarizeAttemptForList(row.doc, row.data, urls[index]));
                logRouteEvent(routeName, { uid, resultCode: 'OK_REVIEW', attemptCount: attempts.length });
                return sendSuccess(res, { attempts });
            }

            const [snap, counterSnap] = await Promise.all([
                db.collection(SPEAKING_ATTEMPTS)
                    .where('ownerUid', '==', uid)
                    .orderBy('createdAt', 'desc')
                    .limit(50)
                    .get(),
                db.collection(SPEAKING_ATTEMPT_COUNTERS).doc(uid).get()
            ]);

            const rows = snap.docs.map((doc) => ({ doc, data: doc.data() || {} }));
            const urls = await mapWithConcurrency(rows, 6, async (row) => {
                const audioPath = cleanString(row.data.audio?.studentPath, 1024);
                if (!audioPath) return null;
                const constraints = resolveConstraintSnapshot(row.data);
                return signReadUrl(bucket, audioPath, {
                    expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
                }).catch(() => null);
            });

            const attempts = rows.map((row, index) => summarizeAttemptForList(row.doc, row.data, urls[index]));
            const nonStudentBookmarkCount = Math.max(0, Number(counterSnap.data()?.nonStudentBookmarkCount || 0));

            logRouteEvent(routeName, { uid, resultCode: 'OK_MINE', attemptCount: attempts.length });
            return sendSuccess(res, {
                attempts,
                nonStudentBookmarkCount,
                nonStudentBookmarkLimit: BOOKMARK_LIMIT
            });
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                resultCode: 'LIST_ATTEMPTS_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'LIST_ATTEMPTS_ERROR', 'Failed to list attempts.', error?.message || error);
        }
    });

    router.get('/:attemptId', async (req, res) => {
        const routeName = 'GET /api/practice-attempts/:attemptId';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');

            const attempt = snap.data() || {};
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);

            const bucket = await getStorageBucket();
            const constraints = resolveConstraintSnapshot(attempt);
            const studentUrl = attempt.audio?.studentPath
                ? await signReadUrl(bucket, attempt.audio.studentPath, {
                    expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
                }).catch(() => null)
                : null;

            logRouteEvent(routeName, { uid, attemptId, resultCode: 'OK' });
            return sendSuccess(res, {
                attempt: {
                    attemptId,
                    ownerUid: attempt.ownerUid || null,
                    practiceMode: attempt.practiceMode || null,
                    promptSnapshot: attempt.promptSnapshot || null,
                    status: attempt.status || null,
                    createdAt: attempt.createdAt || null,
                    submittedAt: attempt.submittedAt || null,
                    retentionState: attempt.retentionState || null,
                    deleteAfterAt: attempt.deleteAfterAt || null,
                    bookmark: {
                        active: !!attempt.bookmark?.active
                    },
                    accessSnapshot: attempt.accessSnapshot || null,
                    constraints: constraints ? {
                        hardMaxSeconds: constraints.hardMaxSeconds,
                        uiMaxSeconds: constraints.uiMaxSeconds,
                        maxUploadBytes: constraints.maxUploadBytes
                    } : null,
                    audio: {
                        studentUrl,
                        sizeBytes: attempt.audio?.sizeBytes || null,
                        contentType: attempt.audio?.contentType || null,
                        durationMs: attempt.audio?.durationMs || null,
                        validatedAt: attempt.audio?.validatedAt || null
                    }
                }
            });
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: 'GET_ATTEMPT_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'GET_ATTEMPT_ERROR', 'Failed to fetch attempt.', error?.message || error);
        }
    });

    router.patch('/:attemptId/bookmark', async (req, res) => {
        const routeName = 'PATCH /api/practice-attempts/:attemptId/bookmark';
        const uid = cleanString(req.user?.uid, 128);
        const attemptId = cleanString(req.params?.attemptId, 128);
        const nextActive = req.body?.active === true;

        try {
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const counterRef = db.collection(SPEAKING_ATTEMPT_COUNTERS).doc(uid);
            const now = new Date();

            const txResult = await db.runTransaction(async (tx) => {
                const attemptSnap = await tx.get(attemptRef);
                if (!attemptSnap.exists) throw createHttpError(404, 'NOT_FOUND', 'Attempt not found.');
                const attempt = attemptSnap.data() || {};
                if (cleanString(attempt.ownerUid, 128) !== uid) {
                    throw createHttpError(403, 'FORBIDDEN', 'Only the owner can bookmark this attempt.');
                }

                const status = String(attempt.status || '').trim();
                if (status !== 'submitted') {
                    throw createHttpError(409, 'ATTEMPT_NOT_SUBMITTED', 'Attempt must be submitted before bookmarking.');
                }

                const retentionState = String(attempt.retentionState || '');
                const isNonStudentRetention = retentionState === RETENTION.nonstudentTtl
                    || retentionState === RETENTION.nonstudentBookmarked;
                const currentlyCounted = retentionState === RETENTION.nonstudentBookmarked;
                const nextCounted = isNonStudentRetention ? nextActive : false;

                const counterSnap = await tx.get(counterRef);
                let count = Number(counterSnap.data()?.nonStudentBookmarkCount || 0);
                if (!Number.isFinite(count) || count < 0) count = 0;

                const delta = (nextCounted ? 1 : 0) - (currentlyCounted ? 1 : 0);
                if (delta > 0 && count >= BOOKMARK_LIMIT) {
                    throw createHttpError(409, 'BOOKMARK_LIMIT_REACHED', 'You have reached the maximum number of bookmarked submissions.', {
                        limit: BOOKMARK_LIMIT
                    });
                }

                let deleteAfterAt = attempt.deleteAfterAt || null;
                if (isNonStudentRetention) {
                    if (nextCounted) {
                        deleteAfterAt = null;
                        tx.set(attemptRef, {
                            retentionState: RETENTION.nonstudentBookmarked,
                            deleteAfterAt: null,
                            bookmark: {
                                active: true,
                                bookmarkedAt: FieldValue.serverTimestamp(),
                                lastChangedAt: FieldValue.serverTimestamp()
                            },
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });
                    } else {
                        const submittedAt = asDate(attempt.submittedAt);
                        const ttlAt = submittedAt ? addDays(submittedAt, NON_STUDENT_TTL_DAYS) : addDays(now, NON_STUDENT_TTL_DAYS);
                        const minimumDeleteAt = addHours(now, UNBOOKMARK_GRACE_HOURS);
                        const nextDeleteAfterAt = ttlAt.getTime() > now.getTime() ? ttlAt : minimumDeleteAt;
                        deleteAfterAt = nextDeleteAfterAt;

                        tx.set(attemptRef, {
                            retentionState: RETENTION.nonstudentTtl,
                            deleteAfterAt: nextDeleteAfterAt,
                            bookmark: {
                                active: false,
                                bookmarkedAt: null,
                                lastChangedAt: FieldValue.serverTimestamp()
                            },
                            updatedAt: FieldValue.serverTimestamp()
                        }, { merge: true });
                    }
                } else {
                    tx.set(attemptRef, {
                        bookmark: {
                            active: nextActive,
                            bookmarkedAt: nextActive ? FieldValue.serverTimestamp() : null,
                            lastChangedAt: FieldValue.serverTimestamp()
                        },
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                if (delta !== 0) {
                    count += delta;
                }
                count = Math.max(0, count);
                tx.set(counterRef, {
                    uid,
                    nonStudentBookmarkCount: count,
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                return {
                    attemptId,
                    active: nextActive,
                    deleteAfterAt,
                    nonStudentBookmarkCount: count
                };
            });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                resultCode: 'BOOKMARK_UPDATED',
                active: txResult.active
            });
            await appendAttemptEvent(db, {
                eventType: txResult.active ? 'attempt.bookmark.enabled' : 'attempt.bookmark.disabled',
                routeName,
                uid,
                attemptId,
                resultCode: txResult.active ? 'BOOKMARK_ON' : 'BOOKMARK_OFF'
            });
            return sendSuccess(res, txResult);
        } catch (error) {
            if (Number(error?.status) === 409 && cleanString(error?.code, 64) === 'BOOKMARK_LIMIT_REACHED') {
                const bookmarkedSnap = await db.collection(SPEAKING_ATTEMPTS)
                    .where('ownerUid', '==', uid)
                    .where('retentionState', '==', RETENTION.nonstudentBookmarked)
                    .limit(10)
                    .get()
                    .catch(() => null);
                const bookmarkedAttempts = Array.isArray(bookmarkedSnap?.docs)
                    ? bookmarkedSnap.docs.map((doc) => {
                        const row = doc.data() || {};
                        return {
                            attemptId: doc.id,
                            practiceMode: row.practiceMode || null,
                            submittedAt: row.submittedAt || null,
                            createdAt: row.createdAt || null
                        };
                    }).slice(0, BOOKMARK_LIMIT)
                    : [];
                logRouteEvent(routeName, {
                    uid,
                    attemptId,
                    resultCode: 'BOOKMARK_LIMIT_REACHED'
                });
                return sendError(res, 409, 'BOOKMARK_LIMIT_REACHED', 'You have reached the maximum number of bookmarked submissions.', {
                    bookmarkedAttempts,
                    limit: BOOKMARK_LIMIT
                });
            }

            const status = Number(error?.status || 500);
            const code = cleanString(error?.code, 64) || 'BOOKMARK_ERROR';
            const message = status >= 500 ? 'Failed to update bookmark.' : (error?.message || 'Failed to update bookmark.');
            logRouteEvent(routeName, {
                uid,
                attemptId,
                resultCode: code,
                error: String(error?.message || error)
            });
            return sendError(res, status, code, message, error?.details || (status >= 500 ? (error?.message || error) : null));
        }
    });

    router.post('/:attemptId/share', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/:attemptId/share';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (cleanString(attempt.ownerUid, 128) !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can share this attempt.');
            }
            if (String(attempt.status || '') !== 'submitted') {
                return sendError(res, 409, 'ATTEMPT_NOT_SUBMITTED', 'Attempt must be submitted before sharing.');
            }

            const rotate = req.body?.rotate === true;
            const existingShareId = cleanString(attempt.shareId, 128);
            if (existingShareId && !rotate) {
                const shareSnap = await db.collection(SPEAKING_ATTEMPT_SHARES).doc(existingShareId).get();
                if (shareSnap.exists) {
                    const share = shareSnap.data() || {};
                    if (String(share.status || '') === 'active') {
                        const token = cleanString(share.token, 4096);
                        if (token) {
                            logRouteEvent(routeName, {
                                uid,
                                attemptId,
                                shareId: existingShareId,
                                resultCode: 'SHARE_REUSED'
                            });
                            await appendAttemptEvent(db, {
                                eventType: 'attempt.share.reused',
                                routeName,
                                uid,
                                attemptId,
                                shareId: existingShareId,
                                resultCode: 'SHARE_REUSED'
                            });
                            return sendSuccess(res, {
                                shareId: existingShareId,
                                url: buildShareUrl(req, existingShareId, token),
                                reused: true
                            });
                        }
                    }
                }
            }

            if (existingShareId && rotate) {
                await db.collection(SPEAKING_ATTEMPT_SHARES).doc(existingShareId).set({
                    status: 'revoked',
                    revokedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true }).catch(() => null);
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

            logRouteEvent(routeName, {
                uid,
                attemptId,
                shareId,
                resultCode: rotate ? 'SHARE_ROTATED' : 'SHARE_CREATED'
            });
            await appendAttemptEvent(db, {
                eventType: rotate ? 'attempt.share.rotated' : 'attempt.share.created',
                routeName,
                uid,
                attemptId,
                shareId,
                resultCode: rotate ? 'SHARE_ROTATED' : 'SHARE_CREATED'
            });

            return sendSuccess(res, {
                shareId,
                url: buildShareUrl(req, shareId, token),
                reused: false
            });
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: 'SHARE_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'SHARE_ERROR', 'Failed to create share link.', error?.message || error);
        }
    });

    router.delete('/:attemptId/share', async (req, res) => {
        const routeName = 'DELETE /api/practice-attempts/:attemptId/share';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (cleanString(attempt.ownerUid, 128) !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can revoke sharing.');
            }

            const shareId = cleanString(attempt.shareId, 128);
            if (shareId) {
                await db.collection(SPEAKING_ATTEMPT_SHARES).doc(shareId).set({
                    status: 'revoked',
                    revokedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true }).catch(() => null);
            }

            await attemptRef.set({
                shareId: null,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                shareId,
                resultCode: 'SHARE_REVOKED'
            });
            await appendAttemptEvent(db, {
                eventType: 'attempt.share.revoked',
                routeName,
                uid,
                attemptId,
                shareId,
                resultCode: 'SHARE_REVOKED'
            });

            return sendSuccess(res, {
                attemptId,
                shareId: shareId || null,
                revoked: !!shareId
            }, shareId ? 'Share link revoked.' : 'No active share link.');
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: 'SHARE_REVOKE_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'SHARE_REVOKE_ERROR', 'Failed to revoke share link.', error?.message || error);
        }
    });

    router.post('/:attemptId/feedback/prepare', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/:attemptId/feedback/prepare';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            if (!reviewer.isReviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = attemptSnap.data() || {};
            if (String(attempt.status || '') !== 'submitted') {
                return sendError(res, 409, 'ATTEMPT_NOT_SUBMITTED', 'Attempt must be submitted before feedback can be added.');
            }

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc();
            const feedbackId = feedbackRef.id;
            const audioPath = buildFeedbackAudioPath(attemptId, feedbackId, uid);

            await feedbackRef.set({
                feedbackId,
                attemptId,
                authorUid: uid,
                status: 'awaiting_upload',
                visibility: 'private',
                text: null,
                audioPath,
                contentType: 'audio/wav',
                durationMs: null,
                sizeBytes: null,
                md5Hash: null,
                generation: null,
                validatedAt: null,
                createdAt: FieldValue.serverTimestamp(),
                completedAt: null,
                updatedAt: FieldValue.serverTimestamp()
            });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_PREPARED'
            });
            await appendAttemptEvent(db, {
                eventType: 'feedback.prepare',
                routeName,
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_PREPARED'
            });

            return sendSuccess(res, {
                feedbackId,
                upload: { path: audioPath, contentType: 'audio/wav' }
            });
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: 'FEEDBACK_PREPARE_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'FEEDBACK_PREPARE_ERROR', 'Failed to prepare feedback.', error?.message || error);
        }
    });

    router.post('/:attemptId/feedback/:feedbackId/complete', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/:attemptId/feedback/:feedbackId/complete';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            const feedbackId = cleanString(req.params?.feedbackId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId || !feedbackId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId or feedbackId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            if (!reviewer.isReviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc(feedbackId);
            const snap = await feedbackRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Feedback not found.');
            const feedback = snap.data() || {};

            const isAuthor = cleanString(feedback.authorUid, 128) === uid;
            if (!isAuthor && !reviewer.isAdmin) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the author or admin can complete feedback.');
            }
            if (String(feedback.status || '') === 'completed') {
                logRouteEvent(routeName, { uid, attemptId, feedbackId, resultCode: 'ALREADY_COMPLETED' });
                await appendAttemptEvent(db, {
                    eventType: 'feedback.complete.idempotent',
                    routeName,
                    uid,
                    attemptId,
                    feedbackId,
                    resultCode: 'ALREADY_COMPLETED'
                });
                return sendSuccess(res, { feedbackId, alreadyCompleted: true }, 'Feedback already completed.');
            }

            const visibility = sanitizeVisibility(req.body?.visibility, 'private');
            const text = cleanString(req.body?.text, 4000);
            const hasAudio = req.body?.hasAudio === true;
            const audioPath = hasAudio ? cleanString(feedback.audioPath, 1024) : null;
            let audioMetadata = null;

            if (hasAudio) {
                if (!audioPath) return sendError(res, 400, 'VALIDATION_ERROR', 'Feedback audio path is missing.');
                const bucket = await getStorageBucket();
                const validation = await validateWavUploadFromFile(bucket.file(audioPath), {
                    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
                    maxDurationMs: FEEDBACK_MAX_DURATION_MS
                });
                if (!validation.ok) {
                    return sendError(
                        res,
                        validation.status || 400,
                        validation.code || 'INVALID_AUDIO',
                        validation.message || 'Feedback audio is invalid.',
                        validation.details || null
                    );
                }
                audioMetadata = validation.metadata;
            }

            if (!text && !audioMetadata) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Feedback must include text or audio.');
            }

            await feedbackRef.set({
                status: 'completed',
                visibility,
                text: text || null,
                audioPath: audioPath || null,
                contentType: audioMetadata?.contentType || null,
                durationMs: audioMetadata?.durationMs || null,
                sizeBytes: audioMetadata?.sizeBytes || null,
                md5Hash: audioMetadata?.md5Hash || null,
                generation: audioMetadata?.generation || null,
                validatedAt: audioMetadata?.validatedAt || null,
                completedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_COMPLETED'
            });
            await appendAttemptEvent(db, {
                eventType: 'feedback.complete',
                routeName,
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_COMPLETED',
                meta: {
                    visibility,
                    hasAudio: !!audioMetadata
                }
            });

            return sendSuccess(res, { feedbackId }, 'Feedback saved.');
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                feedbackId: cleanString(req.params?.feedbackId, 128),
                resultCode: 'FEEDBACK_COMPLETE_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'FEEDBACK_COMPLETE_ERROR', 'Failed to save feedback.', error?.message || error);
        }
    });

    router.get('/:attemptId/feedback', async (req, res) => {
        const routeName = 'GET /api/practice-attempts/:attemptId/feedback';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = attemptSnap.data() || {};

            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);

            const snap = await db.collection(SPEAKING_ATTEMPTS)
                .doc(attemptId)
                .collection('feedback')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .get();

            const rows = snap.docs.map((doc) => ({ doc, data: doc.data() || {} }));
            const bucket = await getStorageBucket();
            const urls = await mapWithConcurrency(rows, 6, async (row) => {
                const path = cleanString(row.data.audioPath, 1024);
                if (!path || String(row.data.status || '') !== 'completed') return null;
                return signReadUrl(bucket, path, { expiresMinutes: DEFAULT_SIGNED_READ_URL_MINUTES }).catch(() => null);
            });

            const feedback = rows.map((row, index) => ({
                feedbackId: row.doc.id,
                authorUid: row.data.authorUid || null,
                status: row.data.status || null,
                visibility: row.data.visibility || 'private',
                text: row.data.text || null,
                createdAt: row.data.createdAt || null,
                completedAt: row.data.completedAt || null,
                updatedAt: row.data.updatedAt || null,
                audio: {
                    url: urls[index] || null,
                    contentType: row.data.contentType || null,
                    durationMs: row.data.durationMs || null,
                    sizeBytes: row.data.sizeBytes || null
                }
            }));

            logRouteEvent(routeName, { uid, attemptId, resultCode: 'OK', feedbackCount: feedback.length });
            return sendSuccess(res, { feedback });
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                resultCode: 'FEEDBACK_LIST_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'FEEDBACK_LIST_ERROR', 'Failed to list feedback.', error?.message || error);
        }
    });

    router.patch('/:attemptId/feedback/:feedbackId', async (req, res) => {
        const routeName = 'PATCH /api/practice-attempts/:attemptId/feedback/:feedbackId';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            const feedbackId = cleanString(req.params?.feedbackId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId || !feedbackId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId or feedbackId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            if (!reviewer.isReviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc(feedbackId);
            const snap = await feedbackRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Feedback not found.');
            const feedback = snap.data() || {};

            const isAuthor = cleanString(feedback.authorUid, 128) === uid;
            if (!isAuthor && !reviewer.isAdmin) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the author or admin can edit feedback.');
            }

            const patch = {};
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'visibility')) {
                patch.visibility = sanitizeVisibility(req.body?.visibility, sanitizeVisibility(feedback.visibility, 'private'));
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'text')) {
                patch.text = cleanString(req.body?.text, 4000) || null;
            }
            if (!Object.keys(patch).length) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'No editable fields provided.');
            }

            const nextText = Object.prototype.hasOwnProperty.call(patch, 'text') ? patch.text : (cleanString(feedback.text, 4000) || null);
            const hasAudio = !!cleanString(feedback.audioPath, 1024);
            if (!nextText && !hasAudio) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Feedback must include text or audio.');
            }

            patch.updatedAt = FieldValue.serverTimestamp();
            await feedbackRef.set(patch, { merge: true });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_EDITED'
            });
            await appendAttemptEvent(db, {
                eventType: 'feedback.edit',
                routeName,
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_EDITED'
            });

            return sendSuccess(res, { feedbackId }, 'Feedback updated.');
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                feedbackId: cleanString(req.params?.feedbackId, 128),
                resultCode: 'FEEDBACK_EDIT_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'FEEDBACK_EDIT_ERROR', 'Failed to update feedback.', error?.message || error);
        }
    });

    router.delete('/:attemptId/feedback/:feedbackId', async (req, res) => {
        const routeName = 'DELETE /api/practice-attempts/:attemptId/feedback/:feedbackId';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            const feedbackId = cleanString(req.params?.feedbackId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId || !feedbackId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId or feedbackId.');

            const reviewer = await resolveReviewerAccess(db, req.user);
            if (!reviewer.isReviewer) return sendError(res, 403, 'FORBIDDEN', 'Teacher/admin access required.');

            const feedbackRef = db.collection(SPEAKING_ATTEMPTS).doc(attemptId).collection('feedback').doc(feedbackId);
            const snap = await feedbackRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Feedback not found.');
            const feedback = snap.data() || {};

            const isAuthor = cleanString(feedback.authorUid, 128) === uid;
            if (!isAuthor && !reviewer.isAdmin) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the author or admin can delete feedback.');
            }

            const audioPath = cleanString(feedback.audioPath, 1024);
            if (audioPath) {
                const bucket = await getStorageBucket();
                await safeDeleteFile(bucket, audioPath).catch(() => null);
            }
            await feedbackRef.delete();

            logRouteEvent(routeName, {
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_DELETED'
            });
            await appendAttemptEvent(db, {
                eventType: 'feedback.delete',
                routeName,
                uid,
                attemptId,
                feedbackId,
                resultCode: 'FEEDBACK_DELETED'
            });

            return sendSuccess(res, { feedbackId }, 'Feedback deleted.');
        } catch (error) {
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.params?.attemptId, 128),
                feedbackId: cleanString(req.params?.feedbackId, 128),
                resultCode: 'FEEDBACK_DELETE_ERROR',
                error: String(error?.message || error)
            });
            return sendError(res, 500, 'FEEDBACK_DELETE_ERROR', 'Failed to delete feedback.', error?.message || error);
        }
    });

    return router;
};
