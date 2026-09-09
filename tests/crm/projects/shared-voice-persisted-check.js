'use strict';
// Real isolated Firestore/Auth emulator checks. All audio evidence below is
// synthetic engineering provenance; this is not native provider proof.
const baseAssert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const h = require('./phase4-test-helpers');
const { caseRun, finish } = require('./phase5-test-helpers');
const { seedFixtures } = require('../../../scripts/crm/projects/seed-fixtures');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { createVoiceConfirmationService } = require('../../../functions/src/ai-assistance/voice/confirmation-service');
const { AI_VOICE_COLLECTIONS: C } = require('../../../functions/src/ai-assistance/collections');
let assertions = 0;
const assert = new Proxy(baseAssert, { get(target, key) { return typeof target[key] === 'function' ? (...args) => { assertions++; return target[key](...args); } : target[key]; } });
async function main() {
    const config = h.assertDedicatedEmulators(), app = h.initializeFixtureApp(config), results = [];
    try {
        await seedFixtures({ config, app });
        const db = app.firestore(), auth = app.auth(), uid = 'crm-projects-teacher';
        const profileRef = db.collection('users').doc(uid), originalProfile = (await profileRef.get()).data();
        let sequence = 0; const runId = randomUUID();
        const fixture = async () => {
            const id = `shared-voice-${runId}-${++sequence}`, ref = db.collection('crmProjectOrganizationConfig').doc(id);
            const state = { at: Date.now() };
            await auth.updateUser(uid, { disabled: false }); await profileRef.update({ sharedVoiceEngineeringAllowed: true });
            await ref.set({ revision: 1, preview: true, expiresAtMs: state.at + 1200000, summary: 'Current authorized engineering preview' });
            const adapter = {
                async authorize({ tx, actorUid }) { const user = await auth.getUser(actorUid); const profile = await tx.get(db.collection('users').doc(actorUid)); return actorUid === uid && !user.disabled && profile.exists && profile.data().sharedVoiceEngineeringAllowed === true; },
                async resolveContext({ tx, actorUid }) { const data = (await tx.get(ref)).data(); return { summary: data.summary, context: { authorizedRevision: data.revision, serverOnly: 'private-context-marker' }, previewBinding: data.preview ? { actorUid, feature: 'projects', draftId: id, previewId: `preview-${data.revision}`, revision: data.revision, draftDigest: `digest-${data.revision}`, expiresAtMs: data.expiresAtMs, projectId: id, revisionFences: { project: data.revision } } : null }; },
                confirm: ({ text }) => text === 'I confirm the exact engineering preview.'
            };
            const options = { db, runTransaction: fn => db.runTransaction(fn), now: () => state.at, featureAdapters: { projects: adapter }, engineeringMode: true };
            const service = createVoiceSessionService(options), other = createVoiceSessionService(options), confirmation = createVoiceConfirmationService(options);
            const prepared = await service.prepare({ actorUid: uid, feature: 'projects', requestId: id, contextHints: {} });
            const identity = { actorUid: uid, feature: 'projects', sessionId: prepared.sessionId };
            async function connect() { const status = await service.claim({ ...identity, ticket: prepared.ticket, connectionId: 'connection' }); return service.providerChannel({ ...identity, epoch: status.epoch }); }
            async function attest() {
                const channel = await connect(); await channel.beginUtterance({ utteranceId: 'utterance', eventId: 'begin-event', source: 'user_audio' });
                const event = { utteranceId: 'utterance', eventId: 'final-event', source: 'user_audio', final: true, text: 'I confirm the exact engineering preview.', audioEvidence: { audioDigest: 'b'.repeat(64), durationMs: 1600 } };
                const proof = await channel.finalizeUtterance(event); return { proof, channel, event };
            }
            async function consume(proof, receiptId, { rollback = false } = {}) {
                const original = (await db.collection(C.attestations).doc(proof.attestationId).get()).data();
                const input = { actorUid: uid, feature: 'projects', attestationId: proof.attestationId, binding: original.binding, receiptId };
                return db.runTransaction(async tx => {
                    const stage = await confirmation.prepareConsumption(tx, input);
                    const effectRef = ref.collection('effects').doc(receiptId), receiptRef = ref.collection('receipts').doc(receiptId);
                    const [effect, receipt] = await Promise.all([tx.get(effectRef), tx.get(receiptRef)]);
                    if (stage.replayed) { assert.equal(effect.exists, true); assert.equal(receipt.exists, true); stage.consume(); return { replayed: true }; }
                    assert.equal(effect.exists, false); assert.equal(receipt.exists, false);
                    stage.consume(); tx.create(effectRef, { count: 1, engineeringOnly: true }); tx.create(receiptRef, { attestationId: proof.attestationId, engineeringOnly: true });
                    if (rollback) throw Object.assign(Error('Injected domain rollback'), { code: 'INJECTED_ROLLBACK' });
                    return { replayed: false };
                });
            }
            return { id, ref, state, service, other, confirmation, prepared, identity, connect, attest, consume };
        };
        try {
            await caseRun('two persisted instances race one ticket and retain one durable epoch', async () => {
                const f = await fixture(); const claim = { ...f.identity, ticket: f.prepared.ticket };
                const outcomes = await Promise.allSettled([f.service.claim({ ...claim, connectionId: 'one' }), f.other.claim({ ...claim, connectionId: 'two' })]);
                assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'TICKET_CONSUMED');
                const saved = (await db.collection(C.sessions).doc(f.prepared.sessionId).get()).data(); assert.equal(saved.epoch, 1); assert.equal(saved.state, 'connected'); assert.equal(JSON.stringify(saved).includes(f.prepared.ticket), false);
                assert.equal((await f.other.claim({ ...claim, connectionId: saved.connectionId })).replayed, true);
                assert.equal((await f.other.readStatus(f.identity)).epoch, 1);
            }, results);
            await caseRun('provider synthetic user-audio utterance and attestation survive instance restart', async () => {
                const f = await fixture(), a = await f.attest(); assert.ok(a.proof.attestationId);
                const stored = (await db.collection(C.attestations).doc(a.proof.attestationId).get()).data(); assert.equal(stored.engineeringOnly, true); assert.equal(stored.actorUid, uid); assert.equal(stored.consumedReceiptId, null);
                const utterances = await db.collection(C.utterances).where('sessionId', '==', f.prepared.sessionId).get(); assert.equal(utterances.size, 1); assert.equal(utterances.docs[0].data().state, 'final'); assert.equal(utterances.docs[0].data().attestationId, a.proof.attestationId);
                const restartedChannel = f.other.providerChannel({ ...f.identity, epoch: 1 }); assert.equal((await restartedChannel.finalizeUtterance(a.event)).replayed, true);
                await assert.rejects(restartedChannel.finalizeUtterance({ ...a.event, source: 'assistant' }), error => error.code === 'UNTRUSTED_UTTERANCE');
            }, results);
            await caseRun('attestation and domain effect receipt commit atomically and competing receipt cannot partially apply', async () => {
                const f = await fixture(), a = await f.attest();
                await assert.rejects(f.consume(a.proof, 'rollback', { rollback: true }), error => error.code === 'INJECTED_ROLLBACK');
                assert.equal((await db.collection(C.attestations).doc(a.proof.attestationId).get()).data().consumedReceiptId, null);
                assert.equal((await f.ref.collection('effects').doc('rollback').get()).exists, false); assert.equal((await f.ref.collection('receipts').doc('rollback').get()).exists, false);
                const results = await Promise.allSettled([f.consume(a.proof, 'receipt-one'), f.consume(a.proof, 'receipt-two')]);
                assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.find(x => x.status === 'rejected').reason.code, 'ATTESTATION_CONSUMED');
                const stored = (await db.collection(C.attestations).doc(a.proof.attestationId).get()).data(), winner = stored.consumedReceiptId;
                assert.equal((await f.ref.collection('effects').get()).size, 1); assert.equal((await f.ref.collection('receipts').get()).size, 1);
                await f.ref.update({ preview: false }); await f.service.close({ ...f.identity, epoch: 1 }); f.state.at += 1800000;
                assert.equal((await f.consume(a.proof, winner)).replayed, true); assert.equal((await f.ref.collection('effects').get()).size, 1);
            }, results);
            await caseRun('persisted current authority revocation rejects ticket, speech, status and receipt replay', async () => {
                const f = await fixture(), a = await f.attest(); await f.consume(a.proof, 'receipt');
                await profileRef.update({ sharedVoiceEngineeringAllowed: false });
                for (const action of [() => f.other.readStatus(f.identity), () => f.other.claim({ ...f.identity, ticket: f.prepared.ticket, connectionId: 'connection' }), () => a.channel.beginUtterance({ utteranceId: 'new', eventId: 'new', source: 'user_audio' }), () => f.consume(a.proof, 'receipt')]) await assert.rejects(action(), error => error.code === 'VOICE_FORBIDDEN');
                await profileRef.update({ sharedVoiceEngineeringAllowed: true }); await auth.updateUser(uid, { disabled: true });
                try { await assert.rejects(f.other.readStatus(f.identity), error => error.code === 'VOICE_FORBIDDEN'); } finally { await auth.updateUser(uid, { disabled: false }); }
                assert.equal((await f.ref.collection('effects').get()).size, 1);
            }, results);
            await caseRun('persisted preview change suppresses confirmation and refreshes safe public context', async () => {
                const f = await fixture(), channel = await f.connect(); await channel.beginUtterance({ utteranceId: 'utterance', eventId: 'begin', source: 'user_audio' });
                await f.ref.update({ revision: 2, summary: 'New permitted summary' });
                const final = await channel.finalizeUtterance({ utteranceId: 'utterance', eventId: 'final', source: 'user_audio', final: true, text: 'I confirm the exact engineering preview.', audioEvidence: { audioDigest: 'c'.repeat(64), durationMs: 1200 } }); assert.equal(final.attestationId, null);
                const status = await f.other.readStatus(f.identity); assert.equal(status.contextChanged, true); assert.equal(status.summary, 'New permitted summary'); assert.equal(status.previewBinding.revision, 2); assert.equal(JSON.stringify(status).includes('private-context-marker'), false);
                const g = await fixture(), a = await g.attest(); await g.ref.update({ revision: 2 }); await assert.rejects(g.consume(a.proof, 'stale'), error => error.code === 'STALE_ATTESTATION'); assert.equal((await g.ref.collection('effects').get()).size, 0);
            }, results);
            await caseRun('direct authenticated clients cannot read or mutate any voice collection', async () => {
                const f = await fixture(), a = await f.attest(), token = await h.signIn(h.USERS.owner);
                const utterance = (await db.collection(C.utterances).where('sessionId', '==', f.prepared.sessionId).get()).docs[0];
                const paths = [[C.sessions, f.prepared.sessionId], [C.utterances, utterance.id], [C.attestations, a.proof.attestationId]];
                for (const [collection, id] of paths) for (const method of ['GET', 'PATCH']) {
                    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${config.projectId}/databases/(default)/documents/${collection}/${id}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { consumedReceiptId: { stringValue: 'forged' } } }) } : {}) });
                    assert.equal(response.status, 403, `${collection} ${method}: ${await response.text()}`);
                }
                assert.equal((await db.collection(C.attestations).doc(a.proof.attestationId).get()).data().consumedReceiptId, null);
            }, results);
        } finally { await auth.updateUser(uid, { disabled: false }); await profileRef.set(originalProfile); }
    } finally { await app.delete(); }
    process.stdout.write(`SHARED_VOICE_PERSISTED_ASSERTIONS=${assertions}; SYNTHETIC_ENGINEERING_PROVENANCE_ONLY\n`);
    finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
