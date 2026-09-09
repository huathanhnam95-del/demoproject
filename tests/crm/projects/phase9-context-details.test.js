'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectsContextDetails } = require('../../../functions/src/crm/projects/voice/context-details');
const { createTaskLinksService } = require('../../../functions/src/crm/projects/task-links-service');
const { memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
function fixture() {
    const records = new Map(), reads = [], identities = new Map(), eligibilityCalls = [];
    const ref = (path, filters = []) => ({ path, filters, collection: name => ref(`${path}/${name}`), doc: name => ref(`${path}/${name}`), where: (key, op, value) => { assert.equal(op, '=='); return ref(path, [...filters, [key, value]]); }, limit: count => ({ path, filters, count }) });
    const snap = (path, value) => ({ id: path.split('/').pop(), exists: value !== undefined, data: () => structuredClone(value) });
    const db = { collection: name => ref(name), runTransaction: () => assert.fail('No nested transactions') };
    const tx = { async get(query) { reads.push(query.path); if (query.count) { assert.ok(query.count <= 100); return { docs: [...records].filter(([path, value]) => path.startsWith(`${query.path}/`) && path.split('/').length === query.path.split('/').length + 1 && query.filters.every(([key, expected]) => value[key] === expected)).slice(0, query.count).map(([path, value]) => snap(path, value)) }; } return snap(query.path, records.get(query.path)); } };
    const access = { identity: { uid: 'staff' }, role: 'Viewer', project: { data: { crmLinks: [{ type: 'lead', recordId: 'lead1' }] } } };
    const accessService = { async assertTransactionEligible(transaction, uid) { assert.equal(transaction, tx); eligibilityCalls.push(uid); const entry = identities.get(uid); if (entry instanceof Error) throw entry; return entry || { uid, profile: { displayName: 'Mai', email: 'PRIVATE_EMAIL' } }; }, async assertTransactionContentAccess(transaction, actor, project) { assert.equal(transaction, tx); assert.equal(actor, 'staff'); assert.equal(project, 'p'); return access; } };
    const state = { crm: false, now: Date.parse('2026-09-08T16:59:59Z') };
    const links = createTaskLinksService({ db, accessService, authorizeCrmIdentity: async ({ transaction }) => { assert.equal(transaction, tx); return state.crm; } });
    const service = createProjectsContextDetails({ db, accessService, now: () => state.now, taskLinksService: links });
    const member = (uid, patch = {}, documentId = memberDocumentId('p', uid)) => records.set(`crmProjectMembers/${documentId}`, { projectId: 'p', uid, active: true, role: 'Editor', ...patch });
    records.set('crmProjects/p/sections/s', { projectId: 'p', lifecycle: 'active' });
    const task = id => records.set(`crmProjects/p/tasks/${id}`, { projectId: 'p', lifecycle: 'active', sectionId: 's' });
    const resolve = (selectedTaskIds = []) => service.resolve({ tx, actorUid: 'staff', projectId: 'p', selectedTaskIds, access });
    return { records, reads, identities, eligibilityCalls, member, task, resolve, access, state, links, tx, db, accessService };
}
test('people retain duplicate names and only canonical currently eligible membership; unexpected eligibility errors propagate', async () => {
    const f = fixture(); f.member('b'); f.member('a'); f.member('inactive', { active: false }); f.member('revoked'); f.member('forged', {}, 'forged'); f.member('badrole', { role: 'Admin' });
    f.identities.set('revoked', Object.assign(new Error('revoked'), { code: 'REVOKED_TOKEN' }));
    assert.deepEqual((await f.resolve()).people.members, [{ uid: 'a', displayName: 'Mai', role: 'Editor' }, { uid: 'b', displayName: 'Mai', role: 'Editor' }]);
    f.identities.set('a', Object.assign(new Error('lookup failed'), { code: 'UNAVAILABLE' })); await assert.rejects(f.resolve, /lookup failed/);
});
test('calendar uses injected Vietnam local date, current revision and configuration warnings without raw leave labels', async () => {
    const f = fixture(); f.records.set('crmProjectOrganizationConfig/calendar', { revision: 7, workingWeekdays: [5, 1, 2], leaves: [{ label: 'PRIVATE_LEAVE', scope: 'whole_team', fromDate: '2026-09-09', toDate: '2026-09-09' }] });
    const before = (await f.resolve()).calendar; assert.equal(before.localDate, '2026-09-08'); assert.equal(before.revision, 7); assert.deepEqual(before.workingWeekdays, [1, 2, 5]); assert.ok(before.requiresConfiguration.length); assert.ok(before.feedVersion);
    f.state.now += 1000; assert.equal((await f.resolve()).calendar.localDate, '2026-09-09'); assert.doesNotMatch(JSON.stringify(before), /PRIVATE_LEAVE|leaves/);
});

test('Auth display name fallback follows directory semantics and misplaced discussion content is excluded', async () => {
    const f = fixture(); f.member('auth-name'); f.task('t');
    f.identities.set('auth-name', { uid: 'auth-name', profile: {}, authUser: { displayName: 'Mai Auth' }, workforce: { displayName: 'Wrong source' } });
    f.records.set('crmProjects/p/discussions/wrong', { projectId: 'other', taskId: 't', body: 'PRIVATE_OTHER_PROJECT', moderationState: 'visible' });
    const value = await f.resolve(['t']);
    assert.equal(value.people.members[0].displayName, 'Mai Auth');
    assert.deepEqual(value.discussions[0].messages, []);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_OTHER_PROJECT|Wrong source/);
});
test('discussions use latest within bounded scan, redact moderation and cap excerpts and aggregate', async () => {
    const f = fixture();
    for (let t = 0; t < 7; t++) { f.task(`t${t}`); for (let n = 0; n < 7; n++) f.records.set(`crmProjects/p/discussions/t${t}m${n}`, { projectId: 'p', taskId: `t${t}`, createdAt: `2026-09-08T00:00:0${n}Z`, authorUid: n === 5 ? 'staff' : 'other', moderationState: n === 4 ? 'visible' : 'hidden', body: n === 4 ? 'x'.repeat(1100) : 'PRIVATE_BODY', attachments: ['PRIVATE_ATTACHMENT'] }); }
    const result = await f.resolve(Array.from({ length: 7 }, (_, n) => `t${n}`)); const first = result.discussions[0];
    assert.equal(first.messages[0].body, null); assert.equal(first.messages[0].redacted, true); assert.equal(first.messages[1].body, 'PRIVATE_BODY'); assert.equal(first.messages[2].body.length, 1000); assert.equal(first.messages[2].excerpt, true); assert.equal(first.hasMore, true);
    assert.equal(result.discussions.reduce((n, row) => n + row.messages.length, 0), 30); assert.equal(result.discussions[6].incomplete, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ATTACHMENT|moderationState/);
    f.access.role = 'Owner'; assert.equal((await f.resolve(['t0'])).discussions[0].messages[0].body, 'PRIVATE_BODY');
});
test('scan caps explicitly disclose incomplete people and discussion results', async () => {
    const f = fixture(); f.task('t'); for (let n = 0; n < 101; n++) { f.member(`u${n}`); f.records.set(`crmProjects/p/discussions/m${n}`, { projectId: 'p', taskId: 't', body: 'message', moderationState: 'visible', createdAt: String(n).padStart(3, '0') }); }
    const result = await f.resolve(['t']); assert.equal(result.people.members.length, 100); assert.equal(result.people.incomplete, true); assert.equal(result.discussions[0].incomplete, true); assert.equal(result.discussions[0].hasMore, true);
});
test('CRM denial prevents target reads; dedicated empty overrides legacy; safe current targets only', async () => {
    const f = fixture(); f.records.set('crmLeads/lead1', { name: 'Current lead', privateNotes: 'SECRET' });
    assert.deepEqual((await f.resolve()).linkedRecords.project, []); assert.equal(f.reads.includes('crmLeads/lead1'), false);
    f.state.crm = true; assert.equal((await f.resolve()).linkedRecords.project[0].label, 'Current lead');
    f.records.set('crmProjects/p/projectLinks/current', { links: [] }); assert.deepEqual((await f.resolve()).linkedRecords.project, []);
    f.task('t'); f.records.set('crmProjects/p/taskLinks/t', { links: [{ type: 'lead', recordId: 'lead1' }] });
    assert.equal((await f.resolve(['t'])).linkedRecords.tasks[0].links[0].label, 'Current lead');
    f.records.set('crmLeads/lead1', { name: 'Deleted', deleted: true }); assert.deepEqual((await f.resolve(['t'])).linkedRecords.tasks[0].links, []);
    const noLinks = createProjectsContextDetails({ db: f.db, accessService: f.accessService }); f.reads.length = 0; await noLinks.resolve({ tx: f.tx, actorUid: 'staff', projectId: 'p', selectedTaskIds: [], access: f.access }); assert.equal(f.reads.some(path => path.includes('Links') || path.startsWith('crmLeads')), false);
});

