/**
 * Contract tests for the V3 pronunciation release entrypoint.
 *
 * These assert the safety properties that were violated by hand during the
 * 2026-08-03 rollout, so the release path cannot regress into them again:
 *   - traffic never routed with --to-latest
 *   - praat-api never made private
 *   - phoneme-recognizer never made public
 *   - IAM never mutated by a candidate deploy
 *   - shadow remains the default while an active candidate requires an explicit flag
 *   - candidate identity inputs are validated before gcloud can run
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/release/pronunciation-v3.ps1', import.meta.url);
const CONFIG = new URL('../../scripts/release/pronunciation-v3.production.json', import.meta.url);

const script = fs.readFileSync(SCRIPT, 'utf8');
const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

/**
 * Executable lines only. The script documents the flags it must never use, so
 * scanning raw text would flag its own safety comments. Strips <# #> blocks
 * and #-comments.
 */
const code = script
    .replace(/<#[\s\S]*?#>/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

test('config declares both services with explicit promotion and rollback paths', () => {
    for (const name of ['praat-api', 'phoneme-recognizer']) {
        const svc = config.services[name];
        assert.ok(svc, `${name} missing from config`);
        assert.match(svc.rollbackRevision, /^[a-z-]+-\d{5}-[a-z0-9]+$/, `${name} rollback must name an explicit revision`);
        assert.match(svc.currentRevision, /^[a-z-]+-\d{5}-[a-z0-9]+$/, `${name} current must name an explicit revision`);
        assert.notEqual(svc.rollbackRevision, svc.currentRevision, `${name} rollback must differ from current`);
    }
});

test('access mechanisms are declared and correct', () => {
    assert.equal(config.services['praat-api'].access, 'public',
        'the browser calls praat-api without a Cloud Run identity token');
    assert.equal(config.services['phoneme-recognizer'].access, 'private');
});

test('praat-api is never made private by the release script', () => {
    // --no-allow-unauthenticated on praat-api takes the public API offline.
    const offending = code.split('\n').filter((line) => line.includes('--no-allow-unauthenticated'));
    assert.equal(offending.length, 0,
        `release script must not pass --no-allow-unauthenticated: ${offending.join(' | ')}`);
});

test('candidate deploys do not mutate IAM', () => {
    for (const forbidden of ['add-iam-policy-binding', 'remove-iam-policy-binding', 'set-iam-policy']) {
        const lines = code.split('\n').filter((l) => l.includes(forbidden));
        assert.equal(lines.length, 0,
            `Cloud Run IAM is service-wide, so a candidate deploy must not call ${forbidden}`);
    }
    assert.match(code, /Assert-AccessUnchanged/, 'candidate deploy must verify access instead of changing it');
});

test('--to-latest is rejected before gcloud runs', () => {
    assert.ok(Array.isArray(config.forbiddenTrafficTokens), 'config must list forbidden traffic tokens');
    for (const token of ['latest', 'LATEST', '--to-latest']) {
        assert.ok(config.forbiddenTrafficTokens.includes(token), `${token} must be forbidden`);
    }
    assert.match(code, /function Assert-NoLatest/, 'script must define the guard');
    // The guard must run inside the single gcloud wrapper, not merely exist.
    const wrapper = code.slice(code.indexOf('function Invoke-Gcloud'), code.indexOf('function Get-AccessMechanism'));
    assert.match(wrapper, /Assert-NoLatest/, 'the gcloud wrapper must call the guard');
});

test('traffic is always routed to an explicit revision', () => {
    const routes = code.split('\n').filter((l) => l.includes('--to-revisions='));
    assert.ok(routes.length >= 2, 'both Promote and Rollback must route traffic explicitly');
    for (const line of routes) {
        assert.match(line, /--to-revisions=\$\w+=100/, `route must pin one revision at 100%: ${line}`);
    }
});

test('no minScale is declared for either service', () => {
    for (const name of ['praat-api', 'phoneme-recognizer']) {
        assert.equal(config.services[name].minScale, null,
            `${name} must not pin an always-billed instance`);
    }
});

test('shadow mode and recognizer wiring are declared', () => {
    const env = config.services['praat-api'].env;
    assert.equal(env.PRONUNCIATION_V3_MODE, 'shadow', 'V3 must stay off the learner path');
    assert.equal(env.PHONEME_SERVICE_AUTH, 'google');
    assert.ok(env.PHONEME_SERVICE_URL.startsWith('https://'), 'recognizer URL must be https');
});

test('active V3 is opt-in for a zero-traffic praat-api candidate only', () => {
    assert.match(code, /ValidateSet\('shadow','active'\).*PronunciationV3Mode/s,
        'the release entrypoint must expose only the two reviewed V3 modes');
    assert.match(code, /PRONUNCIATION_V3_MODE=\$effectiveV3Mode/,
        'the candidate environment must bind the explicit or declared mode');
    assert.match(code, /if\s*\(\$Service\s+-eq\s+'phoneme-recognizer'[^)]*\$PronunciationV3Mode/s,
        'the recognizer must reject an API-only mode override');
    assert.match(code, /--no-traffic/,
        'an active candidate must remain at zero traffic until explicit promotion');
});

test('candidate source SHA and image digest are validated before gcloud', () => {
    assert.match(code, /\$Sha\s+-notmatch\s+'\^\[0-9a-f\]\{7,40\}\$'/,
        'candidate source SHA must be constrained to lowercase hexadecimal');
    assert.match(code, /\$Digest\s+-notmatch\s+'\^sha256:\[0-9a-f\]\{64\}\$'/,
        'candidate digest must be an immutable sha256 digest');
    const deploy = code.slice(code.indexOf("  'DeployCandidate' {"), code.indexOf("  'Promote' {"));
    assert.ok(deploy.indexOf('$Sha -notmatch') < deploy.indexOf('Assert-AccessUnchanged'),
        'source validation must happen before any gcloud-backed access check');
    assert.ok(deploy.indexOf('$Digest -notmatch') < deploy.indexOf('Assert-AccessUnchanged'),
        'digest validation must happen before any gcloud-backed access check');
});

test('full source SHA keeps provenance while the candidate tag stays Cloud Run-safe', () => {
    const fullSha = '33b701aa45fddc43d5eda99a173405abac105faf';
    const expectedTag = `cand${fullSha.slice(0, 12)}`;
    assert.equal(fullSha.length, 40);
    assert.ok(expectedTag.length + '---'.length + 'praat-api'.length <= 46,
        'the candidate tag and service name must fit the combined Cloud Run limit');
    assert.match(code, /\$combinedNameLimit\s*=\s*46/,
        'candidate tag sizing must use the reviewed combined-name limit');
    assert.match(code, /\$maxTagLength\s*=\s*\$combinedNameLimit\s*-\s*\$ServiceName\.Length/,
        'candidate tag sizing must account for the service name');
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'pronunciation-v3-release-'));
    const fakeGcloud = path.join(fakeBin, 'gcloud.cmd');
    fs.writeFileSync(fakeGcloud, '@echo off\necho {"bindings":[{"members":["allUsers"]}]}\n', 'utf8');

    try {
        const psExe = process.platform === 'win32' ? 'powershell' : 'pwsh';
        const result = spawnSync(psExe, [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            fileURLToPath(SCRIPT),
            '-Action',
            'DeployCandidate',
            '-Service',
            'praat-api',
            '-Sha',
            fullSha,
            '-Digest',
            `sha256:${'a'.repeat(64)}`,
            '-WhatIf',
        ], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` },
            timeout: 30_000,
        });
        const output = `${result.stdout}\n${result.stderr}`;

        assert.equal(result.status, 0, output);
        assert.equal(result.signal, null, output);
        assert.match(output, new RegExp(`--tag=${expectedTag}(?:\\s|$)`),
            'candidate deploy must use a deterministic 12-hex tag fragment');
        assert.doesNotMatch(output, new RegExp(`--tag=cand${fullSha}`),
            'candidate tag must not contain the full 40-character SHA');
        assert.match(output, new RegExp(`GIT_SHA=${fullSha},BUILD_SHA=${fullSha}`),
            'candidate environment must retain the complete source SHA for provenance');
        assert.match(output, new RegExp(`https://${expectedTag}---praat-api-.*?/health`),
            'printed smoke-test URL must use the shortened candidate tag');
    } finally {
        fs.rmSync(fakeBin, { recursive: true, force: true });
    }
});

