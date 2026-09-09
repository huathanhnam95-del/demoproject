'use strict';

const crypto = require('crypto');
const { DomainError, id } = require('./domain/validation');
const { readData, projectCollection, PROJECT_EVENT_COLLECTION } = require('./domain/storage');
const { serializeProjectAccess } = require('./access-service');

const SHARDS = 16;
const LIMITS = Object.freeze({ events: 32, ids: 32, metadataBytes: 24576, responseBytes: 131072, queryReads: 32, hydrationReads: 1024, hydrationBytes: 2097152 });
function shardFor(operationId) { return crypto.createHash('sha256').update(operationId).digest()[0] % SHARDS; }
function headRef(db, projectId, shard) { return projectCollection(db, projectId, 'changeHeads').doc(String(shard)); }
async function prepareFeedCommit(transaction, db, projectId, operationId) {
    if (!projectId) return null;
    const shard = shardFor(operationId); const ref = headRef(db, projectId, shard);
    const old = readData(await transaction.get(ref));
    const sequence = Number(old?.sequence || 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new DomainError(409, 'FEED_EXHAUSTED', 'Change counter is exhausted.');
    return { stamp: { feedVersion: 1, feedShard: shard, feedSequence: sequence }, commit: () => transaction.set(ref, { sequence }) };
}
function hints(event) {
    const taskIds = new Set(); const messageIds = new Set(); let refresh = false; let aggregates = false;
    if (event.command === 'updateTaskLinks' && event.targetId) taskIds.add(id(event.targetId, 'task ID'));
    for (const path of event.affectedPaths || []) {
        const p = path.split('/');
        if (p[0] !== 'crmProjects' || p[1] !== event.projectId) continue;
        if (p.length === 4 && p[2] === 'tasks') taskIds.add(p[3]);
        if (p.length === 4 && p[2] === 'discussions') messageIds.add(p[3]);
        if (p.length === 4 && ['columns', 'sections'].includes(p[2])) refresh = true;
    }
    for (const change of event.semantic?.changes || []) {
        taskIds.add(change.taskId);
        if (['status', 'startDate', 'dueDate'].some(k => (change.before?.[k] || null) !== (change.after?.[k] || null))) aggregates = true;
        if (!change.before || !change.after || ['parentTaskId', 'sectionId', 'lifecycle'].some(k => (change.before?.[k] || null) !== (change.after?.[k] || null))) refresh = true;
        // Parent identifiers remain server-side; structural reconciliation uses
        // the member's authorized loaded branches, never hidden descendants.
    }
    if (taskIds.size + messageIds.size > LIMITS.ids) return { taskIds: [], messageIds: [], refresh: true, discussionRefresh: messageIds.size > 0 };
    return { taskIds: [...taskIds], messageIds: [...messageIds], refresh, aggregates, discussionRefresh: false };
}
function encodeCursor(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decodeCursor(raw, actorUid, projectId, heads) {
    let value;
    try { if (typeof raw !== 'string' || raw.length > 4096) throw Error(); value = JSON.parse(Buffer.from(raw, 'base64url').toString()); } catch (_) { throw new DomainError(400, 'INVALID_CHANGE_CURSOR', 'Change cursor is malformed.'); }
    const vector = a => Array.isArray(a) && a.length === SHARDS && a.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n <= heads[i]);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1 || value.actorUid !== actorUid || value.projectId !== projectId || !vector(value.ack) || (value.target !== null && !vector(value.target)) || value.target?.some((n, i) => n < value.ack[i])) throw new DomainError(400, 'INVALID_CHANGE_CURSOR', 'Change cursor is invalid for this account or project.');
    return value;
}
function createProjectsChangeFeedService({ db, accessService }) {
    async function poll(identity, rawProjectId, options = {}) {
        const projectId = id(rawProjectId, 'project ID');
        return db.runTransaction(async transaction => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId);
            const heads = [];
            for (let shard = 0; shard < SHARDS; shard++) heads.push(Number(readData(await transaction.get(headRef(db, projectId, shard)))?.sequence || 0));
            const authority = { project: serializeProjectAccess(access), membership: { role: access.role, revision: Number(access.membership.data.revision || 0) }, signature: JSON.stringify([access.role, access.project.data.membershipRevision || 0, access.project.data.lifecycle || 'active']) };
            let cursor = options.cursor ? decodeCursor(options.cursor, identity.uid, projectId, heads) : { v: 1, actorUid: identity.uid, projectId, ack: heads.slice(), target: null };
            const target = cursor.target || heads.slice(); const ack = cursor.ack.slice();
            const changes = []; const taskIds = new Set(); const messageIds = new Set(); let bytes = 2; let queryReads = 0; let full = false;
            for (let shard = 0; shard < SHARDS && !full; shard++) {
                while (ack[shard] < target[shard]) {
                    if (queryReads >= LIMITS.queryReads || changes.length >= LIMITS.events) { full = true; break; }
                    // One row per query bounds reads globally even when metadata
                    // byte/ID limits stop this page before the next shard.
                    const query = db.collection(PROJECT_EVENT_COLLECTION).where('projectId', '==', projectId).where('feedShard', '==', shard).where('feedSequence', '>', ack[shard]).where('feedSequence', '<=', target[shard]).orderBy('feedSequence').limit(1);
                    const result = await transaction.get(query); queryReads++;
                    const event = result.docs?.[0]?.data();
                    if (!event || event.feedSequence !== ack[shard] + 1) throw new DomainError(409, 'CHANGE_FEED_GAP', 'Change history is incomplete; retry without advancing.');
                    const metadata = hints(event); const nextBytes = Buffer.byteLength(JSON.stringify(metadata));
                    const nextTasks = new Set([...taskIds, ...metadata.taskIds]); const nextMessages = new Set([...messageIds, ...metadata.messageIds]);
                    if (bytes + nextBytes > LIMITS.metadataBytes || nextTasks.size + nextMessages.size > LIMITS.ids) { full = true; break; }
                    metadata.taskIds.forEach(x => taskIds.add(x)); metadata.messageIds.forEach(x => messageIds.add(x)); bytes += nextBytes;
                    changes.push(metadata); ack[shard] = event.feedSequence;
                }
            }
            const hasMore = ack.some((n, i) => n < target[i]);
            cursor = { ...cursor, ack, target: hasMore ? target : null };
            const output = { authority, cursor: encodeCursor(cursor), hasMore, changes, taskIds: [...taskIds], messageIds: [...messageIds], refresh: changes.some(x => x.refresh), discussionRefresh: changes.some(x => x.discussionRefresh), costs: { headReads: SHARDS, queryReads, metadataBytes: bytes, taskEnumeration: 0 } };
            if (Buffer.byteLength(JSON.stringify(output)) > LIMITS.responseBytes) throw new DomainError(413, 'CHANGE_RESPONSE_LIMIT', 'Change response exceeds its serialized byte budget.');
            return output;
        }, { readOnly: true });
    }
    return { poll };
}
module.exports = { createProjectsChangeFeedService, prepareFeedCommit, shardFor, headRef, hints, encodeCursor, decodeCursor, SHARDS, LIMITS };
