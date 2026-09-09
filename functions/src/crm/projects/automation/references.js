'use strict';
const { assertProjectTask } = require('../phase4-utils');
const { validateDefinition, walkSteps } = require('./definition');
const { fail, hash } = require('./store');
const { PROJECT_COLLECTIONS, memberDocumentId } = require('../access-service');
const { projectPreview } = require('./preview-projection');
async function readColumns(transaction, db, projectId) {
    const snap = await transaction.get(db.collection(`crmProjects/${projectId}/columns`).limit(101));
    if (snap.docs.length > 100) fail('AUTOMATION_SCHEMA_LIMIT', 'Too many columns to validate automation.', 409);
    return Object.fromEntries(snap.docs.map(doc => [doc.id, doc.data()]));
}
async function assertRecipients(transaction, db, accessService, projectId, recipients) {
    if (!recipients.length || recipients.length > 50) fail('BROKEN_REFERENCE', 'Required recipient list is empty or too large.', 409);
    for (const uid of new Set(recipients)) {
        await accessService.assertTransactionEligible(transaction, uid);
        const snap = await transaction.get(db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId, uid)));
        const member = snap.exists ? snap.data() : null;
        if (!member || member.active === false || member.uid !== uid || member.projectId !== projectId) fail('BROKEN_REFERENCE', 'Recipient is not a current project member.', 409);
    }
}
async function validateReferences(transaction, { db, accessService, projectId, definition, actorUid, sampleTaskId }) {
    const access = await accessService.assertTransactionContentAccess(transaction, actorUid, projectId, { owner: true });
    if ((access.project.data.lifecycle || 'active') !== 'active') fail('BROKEN_REFERENCE', 'Project is not active.', 409);
    const columns = await readColumns(transaction, db, projectId);
    const normalized = validateDefinition(definition, columns);
    const referenced = { project: access.project.data, columns, tasks: {}, sections: {} };
    async function task(taskId) {
        const value = await assertProjectTask(transaction, db, projectId, taskId); referenced.tasks[taskId] = value.data;
        // Preserve authorized ancestry for projecting a subtask's effective
        // section, including a preceding sampled subtree move.
        let current = value.data;
        while (current.parentTaskId) {
            const parentId = current.parentTaskId;
            if (!referenced.tasks[parentId]) { const parent = await transaction.get(db.doc(`crmProjects/${projectId}/tasks/${parentId}`)); referenced.tasks[parentId] = parent.data(); }
            current = referenced.tasks[parentId];
        }
        if (!referenced.sections[current.sectionId]) { const section = await transaction.get(db.doc(`crmProjects/${projectId}/sections/${current.sectionId}`)); referenced.sections[current.sectionId] = section.data(); }
        return value;
    }
    if (sampleTaskId) await task(sampleTaskId);
    const nodes = []; walkSteps(normalized.steps, node => nodes.push(node));
    for (const node of nodes) {
        const p = node.payload || {};
        if (p.target?.taskId) await task(p.target.taskId);
        if (p.parent?.taskId) await task(p.parent.taskId);
        if (p.sectionId) { const snap = await transaction.get(db.doc(`crmProjects/${projectId}/sections/${p.sectionId}`)); const value = snap.exists ? snap.data() : null; if (!value || (value.lifecycle || 'active') !== 'active') fail('BROKEN_REFERENCE', 'Section is not active.', 409); referenced.sections[p.sectionId] = value; }
        const recipients = new Set(Array.isArray(p.recipients) ? p.recipients : []);
        for (const fields of [p, p.patch || {}, p.task || {}]) { if (fields.ownerUid) recipients.add(fields.ownerUid); for (const person of fields.assigneeUids || []) recipients.add(person); for (const [columnId, value] of Object.entries(fields.values || {})) if (columns[columnId]?.type === 'people') for (const person of Array.isArray(value) ? value : value ? [value] : []) recipients.add(person); }
        if (recipients.size) await assertRecipients(transaction, db, accessService, projectId, [...recipients]);
    }
    const projection = sampleTaskId ? projectPreview({ definition: normalized, sampleTaskId, actorUid, tasks: referenced.tasks, sections: referenced.sections }) : null;
    // Static references above include all branches. Dynamic recipient selectors
    // are evaluated only on the sampled reached path, after preceding actions.
    // Apply the same check for preview and activation's fresh reference fence.
    for (let offset = 0; offset < (projection?.dynamicRecipients.length || 0); offset += 50) await assertRecipients(transaction, db, accessService, projectId, projection.dynamicRecipients.slice(offset, offset + 50));
    return { definition: normalized, columns, sampleTask: referenced.tasks[sampleTaskId] || null, referenceDigest: hash(referenced), projection };
}
module.exports = { readColumns, assertRecipients, validateReferences };
