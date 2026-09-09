'use strict';
const { createRequire } = require('node:module');
const path = require('node:path');
const { createProjectsAccessService } = require('../../functions/src/crm/projects/access-service');
const { createProjectsCommandService } = require('../../functions/src/crm/projects/domain/command-service');
const { createProjectsQueryService } = require('../../functions/src/crm/projects/domain/query-service');
const { createProjectsRecoveryService } = require('../../functions/src/crm/projects/recovery-service');
const { createProjectsDraftService } = require('../../functions/src/crm/projects/voice/draft-service');
const { createProjectsBudgetService } = require('../../functions/src/crm/projects/budget-service');
const { createVoiceSessionService } = require('../../functions/src/ai-assistance/voice/session-service');
const { runTransactionWithClosedRetry } = require('../../functions/src/crm/projects/domain/transaction-retry');
const { createLiveUsageDescriptor } = require('./native-provider');
async function composeProjects({ config, nativeCredentials }) {
    const admin = createRequire(path.resolve(__dirname, '../../functions/package.json'))('firebase-admin');
    const app = admin.initializeApp({ projectId: config.projectId }, `crm-voice-${process.pid}`);
    try {
        const db = app.firestore(), auth = app.auth();
        const accessService = createProjectsAccessService({ db, auth });
        const commandService = createProjectsCommandService({ db, accessService });
        const queryService = createProjectsQueryService({ db, accessService });
        const recoveryService = createProjectsRecoveryService({ db, accessService, commandService, queryService });
        const draftService = createProjectsDraftService({ db, accessService, commandService, recoveryService, engineeringMode: false });
        const native = config.nativeEnabled ? require('../../functions/src/ai-assistance/providers/native-gemini').createNativeGemini({ ...(nativeCredentials || {}), generationFormat: 'json' }) : null;
        const budget = createProjectsBudgetService({ db, accessService, engineeringMode: false, usageQuota: config.usageQuota ?? { enabled: true }, ...(native ? { nativeMode: true, nativePolicy: native.policy, pricingRegistry: native.pricingRegistry, providerAdapters: { gemini: native.accountingAdapter } } : {}) });
        const sessionService = createVoiceSessionService({ db, runTransaction: work => runTransactionWithClosedRetry(db, work), featureAdapters: { projects: draftService.voiceAdapter }, engineeringMode: false, nativeMode: !!native });
        return { authenticate: token => auth.verifyIdToken(token, true), sessionService, ledger: budget.ledger,
            nativeMode: !!native, nativeReady: !!native,
            providerFactory: native ? require('./native-provider').createNativeVoiceProvider({ apiKey: nativeCredentials.apiKey, native, ledger: budget.ledger }) : undefined,
            features: native ? { projects: { engineeringOnly: false, provider: 'gemini', model: 'gemini-3.1-flash-live-preview', admission: async scope => {
                const context = await sessionService.providerChannel({ actorUid: scope.actorUid, feature: scope.feature, sessionId: scope.sessionId, epoch: scope.epoch }).getContext();
                return { model: 'gemini-3.1-flash-live-preview', purpose: 'planning', context: context.context.mode === 'create_project' ? { mode: 'create_project' } : { projectId: context.context.project.id }, boundsVersion: native.policy.versionId, request: createLiveUsageDescriptor({ scope, context }).request };
            } } } : {},
            close: () => app.delete()
        };
    } catch (error) { await app.delete(); throw error; }
}
module.exports = { composeProjects };
