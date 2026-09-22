'use strict';

const { parseRolloutFlags, getPublicFeatureFlags } = require('./rollout-flags');

function buildPublicFeatures(environment = {}) {
  const rollout = getPublicFeatureFlags(parseRolloutFlags(environment));
  return Object.freeze({
    echoForgeSandbox: environment.ECHO_FORGE_SANDBOX_ENABLED === 'true',
    ...rollout
  });
}

module.exports = { buildPublicFeatures };
