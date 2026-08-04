const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('public/auth-ui.js', 'utf8');

assert.match(source, /function isLocalAuthHost\(/);
assert.match(source, /async function tryLocalAdminAutoLogin\(\)/);
assert.match(source, /authFunctions\.signInAsLocalAdmin\(\)/);
assert.match(source, /if \(!user && !isGuestMode && await tryLocalAdminAutoLogin\(\)\)/);
assert.match(source, /if \(!isLocalAuthHost\(\) \|\| isGuestMode/);

console.log('local admin auto-login UI contract passed');
