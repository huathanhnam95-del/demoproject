'use strict';
const crypto = require('crypto');
const { createDueScheduling } = require('./due-scheduling');
const { ref, data, hash, fail, iso, COLLECTIONS } = require('./store');
const { dueTime, evaluateCondition } = require('./definition');
const { validateReferences, assertRecipients } = require('./references');
const { taskSnapshot } = require('./event-capture');
const { executorIdentity, assertExecutionContext } = require('./execution-context');
const { assertProjectTask } = require('../phase4-utils');
const { runTransactionWithClosedRetry } = require('../domain/transaction-retry');
const { isProjectsFeatureEnabled } = require('../feature-config');
const { createProjectsNotificationService } = require('../notification-service');
const LEASE_MS = 60000;
const MAX_ATTEMPTS = 5;
function triggerMatches(trigger, change) {
    if (!change.after) return false;
    if (trigger.type === 'task_created') return !change.before;
    if (trigger.type === 'status_changed') return !!change.before && change.before.status !== change.after.status && (trigger.from === undefined || trigger.from === change.before.status) && (trigger.to === undefined || trigger.to === change.after.status);
    if (trigger.type === 'assignment_changed') return !!change.before && hash(change.before.ownerUid || null, [...(change.before.assigneeUids || [])].sort()) !== hash(change.after.ownerUid || null, [...(change.after.assigneeUids || [])].sort());
    return false;
}
function initialTodo(steps, prefix = '') { return steps.map(node => ({ path: `${prefix}/${node.nodeId}`, node })); }
// A page owns at most four in-flight entries. An error stops new claims, but
// every already-started entry settles before this function rejects. Results keep
// query order even when independent due entries finish out of order.
async function processReadyPage(documents, process, { deadline = Infinity, concurrency = 1 } = {}) {
    if (![1, 4].includes(concurrency)) fail('INVALID_CONCURRENCY', 'Ready pages support one or four workers.');
    let next = 0; let stopped = false; let failure; let budgetExhausted = false;
    const results = [];
    async function worker() {
        while (!stopped && next < documents.length) {
            if (Date.now() >= deadline) { budgetExhausted = true; return; }
            const index = next++;
            try { results[index] = await process(documents[index], deadline); }
            catch (error) { stopped = true; failure ||= error; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, documents.length) }, worker));
    if (failure) throw failure;
    return { results, processed: results.length, budgetExhausted };
}
function createAutomationProcessor({ db, accessService, commandService, notificationService, now = () => new Date(), workerId = crypto.randomUUID(), hooks = {} }) {
    const tx = fn => runTransactionWithClosedRetry(db, fn); const notifications = notificationService || createProjectsNotificationService({ db, accessService, now });
    const scheduling = createDueScheduling({ db, now, hooks });
    const enabled = () => isProjectsFeatureEnabled('projects') && isProjectsFeatureEnabled('automations');
    async function hook(name, value) { if (!hooks[name]) return; try { await hooks[name](value); } catch (error) { error.automationInjectedFailure = true; throw error; } }
    function runRecord(projectId, version, captured, eventId, taskId, snapshot, ancestry = [], due = null) {
        const runId = hash(projectId, captured.ruleId, captured.versionId, eventId, taskId);
        const cyclic = ancestry.includes(captured.ruleId) || ancestry.length >= 8;
        return { runId, projectId, ruleId: captured.ruleId, versionId: captured.versionId, actorUid: captured.actorUid, disabledGeneration: captured.disabledGeneration || 0, eventId, taskId, triggeringSnapshot: snapshot, ancestry: [...ancestry, captured.ruleId], due, state: cyclic ? 'failed' : 'queued', errorCode: cyclic ? 'AUTOMATION_CYCLE' : null, failedNode: null, attempts: 0, effectCount: 0, todo: initialTodo(version.definition.steps), initialConditionChecked: false, afterDelay: false, createdAt: iso(now), updatedAt: iso(now), lease: null };
    }
    async function processEvent(eventId) {
        if (!isProjectsFeatureEnabled('projects')) return { paused: true };
        const eventRef = db.collection('crmProjectEvents').doc(eventId);
        let source = data(await eventRef.get()); if (!source) return { missing: true };
        if (source.processingRetryState === 'pending' && Date.parse(source.processingRetryAt) <= new Date(now()).getTime()) {
            await tx(async transaction => {
                const current = data(await transaction.get(eventRef));
                if (current?.processingRetryState !== 'pending' || Date.parse(current.processingRetryAt) > new Date(now()).getTime()) return;
                const patch = { processingRetryState: 'completed' };
                for (const field of ['notificationStatus', 'automationStatus']) if (current[field] === 'retry') patch[field] = 'pending';
                transaction.update(eventRef, patch);
            });
            source = data(await eventRef.get());
        }
        if (!source.semantic || source.semantic.schemaVersion !== 1) {
            await tx(async transaction => { const event = data(await transaction.get(eventRef)); if (!event) return; const patch = { notificationStatus: 'failed', processingError: 'UNSUPPORTED_EVENT_SCHEMA' }; if (enabled()) patch.automationStatus = 'failed'; transaction.update(eventRef, patch); }); return { failed: true, code: 'UNSUPPORTED_EVENT_SCHEMA' };
        }
        if (source.notificationStatus === 'pending') {
            for (const change of source.semantic.changes) {
                const before = new Set([change.before?.ownerUid, ...(change.before?.assigneeUids || [])].filter(Boolean));
                const recipients = [change.after?.ownerUid, ...(change.after?.assigneeUids || [])].filter(uid => uid && !before.has(uid));
                await notifications.deliver({ identity: `${eventId}:${change.taskId}`, category: 'assignment', projectId: source.projectId, taskId: change.taskId, recipientUids: recipients, actorUid: source.actorUid, excludeActor: true, message: 'You were assigned to a task.' });
            }
            for (const message of source.semantic.discussions) {
                if (!message.visible) continue;
                const recipientUids = message.created ? [...message.mentions, message.replyAuthorUid, message.ownerUid, ...message.assigneeUids].filter(Boolean) : message.mentions.filter(uid => !message.beforeMentions.includes(uid));
                await notifications.deliver({ identity: `${eventId}:${message.messageId}`, category: 'discussion', projectId: source.projectId, taskId: message.taskId, messageId: message.messageId, recipientUids, actorUid: source.actorUid, excludeActor: true, message: 'New activity in a task discussion.' });
            }
            await eventRef.update({ notificationStatus: 'completed' });
        }
        if (!enabled()) return { paused: true, notificationsProcessed: true };
        return tx(async transaction => {
            const event = data(await transaction.get(eventRef)); if (event.automationStatus !== 'pending') return { state: event.automationStatus };
            const candidates = [];
            for (const captured of event.semantic.ruleVersions) {
                const changes = captured.trigger.type === 'all_direct_children_complete' ? event.semantic.completions.map(c => ({ taskId: c.taskId, after: c.snapshot })) : event.semantic.changes.filter(c => triggerMatches(captured.trigger, c));
                for (const change of changes) candidates.push({ captured, change });
            }
            const offset = event.automationOffset || 0; const batch = candidates.slice(offset, offset + 40); const runs = [];
            for (const { captured, change } of batch) {
                const version = data(await transaction.get(ref(db, 'versions', captured.versionId)));
                if (!version || version.ruleId !== captured.ruleId || version.projectId !== event.projectId) fail('BROKEN_REFERENCE', 'Captured immutable rule version is missing.', 409);
                const run = runRecord(event.projectId, version, captured, event.eventId, change.taskId, change.after, event.ancestry || []);
                if (!data(await transaction.get(ref(db, 'runs', run.runId)))) runs.push(run);
            }
            for (const run of runs) transaction.create(ref(db, 'runs', run.runId), run);
            const hasMore = offset + batch.length < candidates.length;
            transaction.update(eventRef, { automationStatus: hasMore ? 'pending' : 'completed', automationOffset: offset + batch.length, automationProcessedAt: iso(now) }); return { runIds: runs.map(r => r.runId), hasMore };
        });
    }
    async function processDue(projectId, taskId) {
        if (!isProjectsFeatureEnabled('projects')) return { paused: true };
        const result = await tx(async transaction => {
            const task = await assertProjectTask(transaction, db, projectId, taskId, { allowInactive: true });
            if (!task.data.dueDate) return { occurrences: [] };
            const registry = data(await transaction.get(ref(db, 'registries', projectId))) || { versions: [] };
            const generation = task.data.dueGeneration || 1; const candidates = [{ builtin: true, trigger: { time: '09:00', offsetDays: 0 } }, ...(enabled() ? registry.versions.filter(v => v.trigger.type === 'due_date') : [])];
            const writes = []; const occurrences = [];
            for (const candidate of candidates) {
                const firingTime = dueTime(task.data.dueDate, candidate.trigger);
                if (firingTime > new Date(now()).getTime() || !candidate.builtin && firingTime < Date.parse(candidate.activatedAt)) continue;
                const occurrenceId = hash(projectId, taskId, generation, candidate.builtin ? 'deadline' : candidate.versionId);
                const old = data(await transaction.get(ref(db, 'occurrences', occurrenceId)));
                if (old) { if (old.state === 'queued' && old.builtin) occurrences.push(old); continue; }
                const occurrence = { occurrenceId, projectId, taskId, generation, dueDate: task.data.dueDate, firingTime, builtin: !!candidate.builtin, state: task.effectiveLifecycle !== 'active' ? 'canceled' : 'queued', createdAt: iso(now) };
                if (!candidate.builtin && occurrence.state === 'queued') {
                    const version = data(await transaction.get(ref(db, 'versions', candidate.versionId)));
                    if (!version) fail('BROKEN_REFERENCE', 'Due rule version missing.', 409);
                    const run = runRecord(projectId, version, candidate, occurrenceId, taskId, taskSnapshot(task.data), [], { generation, dueDate: task.data.dueDate });
                    const existing = data(await transaction.get(ref(db, 'runs', run.runId))); if (!existing) writes.push(() => transaction.create(ref(db, 'runs', run.runId), run));
                    occurrence.runId = run.runId; occurrence.state = 'admitted';
                }
                writes.push(() => transaction.create(ref(db, 'occurrences', occurrenceId), occurrence)); if (occurrence.builtin && occurrence.state === 'queued') occurrences.push(occurrence);
            }
            for (const write of writes) write(); return { occurrences };
        });
        for (const occurrence of result.occurrences) await tx(async transaction => {
            const current = data(await transaction.get(ref(db, 'occurrences', occurrence.occurrenceId))); if (!current || current.state !== 'queued') return;
            let task; try { task = await assertProjectTask(transaction, db, projectId, taskId); } catch (error) { if (![404, 409].includes(error.status)) throw error; transaction.update(ref(db, 'occurrences', occurrence.occurrenceId), { state: 'canceled' }); return; }
            if ((task.data.dueGeneration || 1) !== occurrence.generation || task.data.dueDate !== occurrence.dueDate) { transaction.update(ref(db, 'occurrences', occurrence.occurrenceId), { state: 'canceled' }); return; }
            const write = await notifications.prepareDelivery(transaction, { identity: occurrence.occurrenceId, projectId, taskId, category: 'deadline', recipientUids: [task.data.ownerUid, ...(task.data.assigneeUids || [])].filter(Boolean), message: 'A task reached its due date.' });
            write(); transaction.update(ref(db, 'occurrences', occurrence.occurrenceId), { state: 'completed', completedAt: iso(now) });
        });
        await hook('beforeDueAcknowledgement', { projectId, taskId });
        await scheduling.acknowledge(projectId, taskId, enabled());
        return result;
    }
    async function authority(transaction, run) {
        await accessService.assertTransactionContentAccess(transaction, run.actorUid, run.projectId, { owner: true });
        const rule = data(await transaction.get(ref(db, 'rules', run.ruleId)));
        if (!rule?.enabled || (rule.disabledGeneration || 0) !== run.disabledGeneration) fail('RULE_DISABLED', 'Rule was disabled; pending effects are canceled.', 409);
        const version = data(await transaction.get(ref(db, 'versions', run.versionId)));
        if (!version || version.actorUid !== run.actorUid) fail('BROKEN_REFERENCE', 'Run actor or version changed.', 409);
        const task = await assertProjectTask(transaction, db, run.projectId, run.taskId);
        if (run.due && (run.due.generation !== (task.data.dueGeneration || 1) || run.due.dueDate !== task.data.dueDate)) fail('DUE_INVALIDATED', 'Due occurrence changed.', 409);
        const validated = await validateReferences(transaction, { db, accessService, projectId: run.projectId, definition: version.definition, actorUid: run.actorUid });
        return { version, task, validated };
    }
    function assertLease(run, token) { if (run.state !== 'running' || run.lease?.token !== token || run.lease?.owner !== workerId || Date.parse(run.lease.expiresAt) <= new Date(now()).getTime()) fail('LEASE_LOST', 'Worker no longer holds the lease.', 409); }
    async function acquire(runId) {
        return tx(async transaction => { const run = data(await transaction.get(ref(db, 'runs', runId))); if (!run || ['completed', 'failed', 'canceled'].includes(run.state)) return { terminal: run?.state || 'missing' }; if (run.state === 'waiting' && Date.parse(run.resumeAt) > new Date(now()).getTime()) return { pending: true }; if (run.lease && Date.parse(run.lease.expiresAt) > new Date(now()).getTime()) return { pending: true }; if (run.attempts >= MAX_ATTEMPTS) { transaction.update(ref(db, 'runs', runId), { state: 'failed', errorCode: 'ATTEMPT_LIMIT', updatedAt: iso(now), lease: null }); return { terminal: 'failed' }; } const token = crypto.randomUUID(); const lease = { owner: workerId, token, expiresAt: new Date(new Date(now()).getTime() + LEASE_MS).toISOString() }; transaction.update(ref(db, 'runs', runId), { state: 'running', attempts: run.attempts + 1, lease, updatedAt: iso(now) }); return { token }; });
    }
    async function prepare(runId, token) {
        return tx(async transaction => {
            const run = data(await transaction.get(ref(db, 'runs', runId))); assertLease(run, token); const { task, validated } = await authority(transaction, run);
            const snapshot = run.afterDelay ? taskSnapshot(task.data) : run.triggeringSnapshot;
            if (!run.initialConditionChecked && !evaluateCondition(validated.definition.condition, snapshot)) { transaction.update(ref(db, 'runs', runId), { state: 'completed', completedAt: iso(now), lease: null }); return { done: true }; }
            const entry = run.todo[0];
            if (!entry) { transaction.update(ref(db, 'runs', runId), { state: 'completed', completedAt: iso(now), lease: null }); return { done: true }; }
            const journalId = hash(runId, entry.path); const old = data(await transaction.get(ref(db, 'journals', journalId)));
            if (old?.state === 'committed') { transaction.update(ref(db, 'runs', runId), { todo: run.todo.slice(1), effectCount: run.effectCount + 1, attempts: 0, initialConditionChecked: true }); return { advance: true }; }
            const node = entry.node;
            if (node.type === 'if') {
                const choice = evaluateCondition(node.condition, snapshot) ? 'then' : 'else';
                transaction.create(ref(db, 'journals', journalId), { journalId, runId, projectId: run.projectId, path: entry.path, state: 'committed', type: 'if', choice, createdAt: iso(now) });
                transaction.update(ref(db, 'runs', runId), { initialConditionChecked: true, todo: [...initialTodo(node[choice], `${entry.path}/${choice}`), ...run.todo.slice(1)] }); return { advance: true };
            }
            if (node.type === 'delay') {
                const resumeAt = new Date(new Date(now()).getTime() + node.payload.durationMs).toISOString();
                transaction.create(ref(db, 'journals', journalId), { journalId, runId, projectId: run.projectId, path: entry.path, state: 'committed', type: 'delay', resumeAt, createdAt: iso(now) });
                transaction.update(ref(db, 'runs', runId), { initialConditionChecked: true, state: 'waiting', attempts: 0, todo: run.todo.slice(1), afterDelay: true, resumeAt, lease: null, updatedAt: iso(now) }); return { waiting: true };
            }
            if (run.effectCount >= 64) fail('EFFECT_LIMIT', 'Run effect limit exceeded.', 409);
            let journal = old;
            if (!journal) {
                const p = node.payload; const targetId = p.target?.taskId || run.taskId; let target = null; if (node.type !== 'create_task') target = targetId === run.taskId ? task : await assertProjectTask(transaction, db, run.projectId, targetId);
                const project = data(await transaction.get(db.doc(`crmProjects/${run.projectId}`))); const operationId = `auto-${journalId}`; let effect;
                if (node.type === 'set_field') effect = { type: 'updateTask', taskId: targetId, payload: { ...p.patch, expectedRevision: target.data.revision, operationId } };
                if (node.type === 'assign') effect = { type: 'updateTask', taskId: targetId, payload: { ownerUid: p.ownerUid, assigneeUids: p.assigneeUids, expectedRevision: target.data.revision, operationId } };
                if (node.type === 'move_section') effect = { type: 'moveTask', taskId: targetId, payload: { parentTaskId: null, sectionId: p.sectionId, expectedRevision: target.data.revision, expectedStructureRevision: project.structureRevision, operationId } };
                if (node.type === 'create_task') effect = { type: 'createTask', payload: { ...p.task, sectionId: p.sectionId, parentTaskId: p.parent === 'trigger_task' ? run.taskId : p.parent?.taskId || null, expectedStructureRevision: project.structureRevision, operationId } };
                if (node.type === 'notify') { const recipientUids = p.recipients === 'task_owner' ? [task.data.ownerUid].filter(Boolean) : p.recipients === 'task_assignees' ? task.data.assigneeUids || [] : p.recipients; await assertRecipients(transaction, db, accessService, run.projectId, recipientUids); effect = { type: 'notify', payload: { identity: `${runId}:${entry.path}`, projectId: run.projectId, taskId: run.taskId, category: 'automation', recipientUids, message: p.message } }; }
                journal = { journalId, runId, projectId: run.projectId, path: entry.path, state: 'prepared', operationId, effect, payloadDigest: hash(effect), createdAt: iso(now) };
                transaction.create(ref(db, 'journals', journalId), journal);
            }
            transaction.update(ref(db, 'runs', runId), { initialConditionChecked: true, lease: { ...run.lease, expiresAt: new Date(new Date(now()).getTime() + LEASE_MS).toISOString() }, updatedAt: iso(now) });
            return { run, journal };
        });
    }
    async function executePrepared(run, journal, token) {
        const context = { runId: run.runId, journalId: journal.journalId, ruleId: run.ruleId, projectId: run.projectId, leaseToken: token, workerId, operationId: journal.operationId, effect: journal.effect, ancestry: run.ancestry };
        await hook('afterPrepared', { run, journal, context }); await hook('beforeEffect', { run, journal, context });
        if (journal.effect.type === 'notify') await tx(async transaction => {
            await accessService.assertTransactionContentAccess(transaction, run.actorUid, run.projectId, { owner: true });
            await assertExecutionContext(transaction, db, context, run.actorUid, now, accessService);
            await authority(transaction, run); await assertRecipients(transaction, db, accessService, run.projectId, journal.effect.payload.recipientUids);
            const current = data(await transaction.get(ref(db, 'journals', journal.journalId))); if (current.state === 'committed') return;
            const write = await notifications.prepareDelivery(transaction, journal.effect.payload); const notificationIds = write(); transaction.update(ref(db, 'journals', journal.journalId), { state: 'committed', result: { notificationIds }, committedAt: iso(now) });
        });
        else {
            const identity = executorIdentity(run.actorUid, context); const effect = journal.effect;
            if (effect.type === 'createTask') await commandService.createTask(identity, run.projectId, effect.payload);
            else await commandService[effect.type](identity, run.projectId, effect.taskId, effect.payload);
        }
        await hook('afterEffect', { run, journal, context });
        return tx(async transaction => {
            const current = data(await transaction.get(ref(db, 'runs', run.runId))); assertLease(current, token);
            const stored = data(await transaction.get(ref(db, 'journals', journal.journalId)));
            if (journal.effect.type !== 'notify') { const operation = data(await transaction.get(db.collection('crmProjectOperations').doc(journal.operationId))); if (!operation) fail('EFFECT_NOT_COMMITTED', 'Canonical operation is unavailable.', 409); transaction.update(ref(db, 'journals', journal.journalId), { state: 'committed', result: operation.result, committedAt: iso(now) }); }
            else if (stored.state !== 'committed') fail('EFFECT_NOT_COMMITTED', 'Notification journal is unavailable.', 409);
            transaction.update(ref(db, 'runs', run.runId), { todo: current.todo.slice(1), effectCount: current.effectCount + 1, attempts: 0, updatedAt: iso(now) });
        });
    }
    async function processRun(runId, { deadline = Infinity } = {}) {
        if (!enabled()) return { paused: true }; const lease = await acquire(runId); if (!lease.token) return lease;
        try {
            for (let i = 0; i < 128; i += 1) {
                if (!enabled()) return { paused: true };
                if (Date.now() >= deadline) {
                    await tx(async transaction => {
                        const current = data(await transaction.get(ref(db, 'runs', runId)));
                        if (current?.lease?.token === lease.token) transaction.update(ref(db, 'runs', runId), { state: 'queued', lease: null, attempts: 0, updatedAt: iso(now) });
                    });
                    return { yielded: true };
                }
                const next = await prepare(runId, lease.token); if (next.done || next.waiting) return next; if (next.advance) continue;
                await executePrepared(next.run, next.journal, lease.token);
            }
            fail('PROCESSOR_LIMIT', 'Bounded run processing exhausted.', 409);
        } catch (error) {
            if (error.automationInjectedFailure) throw error;
            if (['LEASE_LOST', 'AUTOMATIONS_PAUSED'].includes(error.code)) return { pending: true, code: error.code };
            await tx(async transaction => { const run = data(await transaction.get(ref(db, 'runs', runId))); if (run?.lease?.token !== lease.token) return; transaction.update(ref(db, 'runs', runId), { state: ['RULE_DISABLED', 'DUE_INVALIDATED'].includes(error.code) ? 'canceled' : 'failed', errorCode: error.code || 'AUTOMATION_FAILURE', failedNode: run.todo[0]?.path || null, updatedAt: iso(now), lease: null }); });
            return { failed: true, code: error.code || 'AUTOMATION_FAILURE' };
        }
    }
    async function processBatch({ limit = 20, maxPages = 1, budgetMs = 40000 } = {}) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_BATCH_LIMIT', 'Worker batch must be 1 through 50.');
        if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20 || !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 60000) fail('INVALID_BATCH_LIMIT', 'Drain requires at most 20 pages and 60 seconds per queue.');
        if (!isProjectsFeatureEnabled('projects')) return { paused: true };
        const tickStartedAt = Date.now();
        const result = { events: [], runs: [], due: [], rebuilds: [], metrics: {} };
        // Each lane has independent count and wall-clock budgets. Query results
        // contain only ready work; no future waits/live leases consume capacity.
        async function drain(name, makeQuery, process, output, timeField) {
            const startedAt = Date.now(); const deadline = startedAt + budgetMs;
            const metric = result.metrics[name] = { queried: 0, processed: 0, pages: 0, oldestReadyAt: null, pageFull: false };
            try {
                for (let page = 0; page < maxPages && Date.now() < deadline; page += 1) {
                    const snapshot = await makeQuery().limit(limit).get();
                    metric.hasMore = false; metric.pages += 1; metric.queried += snapshot.size; metric.pageFull = snapshot.size === limit;
                    if (!snapshot.size) break;
                    if (!metric.oldestReadyAt) { const value = snapshot.docs[0].data(); metric.oldestReadyAt = timeField.split('.').reduce((v, key) => v?.[key], value) || null; }
                    const progress = await processReadyPage(snapshot.docs, process, { deadline, concurrency: name === 'due' ? 4 : 1 });
                    output.push(...progress.results); metric.processed += progress.processed;
                    metric.hasMore = progress.results.some(entry => entry?.hasMore);
                    if (progress.budgetExhausted) { metric.budgetExhausted = true; break; }
                    if (!metric.pageFull && !metric.hasMore && name !== 'rebuilds') break;
                }
            } finally {
                metric.elapsedMs = Date.now() - startedAt;
                metric.budgetExhausted ||= Date.now() >= deadline;
            }
        }
        async function eventFailure(document, error) {
            if (error.automationInjectedFailure) throw error;
            await tx(async transaction => {
                const current = data(await transaction.get(document.ref)); if (!current) return;
                const attempts = (current.processingAttempts || 0) + 1;
                const retry = attempts < MAX_ATTEMPTS && (!error.status || error.status >= 500);
                const patch = { processingError: error.code || 'EVENT_FAILURE', processingAttempts: attempts, processingRetryState: retry ? 'pending' : 'failed', processingRetryAt: new Date(new Date(now()).getTime() + Math.min(60000 * 2 ** (attempts - 1), 3600000)).toISOString() };
                for (const field of ['notificationStatus', ...(enabled() ? ['automationStatus'] : [])]) if (current[field] === 'pending' || current[field] === 'retry') patch[field] = retry ? 'retry' : 'failed';
                transaction.update(document.ref, patch);
            });
            return { failed: true, code: error.code || 'EVENT_FAILURE' };
        }
        const processEventDocument = async document => { try { return await processEvent(document.id); } catch (error) { return eventFailure(document, error); } };
        await drain('rebuilds', scheduling.rebuildQuery, async document => {
            try { return await scheduling.rebuildPage(document.id, { limit: 100 }); }
            catch (error) { await scheduling.backoff(document, error); return { failed: true, code: error.code || 'REBUILD_FAILURE' }; }
        }, result.rebuilds, 'nextWakeAt');
        await drain('due', scheduling.readyQuery, async document => {
            const value = document.data();
            try { return await processDue(value.projectId, value.taskId); }
            catch (error) { if (error.automationInjectedFailure) throw error; await scheduling.backoff(document, error); return { failed: true, code: error.code || 'DUE_FAILURE' }; }
        }, result.due, 'nextWakeAt');
        for (const field of ['notificationStatus', ...(enabled() ? ['automationStatus'] : [])]) {
            await drain(field, () => db.collection('crmProjectEvents').where(field, '==', 'pending').orderBy('createdAt'), processEventDocument, result.events, 'createdAt');
        }
        await drain('eventRetries', () => db.collection('crmProjectEvents').where('processingRetryState', '==', 'pending').where('processingRetryAt', '<=', iso(now)).orderBy('processingRetryAt'), processEventDocument, result.events, 'processingRetryAt');
        if (enabled()) for (const [state, timeField] of [['queued', 'createdAt'], ['waiting', 'resumeAt'], ['running', 'lease.expiresAt']]) {
            await drain(state, () => {
                let query = db.collection(COLLECTIONS.runs).where('state', '==', state);
                if (state !== 'queued') query = query.where(timeField, '<=', iso(now));
                return query.orderBy(timeField);
            }, (document, deadline) => processRun(document.id, { deadline }), result.runs, timeField);
        }
        result.elapsedMs = Date.now() - tickStartedAt;
        for (const metric of Object.values(result.metrics)) metric.oldestReadyLatenessMs = metric.oldestReadyAt ? Math.max(0, new Date(now()).getTime() - Date.parse(metric.oldestReadyAt)) : null;
        return result;
    }

    return { processEvent, processDue, processRun, processBatch };
}
module.exports = { createAutomationProcessor, processReadyPage, triggerMatches, LEASE_MS, MAX_ATTEMPTS };
