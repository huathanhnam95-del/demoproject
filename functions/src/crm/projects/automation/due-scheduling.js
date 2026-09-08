'use strict';
const crypto = require('crypto');
const { ref, data, hash, iso, COLLECTIONS, fail } = require('./store');
const { dueTime } = require('./definition');
const { runTransactionWithClosedRetry } = require('../domain/transaction-retry');

const RETRY_MS = 60000;
function candidates(task, registry = {}) {
    if (!task?.dueDate) return [];
    const versions = registry.versions || [];
    if (versions.length > 100) fail('AUTOMATION_LIMIT', 'Active registry exceeds limit.', 409);
    return [{ builtin: true, trigger: { time: '09:00', offsetDays: 0 } }, ...versions.filter(v => v.trigger.type === 'due_date')]
        .map(candidate => ({ ...candidate, firingTime: dueTime(task.dueDate, candidate.trigger) }))
        .filter(candidate => Number.isFinite(candidate.firingTime) && (candidate.builtin || candidate.firingTime >= Date.parse(candidate.activatedAt)));
}
function scheduleRecord(projectId, taskId, task, registry = {}, now = () => new Date()) {
    const pending = candidates(task, registry);
    if (!pending.length) return null;
    return { projectId, taskId, dueDate: task.dueDate, generation: task.dueGeneration || 1,
        registryRevision: registry.revision || 0, nextWakeAt: new Date(Math.min(...pending.map(c => c.firingTime))).toISOString(), updatedAt: iso(now), failures: 0 };
}
// These hooks deliberately perform no reads: canonical capture invokes them after
// its writes. Current task and registry snapshots were read by that transaction.
function writeSchedule(transaction, db, projectId, taskId, task, registry, now) {
    const target = ref(db, 'dueIndex', hash(projectId, taskId));
    const record = scheduleRecord(projectId, taskId, task, registry || {}, now);
    if (record) transaction.set(target, record); else transaction.set(target, { projectId, taskId, inactive: true });
}
function enqueueRebuild(transaction, db, projectId, now = () => new Date()) {
    const token = crypto.randomUUID();
    transaction.set(ref(db, 'dueRebuilds', projectId), { projectId, token, cursor: null, state: 'pending', nextWakeAt: iso(now), scanned: 0, updatedAt: iso(now) });
    return token;
}
function dueRegistrySignature(versions) {
    return hash((versions || []).filter(v => v.trigger.type === 'due_date').slice().sort((a, b) => a.ruleId.localeCompare(b.ruleId)));
}
function createDueScheduling({ db, now = () => new Date(), hooks = {} }) {
    const tx = fn => runTransactionWithClosedRetry(db, fn);
    async function rebuildPage(projectId, { limit = 50 } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('INVALID_BATCH_LIMIT', 'Rebuild pages support 1 through 100 tasks.');
        const jobRef = ref(db, 'dueRebuilds', projectId);
        const job = data(await jobRef.get());
        if (!job || job.state !== 'pending') return { scanned: 0, done: true };
        let query = db.collection(`crmProjects/${projectId}/tasks`).orderBy('__name__');
        if (job.cursor) query = query.startAfter(job.cursor);
        const page = await query.limit(limit).get();
        if (hooks.afterRebuildPageRead) await hooks.afterRebuildPageRead({ job, page });
        return tx(async transaction => {
            const current = data(await transaction.get(jobRef));
            if (!current || current.token !== job.token || current.cursor !== job.cursor) return { stale: true, scanned: 0 };
            const registry = data(await transaction.get(ref(db, 'registries', projectId))) || {};
            // Re-read canonical records inside the fenced transaction. A date edit
            // or rule/lifecycle reset racing this page therefore retries or aborts.
            const tasks = await Promise.all(page.docs.map(async document => [document.id, data(await transaction.get(document.ref))]));
            for (const [taskId, task] of tasks) writeSchedule(transaction, db, projectId, taskId, task, registry, now);
            const done = page.size < limit;
            transaction.update(jobRef, { cursor: page.docs.at(-1)?.id || current.cursor, state: done ? 'completed' : 'pending', scanned: current.scanned + page.size, updatedAt: iso(now), nextWakeAt: iso(now) });
            return { scanned: page.size, done, token: current.token };
        });
    }
    // Reconcile only after occurrence processing succeeds. A crash beforehand
    // leaves a ready row; occurrence/run/notification identities make retry safe.
    async function acknowledge(projectId, taskId, automationsEnabled) {
        return tx(async transaction => {
            const target = ref(db, 'dueIndex', hash(projectId, taskId));
            const row = data(await transaction.get(target));
            if (!row) return;
            const task = data(await transaction.get(db.doc(`crmProjects/${projectId}/tasks/${taskId}`)));
            const registry = data(await transaction.get(ref(db, 'registries', projectId))) || {};
            if (!task?.dueDate) { transaction.delete(target); return; }
            const pending = [];
            const clock = new Date(now()).getTime();
            for (const candidate of candidates(task, registry)) {
                const occurrence = data(await transaction.get(ref(db, 'occurrences', hash(projectId, taskId, task.dueGeneration || 1, candidate.builtin ? 'deadline' : candidate.versionId))));
                if (occurrence && !(occurrence.builtin && occurrence.state === 'queued')) continue;
                pending.push(!candidate.builtin && !automationsEnabled || occurrence?.state === 'queued' ? Math.max(clock + RETRY_MS, candidate.firingTime) : candidate.firingTime);
            }
            if (!pending.length) transaction.delete(target);
            else transaction.set(target, { ...scheduleRecord(projectId, taskId, task, registry, now), nextWakeAt: new Date(Math.min(...pending)).toISOString() });
        });
    }
    async function backoff(document, error) {
        return tx(async transaction => {
            const current = await transaction.get(document.ref);
            if (!current.exists || !current.updateTime.isEqual(document.updateTime)) return;
            const failures = Math.min((current.data().failures || 0) + 1, 10);
            transaction.update(document.ref, { failures, errorCode: error.code || 'DUE_FAILURE', nextWakeAt: new Date(new Date(now()).getTime() + Math.min(RETRY_MS * 2 ** (failures - 1), 3600000)).toISOString() });
        });
    }
    return { rebuildPage, acknowledge, backoff,
        enqueue: projectId => tx(async transaction => enqueueRebuild(transaction, db, projectId, now)),
        readyQuery: () => db.collection(COLLECTIONS.dueIndex).where('nextWakeAt', '<=', iso(now)).orderBy('nextWakeAt'),
        rebuildQuery: () => db.collection(COLLECTIONS.dueRebuilds).where('state', '==', 'pending').where('nextWakeAt', '<=', iso(now)).orderBy('nextWakeAt') };
}
module.exports = { candidates, scheduleRecord, writeSchedule, enqueueRebuild, dueRegistrySignature, createDueScheduling, RETRY_MS };
