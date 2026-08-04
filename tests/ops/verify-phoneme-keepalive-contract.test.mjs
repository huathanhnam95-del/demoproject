/**
 * Contract tests for scripts/verify-phoneme-keepalive.ps1.
 *
 * The verifier's job is to say whether the keep-alive evidence is trustworthy.
 * The failure that matters is a FALSE PASS: a broken query, a double-counted
 * execution, or a reading of the wrong revision that still looks green. Each
 * test below pins one of those.
 *
 * Fixtures stand in for gcloud so classification and parsing run for real.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPT = fileURLToPath(new URL('../../scripts/verify-phoneme-keepalive.ps1', import.meta.url));
const COMPLETE = fileURLToPath(new URL('./fixtures/phoneme-keepalive-complete.json', import.meta.url));
const FAILURE = fileURLToPath(new URL('./fixtures/phoneme-keepalive-query-failure.json', import.meta.url));

// The fixture covers 06:00-07:00 Asia/Ho_Chi_Minh on 2026-08-04 (UTC+7).
const WINDOW = ['-StartUtc', '2026-08-03T22:00:00Z', '-EndUtc', '2026-08-03T23:59:00Z'];
const REVISION = 'phoneme-recognizer-00010-rir';

function runVerifier(extraArgs) {
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

test('a healthy window reports complete evidence', () => {
    const { code, json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.ok(json, 'verifier produced no JSON');
    assert.equal(code, 0, `expected exit 0, got ${code}: ${JSON.stringify(json?.queryErrors)}`);
    assert.equal(json.evidenceComplete, true, `evidence should be complete: ${JSON.stringify(json.queryErrors)}`);
    assert.deepEqual(json.queryErrors, []);
});

test('Scheduler executions are counted once, not once per log line', () => {
    // Five AttemptFinished entries. Counting every scheduler row would say ten.
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(json.scheduler.finished, 5, 'five runs must count as five');
    assert.notEqual(json.scheduler.finished, 10, 'double-counting regression');
    assert.equal(json.scheduler.nonOk, 0);
});

test('Scheduler finishes reconcile against /readyz responses', () => {
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(json.scheduler.finished, json.readyz.schedulerResponses,
        'a finish with no matching /readyz row means the evidence is incomplete');
});

test('a second start in the opening hour is unplanned, not the daily warm-up', () => {
    // 06:00 local is the designed start after the overnight gap. 06:30 is an
    // eviction, and classifying it as "expected" would hide the very thing the
    // keep-alive exists to measure.
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(json.starts.expected, 1, 'exactly one designed warm-up per local date');
    assert.equal(json.starts.unplanned, 1, 'the 06:30 start must be unplanned');
    assert.match(json.starts.unplannedLocal[0], /06:30/);
});

test('deployment rollouts are not counted as evictions', () => {
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(json.starts.rollout, 1, 'the DEPLOYMENT_ROLLOUT row must be ignored');
});

test('expected cron occurrences are derived from the interval, not a daily constant', () => {
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    // 06:00-06:59 local inside the window, every 10 min => 6 occurrences.
    assert.ok(json.scheduler.expected > 0 && json.scheduler.expected <= 24,
        `partial-day expectation should be small, got ${json.scheduler.expected}`);
    assert.notEqual(json.scheduler.expected, 108, 'must not assume a full day');
});

test('a failed query exits non-zero and cannot report complete evidence', () => {
    const { code, json } = runVerifier(['-FixturePath', FAILURE, '-Revision', REVISION, ...WINDOW]);
    assert.notEqual(code, 0, 'a broken query must fail the run');
    assert.equal(json.evidenceComplete, false);
    assert.ok(json.queryErrors.length > 0, 'the failure must be reported, not swallowed');
    assert.match(JSON.stringify(json.queryErrors), /scheduler/);
});

test('reading the wrong revision cannot produce a green result', () => {
    const { code, json } = runVerifier([
        '-FixturePath', COMPLETE, '-Revision', 'phoneme-recognizer-00004-bbc', ...WINDOW
    ]);
    assert.notEqual(code, 0, 'rows from another revision must fail the run');
    assert.equal(json.evidenceComplete, false);
    assert.match(JSON.stringify(json.queryErrors), /unexpected revision/);
});

test('the selected revision is reported back for auditability', () => {
    const { json } = runVerifier(['-FixturePath', COMPLETE, '-Revision', REVISION, ...WINDOW]);
    assert.equal(json.revision, REVISION);
    assert.ok(json.window.startUtc && json.window.endUtc, 'the measured interval must be explicit');
});
