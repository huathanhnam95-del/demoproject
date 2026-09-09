'use strict';
const { createNativeGemini } = require('../../ai-assistance/providers/native-gemini');

// Action values differ by CRM action. Keep their schema in the instructions;
// proposal parsing and canonical validation remain authoritative before preview.
function createDataInputNativeServices({ apiKey, fetchImpl } = {}) {
    return createNativeGemini({ apiKey, fetchImpl, generationFormat: 'json' });
}

module.exports = { createDataInputNativeServices };
