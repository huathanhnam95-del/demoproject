/**
 * Contract tests for scripts/ops/diagnose-phoneme-recognizer-busy.ps1.
 *
 * Verifies that the diagnostic script produces immutable, structured JSON
 * following schema "phoneme-recognizer-availability-v1" without mutating service state,
 * and fails closed when any required query fails.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT = fileURLToPath(new URL('../../scripts/ops/diagnose-phoneme-recognizer-busy.ps1', import.meta.url));
const COMPLETE = fileURLToPath(new URL('./fixtures/diagnose-recognizer-complete.json', import.meta.url));
const FAILURE = fileURLToPath(new URL('./fixtures/diagnose-recognizer-failure.json', import.meta.url));

const WINDOW = ['-StartUtc', '2026-08-31T10:00:00Z', '-EndUtc', '2026-08-31T11:00:00Z'];
const REVISION = 'phoneme-recognizer-00016-lum';

function runDiagnoser(extraArgs) {
    const res = spawnSync('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
        '-OutputJson', ...extraArgs
    ], { encoding: 'utf8', timeout: 120000 });
    let json = null;
    const text = `${res.stdout || ''}`;
    const start = text.indexOf('{');
    if (start !== -1) {
        try { json = JSON.parse(text.slice(start)); } catch { /* left null on purpose */ }
    }
    return { code: res.status, json, stdout: text, stderr: res.stderr };
}

test('diagnose script returns complete availability JSON for healthy fixture', () => {
    const { code, json } = runDiagnoser(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(code, 0, `expected exit 0, got ${code}`);
    assert.ok(json, 'diagnoser produced no JSON');
    assert.equal(json.schemaVersion, 'phoneme-recognizer-availability-v1');
    assert.equal(json.sourceRevision, REVISION);
    assert.ok(json.window.startUtc && json.window.endUtc);
    assert.deepEqual(json.incompleteQueries, []);

    // Requests breakdown
    assert.equal(json.requests.total, 5);
    assert.equal(json.requests.ok, 2);
    assert.equal(json.requests.busy, 1);
    assert.equal(json.requests.other4xx, 1);
    assert.equal(json.requests.other5xx, 1);

    // Latency metrics in ms
    assert.ok(typeof json.latencyMs.p50 === 'number');
    assert.ok(typeof json.latencyMs.p95 === 'number');
    assert.ok(typeof json.latencyMs.max === 'number');
    assert.ok(json.latencyMs.max >= json.latencyMs.p50);

    // Readyz and instances
    assert.equal(json.readyz.total, 2);
    assert.equal(json.readyz.non200, 0);
    assert.ok(Array.isArray(json.instances));
    assert.equal(json.instances.length, 1);
});

test('diagnose script fails closed with non-zero exit when queries fail', () => {
    const { code, json } = runDiagnoser(['-FixturePath', FAILURE, '-Revision', REVISION, ...WINDOW]);
    assert.notEqual(code, 0, 'query failures must cause non-zero exit');
    assert.ok(json, 'JSON should still be emitted containing query error details');
    assert.ok(json.incompleteQueries.length > 0, 'incompleteQueries must record failures');
});

test('diagnose script writes artifact to OutputPath when provided', () => {
    const tmpFile = path.join(os.tmpdir(), `test-avail-${Date.now()}.json`);
    try {
        const { code, json } = runDiagnoser([
            '-FixturePath', COMPLETE, '-Revision', REVISION, '-OutputPath', tmpFile, ...WINDOW
        ]);
        assert.equal(code, 0);
        assert.ok(fs.existsSync(tmpFile), 'OutputPath file must exist');
        const fileContent = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
        assert.equal(fileContent.schemaVersion, 'phoneme-recognizer-availability-v1');
        assert.equal(fileContent.sourceRevision, REVISION);
    } finally {
        if (fs.existsSync(tmpFile)) { fs.unlinkSync(tmpFile); }
    }
});
