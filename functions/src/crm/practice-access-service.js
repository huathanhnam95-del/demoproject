const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const { CRM_STUDENTS, CRM_ENROLLMENTS } = require('./collections');
const { getAuth } = require('../utils/firebase_admin_init');

const PRACTICE_ACCESS_BY_UID = 'practiceAccessByUid';
const PRACTICE_ACCESS_JOBS = 'practiceAccessJobs';

function asMillis(value) {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) ? ms : null;
    }
    return null;
}

function withinWindow(nowMs, startAt, endAt) {
    const startMs = asMillis(startAt);
    const endMs = asMillis(endAt);
    if (startMs !== null && nowMs < startMs) return false;
    if (endMs !== null && nowMs > endMs) return false;
    return true;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeOverrideMode(value) {
    const text = String(value || '').trim();
    if (text === 'force_active') return 'force_active';
    if (text === 'force_inactive') return 'force_inactive';
    return 'inherit';
}

function computeWindowFromEnrollment(enrollment) {
    const startAt = enrollment?.practiceAccessStartAt ?? null;
    const endAt = enrollment?.practiceAccessEndAt ?? null;
    return { startAt, endAt };
}

function computeWindowFromOverride(student) {
    const startAt = student?.practiceAccessOverrideStartAt ?? null;
    const endAt = student?.practiceAccessOverrideEndAt ?? null;
    return { startAt, endAt };
}

function pickActiveReason(candidates) {
    // Prefer explicit override, then enrollment-backed access.
    const override = candidates.find((x) => x.source === 'override_force_active') || null;
    if (override) return override;
    const enrollment = candidates.find((x) => x.source === 'enrollment_window') || null;
    return enrollment || candidates[0] || null;
}

async function loadLinkedStudents(db, uid) {
    const snap = await db.collection(CRM_STUDENTS).where('linked_user_ids', 'array-contains', uid).get();
    return snap.docs.map((doc) => ({ studentId: doc.id, ...(doc.data() || {}) }));
}

async function loadActiveEnrollmentsByStudentId(db, studentId) {
    const snap = await db
        .collection(CRM_ENROLLMENTS)
        .where('studentId', '==', String(studentId || '').trim())
        .where('status', '==', 'active')
        .get();
    return snap.docs.map((doc) => ({ enrollmentId: doc.id, ...(doc.data() || {}) }));
}

async function resolvePracticeAccessForUid(db, uid, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const nowMs = now.getTime();

    const linkedStudents = await loadLinkedStudents(db, uid);
    if (!linkedStudents.length) {
        return {
            resolvedAt: now,
            effectiveStatus: 'nonstudent',
            source: 'none',
            studentId: null,
            enrollmentIds: [],
            effectiveWindowStartAt: null,
            effectiveWindowEndAt: null,
            linkedStudentIds: []
        };
    }

    const linkedStudentIds = linkedStudents.map((s) => String(s.studentId || '').trim()).filter(Boolean);

    const decisions = [];
    for (const student of linkedStudents) {
        const mode = normalizeOverrideMode(student.practiceAccessOverrideMode);
        const overrideWindow = computeWindowFromOverride(student);

        if (mode === 'force_inactive' && withinWindow(nowMs, overrideWindow.startAt, overrideWindow.endAt)) {
            decisions.push({
                effectiveStatus: 'nonstudent',
                source: 'override_force_inactive',
                studentId: String(student.studentId || '').trim() || null,
                enrollmentIds: [],
                effectiveWindowStartAt: overrideWindow.startAt ?? null,
                effectiveWindowEndAt: overrideWindow.endAt ?? null
            });
            continue;
        }

        if (mode === 'force_active' && withinWindow(nowMs, overrideWindow.startAt, overrideWindow.endAt)) {
            decisions.push({
                effectiveStatus: 'student',
                source: 'override_force_active',
                studentId: String(student.studentId || '').trim() || null,
                enrollmentIds: [],
                effectiveWindowStartAt: overrideWindow.startAt ?? null,
                effectiveWindowEndAt: overrideWindow.endAt ?? null
            });
            continue;
        }

        const enrollments = await loadActiveEnrollmentsByStudentId(db, student.studentId);
        const matching = [];
        for (const enrollment of enrollments) {
            // Back-compat: if no window is set, treat active enrollment as granting access.
            const win = computeWindowFromEnrollment(enrollment);
            const hasAnyWindow = !!(win.startAt || win.endAt);
            const ok = hasAnyWindow ? withinWindow(nowMs, win.startAt, win.endAt) : true;
            if (!ok) continue;
            matching.push(enrollment);
        }

        if (matching.length) {
            const first = matching[0];
            const win = computeWindowFromEnrollment(first);
            decisions.push({
                effectiveStatus: 'student',
                source: 'enrollment_window',
                studentId: String(student.studentId || '').trim() || null,
                enrollmentIds: matching.map((e) => String(e.enrollmentId || '').trim()).filter(Boolean),
                effectiveWindowStartAt: win.startAt ?? null,
                effectiveWindowEndAt: win.endAt ?? null
            });
        } else {
            decisions.push({
                effectiveStatus: 'nonstudent',
                source: 'none',
                studentId: String(student.studentId || '').trim() || null,
                enrollmentIds: [],
                effectiveWindowStartAt: null,
                effectiveWindowEndAt: null
            });
        }
    }

    // Global combine: any force_inactive wins; else any active wins.
    const hasForceInactive = decisions.some((d) => d.source === 'override_force_inactive');
    if (hasForceInactive) {
        const chosen = decisions.find((d) => d.source === 'override_force_inactive') || decisions[0];
        return {
            resolvedAt: now,
            effectiveStatus: 'nonstudent',
            source: 'override_force_inactive',
            studentId: chosen.studentId || null,
            enrollmentIds: [],
            effectiveWindowStartAt: chosen.effectiveWindowStartAt ?? null,
            effectiveWindowEndAt: chosen.effectiveWindowEndAt ?? null,
            linkedStudentIds
        };
    }

    const activeCandidates = decisions.filter((d) => d.effectiveStatus === 'student');
    if (activeCandidates.length) {
        const chosen = pickActiveReason(activeCandidates);
        return {
            resolvedAt: now,
            effectiveStatus: 'student',
            source: chosen.source || 'enrollment_window',
            studentId: chosen.studentId || null,
            enrollmentIds: Array.isArray(chosen.enrollmentIds) ? chosen.enrollmentIds : [],
            effectiveWindowStartAt: chosen.effectiveWindowStartAt ?? null,
            effectiveWindowEndAt: chosen.effectiveWindowEndAt ?? null,
            linkedStudentIds
        };
    }

    // No active decisions.
    const chosen = decisions[0] || {};
    return {
        resolvedAt: now,
        effectiveStatus: 'nonstudent',
        source: 'none',
        studentId: chosen.studentId || null,
        enrollmentIds: [],
        effectiveWindowStartAt: null,
        effectiveWindowEndAt: null,
        linkedStudentIds
    };
}

async function setIsStudentClaim(uid, isStudent) {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...existing, isStudent: !!isStudent });
}

