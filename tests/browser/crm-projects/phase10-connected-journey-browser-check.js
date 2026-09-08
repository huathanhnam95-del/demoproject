'use strict';
// One connected nonpaid journey, not an aggregate of unrelated test reports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const h = require('../../crm/projects/phase10-combined-app-fixture');
const OUT = path.join(h.ROOT, 'test-results/crm-projects/phase10-connected-journey');
async function until(predicate, label) { const end = Date.now() + 45000; while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error(`Timed out: ${label}`); }
async function main() {
    assert.equal(process.env.CRM_ACCEPTANCE_NONPAID, '1');
    assert.ok(!fs.existsSync(OUT), 'Keep earlier evidence; use a fresh acceptance artifact directory');
    fs.mkdirSync(OUT, { recursive: true });
    const runId = `journey-${Date.now()}`;
    const report = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: h.ROOT, encoding: 'utf8' }).trim(),
        runId, provenance: 'Current combined apiApp HTTP/auth/middleware, real emulator Auth/Firestore and h.boot project service assembly (access, command, recovery, draft, budget, proposal, clock) across two Chrome contexts. Provider responses, usage evidence and speech attestation source are engineering fixtures.',
        paidProviderCalls: 0, passed: false, cases: [], pageErrors: [], serverErrors: [], sources: [] };
    const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    let f, browser;
    try {
        const microphone = path.join(OUT, 'microphone.wav'); h.writeMicrophone(microphone);
        f = await h.bootCombinedJourney(runId); const { c, suite } = f;
        const projectPath = `/${c.projectId}`;
        const post = async (suffix, body, role = 'owner', method = 'POST') => h.expectStatus(await f.api(projectPath + suffix, role, method, body), 200);
        const patch = async (id, values, role = 'owner') => post(`/tasks/${id}`, { operationId: c.op('journey-edit'), expectedRevision: (await c.taskData(id)).revision, ...values }, role, 'PATCH');
        // Sentinel is setup-only: preserve an existing teacher's UID/profile/class
        // references while exercising project membership and both sessions.
        const teacherRef = suite.db.collection('users').doc(c.uids.owner);
        await teacherRef.set({ acceptanceTeachingSentinel: { classIds: [`${runId}-class`], history: ['completed-session'] } }, { merge: true });
        const teacherBefore = (await teacherRef.get()).data();
        report.projectId = c.projectId; report.actors = { owner: c.uids.owner, editor: c.uids.editor };
        for (const file of ['public/crm-admin.html', 'public/crm-admin.js', 'public/js/crm/projects/board.js', 'public/js/crm/projects/remote-observer.js', 'functions/src/apiApp.js']) {
            report.sources.push({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(h.ROOT, file))).digest('hex') });
        }
        await post('/columns', { operationId: c.op('column'), columnId: 'estimate', type: 'number', label: 'Estimate', index: 0, expectedSchemaRevision: (await c.projectData()).schemaRevision });
        await post('/columns', { operationId: c.op('people-column'), columnId: 'reviewers', type: 'people', label: 'Reviewers', index: 1, expectedSchemaRevision: (await c.projectData()).schemaRevision });
        for (const [id, parent] of [['child', 'one'], ['grandchild', 'child']]) {
            await post('/tasks', { operationId: c.op('task'), taskId: id, title: id, parentTaskId: parent, sectionId: null, expectedStructureRevision: (await c.projectData()).structureRevision });
        }
        await patch('one', { ownerUid: c.uids.owner, assigneeUids: [c.uids.editor], values: { estimate: 3, reviewers: [c.uids.editor] }, startDate: '2026-09-09', dueDate: '2026-09-10' });
        browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${microphone}`, '--autoplay-policy=no-user-gesture-required'] });
        const contexts = await Promise.all([browser.newContext({ viewport: { width: 1500, height: 1000 }, permissions: ['microphone'] }), browser.newContext({ viewport: { width: 1500, height: 1000 }, permissions: ['microphone'] })]);
        const pages = await Promise.all(contexts.map(context => context.newPage())), [owner, editor] = pages;
        for (const page of pages) {
            page.on('pageerror', error => report.pageErrors.push(error.message));
            page.on('response', response => { const url = new URL(response.url()); if (url.origin === f.baseUrl && response.status() >= 500) report.serverErrors.push({ path: url.pathname, status: response.status() }); });
        }
        await h.login(owner, f.baseUrl, 'owner', c.projectId); await h.login(editor, f.baseUrl, 'editor', c.projectId);
        const record = async (name, action) => { await action(); report.cases.push({ name, passed: true }); save(); };
        const board = page => page.locator('#projects-view-tabs [data-view="board"]');
        const chooseTask = async (page, id) => { await board(page).click(); const row = page.locator(`[data-task-id="${id}"][data-row-kind="task"]`); await row.focus(); await row.press('Enter'); await page.waitForFunction(taskId => window.projectsDiscussionController?.getState()?.selection?.taskId === taskId, id); };
        await record('same canonical project, recursive tasks, typed values and people visible to two current accounts', async () => {
            for (const [columnId, label] of [['estimate', 'Estimate'], ['reviewers', 'Reviewers']]) {
                const column = await c.projectRef.collection('columns').doc(columnId).get();
                assert.equal(column.exists, true, `Canonical column ${columnId} must exist`);
                assert.equal(column.data().label, label, `Canonical column ${columnId} must retain its exact label`);
                for (const page of pages) {
                    const field = page.locator(`[data-task-id="one"] [data-field-kind="value"][data-column-id="${columnId}"]`);
                    await field.waitFor();
                    assert.equal(await field.getAttribute('aria-label'), label, `Task field ${columnId} must use its canonical column label`);
                    const heading = page.locator(`#projects-board-header [role="columnheader"] .crm-projects-board-column-label[title="${label}"]`);
                    assert.equal(await heading.count(), 1, `Column ${columnId} must have one matching header`);
                    assert.equal(await heading.textContent(), label, `Column ${columnId} must render its exact label independently of CSS capitalization`);
                }
            }
            const one = await c.taskData('one'); assert.equal(one.values.estimate, 3); assert.deepEqual(one.values.reviewers, [c.uids.editor]); assert.equal(one.ownerUid, c.uids.owner); assert.deepEqual(one.assigneeUids, [c.uids.editor]);
            assert.equal((await c.taskData('child')).parentTaskId, 'one'); assert.equal((await c.taskData('grandchild')).parentTaskId, 'child');
            h.expectStatus(await f.api(projectPath, 'unauthorized'), 403);
        });
        await record('view/calendar navigation retains shared selected-task identity and canonical dates', async () => {
            await chooseTask(owner, 'one');
            for (const view of ['kanban', 'timeline', 'calendar', 'charts', 'board']) {
                await owner.locator(`#projects-view-tabs [data-view="${view}"]`).click();
                await owner.waitForFunction(name => window.projectsViewsController?.getState()?.view === name && !document.getElementById('projects-view-status')?.textContent, view);
                assert.equal(await owner.locator(`#projects-view-tabs [data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
            }
            const calendar = h.expectStatus(await f.api(`${projectPath}/calendar?fromDate=2026-09-01&toDate=2026-09-30`), 200); assert.ok(Array.isArray(calendar.calendar?.days)); assert.ok(calendar.calendar.days.some(day => day.date === '2026-09-10'));
            assert.equal((await c.taskData('one')).dueDate, '2026-09-10');
        });
        await record('second account discussion is observed in the same task without a manual refresh', async () => {
            await chooseTask(owner, 'one'); await chooseTask(editor, 'one');
            const message = `Connected discussion ${runId}`;
            await editor.locator('#projects-board-discussion-input').fill(message);
            const posted = editor.waitForResponse(response => response.url().endsWith('/discussion/messages') && response.request().method() === 'POST');
            await editor.locator('#btn-projects-board-discussion-send').click(); assert.equal((await posted).status(), 200);
            await owner.waitForFunction(text => window.projectsDiscussionController.getState().messages.some(row => row.body === text), message);
            const rows = await c.projectRef.collection('discussions').get(); assert.ok(rows.docs.some(row => row.data().body === message));
        });
        await record('versioned automation preview and activation produce one persisted owner notification from a real task command', async () => {
            const definition = h.definition([h.notify('connected-notify', `Connected notice ${runId}`)]);
            const created = await post('/automations', { operationId: c.op('create-rule'), title: 'Connected workflow', definition });
            const preview = await post(`/automations/${created.rule.ruleId}/preview`, { versionId: created.version.versionId, sampleTaskId: 'one' });
            const before = await c.rows('notifications');
            await post(`/automations/${created.rule.ruleId}/activate`, { operationId: c.op('activate-rule'), expectedRevision: created.rule.revision, versionId: created.version.versionId, previewToken: preview.previewToken });
            assert.deepEqual(await c.rows('notifications'), before);
            const operationId = c.op('status'); await post('/tasks/one', { operationId, expectedRevision: (await c.taskData('one')).revision, status: 'done' }, 'editor', 'PATCH');
            const processor = suite.processor(runId); await processor.processEvent(operationId); await processor.processBatch();
            const first = await c.rows('notifications'); assert.equal(first.filter(row => JSON.stringify(row).includes(`Connected notice ${runId}`)).length, 1);
            await processor.processEvent(operationId); await processor.processBatch(); assert.deepEqual(await c.rows('notifications'), first);
        });
        let preview, beforeMove;
        await record('selected three share current context; visible preview has no effects before explicit engineering speech confirmation', async () => {
            await board(owner).click();
            for (const id of ['one', 'two', 'three']) { const checkbox = owner.locator(`[data-task-id="${id}"] [data-action="select-task"]`); if (!await checkbox.isChecked()) await checkbox.click(); }
            const selected = await owner.evaluate(() => window.projectsAssistantController.getState().context.selectedTaskIds); assert.deepEqual([...selected].sort(), ['one', 'three', 'two']);
            const summary = owner.getByText('Project assistance', { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await summary.click();
            f.setOutput({ kind: 'task_draft', actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'move_task', taskId, parentTaskId: 'parent' })) });
            await owner.locator('[data-assistant-instruction]').fill('Move the three selected tasks under parent.');
            const proposed = owner.waitForResponse(response => response.url().endsWith('/ai/proposals') && response.request().method() === 'POST'); await owner.locator('[data-assistant-action="draft"]').click(); assert.equal((await proposed).status(), 200);
            await until(() => owner.evaluate(() => !window.projectsAssistantController.getState().busy), 'proposal idle');
            await owner.locator('[data-assistant-action="preview"]').click(); await until(() => owner.evaluate(() => !!window.projectsAssistantController.getState().preview), 'exact preview');
            preview = await owner.evaluate(() => window.projectsAssistantController.getState().preview);
            assert.ok(preview.previewId && preview.operationId, 'The visible preview must carry durable identities for apply and Undo.');
            beforeMove = Object.fromEntries(await Promise.all(['one', 'two', 'three'].map(async id => [id, await c.taskData(id)])));
            for (const id of ['one', 'two', 'three']) { const current = await c.taskData(id); assert.equal(current.parentTaskId, null); assert.equal(current.revision, beforeMove[id].revision); }
            const persistedPreview = await suite.db.collection('crmProjectAiPreviews').doc(preview.previewId).get(); assert.equal(persistedPreview.exists, true); assert.equal(persistedPreview.data().operationId, preview.operationId);
            assert.match(await owner.locator('details').filter({ has: owner.locator('[data-assistant-action="preview"]') }).innerText(), /Descendant tasks stay/);
            await owner.locator('[data-assistant-action="start"]').click(); await until(() => f.drivers.at(-1)?.chunks.length >= 3, 'real AudioWorklet PCM');
            const driver = f.drivers.at(-1); await f.ledger.settle(driver.reservationId, f.evidence(driver.reservationId, { outputText: '1' }));
            const applied = owner.waitForResponse(response => response.url().endsWith('/apply') && response.request().method() === 'POST');
            driver.emit({ userTranscription: { utteranceId: driver.utteranceId, eventId: 'connected-confirm', text: 'I confirm these changes', final: true } });
            assert.equal((await applied).status(), 200); await until(() => owner.evaluate(() => window.projectsAssistantController.getState().status === 'Confirmed changes applied.'), 'visible apply');
            for (const id of ['one', 'two', 'three']) { const current = await c.taskData(id); assert.equal(current.parentTaskId, 'parent'); assert.equal(current.revision, beforeMove[id].revision + 1); }
            assert.equal((await c.taskData('grandchild')).parentTaskId, 'child');
            const appliedOperation = await suite.db.collection('crmProjectOperations').doc(preview.operationId).get(); assert.equal(appliedOperation.exists, true); assert.equal(appliedOperation.data().command, 'applyAiDraft'); assert.ok(['one', 'two', 'three'].every(id => appliedOperation.data().affectedIds.includes(id)));
        });
        await record('grouped authenticated Undo and both-context reload restore the same tree and retain teacher references', async () => {
            const undoOperationId = c.op('connected-undo'); const undone = await post(`/operations/${preview.operationId}/undo`, { operationId: undoOperationId });
            assert.equal(undone.originalOperationId, preview.operationId); assert.ok(['one', 'two', 'three'].every(id => undone.undone?.some(entry => entry.id === id)));
            for (const id of ['one', 'two', 'three']) { const current = await c.taskData(id); assert.equal(current.parentTaskId, null); assert.equal(current.revision, beforeMove[id].revision + 2); }
            const persistedUndo = await suite.db.collection('crmProjectOperations').doc(undoOperationId).get(); assert.equal(persistedUndo.exists, true); assert.equal(persistedUndo.data().command, 'undoOperation'); assert.equal(persistedUndo.data().targetId, preview.operationId);
            for (const page of pages) { await page.reload(); await h.selectProject(page, c.projectId); await page.locator('[data-task-id="one"]').first().waitFor(); const editorReadback = h.expectStatus(await f.api(`${projectPath}/tasks/one`, 'editor'), 200).task; assert.equal(editorReadback.parentTaskId, null); assert.deepEqual(editorReadback.values, beforeMove.one.values); }
            const grandchildReadback = h.expectStatus(await f.api(`${projectPath}/tasks/grandchild`, 'editor'), 200).task; assert.equal(grandchildReadback.parentTaskId, 'child');
            const teacherAfter = (await teacherRef.get()).data();
            for (const key of ['isTeacher', 'workforceGrants', 'acceptanceTeachingSentinel']) assert.deepEqual(teacherAfter[key], teacherBefore[key]);
            report.undo = { operationId: preview.operationId, parentsRestored: true, teachingReferencesUnchanged: true };
        });
        assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.serverErrors, []); assert.equal(report.cases.length, 6);
        await owner.screenshot({ path: path.join(OUT, 'completed.png'), fullPage: true }); report.passed = true;
    } catch (error) {
        report.failure = { message: error.message, stack: error.stack };
        throw error;
    } finally { await browser?.close(); await f?.close(); report.finishedAt = new Date().toISOString(); save(); }
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
