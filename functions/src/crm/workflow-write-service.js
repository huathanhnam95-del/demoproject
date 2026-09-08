'use strict';

const { createHash } = require('crypto');
const C = require('./collections');
const { formatCrmId, normalizeCrmId, isValidCrmId } = require('./business-id-service');
const { buildStudentCreateData, buildStudentPatchData } = require('./student-service');
const { buildLeadConversion } = require('./lead-service');
const { buildEnrollmentCreateData, buildEnrollmentPatchData, buildClassroomMemberData } = require('./enrollment-service');
const { buildClassroomCreateData, mapCourseRecord } = require('./course-service');
const { buildSeedSessions, buildScheduleSummary, normalizeScheduledSession } = require('./scheduling-service');

const clean = (value) => String(value || '').trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
function fail(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
}

function validatedSeed(input) {
    try { return buildSeedSessions(input); }
    catch (error) { fail(400, 'VALIDATION_ERROR', error.message); }
}

// Only optional post-save work belongs here. A saved record must not appear to
// have failed merely because an audit sink is temporarily unavailable.
async function auditSaved(writeAuditLog, entry, context) {
    if (!writeAuditLog) return [];
    try {
        await writeAuditLog(entry, context);
        return [];
    } catch (error) {
        console.error('[CRM] Post-save audit failed', entry.action, entry.entityId, error?.message);
        return ['AUDIT_LOG_FAILED'];
    }
}

async function convertLead(db, leadId, context) {
    const leadRef = db.collection(C.CRM_LEADS).doc(leadId);
    const newStudentRef = db.collection(C.CRM_STUDENTS).doc();
    return db.runTransaction(async (tx) => {
        const leadSnap = await tx.get(leadRef);
        if (!leadSnap.exists) fail(404, 'LEAD_NOT_FOUND', 'Lead not found.');
        const lead = leadSnap.data() || {};
        if (clean(lead.studentId)) {
            const linked = await tx.get(db.collection(C.CRM_STUDENTS).doc(clean(lead.studentId)));
            if (!linked.exists) fail(409, 'BROKEN_STUDENT_LINK', 'The linked student no longer exists.');
            return { studentId: linked.id, deduped: true, paymentFollowupRequired: linked.data()?.paymentFollowupRequired || null };
        }
        if (lead.stage === 'converted') fail(409, 'BROKEN_STUDENT_LINK', 'The converted lead is missing its student link.');
        const tests = await tx.get(db.collection(C.ENTRANCE_TESTS).where('leadId', '==', leadId));
        let crmId = clean(lead.crmId);
        let counterRef;
        let nextIndex;
        if (!crmId) {
            counterRef = db.collection(C.CRM_COUNTERS).doc('crmId');
            const counter = await tx.get(counterRef);
            const value = Number(counter.data()?.nextIndex);
            nextIndex = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
            crmId = formatCrmId(nextIndex);
        }
        const conversion = buildLeadConversion({ leadId, lead, context: { ...context, crmId } });
        // Firestore limits a commit to 500 document writes. Reject before writing.
        if (tests.docs.length + 3 > 500) fail(409, 'CONVERSION_TOO_LARGE', 'Too many linked tests for one conversion.');
        if (counterRef) tx.set(counterRef, { nextIndex: nextIndex + 1, lastAllocatedCrmId: crmId, updatedAt: context.serverTimestamp() }, { merge: true });
        tx.set(newStudentRef, conversion.student);
        tx.set(leadRef, { ...conversion.leadPatch, crmId, studentId: newStudentRef.id }, { merge: true });
        for (const doc of tests.docs) tx.set(doc.ref, { studentId: newStudentRef.id, crmId, updatedAt: context.serverTimestamp() }, { merge: true });
        return { studentId: newStudentRef.id, deduped: false, paymentFollowupRequired: conversion.student.paymentFollowupRequired };
    });
}

