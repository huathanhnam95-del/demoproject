const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const cloudApiSource = read('functions/src/apiApp.js');
const resultUiSource = read('public/crm-entrance-test-result.js');

assert.match(
    cloudApiSource,
    /bucketName/,
    'Cloud audio URL route must honor persisted bucketName metadata when signing URLs.'
);

assert.ok(
    !resultUiSource.includes('onerror='),
    'CRM entrance test result audio should use a single JS error handler, not an inline onerror attribute.'
);

const errorListenerMatches = resultUiSource.match(/addEventListener\('error'/g) || [];
assert.strictEqual(
    errorListenerMatches.length,
    1,
    'CRM entrance test result audio should register exactly one error listener path.'
);

console.log('entrance test review regressions passed');
