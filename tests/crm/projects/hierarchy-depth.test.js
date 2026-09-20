'use strict';

const assert = require('assert');
const { resolveTaskState, assertNoCycle } = require('../../../functions/src/crm/projects/domain/hierarchy');
const { DomainError } = require('../../../functions/src/crm/projects/domain/validation');

function expectCode(fn, code) {
    assert.throws(fn, (error) => error instanceof DomainError && error.code === code, `Expected error code ${code}`);
}

async function testHierarchyDepth() {
    console.log('Testing deep hierarchy resolution and cycle safety...');

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

    // Preserve true depth beyond the old five-level presentation limit.
    const deepTasks = [...tasks];
    for (let depth = 5; depth < 25; depth += 1) {
        deepTasks.push({ id: `t${depth}`, data: { sectionId: null, parentTaskId: `t${depth - 1}`, lifecycle: 'active' } });
    }
    const deepState = resolveTaskState({ tasks: deepTasks, taskId: 't24', sections });
    assert.strictEqual(deepState.pathIds.length, 25);
    assert.strictEqual(deepState.pathIds.at(-1), 't0');

    // Moving a subtree deeper remains valid when it does not introduce a cycle.
    const treeTasks = [
        ...tasks,
        { id: 'subRoot', data: { sectionId: 's1', parentTaskId: null, lifecycle: 'active' } },
        { id: 'subChild', data: { sectionId: null, parentTaskId: 'subRoot', lifecycle: 'active' } },
    ];
    assert.doesNotThrow(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 'subRoot', parentTaskId: 't3' });
    });

    // Moving subRoot under t2 (t2 is at depth 3) -> 3 + 2 = 5 -> allowed!
    assert.doesNotThrow(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 'subRoot', parentTaskId: 't2' });
    });

    // Cycle detection still works
    expectCode(() => {
        assertNoCycle({ tasks: treeTasks, targetId: 't0', parentTaskId: 't4' });
    }, 'ANCESTRY_CYCLE');

    console.log('✅ All deep hierarchy tests passed.');
}

testHierarchyDepth().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
