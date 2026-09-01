'use strict';

function buildPublicFeatures(environment = {}) {
  return Object.freeze({
    echoForgeSandbox: environment.ECHO_FORGE_SANDBOX_ENABLED === 'true',
  });
}

module.exports = { buildPublicFeatures };
