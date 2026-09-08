'use strict';
const { runTransactionWithClosedRetry } = require('./domain/transaction-retry');
const { isProjectsFeatureEnabled } = require('./feature-config');
const { createLedgerService } = require('../../ai-assistance/accounting/ledger-service');
const { reject, strict, text } = require('../../ai-assistance/accounting/money-pricing');
const { createAllowanceResolver } = require('../../ai-assistance/accounting/allowance-service');

const PROJECTS_BUDGET_FEATURE = 'projects';
const PROJECTS_AI_PURPOSES = Object.freeze({ planning: 'read', task_draft: 'write', task_correction: 'write', automation_draft: 'owner' });
const NON_STAFF_ROLES = new Set(['student', 'learner', 'parent', 'guest']);
function assertStaffIdentity(identity) {
    const records = [identity.profile || {}, identity.workforce || {}];
    for (const record of records) {
        const roles = [record.role, record.crmRole, record.accountType, record.userType, record.type, record.organizationRole, record.workforceRole, ...(Array.isArray(record.roles) ? record.roles : [])];
        if (roles.some(role => typeof role === 'string' && NON_STAFF_ROLES.has(role.trim().toLowerCase())) || ['isStudent', 'isLearner', 'isParent', 'isGuest'].some(key => record[key] === true)) reject('STAFF_ACCOUNT_REQUIRED', 'AI assistance is available to active staff accounts only.', 403);
    }
    return identity;
}
function createProjectsAllowanceResolver({ db }) {
    return createAllowanceResolver({ db });
}
function createProjectsBudgetFeatureAdapter({ accessService, engineeringModels = [] }) {
    return Object.freeze({
        models: Object.freeze(['gemini-3.8-flash', 'gemini-3.1-flash-live-preview', ...engineeringModels]),
        normalizeContext(value) { if (value?.mode === 'create_project') { strict(value, ['mode']); return { mode: 'create_project' }; } strict(value, ['projectId']); return { projectId: text(value.projectId, 'project ID') }; },
        async authorize(transaction, { actorUid, purpose, context, operation }) {
            if (!isProjectsFeatureEnabled('projects')) reject('PROJECTS_DISABLED', 'Projects is not enabled.', 404);
            if (operation === 'read') { const identity = assertStaffIdentity(await accessService.assertTransactionEligible(transaction, actorUid)); return { uid: identity.uid }; }
            if (!Object.hasOwn(PROJECTS_AI_PURPOSES, purpose)) reject('PURPOSE_NOT_ALLOWED', 'Projects AI purpose is unsupported.', 403);
            if (context?.mode === 'create_project') {
                if (!['planning', 'task_draft', 'task_correction'].includes(purpose)) reject('PURPOSE_NOT_ALLOWED', 'This purpose requires an existing project.', 403);
                const identity = assertStaffIdentity(await accessService.assertTransactionEligible(transaction, actorUid)); return { uid: identity.uid };
            }
            const permission = PROJECTS_AI_PURPOSES[purpose]; const options = permission === 'owner' ? { owner: true } : permission === 'write' ? { write: true } : {};
            const access = await accessService.assertTransactionContentAccess(transaction, actorUid, text(context?.projectId, 'project ID'), options);
            assertStaffIdentity(access.identity);
            if ((access.project.data.lifecycle || 'active') !== 'active') reject('PROJECT_INACTIVE', 'Projects AI requires an active project.', 409);
            return { uid: access.identity.uid };
        }
    });
}
function createProjectsBudgetService({ db, accessService, now = () => new Date(), ledgerService, additionalFeatureAdapters = {}, pricingRegistry, boundsRegistry, providerAdapters, engineeringMode = false, engineeringModels = [], nativeMode = false, nativePolicy = null, usageQuota = nativeMode ? { enabled: true } : undefined }) {
    const featureAdapter = createProjectsBudgetFeatureAdapter({ accessService, engineeringModels: engineeringMode ? engineeringModels : [] });
    const resolveAllowance = createProjectsAllowanceResolver({ db });
    if (Object.hasOwn(additionalFeatureAdapters, PROJECTS_BUDGET_FEATURE)) reject('FEATURE_REGISTRATION_CONFLICT', 'Projects adapter cannot be replaced.');
    const ledger = ledgerService || createLedgerService({ db, now, runTransaction: callback => runTransactionWithClosedRetry(db, callback), featureAdapters: { ...additionalFeatureAdapters, [PROJECTS_BUDGET_FEATURE]: featureAdapter }, resolveAllowance, pricingRegistry, boundsRegistry, providerAdapters, engineeringMode, nativeMode, nativePolicy, usageQuota });
    const feature = ledger.forFeature(PROJECTS_BUDGET_FEATURE);
    return Object.freeze({ getBudget: identity => feature.getBudget(identity.uid), listReservations: (identity, options) => feature.listReservations(identity.uid, options), ledger, feature, featureAdapter, resolveAllowance });
}
module.exports = { createProjectsBudgetService, createProjectsBudgetFeatureAdapter, createProjectsAllowanceResolver, assertStaffIdentity, PROJECTS_BUDGET_FEATURE, PROJECTS_AI_PURPOSES };
