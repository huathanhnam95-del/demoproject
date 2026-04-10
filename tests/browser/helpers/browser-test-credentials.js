const fs = require('fs');
const path = require('path');

const DEFAULT_BROWSER_TEST_CREDENTIALS_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.local',
    'browser-test-credentials.md'
);

function readBrowserTestCredentials(credPath = DEFAULT_BROWSER_TEST_CREDENTIALS_PATH) {
    const content = fs.readFileSync(credPath, 'utf-8');
    const email = content.match(/Username:\s*`([^`]+)`/)?.[1];
    const password = content.match(/Password:\s*`([^`]+)`/)?.[1];

    if (!email || !password) {
        throw new Error(`Could not parse browser test credentials from ${credPath}`);
    }

    return { email, password };
}

function redactAuthIdentity(value, replacements = {}) {
    if (value == null) {
        return value;
    }

    const redactMap = [
        [replacements.email, '<admin-email>'],
        [replacements.password, '<redacted-password>'],
        [replacements.uid, '<admin-uid>'],
        [replacements.localId, '<emulator-local-id>']
    ];

    const base = redactMap.reduce((text, [needle, replacement]) => {
        if (!needle) {
            return text;
        }

        return text.split(String(needle)).join(replacement);
    }, String(value));

    // Redact common auth token shapes (e.g., Firestore debug logs include Authorization: Bearer <jwt>).
    return base
        .replace(/Bearer\\s+[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/g, 'Bearer <redacted-token>')
        .replace(/\"idToken\"\\s*:\\s*\"[^\"]+\"/g, '\"idToken\":\"<redacted-token>\"')
        .replace(/\"refreshToken\"\\s*:\\s*\"[^\"]+\"/g, '\"refreshToken\":\"<redacted-token>\"');
}

module.exports = {
    DEFAULT_BROWSER_TEST_CREDENTIALS_PATH,
    readBrowserTestCredentials,
    redactAuthIdentity
};
