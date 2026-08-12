import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const launcher = fs.readFileSync(new URL('../../backend/local_server/start_all_servers.bat', import.meta.url), 'utf8');
const localServer = fs.readFileSync(new URL('../../backend/phoneme_service/local_server.py', import.meta.url), 'utf8');

test('local launcher waits for phoneme readiness before injecting recognizer config', () => {
    assert.match(launcher, /curl\.exe\s+-s\s+-o\s+nul[^\r\n]*--fail[^\r\n]*http:\/\/127\.0\.0\.1:8082\/readyz/i);
    // Poll on elapsed wall-clock time. An iteration-count loop collapses to
    // near-zero real waiting while the port refuses connections, which
    // silently drops the session into the no-V3 branch.
    assert.match(launcher, /_PHONEME_WAIT_LIMIT=180/i);
    // Elapsed time must come from the clock. A per-iteration increment is
    // wrong in both directions: it under-waits while the port refuses
    // connections (curl fails instantly) and over-waits by minutes when
    // readiness requests time out at --max-time.
    assert.match(launcher, /_PHONEME_START=\(\(1%%a-100\)\*3600\)/i);
    assert.match(launcher, /_PHONEME_NOW=\(\(1%%a-100\)\*3600\)/i);
    assert.match(launcher, /set \/a _PHONEME_WAITED=!_PHONEME_NOW!-!_PHONEME_START!/i);
    assert.match(launcher, /if !_PHONEME_WAITED! lss 0 set \/a _PHONEME_WAITED\+=86400/i, 'midnight rollover unguarded');
    // 86400 is the legitimate midnight-rollover correction; any other fixed
    // increment means elapsed time is being counted, not measured.
    assert.doesNotMatch(launcher, /_PHONEME_WAITED\+=(?!86400)\d+/i, 'elapsed must not be a fixed per-iteration increment');
    assert.match(launcher, /if !_PHONEME_WAITED! lss !_PHONEME_WAIT_LIMIT! goto phoneme_wait_loop/i);
    // Scoped to the phoneme block: the Auth emulator above legitimately still
    // uses a counted loop, and its readiness is not what this test guards.
    const phonemeWaitBlock = launcher.slice(
        launcher.indexOf('Wait for lazy model readiness'),
        launcher.indexOf(':phoneme_wait_done')
    );
    assert.ok(phonemeWaitBlock.length > 0, 'phoneme readiness block not found');
    assert.doesNotMatch(phonemeWaitBlock, /for \/L %%i in/i);
    assert.match(launcher, /--connect-timeout\s+1\s+--max-time\s+5/i);
    assert.match(launcher, /if !PHONEME_READY!==1[\s\S]*PHONEME_SERVICE_URL=http:\/\/127\.0\.0\.1:8082[\s\S]*PHONEME_SERVICE_AUTH=disabled[\s\S]*PRONUNCIATION_V3_MODE=shadow/i);
    // A V3-disabled session must be impossible to miss, and must name
    // RECOGNIZER_CONFIG_MISSING so nobody debugs the analyzer instead.
    assert.match(launcher, /WARNING: V3 IS DISABLED FOR THIS SESSION/i);
    assert.match(launcher, /RECOGNIZER_CONFIG_MISSING/);
    assert.match(launcher, /set PHONEME_SERVICE_URL=&& set PHONEME_SERVICE_AUTH=&& set PRONUNCIATION_V3_MODE=off/i);
    assert.match(launcher, /python -m backend\.phoneme_service\.local_server/i);
    assert.doesNotMatch(launcher, /python -c .*create_app/i);
    assert.match(launcher, /start "Phoneme Service 8082" \/min python -m backend\.phoneme_service\.local_server/i);
    assert.doesNotMatch(launcher, /start "Phoneme Service 8082"[\s\S]*cmd \/c[\s\S]*backend\.phoneme_service\.local_server/i);
    assert.equal(launcher.includes('pushd "%~dp0\\..\\.."'), true);
    assert.match(launcher, /popd/i);
    assert.doesNotMatch(launcher, /curl\.exe\s+-s\s+-o\s+nul\s+http:\/\/127\.0\.0\.1:8082\/healthz/i);
    assert.match(localServer, /host\s*=\s*["']127\.0\.0\.1["']/i);
    assert.match(localServer, /os\.environ\.get\(["']PORT["']/i);
});
