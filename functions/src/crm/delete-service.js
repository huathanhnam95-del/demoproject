const {
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_TASKS,
    CRM_ACTIVITIES,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_SCHEDULED_SESSIONS,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_SUBMISSIONS,
    ENTRANCE_TESTS,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS,
    CLASSROOM_LIVE_SESSIONS
} = require('./collections');

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function uniqueIds(values) {
    const seen = new Set();
    const ids = [];
    for (const value of Array.isArray(values) ? values : []) {
        const id = cleanOptionalString(value);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

function chunkArray(values, size = 10) {
    const list = Array.isArray(values) ? values : [];
    const out = [];
    for (let index = 0; index < list.length; index += size) {
        out.push(list.slice(index, index + size));
    }
    return out;
}

function makeEmptyPreview(requestedIds) {
    return {
        requestedIds,
        deletableIds: [],
        deletedIds: [],
        notFoundIds: [],
        blocked: []
    };
}

function addBlock(blockedMap, id, reason) {
    if (!reason || !reason.count) return;
    if (!blockedMap.has(id)) blockedMap.set(id, []);
    blockedMap.get(id).push(reason);
}

async function fetchDocMap(db, collectionName, ids) {
    const map = new Map();
    await Promise.all(uniqueIds(ids).map(async (id) => {
        const snap = await db.collection(collectionName).doc(id).get();
        if (snap.exists) {
            map.set(id, snap.data() || {});
        }
    }));
    return map;
}

async function countByField(db, collectionName, fieldName, ids) {
    const out = new Map(uniqueIds(ids).map((id) => [id, 0]));
    for (const chunk of chunkArray(uniqueIds(ids), 10)) {
        const snap = await db.collection(collectionName).where(fieldName, 'in', chunk).get();
        snap.docs.forEach((doc) => {
            const value = cleanOptionalString(doc.data()?.[fieldName]);
            if (!value || !out.has(value)) return;
            out.set(value, out.get(value) + 1);
        });
    }
    return out;
}

async function countNestedSubcollection(db, parentCollection, subcollectionName, parentIds) {
    const out = new Map(uniqueIds(parentIds).map((id) => [id, 0]));
    await Promise.all(uniqueIds(parentIds).map(async (id) => {
        const snap = await db.collection(parentCollection).doc(id).collection(subcollectionName).get();
        out.set(id, snap.size || snap.docs.length || 0);
    }));
    return out;
}

async function countNestedTopLevel(db, collectionName, fieldName, ids) {
    return countByField(db, collectionName, fieldName, ids);
}

function buildBlockedItem(id, reasons) {
    return {
        id,
        reasons: Array.isArray(reasons) ? reasons : []
    };
}

async function previewLeadDelete(db, requestedIds) {
    const ids = uniqueIds(requestedIds);
    const result = makeEmptyPreview(ids);
    const leadDocs = await fetchDocMap(db, CRM_LEADS, ids);
    const leadIds = ids.filter((id) => leadDocs.has(id));
    const notFoundIds = ids.filter((id) => !leadDocs.has(id));
    result.notFoundIds = notFoundIds;

    const linkedStudentCounts = await countByField(db, CRM_STUDENTS, 'leadId', leadIds);
    const entranceTestCounts = await countByField(db, ENTRANCE_TESTS, 'leadId', leadIds);
    const taskCounts = await countByField(db, CRM_TASKS, 'leadId', leadIds);
    const activityCounts = await countByField(db, CRM_ACTIVITIES, 'leadId', leadIds);

    const blockedMap = new Map();
    for (const id of leadIds) {
        const lead = leadDocs.get(id) || {};
        addBlock(blockedMap, id, { code: 'linked_student', label: 'Linked student', count: lead.studentId ? 1 : 0 });
        addBlock(blockedMap, id, { code: 'student_reference', label: 'Student references this lead', count: Number(linkedStudentCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'entrance_tests', label: 'Entrance tests', count: Number(entranceTestCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'tasks', label: 'Tasks', count: Number(taskCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'activities', label: 'Activities', count: Number(activityCounts.get(id) || 0) });
    }

    for (const [id, reasons] of blockedMap.entries()) {
        if (reasons.length > 0) {
            result.blocked.push(buildBlockedItem(id, reasons));
        }
    }

    result.deletableIds = leadIds.filter((id) => !blockedMap.has(id));
    return result;
}

async function previewStudentDelete(db, requestedIds) {
    const ids = uniqueIds(requestedIds);
    const result = makeEmptyPreview(ids);
    const studentDocs = await fetchDocMap(db, CRM_STUDENTS, ids);
    const studentIds = ids.filter((id) => studentDocs.has(id));
    const notFoundIds = ids.filter((id) => !studentDocs.has(id));
    result.notFoundIds = notFoundIds;

    const entranceTestCounts = await countByField(db, ENTRANCE_TESTS, 'studentId', studentIds);
    const enrollmentCounts = await countByField(db, CRM_ENROLLMENTS, 'studentId', studentIds);
    const attendanceSessionCounts = await countByField(db, CRM_ATTENDANCE_SESSIONS, 'studentId', studentIds);
    const attendanceRecordCounts = await countByField(db, CRM_ATTENDANCE_RECORDS, 'studentId', studentIds);
    const invoiceCounts = await countByField(db, CRM_INVOICES, 'studentId', studentIds);
    const paymentCounts = await countByField(db, CRM_PAYMENTS, 'studentId', studentIds);
    const commissionCounts = await countByField(db, CRM_COMMISSIONS, 'studentId', studentIds);
    const taskCounts = await countByField(db, CRM_TASKS, 'studentId', studentIds);
    const activityCounts = await countByField(db, CRM_ACTIVITIES, 'studentId', studentIds);

    const blockedMap = new Map();
    for (const id of studentIds) {
        const student = studentDocs.get(id) || {};
        addBlock(blockedMap, id, { code: 'entrance_tests', label: 'Entrance tests', count: Number(entranceTestCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'enrollments', label: 'Enrollments', count: Number(enrollmentCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'attendance_sessions', label: 'Attendance sessions', count: Number(attendanceSessionCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'attendance_records', label: 'Attendance records', count: Number(attendanceRecordCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'invoices', label: 'Invoices', count: Number(invoiceCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'payments', label: 'Payments', count: Number(paymentCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'commissions', label: 'Commissions', count: Number(commissionCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'tasks', label: 'Tasks', count: Number(taskCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'activities', label: 'Activities', count: Number(activityCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'linked_users', label: 'Linked user IDs', count: Array.isArray(student.linked_user_ids) ? student.linked_user_ids.length : 0 });
    }

    for (const [id, reasons] of blockedMap.entries()) {
        if (reasons.length > 0) {
            result.blocked.push(buildBlockedItem(id, reasons));
        }
    }

    result.deletableIds = studentIds.filter((id) => !blockedMap.has(id));
    return result;
}

async function previewCourseDelete(db, requestedIds) {
    const ids = uniqueIds(requestedIds);
    const result = makeEmptyPreview(ids);
    const courseDocs = await fetchDocMap(db, CRM_COURSES, ids);
    const courseIds = ids.filter((id) => courseDocs.has(id));
    result.notFoundIds = ids.filter((id) => !courseDocs.has(id));

    const classroomCounts = await countByField(db, CRM_CLASSROOMS, 'courseId', courseIds);
    const invoiceCounts = await countByField(db, CRM_INVOICES, 'courseId', courseIds);
    const paymentCounts = await countByField(db, CRM_PAYMENTS, 'courseId', courseIds);

    const blockedMap = new Map();
    for (const id of courseIds) {
        addBlock(blockedMap, id, { code: 'classrooms', label: 'Classrooms', count: Number(classroomCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'invoices', label: 'Invoices', count: Number(invoiceCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'payments', label: 'Payments', count: Number(paymentCounts.get(id) || 0) });
    }

    for (const [id, reasons] of blockedMap.entries()) {
        if (reasons.length > 0) {
            result.blocked.push(buildBlockedItem(id, reasons));
        }
    }

    result.deletableIds = courseIds.filter((id) => !blockedMap.has(id));
    return result;
}

async function previewClassroomDelete(db, requestedIds) {
    const ids = uniqueIds(requestedIds);
    const result = makeEmptyPreview(ids);
    const classroomDocs = await fetchDocMap(db, CRM_CLASSROOMS, ids);
    const classroomIds = ids.filter((id) => classroomDocs.has(id));
    result.notFoundIds = ids.filter((id) => !classroomDocs.has(id));

    const enrollmentCounts = await countByField(db, CRM_ENROLLMENTS, 'classId', classroomIds);
    const attendanceSessionCounts = await countByField(db, CRM_ATTENDANCE_SESSIONS, 'classId', classroomIds);
    const attendanceRecordCounts = await countByField(db, CRM_ATTENDANCE_RECORDS, 'classId', classroomIds);
    const scheduledSessionCounts = await countByField(db, CRM_SCHEDULED_SESSIONS, 'classId', classroomIds);
    const liveSessionCounts = await countByField(db, CLASSROOM_LIVE_SESSIONS, 'classId', classroomIds);
    const submissionCounts = await countByField(db, CRM_SUBMISSIONS, 'classId', classroomIds);
    const nestedModuleCounts = await countNestedSubcollection(db, CRM_CLASSROOMS, CLASSROOM_MODULES, classroomIds);
    const nestedClassworkCounts = await countNestedSubcollection(db, CRM_CLASSROOMS, CLASSROOM_CLASSWORK, classroomIds);
    const nestedMemberCounts = await countNestedSubcollection(db, CRM_CLASSROOMS, CLASSROOM_MEMBERS, classroomIds);

    const blockedMap = new Map();
    for (const id of classroomIds) {
        addBlock(blockedMap, id, { code: 'enrollments', label: 'Enrollments', count: Number(enrollmentCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'attendance_sessions', label: 'Attendance sessions', count: Number(attendanceSessionCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'attendance_records', label: 'Attendance records', count: Number(attendanceRecordCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'scheduled_sessions', label: 'Scheduled sessions', count: Number(scheduledSessionCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'live_sessions', label: 'Live sessions', count: Number(liveSessionCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'members', label: 'Members', count: Number(nestedMemberCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'modules', label: 'Modules', count: Number(nestedModuleCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'classwork', label: 'Classwork', count: Number(nestedClassworkCounts.get(id) || 0) });
        addBlock(blockedMap, id, { code: 'submissions', label: 'Submissions', count: Number(submissionCounts.get(id) || 0) });
    }

    for (const [id, reasons] of blockedMap.entries()) {
        if (reasons.length > 0) {
            result.blocked.push(buildBlockedItem(id, reasons));
        }
    }

    result.deletableIds = classroomIds.filter((id) => !blockedMap.has(id));
    return result;
}

async function previewBulkDelete(db, kind, requestedIds) {
    const entity = String(kind || '').trim().toLowerCase();
    if (entity === 'lead' || entity === 'leads') return previewLeadDelete(db, requestedIds);
    if (entity === 'student' || entity === 'students') return previewStudentDelete(db, requestedIds);
    if (entity === 'course' || entity === 'courses') return previewCourseDelete(db, requestedIds);
    if (entity === 'classroom' || entity === 'classrooms') return previewClassroomDelete(db, requestedIds);
    throw new Error(`Unsupported bulk delete entity: ${kind}`);
}

async function executeBulkDelete(db, kind, requestedIds, options = {}) {
    const preview = await previewBulkDelete(db, kind, requestedIds);
    const force = options?.force === true;
    const existingIds = uniqueIds(preview.requestedIds).filter((id) => !Array.isArray(preview.notFoundIds) || !preview.notFoundIds.includes(id));
    const deletableIds = force
        ? existingIds
        : Array.isArray(preview.deletableIds) ? preview.deletableIds : [];
    const deletedIds = [];

    for (const id of deletableIds) {
        const entity = String(kind || '').trim().toLowerCase();
        const collectionName = entity === 'lead' || entity === 'leads'
            ? CRM_LEADS
            : entity === 'student' || entity === 'students'
                ? CRM_STUDENTS
                : entity === 'course' || entity === 'courses'
                    ? CRM_COURSES
                    : CRM_CLASSROOMS;
        const ref = db.collection(collectionName).doc(id);
        const snap = await ref.get();
        if (!snap.exists) continue;
        await ref.delete();
        deletedIds.push(id);
    }

    return {
        ...preview,
        force,
        deletedIds
    };
}

module.exports = {
    previewBulkDelete,
    executeBulkDelete
};
