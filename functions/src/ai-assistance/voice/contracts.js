'use strict';
const { strict, text, reject, digest } = require('../accounting/money-pricing');
function bounded(value, max = 4096) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch { reject('INVALID_VOICE_INPUT', 'JSON input required.'); }
    if (!serialized || Buffer.byteLength(serialized) > max) reject('INVALID_VOICE_INPUT', 'Voice input exceeds its bound.');
    return JSON.parse(serialized);
}
function binding(value, actorUid, feature, at) {
    strict(value, ['actorUid', 'feature', 'draftId', 'previewId', 'revision', 'draftDigest', 'expiresAtMs', 'projectId', 'revisionFences']);
    if (value.actorUid !== actorUid || value.feature !== feature) reject('BINDING_MISMATCH', 'Preview belongs to another actor or feature.', 403);
    for (const key of ['draftId', 'previewId', 'draftDigest']) text(value[key], key);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= at) reject('PREVIEW_EXPIRED', 'A current bounded preview is required.', 409);
    if (value.projectId !== undefined) text(value.projectId, 'project ID');
    if (value.revisionFences !== undefined) {
        if (!value.revisionFences || typeof value.revisionFences !== 'object' || Array.isArray(value.revisionFences) || Object.keys(value.revisionFences).length > 16) reject('INVALID_BINDING', 'Invalid revision fences.');
        for (const [key, revision] of Object.entries(value.revisionFences)) { text(key); if (!Number.isSafeInteger(revision) || revision < 0) reject('INVALID_BINDING', 'Invalid revision fence.'); }
    }
    return bounded(value);
}
function dependencies({ db, runTransaction, now = Date.now, featureAdapters } = {}) {
    if (!db || typeof runTransaction !== 'function' || typeof now !== 'function') throw TypeError('Voice service requires database, transaction runner and clock.');
    const adapters = new Map(Object.entries(featureAdapters || {}));
    for (const [name, adapter] of adapters) { text(name); if (typeof adapter.authorize !== 'function' || typeof adapter.resolveContext !== 'function' || typeof adapter.confirm !== 'function') throw TypeError('Voice adapter requires authorization, current context and confirmation policy.'); }
    function time() { const value = Number(now()); if (!Number.isSafeInteger(value)) reject('INVALID_TIME', 'Invalid service clock.'); return value; }
    async function authorize(tx, actorUid, feature) {
        text(actorUid); text(feature); const adapter = adapters.get(feature);
        if (!adapter || await adapter.authorize({ tx, actorUid }) !== true) reject('VOICE_FORBIDDEN', 'Current feature authority is required.', 403);
        return adapter;
    }
    async function resolve(tx, actorUid, feature, hints) {
        const adapter = await authorize(tx, actorUid, feature);
        const value = await adapter.resolveContext({ tx, actorUid, contextHints: bounded(hints) });
        strict(value, ['summary', 'previewBinding', 'context']);
        if (typeof value.summary !== 'string' || value.summary.length > 4000) reject('INVALID_CONTEXT', 'A bounded safe summary is required.');
        const previewBinding = value.previewBinding === null ? null : binding(value.previewBinding, actorUid, feature, Number.MIN_SAFE_INTEGER);
        const context = bounded(value.context ?? {}, 32768);
        return { summary: value.summary, previewBinding, context, contextDigest: digest({ summary: value.summary, previewBinding, context }) };
    }
    return { db, runTransaction, time, adapters, authorize, resolve };
}
module.exports = { bounded, binding, dependencies };