test('praat-api candidate environment stays one quoted compound argument', () => {
    assert.match(code, /\$envFlag\s*=\s*"--update-env-vars=PRONUNCIATION_V3_MODE=\$effectiveV3Mode,PHONEME_SERVICE_URL=\$recognizerUrl,PHONEME_SERVICE_AUTH=\$recognizerAuth,GIT_SHA=\$Sha,BUILD_SHA=\$Sha"/,
        'the complete candidate environment must be one quoted PowerShell string');
    assert.match(code, /\$deployArgs\s*\+=\s*\$envFlag/,
        'the compound environment string must be appended as one argument');
});

test('recognizer startup probe gates on /readyz, not a TCP bind', () => {
    const probe = config.services['phoneme-recognizer'].startupProbe;
    assert.equal(probe.httpGet.path, '/readyz');
    assert.ok(probe.failureThreshold * probe.periodSeconds >= 60,
        'probe budget must exceed the observed ~50s model load');
});

test('scheduler OIDC audience is the base service URL, not a tag URL', () => {
    const s = config.scheduler;
    // A tagged-revision hostname is not a valid audience and yields 401 - this
    // exact failure appears in the 04:12 UTC logs of the original incident.
    assert.ok(!s.oidcAudience.includes('---'), 'audience must not be a tagged-revision URL');
    assert.ok(s.uri.startsWith(s.oidcAudience), 'the ping URI must live under the audience host');
    assert.equal(s.schedule, '*/10 6-23 * * *');
    assert.equal(s.timeZone, 'Asia/Ho_Chi_Minh');
});

test('compound gcloud flag values are quoted against PowerShell array-splitting', () => {
    // An unquoted a=1,b=2 is parsed by PowerShell as an array and rejoined with
    // spaces, which silently corrupted --startup-probe and --update-env-vars.
    const compound = code
        .split('\n')
        .filter((l) => /--(update-env-vars|startup-probe|set-env-vars)=/.test(l));
    for (const line of compound) {
        assert.match(line.trim(), /^["']|=\s*"/,
            `compound flag must be quoted as one string: ${line.trim()}`);
    }
});

test('phoneme-recognizer declares concurrency 1 and release script passes it', () => {
    assert.equal(config.services['phoneme-recognizer'].concurrency, 1,
        'phoneme-recognizer must declare concurrency 1 to prevent false RECOGNIZER_BUSY contention');
    assert.match(code, /--concurrency=/,
        'release script must pass --concurrency to Cloud Run deploy');
});
