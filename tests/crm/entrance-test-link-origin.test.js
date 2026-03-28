/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const {
  resolvePublicOrigin,
  buildEntranceTestLinks
} = require(path.join(process.cwd(), 'functions/src/crm/public-origin.js'));

function makeReq({ protocol = 'https', host = 'betterenglishlearning.com', forwardedProto = null } = {}) {
  return {
    protocol,
    headers: forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {},
    get(name) {
      return String(name).toLowerCase() === 'host' ? host : '';
    }
  };
}

const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;

process.env.PUBLIC_BASE_URL = 'https://prod.example.com/';
assert.strictEqual(
  resolvePublicOrigin(makeReq({ host: 'ignored.example.com' })),
  'https://prod.example.com',
  'PUBLIC_BASE_URL should remain the canonical override when set.'
);

process.env.PUBLIC_BASE_URL = '';
assert.strictEqual(
  resolvePublicOrigin(makeReq({ host: 'localhost:8443' })),
  'https://localhost:8443',
  'Request origin should be used as the fallback when no public override is configured.'
);

const links = buildEntranceTestLinks(makeReq({ host: 'betterenglishlearning.com' }), {
  deliveryToken: 'token-123',
  testId: 'test-123'
});
assert.strictEqual(
  links.testLink,
  'https://betterenglishlearning.com/entrance-test.html?token=token-123',
  'Learner link should be built from the resolved public origin.'
);
assert.strictEqual(
  links.resultLink,
  'https://betterenglishlearning.com/crm-entrance-test-result.html?testId=test-123',
  'Result link should be built from the resolved public origin.'
);

if (typeof originalPublicBaseUrl === 'undefined') {
  delete process.env.PUBLIC_BASE_URL;
} else {
  process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
}

console.log('entrance test link origin passed');