function assertNoOverlap(proposed, existing) {
    const normalized = proposed.map(normalizeScheduledSession);
    for (let i = 0; i < normalized.length; i += 1) {
        const session = normalized[i];
        const start = Date.parse(session.scheduledStartAtUtc);
        const end = Date.parse(session.scheduledEndAtUtc);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail(400, 'VALIDATION_ERROR', 'Invalid session time.');
        for (const other of [...existing, ...normalized.slice(0, i)]) {
            const candidate = normalizeScheduledSession(other);
            if (start < Date.parse(candidate.scheduledEndAtUtc) && end > Date.parse(candidate.scheduledStartAtUtc)) {
                fail(409, 'TEACHER_SCHEDULE_CONFLICT', 'The proposed lessons overlap an existing or another proposed lesson.');
            }
        }
    }
}

async function teacherSessions(tx, db, teacherUid) {
    if (!teacherUid) return [];
    const snap = await tx.get(db.collection(C.CRM_SCHEDULED_SESSIONS).where('teacherUid', '==', teacherUid).where('status', '==', 'scheduled'));
    return snap.docs.map((doc) => ({ ...doc.data(), sessionId: doc.id }));
}

function queuePracticeJobs(tx, db, student, context) {
    const uids = [...new Set((Array.isArray(student.linked_user_ids) ? student.linked_user_ids : []).map(clean).filter(Boolean))];
    for (const uid of uids) {
        const jobId = `reconcileUid__${hash(uid)}`;
        tx.set(db.collection('practiceAccessJobs').doc(jobId), { jobId, kind: 'reconcileUid', uid, runAfterAt: new Date(context.nowMs ?? Date.now()), status: 'queued', updatedAt: context.serverTimestamp() }, { merge: true });
    }
    return uids.length;
}

