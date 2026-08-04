const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('public/firebase-auth-module.js', 'utf8');

assert.match(source, /signInWithCustomToken/);
assert.match(source, /async function signInAsLocalAdmin\(\)/);
assert.match(source, /fetch\('\/api\/local\/admin-token'/);
assert.match(source, /signInWithCustomToken\(auth, payload\.token\)/);
assert.match(source, /signInAsLocalAdmin,/);
assert.doesNotMatch(source, /browser-test-credentials/);
assert.doesNotMatch(source, /password\s*:/i);

console.log('local admin auth contract passed');
