'use strict';
const { ref, data, fail, hash } = require('./store');
const { isProjectsFeatureEnabled } = require('../feature-config');
const { assertProjectTask } = require('../phase4-utils');
const { validateReferences } = require('./references');
// Only executor-created identities carry this capability; JSON cannot forge it.
const contexts = new WeakMap();
function executorIdentity(actorUid, context) { const identity = { uid: actorUid }; contexts.set(identity, Object.freeze({ ...context })); return identity; }
function getContext(identity) { return identity && contexts.get(identity); }
async function assertExecutionContext(transaction, db, context, actorUid, now, accessService) {
    if (!context) return;
    if (!isProjectsFeatureEnabled('projects') || !isProjectsFeatureEnabled('automations')) fail('AUTOMATIONS_PAUSED', 'Automation processing is paused.', 409);
    const run = data(await transaction.get(ref(db, 'runs', context.runId)));
    const journal = data(await transaction.get(ref(db, 'journals', context.journalId)));
    const rule = data(await transaction.get(ref(db, 'rules', context.ruleId)));
    if (!run || run.actorUid !== actorUid || run.ruleId !== context.ruleId || run.projectId !== context.projectId || run.state !== 'running' || run.lease?.token !== context.leaseToken || run.lease?.owner !== context.workerId || Date.parse(run.lease.expiresAt) <= new Date(now()).getTime()) fail('LEASE_LOST', 'Automation lease is no longer held.', 409);
    if (!rule?.enabled || rule.disabledGeneration !== run.disabledGeneration) fail('RULE_DISABLED', 'Automation rule was disabled.', 409);
    if (!journal || journal.runId !== context.runId || !['prepared', 'committed'].includes(journal.state) || journal.payloadDigest !== hash(context.effect) || journal.operationId !== context.operationId) fail('JOURNAL_MISMATCH', 'Prepared immutable action is unavailable.', 409);
    const trigger = await assertProjectTask(transaction, db, run.projectId, run.taskId);
    if (run.due && (run.due.generation !== (trigger.data.dueGeneration || 1) || run.due.dueDate !== trigger.data.dueDate)) fail('DUE_INVALIDATED', 'Due occurrence changed.', 409);
    const version = data(await transaction.get(ref(db, 'versions', run.versionId)));
    if (!version || version.actorUid !== actorUid || version.ruleId !== run.ruleId || version.projectId !== run.projectId) fail('BROKEN_REFERENCE', 'Run version or actor is unavailable.', 409);
    await validateReferences(transaction, { db, accessService, projectId: run.projectId, definition: version.definition, actorUid });
}
module.exports = { executorIdentity, getContext, assertExecutionContext };