async function createEnrollment(db, input, context) {
    const inputStudentId = clean(input.studentId);
    if (!inputStudentId) fail(400, 'VALIDATION_ERROR', 'Enrollment requires studentId and classId or a personal course schedule.');
    return db.runTransaction(async (tx) => {
        const payload = { ...input, studentId: inputStudentId };
        const studentSnap = await tx.get(db.collection(C.CRM_STUDENTS).doc(payload.studentId));
        if (!studentSnap.exists) fail(404, 'STUDENT_NOT_FOUND', 'Student not found.');
        const student = studentSnap.data() || {};
        payload.studentName = payload.studentName || student.name || student.email || null;
        payload.studentEmail = payload.studentEmail || student.email || null;
        payload.studentUid = payload.studentUid || student.linked_user_ids?.[0] || null;
        let classroom;
        let classRef;
        let sessions = [];
        let synthetic = false;
        payload.classId = clean(payload.classId);
        payload.courseId = clean(payload.courseId);
        if (payload.classId) {
            classRef = db.collection(C.CRM_CLASSROOMS).doc(payload.classId);
            const classSnap = await tx.get(classRef);
            if (!classSnap.exists) fail(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
            classroom = classSnap.data() || {};
            if (payload.courseId && payload.courseId !== clean(classroom.courseId)) fail(400, 'COURSE_CLASS_MISMATCH', 'The selected course does not match this classroom.');
            payload.courseId = clean(classroom.courseId);
        }
        let course;
        if (payload.courseId) {
            const courseSnap = await tx.get(db.collection(C.CRM_COURSES).doc(payload.courseId));
            if (!courseSnap.exists) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
            course = mapCourseRecord(courseSnap, courseSnap.id);
        }
        if (!payload.classId) {
            if (!course || !(course.courseType === '1on1' || course.courseType === 'pronun' || input.slots?.length)) fail(400, 'VALIDATION_ERROR', 'Enrollment requires a classroom or personal course schedule.');
            synthetic = true;
            const template = course.deliveryTemplate || {};
            const teacherUid = clean(input.teacherUid);
            if (teacherUid === 'all') fail(400, 'VALIDATION_ERROR', 'Choose a teacher or leave the teacher unassigned.');
            if (!Array.isArray(input.slots) || !input.slots.length) fail(400, 'VALIDATION_ERROR', 'At least one weekly schedule slot is required.');
            const config = { totalInstructionMinutes: template.totalInstructionMinutes || 1440, sessionMinutes: template.defaultSessionMinutes || 120, durationStepMinutes: template.durationStepMinutes || 30, timezone: clean(input.timezone) || template.timezone || 'Asia/Ho_Chi_Minh', seedStartDate: clean(input.startDate), planningStatus: 'configured', scheduleVersion: 1 };
            sessions = validatedSeed({ classId: null, courseId: payload.courseId, teacherUid: teacherUid || null, timezone: config.timezone, startDate: input.startDate, endDate: input.endDate, slots: input.slots, sessionMinutes: config.sessionMinutes, totalInstructionMinutes: config.totalInstructionMinutes });
            if (!sessions.length) fail(400, 'VALIDATION_ERROR', 'The date range contains no scheduled lessons.');
            // Stable schedule identity makes unchanged retries safe without an extra UI field.
            const signature = hash(JSON.stringify([payload.studentId, payload.courseId, config.timezone, config.totalInstructionMinutes, clean(input.startDate), clean(input.endDate), teacherUid, sessions.map((s) => [s.scheduledStartAtUtc, s.scheduledEndAtUtc])]));
            payload.classId = `personal-${signature}`;
            classRef = db.collection(C.CRM_CLASSROOMS).doc(payload.classId);
            classroom = buildClassroomCreateData({ name: `${payload.studentName || 'Student'} - ${course.name || '1-on-1'}`, courseId: payload.courseId, classKind: 'oneOnOne', primaryTeacherUid: teacherUid || null, studentId: payload.studentId, studentUid: payload.studentUid, status: 'active', scheduleConfig: config }, context);
            sessions = sessions.map((session) => ({ ...session, classId: payload.classId, seedBatchId: payload.classId }));
            classroom.scheduleSummary = buildScheduleSummary({ ...config, sessions });
        }
        const enrollment = buildEnrollmentCreateData(payload, context);
        const syntheticClassSnap = synthetic ? await tx.get(classRef) : null;
        const existing = await tx.get(db.collection(C.CRM_ENROLLMENTS).where('studentId', '==', payload.studentId));
        const matching = existing.docs.find((doc) => clean(doc.data()?.classId) === payload.classId);
        if (matching) {
            if (synthetic && !syntheticClassSnap.exists) fail(409, 'BROKEN_ENROLLMENT_REFERENCE', 'The enrolled classroom no longer exists.');
            return { enrollmentId: matching.id, enrollment: matching.data(), deduped: true };
        }
        // Existing-class enrollments serialize on their deterministic document too.
        const enrollmentId = `enrollment-${hash(JSON.stringify([payload.studentId, payload.classId]))}`;
        const ref = db.collection(C.CRM_ENROLLMENTS).doc(enrollmentId);
        const current = await tx.get(ref);
        if (current.exists) return { enrollmentId, enrollment: current.data(), deduped: true };
        if (synthetic) {
            if (syntheticClassSnap.exists) fail(409, 'PERSONAL_CLASS_ALREADY_EXISTS', 'This personal schedule already exists without its enrollment; review the existing class.');
            assertNoOverlap(sessions, await teacherSessions(tx, db, clean(input.teacherUid)));
        }
        const linkedCount = new Set((student.linked_user_ids || []).map(clean).filter(Boolean)).size;
        if (sessions.length + linkedCount + 3 > 500) fail(400, 'VALIDATION_ERROR', 'Schedule is too large for one atomic enrollment.');
        if (synthetic) {
            tx.set(classRef, classroom);
            for (const session of sessions) {
                const sessionRef = db.collection(C.CRM_SCHEDULED_SESSIONS).doc();
                tx.set(sessionRef, { ...session, sessionId: sessionRef.id, createdAt: context.serverTimestamp(), createdBy: context.user?.uid || null });
            }
        }
        tx.set(ref, enrollment);
        if (enrollment.studentUid && !['inactive', 'withdrawn'].includes(enrollment.status)) tx.set(classRef.collection(C.CLASSROOM_MEMBERS).doc(enrollment.studentUid), buildClassroomMemberData(enrollment), { merge: true });
        queuePracticeJobs(tx, db, student, context);
        return { enrollmentId, enrollment, deduped: false };
    });
}

async function seedClassSchedule(db, classId, input, context) {
    if (!classId) fail(400, 'VALIDATION_ERROR', 'Missing classId.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection(C.CRM_CLASSROOMS).doc(classId);
        const snap = await tx.get(ref);
        if (!snap.exists) fail(404, 'CLASSROOM_NOT_FOUND', 'Classroom not found.');
        const classroom = snap.data() || {};
        const config = classroom.scheduleConfig || {};
        const existing = await tx.get(db.collection(C.CRM_SCHEDULED_SESSIONS).where('classId', '==', classId));
        const existingSessions = existing.docs.map((doc) => normalizeScheduledSession({ ...doc.data(), sessionId: doc.id }));
        if (existingSessions.some((s) => s.unitType === 'contracted' && s.status !== 'cancelled')) fail(409, 'SCHEDULE_ALREADY_SEEDED', 'This class already has scheduled contracted sessions. Use schedule regeneration for future changes.');
        const teacherUid = clean(input.teacherUid) && input.teacherUid !== 'all' ? clean(input.teacherUid) : clean(classroom.primaryTeacherUid);
        const sessions = validatedSeed({ classId, courseId: classroom.courseId || null, teacherUid: teacherUid || null, sessionMinutes: config.sessionMinutes, timezone: config.timezone, startDate: input.startDate, endDate: input.endDate, weekdayNumbers: input.weekdayNumbers, startTime: input.startTime, targetSessionCount: config.targetSessionCount, seedBatchId: clean(input.seedBatchId) || `${classId}-${Date.now()}` });
        assertNoOverlap(sessions, await teacherSessions(tx, db, teacherUid));
        if (!sessions.length || sessions.length + 1 > 500) fail(400, 'VALIDATION_ERROR', 'Schedule must contain between 1 and 499 lessons.');
        const scheduleVersion = Math.max(Number(config.scheduleVersion || 0) + 1, 1);
        const scheduleSummary = buildScheduleSummary({ ...config, sessions: [...existingSessions, ...sessions] });
        for (const session of sessions) tx.set(db.collection(C.CRM_SCHEDULED_SESSIONS).doc(), { ...session, createdAt: context.serverTimestamp(), createdBy: context.user?.uid || null, updatedAt: context.serverTimestamp(), updatedBy: context.user?.uid || null });
        tx.set(ref, { scheduleConfig: { ...config, scheduleVersion }, scheduleSummary }, { merge: true });
        return { count: sessions.length, scheduleSummary, scheduleVersion };
    });
}

