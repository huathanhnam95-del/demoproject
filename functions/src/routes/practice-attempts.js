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

const ATTEMPTS_COLLECTION = 'speakingAttempts';
const SPEAKING_ATTEMPTS = ATTEMPTS_COLLECTION;
const SPEAKING_ATTEMPT_SHARES = 'speakingAttemptShares';
const SPEAKING_ATTEMPT_COUNTERS = 'speakingAttemptCounters';
const SPEAKING_ATTEMPT_EVENTS = 'speakingAttemptEvents';
const ARCHIVE_SCHEMA_VERSION = 2;
const ARCHIVE_TOTAL_JSON_LIMIT = 700 * 1024;
const ARCHIVE_STRING_LIMIT = 12000;
const ARCHIVE_ARRAY_LIMIT = 120;
const ARCHIVE_OBJECT_KEY_LIMIT = 120;
const ARCHIVE_ADVICE_LIMIT = 8000;
const ARCHIVE_SLOT_MAX_BYTES = 50 * 1024 * 1024;

const PTE_MODE_META = Object.freeze({
    'read-aloud': { canonicalMode: 'read_aloud', label: 'Read Aloud', skill: 'speaking', mediaKind: 'audio' },
    speak: { canonicalMode: 'repeat_sentence', label: 'Repeat Sentence', skill: 'speaking', mediaKind: 'audio' },
    'describe-image': { canonicalMode: 'describe_image', label: 'Describe Image', skill: 'speaking', mediaKind: 'audio' },
    notes: { canonicalMode: 'retell_lecture', label: 'Retell Lecture', skill: 'speaking', mediaKind: 'audio' },
    asq: { canonicalMode: 'answer_short_question', label: 'Answer Short Question', skill: 'speaking', mediaKind: 'audio' },
    sgd: { canonicalMode: 'summarize_group_discussion', label: 'Summarize Group Discussion', skill: 'speaking', mediaKind: 'audio' },
    essay: { canonicalMode: 'write_essay', label: 'Write Essay', skill: 'writing' },
    swt: { canonicalMode: 'summarize_written_text', label: 'Summarize Written Text', skill: 'writing' },
    sst: { canonicalMode: 'summarize_spoken_text', label: 'Summarize Spoken Text', skill: 'listening' },
    type: { canonicalMode: 'write_from_dictation', label: 'Write From Dictation', skill: 'listening' },
    rfib: { canonicalMode: 'reading_fill_in_the_blanks', label: 'Reading Fill in the Blanks', skill: 'reading' },
    dd: { canonicalMode: 'drag_and_drop_fill_blanks', label: 'Drag and Drop Fill Blanks', skill: 'reading' },
    rmcsa: { canonicalMode: 'reading_multiple_choice_single_answer', label: 'Reading Multiple Choice Single Answer', skill: 'reading' },
    rmcma: { canonicalMode: 'reading_multiple_choice_multiple_answers', label: 'Reading Multiple Choice Multiple Answers', skill: 'reading' },
    rop: { canonicalMode: 'reorder_paragraphs', label: 'Re-order Paragraphs', skill: 'reading' },
    extended: { canonicalMode: 'listening_fill_in_the_blanks', label: 'Listening Fill in the Blanks', skill: 'listening' },
    rts: { canonicalMode: 'respond_to_situation', label: 'Respond to a Situation', skill: 'speaking', mediaKind: 'audio' },
    lmcma: { canonicalMode: 'listening_multiple_choice_multiple_answers', label: 'Listening Multiple Choice Multiple Answers', skill: 'listening' },
    lmcsa: { canonicalMode: 'listening_multiple_choice_single_answer', label: 'Listening Multiple Choice Single Answer', skill: 'listening' },
    hcs: { canonicalMode: 'highlight_correct_summary', label: 'Highlight Correct Summary', skill: 'listening' },
    smw: { canonicalMode: 'select_missing_word', label: 'Select Missing Word', skill: 'listening' },
    hiw: { canonicalMode: 'highlight_incorrect_words', label: 'Highlight Incorrect Words', skill: 'listening' }
});

const PTE_MODE_ALIASES = Object.freeze({
    readaloud: 'read-aloud',
    read_aloud: 'read-aloud',
    'read-aloud': 'read-aloud',
    repeatsentence: 'speak',
    repeat_sentence: 'speak',
    'repeat-sentence': 'speak',
    retelllecture: 'notes',
    retell_lecture: 'notes',
    'retell-lecture': 'notes',
    answer_short_question: 'asq',
    describe_image: 'describe-image',
    summarize_group_discussion: 'sgd',
    write_essay: 'essay',
    summarize_written_text: 'swt',
    summarize_spoken_text: 'sst',
    write_from_dictation: 'type',
    reading_fill_in_the_blanks: 'rfib',
    drag_and_drop_fill_blanks: 'dd',
    reading_multiple_choice_single_answer: 'rmcsa',
    reading_multiple_choice_multiple_answers: 'rmcma',
    reorder_paragraphs: 'rop',
    listening_fill_in_the_blanks: 'extended',
    respond_to_situation: 'rts',
    listening_multiple_choice_multiple_answers: 'lmcma',
    listening_multiple_choice_single_answer: 'lmcsa',
    highlight_correct_summary: 'hcs',
    select_missing_word: 'smw',
    highlight_incorrect_words: 'hiw'
});

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

function cleanFieldName(value, fallback) {
    const text = cleanString(value, 80);
    if (!text) return fallback;
    const safe = text.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    if (safe === '__proto__' || safe === 'constructor' || safe === 'prototype') return fallback;
    return safe || fallback;
}

function normalizePteModeKey(input) {
    const raw = cleanString(input, 80);
    if (!raw) return null;
    const lowered = raw.toLowerCase();
    const compact = lowered.replace(/[\s-]+/g, '_');
    return PTE_MODE_ALIASES[lowered]
        || PTE_MODE_ALIASES[compact]
        || (PTE_MODE_META[lowered] ? lowered : null)
        || (PTE_MODE_META[compact] ? compact : null);
}

function resolvePteModeMeta(input) {
    const modeId = normalizePteModeKey(input);
    const meta = modeId ? PTE_MODE_META[modeId] : null;
    if (!meta) return null;
    return {
        modeId,
        canonicalMode: meta.canonicalMode,
        label: meta.label,
        skill: meta.skill,
        mediaKind: meta.mediaKind || null
    };
}

