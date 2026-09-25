const assert = require('node:assert/strict');
const path = require('node:path');
const { api } = require(path.join(process.cwd(), 'functions/src/index.js'));

const endpoint = api.__endpoint;
assert.deepEqual(endpoint.region, ['asia-southeast1', 'us-central1']);
assert.equal(endpoint.availableMemoryMb, 1024);
assert.equal(endpoint.timeoutSeconds, 300);
assert.equal(Object.hasOwn(endpoint, 'maxInstances'), false,
  'the SDK must omit maxInstances so the CLI preserves each region-specific live cap');
assert.equal(Object.hasOwn(endpoint, 'serviceAccountEmail'), false);
assert.deepEqual(endpoint.secretEnvironmentVariables.map(secret => secret.key).sort(),
  ['AZURE_SPEECH_KEY', 'GROQ_API_KEY']);
console.log('API region runtime preservation contract passed');