test('public link readers delegate to the same transaction helpers and preserve read-only options', async () => {
    const f = fixture(); f.task('t'); f.state.crm = true; let opened = 0;
    f.db.runTransaction = async (work, options) => { opened++; assert.deepEqual(options, { readOnly: true }); return work(f.tx); };
    assert.deepEqual(await f.links.projectLinks({ uid: 'staff' }, 'p'), await f.links.projectLinksInTransaction(f.tx, { uid: 'staff' }, 'p'));
    assert.deepEqual(await f.links.readLinks({ uid: 'staff' }, 'p', 't'), await f.links.readLinksInTransaction(f.tx, { uid: 'staff' }, 'p', 't'));
    assert.equal(opened, 2);
});

test('each repeated context resolves current eligible members with fresh calls and the same readset', async () => {
    const f = fixture(); f.member('a'); f.member('deleted'); f.member('inactive', { active: false });
    f.identities.set('deleted', Object.assign(new Error('deleted'), { code: 'UNAUTHORIZED' }));
    const first = await f.resolve(); const reads = [...f.reads];
    assert.deepEqual(f.eligibilityCalls, ['a', 'deleted']);
    assert.deepEqual(first.people, { members: [{ uid: 'a', displayName: 'Mai', role: 'Editor' }], incomplete: false });
    f.reads.length = 0;
    assert.deepEqual(await f.resolve(), first); assert.deepEqual(f.reads, reads);
    assert.deepEqual(f.eligibilityCalls, ['a', 'deleted', 'a', 'deleted']);
    f.identities.set('a', Object.assign(new Error('revoked'), { code: 'REVOKED_TOKEN' }));
    assert.deepEqual((await f.resolve()).people.members, []);
});