function assertPteArchiveRequest(body = {}) {
    const requestedScope = cleanString(body?.practiceScope, 32);
    if (requestedScope !== 'pte') {
        throw createHttpError(400, 'INVALID_PRACTICE_SCOPE', 'PTE attempt archives only accept practiceScope "pte".');
    }
    const modeMeta = resolvePteModeMeta(body?.practiceMode || body?.mode || body?.canonicalMode);
    if (!modeMeta) {
        throw createHttpError(400, 'INVALID_PRACTICE_MODE', 'Practice mode is not supported by the PTE attempt archive.');
    }
    return modeMeta;
}

function getArchiveJsonSize(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (_) {
        return ARCHIVE_TOTAL_JSON_LIMIT + 1;
    }
}

function shouldUseAdviceLimit(path) {
    return /advice|feedback|explanation|analysis|comment/i.test(String(path || ''));
}

function sanitizeArchiveSnapshot(input, options = {}) {
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;

    function visit(value, path, depth) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'string') {
            const limit = shouldUseAdviceLimit(path) ? ARCHIVE_ADVICE_LIMIT : ARCHIVE_STRING_LIMIT;
            const truncated = value.length > limit;
            if (!truncated) return value;
            return {
                value: value.slice(0, limit),
                truncated: true,
                originalLength: value.length
            };
        }
        if (value instanceof Date) return value.toISOString();
        if (typeof value?.toDate === 'function') {
            const date = value.toDate();
            return date instanceof Date ? date.toISOString() : null;
        }
        if (depth >= maxDepth) return { truncated: true, reason: 'maxDepth' };
        if (Array.isArray(value)) {
            const out = value.slice(0, ARCHIVE_ARRAY_LIMIT).map((item, index) => visit(item, `${path}.${index}`, depth + 1));
            if (value.length > ARCHIVE_ARRAY_LIMIT) {
                out.push({ truncated: true, omittedCount: value.length - ARCHIVE_ARRAY_LIMIT });
            }
            return out;
        }
        if (!isPlainObject(value)) return null;

        const out = {};
        const entries = Object.entries(value).slice(0, ARCHIVE_OBJECT_KEY_LIMIT);
        entries.forEach(([key, child]) => {
            const cleanKey = cleanFieldName(key, null);
            if (!cleanKey) return;
            out[cleanKey] = visit(child, `${path}.${cleanKey}`, depth + 1);
        });
        if (Object.keys(value).length > ARCHIVE_OBJECT_KEY_LIMIT) {
            out._truncated = {
                truncated: true,
                omittedKeyCount: Object.keys(value).length - ARCHIVE_OBJECT_KEY_LIMIT
            };
        }
        return out;
    }

    let sanitized = visit(input, options.rootName || 'snapshot', 0);
    if (getArchiveJsonSize(sanitized) <= ARCHIVE_TOTAL_JSON_LIMIT) return sanitized;
    sanitized = {
        truncated: true,
        reason: 'documentJsonLimit',
        summary: visit(options.summary || null, 'summary', 0)
    };
    return sanitized;
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

function buildAttemptMediaPath(uid, attemptId, slotFile) {
    return `practice-attempts/${uid}/${attemptId}/${slotFile}`;
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

function isAllowedWebmContentType(contentType) {
    const lowered = String(contentType || '').trim().toLowerCase();
    if (!lowered) return false;
    return lowered === 'audio/webm'
        || lowered === 'video/webm'
        || lowered.includes('webm');
}

function isAllowedArchiveMediaContentType(contentType) {
    return isAllowedWavContentType(contentType) || isAllowedWebmContentType(contentType);
}

function inferMediaExtension(contentType, fallback = 'webm') {
    if (isAllowedWavContentType(contentType)) return 'wav';
    if (isAllowedWebmContentType(contentType)) return 'webm';
    return fallback;
}

function sanitizeMediaSlotFile(value, contentType, index = 0) {
    const ext = inferMediaExtension(contentType, 'webm');
    const raw = cleanString(value, 128) || `student-${index + 1}.${ext}`;
    const normalized = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
    const safe = normalized.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!safe) return `student-${index + 1}.${ext}`;
    if (!/\.(wav|webm)$/.test(safe)) return `${safe}.${ext}`;
    return safe;
}

function sanitizeMediaSlots(inputSlots, { uid, attemptId } = {}) {
    const list = Array.isArray(inputSlots)
        ? inputSlots
        : (isPlainObject(inputSlots) ? Object.entries(inputSlots).map(([slotFile, data]) => ({ slotFile, ...(isPlainObject(data) ? data : {}) })) : []);
    const out = {};
    list.slice(0, 12).forEach((slot, index) => {
        if (!isPlainObject(slot)) return;
        const contentType = cleanString(slot.contentType, 80) || 'audio/webm';
        if (!isAllowedArchiveMediaContentType(contentType)) return;
        const slotFile = sanitizeMediaSlotFile(slot.slotFile || slot.fileName || slot.name, contentType, index);
        const storagePath = buildAttemptMediaPath(uid, attemptId, slotFile);
        const clientReportedDurationMs = toFiniteNumber(slot.clientReportedDurationMs ?? slot.durationMs, null);
        out[slotFile] = {
            slotFile,
            slot: cleanFieldName(slot.slot || slot.kind || 'student', 'student'),
            label: cleanString(slot.label, 120) || 'Student recording',
            storagePath,
            contentType: cleanString(contentType, 80),
            status: 'awaiting_upload',
            sizeBytes: null,
            durationMs: null,
            clientReportedDurationMs: Number.isFinite(clientReportedDurationMs) ? Math.max(0, Math.round(clientReportedDurationMs)) : null,
            durationSource: null,
            md5Hash: null,
            generation: null,
            validatedAt: null
        };
    });
    return out;
}

function buildPreparedMediaSlots(inputSlots, { uid, attemptId, modeMeta } = {}) {
    const provided = sanitizeMediaSlots(inputSlots, { uid, attemptId });
    if (Object.keys(provided).length) return provided;
    if (!modeMeta?.mediaKind) return {};
    const defaultContentType = modeMeta.modeId === 'read-aloud' ? 'audio/wav' : 'audio/webm';
    const defaultFile = modeMeta.modeId === 'read-aloud' ? 'student.wav' : 'student.webm';
    return sanitizeMediaSlots([{
        slot: 'student',
        label: 'Student recording',
        slotFile: defaultFile,
        contentType: defaultContentType
    }], { uid, attemptId });
}

