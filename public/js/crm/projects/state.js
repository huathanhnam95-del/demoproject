(function (globalScope) {
    'use strict';

    function createBoardState() {
        let projectId = '';
        let generation = 0;
        const pending = new Map();
        const drafts = new Map();
        const queues = new Map();
        const branches = new Map();
        let selectedTaskId = '';
        let selectedTaskIds = [];
        let focusId = '';
        let scrollTop = 0;
        let expanded = new Set();

        function key(id) { return JSON.stringify([projectId, String(id || '')]); }
        function draftKey(taskId, field) { return JSON.stringify([projectId, 'draft', String(taskId || ''), String(field || '')]); }
        function branchKey(parentTaskId) { return parentTaskId || '__root__'; }
        function switchProject(nextProjectId) {
            const normalized = String(nextProjectId || '').trim();
            if (normalized === projectId) return generation;
            projectId = normalized;
            generation += 1;
            selectedTaskId = '';
            selectedTaskIds = [];
            focusId = '';
            scrollTop = 0;
            expanded = new Set();
            branches.clear();
            for (const existingKey of drafts.keys()) {
                try { if (JSON.parse(existingKey)[0] !== projectId) drafts.delete(existingKey); } catch (_) { drafts.delete(existingKey); }
            }
            return generation;
        }
        function beginRefresh() { return { projectId, generation }; }
        function isCurrent(token) { return !!token && token.projectId === projectId && token.generation === generation; }
        function beginMutation(taskId) {
            const token = { projectId, generation, taskId: String(taskId || ''), operationKey: key(taskId) };
            pending.set(token.operationKey, token);
            return token;
        }
        function isMutationCurrent(token) { return isCurrent(token) && pending.get(token.operationKey) === token; }
        function finishMutation(token) { if (pending.get(token?.operationKey) === token) pending.delete(token.operationKey); }
        function enqueueMutation(token, operation) {
            const queueKey = token?.operationKey || key(token?.taskId);
            const prior = queues.get(queueKey) || Promise.resolve();
            const next = prior.catch(() => {}).then(() => operation(token));
            queues.set(queueKey, next);
            next.then(() => { if (queues.get(queueKey) === next) queues.delete(queueKey); }, () => { if (queues.get(queueKey) === next) queues.delete(queueKey); });
            return next;
        }
        function setDraft(taskId, field, value) { drafts.set(draftKey(taskId, field), value); }
        function getDraft(taskId, field) { return drafts.get(draftKey(taskId, field)); }
        function hasDraft(taskId, field) { return drafts.has(draftKey(taskId, field)); }
        function clearDraft(taskId, field) { drafts.delete(draftKey(taskId, field)); }
        function setBranch(parentTaskId, cursor, hasMore) { branches.set(branchKey(parentTaskId), { cursor: cursor || null, hasMore: hasMore === true }); }
        function getBranch(parentTaskId) { return branches.get(branchKey(parentTaskId)) || { cursor: null, hasMore: false }; }
        function setView(next = {}) {
            if (next.selectedTaskId !== undefined) selectedTaskId = String(next.selectedTaskId || '');
            if (next.focusId !== undefined) focusId = String(next.focusId || '');
            if (next.scrollTop !== undefined) scrollTop = Number(next.scrollTop) || 0;
            if (next.expanded) expanded = new Set(Array.from(next.expanded, (value) => String(value)));
        }
        function setSelectedTaskIds(ids) {
            if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())) throw new TypeError('Task selection requires task IDs.');
            const next = [...new Set(ids.map(id => id.trim()))];
            if (next.length > 20) throw new RangeError('Select at most 20 tasks.');
            selectedTaskIds = next;
            return selectedTaskIds.slice();
        }
        function getView() { return { selectedTaskIds: selectedTaskIds.slice(), selectedTaskId, focusId, scrollTop, expanded: new Set(expanded) }; }
        function getState() { return { projectId, generation, pending: new Map(pending), drafts: new Map(drafts), branches: new Map(branches), ...getView() }; }
        return { switchProject, beginRefresh, isCurrent, beginMutation, isMutationCurrent, finishMutation, enqueueMutation, setDraft, getDraft, hasDraft, clearDraft, setBranch, getBranch, setSelectedTaskIds, setView, getView, getState };
    }

    globalScope.CrmProjectsBoardState = { createBoardState };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = { createBoardState: globalThis.CrmProjectsBoardState.createBoardState };
