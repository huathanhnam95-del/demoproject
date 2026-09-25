'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const test = require('node:test');
const preserved = require('../../scripts/release/preserved-hosting.cjs');
const wrapper = require('../../scripts/release/firebase-release.cjs');

const projectId = 'abcde';
const sourceSha = 'a'.repeat(40);
const baseVersion = 'sites/abcde/versions/base1';
const nextVersion = 'sites/abcde/versions/next1';
const baseRelease = 'sites/abcde/releases/base1';
const nextRelease = 'sites/abcde/releases/next1';
const oldHash = '1'.repeat(64);
const rawHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceRoot = fs.realpathSync.native(path.resolve(__dirname, '../..'));
const outsideSource = candidate => {
  const relative = path.relative(sourceRoot, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`);
};
const requestedTestRoot = process.env.PRESERVED_HOSTING_TEST_ROOT;
if (requestedTestRoot && (!path.isAbsolute(requestedTestRoot) || !fs.existsSync(requestedTestRoot))) {
  throw new Error('PRESERVED_HOSTING_TEST_ROOT must name an existing absolute external directory');
}
const systemTempRoot = fs.realpathSync.native(os.tmpdir());
if (!outsideSource(systemTempRoot)) throw new Error('System temp must remain outside the source checkout');
const testParent = requestedTestRoot
  ? fs.realpathSync.native(requestedTestRoot)
  : fs.mkdtempSync(path.join(systemTempRoot, 'cursor-ai-preserved-hosting-'));
if (!outsideSource(testParent) || !fs.statSync(testParent).isDirectory()) {
  throw new Error('Preserved Hosting fixtures must remain outside the source checkout');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(testParent, 'case-'));
  const candidateRoot = path.join(root, 'candidate');
  fs.mkdirSync(path.join(candidateRoot, 'public'), { recursive: true });
  const bytes = Buffer.from('selected-new-content\n');
  const file = path.join(candidateRoot, 'public', 'new.txt');
  const overlayFile = path.join(root, 'new.txt');
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(overlayFile, bytes);
  const compressed = zlib.gzipSync(bytes, { level: 9 });
  const hostingHash = rawHash(compressed);
  const surface = [{ path: 'public/new.txt', size: bytes.length, mode: 420, sha256: rawHash(bytes) }];
  const config = { headers: [{ glob: '**', headers: { 'Cache-Control': 'max-age=1800' } }] };
  const baseFiles = [{ path: '/old.txt', hash: oldHash }];
  const finalFiles = [...baseFiles, { path: '/new.txt', hash: hostingHash }];
  const plan = {
    schemaVersion: 1, projectId, siteId: projectId, sourceSha,
    packageVersion: '2.0.17', livePackageVersion: '2.0.14',
    candidateSurfaceSha256: rawHash(JSON.stringify(surface)),
    base: { release: baseRelease, version: baseVersion, config,
      configSha256: preserved.configHash(config), files: baseFiles },
    final: { configSha256: preserved.configHash(config), files: finalFiles },
    overlays: [{ path: '/new.txt', sourcePath: 'public/new.txt', rawSha256: rawHash(bytes),
      hostingHash, bytes: bytes.length, bytesPath: overlayFile, sourceKind: 'frozen-candidate',
      provenance: { sourceCommit: sourceSha } }]
  };
  const manifest = path.join(root, 'preservation-plan.json');
  const save = () => fs.writeFileSync(manifest, JSON.stringify(plan));
  save();
  const ctx = { profile: 'hosting', sealed: true, sourceSha, project: { id: projectId },
    config: { hosting: { site: projectId } }, candidateRoot,
    versionOracle: { version: '2.0.17' }, receiptPath: path.join(root, 'source.receipt.json'),
    receipt: { profile: 'hosting', sourceSha, candidateRoot, surface } };
  return { root, plan, manifest, save, ctx, bytes, config, baseFiles, finalFiles, hostingHash, overlayFile };
}

function mockTransport(f, overrides = {}) {
  const calls = [];
  let stage = 'base';
  let live = 'base';
  const base = { release: baseRelease, version: baseVersion, config: f.config,
    files: f.baseFiles.map(file => ({ ...file, status: 'ACTIVE' })) };
  const final = { release: nextRelease, version: nextVersion, config: f.config,
    files: f.finalFiles.map(file => ({ ...file, status: 'ACTIVE' })) };
  const transport = {
    async getLive() { calls.push('getLive'); return overrides.getLive?.(calls.length, live, base, final) || (live === 'base' ? base : final); },
    async clone(site, source) { calls.push('clone'); assert.equal(site, projectId); assert.equal(source, baseVersion);
      return { name: 'projects/abcde/operations/clone1', done: false }; },
    async getOperation() { calls.push('getOperation'); return { name: 'projects/abcde/operations/clone1', done: true,
      response: { name: nextVersion, status: 'CREATED' } }; },
    async getVersionWithFiles() { calls.push('getVersionWithFiles');
      return overrides.getStage?.(stage, base, final) || { ...(stage === 'base' ? base : final), version: nextVersion, status: 'CREATED' }; },
    async populate(name, files) { calls.push('populate'); assert.equal(name, nextVersion);
      assert.deepEqual(files, { '/new.txt': f.hostingHash });
      stage = 'final'; return overrides.populate?.() || { uploadRequiredHashes: [f.hostingHash], uploadUrl: 'https://upload-firebasehosting.googleapis.com/upload/sites/abcde/versions/next1/files' }; },
    async upload(url, name, hash, bytes) { calls.push('upload'); assert.equal(name, nextVersion);
      assert.equal(hash, f.hostingHash); assert.equal(rawHash(bytes), hash); },
    async finalize() { calls.push('finalize'); return { name: nextVersion, status: 'FINALIZED', config: f.config }; },
    async release() { calls.push('release'); live = 'final'; return { name: nextRelease, version: { name: nextVersion } }; }
  };
  return { transport, calls };
}

test('local plan binds source receipt, complete live map, overlay bytes and gzip hash', () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  assert.equal(ready.receipt.sourceSha, sourceSha);
  assert.equal(ready.receipt.overlays.length, 1);
  fs.writeFileSync(f.overlayFile, 'tampered');
  assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'OVERLAY_BYTES' });
  fs.writeFileSync(f.overlayFile, f.bytes);
  f.plan.final.files.push({ path: '/unreviewed.txt', hash: '2'.repeat(64) });
  f.save();
  assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'PLAN_MAP' });
  f.plan.final.files.pop();
  f.plan.overlays[0].path = '/__/firebase/init.js';
  f.save();
  assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'PLAN_RESERVED' });
});

test('reviewed live HTML merges derive exact versioned bytes without candidate equality', () => {
  for (const fileName of ['index.html', 'crm-admin.html', 'crm-entrance-test-result.html']) {
    const f = fixture();
    const version = '2.0.17';
    const crmVersion = '20260925-v2.0.17';
    const token = fileName === 'index.html'
      ? '<div id="version-indicator" class="version-indicator">V2.0.14</div>'
      : '<script src="/crm-admin.js?v=20260920-v2.0.14"></script>'.repeat(
        fileName === 'crm-admin.html' ? 97 : 5);
    const live = Buffer.from(`${token}\n<div>LIVE_ONLY</div>\n`);
    const source = Buffer.from(`${token}\n<div>SOURCE_ONLY</div>\n`);
    const frozen = Buffer.from(`${token}\n<div>LIVE_ONLY</div>\n<div>SOURCE_ONLY</div>\n`);
    const output = preserved.syncReviewedHtml(`/${fileName}`, frozen, version, crmVersion);
    const candidate = Buffer.from(`${token}\n<div>SOURCE_ONLY</div>\n`);
    const candidateFile = path.join(f.ctx.candidateRoot, 'public', fileName);
    const outputFile = path.join(f.root, `${fileName}.output`);
    const liveFile = path.join(f.root, `${fileName}.live`);
    const frozenFile = path.join(f.root, `${fileName}.frozen`);
    const evidenceFile = path.join(f.root, 'reviewed-merge.json');
    fs.writeFileSync(candidateFile, candidate);
    fs.writeFileSync(outputFile, output);
    fs.writeFileSync(liveFile, live);
    fs.writeFileSync(frozenFile, frozen);
    fs.writeFileSync(evidenceFile, '{"reviewed":true}\n');
    const liveHostingHash = rawHash(zlib.gzipSync(live, { level: 9 }));
    const outputHostingHash = rawHash(zlib.gzipSync(output, { level: 9 }));
    const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'sync-version.js'));
    fs.mkdirSync(path.join(f.ctx.candidateRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(f.ctx.candidateRoot, 'scripts', 'sync-version.js'), script);
    f.ctx.versionOracle = { version, crmVersion };
    f.ctx.readSourceBlob = () => source;
    f.ctx.receipt.surface = [{ path: `public/${fileName}`, size: candidate.length, mode: 420, sha256: rawHash(candidate) }];
    f.plan.candidateSurfaceSha256 = rawHash(JSON.stringify(f.ctx.receipt.surface));
    f.plan.base.files = [{ path: `/${fileName}`, hash: liveHostingHash }];
    f.plan.final.files = [{ path: `/${fileName}`, hash: outputHostingHash }];
    f.plan.overlays = [{ path: `/${fileName}`, sourcePath: `public/${fileName}`,
      rawSha256: rawHash(output), hostingHash: outputHostingHash, bytes: output.length,
      bytesPath: outputFile, sourceKind: 'live-preserving-merge', provenance: { sourceCommit: sourceSha },
      mergeProof: { liveInputPath: liveFile, liveInputRawSha256: rawHash(live),
        liveInputHostingHash: liveHostingHash, frozenOverlayPath: frozenFile, frozenOverlayRawSha256: rawHash(frozen),
        reviewedEvidencePath: evidenceFile, reviewedEvidenceSha256: rawHash(fs.readFileSync(evidenceFile)),
        sourceRawSha256: rawHash(source), versionSyncScriptSha256: rawHash(script) } }];
    f.save();
    assert.ok(preserved.preparePreservation(f.ctx, f.manifest).receipt.overlays.length === 1);
    f.plan.overlays[0].mergeProof.liveInputHostingHash = '7'.repeat(64);
    f.plan.base.files[0].hash = '7'.repeat(64);
    f.save();
    assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'MERGE_PROOF' });
    f.plan.overlays[0].mergeProof.liveInputHostingHash = liveHostingHash;
    f.plan.base.files[0].hash = liveHostingHash;
    f.save();
    fs.writeFileSync(frozenFile, `${frozen.toString('utf8')}CHANGED`);
    assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'MERGE_PROOF' });
  }
});

test('reviewed HTML version transform rejects missing or extra version tokens', () => {
  for (const [name, count] of [['index.html', 1], ['crm-admin.html', 97],
    ['crm-entrance-test-result.html', 5]]) {
    const token = name === 'index.html'
      ? '<div id="version-indicator" class="version-indicator">V2.0.14</div>'
      : '<script src="/crm-admin.js?v=20260920-v2.0.14"></script>';
    assert.throws(() => preserved.syncReviewedHtml(`/${name}`, Buffer.from(token.repeat(count - 1)),
      '2.0.17', '20260925-v2.0.17'), { code: 'MERGE_PROOF' });
    assert.throws(() => preserved.syncReviewedHtml(`/${name}`, Buffer.from(token.repeat(count + 1)),
      '2.0.17', '20260925-v2.0.17'), { code: 'MERGE_PROOF' });
  }
});

test('declared line-ending conversion accepts only identical UTF-8 text', () => {
  const f = fixture();
  const lf = Buffer.from('first\nsecond\n');
  const crlf = Buffer.from('first\r\nsecond\r\n');
  fs.writeFileSync(path.join(f.ctx.candidateRoot, 'public', 'new.txt'), lf);
  fs.writeFileSync(f.overlayFile, crlf);
  f.ctx.receipt.surface[0].size = lf.length;
  f.ctx.receipt.surface[0].sha256 = rawHash(lf);
  f.plan.candidateSurfaceSha256 = rawHash(JSON.stringify(f.ctx.receipt.surface));
  f.plan.overlays[0].bytes = crlf.length;
  f.plan.overlays[0].rawSha256 = rawHash(crlf);
  f.plan.overlays[0].hostingHash = rawHash(zlib.gzipSync(crlf, { level: 9 }));
  f.plan.overlays[0].transform = 'line-endings-only';
  f.plan.final.files[1].hash = f.plan.overlays[0].hostingHash;
  f.save();
  assert.ok(preserved.preparePreservation(f.ctx, f.manifest));
  fs.writeFileSync(f.overlayFile, 'first\r\nCHANGED\r\n');
  assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'OVERLAY_BYTES' });
});

test('preservation completes only after clone, upload, full stage check and live check', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const { transport, calls } = mockTransport(f);
  const states = [];
  let sourceChecks = 0;
  const result = await preserved.publishPreservation(ready, transport,
    { record: stage => states.push(stage.state), sleep: async () => {},
      checkSource: () => { sourceChecks += 1; } });
  assert.equal(result.release, nextRelease);
  assert.deepEqual(calls, ['getLive', 'clone', 'getOperation', 'getVersionWithFiles', 'populate',
    'upload', 'getVersionWithFiles', 'getLive', 'finalize', 'getLive', 'release', 'getLive']);
  assert.deepEqual(states, ['CLONE_REQUESTED', 'CLONED', 'POPULATED', 'UPLOADED', 'FINALIZED', 'RELEASED', 'LIVE_VERIFIED']);
  assert.equal(sourceChecks, 3);
});

test('populate may omit upload inventory when all overlay hashes are already stored', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const mock = mockTransport(f, { populate: () => ({}) });
  const journal = [];
  const result = await preserved.publishPreservation(ready, mock.transport,
    { sleep: async () => {}, record: stage => journal.push(stage) });
  assert.equal(result.verified, true);
  assert.ok(!mock.calls.includes('upload'));
  assert.deepEqual(journal.find(stage => stage.state === 'POPULATED').requiredHashes, []);
});

test('live drift stops before clone and staged mismatch stops before finalization', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const drift = mockTransport(f, { getLive: () => ({ release: 'sites/abcde/releases/other',
    version: baseVersion, config: f.config, files: f.baseFiles }) });
  await assert.rejects(preserved.publishPreservation(ready, drift.transport), { code: 'LIVE_DRIFT' });
  assert.deepEqual(drift.calls, ['getLive']);
  const stage = mockTransport(f, { getStage: (state, base, final) =>
    state === 'base' ? { ...base, version: nextVersion, status: 'CREATED' }
      : { ...final, version: nextVersion, status: 'CREATED', files: f.baseFiles } });
  await assert.rejects(preserved.publishPreservation(ready, stage.transport, { sleep: async () => {} }), { code: 'FILE_DRIFT' });
  assert.ok(!stage.calls.includes('finalize'));
  assert.ok(!stage.calls.includes('release'));
});

test('unknown requested upload hash and late live drift prevent publication', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const unknown = mockTransport(f, { populate: () => ({ uploadRequiredHashes: ['f'.repeat(64)] }) });
  await assert.rejects(preserved.publishPreservation(ready, unknown.transport, { sleep: async () => {} }), { code: 'UPLOAD_HASH' });
  assert.ok(!unknown.calls.includes('upload'));
  const late = mockTransport(f, { getLive: (n, live, base) => n > 8 ? { ...base, release: 'sites/abcde/releases/other' } : base });
  await assert.rejects(preserved.publishPreservation(ready, late.transport, { sleep: async () => {} }), { code: 'LIVE_DRIFT' });
  assert.ok(!late.calls.includes('release'));
});

test('clone config, pending stage, and late source drift stop publication', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const clone = mockTransport(f, { getStage: (state, base, final) =>
    state === 'base' ? { ...base, version: nextVersion, status: 'CREATED', config: { headers: [] } }
      : { ...final, version: nextVersion, status: 'CREATED' } });
  await assert.rejects(preserved.publishPreservation(ready, clone.transport, { sleep: async () => {} }), { code: 'CLONE_DRIFT' });
  assert.ok(!clone.calls.includes('populate'));
  const pending = mockTransport(f, { getStage: (state, base, final) =>
    state === 'base' ? { ...base, version: nextVersion, status: 'CREATED' }
      : { ...final, version: nextVersion, status: 'CREATED',
        files: final.files.map(row => row.path === '/new.txt' ? { ...row, status: 'EXPECTED' } : row) } });
  await assert.rejects(preserved.publishPreservation(ready, pending.transport, { sleep: async () => {} }), { code: 'STAGE_PENDING' });
  assert.ok(!pending.calls.includes('finalize'));
  const source = mockTransport(f);
  let checks = 0;
  await assert.rejects(preserved.publishPreservation(ready, source.transport,
    { sleep: async () => {}, checkSource: () => { if (++checks === 3) throw new Error('SOURCE_DRIFT'); } }), /SOURCE_DRIFT/);
  assert.ok(!source.calls.includes('release'));
});

test('failed clone operation retains its ID before polling stops', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const mock = mockTransport(f);
  mock.transport.getOperation = async () => ({ name: 'projects/abcde/operations/clone1', done: true,
    error: { message: 'failed' } });
  const journal = [];
  await assert.rejects(preserved.publishPreservation(ready, mock.transport,
    { sleep: async () => {}, record: stage => journal.push(stage) }), { code: 'CLONE_OPERATION' });
  assert.deepEqual(journal.map(stage => stage.state), ['CLONE_REQUESTED']);
  assert.equal(journal[0].operation, 'projects/abcde/operations/clone1');
  assert.ok(!mock.calls.includes('populate'));
});

test('upload endpoint requires exact HTTPS host and version path', () => {
  const good = 'https://upload-firebasehosting.googleapis.com/upload/sites/abcde/versions/next1/files';
  assert.equal(preserved.validateUploadUrl(good, projectId, nextVersion).href, good);
  for (const bad of [good.replace('https:', 'http:'), good.replace('googleapis.com', 'googleapis.com.evil'),
    good.replace('/next1/', '/wrong/'), `${good}?redirect=evil`]) {
    assert.throws(() => preserved.validateUploadUrl(bad, projectId, nextVersion), { code: 'UPLOAD_URL' });
  }
});

test('REST reads paginate ACTIVE and EXPECTED files without real network', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.headers['x-goog-user-project'], projectId);
    const u = new URL(url);
    let body;
    if (u.pathname.endsWith('/channels/live/releases')) body = { releases: [
      { name: 'sites/abcde/channels/preview/releases/newer', version: { name: nextVersion },
        releaseTime: '2026-09-26T00:00:00Z' },
      { name: 'sites/abcde/channels/live/releases/base1', version: { name: baseVersion },
        releaseTime: '2026-09-25T00:00:00Z' }] };
    else if (u.pathname.endsWith('/versions/base1')) body = { name: baseVersion, config: { headers: [] } };
    else if (u.searchParams.get('status') === 'ACTIVE' && !u.searchParams.get('pageToken')) {
      body = { files: [{ path: '/a', hash: '1'.repeat(64), status: 'ACTIVE' }], nextPageToken: 'two' };
    } else if (u.searchParams.get('status') === 'ACTIVE') {
      body = { files: [{ path: '/b', hash: '2'.repeat(64), status: 'ACTIVE' }] };
    } else body = {};
    return { ok: true, json: async () => body };
  };
  const transport = preserved.createRestTransport({ projectId, siteId: projectId,
    getAccessToken: async () => 'test-token', fetchImpl });
  const live = await transport.getLive(projectId);
  assert.deepEqual(live.files.map(f => f.path), ['/a', '/b']);
  assert.ok(requests.some(u => u.includes('pageToken=two')));
  assert.ok(requests.some(u => u.includes('/channels/live/releases')));
  assert.ok(!requests.some(u => /\/sites\/abcde\/releases\?/.test(u)));
  assert.equal(live.release, baseRelease);
});

test('explicit gcloud credential uses execFile arguments and fails without a token', () => {
  const calls = [];
  const token = preserved.gcloudAccessToken({ platform: 'win32', gcloudPythonScript: __filename,
    pythonCommand: 'python-fixture', execFile(command, args, options) {
      calls.push({ command, args, shell: options.shell, stdin: options.stdio[0], stderr: options.stdio[2] });
      return 'synthetic-access-token\n';
    } });
  assert.equal(token, 'synthetic-access-token');
  assert.deepEqual(calls, [{ command: 'python-fixture',
    args: [__filename, 'auth', 'print-access-token'], shell: false, stdin: 'ignore', stderr: 'ignore' }]);
  assert.throws(() => preserved.gcloudAccessToken({ platform: 'win32', gcloudPythonScript: __filename,
    execFile: () => '\n' }), { code: 'GCLOUD_AUTH_UNAVAILABLE' });
  assert.throws(() => preserved.createRestTransport({ projectId, siteId: projectId,
    credentialMode: 'gcloud', getAccessToken: async () => 'wrong-path', fetchImpl: async () => ({ ok: true }) }),
  { code: 'TRANSPORT' });
});

test('explicit gcloud transport performs GET with the selected quota project', async () => {
  const calls = [];
  const transport = preserved.createRestTransport({ projectId, siteId: projectId,
    credentialMode: 'gcloud', getGcloudAccessToken: () => 'synthetic-access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access-token');
      assert.equal(options.headers['x-goog-user-project'], projectId);
      const u = new URL(url);
      let body;
      if (u.pathname.endsWith('/channels/live/releases')) body = { releases: [{
        name: 'sites/abcde/channels/live/releases/base1', version: { name: baseVersion },
        releaseTime: '2026-09-25T00:00:00Z' }] };
      else if (u.pathname.endsWith('/versions/base1')) body = { name: baseVersion, config: {} };
      else body = {};
      return { ok: true, json: async () => body };
    } });
  const live = await transport.getLive(projectId);
  assert.equal(live.version, baseVersion);
  assert.equal(calls.length, 4);
});

test('preserved plan binds its explicit credential choice without a fallback', () => {
  const f = fixture();
  f.plan.credentialMode = 'gcloud';
  f.save();
  assert.equal(preserved.preparePreservation(f.ctx, f.manifest).receipt.credentialMode, 'gcloud');
  f.plan.credentialMode = 'automatic';
  f.save();
  assert.throws(() => preserved.preparePreservation(f.ctx, f.manifest), { code: 'PLAN_SCHEMA' });
});

test('REST transport publishes only the reviewed overlay through the live site', async () => {
  const f = fixture();
  const ready = preserved.preparePreservation(f.ctx, f.manifest);
  const calls = [];
  let populated = false;
  let published = false;
  let finalized = false;
  const uploadUrl = 'https://upload-firebasehosting.googleapis.com/upload/sites/abcde/versions/next1/files';
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    const route = `${options.method} ${u.pathname}${u.search}`;
    calls.push(route);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.headers['x-goog-user-project'], projectId);
    let body;
    if (u.host === 'upload-firebasehosting.googleapis.com') {
      assert.equal(route, `POST /upload/sites/abcde/versions/next1/files/${f.hostingHash}`);
      assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      assert.equal(rawHash(options.body), f.hostingHash);
      body = {};
    } else if (route.startsWith('GET /v1beta1/sites/abcde/channels/live/releases?')) {
      body = { releases: [{ name: published ? `sites/abcde/channels/live/releases/next1`
        : `sites/abcde/channels/live/releases/base1`,
      version: { name: published ? nextVersion : baseVersion }, releaseTime: '2026-09-25T00:00:00Z' }] };
    } else if (route === 'GET /v1beta1/sites/abcde/versions/base1') {
      body = { name: baseVersion, status: 'FINALIZED', config: f.config };
    } else if (route === 'GET /v1beta1/sites/abcde/versions/next1') {
      body = { name: nextVersion, status: finalized ? 'FINALIZED' : 'CREATED', config: f.config };
    } else if (route.includes('/files?status=ACTIVE')) {
      body = { files: (u.pathname.endsWith('/base1/files') || (!populated && !published)
        ? f.baseFiles : f.finalFiles).map(file => ({ ...file, status: 'ACTIVE' })) };
    } else if (route.includes('/files?status=EXPECTED')) {
      body = {};
    } else if (route === 'POST /v1beta1/sites/abcde/versions:clone') {
      assert.deepEqual(JSON.parse(options.body), { sourceVersion: baseVersion, finalize: false });
      body = { name: 'projects/abcde/operations/clone1', done: false };
    } else if (route === 'GET /v1beta1/projects/abcde/operations/clone1') {
      body = { name: 'projects/abcde/operations/clone1', done: true,
        response: { name: nextVersion, status: 'CREATED' } };
    } else if (route === 'POST /v1beta1/sites/abcde/versions/next1:populateFiles') {
      assert.deepEqual(JSON.parse(options.body), { files: { '/new.txt': f.hostingHash } });
      populated = true;
      body = { uploadRequiredHashes: [f.hostingHash], uploadUrl };
    } else if (route === 'PATCH /v1beta1/sites/abcde/versions/next1?updateMask=status') {
      assert.deepEqual(JSON.parse(options.body), { status: 'FINALIZED' });
      finalized = true;
      body = { name: nextVersion, status: 'FINALIZED', config: f.config };
    } else if (route === 'POST /v1beta1/sites/abcde/releases?versionName=sites%2Fabcde%2Fversions%2Fnext1') {
      published = true;
      body = { name: nextRelease, version: { name: nextVersion } };
    } else throw new Error(`Unexpected fake REST request: ${route}`);
    return { ok: true, json: async () => body };
  };
  const transport = preserved.createRestTransport({ projectId, siteId: projectId,
    getAccessToken: async () => 'test-token', fetchImpl });
  const journal = [];
  const result = await preserved.publishPreservation(ready, transport,
    { sleep: async () => {}, record: stage => journal.push(stage), checkSource: () => {} });
  assert.equal(result.verified, true);
  assert.deepEqual(journal.map(stage => stage.state), ['CLONE_REQUESTED', 'CLONED', 'POPULATED',
    'UPLOADED', 'FINALIZED', 'RELEASED', 'LIVE_VERIFIED']);
  assert.ok(calls.indexOf('POST /v1beta1/sites/abcde/versions:clone') <
    calls.indexOf('POST /v1beta1/sites/abcde/versions/next1:populateFiles'));
  assert.ok(calls.indexOf(`POST /upload/sites/abcde/versions/next1/files/${f.hostingHash}`) <
    calls.indexOf('PATCH /v1beta1/sites/abcde/versions/next1?updateMask=status'));
  assert.ok(calls.at(-1).includes('/versions/next1/files?status=EXPECTED'));
});

test('wrapper preserves sync default API and rejects invalid preservation option mixes', () => {
  assert.equal(wrapper.parseArgs(['hosting']).profile, 'hosting');
  assert.throws(() => wrapper.parseArgs(['functions', '--preserve-live-hosting-manifest', __filename]), { code: 'PRESERVATION_OPTIONS' });
  assert.throws(() => wrapper.parseArgs(['hosting', '--publish-preserved-hosting']), { code: 'PRESERVATION_OPTIONS' });
  assert.throws(() => wrapper.parseArgs(['hosting', '--preserve-live-hosting-manifest', __filename,
    '--publish-preserved-hosting', '--verify-only']), { code: 'PRESERVATION_OPTIONS' });
  assert.throws(() => wrapper.parseArgs(['hosting', '--preserve-live-hosting-manifest', __filename,
    '--channel', 'preview']), { code: 'PRESERVATION_OPTIONS' });
  assert.equal(wrapper.parseArgs(['hosting', '--preserve-live-hosting-manifest', __filename,
    '--publish-preserved-hosting']).publishPreservedHosting, true);
  assert.throws(() => wrapper.runRelease({ preserveManifest: __filename }), { code: 'PRESERVATION_OPTIONS' });
});
