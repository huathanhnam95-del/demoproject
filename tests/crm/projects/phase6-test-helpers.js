'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const base = require('./phase4-test-helpers');
const { seedFixtures } = require('../../../scripts/crm/projects/seed-fixtures');
const router = require('../../../functions/src/routes/crm/projects');
const { createProjectsAccessService, PROJECT_COLLECTIONS, memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { createProjectsNotificationService } = require('../../../functions/src/crm/projects/notification-service');
const { COLLECTIONS } = require('../../../functions/src/crm/projects/automation/store');
const { caseRun, finish, noSecrets } = require('./phase5-test-helpers');

async function bootSuite() {
    const config = base.assertDedicatedEmulators(); const app = base.initializeFixtureApp(config);
    const oldFlags = Object.fromEntries(['CRM_PROJECTS_ENABLED', 'CRM_PROJECTS_AUTOMATIONS_ENABLED'].map(k => [k, process.env[k]]));
    process.env.CRM_PROJECTS_ENABLED = '1'; process.env.CRM_PROJECTS_AUTOMATIONS_ENABLED = '1';
    let server;
    try {
        await seedFixtures({ config, app });
        const db = app.firestore(); const auth = app.auth(); let instant = new Date('2026-09-08T00:00:00.000Z');
        const now = () => new Date(instant); const accessService = createProjectsAccessService({ db, auth });
        const commandService = createProjectsCommandService({ db, accessService, now });
        const notificationService = createProjectsNotificationService({ db, accessService, now });
        const api = express(); api.use(express.json({ limit: '1mb' }));
        api.use('/api/projects', router({ db, auth, accessService, commandService, notificationService, now, authorizeCrmIdentity: ({ identity }) => identity.profile?.isAdmin === true }));
        server = http.createServer(api); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const suite = { api, app, db, auth, server, accessService, commandService, notificationService, now,
            setTime(value) { instant = new Date(value); assert.ok(Number.isFinite(instant.getTime())); },
            advance(ms) { instant = new Date(instant.getTime() + ms); },
            token: role => base.signIn(base.USERS[role] || role),
            async global(path, role = 'owner', method = 'GET', payload) {
                const token = await this.token(role);
                return method === 'GET' ? base.request(server, `/api/projects${path}`, token) : base.jsonRequest(server, `/api/projects${path}`, token, method, payload);
            },
            processor(workerId = 'worker-one', hooks = {}) {
                const { createAutomationProcessor } = require('../../../functions/src/crm/projects/automation/processor');
                return createAutomationProcessor({ db, accessService, commandService, notificationService, now, workerId, hooks });
            },
            async close() { await new Promise(resolve => server.close(resolve)); await app.delete(); for (const [key,value] of Object.entries(oldFlags)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        };
        return suite;
    } catch (error) { if (server) await new Promise(resolve => server.close(resolve)); await app.delete(); for (const [key,value] of Object.entries(oldFlags)) if (value === undefined) delete process.env[key]; else process.env[key] = value; throw error; }
}

async function project(suite, name) {
    const projectId = `phase6-${name}`; await base.clearProject(suite.db, projectId);
    for (const collection of Object.values(COLLECTIONS)) {
        const rows = await suite.db.collection(collection).where('projectId', '==', projectId).get();
        for (let start = 0; start < rows.docs.length; start += 400) { const batch = suite.db.batch(); for (const row of rows.docs.slice(start,start+400)) batch.delete(row.ref); await batch.commit(); }
    }
    const c = { ...suite, projectId, uids: base.UID_BY_ROLE };
    await base.createProject(c); await base.addMember(c, 'editor', 'Editor'); await base.addMember(c, 'viewer', 'Viewer');
    await base.createSection(c, 's1', 'Primary section', 0); await base.createSection(c, 's2', 'Other section', 1);
    c.projectRef = suite.db.collection(PROJECT_COLLECTIONS.projects).doc(projectId);
    c.taskRef = id => c.projectRef.collection('tasks').doc(id);
    c.taskData = async id => (await c.taskRef(id).get()).data();
    c.projectData = async () => (await c.projectRef.get()).data();
    c.get = (suffix, role = 'owner') => suite.global(`/${projectId}${suffix}`, role);
    c.send = (suffix, payload, role = 'owner', method = 'POST') => suite.global(`/${projectId}${suffix}`, role, method, payload);
    let counter = 0;
    c.op = label => `${projectId}-${label}-${++counter}`;
    c.task = (id, extra = {}) => base.createTask(c, id, { sectionId: 's1', ...extra });
    c.edit = async (id, patch, role = 'owner') => {
        const operationId = c.op('edit');
        base.expectStatus(await c.send(`/tasks/${id}`, { operationId, expectedRevision: (await c.taskData(id)).revision, ...patch }, role, 'PATCH'),200);
        return operationId;
    };
    c.lifecycle = async (id, action) => {
        const operationId = c.op(action);
        base.expectStatus(await c.send(`/tasks/${id}/${action}`, { operationId, expectedRevision: (await c.taskData(id)).revision, expectedStructureRevision: (await c.projectData()).structureRevision }),200);
        return operationId;
    };
    c.rows = async kind => (await suite.db.collection(COLLECTIONS[kind] || kind).where('projectId','==',projectId).get()).docs.map(d => ({ id: d.id, ...d.data() }));
    c.createRule = async definition => base.expectStatus(await c.send('/automations',{operationId:c.op('rule'),title:'Independent acceptance rule',definition}),200);
    c.activate = async (created, sampleTaskId = 'subject') => {
        const versionId = created.version.versionId;
        const preview = base.expectStatus(await c.send(`/automations/${created.rule.ruleId}/preview`,{versionId,sampleTaskId}),200);
        return base.expectStatus(await c.send(`/automations/${created.rule.ruleId}/activate`,{operationId:c.op('activate'),expectedRevision:created.rule.revision,versionId,previewToken:preview.previewToken}),200);
    };
    c.rule = async (definition, sampleTaskId = 'subject') => c.activate(await c.createRule(definition),sampleTaskId);
    c.memberRef = role => suite.db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId,c.uids[role]));
    return c;
}
function definition(steps, trigger = { type:'status_changed', from:'not_started', to:'done' }, condition) { return {schemaVersion:1,trigger,steps,...(condition ? {condition}: {})}; }
function notify(nodeId, message = nodeId, recipients = 'task_owner') { return {nodeId,type:'notify',payload:{message,recipients}}; }
function createNode(nodeId,title='Generated') { return {nodeId,type:'create_task',payload:{sectionId:'s1',task:{title}}}; }
function latch() { let release; const promise = new Promise(resolve => { release=resolve; }); return {promise,release}; }
function assertDenied(response, status) { base.expectStatus(response,status); assert.equal(response.body.success,false); }
async function notifications(suite, projectId, role='editor') {
    const items=[]; let cursor; let pages=0; const cursors=new Set();
    do {assert.ok(++pages<=200,'notification pagination must converge even across empty authorized pages');const q=new URLSearchParams({projectId,pageSize:'2'});if(cursor)q.set('cursor',cursor);const body=base.expectStatus(await suite.global(`/notifications?${q}`,role),200);items.push(...body.items);cursor=body.nextCursor;assert.ok(items.length<1000);if(body.hasMore){assert.ok(cursor);assert.ok(!cursors.has(cursor),'cursor must advance');cursors.add(cursor);}else assert.equal(cursor,null);}while(cursor);
    assert.equal(new Set(items.map(i=>i.notificationId)).size,items.length); return items;
}
module.exports = { ...base, bootSuite, project, definition, notify, createNode, latch, assertDenied, notifications, COLLECTIONS, caseRun, finish, noSecrets };
