const ACTIVITY_TYPES = [
    'note',
    'call',
    'email',
    'zalo',
    'facebook',
    'meeting',
    'system'
];

const TASK_PRIORITIES = [
    'low',
    'medium',
    'high'
];

const TASK_STATUSES = [
    'open',
    'done',
    'canceled'
];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeEntityRefs(input, fallback = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};

    const refs = {
        leadId: Object.prototype.hasOwnProperty.call(source, 'leadId')
            ? cleanOptionalString(source.leadId)
            : (base.leadId ?? null),
        studentId: Object.prototype.hasOwnProperty.call(source, 'studentId')
            ? cleanOptionalString(source.studentId)
            : (base.studentId ?? null),
        classId: Object.prototype.hasOwnProperty.call(source, 'classId')
            ? cleanOptionalString(source.classId)
            : (base.classId ?? null)
    };

    if (!refs.leadId && !refs.studentId && !refs.classId) {
        throw new Error('Activity must be linked to a lead, student, or classroom.');
    }

    return refs;
}

function normalizeActivityType(value, fallback = 'note') {
    const normalized = cleanOptionalString(value) || fallback;
    if (!ACTIVITY_TYPES.includes(normalized)) {
        throw new Error(`Invalid activity type: ${normalized}`);
    }
    return normalized;
}

function normalizeTaskPriority(value, fallback = 'medium') {
    const normalized = cleanOptionalString(value) || fallback;
    if (!TASK_PRIORITIES.includes(normalized)) {
        throw new Error(`Invalid task priority: ${normalized}`);
    }
    return normalized;
}

function normalizeTaskStatus(value, fallback = 'open') {
    const normalized = cleanOptionalString(value) || fallback;
    if (!TASK_STATUSES.includes(normalized)) {
        throw new Error(`Invalid task status: ${normalized}`);
    }
    return normalized;
}

function normalizeDueAt(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized || fallback;
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }
    return fallback;
}

function buildActivityCreateData(input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const refs = normalizeEntityRefs(payload);
    const subject = cleanOptionalString(payload.subject);
    const body = cleanOptionalString(payload.body);

    if (!subject && !body) {
        throw new Error('Activity subject or body is required.');
    }

    return {
        ...refs,
        type: normalizeActivityType(payload.type),
        subject,
        body,
        actorUid: cleanOptionalString(payload.actorUid) || context.user?.uid || null,
        actorEmail: context.user?.email || null,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date()
    };
}

function buildTaskCreateData(input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const refs = normalizeEntityRefs(payload);
    const title = cleanOptionalString(payload.title);

    if (!title) {
        throw new Error('Task title is required.');
    }

    return {
        ...refs,
        title,
        notes: cleanOptionalString(payload.notes),
        dueAt: normalizeDueAt(payload.dueAt),
        priority: normalizeTaskPriority(payload.priority),
        status: 'open',
        ownerUid: cleanOptionalString(payload.ownerUid) || context.user?.uid || null,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null,
        completedAt: null
    };
}

function buildTaskPatchData(existing, input, context = {}) {
    const payload = input && typeof input === 'object' ? input : {};
    const hasRecognizedPatch = [
        'title',
        'notes',
        'dueAt',
        'priority',
        'status',
        'ownerUid'
    ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

    if (!hasRecognizedPatch) {
        throw new Error('No task fields provided for update.');
    }

    const nextStatus = Object.prototype.hasOwnProperty.call(payload, 'status')
        ? normalizeTaskStatus(payload.status, existing?.status || 'open')
        : (existing?.status || 'open');

    const wasDone = String(existing?.status || '') === 'done';
    const isDone = nextStatus === 'done';

    return {
        ...existing,
        title: Object.prototype.hasOwnProperty.call(payload, 'title') ? cleanOptionalString(payload.title) : (existing?.title || null),
        notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? cleanOptionalString(payload.notes) : (existing?.notes ?? null),
        dueAt: Object.prototype.hasOwnProperty.call(payload, 'dueAt') ? normalizeDueAt(payload.dueAt) : (existing?.dueAt ?? null),
        priority: Object.prototype.hasOwnProperty.call(payload, 'priority')
            ? normalizeTaskPriority(payload.priority, existing?.priority || 'medium')
            : (existing?.priority || 'medium'),
        status: nextStatus,
        ownerUid: Object.prototype.hasOwnProperty.call(payload, 'ownerUid')
            ? cleanOptionalString(payload.ownerUid)
            : (existing?.ownerUid ?? null),
        updatedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        updatedBy: context.user?.uid || null,
        completedAt: isDone
            ? (wasDone ? (existing?.completedAt ?? (context.serverTimestamp ? context.serverTimestamp() : new Date())) : (context.serverTimestamp ? context.serverTimestamp() : new Date()))
            : null
    };
}

function mapActivityRecord(doc, activityId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        activityId: activityId || doc?.id || null,
        leadId: data.leadId || null,
        studentId: data.studentId || null,
        classId: data.classId || null,
        type: data.type || 'note',
        subject: data.subject || null,
        body: data.body || null,
        actorUid: data.actorUid || null,
        actorEmail: data.actorEmail || null,
        createdAt: data.createdAt || null
    };
}

function mapTaskRecord(doc, taskId) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : (doc || {});
    return {
        taskId: taskId || doc?.id || null,
        leadId: data.leadId || null,
        studentId: data.studentId || null,
        classId: data.classId || null,
        title: data.title || null,
        notes: data.notes || null,
        dueAt: data.dueAt || null,
        priority: data.priority || 'medium',
        status: data.status || 'open',
        ownerUid: data.ownerUid || null,
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null,
        completedAt: data.completedAt || null
    };
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.getTime() : null;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?._seconds === 'number') return value._seconds * 1000;
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return null;
}

function summarizeTasks(tasks, now = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : toMillis(now) || Date.now();
    const openTasks = (tasks || []).filter((task) => String(task?.status || 'open') === 'open');
    let overdueCount = 0;
    let nextActionAt = null;
    let nextActionMs = null;

    for (const task of openTasks) {
        const dueMs = toMillis(task?.dueAt);
        if (dueMs !== null) {
            if (dueMs < nowMs) {
                overdueCount += 1;
            }
            if (nextActionMs === null || dueMs < nextActionMs) {
                nextActionMs = dueMs;
                nextActionAt = task.dueAt;
            }
        }
    }

    return {
        openCount: openTasks.length,
        overdueCount,
        nextActionAt
    };
}

module.exports = {
    ACTIVITY_TYPES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    buildActivityCreateData,
    buildTaskCreateData,
    buildTaskPatchData,
    mapActivityRecord,
    mapTaskRecord,
    summarizeTasks
};
