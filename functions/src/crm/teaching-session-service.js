const TEACHING_SESSION_STATUSES = Object.freeze([
    'uploaded',
    'processing',
    'analyzed',
    'error',
    'archived'
]);

function toIsoString(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value.toDate === 'function') {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

function cleanString(val, defaultVal = '') {
    if (val === null || val === undefined) return defaultVal;
    return String(val).trim();
}

function buildTeachingSessionCreateData(payload = {}, context = {}) {
    const studentId = cleanString(payload.studentId);
    if (!studentId) {
        throw new Error('studentId is required to create a teaching session.');
    }

    const user = context.user || {};
    const serverTimestamp = typeof context.serverTimestamp === 'function' ? context.serverTimestamp() : new Date().toISOString();

    const status = cleanString(payload.status, 'uploaded').toLowerCase();
    if (!TEACHING_SESSION_STATUSES.includes(status)) {
        throw new Error(`Invalid status "${payload.status}". Must be one of: ${TEACHING_SESSION_STATUSES.join(', ')}`);
    }

    const sessionDate = toIsoString(payload.sessionDate) || new Date().toISOString();

    return {
        studentId,
        classId: cleanString(payload.classId, null),
        courseId: cleanString(payload.courseId, null),
        teacherUid: cleanString(payload.teacherUid, user.uid || null),
        teacherName: cleanString(payload.teacherName, user.displayName || user.email || 'Teacher'),
        title: cleanString(payload.title, 'Teaching Session'),
        focusSkill: cleanString(payload.focusSkill, 'General'),
        sessionDate,
        audioUrl: cleanString(payload.audioUrl, null),
        audioDurationSec: Number.isFinite(Number(payload.audioDurationSec)) ? Number(payload.audioDurationSec) : null,
        status,
        notes: cleanString(payload.notes, ''),
        report: payload.report && typeof payload.report === 'object' ? payload.report : null,
        mermaidMindmap: cleanString(payload.mermaidMindmap, ''),
        mermaidFlowchart: cleanString(payload.mermaidFlowchart, ''),
        markdownReport: cleanString(payload.markdownReport, ''),
        errorMessage: cleanString(payload.errorMessage, null),
        analysisStartedAt: toIsoString(payload.analysisStartedAt),
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
        createdBy: cleanString(user.uid, 'system'),
        updatedBy: cleanString(user.uid, 'system')
    };
}

function buildTeachingSessionPatchData(current = {}, payload = {}, context = {}) {
    const user = context.user || {};
    const serverTimestamp = typeof context.serverTimestamp === 'function' ? context.serverTimestamp() : new Date().toISOString();
    const patch = {
        updatedAt: serverTimestamp,
        updatedBy: cleanString(user.uid, current.updatedBy || 'system')
    };

    if (payload.status !== undefined) {
        const status = cleanString(payload.status).toLowerCase();
        if (!TEACHING_SESSION_STATUSES.includes(status)) {
            throw new Error(`Invalid status "${payload.status}". Must be one of: ${TEACHING_SESSION_STATUSES.join(', ')}`);
        }
        patch.status = status;
    }

    if (payload.title !== undefined) {
        patch.title = cleanString(payload.title);
    }
    if (payload.focusSkill !== undefined) {
        patch.focusSkill = cleanString(payload.focusSkill);
    }
    if (payload.classId !== undefined) {
        patch.classId = cleanString(payload.classId, null);
    }
    if (payload.courseId !== undefined) {
        patch.courseId = cleanString(payload.courseId, null);
    }
    if (payload.teacherUid !== undefined) {
        patch.teacherUid = cleanString(payload.teacherUid, null);
    }
    if (payload.teacherName !== undefined) {
        patch.teacherName = cleanString(payload.teacherName, null);
    }
    if (payload.audioUrl !== undefined) {
        patch.audioUrl = cleanString(payload.audioUrl, null);
    }
    if (payload.audioDurationSec !== undefined) {
        patch.audioDurationSec = Number.isFinite(Number(payload.audioDurationSec)) ? Number(payload.audioDurationSec) : null;
    }
    if (payload.sessionDate !== undefined) {
        patch.sessionDate = toIsoString(payload.sessionDate) || current.sessionDate;
    }
    if (payload.notes !== undefined) {
        patch.notes = cleanString(payload.notes);
    }
    if (payload.report !== undefined) {
        patch.report = payload.report && typeof payload.report === 'object' ? payload.report : null;
    }
    if (payload.mermaidMindmap !== undefined) {
        patch.mermaidMindmap = cleanString(payload.mermaidMindmap);
    }
    if (payload.mermaidFlowchart !== undefined) {
        patch.mermaidFlowchart = cleanString(payload.mermaidFlowchart);
    }
    if (payload.markdownReport !== undefined) {
        patch.markdownReport = cleanString(payload.markdownReport);
    }
    if (payload.errorMessage !== undefined) {
        patch.errorMessage = cleanString(payload.errorMessage, null);
    }
    if (payload.analysisStartedAt !== undefined) {
        patch.analysisStartedAt = toIsoString(payload.analysisStartedAt);
    }

    return patch;
}

function mapTeachingSessionRecord(docOrData, id) {
    const data = (docOrData && typeof docOrData.data === 'function')
        ? (docOrData.data() || {})
        : (docOrData || {});

    const recordId = id || (docOrData && docOrData.id) || data.id || data.sessionId || '';

    return {
        id: recordId,
        sessionId: recordId,
        studentId: data.studentId || '',
        classId: data.classId || null,
        courseId: data.courseId || null,
        teacherUid: data.teacherUid || null,
        teacherName: data.teacherName || 'Teacher',
        title: data.title || 'Teaching Session',
        focusSkill: data.focusSkill || 'General',
        sessionDate: toIsoString(data.sessionDate) || (typeof data.sessionDate === 'string' ? data.sessionDate : null),
        audioUrl: data.audioUrl || null,
        audioDurationSec: typeof data.audioDurationSec === 'number' ? data.audioDurationSec : null,
        status: data.status || 'uploaded',
        notes: data.notes || '',
        report: data.report || null,
        mermaidMindmap: data.mermaidMindmap || '',
        mermaidFlowchart: data.mermaidFlowchart || '',
        markdownReport: data.markdownReport || '',
        errorMessage: data.errorMessage || null,
        analysisStartedAt: toIsoString(data.analysisStartedAt) || (typeof data.analysisStartedAt === 'string' ? data.analysisStartedAt : null),
        createdAt: toIsoString(data.createdAt) || (typeof data.createdAt === 'string' ? data.createdAt : null),
        updatedAt: toIsoString(data.updatedAt) || (typeof data.updatedAt === 'string' ? data.updatedAt : null),
        createdBy: data.createdBy || null,
        updatedBy: data.updatedBy || null
    };
}

function sortTeachingSessions(sessions = []) {
    return [...sessions].sort((a, b) => {
        const timeA = new Date(a.sessionDate || a.createdAt || 0).getTime();
        const timeB = new Date(b.sessionDate || b.createdAt || 0).getTime();
        return timeB - timeA;
    });
}

module.exports = {
    TEACHING_SESSION_STATUSES,
    buildTeachingSessionCreateData,
    buildTeachingSessionPatchData,
    mapTeachingSessionRecord,
    sortTeachingSessions
};
