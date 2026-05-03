const {
    USERS,
    CRM_STUDENTS,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_LEADS,
    CRM_ENROLLMENTS,
    CRM_SCHEDULED_SESSIONS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_SUBMISSIONS,
    CRM_TASKS,
    CRM_ACTIVITIES,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_TEMPLATES,
    CRM_AUTOMATION_RULES,
    ENTRANCE_TESTS,
    ENTRANCE_TEST_LINK_RECOVERY,
    CLASSROOM_MODULES,
    CLASSROOM_CLASSWORK,
    CLASSROOM_MEMBERS,
    CLASSROOM_LIVE_SESSIONS
} = require('../../functions/src/crm/collections');

const SYNCABLE_COLLECTIONS = Object.freeze({
    [USERS]: { subcollections: [] },
    [CRM_STUDENTS]: { subcollections: [] },
    [CRM_COURSES]: { subcollections: [] },
    [CRM_CLASSROOMS]: { subcollections: [CLASSROOM_MODULES, CLASSROOM_CLASSWORK, CLASSROOM_MEMBERS, CLASSROOM_LIVE_SESSIONS] },
    [CRM_LEADS]: { subcollections: [] },
    [CRM_ENROLLMENTS]: { subcollections: [] },
    [CRM_SCHEDULED_SESSIONS]: { subcollections: [] },
    [CRM_ATTENDANCE_SESSIONS]: { subcollections: [] },
    [CRM_ATTENDANCE_RECORDS]: { subcollections: [] },
    [CRM_SUBMISSIONS]: { subcollections: [] },
    [CRM_TASKS]: { subcollections: [] },
    [CRM_ACTIVITIES]: { subcollections: [] },
    [CRM_INVOICES]: { subcollections: [] },
    [CRM_PAYMENTS]: { subcollections: [] },
    [CRM_COMMISSIONS]: { subcollections: [] },
    [CRM_TEMPLATES]: { subcollections: [] },
    [CRM_AUTOMATION_RULES]: { subcollections: [] },
    [ENTRANCE_TESTS]: { subcollections: [] },
    [ENTRANCE_TEST_LINK_RECOVERY]: { subcollections: [] }
});

function listSyncableCollections() {
    return Object.entries(SYNCABLE_COLLECTIONS)
        .map(([name, config]) => ({
            name,
            subcollections: [...(config.subcollections || [])],
            hasSubcollections: Array.isArray(config.subcollections) && config.subcollections.length > 0
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

module.exports = {
    SYNCABLE_COLLECTIONS,
    listSyncableCollections
};
