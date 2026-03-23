function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

const {
    buildScheduleSummary,
    computeContractedTargetCount
} = require('./scheduling-service');

function sanitizeTeachers(rawTeachers) {
    if (!Array.isArray(rawTeachers)) return [];
    return rawTeachers
        .map((teacher) => String(teacher || '').trim().toLowerCase())
        .filter(Boolean);
}

function normalizePositiveInteger(value, label) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return numeric;
}

function normalizeDeliveryTemplate(rawTemplate) {
    if (!rawTemplate || typeof rawTemplate !== 'object') return null;

    const totalInstructionMinutes = Object.prototype.hasOwnProperty.call(rawTemplate, 'totalInstructionMinutes')
        ? normalizePositiveInteger(rawTemplate.totalInstructionMinutes, 'Delivery template total instruction minutes')
        : normalizePositiveInteger(Number(rawTemplate.totalHours) * 60, 'Delivery template total instruction minutes');
    const defaultSessionMinutes = normalizePositiveInteger(rawTemplate.defaultSessionMinutes, 'Delivery template default session minutes');
    const durationStepMinutes = Object.prototype.hasOwnProperty.call(rawTemplate, 'durationStepMinutes')
        ? normalizePositiveInteger(rawTemplate.durationStepMinutes, 'Delivery template duration step minutes')
        : 30;

    return {
        totalInstructionMinutes,
        defaultSessionMinutes,
        timezone: cleanOptionalString(rawTemplate.timezone),
        durationStepMinutes
    };
}

function normalizeNullableTimestamp(value) {
    if (value === undefined) return null;
    return value || null;
}

function normalizeScheduleConfig(rawConfig, options = {}) {
    if (!rawConfig || typeof rawConfig !== 'object') return null;
    const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
    const source = existing ? { ...existing, ...rawConfig } : rawConfig;
    const preserveExistingTargetSessionCount = options.preserveExistingTargetSessionCount !== false;

    const totalInstructionMinutes = normalizePositiveInteger(source.totalInstructionMinutes, 'Schedule total instruction minutes');
    const sessionMinutes = normalizePositiveInteger(source.sessionMinutes, 'Schedule session minutes');
    const hasExplicitTargetCount = Object.prototype.hasOwnProperty.call(rawConfig, 'targetSessionCount')
        && rawConfig.targetSessionCount !== null
        && rawConfig.targetSessionCount !== undefined
        && String(rawConfig.targetSessionCount).trim() !== '';
    const targetSessionCount = hasExplicitTargetCount
        ? normalizePositiveInteger(rawConfig.targetSessionCount, 'Schedule target session count')
        : preserveExistingTargetSessionCount && Number(existing?.targetSessionCount || 0) > 0
            ? normalizePositiveInteger(existing.targetSessionCount, 'Schedule target session count')
        : computeContractedTargetCount({
            totalInstructionMinutes,
            sessionMinutes
        });
    const currentVersion = Number(source.scheduleVersion || existing?.scheduleVersion || 0);

    return {
        totalInstructionMinutes,
        sessionMinutes,
        targetSessionCount,
        timezone: cleanOptionalString(source.timezone),
        durationStepMinutes: normalizePositiveInteger(source.durationStepMinutes || 30, 'Schedule duration step minutes'),
        allowedStartTime: cleanOptionalString(source.allowedStartTime),
        allowedEndTime: cleanOptionalString(source.allowedEndTime),
        seedWeekdays: Array.isArray(source.seedWeekdays)
            ? source.seedWeekdays.map((day) => String(day || '').trim()).filter(Boolean)
            : cleanOptionalString(source.seedWeekdays)
                ? String(source.seedWeekdays)
                    .split(',')
                    .map((day) => day.trim())
                    .filter(Boolean)
                : [],
        seedStartDate: cleanOptionalString(source.seedStartDate),
        seedStartTime: cleanOptionalString(source.seedStartTime),
        skipDates: Array.isArray(source.skipDates)
            ? source.skipDates.map((day) => String(day || '').trim()).filter(Boolean)
            : [],
        planningStatus: cleanOptionalString(source.planningStatus, 'needs_setup') || 'needs_setup',
        scheduleVersion: currentVersion > 0 ? Math.floor(currentVersion) : 1,
        lastRegeneratedAt: normalizeNullableTimestamp(source.lastRegeneratedAt),
        lastRegeneratedBy: cleanOptionalString(source.lastRegeneratedBy),
        lastRegenerateFromDate: cleanOptionalString(source.lastRegenerateFromDate)
    };
}

function buildEmptyScheduleSummary(scheduleConfig) {
    if (!scheduleConfig) {
        return {
            contractedTargetCount: 0,
            contractedAssignedCount: 0,
            contractedCompletedCount: 0,
            remainingToScheduleCount: 0,
            overflowCount: 0,
            nextScheduledAt: null
        };
    }

    return buildScheduleSummary({
        totalInstructionMinutes: scheduleConfig.totalInstructionMinutes,
        sessionMinutes: scheduleConfig.sessionMinutes,
        targetSessionCount: scheduleConfig.targetSessionCount,
        sessions: []
    });
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
        deliveryTemplate: normalizeDeliveryTemplate(input.deliveryTemplate),
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
    if (Object.prototype.hasOwnProperty.call(input || {}, 'deliveryTemplate')) {
        patch.deliveryTemplate = normalizeDeliveryTemplate(input.deliveryTemplate);
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
        deliveryTemplate: data.deliveryTemplate || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function buildClassroomCreateData(input, context = {}) {
    const scheduleConfig = normalizeScheduleConfig(input.scheduleConfig, {
        preserveExistingTargetSessionCount: false
    });
    const data = {
        name: cleanOptionalString(input.name, ''),
        courseId: cleanOptionalString(input.courseId),
        primaryTeacherUid: cleanOptionalString(input.primaryTeacherUid),
        status: cleanOptionalString(input.status, 'draft') || 'draft',
        scheduleConfig,
        scheduleSummary: buildEmptyScheduleSummary(scheduleConfig),
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null
    };
    if (!data.name) {
        throw new Error('Classroom name is required.');
    }
    return data;
}

function buildClassroomPatchData(existing, input, context = {}) {
    const patch = {};
    for (const key of ['name', 'courseId', 'status', 'primaryTeacherUid']) {
        if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
            patch[key] = key === 'name'
                ? cleanOptionalString(input[key], '')
                : cleanOptionalString(input[key]);
        }
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'scheduleConfig')) {
        patch.scheduleConfig = normalizeScheduleConfig(input.scheduleConfig, {
            existing: existing?.scheduleConfig || null,
            preserveExistingTargetSessionCount: true
        });
        patch.scheduleSummary = buildEmptyScheduleSummary(patch.scheduleConfig);
    }
    if (Object.keys(patch).length === 0) {
        throw new Error('No classroom fields provided for update.');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'name') && !patch.name) {
        throw new Error('Classroom name is required.');
    }
    return {
        ...existing,
        ...patch,
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null
    };
}

function mapClassroomRecord(doc, classId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        classroomId: classId || doc?.id || null,
        name: data.name || '',
        courseId: data.courseId || null,
        primaryTeacherUid: data.primaryTeacherUid || null,
        status: data.status || 'draft',
        scheduleConfig: data.scheduleConfig || null,
        scheduleSummary: data.scheduleSummary || buildEmptyScheduleSummary(data.scheduleConfig || null),
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
    normalizeScheduleConfig,
    sanitizeTeachers
};
