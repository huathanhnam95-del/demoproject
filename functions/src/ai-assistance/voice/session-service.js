'use strict';
const crypto = require('node:crypto');
const { strict, text, reject, digest, deepFreeze } = require('../accounting/money-pricing');
const { AI_VOICE_COLLECTIONS: C } = require('../collections');
const { bounded, dependencies } = require('./contracts');
const TICKET_MS = 60000, SESSION_MS = 15 * 60000;
function createVoiceSessionService(options = {}) {
    const { db, runTransaction, time, adapters, resolve } = dependencies(options);
    const sessionRef = id => db.collection(C.sessions).doc(text(id));
    const eventRef = (id, utteranceId) => db.collection(C.utterances).doc(digest([id, text(utteranceId)]));
    function status(row, replayed = false) { return { sessionId: row.sessionId, epoch: row.epoch, state: row.state, expiresAtMs: row.expiresAtMs, contextRevision: row.contextRevision, summary: row.summary, previewBinding: row.previewBinding, engineeringOnly: row.engineeringOnly, replayed }; }
    async function current(tx, input, requireActive = true) {
        text(input.actorUid); text(input.feature); const ref = sessionRef(input.sessionId), snap = await tx.get(ref), row = snap.exists ? snap.data() : null;
        if (!row || row.actorUid !== input.actorUid || row.feature !== input.feature) reject('SESSION_NOT_FOUND', 'Voice session not found.', 404);
        const context = await resolve(tx, row.actorUid, row.feature, row.contextHints);
        if (requireActive && (row.state === 'closed' || row.expiresAtMs <= time())) reject('SESSION_EXPIRED', 'Voice session is closed or expired.', 409);
        if (input.epoch !== undefined && input.epoch !== row.epoch) reject('STALE_EPOCH', 'Voice connection changed.', 409);
        return { row, ref, context };
    }
    function epoch(value) { if (!Number.isSafeInteger(value) || value < 1) reject('STALE_EPOCH', 'A current connection epoch is required.', 409); }
    function exactContext(row, context) { if (row.contextDigest !== context.contextDigest) reject('CONTEXT_CHANGED', 'Refresh the current preview before speaking confirmation.', 409); }
    const service = {
        async prepare(input) {
            strict(input, ['actorUid', 'feature', 'requestId', 'contextHints']); text(input.requestId); const hints = bounded(input.contextHints ?? {});
            return runTransaction(async tx => {
                const context = await resolve(tx, input.actorUid, input.feature, hints);
                if (options.engineeringMode !== true && options.nativeMode !== true) reject('NATIVE_VOICE_UNAVAILABLE', 'Voice is not configured.', 503);
                const sessionId = digest([input.actorUid, input.feature, input.requestId]), ref = sessionRef(sessionId), old = await tx.get(ref), requestDigest = digest(hints);
                if (old.exists) { const row = old.data(); if (row.requestDigest !== requestDigest) reject('SESSION_CONFLICT', 'Request identity already used.', 409); const changed = row.contextDigest !== context.contextDigest; const next = { ...row, ...context, contextRevision: row.contextRevision + (changed ? 1 : 0) }; if (changed) tx.set(ref, next); return { ...status(next, true), ticket: null }; }
                const at = time(), ticket = crypto.randomBytes(32).toString('base64url');
                const row = { sessionId, actorUid: input.actorUid, feature: input.feature, requestDigest, contextHints: hints, ...context, contextRevision: 0, state: 'prepared', epoch: 0, engineeringOnly: options.nativeMode !== true, ticketHash: digest(ticket), ticketExpiresAtMs: at + TICKET_MS, expiresAtMs: at + SESSION_MS };
                tx.create(ref, row); return { ...status(row), ticket };
            });
        },
        async claim(input) {
            strict(input, ['actorUid', 'feature', 'sessionId', 'ticket', 'connectionId']); text(input.ticket, 'ticket'); text(input.connectionId, 'connection ID');
            return runTransaction(async tx => {
                const { row, ref, context } = await current(tx, input); exactContext(row, context);
                if (row.ticketHash !== digest(input.ticket)) reject('INVALID_TICKET', 'Invalid voice ticket.', 403);
                if (row.state === 'connected') { if (row.connectionId !== input.connectionId) reject('TICKET_CONSUMED', 'Ticket was already consumed.', 409); return status(row, true); }
                if (row.state !== 'prepared' || row.ticketExpiresAtMs <= time()) reject('TICKET_EXPIRED', 'Ticket expired.', 409);
                const next = { ...row, state: 'connected', epoch: row.epoch + 1, connectionId: input.connectionId }; tx.set(ref, next); return status(next);
            });
        },
        async readStatus(input) { strict(input, ['actorUid', 'feature', 'sessionId']); return runTransaction(async tx => { const { row, ref, context } = await current(tx, input, false); const changed = row.contextDigest !== context.contextDigest;
            const next = { ...row, ...context, contextRevision: row.contextRevision + (changed ? 1 : 0) }; if (changed) tx.set(ref, next);
            return { ...status(next), contextChanged: changed }; }); },
        async updateContext(input) {
            strict(input, ['actorUid', 'feature', 'sessionId', 'epoch', 'contextHints']); epoch(input.epoch);
            return runTransaction(async tx => { const { row, ref } = await current(tx, input); const hints = bounded(input.contextHints ?? {}), context = await resolve(tx, row.actorUid, row.feature, hints); const changed = row.contextDigest !== context.contextDigest;
                const next = { ...row, ...context, contextHints: hints, contextRevision: row.contextRevision + (changed ? 1 : 0) }; tx.set(ref, next); return status(next, !changed); });
        },
        async close(input) { strict(input, ['actorUid', 'feature', 'sessionId', 'epoch']); epoch(input.epoch); return runTransaction(async tx => { const { row, ref } = await current(tx, input, false); if (row.state === 'closed') return status(row, true); const next = { ...row, state: 'closed' }; tx.set(ref, next); return status(next); }); },
        // Server-only capability. Never expose this method or its events as a
        // client route; only the provider driver owns user-audio provenance.
        providerChannel(identity) {
            strict(identity, ['actorUid', 'feature', 'sessionId', 'epoch']); epoch(identity.epoch); if (options.engineeringMode !== true && options.nativeMode !== true) reject('NATIVE_VOICE_UNAVAILABLE', 'Voice is not configured.', 503); const owner = bounded(identity);
            async function handle(event, final) {
                strict(event, ['utteranceId', 'eventId', 'source', ...(final ? ['audioEvidence', 'text', 'final'] : [])]); text(event.utteranceId); text(event.eventId);
                if (final) {
                    strict(event.audioEvidence, ['audioDigest', 'durationMs', 'transcription']);
                    if (options.nativeMode === true) {
                        const proof = event.audioEvidence.transcription;
                        strict(proof, ['model', 'responseId', 'responseDigest', 'audioDigest', 'reservationId', 'finishReason', 'source']);
                        if (proof.model !== 'gemini-3.8-flash' || proof.source !== 'captured_user_audio' || proof.finishReason !== 'STOP' || proof.audioDigest !== event.audioEvidence.audioDigest || !/^[a-f0-9]{64}$/.test(proof.responseDigest)) reject('UNTRUSTED_UTTERANCE', 'Completed audio transcription provenance is required.', 403);
                        text(proof.responseId); text(proof.reservationId);
                    } else if (event.audioEvidence.transcription !== undefined) reject('UNTRUSTED_UTTERANCE', 'Native provenance requires native registration.', 403);
                }
                if (event.source !== 'user_audio' || final && (!/^[a-f0-9]{64}$/.test(event.audioEvidence.audioDigest) || !Number.isSafeInteger(event.audioEvidence.durationMs) || event.audioEvidence.durationMs < 1 || event.audioEvidence.durationMs > 120000)) reject('UNTRUSTED_UTTERANCE', 'Bounded provider user-audio evidence is required.', 403);
                if (final && (event.final !== true || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 16000)) reject('INVALID_UTTERANCE', 'Final bounded user speech is required.');
                return runTransaction(async tx => {
                    const { row, context } = await current(tx, owner); if (row.state !== 'connected') reject('SESSION_NOT_CONNECTED', 'Voice provider connection is not active.', 409);
                    const ref = eventRef(row.sessionId, event.utteranceId), snap = await tx.get(ref), old = snap.exists ? snap.data() : null, eventDigest = digest(event);
                    const markerRef = db.collection(C.utterances).doc(digest(['event', row.sessionId, row.epoch, event.eventId]));
                    const marker = await tx.get(markerRef);
                    if (marker.exists && marker.data().eventDigest !== eventDigest) reject('PROVIDER_EVENT_CONFLICT', 'Provider event identity was reused.', 409);
                    if (!final) {
                        if (old) { if (old.beginDigest !== eventDigest) reject('UTTERANCE_CONFLICT', 'Utterance identity changed.', 409); return { utteranceId: event.utteranceId, replayed: true }; }
                        tx.create(markerRef, { eventDigest });
                        tx.create(ref, { sessionId: row.sessionId, epoch: row.epoch, utteranceId: event.utteranceId, beginDigest: eventDigest, contextDigest: context.contextDigest, contextRevision: row.contextRevision, binding: row.contextDigest === context.contextDigest ? context.previewBinding : null, state: 'started' });
                        return { utteranceId: event.utteranceId, replayed: false };
                    }
                    if (!old || old.epoch !== row.epoch) reject('UTTERANCE_CONTEXT_CHANGED', 'Utterance does not belong to this connection.', 409);
                    if (old.state === 'final') { if (old.finalDigest !== eventDigest) reject('UTTERANCE_CONFLICT', 'Final utterance changed.', 409); return { attestationId: old.attestationId, text: old.text, replayed: true }; }
                    const matches = old.contextDigest === context.contextDigest && old.contextRevision === row.contextRevision && old.binding && old.binding.expiresAtMs > time() && digest(old.binding) === digest(context.previewBinding);
                    const confirmed = matches && await adapters.get(row.feature).confirm({ text: event.text, binding: deepFreeze(bounded(old.binding)), context: deepFreeze(bounded(context.context, 32768)) }) === true;
                    const attestationId = confirmed ? digest([row.sessionId, row.epoch, event.utteranceId]) : null;
                    let attestationRef;
                    if (confirmed) {
                        attestationRef = db.collection(C.attestations).doc(attestationId);
                        const existing = await tx.get(attestationRef); if (existing.exists) reject('ATTESTATION_CONFLICT', 'Attestation already exists.', 409);
                    }
                    tx.create(markerRef, { eventDigest });
                    if (confirmed) tx.create(attestationRef, { attestationId, actorUid: row.actorUid, feature: row.feature, sessionId: row.sessionId, epoch: row.epoch, binding: old.binding, contextHints: row.contextHints, contextDigest: context.contextDigest, contextRevision: row.contextRevision, utteranceDigest: eventDigest, expiresAtMs: Math.min(row.expiresAtMs, old.binding.expiresAtMs), engineeringOnly: row.engineeringOnly, consumedReceiptId: null });
                    tx.set(ref, { ...old, state: 'final', finalDigest: eventDigest, text: event.text, audioEvidence: bounded(event.audioEvidence), attestationId }); return { attestationId, text: event.text, replayed: false };
                });
            }
            return Object.freeze({ getContext: () => runTransaction(async tx => { const { context } = await current(tx, owner); return context; }), beginUtterance: event => handle(event, false), finalizeUtterance: event => handle(event, true) });
        }
    };
    return Object.freeze(service);
}
module.exports = { createVoiceSessionService };
