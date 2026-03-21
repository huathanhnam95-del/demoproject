const { normalizeStringList } = require('./course-service');
const { hydrateStudentSchedule, hydrateClassroomSchedule } = require('./schedule-normalizer');

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeAvailabilityList(value) {
    return normalizeStringList(value);
}

function toLookupSet(values) {
    return new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function intersectValues(left, right) {
    const leftList = Array.isArray(left) ? left : [];
    const rightLookup = toLookupSet(right);
    const seen = new Set();
    const matches = [];

    for (const item of leftList) {
        const normalized = cleanOptionalString(item);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (!rightLookup.has(key) || seen.has(key)) continue;
        seen.add(key);
        matches.push(normalized);
    }

    return matches;
}

function buildMatchReasonList({ studentDays, studentHours, classroomDays, classroomHours, dayOverlap, hourOverlap, courseMatch }) {
    const reasons = [];
    const warnings = [];

    if (courseMatch) {
        reasons.push('Course matches the requested course.');
    }

    if (dayOverlap.length) {
        reasons.push(`Shares ${dayOverlap.length} preferred day${dayOverlap.length === 1 ? '' : 's'}.`);
    } else if (studentDays.length && classroomDays.length) {
        warnings.push('No overlapping preferred days.');
    } else {
        warnings.push('Day availability is incomplete.');
    }

    if (hourOverlap.length) {
        reasons.push(`Shares ${hourOverlap.length} preferred hour slot${hourOverlap.length === 1 ? '' : 's'}.`);
    } else if (studentHours.length && classroomHours.length) {
        warnings.push('No overlapping preferred hours.');
    } else {
        warnings.push('Hour availability is incomplete.');
    }

    if (!studentDays.length || !studentHours.length) {
        warnings.push('Student availability is only partially structured.');
    }
    if (!classroomDays.length || !classroomHours.length) {
        warnings.push('Classroom schedule is only partially structured.');
    }

    return {
        reasons: Array.from(new Set(reasons)),
        warnings: Array.from(new Set(warnings))
    };
}

function scoreClassroomMatch(student, classroom, context = {}) {
    const hydratedStudent = hydrateStudentSchedule(student || {});
    const hydratedClassroom = hydrateClassroomSchedule(classroom || {});
    const studentDays = normalizeAvailabilityList(hydratedStudent.preferredLearningDays);
    const studentHours = normalizeAvailabilityList(hydratedStudent.preferredLearningHours);
    const classroomDays = normalizeAvailabilityList(hydratedClassroom.meetingDays);
    const classroomHours = normalizeAvailabilityList(hydratedClassroom.meetingHours);
    const requestedCourseId = cleanOptionalString(context.courseId);
    const classroomCourseId = cleanOptionalString(classroom?.courseId);
    const courseMatch = !!requestedCourseId && requestedCourseId === classroomCourseId;

    const dayOverlap = intersectValues(studentDays, classroomDays);
    const hourOverlap = intersectValues(studentHours, classroomHours);

    let fitScore = 0;
    if (courseMatch) {
        fitScore += 25;
    }

    if (studentDays.length && classroomDays.length) {
        const denominator = Math.max(studentDays.length, classroomDays.length);
        const ratio = denominator > 0 ? (dayOverlap.length / denominator) : 0;
        fitScore += Math.round(ratio * 45);
    }

    if (studentHours.length && classroomHours.length) {
        const denominator = Math.max(studentHours.length, classroomHours.length);
        const ratio = denominator > 0 ? (hourOverlap.length / denominator) : 0;
        fitScore += Math.round(ratio * 35);
    }

    const completenessBonus = Number(studentDays.length > 0) + Number(studentHours.length > 0) + Number(classroomDays.length > 0) + Number(classroomHours.length > 0);
    fitScore += Math.min(10, completenessBonus * 2);

    fitScore = Math.max(0, Math.min(100, fitScore));

    const { reasons, warnings } = buildMatchReasonList({
        studentDays,
        studentHours,
        classroomDays,
        classroomHours,
        dayOverlap,
        hourOverlap,
        courseMatch
    });

    return {
        classroomId: classroom?.classroomId || classroom?.id || null,
        name: classroom?.name || 'Classroom',
        courseId: classroomCourseId || null,
        status: cleanOptionalString(classroom?.status) || 'draft',
        meetingDays: classroomDays,
        meetingHours: classroomHours,
        fitScore,
        reasons,
        warnings,
        dayOverlap,
        hourOverlap,
        courseMatch,
        recommended: false
    };
}

function buildClassroomMatches({ student, classrooms, courseId } = {}) {
    const classroomList = Array.isArray(classrooms) ? classrooms : [];
    const activeClassrooms = classroomList.filter((classroom) => cleanOptionalString(classroom?.status) === 'active');
    const requestedCourseId = cleanOptionalString(courseId);
    const filteredClassrooms = requestedCourseId
        ? activeClassrooms.filter((classroom) => cleanOptionalString(classroom?.courseId) === requestedCourseId)
        : activeClassrooms;

    const matches = filteredClassrooms
        .map((classroom) => scoreClassroomMatch(student, classroom, { courseId: requestedCourseId }))
        .sort((left, right) => {
            if (right.fitScore !== left.fitScore) return right.fitScore - left.fitScore;
            if (right.dayOverlap.length !== left.dayOverlap.length) return right.dayOverlap.length - left.dayOverlap.length;
            if (right.hourOverlap.length !== left.hourOverlap.length) return right.hourOverlap.length - left.hourOverlap.length;
            return String(left.name || '').localeCompare(String(right.name || ''));
        })
        .map((match, index) => ({
            ...match,
            recommended: index === 0
        }));

    return {
        studentId: student?.studentId || null,
        courseId: requestedCourseId || null,
        classroomCount: filteredClassrooms.length,
        matches,
        recommendedClassroom: matches[0] || null
    };
}

module.exports = {
    buildClassroomMatches,
    scoreClassroomMatch,
    normalizeAvailabilityList,
    intersectValues
};
