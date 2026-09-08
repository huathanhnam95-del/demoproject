'use strict';
const { createHash } = require('crypto');
const { isDeepStrictEqual } = require('util');
const { Timestamp } = require('firebase-admin/firestore');
function fail(message) { throw Object.assign(new Error(message), { status: 409, code: 'TRANSACTION_PLAN_INVALID' }); }
function plain(value) { return value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function copy(value) {
    if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Timestamp) return new Timestamp(value.seconds, value.nanoseconds);
    if (Array.isArray(value)) return value.map(copy);
    if (!plain(value)) fail('Unsupported value in transaction plan.');
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe transaction field.');
        result[key] = copy(child);
    }
    return result;
}
function merge(base, patch) {
    const result = copy(base || {});
    for (const [key, value] of Object.entries(patch)) {
        result[key] = plain(value) && Object.keys(value).length && plain(result[key]) ? merge(result[key], value) : copy(value);
    }
    return result;
}

/** Adapt canonical CRM transaction functions to one read-before-write plan.
 * This is deliberately a bounded subset, not a general Firestore emulator.
 * The caller owns the real outer transaction and must propagate failures.
 */
function createTransactionWorkspace({ db, transaction, seed, maxWrites = 450, maxReads = 2000 }) {
    if (!db || !transaction || typeof seed !== 'string' || !seed || !Number.isInteger(maxWrites) || maxWrites < 1 || maxWrites > 450 || !Number.isInteger(maxReads) || maxReads < 1 || maxReads > 2000) throw new TypeError('Invalid transaction workspace configuration.');
    const originals = new Map(), staged = new Map(), queries = [];
    let phase = 'open', serial = 0, active = false, prepared;
    const assertOpen = () => { if (phase !== 'open') fail(`Transaction workspace is closed (${phase}).`); };
    function ref(path) {
        const parts = path.split('/');
        if (!parts.length || parts.length % 2 || parts.some(part => !part)) fail('Invalid document path.');
        const actual = db.collection(parts.slice(0, -1).join('/')).doc(parts.at(-1));
        return { path, id: parts.at(-1), actual, type: 'document', collection: name => collection(`${path}/${name}`) };
    }
    function collection(path, filters = []) {
        if (typeof path !== 'string' || path.split('/').length % 2 !== 1 || path.split('/').some(part => !part)) fail('Invalid collection path.');
        let actual = db.collection(path);
        for (const [field, operator, value] of filters) actual = actual.where(field, operator, value);
        return { path, filters, actual, type: 'query',
            doc(id) {
                if (id === undefined) id = `draft-${createHash('sha256').update(JSON.stringify([seed, path, serial++])).digest('hex')}`;
                if (typeof id !== 'string' || !id || id.includes('/')) fail('Invalid document identity.');
                return ref(`${path}/${id}`);
            },
            where(field, operator, value) {
                if (operator !== '==' || typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(field)) fail('Unsupported transaction query.');
                return collection(path, [...filters, [field, operator, copy(value)]]);
            }
        };
    }
    function remember(reference, snapshot) {
        if (!originals.has(reference.path)) {
            if (originals.size >= maxReads) fail('Transaction read limit exceeded.');
            const timestamp = snapshot.updateTime;
            if (snapshot.exists && (!timestamp || !Number.isSafeInteger(timestamp.seconds) || !Number.isInteger(timestamp.nanoseconds))) fail('Record version is unavailable.');
            originals.set(reference.path, { data: snapshot.exists ? copy(snapshot.data()) : undefined,
                version: snapshot.exists ? { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds } : null });
        }
    }
    async function load(reference) {
        if (!originals.has(reference.path)) remember(reference, await transaction.get(reference.actual));
        return originals.get(reference.path);
    }
    function current(path) {
        let data = originals.get(path)?.data;
        for (const operation of staged.get(path) || []) {
            if (operation.kind === 'delete') data = undefined;
            else data = operation.merge ? merge(data, operation.data) : copy(operation.data);
        }
        return data;
    }
    function snapshot(reference) {
        const data = current(reference.path);
        return { id: reference.id, ref: reference, exists: data !== undefined, data: () => data === undefined ? undefined : copy(data) };
    }
    function stage(reference, operation) {
        assertOpen();
        if (reference?.type !== 'document') fail('A document reference is required.');
        if (!staged.has(reference.path)) {
            if (staged.size >= maxWrites) fail('Transaction write limit exceeded.');
            staged.set(reference.path, []);
        }
        staged.get(reference.path).push(operation);
    }
    const tx = {
        async get(reference) {
            assertOpen();
            if (reference.type === 'document') { await load(reference); return snapshot(reference); }
            if (reference.type !== 'query') fail('Unsupported transaction read.');
            const raw = await transaction.get(reference.actual.limit(maxReads + 1));
            if (raw.docs.length > maxReads) fail('Transaction query read limit exceeded.');
            for (const document of raw.docs) remember(ref(document.ref.path), document);
            queries.push({ path: reference.path, filters: copy(reference.filters), paths: raw.docs.map(document => document.ref.path).sort() });
            const paths = new Set(raw.docs.map(document => document.ref.path));
            for (const path of staged.keys()) if (path.startsWith(`${reference.path}/`) && path.split('/').length === reference.path.split('/').length + 1) { await load(ref(path)); paths.add(path); }
            const docs = [...paths].sort().map(path => snapshot(ref(path))).filter(document => document.exists && reference.filters.every(([field, , value]) => isDeepStrictEqual(field.split('.').reduce((data, key) => data?.[key], document.data()), value)));
            return { docs, empty: docs.length === 0, size: docs.length };
        },
        set(reference, data, options = {}) {
            if (!plain(data) || Object.keys(options).some(key => key !== 'merge') || ('merge' in options && typeof options.merge !== 'boolean')) fail('Unsupported transaction set.');
            stage(reference, { kind: 'set', data: copy(data), merge: options.merge === true });
        },
        delete(reference) { stage(reference, { kind: 'delete' }); }
    };
    const facade = { collection, async runTransaction(run) {
        assertOpen();
        if (active) fail('Concurrent canonical operations are unsupported.');
        active = true;
        try { return await run(tx); } catch (error) { phase = 'failed'; throw error; } finally { active = false; }
    } };
    async function prepare() {
        if (phase === 'prepared') return copy(prepared);
        assertOpen();
        if (active) fail('Canonical operation is still running.');
        phase = 'preparing';
        try {
            for (const path of staged.keys()) await load(ref(path));
            const writes = [...staged.keys()].sort().map(path => {
                const data = current(path);
                const before = copy(originals.get(path)?.data ?? null);
                return data === undefined ? { path, kind: 'delete', before } : { path, kind: 'set', data: copy(data), before };
            });
            if (Buffer.byteLength(JSON.stringify(writes)) > 8 * 1024 * 1024) fail('Transaction byte limit exceeded.');
            prepared = { writes, reads: { documents: [...originals].map(([path, entry]) => ({ path, version: entry.version })).sort((a, b) => a.path.localeCompare(b.path)), queries } };
            phase = 'prepared';
            return copy(prepared);
        } catch (error) { phase = 'failed'; throw error; }
    }
    async function flush() {
        if (phase === 'flushed') fail('Transaction workspace was already flushed.');
        if (phase === 'failed') fail('Transaction workspace failed.');
        await prepare();
        phase = 'flushed';
        for (const write of prepared.writes) {
            if (write.kind === 'delete') transaction.delete(ref(write.path).actual);
            else transaction.set(ref(write.path).actual, copy(write.data));
        }
    }
    async function execute(operation) {
        assertOpen();
        try { return await operation(facade); }
        catch (error) { phase = 'failed'; throw error; }
    }
    return { db: facade, execute, prepare, flush };
}

module.exports = { createTransactionWorkspace };
