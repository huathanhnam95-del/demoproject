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

function normalizeStringList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => cleanOptionalString(item, ''))
            .filter(Boolean);
    }

    const normalized = cleanOptionalString(value, '');
    if (!normalized) {
        return [];
    }

    return normalized
        .split(',')
        .map((item) => cleanOptionalString(item, ''))
        .filter(Boolean);
}

function normalizePositiveInteger(value, label) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return numeric;
}

// Delivery shape, not a marketing label. `category` stays free text; `courseType` drives
// how the course is scheduled (a 1on1 course provisions a single-member classroom).
const COURSE_TYPES = ['1on1', 'pronun'];

function normalizeCourseType(value, { required = false } = {}) {
    const raw = cleanOptionalString(value);
    if (!raw) {
        if (required) {
            throw new Error('Please choose a course type before saving.');
        }
        return null;
    }
    let normalized = raw.toLowerCase();
    if (normalized.endsWith('.')) {
        normalized = normalized.slice(0, -1);
    }
    if (!COURSE_TYPES.includes(normalized)) {
        throw new Error(`Invalid course type: ${normalized}`);
    }
    return normalized;
}

// Calendar days the student has to finish the course. Optional: courses without it simply
// require an explicit end date at enrolment time.
function normalizeDurationDays(value) {
    if (value === null || value === undefined || value === '') return null;
    return normalizePositiveInteger(value, 'Course duration days');
}

function normalizeCommissionBps(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error('Agent commission rate must be a number.');
    }
    const rounded = Math.round(numeric);
    if (rounded < 0 || rounded > 10000) {
        throw new Error('Agent commission rate must be between 0 and 10000 bps.');
    }
    return rounded;
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
            nextScheduledAt: null,
            contractedMinutesTotal: 0,
            contractedMinutesDelivered: 0,
            contractedMinutesRemaining: 0
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
        courseType: normalizeCourseType(input.courseType, { required: true }),
        durationDays: normalizeDurationDays(input.durationDays),
        status: cleanOptionalString(input.status, 'active') || 'active',
        agentCommissionBps: normalizeCommissionBps(input.agentCommissionBps),
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
    if (Object.prototype.hasOwnProperty.call(input || {}, 'courseType')) {
        // Not `required` here: legacy courses predate the field and may be patched for
        // unrelated reasons before the migration reaches them.
        patch.courseType = normalizeCourseType(input.courseType);
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'durationDays')) {
        patch.durationDays = normalizeDurationDays(input.durationDays);
    }
    if (Object.prototype.hasOwnProperty.call(input || {}, 'agentCommissionBps')) {
        patch.agentCommissionBps = normalizeCommissionBps(input.agentCommissionBps);
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
    let agentCommissionBps = null;
    try {
        agentCommissionBps = normalizeCommissionBps(data.agentCommissionBps);
    } catch (_error) {
        agentCommissionBps = null;
    }
    return {
        courseId: courseId || doc?.id || null,
        name: data.name || '',
        code: data.code || null,
        label: data.label || null,
        level: data.level || null,
        category: data.category || null,
        courseType: COURSE_TYPES.includes(String(data.courseType || '').toLowerCase().replace(/\.$/, ''))
            ? String(data.courseType).toLowerCase().replace(/\.$/, '')
            : null,
        durationDays: Number.isInteger(Number(data.durationDays)) && Number(data.durationDays) > 0 ? Number(data.durationDays) : null,
        status: data.status || 'active',
        agentCommissionBps,
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
        classKind: cleanOptionalString(input.classKind, 'group') || 'group',
        studentId: cleanOptionalString(input.studentId),
        studentUid: cleanOptionalString(input.studentUid),
        status: cleanOptionalString(input.status, 'draft') || 'draft',
        meetingDays: normalizeStringList(input.meetingDays),
        meetingHours: normalizeStringList(input.meetingHours),
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
    for (const key of ['name', 'courseId', 'status', 'primaryTeacherUid', 'classKind', 'studentId', 'studentUid']) {
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
    if (Object.prototype.hasOwnProperty.call(input || {}, 'scheduleConfig')) {
        patch.scheduleConfig = normalizeScheduleConfig(input.scheduleConfig, {
            existing: existing?.scheduleConfig || null,
            preserveExistingTargetSessionCount: true
        });
        if (existing?.scheduleSummary) {
            const targetCount = patch.scheduleConfig.targetSessionCount || 0;
            const assignedCount = Number(existing.scheduleSummary.contractedAssignedCount || 0);
            patch.scheduleSummary = {
                ...existing.scheduleSummary,
                contractedTargetCount: targetCount,
                remainingToScheduleCount: Math.max(targetCount - assignedCount, 0),
                contractedMinutesTotal: Number(patch.scheduleConfig.totalInstructionMinutes || 0) || existing.scheduleSummary.contractedMinutesTotal || 0,
                contractedMinutesRemaining: Math.max(
                    (Number(patch.scheduleConfig.totalInstructionMinutes || 0) || existing.scheduleSummary.contractedMinutesTotal || 0) -
                    Number(existing.scheduleSummary.contractedMinutesDelivered || 0),
                    0
                )
            };
        } else {
            patch.scheduleSummary = buildEmptyScheduleSummary(patch.scheduleConfig);
        }
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
        classKind: data.classKind || 'group',
        studentId: data.studentId || null,
        studentUid: data.studentUid || null,
        status: data.status || 'draft',
        meetingDays: normalizeStringList(data.meetingDays),
        meetingHours: normalizeStringList(data.meetingHours),
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
    COURSE_TYPES,
    normalizeCourseType,
    normalizeDurationDays,
    buildCourseCreateData,
    buildCoursePatchData,
    buildClassroomCreateData,
    buildClassroomPatchData,
    buildEmptyScheduleSummary,
    computeMissingReviewItems,
    mapClassroomMembers,
    mapClassroomRecord,
    mapCourseRecord,
    normalizeCommissionBps,
    normalizeScheduleConfig,
    normalizeStringList,
    sanitizeTeachers
};
