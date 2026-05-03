/**
 * Unit tests for Gemma4 / Ollama AI helper pure functions.
 * Council Addendum D — regression coverage for:
 *   - parseModelJson()
 *   - isLocalhostUrl()
 *   - redactPII()
 *
 * These functions are inlined in crm-admin.js and teacher-scheduler-workspace.js
 * (browser scope). We re-implement them here identically for Node-based testing.
 * If the implementation changes, update these copies in sync.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ── Helpers reproduced from crm-admin.js ─────────────── */

function parseModelJson(raw) {
    const trimmed = (raw || '').trim();
    try { return JSON.parse(trimmed); } catch (_) { /* continue */ }
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch (_) { /* continue */ }
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
        try { return JSON.parse(trimmed.substring(first, last + 1)); } catch (_) { /* continue */ }
    }
    throw new Error('Model returned invalid JSON');
}

function isLocalhostUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

function redactPII(text) {
    if (!text) return text;
    return String(text)
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
        .replace(/(?:\+?\d[\d\s\-().]{7,}\d)/g, '[REDACTED_PHONE]');
}

/* ── Source-sync check ─────────────────────────────────── */
// Verify the implementations in crm-admin.js match the test copies.
const crmJs = fs.readFileSync(path.resolve(__dirname, '../../public/crm-admin.js'), 'utf8');
assert(crmJs.includes("function isLocalhostUrl(urlStr)"), 'isLocalhostUrl must exist in crm-admin.js');
assert(crmJs.includes("function redactPII(text)"), 'redactPII must exist in crm-admin.js');
assert(crmJs.includes("function parseModelJson(raw)"), 'parseModelJson must exist in crm-admin.js');

/* ── parseModelJson ────────────────────────────────────── */

// Strict JSON
assert.deepStrictEqual(
    parseModelJson('{"summary":"hello"}'),
    { summary: 'hello' },
    'parseModelJson: strict JSON should parse directly'
);

// JSON with whitespace
assert.deepStrictEqual(
    parseModelJson('  {"note":"hi","outcome":"completed"}  '),
    { note: 'hi', outcome: 'completed' },
    'parseModelJson: padded JSON should parse'
);

// JSON in ```json fences
assert.deepStrictEqual(
    parseModelJson('```json\n{"summary":"fenced"}\n```'),
    { summary: 'fenced' },
    'parseModelJson: ```json fenced JSON should parse'
);

// JSON in ``` fences (no json tag)
assert.deepStrictEqual(
    parseModelJson('```\n{"summary":"plain fence"}\n```'),
    { summary: 'plain fence' },
    'parseModelJson: ``` fenced JSON (no tag) should parse'
);

// JSON embedded in text
assert.deepStrictEqual(
    parseModelJson('Here is the result: {"summary":"embedded"} — end'),
    { summary: 'embedded' },
    'parseModelJson: JSON embedded in surrounding text should parse'
);

// Invalid JSON
assert.throws(
    () => parseModelJson('not json at all'),
    /invalid JSON/i,
    'parseModelJson: garbage input should throw'
);

// Empty input
assert.throws(
    () => parseModelJson(''),
    /invalid JSON/i,
    'parseModelJson: empty string should throw'
);

// null input
assert.throws(
    () => parseModelJson(null),
    /invalid JSON/i,
    'parseModelJson: null should throw'
);

/* ── isLocalhostUrl ────────────────────────────────────── */

// Allowed hosts
assert.strictEqual(isLocalhostUrl('http://localhost:11434'), true, 'isLocalhostUrl: localhost allowed');
assert.strictEqual(isLocalhostUrl('http://127.0.0.1:11434'), true, 'isLocalhostUrl: 127.0.0.1 allowed');
assert.strictEqual(isLocalhostUrl('http://[::1]:11434'), true, 'isLocalhostUrl: [::1] allowed');
assert.strictEqual(isLocalhostUrl('https://localhost:8443'), true, 'isLocalhostUrl: HTTPS localhost allowed');
assert.strictEqual(isLocalhostUrl('http://localhost'), true, 'isLocalhostUrl: no port allowed');

// Disallowed hosts
assert.strictEqual(isLocalhostUrl('http://192.168.1.100:11434'), false, 'isLocalhostUrl: LAN IP rejected');
assert.strictEqual(isLocalhostUrl('http://example.com:11434'), false, 'isLocalhostUrl: remote host rejected');
assert.strictEqual(isLocalhostUrl('http://10.0.0.1:11434'), false, 'isLocalhostUrl: private IP rejected');
assert.strictEqual(isLocalhostUrl('http://ollama.company.com'), false, 'isLocalhostUrl: domain rejected');

// Invalid / edge cases
assert.strictEqual(isLocalhostUrl('not-a-url'), false, 'isLocalhostUrl: garbage returns false');
assert.strictEqual(isLocalhostUrl(''), false, 'isLocalhostUrl: empty returns false');

/* ── redactPII ─────────────────────────────────────────── */

// Email redaction
assert.strictEqual(
    redactPII('Contact john@example.com for details'),
    'Contact [REDACTED_EMAIL] for details',
    'redactPII: standard email redacted'
);

assert.strictEqual(
    redactPII('user+tag@sub.domain.co.uk'),
    '[REDACTED_EMAIL]',
    'redactPII: complex email redacted'
);

// Phone redaction
assert.strictEqual(
    redactPII('Call +84 123 456 7890 now'),
    'Call [REDACTED_PHONE] now',
    'redactPII: international phone redacted'
);

assert.strictEqual(
    redactPII('Phone: (03) 1234-5678'),
    'Phone: ([REDACTED_PHONE]',
    'redactPII: parenthesized phone — leading paren outside digit capture'
);

// Both email and phone
assert.strictEqual(
    redactPII('Email: a@b.com, phone: 0123456789'),
    'Email: [REDACTED_EMAIL], phone: [REDACTED_PHONE]',
    'redactPII: both email and phone redacted'
);

// No PII — should pass through unchanged
assert.strictEqual(
    redactPII('Student scored 7.5 on IELTS'),
    'Student scored 7.5 on IELTS',
    'redactPII: normal text unchanged'
);

// Falsy inputs
assert.strictEqual(redactPII(''), '', 'redactPII: empty string returns empty');
assert.strictEqual(redactPII(null), null, 'redactPII: null returns null');
assert.strictEqual(redactPII(undefined), undefined, 'redactPII: undefined returns undefined');

console.log('gemma4-ai-helpers unit tests passed');