function normalizeMediaSlotsForResponse(mediaSlots) {
    if (!isPlainObject(mediaSlots)) return [];
    return Object.values(mediaSlots).map((slot) => ({
        slotFile: slot.slotFile || null,
        slot: slot.slot || null,
        label: slot.label || null,
        path: slot.storagePath || null,
        storagePath: slot.storagePath || null,
        contentType: slot.contentType || null,
        status: slot.status || null,
        clientReportedDurationMs: slot.clientReportedDurationMs || null,
        sizeBytes: slot.sizeBytes || null,
        durationMs: slot.durationMs || null,
        durationSource: slot.durationSource || null
    }));
}

function buildArchiveSnapshotsFromBody(body = {}) {
    return {
        promptSnapshot: sanitizeArchiveSnapshot(body.promptSnapshot || body.prompt || null, { rootName: 'promptSnapshot' }),
        responseSnapshot: sanitizeArchiveSnapshot(body.responseSnapshot || body.response || null, { rootName: 'responseSnapshot' }),
        answerSnapshot: sanitizeArchiveSnapshot(body.answerSnapshot || body.answers || body.keyedAnswerData || null, { rootName: 'answerSnapshot' }),
        resultSnapshot: sanitizeArchiveSnapshot(body.resultSnapshot || body.result || body.score || null, { rootName: 'resultSnapshot' }),
        timingSnapshot: sanitizeArchiveSnapshot(body.timingSnapshot || body.timing || null, { rootName: 'timingSnapshot' }),
        scoringSnapshot: sanitizeArchiveSnapshot(body.scoringSnapshot || body.scoring || null, { rootName: 'scoringSnapshot' })
    };
}

async function validatePreparedMediaSlots(bucket, slots, constraints) {
    const mediaSlots = isPlainObject(slots) ? { ...slots } : {};
    const media = [];
    const entries = Object.entries(mediaSlots);
    for (const [slotFile, slot] of entries) {
        const storagePath = cleanString(slot?.storagePath, 1024);
        if (!storagePath) continue;
        const validation = await validateAttemptMediaUploadFromFile(bucket.file(storagePath), {
            maxBytes: Math.min(ARCHIVE_SLOT_MAX_BYTES, constraints?.maxUploadBytes || ARCHIVE_SLOT_MAX_BYTES),
            maxDurationMs: constraints?.hardMaxMs || null,
            clientReportedDurationMs: slot?.clientReportedDurationMs
        });
        if (!validation.ok) {
            throw createHttpError(
                validation.status || 400,
                validation.code || 'INVALID_MEDIA',
                validation.message || 'Uploaded media is invalid.',
                validation.details || null
            );
        }
        const nextSlot = {
            ...slot,
            status: 'uploaded',
            contentType: validation.metadata.contentType,
            sizeBytes: validation.metadata.sizeBytes,
            durationMs: validation.metadata.durationMs,
            clientReportedDurationMs: validation.metadata.clientReportedDurationMs ?? slot?.clientReportedDurationMs ?? null,
            durationSource: validation.metadata.durationSource,
            md5Hash: validation.metadata.md5Hash,
            generation: validation.metadata.generation,
            validatedAt: validation.metadata.validatedAt
        };
        mediaSlots[slotFile] = nextSlot;
        media.push({
            slotFile,
            slot: nextSlot.slot || 'student',
            label: nextSlot.label || null,
            storagePath,
            contentType: nextSlot.contentType,
            sizeBytes: nextSlot.sizeBytes,
            durationMs: nextSlot.durationMs,
            clientReportedDurationMs: nextSlot.clientReportedDurationMs || null,
            durationSource: nextSlot.durationSource,
            validatedAt: nextSlot.validatedAt
        });
    }
    return { mediaSlots, media };
}

function sanitizePromptSnapshot(input) {
    const prompt = sanitizeArchiveSnapshot(isPlainObject(input) ? input : {}, { rootName: 'promptSnapshot' });
    return {
        promptId: cleanString(prompt.promptId, 128),
        title: cleanString(prompt.title, 200),
        text: cleanString(prompt.text, 4000),
        source: cleanString(prompt.source, 200),
        assetPath: cleanString(prompt.assetPath || prompt.sourceAssetPath, 1024),
        sourceAssetPaths: Array.isArray(prompt.sourceAssetPaths)
            ? prompt.sourceAssetPaths.map((item) => cleanString(item, 1024)).filter(Boolean).slice(0, 20)
            : [],
        data: prompt
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

async function signMediaSlots(bucket, mediaSlots, constraints) {
    const slots = normalizeMediaSlotsForResponse(mediaSlots);
    const pairs = await mapWithConcurrency(slots, 6, async (slot) => {
        if (!slot.storagePath) return [slot.slotFile, null];
        const url = await signReadUrl(bucket, slot.storagePath, {
            expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
        }).catch(() => null);
        return [slot.slotFile, url];
    });
    return Object.fromEntries(pairs.filter(([slotFile]) => !!slotFile));
}

function createHttpError(status, code, message, details) {
    const err = new Error(message || 'Request failed');
    err.status = status;
    err.code = code || 'REQUEST_FAILED';
    err.details = details || null;
    return err;
}

function buildAccessSnapshot(resolved, now) {
    const linkedStudentIds = Array.isArray(resolved?.linkedStudentIds)
        ? resolved.linkedStudentIds.map((id) => cleanString(id, 128)).filter(Boolean)
        : [];
    const studentId = cleanString(resolved?.studentId, 128);
    if (studentId && !linkedStudentIds.includes(studentId)) linkedStudentIds.unshift(studentId);
    return {
        resolvedAt: now,
        effectiveStatus: resolved?.effectiveStatus || 'nonstudent',
        source: resolved?.source || 'none',
        studentId: studentId || null,
        linkedStudentIds,
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

async function appendAttemptEvent(db, event, serverTimestamp = () => FieldValue.serverTimestamp()) {
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
            createdAt: serverTimestamp()
        });
    } catch (error) {
        logRouteEvent('attempt-event-write-failed', {
            resultCode: 'AUDIT_WRITE_FAILED',
            error: String(error?.message || error)
        });
    }
}

function addStudentIdFromValue(out, value) {
    const id = cleanString(value, 128);
    if (id) out.add(id);
}

function collectStudentIdsFromContainer(out, value) {
    if (!value) return;
    if (typeof value === 'string') {
        addStudentIdFromValue(out, value);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectStudentIdsFromContainer(out, item));
        return;
    }
    if (!isPlainObject(value)) return;
    addStudentIdFromValue(out, value.studentId || value.crmStudentId || value.id || value.uid);
    ['studentIds', 'crmStudentIds', 'linkedStudentIds', 'memberStudentIds', 'students', 'members', 'studentRefs'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(value, key)) collectStudentIdsFromContainer(out, value[key]);
    });
}

