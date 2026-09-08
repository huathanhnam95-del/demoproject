'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { createAdmission } = require('./authorization');
const { createDataInputAssistance } = require('./assistance-service');
const { createDataInputNativeServices } = require('./native-provider');

/** Trusted runtime entry point. The relay verifies each bearer before invoking
 * runAsIdentity for that operation; callers cannot supply identity via a body.
 * Optional Admin injection is for local unit tests, never runtime environment. */
async function composeVoice({ config, admin, nativeCredentials, createVoiceProvider, createLiveUsageDescriptor } = {}) {
    if (!config || typeof config.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(config.projectId)) throw TypeError('A configured Firebase project is required.');
    admin ||= require('firebase-admin');
    const app = admin.initializeApp({ projectId: config.projectId }, `crm-data-input-voice-${randomUUID()}`);
    const identities = new AsyncLocalStorage();
    let closed = false, closing;
    function requireOpen() { if (closed) throw Error('Voice composition is closed.'); }
    function close() {
        if (!closing) {
            closed = true; identities.disable();
            closing = Promise.resolve().then(() => app.delete());
        }
        return closing;
    }
    try {
        const db = app.firestore(), auth = app.auth();
        const authorize = async ({ tx, actorUid }) => {
            const scope = identities.getStore();
            if (closed || !scope?.active || scope.identity.uid !== actorUid) return false;
            const allowed = await createAdmission({ db, authClient: auth, identity: scope.identity })({ tx, actorUid });
            return !closed && scope.active && allowed === true;
        };
        const nativeMode = config.nativeEnabled === true;
        const native = nativeMode ? createDataInputNativeServices({ apiKey: nativeCredentials?.apiKey }) : null;
        if (nativeMode && typeof createVoiceProvider !== 'function') throw TypeError('A trusted native voice provider factory is required.');
        const usageQuota = config.usageQuota ?? { enabled: true };
        if (nativeMode && usageQuota.enabled === true && typeof createLiveUsageDescriptor !== 'function') throw TypeError('A trusted live usage descriptor factory is required.');
        const assistance = createDataInputAssistance({ db, authorize, config: { engineeringMode: false, nativeMode, native, usageQuota } });
        const providerFactory = nativeMode ? createVoiceProvider({ apiKey: nativeCredentials.apiKey, native, ledger: assistance.ledger }) : undefined;
        if (nativeMode && (typeof providerFactory !== 'function' || providerFactory.native !== true)) throw TypeError('A registered native voice provider factory is required.');
        const features = nativeMode ? { 'crm-data-input': Object.freeze({
            engineeringOnly: false, provider: 'gemini', model: 'gemini-3.1-flash-live-preview',
            async admission(scope) {
                requireOpen();
                const context = await assistance.sessions.providerChannel({ actorUid: scope.actorUid, feature: scope.feature,
                    sessionId: scope.sessionId, epoch: scope.epoch }).getContext();
                // The service layer supplies its exact composed provider request without a reverse dependency.
                // Raw contextText is transient and must never enter the reservation descriptor.
                const descriptor = typeof createLiveUsageDescriptor === 'function'
                    ? await createLiveUsageDescriptor({ scope, context })
                    : { request: { kind: 'live', inputBytes: Buffer.byteLength(JSON.stringify(context)), audioBytes: 3840000, maxOutputTokens: 512 } };
                if (!descriptor || descriptor.request?.kind !== 'live') throw TypeError('A valid live usage request descriptor is required.');
                return { model: 'gemini-3.1-flash-live-preview', purpose: 'draft', context: {}, boundsVersion: native.policy.versionId, request: descriptor.request };
            }
        }) } : {};
        const runAsIdentity = (verifiedIdentity, work) => {
            requireOpen();
            if (!verifiedIdentity || typeof verifiedIdentity.uid !== 'string' || !verifiedIdentity.uid.length || verifiedIdentity.uid.length > 128
                || !Number.isSafeInteger(verifiedIdentity.auth_time) || verifiedIdentity.auth_time < 0) throw TypeError('A verified identity is required.');
            if (typeof work !== 'function') throw TypeError('An identity-scoped operation is required.');
            const scope = { identity: Object.freeze({ uid: verifiedIdentity.uid, auth_time: verifiedIdentity.auth_time }), active: true };
            return identities.run(scope, async () => {
                try { return await work(); }
                finally { scope.active = false; }
            });
        };
        return Object.freeze({
            async authenticate(token) { requireOpen(); const identity = await auth.verifyIdToken(token, true); requireOpen(); return identity; },
            runAsIdentity, sessionService: assistance.sessions, ledger: assistance.ledger,
            features: Object.freeze(features), nativeMode, nativeReady: nativeMode, providerFactory, close
        });
    } catch (error) {
        try { await close(); } catch (_) { /* Preserve the initialization failure. */ }
        throw error;
    }
}
module.exports = { composeVoice };
