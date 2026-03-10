window.CrmActivities = (function () {
    const ACTIVITY_TYPES = ['note', 'call', 'email', 'zalo', 'facebook', 'meeting', 'system'];
    const TASK_PRIORITIES = ['low', 'medium', 'high'];

    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function normalizeDateTimeLocal(value) {
        const normalized = String(value || '').trim();
        if (!normalized) return null;
        const date = new Date(normalized);
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }

    function buildTaskPayload(elements) {
        return {
            title: getValue(elements.inputTaskTitle),
            dueAt: normalizeDateTimeLocal(elements.inputTaskDueAt?.value),
            priority: getValue(elements.inputTaskPriority) || 'medium'
        };
    }

    function buildActivityPayload(elements) {
        return {
            type: getValue(elements.inputActivityType) || 'note',
            subject: getValue(elements.inputActivitySubject),
            body: getValue(elements.inputActivityBody)
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
        const nowMs = now instanceof Date ? now.getTime() : (toMillis(now) || Date.now());
        const openTasks = (tasks || []).filter((task) => String(task?.status || 'open') === 'open');
        let overdueCount = 0;
        let nextActionAt = null;
        let nextActionMs = null;

        openTasks.forEach((task) => {
            const dueMs = toMillis(task?.dueAt);
            if (dueMs === null) return;
            if (dueMs < nowMs) overdueCount += 1;
            if (nextActionMs === null || dueMs < nextActionMs) {
                nextActionMs = dueMs;
                nextActionAt = task.dueAt;
            }
        });

        return {
            openCount: openTasks.length,
            overdueCount,
            nextActionAt
        };
    }

    function getBadgeLabel(summary) {
        if ((summary?.overdueCount || 0) > 0) return `Overdue ${summary.overdueCount}`;
        if (summary?.nextActionAt) return 'Next action due';
        return 'No reminders';
    }

    function getBadgeTone(summary) {
        if ((summary?.overdueCount || 0) > 0) return 'overdue';
        if (summary?.nextActionAt) return 'upcoming';
        return 'quiet';
    }

    function formatTypeLabel(value) {
        const normalized = String(value || '').trim();
        return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Note';
    }

    function formatPriorityLabel(value) {
        const normalized = String(value || 'medium').trim().toLowerCase();
        return TASK_PRIORITIES.includes(normalized) ? normalized : 'medium';
    }

    return {
        ACTIVITY_TYPES,
        TASK_PRIORITIES,
        buildTaskPayload,
        buildActivityPayload,
        summarizeTasks,
        getBadgeLabel,
        getBadgeTone,
        formatTypeLabel,
        formatPriorityLabel
    };
})();
