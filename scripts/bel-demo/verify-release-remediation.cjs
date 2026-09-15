'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(__dirname, 'release-remediation-manifest.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalize(value) {
  return value.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function normalizedSha256(filePath) {
  return sha256(Buffer.from(normalize(fs.readFileSync(filePath))));
}

function repoPath(relative) {
  return path.join(ROOT, ...relative.split('/'));
}

function replaceOnce(value, current, replacement, label) {
  const first = value.indexOf(current);
  assert.notEqual(first, -1, `${label} is missing`);
  assert.equal(value.indexOf(current, first + current.length), -1, `${label} occurs more than once`);
  return `${value.slice(0, first)}${replacement}${value.slice(first + current.length)}`;
}

function stripBelHtml(value) {
  let text = normalize(value);
  const nav = '            <li>\n              <button class="crm-nav-item" data-main="presentation-demo" data-label="Presentation Demo">Presentation Demo</button>\n            </li>\n';
  const panel = `\n      <section class="crm-panel" data-panel="presentation-demo" style="display: none;">\n        <div class="crm-panel-header">\n          <div>\n            <h2>Presentation Demo</h2>\n            <p>Open the authenticated Working as Equals room. The CRM stays available while the game runs in a separate tab.</p>\n          </div>\n        </div>\n        <div class="crm-placeholder-card" id="crm-presentation-demo-workspace">\n          <p class="crm-muted" id="crm-presentation-demo-status">Online room access is checked by the presentation service.</p>\n          <button class="crm-btn-primary" id="crm-presentation-demo-open" type="button">Open Presentation Demo</button>\n          <a id="crm-presentation-demo-link" href="/presentation-demo/index.html" target="_blank" rel="noopener" hidden>Open in a new tab</a>\n        </div>\n      </section>\n`;
  const script = '  <script src="js/crm/presentation-demo-workspace.js?v=20260914-v2.0.6"></script>\n';
  text = replaceOnce(text, nav, '', 'BEL CRM navigation');
  text = replaceOnce(text, panel, '', 'BEL CRM panel');
  return replaceOnce(text, script, '', 'BEL CRM workspace script');
}

function stripBelScript(value) {
  let text = normalize(value);
  const replacements = [
    ['    "presentation-demo": { label: \'Presentation Demo\', subTabs: [] },\n', ''],
    ["      const allow = main === 'courses' || main === 'presentation-demo' || (main === 'projects' && state.projectsAuthorized);", "      const allow = main === 'courses' || (main === 'projects' && state.projectsAuthorized);"],
    ["        btn.textContent = main === 'projects' ? 'Projects' : main === 'presentation-demo' ? 'Presentation Demo' : 'Teacher Schedule';", "        btn.textContent = main === 'projects' ? 'Projects' : 'Teacher Schedule';"],
    ["      if (id !== 'courses/teacher-schedule' && id !== 'presentation-demo' && !(id === 'projects' && state.projectsAuthorized)) {", "      if (id !== 'courses/teacher-schedule' && !(id === 'projects' && state.projectsAuthorized)) {"],
    ["      const main = String(btn?.dataset?.main || '').trim();\n      const allow = main === 'projects' || main === 'presentation-demo';", "      const allow = String(btn?.dataset?.main || '').trim() === 'projects';"],
    ["      panel.style.display = ['projects', 'presentation-demo'].includes(panel.dataset.panel) ? '' : 'none';", "      panel.style.display = panel.dataset.panel === 'projects' ? '' : 'none';"],
    ["        if (state.accessMode === 'projects' && !['projects', 'presentation-demo'].includes(nextMain)) {", "        if (state.accessMode === 'projects' && nextMain !== 'projects') {"],
    ["    if (state.accessMode === 'projects' && !['projects', 'presentation-demo'].includes(requestedMain)) {", "    if (state.accessMode === 'projects' && requestedMain !== 'projects') {"],
    ["      if (requested === 'presentation-demo') {\n        state.main = 'presentation-demo';\n        state.sub = '';\n      } else if (requested === 'projects' && state.projectsEnabled && state.projectsAuthorized) {", "      if (requested === 'projects' && state.projectsEnabled && state.projectsAuthorized) {"],
    ["    if (state.accessMode === 'projects' && !['projects', 'presentation-demo'].includes(state.main)) {", "    if (state.accessMode === 'projects' && state.main !== 'projects') {"]
  ];
  const teacherRoute = `          if (btn.dataset.main === 'presentation-demo') {\n            state.main = 'presentation-demo';\n            state.sub = '';\n            updateHash();\n            render();\n            return;\n          }\n`;
  for (const [current, original] of replacements) text = replaceOnce(text, current, original, `BEL CRM script change ${current.slice(0, 50)}`);
  return replaceOnce(text, teacherRoute, '', 'BEL teacher presentation route');
}

function walk(relative, entries) {
  const absolute = repoPath(relative);
  for (const item of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = `${relative}/${item.name}`;
    if (item.isSymbolicLink()) throw new Error(`gateway context cannot include a link: ${child}`);
    if (item.isDirectory()) walk(child, entries);
    else if (item.isFile()) entries.add(child);
  }
}

function verifyGatewayContext(manifest) {
  const contract = manifest.gatewayContext;
  const patterns = normalize(fs.readFileSync(repoPath(contract.dockerignore)))
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  assert.deepEqual(patterns, contract.dockerignorePatterns, 'Docker ignore rules differ from the reviewed manifest');

  const files = new Set(contract.includeFiles);
  for (const tree of contract.includeTrees) walk(tree, files);
  for (const excluded of contract.excludeFiles) files.delete(excluded);
  files.add(contract.dockerfile);
  files.add(contract.dockerignore);

  const rows = [...files].sort().map(relative => {
    for (const prefix of contract.forbiddenPrefixes) assert.equal(relative.startsWith(prefix), false, `forbidden gateway path: ${relative}`);
    const value = fs.readFileSync(repoPath(relative));
    return { path: relative, bytes: value.length, sha256: sha256(value) };
  });
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  assert.ok(totalBytes <= contract.maxBytes, `gateway context ${totalBytes} exceeds ${contract.maxBytes}`);
  assert.equal(rows.some(row => row.path.startsWith('public/database/')), false);
  assert.equal(rows.some(row => row.path === 'public/prototypes/bel-working-as-equals-demo/README.md'), false);

  const dockerfile = normalize(fs.readFileSync(repoPath(contract.dockerfile)));
  assert.doesNotMatch(dockerfile, /^COPY public \/app\/public$/m);
  for (const source of contract.includeTrees) assert.ok(dockerfile.includes(`COPY ${source} `), `Dockerfile does not copy ${source}`);
  return { fileCount: rows.length, totalBytes, maxBytes: contract.maxBytes, files: rows };
}

function verifyLocal(manifest, evidence) {
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'release remediation must run on Node 22');
  assert.equal(normalizedSha256(repoPath('firestore.rules')), manifest.firestore.mergedNormalizedSha256);

  const policy = JSON.parse(fs.readFileSync(repoPath('scripts/structure/policy.json'), 'utf8'));
  assert.equal(policy.rootEntries.some(entry => (entry.path || entry) === manifest.governance.path), false);
  const exceptions = policy.exceptions.filter(entry => entry.path === manifest.governance.path && entry.ruleId === manifest.governance.ruleId);
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].approval, manifest.governance.approval);

  const api = manifest.apiLineage;
  for (const [relative, expected] of Object.entries(api.deployedNormalizedHashes)) {
    if (relative === 'functions/src/crm/projects/domain/command-service.js') continue;
    assert.equal(normalizedSha256(repoPath(relative)), expected, `deployed API source changed: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(api.verifiedNewerNormalizedHashes)) {
    assert.equal(normalizedSha256(repoPath(relative)), expected, `verified newer API source changed: ${relative}`);
  }
  for (const [source, output] of Object.entries(api.generatedSourcePairs)) {
    assert.deepEqual(fs.readFileSync(repoPath(source)), fs.readFileSync(repoPath(output)), `${output} differs from canonical ${source}`);
  }
  for (const [relative, markers] of Object.entries(api.walkthroughMarkers)) {
    const source = normalize(fs.readFileSync(repoPath(relative)));
    for (const marker of markers) assert.ok(source.includes(marker), `${relative} misses ${marker}`);
  }
  const sourceZip = path.join(evidence, 'live-api-function-source.zip');
  assert.equal(sha256(fs.readFileSync(sourceZip)), api.sourceZipSha256, 'live API source object changed');

  const htmlBase = fs.readFileSync(path.join(evidence, 'live-hosting-exact-crm-admin.html'));
  const scriptBase = fs.readFileSync(path.join(evidence, 'live-hosting-exact-crm-admin.js'));
  assert.equal(sha256(htmlBase), manifest.hostingOverlay.liveSharedBases['public/crm-admin.html'].rawSha256);
  assert.equal(sha256(scriptBase), manifest.hostingOverlay.liveSharedBases['public/crm-admin.js'].rawSha256);
  assert.equal(sha256(Buffer.from(stripBelHtml(fs.readFileSync(repoPath('public/crm-admin.html'))))), sha256(Buffer.from(normalize(htmlBase))), 'CRM HTML contains a non-BEL delta from live');
  assert.equal(sha256(Buffer.from(stripBelScript(fs.readFileSync(repoPath('public/crm-admin.js'))))), sha256(Buffer.from(normalize(scriptBase))), 'CRM script contains a non-BEL delta from live');

  return {
    node: process.version,
    firestoreNormalizedSha256: normalizedSha256(repoPath('firestore.rules')),
    governanceException: exceptions[0],
    gatewayContext: verifyGatewayContext(manifest),
    apiHashes: Object.fromEntries(Object.keys({ ...api.deployedNormalizedHashes, ...api.verifiedNewerNormalizedHashes }).map(relative => [relative, normalizedSha256(repoPath(relative))])),
    crmSharedHashes: Object.fromEntries(Object.keys(manifest.hostingOverlay.liveSharedBases).map(relative => [relative, sha256(fs.readFileSync(repoPath(relative)))]))
  };
}

async function requestJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-Goog-User-Project': 'listening-tasks-3ae34' } });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function readGcloudAccessToken() {
  const options = { encoding: 'utf8', windowsHide: true };
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], options).trim();
  }
  return execFileSync('gcloud', ['auth', 'print-access-token'], options).trim();
}

async function refreshHosting(manifest, evidence) {
  const site = manifest.hostingOverlay.site;
  const token = readGcloudAccessToken();
  assert.ok(token, 'gcloud access token is unavailable');
  const origin = 'https://firebasehosting.googleapis.com/v1beta1';
  const releases = await requestJson(`${origin}/sites/${site}/releases?pageSize=1`, token);
  const release = releases.releases?.[0];
  assert.ok(release?.version?.name, 'current Hosting release is unavailable');
  const version = await requestJson(`${origin}/${release.version.name}`, token);

  const liveFiles = {};
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const page = await requestJson(`${origin}/${release.version.name}/files?${query}`, token);
    for (const file of page.files || []) liveFiles[file.path] = file.hash;
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  assert.ok(Object.keys(liveFiles).length > 0, 'current Hosting manifest is empty');

  const finalFiles = { ...liveFiles };
  const affected = [];
  for (const relative of manifest.hostingOverlay.candidatePaths) {
    assert.ok(relative.startsWith('public/'), `invalid Hosting candidate path: ${relative}`);
    const hostingPath = `/${relative.slice('public/'.length)}`;
    const raw = fs.readFileSync(repoPath(relative));
    const gzip = zlib.gzipSync(raw, { level: 9 });
    const nextHash = sha256(gzip);
    affected.push({ repoPath: relative, hostingPath, rawBytes: raw.length, rawSha256: sha256(raw), gzipBytes: gzip.length, hostingGzipSha256: nextHash, liveHostingGzipSha256: liveFiles[hostingPath] || null, liveState: liveFiles[hostingPath] ? (liveFiles[hostingPath] === nextHash ? 'MATCH' : 'DIFFERENT') : 'ABSENT' });
    finalFiles[hostingPath] = nextHash;
  }
  const affectedPaths = new Set(affected.map(item => item.hostingPath));
  for (const [livePath, liveHash] of Object.entries(liveFiles)) {
    if (!affectedPaths.has(livePath)) assert.equal(finalFiles[livePath], liveHash, `non-BEL Hosting path changed: ${livePath}`);
  }

  const liveShared = {};
  for (const relative of Object.keys(manifest.hostingOverlay.liveSharedBases)) {
    const hostingPath = `/${relative.slice('public/'.length)}`;
    const value = await fetchBytes(`https://${site}.web.app${hostingPath}`);
    liveShared[hostingPath] = { bytes: value.length, sha256: sha256(value), normalizedSha256: sha256(Buffer.from(normalize(value))) };
    fs.writeFileSync(path.join(evidence, `fresh-live-${path.posix.basename(hostingPath)}`), value);
    const stripped = relative.endsWith('.html') ? stripBelHtml(fs.readFileSync(repoPath(relative))) : stripBelScript(fs.readFileSync(repoPath(relative)));
    assert.equal(sha256(Buffer.from(stripped)), liveShared[hostingPath].normalizedSha256, `${relative} is not based on the current live file`);
  }

  const markerEvidence = {};
  for (const [hostingPath, markers] of Object.entries(manifest.hostingOverlay.preservedLiveMarkers)) {
    assert.equal(affectedPaths.has(hostingPath), false, `walkthrough path must remain outside the BEL overlay: ${hostingPath}`);
    const value = await fetchBytes(`https://${site}.web.app${hostingPath}`);
    const text = normalize(value);
    for (const marker of markers) assert.ok(text.includes(marker), `live walkthrough marker missing from ${hostingPath}: ${marker}`);
    markerEvidence[hostingPath] = { bytes: value.length, rawSha256: sha256(value), hostingGzipSha256: liveFiles[hostingPath], markers };
  }

  const summary = {
    capturedAt: new Date().toISOString(),
    releaseName: release.name,
    versionName: release.version.name,
    versionStatus: version.status,
    liveFileCount: Object.keys(liveFiles).length,
    finalFileCount: Object.keys(finalFiles).length,
    candidateFileCount: affected.length,
    affectedMatches: affected.filter(item => item.liveState === 'MATCH').length,
    affectedDifferent: affected.filter(item => item.liveState === 'DIFFERENT').length,
    affectedAbsent: affected.filter(item => item.liveState === 'ABSENT').length,
    nonBelPathsPreserved: Object.keys(liveFiles).filter(item => !affectedPaths.has(item)).length,
    everyNonBelPathUnchanged: true,
    liveShared,
    walkthroughMarkers: markerEvidence
  };
  fs.writeFileSync(path.join(evidence, 'fresh-live-hosting-release.json'), `${JSON.stringify({ release, version }, null, 2)}\n`);
  fs.writeFileSync(path.join(evidence, 'fresh-live-hosting-files.json'), `${JSON.stringify({ versionName: release.version.name, files: liveFiles }, null, 2)}\n`);
  fs.writeFileSync(path.join(evidence, 'final-hosting-overlay-files.json'), `${JSON.stringify({ baseVersion: release.version.name, files: finalFiles }, null, 2)}\n`);
  fs.writeFileSync(path.join(evidence, 'final-hosting-affected-files.json'), `${JSON.stringify({ summary, files: affected }, null, 2)}\n`);
  fs.writeFileSync(path.join(evidence, 'recent-deployment-delta-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  const evidenceIndex = process.argv.indexOf('--evidence');
  assert.ok(evidenceIndex >= 0 && process.argv[evidenceIndex + 1], '--evidence requires an external directory');
  const evidence = path.resolve(process.argv[evidenceIndex + 1]);
  assert.equal(evidence === ROOT || evidence.startsWith(`${ROOT}${path.sep}`), false, 'evidence must remain outside the repository');
  fs.mkdirSync(evidence, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const local = verifyLocal(manifest, evidence);
  fs.writeFileSync(path.join(evidence, 'gateway-context-manifest.json'), `${JSON.stringify(local.gatewayContext, null, 2)}\n`);
  const hosting = process.argv.includes('--refresh-hosting') ? await refreshHosting(manifest, evidence) : null;
  const report = { schemaVersion: 1, verifiedAt: new Date().toISOString(), manifestSha256: sha256(fs.readFileSync(MANIFEST_PATH)), local, hosting };
  fs.writeFileSync(path.join(evidence, 'remediation-verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, manifestSha256: report.manifestSha256, gatewayContext: { fileCount: local.gatewayContext.fileCount, totalBytes: local.gatewayContext.totalBytes }, hosting }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
