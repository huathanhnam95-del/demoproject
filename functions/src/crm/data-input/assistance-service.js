'use strict';
const { createLedgerService } = require('../../ai-assistance/accounting/ledger-service');
const { centsToNano, reject } = require('../../ai-assistance/accounting/money-pricing');
const { createDataInputBudgetFeatureAdapter } = require('../../ai-assistance/adapters/data-input');
const { createAccountedGenerationProvider } = require('../../ai-assistance/providers/accounted-generation');
const { createVoiceSessionService } = require('../../ai-assistance/voice/session-service');
const { createVoiceConfirmationService } = require('../../ai-assistance/voice/confirmation-service');
const { createVoiceContextAdapter } = require('./voice-context');

// Existing shared allowance configuration also consumed by CRM Projects.
// Ledger identity remains UID/month, regardless of these historical names.
function createSharedAllowanceResolver(db) {
    return async (tx, uid) => {
        const [override, defaults] = await Promise.all([
            tx.get(db.collection('crmProjectAllowanceConfigs').doc(uid)),
            tx.get(db.collection('crmProjectAllowanceDefaults').doc('default'))
        ]);
        function configured(snapshot) {
            if (!snapshot.exists) return null;
            const value = snapshot.data();
            if (!value || value.currency !== 'USD') reject('INVALID_ALLOWANCE', 'Allowance currency configuration is invalid.', 409);
            return centsToNano(value.monthlyAllowanceCents);
        }
        const own = configured(override), fallback = configured(defaults);
        return { allowanceNano: own ?? fallback ?? centsToNano(500) };
    };
}

/** Explicit server composition; config is never sourced from request fields. */
function createDataInputAssistance({ db, authorize, now = Date.now, config = {} }) {
    if (!db || typeof authorize !== 'function') throw TypeError('Current data-input authorization is required.');
    const engineeringMode = config.engineeringMode === true;
    const nativeMode = config.nativeMode === true, native = nativeMode ? config.native : null;
    if (engineeringMode && nativeMode) throw TypeError('Choose one assistance mode.');
    if (nativeMode && (!native || native.policy?.kind !== 'estimated' || !Array.isArray(native.pricingRegistry)
        || native.accountingAdapter?.native !== true || typeof native.accountingAdapter.normalizeEvidence !== 'function'
        || typeof native.generationTransport !== 'function')) throw TypeError('Explicit registered native services are required.');
    if (Object.hasOwn(config.additionalFeatureAdapters || {}, 'crm-data-input')) throw TypeError('Cannot replace the data-input budget adapter.');
    const baseAdapter = createDataInputBudgetFeatureAdapter({ authorize, engineeringModels: engineeringMode ? config.engineeringModels || [] : [] });
    const featureAdapter = nativeMode ? Object.freeze({ ...baseAdapter, models: Object.freeze([...baseAdapter.models, 'gemini-3.1-flash-live-preview']) }) : baseAdapter;
    const ledger = createLedgerService({ db, runTransaction: run => db.runTransaction(run), now,
        featureAdapters: { ...config.additionalFeatureAdapters, 'crm-data-input': featureAdapter }, resolveAllowance: createSharedAllowanceResolver(db),
        pricingRegistry: nativeMode ? native.pricingRegistry : engineeringMode ? config.pricingRegistry || [] : [], boundsRegistry: engineeringMode ? config.boundsRegistry || {} : {},
        providerAdapters: nativeMode ? { gemini: native.accountingAdapter } : engineeringMode ? config.providerAdapters || {} : {}, engineeringMode,
        nativeMode, nativePolicy: native?.policy });
    const adapter = createVoiceContextAdapter({ db, authorize, authorizeRecord: ({ tx, actorUid }) => authorize({ tx, actorUid }), now });
    const voiceOptions = { db, runTransaction: run => db.runTransaction(run), now, featureAdapters: { 'crm-data-input': adapter }, engineeringMode, nativeMode };
    const sessions = createVoiceSessionService(voiceOptions), confirmationService = createVoiceConfirmationService(voiceOptions);
    let voiceRelayUrl = null;
    if ((engineeringMode || nativeMode) && config.voiceRelayUrl) {
        const url = new URL(config.voiceRelayUrl);
        if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw TypeError('A secure relay URL is required.');
        voiceRelayUrl = url.origin;
    }
    const provider = nativeMode ? createAccountedGenerationProvider({ ledger, nativeMode, nativeMapping: {
        sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: native.policy.versionId,
        maxOutputBytes: 65536, maxOutputTokens: 4096
    }, transport: native.generationTransport }) : engineeringMode && config.generationMapping ? createAccountedGenerationProvider({ ledger, engineeringMode,
        engineeringMapping: config.generationMapping, transport: config.generationTransport }) : null;
    return Object.freeze({ ledger, featureAdapter, sessions, provider, voiceRelayUrl, voiceEnabled: !!voiceRelayUrl,
        voice: { confirmationService, authorizeTargets: adapter.authorizeTargets },
        getBudget: actorUid => ledger.forFeature('crm-data-input').getBudget(actorUid),
        async getVoiceContext(actorUid, contextHints) {
            return db.runTransaction(async tx => {
                if (await authorize({ tx, actorUid }) !== true) reject('FORBIDDEN', 'Current staff authority is required.', 403);
                const value = await adapter.resolveContext({ tx, actorUid, contextHints });
                return { summary: value.summary, previewBinding: value.previewBinding, confirmationPhrase: value.context.confirmationPolicy?.phrase || null,
                    confirmationPhraseEnglish: value.context.confirmationPolicy?.phraseEnglish || null };
            });
        }
    });
}
module.exports = { createDataInputAssistance, createSharedAllowanceResolver };
