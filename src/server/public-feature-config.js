'use strict';

function buildPublicFeatures(environment = {}) {
  return Object.freeze({
    echoForgeSandbox: environment.ECHO_FORGE_SANDBOX_ENABLED === 'true',
    presentationDemoOnline: String(environment.PRESENTATION_DEMO_ONLINE_ENABLED || '').trim() === '1',
  });
}

module.exports = { buildPublicFeatures };
