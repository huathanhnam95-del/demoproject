'use strict';
const { strict, reject, text } = require('../accounting/money-pricing');
const DATA_INPUT_FEATURE = 'crm-data-input';
function createDataInputBudgetFeatureAdapter({ authorize, engineeringModels = [] } = {}) {
    if (typeof authorize !== 'function') throw new TypeError('Data input requires its current domain authorization callback.');
    if (!Array.isArray(engineeringModels) || engineeringModels.some(model => typeof model !== 'string' || !model.startsWith('engineering-'))) throw new TypeError('Engineering models require the engineering namespace.');
    return Object.freeze({
        models: Object.freeze(['gemini-3.8-flash', ...engineeringModels]),
        normalizeContext(value) { strict(value, []); return {}; },
        async authorize(tx, { actorUid, purpose, operation }) {
            text(actorUid, 'UID');
            if (operation !== 'read' && purpose !== 'draft') reject('PURPOSE_NOT_ALLOWED', 'Data input supports draft assistance only.', 403);
            if (await authorize({ tx, actorUid }) !== true) reject('ACCOUNT_INELIGIBLE', 'Current data input authority is required.', 403);
            return { uid: actorUid };
        }
    });
}
module.exports = { DATA_INPUT_FEATURE, createDataInputBudgetFeatureAdapter };
