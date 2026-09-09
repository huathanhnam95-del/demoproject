'use strict';
const { DomainError, digestPayload } = require('./validation');
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new DomainError(409, 'PREPARED_COMMAND_INTEGRITY', message); };
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Replay the actual canonical command against a recording transaction. Only
// flush writes to the supplied transaction; no nested transaction or receipt.
async function prepareCommand({ transaction, envelope, authorize, execute }) {
    if (!transaction || typeof transaction.get !== 'function' || typeof transaction.set !== 'function') fail('A live transaction is required.');
    const reads = new Map(), writes = []; let writing = false, flushed = false;
    const recording = new Proxy(transaction, { get(target, property) {
        if (property === 'get') return async ref => {
            if (writing) fail('Canonical preparation attempted a read after a write.');
            const snapshot = await target.get(ref);
            // Query result digests include membership and empty results; sorting
            // makes completion order irrelevant without relying on private SDK
            // query internals. Canonical input binds which queries were issued.
            const record = snapshot?.docs ? { kind: 'query', rows: snapshot.docs.map(doc => ({ path: doc.ref?.path || doc.id, data: clone(doc.data()) })).sort((a, b) => compare(a.path, b.path)) }
                : { kind: 'document', path: ref.path, exists: snapshot?.exists === true, data: snapshot?.exists ? clone(snapshot.data()) : null };
            if (record.kind === 'document' && typeof record.path !== 'string') fail('Document path is required for read fencing.');
            reads.set(digestPayload(record), record); return snapshot;
        };
        if (['set', 'create', 'update'].includes(property)) return (ref, data, options) => {
            writing = true;
            if (!ref?.path || writes.length >= 450) fail('Prepared command exceeds its bounded write set.');
            writes.push({ method: property, ref, data: clone(data), ...(options === undefined ? {} : { options: clone(options) }) }); return recording;
        };
        if (['delete', 'getAll'].includes(property)) return () => fail('Unsupported preparation operation.');
        const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const access = await authorize(recording);
    const authority = clone({ identity: access.identity || { uid: access.uid, profile: access.profile, workforce: access.workforce }, role: access.role,
        project: access.project ? { id: access.project.id, data: access.project.data } : null, membership: access.membership?.data || null });
    const executed = clone(await execute({ transaction: recording, contentAccess: access, envelope }));
    if (Buffer.byteLength(JSON.stringify({ executed, writes: writes.map(({ ref, ...rest }) => ({ path: ref.path, ...rest })) })) > 900000) fail('Prepared command exceeds its byte limit.');
    const result = executed.result || {};
    const select = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, clone(value[key])]));
    const preview = freeze({ command: envelope.command, projectId: envelope.projectId,
        ...(result.project ? { project: select(result.project, ['id', 'projectId', 'name', 'description', 'statusLabels', 'ownerUid', 'lifecycle', 'revision', 'structureRevision', 'schemaRevision', 'membershipRevision']) } : {}),
        ...(result.task ? { task: select(result.task, ['id', 'projectId', 'title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values', 'parentTaskId', 'sectionId', 'rank', 'revision', 'lifecycle']) } : {}),
        ...(result.structureRevision !== undefined ? { structureRevision: result.structureRevision } : {}) });
    const fenceDigest = digestPayload({ envelope, authority, reads: [...reads.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value) });
    return Object.freeze({ preview, fenceDigest, flush() {
        if (flushed) fail('Prepared command can only flush once.'); flushed = true;
        for (const write of writes) {
            if (write.options === undefined) transaction[write.method](write.ref, clone(write.data));
            else transaction[write.method](write.ref, clone(write.data), write.options);
        }
        return clone(executed);
    } });
}
module.exports = { prepareCommand };
