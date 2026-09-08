'use strict';
const assert = require('assert');
const { bootPhase5, task, createProject, clearProject, request, expectStatus, caseRun, finish } = require('./phase5-test-helpers');
async function main() {
    const c = await bootPhase5('phase5-persisted'); const results = [];
    try {
        await c.configure();
        await task(c, 'parent', { title: 'Nonmatching parent', status: 'not_started', startDate: '2026-01-01', dueDate: '2026-12-31' });
        await task(c, 'template'); const template = await c.data('template'); await c.taskRef('template').delete();
        const oracle = [];
        for (let i = 0; i < 624; i++) oracle.push({ id: `leaf-${String(i).padStart(4, '0')}`, ...template, title: `Match leaf ${i}`, parentTaskId: i < 312 ? 'parent' : null, sectionId: i < 312 ? 's1' : 's2', orderKey: String(i).padStart(6, '0'), status: ['not_started','in_progress','blocked','done'][i % 4], ownerUid: [c.uids.owner,c.uids.editor,null][i % 3], assigneeUids: [c.uids.editor], startDate: '2026-03-02', dueDate: '2026-03-06' });
        for (let offset = 0; offset < oracle.length; offset += 400) { const batch = c.db.batch(); for (const row of oracle.slice(offset, offset + 400)) { const { id, ...data } = row; batch.set(c.taskRef(id), data); } await batch.commit(); }
        await c.taskRef('archived-child').set({ ...template, parentTaskId: 'parent', title: 'Archived', lifecycle: 'archived', sectionId: 's1' });
        const parentBefore = await c.data('parent');
        await caseRun('624-leaf independent oracle; complete pages; immutable derived parent', async () => {
            const seen = []; let cursor = ''; let first;
            do { const page = expectStatus(await c.get(`/views?pageSize=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), 200); first ||= page;
                assert.strictEqual(page.matchingTaskCount, 625); assert.strictEqual(page.aggregates.activeLeafTaskCount, 624); assert.strictEqual(page.aggregates.completedLeafTaskCount, 156);
                for (const status of ['not_started','in_progress','blocked','done']) assert.strictEqual(page.aggregates.byStatus[status], 156);
                assert.deepStrictEqual(page.aggregates.byOwnerUid, { unassigned: 208, [c.uids.owner]:208, [c.uids.editor]:208 });
                assert.ok(page.tasks.length <= 200); seen.push(...page.tasks); cursor = page.nextCursor; assert.ok(seen.length <= 625);
            } while (cursor);
            assert.strictEqual(new Set(seen.map(t => t.id)).size,625); const parent = seen.find(t => t.id === 'parent');
            assert.strictEqual(parent.status,'not_started'); assert.strictEqual(parent.startDate,'2026-01-01'); assert.strictEqual(parent.derived.activeLeafCount,312); assert.strictEqual(parent.derived.completedLeafCount,78); assert.strictEqual(parent.derived.startDate,'2026-03-02'); assert.strictEqual(parent.derived.dueDate,'2026-03-06');
            assert.deepStrictEqual(await c.data('parent'),parentBefore);
            const otherId='phase5-persisted-other'; await clearProject(c.db,otherId); await createProject({...c,projectId:otherId});
            assert.notStrictEqual((await request(c.server,`/api/projects/${otherId}/views?pageSize=200&cursor=${encodeURIComponent(first.nextCursor)}`,await c.token('owner'))).status,200);
            assert.notStrictEqual((await c.get(`/views?pageSize=200&cursor=${encodeURIComponent(first.nextCursor)}`, 'editor')).status,200);
            assert.notStrictEqual((await c.get(`/views?pageSize=200&filters=${encodeURIComponent(JSON.stringify({status:'done'}))}&cursor=${encodeURIComponent(first.nextCursor)}`)).status,200);
            await c.taskRef('leaf-0000').update({ title:'Match leaf changed' });
            assert.strictEqual((await c.get(`/views?pageSize=200&cursor=${encodeURIComponent(first.nextCursor)}`)).status,409);
        },results);
        await caseRun('filtered context excluded and globally nonleaf matching parent excluded from denominator', async () => {
            const filtered = expectStatus(await c.get(`/views?filters=${encodeURIComponent(JSON.stringify({title:'Nonmatching parent'}))}`),200);
            assert.strictEqual(filtered.matchingTaskCount,1); assert.strictEqual(filtered.aggregates.activeLeafTaskCount,0);
            const board = expectStatus(await c.get(`/tasks?includeAncestorContext=true&filters=${encodeURIComponent(JSON.stringify({title:'Match leaf 1',parentScope:'root'}))}`),200);
            const expectedCount = oracle.filter(t => t.title.includes('Match leaf 1')).length;
            assert.strictEqual(board.matchingTaskCount,expectedCount); assert.strictEqual(board.aggregates.activeLeafTaskCount,expectedCount);
            assert.strictEqual(board.tasks.find(t => t.id === 'parent').contextOnly,true);
        },results);
        await caseRun('inclusive interval boundaries, undated and one-sided dates', async () => {
            for (const [id,dates] of [['undated',{startDate:null,dueDate:null}],['start-only',{startDate:'2026-03-09',dueDate:null}],['due-only',{startDate:null,dueDate:'2026-03-09'}]]) await c.taskRef(id).set({...template,title:id,...dates});
            const page = expectStatus(await c.get(`/views?filters=${encodeURIComponent(JSON.stringify({fromDate:'2026-03-09',toDate:'2026-03-09'}))}`),200);
            assert.deepStrictEqual(page.tasks.map(t => t.id).sort(),['due-only','parent','start-only']);
            assert.strictEqual(page.aggregates.activeLeafTaskCount,2);
        },results);
    } finally { await c.close(); }
    finish(results);
}
main().catch(error => { console.error(error); process.exitCode=1; });
