'use strict';
const assert = require('node:assert/strict');
const h = require('./phase6-test-helpers');
const { memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const { createProjectsVoiceContextAdapter } = require('../../../functions/src/crm/projects/voice/context-adapter');
async function main() {
    const suite = await h.bootSuite(), results = [];
    try {
        const c = await h.project(suite, 'voice-context');
        await c.task('root'); await c.task('child', { parentTaskId: 'root', sectionId: null });
        await c.taskRef('child').update({ attachments: ['PRIVATE_MARKER'], crmLinks: ['PRIVATE_MARKER'] });
        const adapter = createProjectsVoiceContextAdapter({ db: suite.db, accessService: suite.accessService });
        const resolve = (actorUid = c.uids.viewer) => suite.db.runTransaction(async tx => {
            await adapter.authorize({ tx, actorUid });
            return adapter.resolveContext({ tx, actorUid, contextHints: { projectId: c.projectId, selectedTaskIds: ['child'], view: 'board' } });
        });
        await h.caseRun('actual domain-created ancestry resolves through canonical current viewer membership', async () => {
            const value = await resolve();
            assert.equal(value.previewBinding, null); assert.equal(value.context.membership.role, 'Viewer');
            assert.deepEqual(value.context.tasks.map(t => t.id), ['child', 'root']);
            assert.deepEqual(value.context.tasks[0].ancestorIds, ['root']);
            assert.equal(value.context.tasks[0].sectionId, 's1');
            assert.doesNotMatch(JSON.stringify(value), /PRIVATE_MARKER|attachments|crmLinks/);
            assert.equal(await adapter.confirm({ text: 'confirm' }), false);
        }, results);
        await h.caseRun('canonical column archival retains history while planning omits its inactive values', async () => {
            await h.createColumn(c, 'hours', { label: 'Hours', type: 'number' });
            await c.edit('child', { values: { hours: 3 } });
            assert.equal((await resolve()).context.tasks[0].values.hours, 3);
            const column = (await c.projectRef.collection('columns').doc('hours').get()).data();
            h.expectStatus(await c.send('/columns/hours/archive', { operationId: c.op('archive-hours'), expectedRevision: column.revision, expectedSchemaRevision: (await c.projectData()).schemaRevision }), 200);
            const value = await resolve();
            assert.equal(value.context.columns.some(column => column.id === 'hours'), false);
            assert.deepEqual(value.context.tasks[0].values, {});
            assert.equal((await c.taskData('child')).values.hours, 3);
        }, results);
        await h.caseRun('persisted membership revocation and excluded CRM role stop context resolution', async () => {
            const member = suite.db.collection('crmProjectMembers').doc(memberDocumentId(c.projectId, c.uids.viewer));
            const original = (await member.get()).data();
            await member.update({ active: false });
            await assert.rejects(resolve, e => e.code === 'PROJECT_NOT_FOUND');
            await member.set(original);
            const profile = suite.db.collection('users').doc(c.uids.viewer), saved = (await profile.get()).data();
            try { await profile.update({ crmRole: 'student' }); await assert.rejects(resolve, e => e.code === 'STAFF_ACCOUNT_REQUIRED'); }
            finally { await profile.set(saved); }
            assert.equal((await resolve()).context.membership.role, 'Viewer');
        }, results);
    } finally { suite.server.closeAllConnections?.(); await suite.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });