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
import fs from 'node:fs';
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
    assert.match(code, /\$Sha\s+-notmatch\s+'\^\[0-9a-f\]\{40\}\$'/,
        'candidate source SHA must be a full lowercase Git commit SHA');
    assert.match(code, /\$Digest\s+-notmatch\s+'\^sha256:\[0-9a-f\]\{64\}\$'/,
        'candidate digest must be an immutable sha256 digest');
    const deploy = code.slice(code.indexOf("  'DeployCandidate' {"), code.indexOf("  'Promote' {"));
    assert.match(deploy, /-not\s+\$BuildId\s+-or\s+-not\s+\$SourceRoot/);
    assert.ok(deploy.indexOf('$Sha -notmatch') < deploy.indexOf('Assert-CleanSourceRoot') &&
        deploy.indexOf('$Digest -notmatch') < deploy.indexOf('Assert-BuildImage') &&
        deploy.indexOf('Assert-BuildImage') < deploy.indexOf('Assert-AccessUnchanged'),
    'identity checks must precede the first Cloud Run mutation');
    assert.match(code, /git -C \$Root status --porcelain=v1 --untracked-files=all/);
    assert.match(code, /gcloud meta list-files-for-upload/);
    assert.match(code, /git ls-files --error-unmatch/);
    assert.match(code, /verify-pronunciation-source\.py/);
    assert.match(code, /& python \$helper --project \$cfg\.project --build-id \$Id --source-root \$Root/);
    const promote = code.slice(code.indexOf("  'Promote' {"), code.indexOf("  'Rollback' {"));
    assert.match(promote, /-not \$SourceRoot/);
    assert.match(promote, /Assert-BuildImage[^\n]*-Root \$SourceRoot[\s\S]*Assert-AccessUnchanged[\s\S]*Invoke-Gcloud/);
});

test('full source SHA keeps full provenance but uses a bounded candidate tag', () => {
    const builder = code.slice(code.indexOf('function Get-SafeCandidateTag'), code.indexOf('function Invoke-Gcloud'));
    assert.match(builder, /^function Get-SafeCandidateTag\s*\{/);
    assert.match(builder, /\$combinedNameLimit\s*=\s*46\b/);
    assert.match(builder, /\$tagServiceSeparatorLength\s*=\s*3\b/);
    assert.match(builder, /\$tagPrefix\s*=\s*'cand'/);
    assert.match(builder, /\$maxTagLength\s*=\s*\$combinedNameLimit\s*-\s*\$ServiceName\.Length\s*-\s*\$tagServiceSeparatorLength/);
    assert.match(builder, /\$shaLength\s*=\s*\[Math\]::Min\(12,\s*\$SourceSha\.Length\)/);
    assert.match(builder, /\$shaLength\s*=\s*\[Math\]::Min\(\$shaLength,\s*\$maxTagLength\s*-\s*\$tagPrefix\.Length\)/);
    assert.match(builder, /if\s*\(\$shaLength\s+-lt\s+1\)\s*\{\s*throw\s+"/, 'a service name without tag room must be rejected');
    assert.match(builder, /return\s+"\$tagPrefix\$\(\$SourceSha\.Substring\(0,\s*\$shaLength\)\)"/);

    const deploy = code.slice(code.indexOf("  'DeployCandidate' {"), code.indexOf("  'Promote' {"));
    const tagCall = deploy.indexOf('$candidateTag = Get-SafeCandidateTag -ServiceName $Service -SourceSha $Sha');
    const shaCheck = deploy.indexOf('$Sha -notmatch');
    const digestCheck = deploy.indexOf('$Digest -notmatch');
    assert.ok(shaCheck >= 0 && digestCheck >= 0 && tagCall > shaCheck && tagCall > digestCheck,
        'SHA and digest must be validated before deriving a tag');
    assert.match(code, /ValidateSet\('praat-api','phoneme-recognizer'\)\]\[string\]\$Service/);
    assert.match(deploy, /--tag=\$candidateTag/);
    assert.match(deploy, /--remove-env-vars=GIT_SHA,BUILD_SHA/,
        'service-level SHA labels must not override source labels baked into the image');
});

test('praat-api candidate environment stays one quoted compound argument', () => {
    assert.match(code, /\$envFlag\s*=\s*"--update-env-vars=PRONUNCIATION_V3_MODE=\$effectiveV3Mode,PHONEME_SERVICE_URL=\$recognizerUrl,PHONEME_SERVICE_AUTH=\$recognizerAuth"/,
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

test('candidate and rollback retain the current concurrency and readiness shape', () => {
    assert.equal(config.services['phoneme-recognizer'].containerConcurrency, 1);
    assert.equal(config.services['praat-api'].containerConcurrency, 80);
    const deploy = code.slice(code.indexOf("  'DeployCandidate' {"), code.indexOf("  'Promote' {"));
    assert.match(deploy, /--concurrency=\$\(\$svc\.containerConcurrency\)/);
    assert.match(deploy, /--startup-probe=httpGet\.path=\$\(\$probe\.httpGet\.path\),initialDelaySeconds=/);
    const shape = code.slice(code.indexOf('function Assert-RevisionCompatible'), code.indexOf('switch ($Action)'));
    assert.match(shape, /\$revision\.spec\.containerConcurrency -ne \[int\]\$service\.containerConcurrency/);
    assert.match(shape, /\$have\.httpGet\.path -ne \$want\.httpGet\.path/);
    const promote = code.slice(code.indexOf("  'Promote' {"), code.indexOf("  'Rollback' {"));
    assert.match(promote, /Assert-BuildImage[\s\S]*Assert-RevisionCompatible[\s\S]*Invoke-Gcloud/);
    const rollback = code.slice(code.indexOf("  'Rollback' {"));
    assert.match(rollback, /Assert-AccessUnchanged[\s\S]*Assert-RevisionCompatible[\s\S]*Invoke-Gcloud/);
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
