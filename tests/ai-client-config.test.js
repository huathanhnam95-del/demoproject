const assert = require('assert');
/* eslint-disable no-console */

console.log('Starting AI client config test...');

const aiClient = require('../src/utils/ai-client');

assert.ok(
  !aiClient.defaults.raxConfig,
  'AI client should not configure retry-axios automatically when route-level retry/backoff is responsible for retries'
);

console.log('AI client config test passed.');
