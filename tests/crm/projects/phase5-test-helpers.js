'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const base = require('./phase4-test-helpers');
const { seedFixtures } = require('../../../scripts/crm/projects/seed-fixtures');
const router = require('../../../functions/src/routes/crm/projects');
const { createProjectsAccessService, PROJECT_COLLECTIONS } = require('../../../functions/src/crm/projects/access-service');
function adapterPredicate(relative) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../..', relative), 'utf8');
    const match = source.match(/authorizeCrmIdentity:\s*(\([^\n]+?),\r?\n/);
    assert.ok(match, `actual adapter CRM callback missing: ${relative}`);
    return Function('process', `return (${match[1]});`)(process);
}
async function bootPhase5(projectId) {
    const config = base.assertDedicatedEmulators(); const app = base.initializeFixtureApp(config);
    await seedFixtures({ config, app });
    const db = app.firestore(); const auth = app.auth();
    await base.clearProject(db, projectId);
    function buildApi() {
        const accessService = createProjectsAccessService({ db, auth });
        const api = express(); api.use(express.json());
        api.use('/api/projects', router({ db, auth, accessService, authorizeCrmIdentity: adapterPredicate('functions/src/apiApp.js') }));
        api.use('/legacy/projects', router({ db, auth, accessService }));
        api.use('/local/projects', router({ db, auth, accessService, authorizeCrmIdentity: adapterPredicate('src/server/app.js') }));
        return api;
    }
    const api = buildApi();
    const server = http.createServer(api); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const c = { api, app, db, auth, server, projectId, uids: base.UID_BY_ROLE, token: role => base.signIn(base.USERS[role] || role),
        async close() { await new Promise(resolve => c.server.close(resolve)); await app.delete(); },
        async restartApi() {
            await new Promise(resolve => c.server.close(resolve));
            c.api = buildApi(); c.server = http.createServer(c.api);
            await new Promise(resolve => c.server.listen(0, '127.0.0.1', resolve));
        } };
    try {
        await base.createProject(c); await base.addMember(c, 'editor', 'Editor'); await base.addMember(c, 'viewer', 'Viewer');
        await base.createSection(c, 's1', 'Section one', 0); await base.createSection(c, 's2', 'Section two', 1);
    } catch (error) { await c.close(); throw error; }
    c.projectRef = db.collection(PROJECT_COLLECTIONS.projects).doc(projectId);
    c.taskRef = id => c.projectRef.collection('tasks').doc(id);
    c.calendarRef = db.collection(PROJECT_COLLECTIONS.organizationConfig).doc('calendar');
    c.get = async (suffix, role = 'owner', prefix = '/api/projects') => base.request(c.server, `${prefix}/${projectId}${suffix}`, await c.token(role));
    c.send = async (suffix, payload, role = 'owner', method = 'PATCH') => base.jsonRequest(c.server, `/api/projects/${projectId}${suffix}`, await c.token(role), method, payload);
    c.data = async id => (await c.taskRef(id).get()).data();
    c.revision = async () => (await c.projectRef.get()).data();
    c.configure = async (leaves = []) => {
        const admin = await c.token('admin@demo.crm-projects.test');
        const current = await c.calendarRef.get();
        return base.expectStatus(await base.jsonRequest(c.server, '/api/projects/calendar', admin, 'PATCH', { expectedRevision: current.data()?.revision || 0, workingWeekdays: [1,2,3,4,5], leaves, holidayChoices: { 2026: { tetScheme: 'before1_after3', nationalDayAdjacent: 'before', adoptPublicSectorSwaps: false } } }), 200);
    };
    return c;
}
async function task(c, id, extra = {}) { return base.createTask(c, id, { sectionId: 's1', ...extra }); }
function noSecrets(value, secrets) { const json = JSON.stringify(value); for (const secret of secrets) assert.ok(!json.includes(secret), `private CRM value leaked: ${secret}`); }
async function caseRun(name, work, results) { try { await work(); results.push({ name, passed: true }); process.stdout.write(`PASS ${name}\n`); } catch (error) { results.push({ name, passed: false, error: error.stack }); process.stderr.write(`FAIL ${name}: ${error.stack}\n`); } }
function finish(results) { process.stdout.write(JSON.stringify({ cases: results.length, passed: results.filter(r => r.passed).length, results }, null, 2) + '\n'); if (results.some(r => !r.passed)) process.exitCode = 1; }
module.exports = { ...base, bootPhase5, task, noSecrets, caseRun, finish, adapterPredicate };
