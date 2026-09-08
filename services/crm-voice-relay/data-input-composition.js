'use strict';
const { composeVoice: composeDataInputVoice } = require('../../functions/src/crm/data-input/voice-runtime-composition');
const { createNativeVoiceProvider } = require('./native-provider');

// Service-side assembly keeps the deployable Functions tree self-contained.
async function composeVoice(options) {
    return composeDataInputVoice({ ...options, createVoiceProvider: createNativeVoiceProvider });
}
module.exports = { composeVoice };
