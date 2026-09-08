'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { calendarDays, evaluateSchedule, holidayYear, normalizeHolidayChoices, datesInRange, SOURCES } = require('../../../functions/src/crm/projects/calendar-model');
const { assertDependencyGraph, dependencyWarnings, createViewCalendarService } = require('../../../functions/src/crm/projects/view-calendar-service');
const { normalizeLinks, safeRecord } = require('../../../functions/src/crm/projects/task-links-service');
const { createProjectsQueryService, matches, normalizeFilters } = require('../../../functions/src/crm/projects/domain/query-service');

const configured = { holidayChoices: { 2026: { tetScheme: 'before1_after3', nationalDayAdjacent: 'before', adoptPublicSectorSwaps: false } }, workingWeekdays: [1, 2, 3, 4, 5], leaves: [] };
test('view link editability requires a current write role and independent CRM access', async () => {
    const snapshot = { project: { id: 'p', data: {} }, tasks: [], sections: [], calendar: {}, access: { role: 'Viewer', identity: { uid: 'actor' }, project: { id: 'p', data: {} }, membership: { data: { role: 'Viewer' } } } };
    let crmAllowed = true;
    const service = createViewCalendarService({ db: { collection: () => ({ doc: () => ({}) }) }, queryService: { readSnapshot: async () => snapshot, queryTasks: async () => ({ tasks: [] }) }, taskLinksService: { canManage: async () => crmAllowed } });
    assert.equal((await service.views({ uid: 'actor' }, 'p', {})).linkAccess.canManage, false);
    snapshot.access.role = 'Editor';
    assert.equal((await service.views({ uid: 'actor' }, 'p', {})).linkAccess.canManage, true);
    crmAllowed = false;
    assert.equal((await service.views({ uid: 'actor' }, 'p', {})).linkAccess.canManage, false);
});
test('real inclusive dates and employer choices are strictly validated', () => {
    assert.equal(datesInRange('2028-02-28', '2028-03-01').length, 3);
    assert.throws(() => datesInRange('2026-02-29', '2026-03-01'));
    assert.throws(() => datesInRange('2026-01-01', '2027-01-03'));
    assert.throws(() => normalizeHolidayChoices({ 2026: { tetScheme: 'public_default' } }));
    assert.throws(() => holidayYear(2026, { workingWeekdays: [] }));
});
test('verified lunar dates, unresolved choices, proposals and adopted swap provenance', () => {
    const unresolved = calendarDays({}, '2026-02-16', '2026-02-20');
    assert.ok(unresolved.requiresConfiguration.includes('2026:tetScheme'));
    assert.equal(unresolved.days.some((day) => day.organization.reasons.some((reason) => reason.code === 'tet')), false);
    assert.equal(calendarDays(configured, '2026-02-16', '2026-02-20').days.every((day) => !day.organization.working), true);
    const april = calendarDays(configured, '2026-04-26', '2026-04-27');
    assert.equal(april.days[0].organization.reasons[0].code, 'hung_kings');
    assert.ok(april.days[1].organization.reasons.some((r) => r.code === 'weekly_rest_compensation'));
    const november = calendarDays(configured, '2026-11-23', '2026-11-28');
    assert.equal(november.days[0].organization.working, true);
    assert.equal(november.days[1].organization.working, false);
    assert.equal(november.days[5].workingSwap, false);
    const swaps = calendarDays({ ...configured, holidayChoices: { 2026: { ...configured.holidayChoices[2026], adoptPublicSectorSwaps: true } } }, '2026-08-22', '2026-08-22');
    assert.equal(swaps.days[0].organization.working, true);
    assert.equal(swaps.days[0].workingSwapProvenance.source, SOURCES.national);
    assert.equal(holidayYear(2027, { holidayChoices: { 2027: { nationalDayAdjacent: 'after' } } }).holidays.get('2027-09-03')[0].source, SOURCES.law);
});
test('compensation uses actual weekly rest and never manual leave; leave wins over working swap', () => {
    const sundayWorking = { ...configured, workingWeekdays: [0, 1, 2, 3, 4, 5], leaves: [{ date: '2026-04-26', scope: 'whole_team' }] };
    assert.equal(calendarDays(sundayWorking, '2026-04-27', '2026-04-27').days[0].organization.working, true);
    const personal = { ...configured, holidayChoices: { 2026: { ...configured.holidayChoices[2026], adoptPublicSectorSwaps: true } }, leaves: [{ startDate: '2026-08-21', endDate: '2026-08-23', scope: 'specific_person', uid: 'owner', label: 'Private medical reason' }, { date: '2026-08-22', scope: 'specific_person', uid: 'unrelated', label: 'Secret' }] };
    const calendar = calendarDays(personal, '2026-08-22', '2026-08-22', ['owner']);
    assert.equal(calendar.days[0].organization.working, true);
    assert.equal(calendar.days[0].members[0].working, false);
    assert.equal(JSON.stringify(calendar).includes('Private'), false);
    assert.equal(JSON.stringify(calendar).includes('unrelated'), false);
    const owner = evaluateSchedule({ ownerUid: 'owner', assigneeUids: ['other'] }, personal, '2026-08-21', '2026-08-22');
    assert.equal(owner.workingDayCount, 0);
    const assignee = evaluateSchedule({ ownerUid: 'other', assigneeUids: ['owner'] }, personal, '2026-08-21', '2026-08-22');
    assert.equal(assignee.workingDayCount, 2);
    assert.equal(assignee.warnings.filter((w) => w.code === 'ASSIGNEE_LEAVE').length, 2);
    assert.equal(evaluateSchedule({}, {}, '2026-08-21', '2026-08-22').workingDayCount, null);
});
test('dependency graph validates complete chains, duplicate and foreign endpoints and warning tombstones', () => {
    const rows = [{ id: 'a', data: {} }, { id: 'b', data: { predecessorTaskIds: ['a'] } }, { id: 'c', data: { predecessorTaskIds: ['b'] } }];
    assert.throws(() => assertDependencyGraph(rows, 'a', ['c']), { code: 'DEPENDENCY_CYCLE' });
    assert.throws(() => assertDependencyGraph(rows, 'a', ['a']), { code: 'DEPENDENCY_CYCLE' });
    assert.throws(() => assertDependencyGraph(rows, 'c', ['a', 'a']), { code: 'DUPLICATE_DEPENDENCY' });
    assert.throws(() => assertDependencyGraph(rows, 'c', ['foreign']), { code: 'DEPENDENCY_NOT_FOUND' });
    assert.deepEqual(assertDependencyGraph(rows, 'c', ['a', 'b']), ['a', 'b']);
    assert.equal(dependencyWarnings('b', new Map(rows.map((row) => [row.id, row])), new Map()).at(0).code, 'DEPENDENCY_UNAVAILABLE');
});
test('links reject forged labels and use canonical name without legacy byte exposure', () => {
    assert.throws(() => normalizeLinks([{ type: 'lead', recordId: 'a', label: 'Forged' }]));
    assert.throws(() => normalizeLinks([{ type: '__proto__', recordId: 'a' }]));
    assert.throws(() => normalizeLinks([{ type: 'student', recordId: '../a' }]));
    assert.throws(() => normalizeLinks([{ type: 'lead', recordId: 'a' }, { type: 'lead', recordId: 'a' }]));
    assert.deepEqual(safeRecord('lead', { id: 'a', exists: true, data: () => ({ name: 'Canonical name', secret: 'private' }) }), { type: 'lead', recordId: 'a', label: 'Canonical name', href: '/crm-admin.html#enquiry' });
    assert.equal(safeRecord('lead', { id: 'a', exists: true, data: () => ({ name: 'Deleted', deletedAt: 'today' }) }), null);
});
test('shared interval filter includes spanning tasks and excludes undated tasks', () => {
    const filters = normalizeFilters({ fromDate: '2026-06-15', toDate: '2026-06-20', parentScope: 'all' });
    const effective = { lifecycle: 'active', ancestorIds: [] };
    assert.equal(matches({ data: { startDate: '2026-06-01', dueDate: '2026-06-30' } }, effective, filters), true);
    assert.equal(matches({ data: {} }, effective, filters), false);
});
test('complete 650-task totals, globally active leaves, ancestor context and opaque paging', async () => {
    const cursors = new Map();
    const db = { runTransaction() {}, collection: () => ({ doc: (key) => ({ set: async (value) => cursors.set(key, value), get: async () => ({ exists: cursors.has(key), data: () => cursors.get(key) }) }) }) };
    const query = createProjectsQueryService({ db, accessService: { assertTransactionContentAccess() {} } });
    const tasks = [{ id: 'parent', data: { title: 'Parent', sectionId: 's', parentTaskId: null, rank: '0/1', status: 'not_started', revision: 1, startDate: '2020-01-01', dueDate: '2030-01-01' } }];
    for (let i = 0; i < 650; i++) tasks.push({ id: `child-${i}`, data: { title: `Match ${i}`, parentTaskId: 'parent', rank: `${i + 1}/1`, status: i % 2 ? 'done' : 'blocked', ownerUid: i % 2 ? 'person' : null, revision: 1, startDate: '2026-06-01', dueDate: '2026-06-30' } });
    const snapshot = { project: { id: 'p', data: {} }, sections: [{ id: 's', data: { rank: '0/1' } }], columns: [], tasks, calendar: {} };
    const page = await query.queryTasks({ uid: 'actor' }, 'p', { filters: { title: 'Match' }, pageSize: 200 }, snapshot);
    assert.equal(page.tasks.length, 200); assert.equal(page.matchingTaskCount, 650); assert.equal(page.aggregates.activeLeafTaskCount, 650); assert.equal(page.aggregates.completedLeafTaskCount, 325); assert.equal(page.aggregates.byOwnerUid.unassigned, 325); assert.equal(page.hasMore, true);
    const next = await query.queryTasks({ uid: 'actor' }, 'p', { filters: { title: 'Match' }, pageSize: 200, cursor: page.nextCursor }, snapshot);
    assert.equal(next.tasks[0].id, 'child-200');
    await assert.rejects(query.queryTasks({ uid: 'other' }, 'p', { filters: { title: 'Match' }, pageSize: 200, cursor: page.nextCursor }, snapshot), { code: 'INVALID_CURSOR' });
    const board = await query.queryTasks({ uid: 'actor' }, 'p', { filters: { title: 'Match', parentScope: 'root' }, includeAncestorContext: true }, snapshot);
    assert.equal(board.tasks.length, 1); assert.equal(board.tasks[0].contextOnly, true); assert.equal(board.matchingTaskCount, 650); assert.equal(board.tasks[0].derived.activeLeafCount, 650); assert.equal(board.tasks[0].derived.completionPercent, 50); assert.equal(board.tasks[0].startDate, '2020-01-01'); assert.equal(board.tasks[0].derived.startDate, '2026-06-01');
    snapshot.calendar.revision = 1;
    await assert.rejects(query.queryTasks({ uid: 'actor' }, 'p', { filters: { title: 'Match' }, pageSize: 200, cursor: page.nextCursor }, snapshot), { code: 'STALE_CURSOR' });
});
