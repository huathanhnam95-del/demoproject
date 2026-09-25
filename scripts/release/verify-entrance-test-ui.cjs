'use strict';

// Verify the exact D files selected for a Hosting package. With --origin,
// compare the served bytes as well, so an SPA fallback cannot pass as Demo D.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REQUIRED = [
  'crm-admin.html',
  'entrance-test-ui/index.html',
  'entrance-test-ui-lab.html',
  'css/entrance-test-ui.css',
  'css/entrance-test-ui-annotations.css',
  'fonts/entrance-test-ui/noto-sans.css',
  'fonts/entrance-test-ui/NotoSans-Variable-latin.woff2',
  'fonts/entrance-test-ui/NotoSans-Variable-latin-ext.woff2',
  'fonts/entrance-test-ui/NotoSans-Variable-vietnamese.woff2',
  'js/entrance-test-ui-fonts.js',
  'js/audio-dsp-pipeline.js',
  'js/media-url-resolver.js',
  'media-release.json',
  'js/crm/entrance-test-ui-lab.js',
  'js/crm/entrance-test-ui/annotations-controller.js',
  'js/crm/entrance-test-ui/annotations-store.js',
  ...[
    'annotation-anchors', 'annotation-model', 'annotation-overlay', 'app',
    'audio', 'copy', 'demo-data', 'persistence', 'qa', 'state', 'view'
  ].map(name => `js/entrance-test-ui/${name}.js`)
];

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function mimeFor(name) {
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.woff2')) return 'font/woff2';
  if (name.endsWith('.json')) return 'application/json';
  return 'javascript';
}

function inspectSource(root) {
  const publicRoot = path.resolve(root, 'public');
  const files = {};
  const failures = [];
  for (const name of REQUIRED) {
    const location = path.resolve(publicRoot, name);
    if (!location.startsWith(publicRoot + path.sep) || !fs.existsSync(location)) {
      failures.push(`Missing D dependency: ${name}`);
      continue;
    }
    const bytes = fs.readFileSync(location);
    if (!bytes.length) failures.push(`Empty D dependency: ${name}`);
    files[name] = { bytes, sha256: sha256(bytes), mime: mimeFor(name) };
  }
  const source = name => files[name]?.bytes.toString('utf8') || '';
  const requireText = (name, pattern, purpose) => {
    if (!pattern.test(source(name))) failures.push(`${name}: ${purpose}`);
  };
  requireText('crm-admin.html', /css\/entrance-test-ui-annotations\.css/, 'annotation CSS reference missing');
  requireText('crm-admin.html', /js\/crm\/entrance-test-ui-lab\.js/, 'evaluator script reference missing');
  requireText('crm-admin.html', /projectsV2:\s*projectsV2Query\s*!==\s*'0'/, 'current Projects V2 default missing');
  requireText('js/crm/entrance-test-ui-lab.js', /id:\s*'d',\s*label:\s*'D · Signal Noto'/, 'D selector missing');
  requireText('js/crm/entrance-test-ui-lab.js', /\/entrance-test-ui\/\?revisionId=academic-noto-v1/, 'D frame route missing');
  requireText('entrance-test-ui/index.html', /<main id="et-app"/, 'D app shell missing');
  requireText('entrance-test-ui/index.html', /src="\.\.\/js\/entrance-test-ui\/app\.js"/, 'D module entry missing');
  requireText('entrance-test-ui/index.html', /src="\.\.\/js\/media-url-resolver\.js"/, 'media resolver dependency missing');
  requireText('js/entrance-test-ui/app.js', /MediaUrlResolver/, 'catalog-based listening playback missing');
  requireText('js/entrance-test-ui/audio.js', /AudioDspPipeline\?\.enhance/, 'recording DSP dependency missing');
  requireText('js/entrance-test-ui/view.js', /data-logical-src=/, 'logical listening source missing');
  requireText('css/entrance-test-ui.css', /\.et-app/, 'D stylesheet content missing');
  try {
    const media = JSON.parse(source('media-release.json'));
    if (media.modes?.['Entrance-Test']?.state !== 'remote-only' || !media.modes['Entrance-Test'].shardKey) {
      failures.push('Entrance-Test media catalog configuration missing');
    }
  } catch { failures.push('Invalid media-release.json'); }
  return { files, failures };
}

async function inspectOrigin(origin, files) {
  const failures = [];
  const checked = [];
  for (const [name, expected] of Object.entries(files)) {
    const route = name === 'entrance-test-ui/index.html' ? 'entrance-test-ui/' : name;
    const url = new URL(route, origin.endsWith('/') ? origin : origin + '/');
    url.searchParams.set('etui_preflight', expected.sha256.slice(0, 12));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      const contentType = response.headers.get('content-type') || '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) failures.push(`${route}: HTTP ${response.status}`);
      else if (!contentType.toLowerCase().includes(expected.mime)) failures.push(`${route}: wrong content type ${contentType}`);
      else if (sha256(bytes) !== expected.sha256) failures.push(`${route}: served bytes differ from selected source`);
      else checked.push(route);
    } catch (error) { failures.push(`${route}: ${error.message}`); }
  }
  return { checked, failures };
}

async function main(args = process.argv.slice(2)) {
  let root = process.cwd();
  let origin = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = args[++i];
    else if (args[i] === '--origin') origin = args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!root || (args.includes('--origin') && !origin)) throw new Error('Missing --root or --origin value');
  const source = inspectSource(root);
  const served = origin && !source.failures.length ? await inspectOrigin(origin, source.files) : { checked: [], failures: [] };
  const report = {
    ok: source.failures.length === 0 && served.failures.length === 0,
    root: path.resolve(root), origin: origin || null,
    files: Object.fromEntries(Object.entries(source.files).map(([name, value]) => [name, value.sha256])),
    served: served.checked, failures: [...source.failures, ...served.failures]
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 2; });
module.exports = { inspectSource, inspectOrigin, main };
