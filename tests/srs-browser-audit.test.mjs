import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildBaselineSummary,
    buildBaselineUserProfile,
    getManifestPath,
    randomAsciiPassword,
    readJson,
    sanitizeRunId,
    writeJson
} from '../scripts/srs/browser-audit-fixture-lib.js';

test('srs audit fixture helpers keep manifests and baseline docs predictable', () => {
    const runId = sanitizeRunId('2026-03-27T12:34:56.789Z');
    const manifestPath = getManifestPath(runId);

    assert.match(manifestPath, /tmp[\\/]+srs-browser-audit[\\/]+runs[\\/]/);
    assert.match(randomAsciiPassword(24), /^[A-Za-z0-9!@#$%^&*()\-_=+]{24}$/);

    const profile = buildBaselineUserProfile('audit@example.com');
    assert.deepStrictEqual(profile.unlockedModes, ['type', 'speak', 'extended', 'watch', 'notes', 'pronounce']);
    assert.strictEqual(profile.coins, 100);
    assert.strictEqual(profile.isAdmin, false);
    assert.ok(!('srsSettings' in profile));

    const summary = buildBaselineSummary('2026-03-27T00:00:00.000Z');
    assert.strictEqual(summary.reviewStats.totalReviews, 0);
    assert.deepStrictEqual(summary.masteredWords, []);

    const tmpDir = path.join(process.cwd(), 'tmp', 'srs-browser-audit-test');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, 'manifest.json');
    writeJson(tmpFile, { ok: true, runId });
    assert.deepStrictEqual(readJson(tmpFile), { ok: true, runId });
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('srs review module exposes localhost-only test hooks and review snapshot API', () => {
    const reviewSource = fs.readFileSync(new URL('../public/srs-review.js', import.meta.url), 'utf8');
    const runnerSource = fs.readFileSync(new URL('../scripts/audit/run-srs-browser-audit.js', import.meta.url), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

    assert.match(reviewSource, /window\.__SRS_TEST_HOOKS__/);
    assert.match(reviewSource, /location\.hostname/);
    assert.match(reviewSource, /getCurrentReviewSnapshot/);
    assert.match(reviewSource, /failNextCardSaveOnce/);
    assert.match(reviewSource, /failNextSummarySaveOnce/);
    assert.match(reviewSource, /summaryData\?\.srsSettings\?\.algorithm \|\| summaryData\?\.algorithm/);
    assert.match(reviewSource, /summary\?\.srsSettings\?\.algorithm \|\| summary\?\.algorithm/);
    assert.match(reviewSource, /setStoredAlgorithmPreference\(selectedAlgo, localStorage\);[\s\S]*persistPendingSync\(\);[\s\S]*await saveSRSSummary\(\);/);
    assert.match(runnerSource, /--scenario/);
    assert.match(runnerSource, /--keep-user/);
    assert.match(runnerSource, /legacy_summary_compatibility/);
    assert.match(runnerSource, /legacy_pending_payload_compatibility/);
    assert.match(runnerSource, /rapid_save_reload_race/);
    assert.strictEqual(packageJson.scripts['audit:srs:browser'], 'node scripts/audit/run-srs-browser-audit.js --base-url https://localhost:8443');
});
