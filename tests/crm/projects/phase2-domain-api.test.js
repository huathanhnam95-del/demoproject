'use strict';

const assert = require('assert');
const {
    DomainError,
    ALLOWED_COLUMN_TYPES,
    validateProjectInput,
    validateSectionInput,
    validateColumnInput,
    validateTaskInput,
    validateTaskPatch,
    validateTypedValues,
    digestPayload,
    id
} = require('../../../functions/src/crm/projects/domain/validation');
const {
    MAX_REBALANCE_WRITES,
    compareSiblings,
    rankForIndex,
    computeInsertionRank
} = require('../../../functions/src/crm/projects/domain/ordering');
const {
    createProjectsQueryService,
    snapshotDigest,
    normalizeFilters
} = require('../../../functions/src/crm/projects/domain/query-service');

function expectCode(fn, code) {
    assert.throws(fn, (error) => error instanceof DomainError && error.code === code);
}

async function main() {
    assert.deepStrictEqual(ALLOWED_COLUMN_TYPES, ['text', 'number', 'date', 'people', 'status', 'priority', 'dropdown']);
    assert.deepStrictEqual(validateProjectInput({ name: 'Launch' }), { name: 'Launch' });
    assert.deepStrictEqual(validateSectionInput({ title: 'Backlog' }), { title: 'Backlog' });
    assert.deepStrictEqual(validateColumnInput({ type: 'dropdown', label: 'Stage', options: [{ key: 'todo', label: 'To do' }] }), {
        type: 'dropdown', label: 'Stage', options: [{ key: 'todo', label: 'To do' }]
    });
    assert.deepStrictEqual(validateTaskInput({
        title: 'Write brief', status: 'in_progress', ownerUid: 'owner', assigneeUids: ['editor'],
        values: { estimate: 2 }
    }), {
        title: 'Write brief', status: 'in_progress', ownerUid: 'owner', assigneeUids: ['editor'], values: { estimate: 2 }
    });
    assert.deepStrictEqual(validateTaskPatch({ title: 'Updated', values: { estimate: 3 } }), {
        title: 'Updated', values: { estimate: 3 }
    });
    expectCode(() => validateProjectInput({}), 'INVALID_PROJECT');
    expectCode(() => validateSectionInput({ title: 'x', parentTaskId: 'bad' }), 'INVALID_SECTION');
    expectCode(() => validateColumnInput({ type: 'nope', label: 'x' }), 'INVALID_COLUMN_TYPE');
    expectCode(() => validateTaskInput({ title: 'x', assigneeUids: ['a', 'a'] }), 'INVALID_ASSIGNEES');
    expectCode(() => validateTypedValues({ due: Infinity }, { due: { type: 'number' } }), 'INVALID_NUMBER');
    expectCode(() => validateTypedValues({ due: '2026-02-31' }, { due: { type: 'date' } }), 'INVALID_DATE');
    expectCode(() => validateTypedValues({ stage: 'missing' }, { stage: { type: 'dropdown', options: [{ key: 'todo' }] } }), 'INVALID_OPTION');
    expectCode(() => validateTypedValues({ state: 'paused' }, { state: { type: 'status' } }), 'INVALID_STATUS');
    expectCode(() => validateTypedValues({ priority: 'critical' }, { priority: { type: 'priority' } }), 'INVALID_PRIORITY');
    expectCode(() => validateTypedValues({ due: '2026-02-30' }, { due: { type: 'date' } }), 'INVALID_DATE');
    expectCode(() => validateTypedValues({ estimate: Number.NaN }, { estimate: { type: 'number' } }), 'INVALID_NUMBER');
    expectCode(() => validateTypedValues({ estimate: Number.POSITIVE_INFINITY }, { estimate: { type: 'number' } }), 'INVALID_NUMBER');
    expectCode(() => validateTypedValues({ missing: 'value' }, { known: { type: 'text' } }), 'INVALID_COLUMN_REFERENCE');
    expectCode(() => validateTypedValues({ archived: 'value' }, { archived: { type: 'text', lifecycle: 'archived' } }), 'INVALID_COLUMN_REFERENCE');
    expectCode(() => validateColumnInput({ type: 'dropdown', label: 'Stage', options: [{ key: 'todo', label: 'To do' }, { key: 'todo', label: 'Duplicate' }] }), 'INVALID_COLUMN_OPTIONS');
    for (const reserved of ['__proto__', 'constructor', 'prototype', '.', '..', '__reserved__']) {
        expectCode(() => id(reserved, 'entity ID'), 'INVALID_ENTITY_ID');
    }
    assert.strictEqual(digestPayload({ b: 2, a: 1 }), digestPayload({ a: 1, b: 2 }));
    assert.notStrictEqual(digestPayload(JSON.parse('{"__proto__":{"a":1}}')), digestPayload(JSON.parse('{"__proto__":{"a":2}}')));
    assert.notStrictEqual(digestPayload(JSON.parse('{"constructor":{"a":1}}')), digestPayload(JSON.parse('{}')));
    assert.notStrictEqual(
        digestPayload(JSON.parse('{"nested":{"__proto__":{"a":1}}}')),
        digestPayload(JSON.parse('{"nested":{"__proto__":{"a":2}}}'))
    );
    assert.notStrictEqual(
        digestPayload(JSON.parse('{"nested":{"__proto__":{"a":1}}}')),
        digestPayload(JSON.parse('{"nested":{}}'))
    );
    const reservedColumnId = JSON.parse('{"__proto__":{"type":"text","lifecycle":"active"}}');
    const reservedValue = JSON.parse('{"__proto__":"retained"}');
    expectCode(() => validateTypedValues(reservedValue, reservedColumnId), 'INVALID_VALUE_KEY');
    assert.deepStrictEqual(validateProjectInput({ name: 'Linked', crmLinks: [{ module: 'crmLeads', recordId: 'lead-1', label: 'Lead' }] }).crmLinks, [{ module: 'crmLeads', recordId: 'lead-1', label: 'Lead' }]);
    expectCode(() => validateProjectInput({ name: 'Bad link', crmLinks: [{ secret: 'raw' }] }), 'INVALID_PROJECT_LINKS');

    const siblings = [0, 1, 2].map((index) => ({ id: `task-${index}`, rank: rankForIndex(index) }));
    siblings.push({ id: 'task-tie', rank: rankForIndex(1) });
    assert.deepStrictEqual(siblings.sort(compareSiblings).map((task) => task.id), ['task-0', 'task-1', 'task-tie', 'task-2']);
    const middle = computeInsertionRank(siblings, 2);
    assert.ok(typeof middle.rank === 'string' && middle.rank.length > 0);
    assert.ok(middle.rebalance.length <= MAX_REBALANCE_WRITES);
    const dense = Array.from({ length: 650 }, (_, index) => ({ id: `dense-${index}`, rank: `${index}/1000000000000000000000000000000` }));
    const denseResult = computeInsertionRank(dense, 325);
    assert.ok(denseResult.rebalance.length <= MAX_REBALANCE_WRITES, 'local rebalance must stay below Firestore write budget');
    assert.ok(denseResult.rank);
    assert.ok(denseResult.rebalance.length > 0, 'consecutive dense ranks must exercise a bounded compaction window');
    const denseUpdated = dense.map((item) => ({ ...item, rank: denseResult.rebalance.find((entry) => entry.id === item.id)?.rank || item.rank }));
    denseUpdated.push({ id: 'dense-new', rank: denseResult.rank });
    const denseSorted = denseUpdated.slice().sort(compareSiblings);
    assert.deepStrictEqual(denseSorted.map((item) => item.id), [
        ...Array.from({ length: 325 }, (_, index) => `dense-${index}`),
        'dense-new',
        ...Array.from({ length: 325 }, (_, index) => `dense-${index + 325}`)
    ], 'dense insertion must retain every original sibling and place the new row at the requested index');
    assert.strictEqual(new Set(denseSorted.map((item) => item.rank)).size, denseSorted.length, 'dense compaction must produce distinct ranks');
    const negative = [{ id: 'a', rank: '-100/1' }, { id: 'b', rank: '100000000000000000000/1' }];
    const negativeResult = computeInsertionRank(negative, 0);
    assert.strictEqual(compareSiblings({ id: 'new', rank: negativeResult.rank }, negative[0]) < 0, true);
    assert.throws(() => compareSiblings({ id: 'a', rank: 'broken' }, { id: 'b', rank: '1/1' }), /Malformed sibling rank/);
    assert.throws(() => compareSiblings({ id: 'a' }, { id: 'b', rank: '1/1' }), /Malformed sibling rank|Missing sibling rank/);
    const tied = Array.from({ length: 650 }, (_, index) => ({ id: `tie-${index}`, rank: '0/1' }));
    assert.throws(() => computeInsertionRank(tied, 325), /tied|INVALID_RANK/i, 'tied rank exhaustion must fail explicitly');
    assert.throws(() => computeInsertionRank([{ id: 'oversize', rank: `${'9'.repeat(254)}/1` }], 1), /INVALID_RANK|Rank/);

    const timestampA = { seconds: '100', nanoseconds: 100 };
    const timestampB = { seconds: '100', nanoseconds: 200 };
    const digestInput = {
        id: 'project', data: { structureRevision: 1, schemaRevision: 1, lifecycle: 'active' }, updateTime: timestampA
    };
    const digestWithA = snapshotDigest(digestInput, [], [], [], 'query');
    const digestWithB = snapshotDigest({ ...digestInput, updateTime: timestampB }, [], [], [], 'query');
    assert.notStrictEqual(digestWithA, digestWithB, 'cursor snapshots must preserve Firestore nanoseconds');
    assert.deepStrictEqual(normalizeFilters({ parentScope: 'root' }), { parentScope: 'root' });
    assert.throws(() => normalizeFilters({ status: { value: 1 } }), (error) => error?.code === 'INVALID_FILTER');
    const fakeRef = (path) => ({
        path,
        collection: (name) => fakeRef(`${path}/${name}`),
        doc: (idValue) => fakeRef(`${path}/${idValue}`),
        limit: () => fakeRef(path)
    });
    const fakeDb = {
        collection: (name) => fakeRef(name),
        runTransaction: async (callback) => callback({
            get: async (reference) => {
                if (reference.path.endsWith('/tasks')) return { docs: Array.from({ length: 20001 }, (_, index) => ({ id: `task-${index}`, exists: true, data: () => ({ rank: `${index}/1` }), ref: fakeRef(`${reference.path}/task-${index}`) })) };
                if (reference.path.endsWith('/sections') || reference.path.endsWith('/columns')) return { docs: [] };
                return { exists: true, data: () => ({ lifecycle: 'active', structureRevision: 0, schemaRevision: 0 }), updateTime: timestampA };
            }
        })
    };
    const boundedQuery = createProjectsQueryService({
        db: fakeDb,
        accessService: { assertTransactionContentAccess: async () => ({}) }
    });
    await assert.rejects(
        () => boundedQuery.queryTasks({ uid: 'actor' }, 'project', {}),
        (error) => error?.code === 'PROJECT_QUERY_LIMIT' && error.status === 409
    );
    process.stdout.write('crm projects Phase2 domain validation/order contract passed\n');
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