async function resolveTeacherStudentIds(db, uid) {
    const allowed = new Set();
    if (!uid) return allowed;

    const classroomQueries = [
        db.collection('crmClassrooms').where('primaryTeacherUid', '==', uid).limit(200).get(),
        db.collection('crmClassrooms').where('teacherUid', '==', uid).limit(200).get(),
        db.collection('crmClassrooms').where('teacherUids', 'array-contains', uid).limit(200).get()
    ];
    const studentQueries = [
        db.collection('crmStudents').where('teacherUid', '==', uid).limit(200).get(),
        db.collection('crmStudents').where('teacherUids', 'array-contains', uid).limit(200).get(),
        db.collection('crmStudents').where('assignedTeacherUid', '==', uid).limit(200).get()
    ];

    const snaps = await Promise.allSettled([...classroomQueries, ...studentQueries]);
    snaps.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        const docs = Array.isArray(result.value?.docs) ? result.value.docs : [];
        docs.forEach((doc) => {
            addStudentIdFromValue(allowed, doc.id);
            collectStudentIdsFromContainer(allowed, doc.data() || {});
        });
    });

    return allowed;
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
    const allowedStudentIds = isAdmin ? null : (isTeacher ? await resolveTeacherStudentIds(db, uid) : new Set());
    return {
        uid,
        isAdmin,
        isTeacher,
        isReviewer: isAdmin || isTeacher,
        allowedStudentIds
    };
}

function ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer }) {
    if (!attempt) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Attempt not found.' };
    if (String(attempt.ownerUid || '') === String(uid || '')) return { ok: true };
    if (reviewer?.isAdmin) return { ok: true };
    if (reviewer?.isTeacher && reviewer.allowedStudentIds instanceof Set) {
        const attemptStudentIds = new Set();
        addStudentIdFromValue(attemptStudentIds, attempt.crmStudentId);
        collectStudentIdsFromContainer(attemptStudentIds, attempt.crmStudentIds || attempt.accessSnapshot?.linkedStudentIds || attempt.accessSnapshot?.studentId);
        for (const studentId of attemptStudentIds) {
            if (reviewer.allowedStudentIds.has(studentId)) return { ok: true };
        }
    }
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

async function validateAttemptMediaUploadFromFile(file, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : ARCHIVE_SLOT_MAX_BYTES;
    const maxDurationMs = Number.isFinite(options.maxDurationMs) ? options.maxDurationMs : null;

    const [exists] = await file.exists();
    if (!exists) {
        return {
            ok: false,
            status: 400,
            code: 'UPLOAD_MISSING',
            message: 'Media upload not found.'
        };
    }

    const [meta] = await file.getMetadata().catch(() => [null]);
    const contentType = String(meta?.contentType || '').trim().toLowerCase();
    const sizeBytes = Number(meta?.size || 0);
    if (!contentType || !isAllowedArchiveMediaContentType(contentType)) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_MEDIA',
            message: 'Uploaded media must be WAV or WebM.'
        };
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_MEDIA',
            message: 'Uploaded media is empty.'
        };
    }
    if (sizeBytes > maxBytes) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_MEDIA',
            message: 'Uploaded media is too large.',
            details: { maxUploadBytes: maxBytes, sizeBytes }
        };
    }

    if (isAllowedWavContentType(contentType)) {
        const wavValidation = await validateWavUploadFromFile(file, { maxBytes, maxDurationMs });
        if (!wavValidation.ok) return wavValidation;
        return {
            ok: true,
            metadata: {
                ...wavValidation.metadata,
                durationSource: 'wav_metadata',
                clientReportedDurationMs: null
            }
        };
    }

    const clientReportedDurationMs = toFiniteNumber(options.clientReportedDurationMs, null);
    if (!Number.isFinite(clientReportedDurationMs) || clientReportedDurationMs <= 0) {
        return {
            ok: false,
            status: 400,
            code: 'MEDIA_DURATION_REQUIRED',
            message: 'WebM uploads require client-reported duration metadata.'
        };
    }
    if (Number.isFinite(maxDurationMs) && Number.isFinite(clientReportedDurationMs) && clientReportedDurationMs > maxDurationMs) {
        return {
            ok: false,
            status: 400,
            code: 'AUDIO_DURATION_EXCEEDED',
            message: 'Uploaded audio exceeds the allowed duration.',
            details: {
                durationMs: clientReportedDurationMs,
                maxDurationMs,
                durationSource: 'client_reported'
            }
        };
    }

    return {
        ok: true,
        metadata: {
            sizeBytes,
            contentType,
            durationMs: Number.isFinite(clientReportedDurationMs) ? Math.max(0, Math.round(clientReportedDurationMs)) : null,
            clientReportedDurationMs: Number.isFinite(clientReportedDurationMs) ? Math.max(0, Math.round(clientReportedDurationMs)) : null,
            durationSource: 'client_reported',
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

function summarizeAttemptForList(doc, data, signedUrl, mediaUrls = {}) {
    return {
        attemptId: doc.id,
        ownerUid: data.ownerUid || null,
        schemaVersion: data.schemaVersion || 1,
        practiceScope: data.practiceScope || null,
        practiceMode: data.practiceMode || null,
        canonicalMode: data.canonicalMode || null,
        modeLabel: data.modeLabel || null,
        skill: data.skill || null,
        crmStudentId: data.crmStudentId || null,
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
        },
        media: normalizeMediaSlotsForResponse(data.mediaSlots).map((slot) => ({
            ...slot,
            url: mediaUrls[slot.slotFile] || null
        })),
        score: data.resultSnapshot?.score ?? data.score ?? null,
        promptId: data.promptSnapshot?.promptId || data.promptSnapshot?.id || null,
        responseSummary: data.responseSnapshot?.text 
            || data.responseSnapshot?.userAnswer 
            || (Array.isArray(data.responseSnapshot?.selectedOptions) 
                ? data.responseSnapshot.selectedOptions.map(o => o.text || o).join(', ') 
                : null) 
            || (Array.isArray(data.responseSnapshot?.order) 
                ? data.responseSnapshot.order.join(' → ') 
                : null)
            || null
    };
}

module.exports = function createPracticeAttemptsRouter(deps) {
    const { db, sendSuccess, sendError, getStorageBucket } = deps;
    const serverTimestamp = typeof deps.serverTimestamp === 'function'
        ? deps.serverTimestamp
        : () => FieldValue.serverTimestamp();
    const router = express.Router();

    router.post('/prepare', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/prepare';
        try {
            const uid = cleanString(req.user?.uid, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const prepareBody = {
                ...req.body,
                practiceScope: cleanString(req.body?.practiceScope, 32) || 'pte'
            };
            let modeMeta;
            try {
                modeMeta = assertPteArchiveRequest(prepareBody);
            } catch (error) {
                return sendError(res, Number(error?.status || 400), cleanString(error?.code, 64) || 'VALIDATION_ERROR', error?.message || 'Invalid practice attempt request.');
            }
            const constraints = getModeConstraints(modeMeta.canonicalMode);

            const requestedAttemptId = cleanString(req.body?.attemptId, 128);
            const promptSnapshot = sanitizePromptSnapshot(req.body?.promptSnapshot);
            const requestedMediaSlots = req.body?.mediaSlots || req.body?.media;
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

                    const existingMode = normalizePteModeKey(existing.practiceMode) || normalizePteModeKey(existing.canonicalMode);
                    if (existingMode !== modeMeta.modeId) {
                        throw createHttpError(409, 'ATTEMPT_ID_MODE_MISMATCH', 'attemptId is bound to a different practiceMode.');
                    }

                    const expectedAudioPath = buildAttemptAudioPath(uid, attemptId);
                    const existingStatus = String(existing.status || '').trim();
                    const existingAudioPath = cleanString(existing.audio?.studentPath, 1024);
                    const nextMediaSlots = buildPreparedMediaSlots(requestedMediaSlots, { uid, attemptId, modeMeta });
                    const hasExistingMediaSlots = Object.keys(existing.mediaSlots || {}).length > 0;
                    if (existingStatus === 'awaiting_upload' && existingAudioPath !== expectedAudioPath) {
                        // Keep Storage rules deterministic: prepared attempts must always use the canonical path.
                        tx.set(attemptRef, {
                            audio: {
                                studentPath: expectedAudioPath,
                                contentType: 'audio/wav'
                            },
                            mediaSlots: Object.keys(nextMediaSlots).length ? nextMediaSlots : (existing.mediaSlots || {}),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    } else if (!hasExistingMediaSlots && Object.keys(nextMediaSlots).length) {
                        tx.set(attemptRef, {
                            mediaSlots: nextMediaSlots,
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }

                    if (!isPlainObject(existing.constraintSnapshot)) {
                        tx.set(attemptRef, {
                            constraintSnapshot: toConstraintSnapshot(constraints, now),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }

                    return {
                        created: false,
                        attemptId,
                        status: existingStatus || 'awaiting_upload',
                        audioPath: (existingStatus === 'awaiting_upload' ? expectedAudioPath : (existingAudioPath || expectedAudioPath)),
                        mediaSlots: Object.keys(existing.mediaSlots || {}).length ? existing.mediaSlots : nextMediaSlots,
                        constraints: resolveConstraintSnapshot(existing) || constraints
                    };
                }

                const audioPath = buildAttemptAudioPath(uid, attemptId);
                const mediaSlots = buildPreparedMediaSlots(requestedMediaSlots, { uid, attemptId, modeMeta });
                tx.set(attemptRef, {
                    attemptId,
                    schemaVersion: 2,
                    ownerUid: uid,
                    practiceScope: 'pte',
                    practiceMode: modeMeta.modeId,
                    canonicalMode: modeMeta.canonicalMode,
                    modeLabel: modeMeta.label,
                    skill: modeMeta.skill,
                    promptSnapshot,
                    status: 'awaiting_upload',
                    createdAt: serverTimestamp(),
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
                    mediaSlots,
                    media: [],
                    constraintSnapshot: toConstraintSnapshot(constraints, now),
                    retentionState: null,
                    deleteAfterAt: null,
                    bookmark: {
                        active: false,
                        bookmarkedAt: null,
                        lastChangedAt: serverTimestamp()
                    },
                    accessSnapshot: null,
                    promotion: null,
                    shareId: null,
                    deletionState: null,
                    updatedAt: serverTimestamp()
                });

                return {
                    created: true,
                    attemptId,
                    status: 'awaiting_upload',
                    audioPath,
                    mediaSlots,
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
                mediaSlots: normalizeMediaSlotsForResponse(txResult.mediaSlots),
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
            }, serverTimestamp);

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

    router.post('/save', async (req, res) => {
        const routeName = 'POST /api/practice-attempts/save';
        try {
            const uid = cleanString(req.user?.uid, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');

            const modeMeta = assertPteArchiveRequest(req.body || {});
            if (req.body?.invalidated === true && req.body?.archiveInvalidated !== true) {
                return sendSuccess(res, {
                    archived: false,
                    reason: 'invalidated'
                }, 'Invalidated attempt was not archived.');
            }

             const constraints = getModeConstraints(modeMeta.canonicalMode);
            const requestedAttemptId = cleanString(req.body?.attemptId, 128);
            const idempotencyKey = cleanString(req.body?.idempotencyKey, 128);
            let attemptId = requestedAttemptId;
            let existingDoc = null;

            if (idempotencyKey) {
                const dupSnap = await db.collection(ATTEMPTS_COLLECTION)
                    .where('ownerUid', '==', uid)
                    .where('idempotencyKey', '==', idempotencyKey)
                    .limit(1)
                    .get();
                if (!dupSnap.empty) {
                    existingDoc = dupSnap.docs[0].data();
                    attemptId = dupSnap.docs[0].id;
                }
            }

            if (!attemptId) {
                attemptId = db.collection(ATTEMPTS_COLLECTION).doc().id;
            }
            const attemptRef = db.collection(ATTEMPTS_COLLECTION).doc(attemptId);
            const firstSnap = existingDoc ? null : await attemptRef.get();
            const existing = existingDoc || (firstSnap?.exists ? (firstSnap.data() || {}) : null);

            if (existing) {
                if (cleanString(existing.ownerUid, 128) !== uid) {
                    return sendError(res, 409, 'ATTEMPT_ID_CONFLICT', 'attemptId belongs to another user.');
                }
                const existingMode = normalizePteModeKey(existing.practiceMode) || normalizePteModeKey(existing.canonicalMode);
                if (existingMode && existingMode !== modeMeta.modeId) {
                    return sendError(res, 409, 'ATTEMPT_ID_MODE_MISMATCH', 'attemptId is bound to a different practiceMode.');
                }
            }

            const bodySlotsProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'mediaSlots')
                || Object.prototype.hasOwnProperty.call(req.body || {}, 'media');
            const nextSlots = bodySlotsProvided
                ? buildPreparedMediaSlots(req.body?.mediaSlots || req.body?.media, { uid, attemptId, modeMeta })
                : (isPlainObject(existing?.mediaSlots) ? existing.mediaSlots : {});

            let validatedMedia = { mediaSlots: nextSlots, media: Array.isArray(existing?.media) ? existing.media : [] };
            if (Object.keys(nextSlots).length) {
                const bucket = await getStorageBucket();
                validatedMedia = await validatePreparedMediaSlots(bucket, nextSlots, constraints);
            }

            const now = new Date();
            const resolved = await resolvePracticeAccessForUid(db, uid, { now });
            const accessSnapshot = buildAccessSnapshot(resolved, now);
            const retentionState = resolved?.effectiveStatus === 'student' ? RETENTION.student : RETENTION.nonstudentTtl;
            const deleteAfterAt = resolved?.effectiveStatus === 'student'
                ? null
                : addDays(now, NON_STUDENT_TTL_DAYS);
            
            let snapshots = buildArchiveSnapshotsFromBody(req.body || {});
            if (getArchiveJsonSize(snapshots) > ARCHIVE_TOTAL_JSON_LIMIT) {
                const keys = ['promptSnapshot', 'responseSnapshot', 'answerSnapshot', 'resultSnapshot', 'timingSnapshot', 'scoringSnapshot'];
                keys.sort((a, b) => getArchiveJsonSize(snapshots[b]) - getArchiveJsonSize(snapshots[a]));
                for (const key of keys) {
                    if (getArchiveJsonSize(snapshots) <= ARCHIVE_TOTAL_JSON_LIMIT) break;
                    if (snapshots[key]) {
                        snapshots[key] = {
                            truncated: true,
                            reason: 'documentJsonLimit'
                        };
                    }
                }
            }

            const payload = {
                attemptId,
                schemaVersion: 2,
                practiceScope: 'pte',
                ownerUid: uid,
                practiceMode: modeMeta.modeId,
                canonicalMode: modeMeta.canonicalMode,
                modeLabel: modeMeta.label,
                skill: modeMeta.skill,
                status: 'submitted',
                submittedAt: existing?.submittedAt || serverTimestamp(),
                promptSnapshot: snapshots.promptSnapshot,
                responseSnapshot: snapshots.responseSnapshot,
                answerSnapshot: snapshots.answerSnapshot,
                resultSnapshot: snapshots.resultSnapshot,
                timingSnapshot: snapshots.timingSnapshot,
                scoringSnapshot: snapshots.scoringSnapshot,
                mediaSlots: validatedMedia.mediaSlots,
                media: validatedMedia.media,
                constraintSnapshot: toConstraintSnapshot(constraints, now),
                retentionState,
                deleteAfterAt,
                accessSnapshot,
                crmStudentId: accessSnapshot.studentId || null,
                crmStudentIds: accessSnapshot.linkedStudentIds || [],
                scoringSource: cleanString(req.body?.scoringSource, 80) || null,
                idempotencyKey: idempotencyKey,
                updatedAt: serverTimestamp()
            };

            if (!existing) {
                payload.createdAt = serverTimestamp();
                payload.bookmark = {
                    active: false,
                    bookmarkedAt: null,
                    lastChangedAt: serverTimestamp()
                };
                payload.shareId = null;
                payload.promotion = null;
                payload.deletionState = null;
            }

            const primaryMedia = validatedMedia.media.find((item) => item.slot === 'student') || validatedMedia.media[0] || null;
            if (primaryMedia) {
                payload.audio = {
                    studentPath: primaryMedia.storagePath,
                    contentType: primaryMedia.contentType,
                    sizeBytes: primaryMedia.sizeBytes,
                    durationMs: primaryMedia.durationMs,
                    clientReportedDurationMs: primaryMedia.clientReportedDurationMs || null,
                    durationSource: primaryMedia.durationSource || null,
                    md5Hash: primaryMedia.md5Hash || null,
                    generation: primaryMedia.generation || null,
                    validatedAt: primaryMedia.validatedAt || null
                };
            } else if (!existing?.audio) {
                payload.audio = {
                    studentPath: null,
                    contentType: null,
                    sizeBytes: null,
                    durationMs: null,
                    md5Hash: null,
                    generation: null,
                    validatedAt: null
                };
            }

            await attemptRef.set(payload, { merge: true });

            logRouteEvent(routeName, {
                uid,
                attemptId,
                resultCode: existing ? 'UPDATED' : 'CREATED',
                practiceMode: modeMeta.modeId
            });
            await appendAttemptEvent(db, {
                eventType: existing ? 'attempt.archive.updated' : 'attempt.archive.created',
                routeName,
                uid,
                attemptId,
                resultCode: existing ? 'UPDATED' : 'CREATED',
                meta: {
                    practiceMode: modeMeta.modeId,
                    hasMedia: validatedMedia.media.length > 0
                }
            }, serverTimestamp);

            return sendSuccess(res, {
                attemptId,
                archived: true,
                alreadySubmitted: String(existing?.status || '') === 'submitted',
                retentionState,
                deleteAfterAt,
                media: normalizeMediaSlotsForResponse(validatedMedia.mediaSlots)
            }, 'Attempt archived.');
        } catch (error) {
            const status = Number(error?.status || 500);
            const code = cleanString(error?.code, 64) || 'SAVE_ATTEMPT_ERROR';
            const message = status >= 500 ? 'Failed to save attempt archive.' : (error?.message || 'Invalid attempt archive request.');
            logRouteEvent(routeName, {
                uid: cleanString(req.user?.uid, 128),
                attemptId: cleanString(req.body?.attemptId, 128),
                resultCode: code,
                error: String(error?.message || error)
            });
            return sendError(res, status, code, message, error?.details || (status >= 500 ? (error?.message || error) : null));
        }
    });

    router.patch('/:attemptId/result', async (req, res) => {
        const routeName = 'PATCH /api/practice-attempts/:attemptId/result';
        try {
            const uid = cleanString(req.user?.uid, 128);
            const attemptId = cleanString(req.params?.attemptId, 128);
            if (!uid) return sendError(res, 401, 'UNAUTHORIZED', 'Missing user identity.');
            if (!attemptId) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing attemptId.');

            const attemptRef = db.collection(ATTEMPTS_COLLECTION).doc(attemptId);
            const snap = await attemptRef.get();
            if (!snap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = snap.data() || {};
            if (cleanString(attempt.ownerUid, 128) !== uid) {
                return sendError(res, 403, 'FORBIDDEN', 'Only the owner can patch this attempt.');
            }
            if (String(attempt.practiceScope || '') !== 'pte') {
                return sendError(res, 400, 'INVALID_PRACTICE_SCOPE', 'Only PTE archive attempts can be patched here.');
            }

            const patch = {
                updatedAt: serverTimestamp()
            };
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'resultSnapshot') || Object.prototype.hasOwnProperty.call(req.body || {}, 'result')) {
                patch.resultSnapshot = sanitizeArchiveSnapshot(req.body.resultSnapshot || req.body.result, { rootName: 'resultSnapshot' });
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'scoringSnapshot') || Object.prototype.hasOwnProperty.call(req.body || {}, 'scoring')) {
                patch.scoringSnapshot = sanitizeArchiveSnapshot(req.body.scoringSnapshot || req.body.scoring, { rootName: 'scoringSnapshot' });
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'responseSnapshot') || Object.prototype.hasOwnProperty.call(req.body || {}, 'response')) {
                patch.responseSnapshot = sanitizeArchiveSnapshot(req.body.responseSnapshot || req.body.response, { rootName: 'responseSnapshot' });
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'answerSnapshot') || Object.prototype.hasOwnProperty.call(req.body || {}, 'answer')) {
                patch.answerSnapshot = sanitizeArchiveSnapshot(req.body.answerSnapshot || req.body.answer, { rootName: 'answerSnapshot' });
            }
            if (Object.keys(patch).length <= 1) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'No patchable archive fields provided.');
            }

            const mergedSnapshots = {
                promptSnapshot: attempt.promptSnapshot || null,
                responseSnapshot: Object.prototype.hasOwnProperty.call(patch, 'responseSnapshot') ? patch.responseSnapshot : (attempt.responseSnapshot || null),
                answerSnapshot: Object.prototype.hasOwnProperty.call(patch, 'answerSnapshot') ? patch.answerSnapshot : (attempt.answerSnapshot || null),
                resultSnapshot: Object.prototype.hasOwnProperty.call(patch, 'resultSnapshot') ? patch.resultSnapshot : (attempt.resultSnapshot || null),
                timingSnapshot: attempt.timingSnapshot || null,
                scoringSnapshot: Object.prototype.hasOwnProperty.call(patch, 'scoringSnapshot') ? patch.scoringSnapshot : (attempt.scoringSnapshot || null)
            };

            if (getArchiveJsonSize(mergedSnapshots) > ARCHIVE_TOTAL_JSON_LIMIT) {
                const keys = ['promptSnapshot', 'responseSnapshot', 'answerSnapshot', 'resultSnapshot', 'timingSnapshot', 'scoringSnapshot'];
                keys.sort((a, b) => getArchiveJsonSize(mergedSnapshots[b]) - getArchiveJsonSize(mergedSnapshots[a]));
                for (const key of keys) {
                    if (getArchiveJsonSize(mergedSnapshots) <= ARCHIVE_TOTAL_JSON_LIMIT) break;
                    if (mergedSnapshots[key]) {
                        mergedSnapshots[key] = {
                            truncated: true,
                            reason: 'documentJsonLimit'
                        };
                    }
                }
                if (Object.prototype.hasOwnProperty.call(patch, 'responseSnapshot')) patch.responseSnapshot = mergedSnapshots.responseSnapshot;
                if (Object.prototype.hasOwnProperty.call(patch, 'answerSnapshot')) patch.answerSnapshot = mergedSnapshots.answerSnapshot;
                if (Object.prototype.hasOwnProperty.call(patch, 'resultSnapshot')) patch.resultSnapshot = mergedSnapshots.resultSnapshot;
                if (Object.prototype.hasOwnProperty.call(patch, 'scoringSnapshot')) patch.scoringSnapshot = mergedSnapshots.scoringSnapshot;
                
                keys.forEach(key => {
                    if (mergedSnapshots[key]?.truncated && attempt[key] && !attempt[key].truncated) {
                        patch[key] = mergedSnapshots[key];
                    }
                });
            }

            await attemptRef.set(patch, { merge: true });
            await appendAttemptEvent(db, {
                eventType: 'attempt.archive.patched',
                routeName,
                uid,
                attemptId,
                resultCode: 'PATCHED'
            }, serverTimestamp);
            return sendSuccess(res, { attemptId, patched: true }, 'Attempt archive updated.');
        } catch (error) {
            const status = Number(error?.status || 500);
            const code = cleanString(error?.code, 64) || 'PATCH_ATTEMPT_ERROR';
            const message = status >= 500 ? 'Failed to patch attempt archive.' : (error?.message || 'Invalid attempt patch request.');
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
                    submittedAt: serverTimestamp(),
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
                    updatedAt: serverTimestamp()
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

                const requestedStudentId = cleanString(req.query?.studentId || req.query?.crmStudentId, 128);
                if (reviewer.isTeacher && !reviewer.isAdmin) {
                    if (!requestedStudentId || !reviewer.allowedStudentIds.has(requestedStudentId)) {
                        return sendError(res, 403, 'FORBIDDEN', 'Teacher access is limited to linked CRM students.');
                    }
                }

                let reviewQuery = db.collection(SPEAKING_ATTEMPTS)
                    .where('practiceScope', '==', 'pte')
                    .where('status', '==', 'submitted')
                    .orderBy('submittedAt', 'desc');
                if (requestedStudentId) {
                    reviewQuery = db.collection(SPEAKING_ATTEMPTS)
                        .where('practiceScope', '==', 'pte')
                        .where('crmStudentId', '==', requestedStudentId)
                        .where('status', '==', 'submitted')
                        .orderBy('submittedAt', 'desc');
                }
                const snap = await reviewQuery.limit(50).get();

                const rows = snap.docs.map((doc) => ({ doc, data: doc.data() || {} }));
                const signed = await mapWithConcurrency(rows, 6, async (row) => {
                    const audioPath = cleanString(row.data.audio?.studentPath, 1024);
                    const constraints = resolveConstraintSnapshot(row.data);
                    const mediaUrls = await signMediaSlots(bucket, row.data.mediaSlots, constraints);
                    if (!audioPath) return { audioUrl: null, mediaUrls };
                    const audioUrl = await signReadUrl(bucket, audioPath, {
                        expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
                    }).catch(() => null);
                    return { audioUrl, mediaUrls };
                });

                const attempts = rows.map((row, index) => {
                    const item = signed[index] || {};
                    return summarizeAttemptForList(row.doc, row.data, item.audioUrl || null, item.mediaUrls || {});
                });
                logRouteEvent(routeName, { uid, resultCode: 'OK_REVIEW', attemptCount: attempts.length });
                return sendSuccess(res, { attempts });
            }

            const requestedPracticeScope = cleanString(req.query?.practiceScope, 32);
            let mineQuery = db.collection(SPEAKING_ATTEMPTS)
                .where('ownerUid', '==', uid)
                .where('status', '==', 'submitted');
            if (requestedPracticeScope === 'pte') {
                mineQuery = mineQuery.where('practiceScope', '==', 'pte');
            }

            const [snap, counterSnap] = await Promise.all([
                mineQuery
                    .orderBy('createdAt', 'desc')
                    .limit(50)
                    .get(),
                db.collection(SPEAKING_ATTEMPT_COUNTERS).doc(uid).get()
            ]);

            const rows = snap.docs.map((doc) => ({ doc, data: doc.data() || {} }));
            const signed = await mapWithConcurrency(rows, 6, async (row) => {
                const audioPath = cleanString(row.data.audio?.studentPath, 1024);
                const constraints = resolveConstraintSnapshot(row.data);
                const mediaUrls = await signMediaSlots(bucket, row.data.mediaSlots, constraints);
                if (!audioPath) return { audioUrl: null, mediaUrls };
                const audioUrl = await signReadUrl(bucket, audioPath, {
                    expiresMinutes: constraints?.signedReadUrlMinutes || DEFAULT_SIGNED_READ_URL_MINUTES
                }).catch(() => null);
                return { audioUrl, mediaUrls };
            });

            const attempts = rows.map((row, index) => {
                const item = signed[index] || {};
                return summarizeAttemptForList(row.doc, row.data, item.audioUrl || null, item.mediaUrls || {});
            });
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
            const mediaUrls = await signMediaSlots(bucket, attempt.mediaSlots, constraints);

            logRouteEvent(routeName, { uid, attemptId, resultCode: 'OK' });
            return sendSuccess(res, {
                attempt: {
                    attemptId,
                    ownerUid: attempt.ownerUid || null,
                    schemaVersion: attempt.schemaVersion || 1,
                    practiceScope: attempt.practiceScope || null,
                    practiceMode: attempt.practiceMode || null,
                    canonicalMode: attempt.canonicalMode || null,
                    modeLabel: attempt.modeLabel || null,
                    skill: attempt.skill || null,
                    crmStudentId: attempt.crmStudentId || null,
                    promptSnapshot: attempt.promptSnapshot || null,
                    responseSnapshot: attempt.responseSnapshot || null,
                    answerSnapshot: attempt.answerSnapshot || null,
                    resultSnapshot: attempt.resultSnapshot || null,
                    v3: attempt.v3AssessmentId ? {
                        assessmentId: attempt.v3AssessmentId,
                        status: attempt.v3AssessmentState || null,
                        audioId: attempt.v3AudioId || null,
                        audioManifest: attempt.v3AudioManifest || null
                    } : null,
                    timingSnapshot: attempt.timingSnapshot || null,
                    scoringSnapshot: attempt.scoringSnapshot || null,
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
                    },
                    media: normalizeMediaSlotsForResponse(attempt.mediaSlots).map((slot) => ({
                        ...slot,
                        url: mediaUrls[slot.slotFile] || null
                    }))
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
                                bookmarkedAt: serverTimestamp(),
                                lastChangedAt: serverTimestamp()
                            },
                            updatedAt: serverTimestamp()
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
                                lastChangedAt: serverTimestamp()
                            },
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                } else {
                    tx.set(attemptRef, {
                        bookmark: {
                            active: nextActive,
                            bookmarkedAt: nextActive ? serverTimestamp() : null,
                            lastChangedAt: serverTimestamp()
                        },
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                }

                if (delta !== 0) {
                    count += delta;
                }
                count = Math.max(0, count);
                tx.set(counterRef, {
                    uid,
                    nonStudentBookmarkCount: count,
                    updatedAt: serverTimestamp()
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
                    revokedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
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
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            await attemptRef.set({
                shareId,
                updatedAt: serverTimestamp()
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
                    revokedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true }).catch(() => null);
            }

            await attemptRef.set({
                shareId: null,
                updatedAt: serverTimestamp()
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
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);
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
                createdAt: serverTimestamp(),
                completedAt: null,
                updatedAt: serverTimestamp()
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

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = attemptSnap.data() || {};
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);

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
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
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

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = attemptSnap.data() || {};
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);

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

            patch.updatedAt = serverTimestamp();
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

            const attemptSnap = await db.collection(SPEAKING_ATTEMPTS).doc(attemptId).get();
            if (!attemptSnap.exists) return sendError(res, 404, 'NOT_FOUND', 'Attempt not found.');
            const attempt = attemptSnap.data() || {};
            const authz = ensureAttemptOwnerOrReviewer({ attempt, uid, reviewer });
            if (!authz.ok) return sendError(res, authz.status, authz.code, authz.message);

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
