(function (globalScope) {
    'use strict';
    const phases = new Set(['dirty', 'saving', 'saved', 'error', 'conflict', 'uncertain', 'cancelled']);
    const scopeKey = scope => JSON.stringify([scope?.actorUid || '', scope?.projectId || '', scope?.epoch]);
    const keyFor = (taskId, field) => JSON.stringify([String(taskId), String(field)]);

    // Metadata only: no task values, drafts, authority, network calls or retry owner.
    function createStore(initialScope) {
        let scope = scopeKey(initialScope), disposed = false;
        const records = new Map(), listeners = new Set();
        const notify = () => listeners.forEach(listener => { try { listener(); } catch (_) { /* isolate observers */ } });
        return {
            setScope(next) {
                if (disposed || scope === scopeKey(next)) return;
                scope = scopeKey(next); records.clear(); notify();
            },
            accept(event) {
                if (disposed || !event || scopeKey(event.scope) !== scope || !phases.has(event.phase)
                    || !event.taskId || !event.field || !Number.isSafeInteger(event.editVersion) || event.editVersion < 1) return false;
                const key = keyFor(event.taskId, event.field), previous = records.get(key);
                if (previous && event.editVersion < previous.editVersion) return false;
                if (previous && event.editVersion === previous.editVersion) {
                    if (!['dirty', 'saving'].includes(previous.phase)) return false;
                    if (previous.phase === 'saving' && event.phase === 'dirty') return false;
                    if (previous.operationId && event.operationId !== previous.operationId) return false;
                }
                records.set(key, Object.freeze({ taskId: String(event.taskId), field: String(event.field), editVersion: event.editVersion,
                    phase: event.phase, operationId: event.operationId || null, reason: event.reason || null, message: event.message || null }));
                notify(); return true;
            },
            get: (taskId, field) => records.get(keyFor(taskId, field)) || null,
            getSnapshot: () => Array.from(records.values()),
            subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
            clear() { records.clear(); notify(); },
            dispose() { disposed = true; records.clear(); listeners.clear(); }
        };
    }
    globalScope.CrmProjectsFieldFeedbackV2 = { createStore };
})(typeof window !== 'undefined' ? window : globalThis);
