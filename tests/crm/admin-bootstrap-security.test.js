const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

// resolveAdminStatus() is the only self-promotion path into admin: it writes
// users/{uid}.isAdmin = true and merges an isAdmin custom claim purely on the
// strength of the caller's email address. apiApp.js instantiates firebase-admin
// at require() time, so this is a source contract rather than a behavioural
// test. If resolveAdminStatus is ever extracted into its own module, replace
// this with a real invocation test.

const apiAppPath = path.join(process.cwd(), 'functions', 'src', 'apiApp.js');
assert.ok(fs.existsSync(apiAppPath), 'functions/src/apiApp.js should exist');
const src = fs.readFileSync(apiAppPath, 'utf8');

const bootstrapBlock = src.match(/function getBootstrapAdminEmails\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(bootstrapBlock, 'getBootstrapAdminEmails() should exist in apiApp.js');

// Placeholder addresses are used throughout the test suite as fixtures. If one
// reaches the production allowlist, anyone who can register it on an open-signup
// Firebase project inherits admin.
for (const placeholder of ['admin@example.com', 'test@example.com', 'user@example.com']) {
  assert.ok(
    !bootstrapBlock[0].includes(placeholder),
    `getBootstrapAdminEmails() must not list the placeholder address ${placeholder}`
  );
}

assert.ok(
  /req\.user\.email_verified !== true/.test(src),
  'resolveAdminStatus() must require a Firebase-verified email before bootstrapping admin'
);

// The verification must gate the same branch that decides bootstrap eligibility,
// not merely appear somewhere in the file.
const gate = src.match(/if \(!getBootstrapAdminEmails\(\)\.has\(email\)[^)]*\)/);
assert.ok(gate, 'bootstrap eligibility check should be a single guard on getBootstrapAdminEmails()');
assert.ok(
  gate[0].includes('email_verified'),
  'the email_verified check must be part of the bootstrap eligibility guard itself'
);

// Nothing may write isAdmin before that guard has run.
const guardIndex = src.indexOf('!getBootstrapAdminEmails().has(email)');
const resolverIndex = src.indexOf('async function resolveAdminStatus');
const writeIndex = src.indexOf('adminBootstrappedAt');
assert.ok(resolverIndex >= 0 && guardIndex > resolverIndex, 'guard should live inside resolveAdminStatus()');
assert.ok(writeIndex > guardIndex, 'the isAdmin write must happen after the eligibility guard, not before');

console.log('admin bootstrap security contract passed');
