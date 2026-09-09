'use strict';
const { strict, text, reject, digest, deepFreeze } = require('../accounting/money-pricing');
const { AI_DRAFT_COLLECTIONS: C } = require('../collections');
const MAX_BYTES = 65536, MAX_ACTIONS = 20, TTL_MS = 30 * 60000;
function json(value, limit = MAX_BYTES) {
    function valid(item, depth = 0) {
        if (depth > 32) reject('INVALID_DRAFT_INPUT', 'Draft nesting is too deep.');
        if (item === null || ['string', 'boolean'].includes(typeof item) || typeof item === 'number' && Number.isFinite(item)) return;
        if (Array.isArray(item)) { for (const child of item) valid(child, depth + 1); return; }
        if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) reject('INVALID_DRAFT_INPUT', 'Drafts require JSON data.');
        for (const [key, child] of Object.entries(item)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) reject('INVALID_DRAFT_INPUT', 'Unsupported draft key.'); valid(child, depth + 1); }
    }
    valid(value); const serialized = JSON.stringify(value); if (Buffer.byteLength(serialized) > limit) reject('DRAFT_TOO_LARGE', 'Draft exceeds its byte limit.'); return JSON.parse(serialized);
}
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) reject('INVALID_DRAFT_INPUT', 'A draft object is required.'); }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) reject('INVALID_REVISION', 'A nonnegative revision is required.'); }
function contentDigest(row) { return digest({ draftId: row.draftId, actorUid: row.actorUid, feature: row.feature, scope: row.scope, revision: row.revision, actions: row.actions, status: row.status, expiresAtMs: row.expiresAtMs }); }
function createDraftStore({ db, runTransaction, now = Date.now, featureAdapters } = {}) {
    if (!db || typeof runTransaction !== 'function' || typeof now !== 'function') throw TypeError('Draft store requires database, transaction runner and clock.');
    const adapters = new Map(Object.entries(featureAdapters || {}).map(([key, value]) => { text(key); if (typeof value.authorize !== 'function' || typeof value.normalizeScope !== 'function' || typeof value.normalizeActions !== 'function' && typeof value.normalizeAction !== 'function') throw TypeError('Draft adapter requires current authority, scope and action validation.'); return [key, Object.freeze({ ...value })]; }));
    const prepared = new WeakMap();
    const ref = (kind, id) => db.collection(C[kind]).doc(text(id));
    const revisionRef = row => ref('revisions', digest([row.draftId, row.revision]));
    const at = () => { const value = Number(now()); if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - TTL_MS) reject('INVALID_TIME', 'Invalid draft clock.'); return value; };
    const snapshot = row => deepFreeze({ ...json(row), expired: row.expiresAtMs <= at() });
    function adapter(feature) { text(feature); const value = adapters.get(feature); if (!value) reject('DRAFT_FORBIDDEN', 'Draft feature is not registered.', 403); return value; }
    function scopeFor(a, scope) { const normalized = json(a.normalizeScope(json(scope, 4096)), 4096); object(normalized); return normalized; }
    async function authorize(tx, actorUid, feature, scope) { text(actorUid); const a = adapter(feature); if (await a.authorize({ tx, actorUid, scope: deepFreeze(json(scope)) }) !== true) reject('DRAFT_FORBIDDEN', 'Current feature scope authority is required.', 403); return a; }
    function normalizeActions(a, actions) {
        if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) reject('INVALID_ACTIONS', 'At most 20 actions are supported.');
        const before = json(actions); const normalized = json(a.normalizeActions ? a.normalizeActions(json(before)) : before.map(action => a.normalizeAction(json(action))));
        if (!Array.isArray(normalized) || normalized.length !== before.length) reject('INVALID_ACTIONS', 'Validation cannot change action count.');
        const ids = new Set(); normalized.forEach((action, index) => { object(action); text(action.actionId, 'action ID'); text(action.kind, 'action kind'); if (action.actionId !== before[index].actionId || action.kind !== before[index].kind || ids.has(action.actionId)) reject('ACTION_IDENTITY_CHANGED', 'Action identity and order are immutable.'); ids.add(action.actionId); });
        return normalized;
    }
    function integrity(row, id, a) {
        if (!row || row.draftId !== id || !['active', 'declined', 'committed'].includes(row.status)) reject('DRAFT_INTEGRITY', 'Stored draft is invalid.', 409);
        revision(row.revision); if (row.status === 'committed') text(row.receiptId, 'committed receipt ID'); else if (row.receiptId !== null) reject('DRAFT_INTEGRITY', 'Uncommitted draft cannot carry an effect receipt.', 409); if (!Number.isSafeInteger(row.createdAtMs) || !Number.isSafeInteger(row.expiresAtMs) || row.expiresAtMs <= row.createdAtMs || row.expiresAtMs - row.createdAtMs > TTL_MS) reject('DRAFT_INTEGRITY', 'Stored draft expiry is invalid.', 409);
        if (digest(scopeFor(a, row.scope)) !== digest(row.scope) || digest(normalizeActions(a, row.actions)) !== digest(row.actions) || contentDigest(row) !== row.draftDigest) reject('DRAFT_INTEGRITY', 'Stored draft does not match its validated digest.', 409);
        json(row); return row;
    }
    async function load(tx, input) {
        text(input.actorUid); const a = adapter(input.feature), document = ref('drafts', input.draftId), snap = await tx.get(document), row = snap.exists ? snap.data() : null;
        if (!row || row.actorUid !== input.actorUid || row.feature !== input.feature) reject('DRAFT_NOT_FOUND', 'Draft not found.', 404);
        await authorize(tx, input.actorUid, input.feature, scopeFor(a, row.scope)); integrity(row, input.draftId, a);
        return { row, document, a };
    }
    function request(input, operation) { text(input.requestId, 'request ID'); const requestRef = ref('requests', digest([input.actorUid, input.feature, input.requestId])); return { requestRef, fingerprint: digest({ operation, input }) }; }
    async function replay(tx, record, fingerprint) {
        if (record.fingerprint !== fingerprint) reject('DRAFT_REQUEST_CONFLICT', 'Request identity already belongs to different input.', 409);
        const stored = await tx.get(ref('revisions', digest([record.draftId, record.revision])));
        if (!stored.exists) reject('DRAFT_INTEGRITY', 'Original request revision is missing.', 409);
        const row = stored.data(); integrity(row, record.draftId, adapter(row.feature)); return { draft: snapshot(row), replayed: true };
    }
    function save(tx, row, document, identity) {
        revision(row.revision); const next = { ...row, draftDigest: contentDigest(row) }; json(next);
        tx.create(revisionRef(next), next); tx.set(document, next);
        if (identity) tx.create(identity.requestRef, { fingerprint: identity.fingerprint, draftId: next.draftId, revision: next.revision });
        return next;
    }
    function fresh(row) { if (row.expiresAtMs <= at()) reject('DRAFT_EXPIRED', 'Create a new draft to continue after expiry.', 409); if (row.status === 'committed') reject('DRAFT_COMMITTED', 'Committed drafts cannot be changed.', 409); }
    const api = {
        async create(raw) {
            strict(raw, ['actorUid', 'feature', 'requestId', 'scope', 'actions']); const input = json(raw), a = adapter(input.feature), scope = scopeFor(a, input.scope);
            if (!Array.isArray(input.actions) || input.actions.length > MAX_ACTIONS) reject('INVALID_ACTIONS', 'At most 20 actions are supported.');
            for (const action of input.actions) { object(action); if (Object.hasOwn(action, 'actionId') || Object.hasOwn(action, 'provenance')) reject('CLIENT_ACTION_IDENTITY', 'Action identity and provenance are server-owned.'); text(action.kind, 'action kind'); }
            const identity = request(input, 'create'), draftId = digest(['draft', input.actorUid, input.feature, input.requestId]);
            const actions = normalizeActions(a, input.actions.map((action, index) => ({ ...action, actionId: `action-${digest([draftId, index]).slice(0, 24)}` })));
            return runTransaction(async tx => {
                await authorize(tx, input.actorUid, input.feature, scope); const prior = await tx.get(identity.requestRef);
                if (prior.exists) { await load(tx, { ...input, draftId: prior.data().draftId }); return replay(tx, prior.data(), identity.fingerprint); }
                const document = ref('drafts', draftId), existing = await tx.get(document); if (existing.exists) reject('DRAFT_INTEGRITY', 'Draft request record is missing.', 409);
                const timestamp = at(); const row = save(tx, { draftId, actorUid: input.actorUid, feature: input.feature, scope, actions, revision: 0, status: 'active', createdAtMs: timestamp, updatedAtMs: timestamp, expiresAtMs: timestamp + TTL_MS, previewBinding: null, receiptId: null }, document, identity);
                return { draft: snapshot(row), replayed: false };
            });
        },
        async correct(raw) {
            strict(raw, ['actorUid', 'feature', 'draftId', 'expectedRevision', 'actionId', 'patch', 'requestId']); const input = json(raw); revision(input.expectedRevision); text(input.actionId); object(input.patch);
            if (['actionId', 'kind', 'provenance'].some(key => Object.hasOwn(input.patch, key))) reject('ACTION_IDENTITY_CHANGED', 'Correction cannot replace identity, kind or provenance.');
            return runTransaction(async tx => {
                const { row, document, a } = await load(tx, input), identity = request(input, 'correct'), prior = await tx.get(identity.requestRef);
                if (prior.exists) return replay(tx, prior.data(), identity.fingerprint);
                fresh(row); if (row.revision !== input.expectedRevision) reject('DRAFT_REVISION_CONFLICT', 'Refresh the current draft revision.', 409);
                const index = row.actions.findIndex(action => action.actionId === input.actionId); if (index < 0) reject('ACTION_NOT_FOUND', 'Draft action not found.', 404);
                const candidate = json(row.actions); candidate[index] = { ...candidate[index], ...input.patch }; const actions = normalizeActions(a, candidate);
                for (let n = 0; n < actions.length; n++) if (n !== index && digest(actions[n]) !== digest(row.actions[n])) reject('ACTION_IDENTITY_CHANGED', 'Correction changed another action.');
                const next = save(tx, { ...row, actions, revision: row.revision + 1, status: 'active', updatedAtMs: at(), previewBinding: null }, document, identity);
                return { draft: snapshot(next), replayed: false };
            });
        },
        async read(input) { strict(input, ['actorUid', 'feature', 'draftId']); return runTransaction(async tx => snapshot((await load(tx, input)).row)); },
        async decline(raw) {
            strict(raw, ['actorUid', 'feature', 'draftId', 'expectedRevision', 'requestId']); const input = json(raw); revision(input.expectedRevision);
            return runTransaction(async tx => { const { row, document } = await load(tx, input), identity = request(input, 'decline'), prior = await tx.get(identity.requestRef); if (prior.exists) return replay(tx, prior.data(), identity.fingerprint);
                fresh(row); if (row.revision !== input.expectedRevision) reject('DRAFT_REVISION_CONFLICT', 'Refresh the current draft revision.', 409);
                const next = save(tx, { ...row, status: 'declined', revision: row.revision + 1, updatedAtMs: at(), previewBinding: null }, document, identity); return { draft: snapshot(next), replayed: false }; });
        },
        async prepareCurrent(tx, input) {
            strict(input, ['actorUid', 'feature', 'draftId', 'expectedRevision']); const { row, document } = await load(tx, input);
            if (input.expectedRevision !== undefined) { revision(input.expectedRevision); if (row.revision !== input.expectedRevision) reject('DRAFT_REVISION_CONFLICT', 'Refresh the current draft revision.', 409); }
            const draft = snapshot(row); prepared.set(draft, { tx, row, document, staged: null }); return draft;
        },
        stageCommitted(tx, { draft, receiptId }) {
            text(receiptId, 'receipt ID'); const entry = prepared.get(draft);
            if (!entry || entry.tx !== tx) reject('DRAFT_NOT_PREPARED', 'Prepare the current draft in this transaction before staging effects.', 409);
            if (entry.staged) { if (entry.staged.receiptId !== receiptId) reject('DRAFT_COMMIT_CONFLICT', 'Draft is already staged for another receipt.', 409); return entry.staged; }
            const row = entry.row;
            if (row.status === 'committed') { if (row.receiptId !== receiptId) reject('DRAFT_COMMIT_CONFLICT', 'Draft was committed under another receipt.', 409); return draft; }
            fresh(row); if (row.status !== 'active') reject('DRAFT_DECLINED', 'Declined draft requires an explicit correction before committing.', 409);
            const next = save(tx, { ...row, status: 'committed', receiptId, revision: row.revision + 1, updatedAtMs: at() }, entry.document); entry.staged = snapshot(next); return entry.staged;
        }
    };
    return Object.freeze(api);
}
module.exports = { createDraftStore, MAX_ACTIONS, MAX_BYTES, TTL_MS };