async function upsertPracticeAccessByUid(db, uid, record) {
    const ref = db.collection(PRACTICE_ACCESS_BY_UID).doc(uid);
    await ref.set({
        uid,
        resolvedAt: record.resolvedAt || new Date(),
        effectiveStatus: record.effectiveStatus || 'nonstudent',
        source: record.source || 'none',
        studentId: record.studentId || null,
        enrollmentIds: Array.isArray(record.enrollmentIds) ? record.enrollmentIds : [],
        effectiveWindowStartAt: record.effectiveWindowStartAt || null,
        effectiveWindowEndAt: record.effectiveWindowEndAt || null,
        linkedStudentIds: Array.isArray(record.linkedStudentIds) ? record.linkedStudentIds : [],
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
}

async function enqueuePracticeAccessJob(db, kind, uid, options = {}) {
    const normalizedKind = kind === 'promoteUid' ? 'promoteUid' : 'reconcileUid';
    const jobId = `${normalizedKind}__${sha256Hex(uid)}`;
    const ref = db.collection(PRACTICE_ACCESS_JOBS).doc(jobId);
    const runAfterAt = options.runAfterAt instanceof Date ? options.runAfterAt : new Date();

    await ref.set({
        jobId,
        kind: normalizedKind,
        uid,
        runAfterAt,
        status: 'queued',
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { jobId };
}

async function reconcilePracticeAccessForUid(db, uid, options = {}) {
    const ref = db.collection(PRACTICE_ACCESS_BY_UID).doc(uid);
    const prevSnap = await ref.get();
    const prev = prevSnap.exists ? (prevSnap.data() || {}) : null;

    const resolved = await resolvePracticeAccessForUid(db, uid, options);
    await upsertPracticeAccessByUid(db, uid, resolved);
    await setIsStudentClaim(uid, resolved.effectiveStatus === 'student');

    const prevStatus = prev ? String(prev.effectiveStatus || '') : '';
    if (prevStatus !== 'student' && resolved.effectiveStatus === 'student') {
        await enqueuePracticeAccessJob(db, 'promoteUid', uid, { runAfterAt: new Date() });
    }

    return { resolved, prev };
}

module.exports = {
    PRACTICE_ACCESS_BY_UID,
    PRACTICE_ACCESS_JOBS,
    resolvePracticeAccessForUid,
    reconcilePracticeAccessForUid,
    enqueuePracticeAccessJob
};