async function updateEnrollment(db, enrollmentId, input, context) {
    const ref = db.collection(C.CRM_ENROLLMENTS).doc(enrollmentId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) fail(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found.');
        const before = snap.data() || {};
        const next = buildEnrollmentPatchData(before, input, context);
        const studentSnap = await tx.get(db.collection(C.CRM_STUDENTS).doc(next.studentId));
        const classRef = db.collection(C.CRM_CLASSROOMS).doc(next.classId);
        const classSnap = await tx.get(classRef);
        if (!studentSnap.exists || !classSnap.exists) fail(409, 'BROKEN_ENROLLMENT_REFERENCE', 'The student or classroom no longer exists.');
        if (clean(next.courseId) !== clean(classSnap.data()?.courseId)) fail(400, 'COURSE_CLASS_MISMATCH', 'The selected course does not match this classroom.');
        if (next.courseId && !(await tx.get(db.collection(C.CRM_COURSES).doc(next.courseId))).exists) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
        const oldUid = clean(before.studentUid);
        const newUid = clean(next.studentUid);
        // Another enrollment can legitimately still grant the old account access.
        let oldMemberStillNeeded = false;
        if (oldUid && (oldUid !== newUid || ['inactive', 'withdrawn'].includes(next.status))) {
            const peers = await tx.get(db.collection(C.CRM_ENROLLMENTS).where('classId', '==', next.classId));
            oldMemberStillNeeded = peers.docs.some((doc) => doc.id !== enrollmentId && clean(doc.data()?.studentUid) === oldUid && !['inactive', 'withdrawn'].includes(doc.data()?.status));
        }
        tx.set(ref, next, { merge: true });
        if (oldUid && !oldMemberStillNeeded && (oldUid !== newUid || ['inactive', 'withdrawn'].includes(next.status))) tx.delete(classRef.collection(C.CLASSROOM_MEMBERS).doc(oldUid));
        if (newUid && !['inactive', 'withdrawn'].includes(next.status)) tx.set(classRef.collection(C.CLASSROOM_MEMBERS).doc(newUid), buildClassroomMemberData(next), { merge: true });
        const student = studentSnap.data() || {};
        queuePracticeJobs(tx, db, { ...student, linked_user_ids: [...(Array.isArray(student.linked_user_ids) ? student.linked_user_ids : []), oldUid, newUid] }, context);
        return next;
    });
}

