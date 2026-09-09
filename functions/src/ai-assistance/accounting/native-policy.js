'use strict';
const { text, integer, deepFreeze, reject } = require('./money-pricing');
const MODELS = Object.freeze(['gemini-3.8-flash', 'gemini-3.1-flash-live-preview']);
function createNativeAccountingPolicy({ versionId, models = MODELS, deriveEstimatedQuantities } = {}) {
    text(versionId, 'native policy version');
    if (!Array.isArray(models) || !models.length || models.some(model => !MODELS.includes(model)) || typeof deriveEstimatedQuantities !== 'function') reject('INVALID_NATIVE_POLICY', 'Explicit registered native models and estimator required.');
    return Object.freeze({ versionId, kind: 'estimated', models: Object.freeze([...models]), deriveEstimatedQuantities(request) {
        const copy = JSON.parse(JSON.stringify(request)); if (Buffer.byteLength(JSON.stringify(copy)) > 65536) reject('REQUEST_BOUND_EXCEEDED', 'Native request descriptor exceeds limit.');
        const quantities = deriveEstimatedQuantities(deepFreeze(copy));
        if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities) || !Object.keys(quantities).length || Object.keys(quantities).length > 16) reject('INVALID_NATIVE_POLICY', 'Estimated quantities required.');
        for (const [key, value] of Object.entries(quantities)) { text(key, 'category', 64); integer(value); }
        return { ...quantities };
    } });
}
module.exports = { createNativeAccountingPolicy, NATIVE_MODELS: MODELS };
