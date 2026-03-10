const {
    CRM_ACTIVITIES,
    CRM_TASKS
} = require('../../crm/collections');
const {
    buildActivityCreateData,
    buildTaskCreateData,
    buildTaskPatchData,
    mapActivityRecord,
    mapTaskRecord
} = require('../../crm/activity-service');

function matchesFilter(record, filters) {
    if (filters.leadId && String(record?.leadId || '') !== filters.leadId) return false;
    if (filters.studentId && String(record?.studentId || '') !== filters.studentId) return false;
    if (filters.classId && String(record?.classId || '') !== filters.classId) return false;
    if (filters.status && String(record?.status || '') !== filters.status) return false;
    return true;
}

function sortNewestFirst(left, right) {
    const leftMs = left?.createdAt?.toMillis ? left.createdAt.toMillis() : new Date(left?.createdAt || 0).getTime() || 0;
    const rightMs = right?.createdAt?.toMillis ? right.createdAt.toMillis() : new Date(right?.createdAt || 0).getTime() || 0;
    return rightMs - leftMs;
}

module.exports = function registerActivityRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/activities', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 50;
            const filters = {
                leadId: String(req.query?.leadId || '').trim(),
                studentId: String(req.query?.studentId || '').trim(),
                classId: String(req.query?.classId || '').trim()
            };

            const snap = await db.collection(CRM_ACTIVITIES).orderBy('createdAt', 'desc').limit(Math.min(500, limit * 5)).get();
            const activities = snap.docs
                .map((doc) => mapActivityRecord(doc, doc.id))
                .filter((record) => matchesFilter(record, filters))
                .sort(sortNewestFirst)
                .slice(0, limit);

            return sendSuccess(res, { activities, count: activities.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_ACTIVITIES_ERROR', 'Failed to list activities.', error?.message || error);
        }
    });

    router.post('/activities', ...requireAdminHandlers, async (req, res) => {
        try {
            const activity = buildActivityCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_ACTIVITIES).doc();
            await ref.set(activity);
            await writeAuditLog?.({
                action: 'activity.create',
                entityType: 'activity',
                entityId: ref.id,
                metadata: {
                    leadId: activity.leadId || null,
                    studentId: activity.studentId || null,
                    classId: activity.classId || null
                }
            }, { user: req.user });
            return sendSuccess(res, { activityId: ref.id }, 'Activity created.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Activity must be linked') || message.includes('Activity subject or body is required') || message.includes('Invalid activity type')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_ACTIVITY_ERROR', 'Failed to create activity.', error?.message || error);
        }
    });

    router.get('/tasks', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 100;
            const filters = {
                leadId: String(req.query?.leadId || '').trim(),
                studentId: String(req.query?.studentId || '').trim(),
                classId: String(req.query?.classId || '').trim(),
                status: String(req.query?.status || '').trim()
            };

            const snap = await db.collection(CRM_TASKS).orderBy('createdAt', 'desc').limit(Math.min(500, limit * 5)).get();
            const tasks = snap.docs
                .map((doc) => mapTaskRecord(doc, doc.id))
                .filter((record) => matchesFilter(record, filters))
                .sort(sortNewestFirst)
                .slice(0, limit);

            return sendSuccess(res, { tasks, count: tasks.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_TASKS_ERROR', 'Failed to list tasks.', error?.message || error);
        }
    });

    router.post('/tasks', ...requireAdminHandlers, async (req, res) => {
        try {
            const task = buildTaskCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_TASKS).doc();
            await ref.set(task);
            await writeAuditLog?.({
                action: 'task.create',
                entityType: 'task',
                entityId: ref.id,
                metadata: {
                    leadId: task.leadId || null,
                    studentId: task.studentId || null,
                    classId: task.classId || null
                }
            }, { user: req.user });
            return sendSuccess(res, { taskId: ref.id }, 'Task created.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('Activity must be linked') || message.includes('Task title is required') || message.includes('Invalid task')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_TASK_ERROR', 'Failed to create task.', error?.message || error);
        }
    });

    router.patch('/tasks/:taskId', ...requireAdminHandlers, async (req, res) => {
        try {
            const taskId = String(req.params.taskId || '').trim();
            if (!taskId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing taskId.');
            }

            const ref = db.collection(CRM_TASKS).doc(taskId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
            }

            const next = buildTaskPatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog?.({
                action: 'task.update',
                entityType: 'task',
                entityId: taskId,
                metadata: { status: next.status || null }
            }, { user: req.user });
            const updatedSnap = await ref.get();
            return sendSuccess(res, { task: mapTaskRecord(updatedSnap, taskId) }, 'Task updated.');
        } catch (error) {
            const message = String(error?.message || '');
            if (message.includes('No task fields provided') || message.includes('Invalid task')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_TASK_ERROR', 'Failed to update task.', error?.message || error);
        }
    });
};
