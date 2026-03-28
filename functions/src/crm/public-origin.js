'use strict';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveRequestOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = typeof req?.get === 'function'
    ? String(req.get('host') || '').trim()
    : String(req?.headers?.host || '').trim();
  if (!host) return trimTrailingSlash(`${proto}://localhost`);
  return trimTrailingSlash(`${proto}://${host}`);
}

function resolvePublicOrigin(req, env = process.env) {
  const fromEnv = trimTrailingSlash(env?.PUBLIC_BASE_URL);
  if (fromEnv) return fromEnv;
  return resolveRequestOrigin(req);
}

function buildEntranceTestLinks(req, { deliveryToken = '', testId = '' } = {}, env = process.env) {
  const origin = resolvePublicOrigin(req, env);
  return {
    origin,
    testLink: deliveryToken
      ? `${origin}/entrance-test.html?token=${encodeURIComponent(String(deliveryToken).trim())}`
      : null,
    resultLink: testId
      ? `${origin}/crm-entrance-test-result.html?testId=${encodeURIComponent(String(testId).trim())}`
      : null
  };
}

module.exports = {
  resolveRequestOrigin,
  resolvePublicOrigin,
  buildEntranceTestLinks
};
