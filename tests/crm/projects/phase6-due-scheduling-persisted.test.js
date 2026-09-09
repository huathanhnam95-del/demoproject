'use strict';
const assert = require('node:assert/strict');
const { bootSuite, project, definition, notify, expectStatus, caseRun, finish } = require('./phase6-test-helpers');
const { createDueScheduling } = require('../../../functions/src/crm/projects/automation/due-scheduling');
const { createAutomationProcessor, processReadyPage } = require('../../../functions/src/crm/projects/automation/processor');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { ref, hash } = require('../../../functions/src/crm/projects/automation/store');
const { rebuild } = require('../../../scripts/crm/rebuild-projects-due-index');

async function main() {
    const s = await bootSuite(); const results = [];
    const group = process.env.CRM_PROJECTS_DUE_TEST_GROUP || 'all';
    assert.ok(['all', 'functional', 'sparse', 'burst'].includes(group), 'Unknown due test group');
    const run = (name, fn) => { const category = name.startsWith('10000 ') ? 'sparse' : name.startsWith('1000 ') ? 'burst' : 'functional'; return group === 'all' || group === category ? caseRun(name, fn, results) : undefined; };
    const row = async (c, taskId = 'subject') => (await ref(s.db, 'dueIndex', hash(c.projectId, taskId)).get()).data();
    const scheduler = hooks => createDueScheduling({ db: s.db, now: s.now, hooks });
    const rebuildAll = async c => {
        for (let pages = 0; pages < 110; pages += 1) { const result = await scheduler().rebuildPage(c.projectId, { limit: 100 }); if (result.done) return; }
        assert.fail('Rebuild failed to converge in bounded pages.');
    };
    try {
        await run('due pool caps four workers, stops claims at deadline and awaits inflight work after failure', async () => {
            const items = Array.from({ length: 12 }, (_, i) => i); let active = 0; let peak = 0; const claimed = [];
            const deadline = Date.now() + 30;
            const result = await processReadyPage(items, async item => {
                claimed.push(item); peak = Math.max(peak, ++active);
                await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline - Date.now() + 10)));
                active--; return item;
            }, { concurrency: 4, deadline });
            assert.equal(peak, 4); assert.deepEqual(claimed, [0, 1, 2, 3]); assert.deepEqual(result.results, claimed); assert.equal(result.budgetExhausted, true); assert.equal(active, 0);
            const finished = []; claimed.length = 0;
            await assert.rejects(processReadyPage(items, async item => {
                claimed.push(item);
                if (item === 0) throw new Error('POOL_FAILURE');
                await new Promise(resolve => setTimeout(resolve, 15)); finished.push(item);
            }, { concurrency: 4 }), /POOL_FAILURE/);
            assert.deepEqual(claimed, [0, 1, 2, 3]); assert.deepEqual(finished.sort(), [1, 2, 3]);
        });

        await run('same-task and same-project due workers preserve one occurrence and effect per identity', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-concurrent');
            await c.task('subject', { ownerUid: c.uids.editor, dueDate: '2026-09-08' }); await c.task('other', { ownerUid: c.uids.editor, dueDate: '2026-09-08' });
            await c.rule(definition([notify('n', 'CONCURRENT')], { type: 'due_date', time: '09:00' })); await rebuildAll(c);
            s.setTime('2026-09-08T02:00:00Z');
            await Promise.all(['subject', 'other', 'subject', 'other'].map((id, i) => s.processor(`parallel-${i}`).processDue(c.projectId, id)));
            assert.equal((await c.rows('occurrences')).length, 4); assert.equal((await c.rows('runs')).length, 2); assert.equal((await c.rows('notifications')).length, 2);
            for (const admitted of await c.rows('runs')) await s.processor().processRun(admitted.runId);
            assert.equal((await c.rows('notifications')).length, 4); assert.equal(await row(c), undefined); assert.equal(await row(c, 'other'), undefined);
        });

        await run('stale due backoff cannot replace a new canonical date generation', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-backoff'); await c.task('subject', { dueDate: '2026-09-08' });
            await scheduler().enqueue(c.projectId); await rebuildAll(c);
            const stale = await ref(s.db, 'dueIndex', hash(c.projectId, 'subject')).get();
            await c.edit('subject', { dueDate: '2026-09-10' }); const fresh = await row(c);
            await scheduler().backoff(stale, { code: 'TRANSIENT' }); assert.deepEqual(await row(c), fresh);
            const current = await stale.ref.get(); await scheduler().backoff(current, { code: 'TRANSIENT' }); assert.equal((await row(c)).failures, 1);
        });

        await run('transient event backoff leaves later notifications ready and resumes exact once', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-event-retry'); await c.task('subject'); await c.task('other');
            const poison = await c.edit('subject', { ownerUid: c.uids.editor }); const good = await c.edit('other', { ownerUid: c.uids.editor });
            const poisonRef = s.db.collection('crmProjectEvents').doc(poison); const goodRef = s.db.collection('crmProjectEvents').doc(good);
            await poisonRef.update({ createdAt: '1900-01-01T00:00:00.000Z' }); await goodRef.update({ createdAt: '1900-01-02T00:00:00.000Z' });
            let attempts = 0;
            const service = { ...s.notificationService, deliver: async input => { if (input.identity.startsWith(`${poison}:`) && ++attempts === 1) throw Object.assign(new Error('TRANSIENT'), { code: 'UNAVAILABLE', status: 503 }); return s.notificationService.deliver(input); } };
            const processor = createAutomationProcessor({ db: s.db, accessService: s.accessService, commandService: s.commandService, notificationService: service, now: s.now });
            const batch = await processor.processBatch({ limit: 1, maxPages: 2, budgetMs: 5000 }); console.log(JSON.stringify({ retryMetrics: batch.metrics }));
            assert.equal((await goodRef.get()).data().notificationStatus, 'completed'); assert.equal((await poisonRef.get()).data().notificationStatus, 'retry'); assert.equal(attempts, 1);
            await processor.processEvent(poison); assert.equal(attempts, 1, 'Future retry must not redeliver notifications.');
            s.advance(61000); await processor.processEvent(poison); await processor.processEvent(poison);
            assert.equal(attempts, 2); assert.equal((await poisonRef.get()).data().notificationStatus, 'completed'); assert.equal((await c.rows('notifications')).length, 2);
        });

        await run('permanent notification failure while paused does not consume pending automation', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-event-paused'); await c.task('subject');
            await c.rule(definition([notify('n', 'AFTER_PAUSE')])); const eventId = await c.edit('subject', { ownerUid: c.uids.editor, status: 'done' });
            const eventRef = s.db.collection('crmProjectEvents').doc(eventId); await eventRef.update({ createdAt: '1899-01-01T00:00:00.000Z' });
            const service = { ...s.notificationService, deliver: async input => { if (input.identity.startsWith(`${eventId}:`)) throw Object.assign(new Error('INVALID'), { code: 'INVALID_RECIPIENT', status: 400 }); return s.notificationService.deliver(input); } };
            const processor = createAutomationProcessor({ db: s.db, accessService: s.accessService, commandService: s.commandService, notificationService: service, now: s.now });
            process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED = '0';
            try { await processor.processBatch({ limit: 1, budgetMs: 5000 }); const event = (await eventRef.get()).data(); assert.equal(event.notificationStatus, 'failed'); assert.equal(event.automationStatus, 'pending'); }
            finally { process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED = '1'; }
            await processor.processEvent(eventId); const runs = await c.rows('runs'); assert.equal(runs.length, 1); await processor.processRun(runs[0].runId); assert.equal((await c.rows('notifications'))[0].message, 'AFTER_PAUSE');
        });

        await run('run deadline yields an existing prepared journal and resumes without duplicate effects', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-run-yield'); await c.task('subject', { ownerUid: c.uids.editor });
            await c.rule(definition([notify('one', 'ONE'), notify('two', 'TWO')])); const eventId = await c.edit('subject', { status: 'done' });
            const crashing = s.processor('prepared-crash', { afterPrepared: async () => { throw new Error('PREPARED_CRASH'); } }); await crashing.processEvent(eventId); const admitted = (await c.rows('runs'))[0];
            await assert.rejects(crashing.processRun(admitted.runId), /PREPARED_CRASH/); assert.equal((await c.rows('journals'))[0].state, 'prepared');
            s.advance(61000); const next = s.processor('deadline-yield'); assert.equal((await next.processRun(admitted.runId, { deadline: Date.now() - 1 })).yielded, true);
            const yielded = (await c.rows('runs'))[0]; assert.equal(yielded.state, 'queued'); assert.equal(yielded.lease, null); assert.equal((await c.rows('notifications')).length, 0);
            await next.processRun(admitted.runId); await next.processRun(admitted.runId); assert.equal((await c.rows('runs'))[0].state, 'completed'); assert.equal((await c.rows('notifications')).length, 2); assert.equal((await c.rows('journals')).length, 2);
        });

        await run('prepared field batch previews no index writes and outer capture updates due generation', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-prepared-fields'); await c.task('subject', { dueDate: '2026-09-08' });
            await scheduler().enqueue(c.projectId); await rebuildAll(c); const initial = await row(c);
            const recovery = createProjectsRecoveryService({ db: s.db, accessService: s.accessService, commandService: s.commandService, now: s.now });
            const changes = [{ taskId: 'subject', expectedRevision: (await c.taskData('subject')).revision, patch: { dueDate: '2026-09-10' } }];
            await s.db.runTransaction(transaction => recovery.prepareFieldBatch({ transaction, actorUid: c.uids.owner, projectId: c.projectId, changes }));
            assert.deepEqual(await row(c), initial);
            await s.commandService.runCommand({ actorUid: c.uids.owner, projectId: c.projectId, command: 'applyAiDraft', operationId: c.op('fields'), payload: {}, execute: async ({ transaction }) => (await recovery.prepareFieldBatch({ transaction, actorUid: c.uids.owner, projectId: c.projectId, changes })).flush() });
            assert.equal((await row(c)).generation, initial.generation + 1); assert.equal((await row(c)).dueDate, '2026-09-10'); assert.equal((await c.taskData('subject')).dueGeneration, initial.generation + 1);
        });

        await run('canonical create, title preservation, A-B-A, clear and crash before acknowledgement', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-canonical');
            const created = await s.commandService.createTask({ uid: c.uids.owner }, c.projectId, { operationId: c.op('manual'), title: 'Manual', sectionId: 's1', ownerUid: c.uids.editor, dueDate: '2026-09-08', expectedStructureRevision: (await c.projectData()).structureRevision });
            const id = created.task.id; const initial = await row(c, id);
            assert.equal(initial.nextWakeAt, '2026-09-08T02:00:00.000Z'); assert.equal(initial.generation, 1);
            await c.edit(id, { title: 'Retitled' }); assert.deepEqual(await row(c, id), initial);
            await c.edit(id, { dueDate: '2026-09-09' }); await c.edit(id, { dueDate: '2026-09-08' }); assert.equal((await row(c, id)).generation, 3);
            s.setTime('2026-09-08T02:00:00Z');
            const crashed = s.processor('due-crash', { beforeDueAcknowledgement: async () => { throw new Error('DUE_ACK_CRASH'); } });
            await assert.rejects(crashed.processDue(c.projectId, id), /DUE_ACK_CRASH/);
            assert.equal((await c.rows('notifications')).length, 1); assert.ok((await row(c, id)).nextWakeAt);
            await s.processor('due-restart').processDue(c.projectId, id);
            assert.equal((await c.rows('notifications')).length, 1); assert.equal(await row(c, id), undefined);
            await c.edit(id, { dueDate: null }); const retired = await row(c, id); assert.equal(retired.nextWakeAt, undefined);
        });

        await run('prepared creation preview writes no index; outer canonical flush persists one matching schedule', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-prepared');
            const payload = { operationId: c.op('prepared'), title: 'Prepared', sectionId: 's1', ownerUid: c.uids.editor, dueDate: '2026-09-09', expectedStructureRevision: (await c.projectData()).structureRevision };
            const prepared = await s.db.runTransaction(transaction => s.commandService.prepareCreateTask({ transaction, actorUid: c.uids.owner, projectId: c.projectId, payload }));
            assert.equal((await c.rows('dueIndex')).length, 0);
            await s.commandService.runCommand({ actorUid: c.uids.owner, projectId: c.projectId, command: 'applyAiDraft', operationId: c.op('apply'), payload: {}, execute: async ({ transaction }) => {
                const current = await s.commandService.prepareCreateTask({ transaction, actorUid: c.uids.owner, projectId: c.projectId, payload });
                assert.equal(current.fenceDigest, prepared.fenceDigest); return current.flush();
            } });
            const tasks = (await c.projectRef.collection('tasks').get()).docs; assert.equal(tasks.length, 1);
            const index = await row(c, tasks[0].id); assert.equal(index.generation, tasks[0].data().dueGeneration); assert.equal(index.dueDate, tasks[0].data().dueDate); assert.equal(index.nextWakeAt, '2026-09-09T02:00:00.000Z');
            assert.equal((await c.rows('dueIndex')).length, 1);
        });

        await run('due rule activation and disable reset rebuild; draft and title edits do not; paused rules survive builtin', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-registry'); await c.task('subject', { ownerUid: c.uids.editor, dueDate: '2026-09-08' });
            const active = await c.rule(definition([notify('n', 'RULE')], { type: 'due_date', time: '10:00' }));
            let job = (await ref(s.db, 'dueRebuilds', c.projectId).get()).data(); assert.equal(job.state, 'pending'); const token = job.token;
            const patched = expectStatus(await c.send(`/automations/${active.rule.ruleId}`, { operationId: c.op('title'), expectedRevision: active.rule.revision, title: 'Rename' }, 'owner', 'PATCH'), 200);
            assert.equal((await ref(s.db, 'dueRebuilds', c.projectId).get()).data().token, token);
            const candidate = expectStatus(await c.send(`/automations/${active.rule.ruleId}/versions`, { operationId: c.op('version'), expectedRevision: patched.rule.revision, definition: definition([notify('n', 'NEXT')], { type: 'due_date', time: '11:00' }) }), 200);
            assert.equal((await ref(s.db, 'dueRebuilds', c.projectId).get()).data().token, token);
            await rebuildAll(c); s.setTime('2026-09-08T03:00:00Z'); process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED = '0';
            try { await s.processor().processDue(c.projectId, 'subject'); assert.equal((await c.rows('runs')).length, 0); assert.equal((await c.rows('notifications')).length, 1); assert.ok((await row(c)).nextWakeAt > s.now().toISOString()); }
            finally { process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED = '1'; }
            s.advance(61000); await s.processor().processDue(c.projectId, 'subject'); assert.equal((await c.rows('runs')).length, 1); assert.equal(await row(c), undefined);
            const next = await c.activate(candidate); job = (await ref(s.db, 'dueRebuilds', c.projectId).get()).data(); assert.notEqual(job.token, token);
            await rebuildAll(c); await s.processor().processDue(c.projectId, 'subject'); assert.equal((await row(c)).nextWakeAt, '2026-09-08T04:00:00.000Z');
            expectStatus(await c.send(`/automations/${active.rule.ruleId}`, { operationId: c.op('disable'), expectedRevision: next.rule.revision, enabled: false }, 'owner', 'PATCH'), 200);
            assert.notEqual((await ref(s.db, 'dueRebuilds', c.projectId).get()).data().token, job.token); await rebuildAll(c); await s.processor().processDue(c.projectId, 'subject'); assert.equal(await row(c), undefined);
        });

        await run('stale rebuild reset is fenced and current task date is re-read before page writes', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-rebuild-race'); await c.task('subject', { dueDate: '2026-09-08' }); await scheduler().enqueue(c.projectId);
            let reset = false;
            const stale = await scheduler({ afterRebuildPageRead: async () => { if (!reset) { reset = true; await scheduler().enqueue(c.projectId); } } }).rebuildPage(c.projectId);
            assert.equal(stale.stale, true); assert.equal((await ref(s.db, 'dueRebuilds', c.projectId).get()).data().cursor, null);
            let edited = false;
            await scheduler({ afterRebuildPageRead: async () => { if (!edited) { edited = true; await c.edit('subject', { dueDate: '2026-09-10' }); } } }).rebuildPage(c.projectId);
            assert.equal((await row(c)).dueDate, '2026-09-10'); assert.equal((await row(c)).generation, (await c.taskData('subject')).dueGeneration);
        });

        await run('ancestor archive and restore rebuild preserve already canceled occurrence', async () => {
            s.setTime('2026-09-08T01:00:00Z'); const c = await project(s, 'index-ancestor'); await c.task('ancestor'); await c.task('subject', { parentTaskId: 'ancestor', ownerUid: c.uids.editor, dueDate: '2026-09-08' });
            await c.lifecycle('ancestor', 'archive'); await rebuildAll(c); assert.ok((await row(c)).nextWakeAt);
            s.setTime('2026-09-08T02:00:00Z'); await s.processor().processDue(c.projectId, 'subject'); assert.equal((await c.rows('occurrences'))[0].state, 'canceled');
            await c.lifecycle('ancestor', 'restore'); await rebuildAll(c); await s.processor().processDue(c.projectId, 'subject'); assert.equal((await c.rows('notifications')).length, 0); assert.equal((await c.rows('occurrences'))[0].state, 'canceled');
        });

        await run('10000 legacy tasks restart bounded initial index; all 20 sparse due tasks drain next tick without task scans', async () => {
            s.setTime('2026-09-08T02:00:00Z'); const c = await project(s, 'index-10000');
            // Intentional cold legacy persistence; canonical creation is separately
            // tested above. Mostly undated tasks must never consume due capacity.
            const template = { projectId: c.projectId, title: 'Legacy', lifecycle: 'active', revision: 1, dueGeneration: 1, parentTaskId: null, sectionId: 's1', status: 'not_started', ownerUid: c.uids.editor, assigneeUids: [], values: {}, rank: '0/1' };
            for (let start = 0; start < 10000; start += 400) { const batch = s.db.batch(); for (let i = start; i < start + 400; i += 1) batch.set(c.taskRef(`legacy-${String(i).padStart(5, '0')}`), { ...template, dueDate: i >= 9980 ? '2026-09-08' : null }); await batch.commit(); }
            const first = await rebuild({ db: s.db, projectId: c.projectId, reset: true, pages: 2, pageSize: 100, now: s.now }); assert.equal(first.done, false); assert.equal(first.scanned, 200);
            const initialCursor = (await ref(s.db, 'dueRebuilds', c.projectId).get()).data().cursor; assert.equal(initialCursor, 'legacy-00199');
            await rebuildAll(c); assert.equal((await ref(s.db, 'dueRebuilds', c.projectId).get()).data().scanned, 10000);
            // Instrument actual query creation: steady state may read specific
            // tasks for authorization, but cannot enumerate task collections.
            const originalGroup = s.db.collectionGroup; const originalCollection = s.db.collection; let scans = 0;
            s.db.collectionGroup = function (name) { if (name === 'tasks') { scans++; throw new Error('STEADY_STATE_TASK_SCAN'); } return originalGroup.call(this, name); };
            s.db.collection = function (path) { const collection = originalCollection.call(this, path); if (/^crmProjects\/[^/]+\/tasks$/.test(path)) { const originalOrderBy = collection.orderBy; collection.orderBy = function (...args) { scans++; throw new Error('STEADY_STATE_TASK_SCAN'); }; void originalOrderBy; } return collection; };
            let tick; try { tick = await s.processor('sparse').processBatch({ limit: 50 }); } finally { s.db.collectionGroup = originalGroup; s.db.collection = originalCollection; }
            console.log(JSON.stringify({ sparseMetrics: tick.metrics, elapsedMs: tick.elapsedMs }));
            assert.equal(scans, 0); assert.equal((await c.rows('notifications')).length, 20); assert.ok(tick.metrics.due.processed >= 20);
        });

        await run('1000 ready deadlines drain within five independently bounded ticks', async () => {
            s.setTime('2026-09-08T02:00:00Z'); const c = await project(s, 'index-1000');
            const template = { projectId: c.projectId, title: 'Due', lifecycle: 'active', revision: 1, dueGeneration: 1, parentTaskId: null, sectionId: 's1', status: 'not_started', ownerUid: c.uids.editor, assigneeUids: [], values: {}, rank: '0/1', dueDate: '2026-09-08' };
            for (let start = 0; start < 1000; start += 250) { const batch = s.db.batch(); for (let i = start; i < start + 250; i += 1) batch.set(c.taskRef(`due-${i}`), template); await batch.commit(); }
            await scheduler().enqueue(c.projectId); await rebuildAll(c);
            const metrics = []; for (let tick = 0; tick < 5; tick += 1) { const batch = await s.processor(`load-${tick}`).processBatch({ limit: 50, maxPages: 10, budgetMs: 30000 }); metrics.push({ metrics: batch.metrics, elapsedMs: batch.elapsedMs }); console.log(JSON.stringify({ burstTick: tick + 1, ...metrics.at(-1) })); if ((await c.rows('notifications')).length === 1000) break; }
            console.log(JSON.stringify({ largeDueTickMetrics: metrics })); assert.equal((await c.rows('notifications')).length, 1000); assert.equal((await c.rows('occurrences')).length, 1000);
        });
    } finally { await s.close(); }
    finish(results);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
