'use strict';
const assert = require('node:assert/strict');
const { resolveTaskState } = require('../../../functions/src/crm/projects/domain/hierarchy');
const { validateTaskInput, validateTypedValues, validateColumnInput } = require('../../../functions/src/crm/projects/domain/validation');
const { parseRank } = require('../../../functions/src/crm/projects/domain/ordering');
async function createPerformanceFixture(f) {
    const { c, suite } = f;
    assert.equal(process.env.CRM_PROJECTS_EMULATOR_READY, '1');
    assert.equal(c.projectId, 'phase6-performance-browser', 'Writes restricted to this newly created fixture project');
    const collection = c.projectRef.collection('tasks'), initial = await collection.get();
    assert.deepEqual(initial.docs.map(doc => doc.id).sort(), ['one', 'parent', 'three', 'two']);
    const template = (await c.taskRef('one').get()).data(), timestamp = new Date().toISOString();
    const remove = suite.db.batch(); for (const doc of initial.docs) remove.delete(doc.ref); await remove.commit();
    const columns = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`number${index}`, { projectId: c.projectId, type: 'number', label: `Measure ${index + 1}`, rank: `${index}/1`, lifecycle: 'active', revision: 1, createdAt: timestamp, updatedAt: timestamp, updatedBy: c.uids.owner }]));
    const columnBatch = suite.db.batch(); for (const [id, data] of Object.entries(columns)) columnBatch.set(c.projectRef.collection('columns').doc(id), data); await columnBatch.commit();
    const rows = new Map();
    function add(id, parent, index) { const pathIds = [id, ...(parent ? rows.get(parent).pathIds : [])]; const row = { ...template, title: id, projectId: c.projectId, parentTaskId: parent, sectionId: parent ? null : 's1', pathIds, rank: `${index}/1`, values: Object.fromEntries(Object.keys(columns).map((key, n) => [key, index + n])), lifecycle: 'active', revision: 1 }; rows.set(id, row); }
    add('work', null, 0); add('reserve', null, 1);
    for (let n = 0; n < 478; n++) add(`work-${String(n).padStart(3, '0')}`, 'work', n);
    for (let n = 0; n < 20; n++) add(`chain-${String(n).padStart(2, '0')}`, n ? `chain-${String(n - 1).padStart(2, '0')}` : 'work-000', 0);
    for (let n = 0; n < 9500; n++) add(`reserve-${String(n).padStart(4, '0')}`, 'reserve', n);
    const entries = [...rows]; for (let start = 0; start < entries.length; start += 400) { const batch = suite.db.batch(); for (const [id, data] of entries.slice(start, start + 400)) batch.set(collection.doc(id), data); await batch.commit(); }
    await c.projectRef.update({ schemaRevision: 30, structureRevision: 10000, updatedAt: timestamp });
    const persisted = await collection.get(), schema = await c.projectRef.collection('columns').get(), sectionDocs = await c.projectRef.collection('sections').get();
    assert.equal(persisted.size, 10000); assert.equal(schema.size, 30);
    const tasks = new Map(persisted.docs.map(doc => [doc.id, { id: doc.id, data: doc.data() }])), sections = new Map(sectionDocs.docs.map(doc => [doc.id, { id: doc.id, data: doc.data() }]));
    const actualColumns = Object.fromEntries(schema.docs.map(doc => { validateColumnInput(doc.data()); return [doc.id, doc.data()]; }));
    let depth = 0; const siblingRanks = new Set();
    for (const [id, row] of tasks) {
        validateTaskInput(Object.fromEntries(['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values'].filter(key => row.data[key] !== undefined).map(key => [key, row.data[key]]))); validateTypedValues(row.data.values, actualColumns); parseRank(row.data.rank);
        const effective = resolveTaskState({ tasks, taskId: id, sections }); assert.equal(effective.lifecycle, 'active'); assert.deepEqual(row.data.pathIds, effective.pathIds); depth = Math.max(depth, effective.ancestorIds.length);
        const key = `${row.data.parentTaskId || 'root'}:${row.data.rank}`; assert.equal(siblingRanks.has(key), false); siblingRanks.add(key); assert.equal(Object.keys(row.data.values).length, 30);
    }
    assert.equal(depth, 21); assert.equal([...tasks.values()].filter(row => row.data.parentTaskId === 'work').length, 478); assert.equal([...tasks.values()].filter(row => row.data.parentTaskId === 'reserve').length, 9500);
    return { taskCount: persisted.size, customColumns: schema.size, maximumDepth: depth, roots: 2, directWorkChildren: 478, chainNodes: 20, collapsedReserveChildren: 9500, expandedLogicalTasks: 500, projectId: c.projectId, integrity: 'All persisted tasks: canonical ancestry/lifecycle/rank uniqueness/schema/30 typed values verified' };
}
module.exports = { createPerformanceFixture };
