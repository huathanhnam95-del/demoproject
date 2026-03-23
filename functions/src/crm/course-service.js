const { hydrateClassroomSchedule } = require('./schedule-normalizer');

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function sanitizeTeachers(rawTeachers) {
    if (!Array.isArray(rawTeachers)) return [];
    return rawTeachers
        .map((teacher) => String(teacher || '').trim().toLowerCase())
        .filter(Boolean);
}

function normalizeStringList(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return [];
    const list = Array.isArray(rawValue) ? rawValue : String(rawValue).split(',');
    const seen = new Set();
    const output = [];

    for (const entry of list) {
        const normalized = String(entry || '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }

    return output;
}

function buildCourseCreateData(input, context = {}) {
    const data = {
        name: cleanOptionalString(input.name, ''),
        code: cleanOptionalString(input.code),
        label: cleanOptionalString(input.label),
        level: cleanOptionalString(input.level),
        category: cleanOptionalString(input.category),
        status: cleanOptionalString(input.status, 'active') || 'active',
        description: cleanOptionalString(input.description),
        teachers: sanitizeTeachers(input.teachers),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };

    if (!data.name) {
        throw new Error('Please provide a course name before saving.');
    }

    return data;
}

function buildCoursePatchData(existing, input, context = {}) {
    const patch = {};
    for (const key of ['name', 'code', 'label', 'level', 'category', 'status', 'description']) {
        if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
            patch[key] = key === 'name'
                ? cleanOptionalString(input[key], '')
                : cleanOptionalString(input[key]);
        }
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'teachers')) {
        patch.teachers = sanitizeTeachers(input.teachers);
    }
    if (Object.keys(patch).length === 0) {
        throw new Error('No course fields provided for update.');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'name') && !patch.name) {
        throw new Error('Please provide a course name before saving.');
    }

    return {
        ...existing,
        ...patch,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function mapCourseRecord(doc, courseId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        courseId: courseId || doc?.id || null,
        name: data.name || '',
        code: data.code || null,
        label: data.label || null,
        level: data.level || null,
        category: data.category || null,
        status: data.status || 'active',
        description: data.description || null,
        teachers: Array.isArray(data.teachers) ? data.teachers : [],
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function buildClassroomCreateData(input, context = {}) {
    const data = {
        name: cleanOptionalString(input.name, ''),
        courseId: cleanOptionalString(input.courseId),
        status: cleanOptionalString(input.status, 'draft') || 'draft',
        meetingDays: normalizeStringList(input.meetingDays),
        meetingHours: normalizeStringList(input.meetingHours),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null
    };
    const hydrated = hydrateClassroomSchedule(data);
    data.meetingDays = hydrated.meetingDays;
    data.meetingHours = hydrated.meetingHours;
    if (!data.name) {
        throw new Error('Classroom name is required.');
    }
    return data;
}

function buildClassroomPatchData(existing, input, context = {}) {
    const patch = {};
    for (const key of ['name', 'courseId', 'status']) {
        if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
            patch[key] = key === 'name'
                ? cleanOptionalString(input[key], '')
                : cleanOptionalString(input[key]);
        }
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'meetingDays')) {
        patch.meetingDays = normalizeStringList(input.meetingDays);
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'meetingHours')) {
        patch.meetingHours = normalizeStringList(input.meetingHours);
    }
    if (Object.keys(patch).length === 0) {
        throw new Error('No classroom fields provided for update.');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'name') && !patch.name) {
        throw new Error('Classroom name is required.');
    }
    const next = {
        ...existing,
        ...patch,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
    const hydrated = hydrateClassroomSchedule(next);
    next.meetingDays = hydrated.meetingDays;
    next.meetingHours = hydrated.meetingHours;
    return next;
}

function mapClassroomRecord(doc, classId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    const hydrated = hydrateClassroomSchedule(data);
    return {
        classroomId: classId || doc?.id || null,
        name: data.name || '',
        courseId: data.courseId || null,
        status: data.status || 'draft',
        meetingDays: hydrated.meetingDays,
        meetingHours: hydrated.meetingHours,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function mapClassroomMembers(memberDocs) {
    return (memberDocs || [])
        .map((member) => {
            const data = member && typeof member.data === 'function' ? member.data() : (member || {});
            const memberUid = member?.id || data.memberUid || null;
            if (!memberUid) return null;
            return {
                memberUid,
                studentId: data.studentId || null,
                studentName: data.studentName || data.name || data.email || 'Student'
            };
        })
        .filter(Boolean);
}

function computeMissingReviewItems({ classworks, submissions, members }) {
    const workList = Array.isArray(classworks) ? classworks : [];
    const submissionList = Array.isArray(submissions) ? submissions : [];
    const memberList = Array.isArray(members) ? members : [];
    const missing = [];

    for (const work of workList) {
        for (const member of memberList) {
            const hasSubmission = submissionList.some((submission) =>
                submission.workId === work.id && submission.studentUid === member.memberUid
            );
            if (!hasSubmission) {
                missing.push({
                    id: `missing-${work.id}-${member.memberUid}`,
                    workId: work.id,
                    workTitle: work.title || 'Untitled work',
                    studentId: member.studentId || null,
                    studentUid: member.memberUid,
                    studentName: member.studentName || 'Student',
                    status: 'missing'
                });
            }
        }
    }

    return missing;
}

module.exports = {
    buildCourseCreateData,
    buildCoursePatchData,
    buildClassroomCreateData,
    buildClassroomPatchData,
    computeMissingReviewItems,
    mapClassroomMembers,
    mapClassroomRecord,
    mapCourseRecord,
    sanitizeTeachers,
    normalizeStringList
};
