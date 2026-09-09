'use strict';

const assert = require('assert');
const { resolveTaskState, assertNoCycle } = require('../../../functions/src/crm/projects/domain/hierarchy');
const { DomainError } = require('../../../functions/src/crm/projects/domain/validation');

function expectCode(fn, code) {
    assert.throws(fn, (error) => error instanceof DomainError && error.code === code, `Expected error code ${code}`);
}

async function testHierarchyDepth() {
    console.log('Testing 5-level hierarchy depth limit...');

    // Construct a 5-level chain: L0 -> L1 -> L2 -> L3 -> L4
    const tasks = [
        { id: 't0', data: { sectionId: 's1', parentTaskId: null, lifecycle: 'active' } },
        { id: 't1', data: { sectionId: null, parentTaskId: 't0', lifecycle: 'active' } },
        { id: 't2', data: { sectionId: null, parentTaskId: 't1', lifecycle: 'active' } },
        { id: 't3', data: { sectionId: null, parentTaskId: 't2', lifecycle: 'active' } },
        { id: 't4', data: { sectionId: null, parentTaskId: 't3', lifecycle: 'active' } },
    ];
    const sections = new Map([['s1', { id: 's1', data: { lifecycle: 'active' } }]]);

    // L0 through L4 should all resolve cleanly
    const s0 = resolveTaskState({ tasks, taskId: 't0', sections });
    assert.strictEqual(s0.pathIds.length, 1);
    const s4 = resolveTaskState({ tasks, taskId: 't4', sections });
    assert.strictEqual(s4.pathIds.length, 5);
    assert.deepStrictEqual(s4.pathIds, ['t4', 't3', 't2', 't1', 't0']);

    // Now add L5 (6th level)
    const tasks6 = [
        ...tasks,
        { id: 't5', data: { sectionId: null, parentTaskId: 't4', lifecycle: 'active' } },
    ];

    expectCode(() => {
        resolveTaskState({ tasks: tasks6, taskId: 't5', sections });
    }, 'MAX_DEPTH_EXCEEDED');

    // Test assertNoCycle with depth limit
    // Moving a 2-level subtree (subRoot -> subChild) under t3 would make depth: 4 (t3 depth) + 2 = 6 > 5 -> throws MAX_DEPTH_EXCEEDED
    const treeTasks = [
        ...tasks,
        { id: 'subRoot', data: { sectionId: 's1', parentTaskId: null, lifecycle: 'active' } },
        { id: 'subChild', data: { sectionId: null, parentTaskId: 'subRoot', lifecycle: 'active' } },
    ];
    // Moving subRoot under t3 (t3 is at depth 4) -> 4 + 2 = 6 -> MAX_DEPTH_EXCEEDED
    expectCode(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 'subRoot', parentTaskId: 't3' });
    }, 'MAX_DEPTH_EXCEEDED');

    // Moving subRoot under t2 (t2 is at depth 3) -> 3 + 2 = 5 -> allowed!
    assert.doesNotThrow(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 'subRoot', parentTaskId: 't2' });
    });

    // Cycle detection still works
    expectCode(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 't0', parentTaskId: 't4' });
    }, 'ANCESTRY_CYCLE');

    console.log('✅ All hierarchy depth tests passed.');
}

testHierarchyDepth().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