async function readSavedData(ref, fallback) {
    try {
        const snap = await ref.get();
        if (!snap.exists) throw new Error('Saved record unavailable during readback.');
        return { data: snap.data(), warnings: [] };
    } catch (error) {
        // Preserve the successful write/ID even if a separate read fails. Do not
        // serialize unresolved server-timestamp sentinels as actual timestamps.
        const data = { ...fallback };
        for (const key of ['createdAt', 'updatedAt']) {
            if (data[key] && typeof data[key] === 'object' && !(data[key] instanceof Date) && typeof data[key].toDate !== 'function') data[key] = null;
        }
        console.error('[CRM] Saved record readback failed', ref.id, error?.message);
        return { data, warnings: ['SAVED_RECORD_READBACK_FAILED'] };
    }
}

async function saveStudent(db, studentId, input, context) {
    const collection = db.collection(C.CRM_STUDENTS);
    const ref = studentId ? collection.doc(studentId) : collection.doc();
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (studentId && !snap.exists) fail(404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
        const before = snap.exists ? snap.data() : {};
        const next = studentId ? buildStudentPatchData(before, input, context) : buildStudentCreateData({ ...input, crmId: null }, context);
        let crmId = normalizeCrmId(studentId ? before.crmId : null);
        let counterRef;
        let nextIndex;
        if (!isValidCrmId(crmId)) {
            counterRef = db.collection(C.CRM_COUNTERS).doc('crmId');
            const counter = await tx.get(counterRef);
            const numeric = Number(counter.data()?.nextIndex);
            nextIndex = Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
            crmId = formatCrmId(nextIndex);
        }
        next.crmId = crmId;
        if (counterRef) tx.set(counterRef, { nextIndex: nextIndex + 1, lastAllocatedCrmId: crmId, updatedAt: context.serverTimestamp() }, { merge: true });
        tx.set(ref, next, { merge: Boolean(studentId) });
        queuePracticeJobs(tx, db, { linked_user_ids: [...(Array.isArray(before.linked_user_ids) ? before.linked_user_ids : []), ...(Array.isArray(next.linked_user_ids) ? next.linked_user_ids : [])] }, context);
        return { studentId: ref.id, student: next };
    });
}

module.exports = { convertLead, createEnrollment, updateEnrollment, saveStudent, seedClassSchedule, auditSaved, readSavedData, queuePracticeJobs };
