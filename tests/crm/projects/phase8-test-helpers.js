'use strict';
// These helpers operate only inside the dedicated demo emulator suite. The
// provider is a local accounting fixture; it never performs provider I/O.
const path = require('node:path');
const h = require('./phase6-test-helpers');
const { createLedgerService } = require('../../../functions/src/ai-assistance/accounting/ledger-service');
const { runTransactionWithClosedRetry } = require('../../../functions/src/crm/projects/domain/transaction-retry');
const { createProjectsBudgetFeatureAdapter, createProjectsAllowanceResolver } = require('../../../functions/src/crm/projects/budget-service');
const { createDataInputBudgetFeatureAdapter } = require('../../../functions/src/ai-assistance/adapters/data-input');
const { createAdmission } = require(process.env.CRM_DATA_INPUT_AUTHORIZATION_MODULE || 'C:/Cursor AI-data-input-20260907/functions/src/crm/data-input/authorization.js');
const { AI_ASSISTANCE_COLLECTIONS } = require('../../../functions/src/ai-assistance/collections');
const { validateBoundedRequest } = require('../../../functions/src/ai-assistance/accounting/provider-accounting');
const { reject } = require('../../../functions/src/ai-assistance/accounting/money-pricing');
const ROOT = path.resolve(__dirname, '../../..');
async function accounting(suite, c, role = 'owner') {
    const uid = c.uids[role];
    const identity = await suite.auth.verifyIdToken(await suite.token(role));
    const trusted = new WeakSet();
    const options = {
        db: suite.db, runTransaction: work => runTransactionWithClosedRetry(suite.db, work), now: suite.now,
        resolveAllowance: createProjectsAllowanceResolver({ db: suite.db }), engineeringMode: true,
        featureAdapters: {
            projects: createProjectsBudgetFeatureAdapter({ accessService: suite.accessService, engineeringModels: ['engineering-model'] }),
            'crm-data-input': createDataInputBudgetFeatureAdapter({ authorize: createAdmission({ db: suite.db, authClient: suite.auth, identity }), engineeringModels: ['engineering-model'] })
        },
        pricingRegistry: [{ versionId: 'phase8-price', provider: 'engineering-provider', model: 'engineering-model', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00Z', expiresAt: '2028-01-01T00:00:00Z', ratesNano: { inputText: '0', outputText: '1000000000' } }],
        boundsRegistry: { 'phase8-bound': { proven: true, engineeringOnly: true, models: ['engineering-model'], deriveMaximum({ request }) { const value = validateBoundedRequest(request); return { inputText: value.inputTokens, outputText: (BigInt(value.outputTokens) * BigInt(value.maxRequests)).toString() }; } } },
        providerAdapters: { 'engineering-provider': { engineeringOnly: true, normalizeEvidence({ evidence }) { if (!trusted.has(evidence)) reject('UNTRUSTED_EVIDENCE', 'Fixture evidence required.', 403); return evidence; } } }
    };
    const ledger = createLedgerService(options);
    return { uid, ledger, restart: () => createLedgerService(options),
        projects: ledger.forFeature('projects'), dataInput: ledger.forFeature('crm-data-input'),
        request(id, amount = '1', feature = 'projects') { return { requestId: id, purpose: feature === 'projects' ? 'task_draft' : 'draft', context: feature === 'projects' ? { projectId: c.projectId } : {}, model: 'engineering-model', boundsVersion: 'phase8-bound', request: { inputTokens: '0', outputTokens: amount, maxRequests: 1 } }; },
        evidence(id, amount = '0') { const value = { evidenceId: id, providerRequestId: id, complete: true, quantities: { inputText: '0', outputText: amount } }; trusted.add(value); return value; }
    };
}
async function resetBudget(suite, uid) {
    for (const name of Object.values(AI_ASSISTANCE_COLLECTIONS)) {
        const rows = await suite.db.collection(name).where('uid', '==', uid).get();
        for (const row of rows.docs) await row.ref.delete();
    }
    await suite.db.collection('crmProjectAllowanceConfigs').doc(uid).delete();
    await suite.db.collection('crmProjectAllowanceDefaults').doc('default').set({ currency: 'USD', monthlyAllowanceCents: 500, revision: 0 });
}
module.exports = { ...h, accounting, resetBudget, AI_ASSISTANCE_COLLECTIONS, ROOT };
