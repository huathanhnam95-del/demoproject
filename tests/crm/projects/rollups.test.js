'use strict';

const assert = require('assert');
const { createProjectsQueryService } = require('../../../functions/src/crm/projects/domain/query-service');

async function testRollups() {
    console.log('Testing automated rollups (statusBattery and columnSums)...');

    const timestampA = { seconds: '100', nanoseconds: 100 };
    const project = { id: 'p1', data: { structureRevision: 1, schemaRevision: 1, lifecycle: 'active' }, updateTime: timestampA };
    const sections = [
        { id: 's1', data: { lifecycle: 'active', rank: '0/1' }, updateTime: timestampA }
    ];
    const columns = [
        { id: 'budget', data: { type: 'number', lifecycle: 'active', rank: '0/1', label: 'Budget' }, updateTime: timestampA },
        { id: 'notes', data: { type: 'text', lifecycle: 'active', rank: '1/1', label: 'Notes' }, updateTime: timestampA }
    ];
    // Hierarchy:
    // Root parent: t0 (budget = 0, status = 'in_progress')
    //   Child 1: t1 (budget = 100, status = 'done')
    //   Child 2: t2 (budget = 250, status = 'blocked')
    const tasks = [
        { id: 't0', data: { sectionId: 's1', parentTaskId: null, lifecycle: 'active', rank: '0/1', status: 'in_progress', values: { budget: 0 } }, updateTime: timestampA },
        { id: 't1', data: { sectionId: null, parentTaskId: 't0', lifecycle: 'active', rank: '1/1', status: 'done', values: { budget: 100 } }, updateTime: timestampA },
        { id: 't2', data: { sectionId: null, parentTaskId: 't0', lifecycle: 'active', rank: '2/1', status: 'blocked', values: { budget: 250 } }, updateTime: timestampA },
    ];

    const fakeRef = (path) => ({
        path,
        collection: (name) => fakeRef(`${path}/${name}`),
        doc: (idValue) => fakeRef(`${path}/${idValue}`),
        limit: () => fakeRef(path),
        where: () => fakeRef(path)
    });
    const fakeDb = {
        collection: (name) => fakeRef(name),
        runTransaction: async (callback) => callback({
            get: async (reference) => {
                if (reference.path.endsWith('/tasks')) return { docs: tasks.map(t => ({ id: t.id, exists: true, data: () => t.data, updateTime: timestampA })) };
                if (reference.path.endsWith('/sections')) return { docs: sections.map(s => ({ id: s.id, exists: true, data: () => s.data, updateTime: timestampA })) };
                if (reference.path.endsWith('/columns')) return { docs: columns.map(c => ({ id: c.id, exists: true, data: () => c.data, updateTime: timestampA })) };
                if (reference.path.includes('crmProjectMembers') || reference.path.includes('members')) return { docs: [] };
                return { exists: true, data: () => project.data, updateTime: timestampA, docs: [] };
            }
        })
    };

    const queryService = createProjectsQueryService({
        db: fakeDb,
        accessService: { assertTransactionContentAccess: async () => ({}) }
    });

    const result = await queryService.queryTasks({ uid: 'actor' }, 'p1', {});
    assert.strictEqual(result.tasks.length, 3);

    const t0 = result.tasks.find(t => t.id === 't0');
    const t1 = result.tasks.find(t => t.id === 't1');
    const t2 = result.tasks.find(t => t.id === 't2');

    // t0 is parent of t1 and t2 (2 leaves)
    assert.strictEqual(t0.derived.activeLeafCount, 2);
    assert.strictEqual(t0.derived.completedLeafCount, 1);
    assert.strictEqual(t0.derived.completionPercent, 50);

    // Status battery on t0 should show 1 done, 1 blocked
    assert.deepStrictEqual(t0.derived.statusBattery, {
        not_started: 0,
        in_progress: 0,
        blocked: 1,
        done: 1
    });

    // Column sums on t0: budget sum = 100 + 250 = 350, count = 2, average = 175
    assert.strictEqual(t0.derived.columnSums.budget.sum, 350);
    assert.strictEqual(t0.derived.columnSums.budget.count, 2);
    assert.strictEqual(t0.derived.columnSums.budget.average, 175);

    // t1 is a leaf task
    assert.strictEqual(t1.derived.activeLeafCount, 1);
    assert.strictEqual(t1.derived.columnSums.budget.sum, 100);

    console.log('✅ Automated rollups test passed.');
}

testRollups().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
