import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../public/crm-admin.html', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../../public/crm-admin.js', import.meta.url), 'utf8');
const host = fs.readFileSync(new URL('../../public/js/crm/entrance-test-ui-lab.js', import.meta.url), 'utf8');

test('Entrance Test evaluator exposes the approved fourth Demo D skin', () => {
  assert.match(host, /id: 'd', label: 'D · Signal Noto'/);
  assert.match(host, /return '\/entrance-test-ui\/\?revisionId=academic-noto-v1'/);
});

test('CRM shell executes before optional CDN scripts while preserving its deferred dependencies', () => {
  const evaluatorScript = html.indexOf('src="js/crm/entrance-test-ui-lab.js');
  const shellScript = html.indexOf('src="crm-admin.js');
  const segmentationScript = html.indexOf('src="js/crm/segmentation-study.js');
  const bodyEnd = html.indexOf('</body>');

  assert.ok(evaluatorScript >= 0 && evaluatorScript < shellScript, 'Evaluator must register before the CRM shell');
  assert.ok(segmentationScript > shellScript, 'Segmentation module must remain registered after the shell');
  assert.ok(shellScript < bodyEnd, 'crm-admin.js must run before the closing body tag');
  assert.match(html.slice(shellScript, shellScript + 130), /defer><\/script>/, 'CRM shell must execute after parsing');
  for (const deferredAsset of [
    'https://unpkg.com/wavesurfer.js@7.12.6',
    'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js',
    'js/crm/segmentation-study.js'
  ]) {
    assert.ok(segmentationScript < html.indexOf(deferredAsset), `Optional CDN ${deferredAsset} must follow local CRM modules`);
  }
  assert.match(shell, /if \(document\.readyState === 'loading'\)[\s\S]*?else \{\s*onReady\(\);/, 'Deferred shell must start at interactive ready state without waiting for CDN scripts');
});

test('CRM shell validates access before applying and rendering the requested hash route', () => {
  const initStart = shell.indexOf('async function init()');
  const initEnd = shell.indexOf('async function initFirebaseFromServer()');
  const initSource = shell.slice(initStart, initEnd);
  const authIndex = initSource.indexOf('const adminOk = await isAdminUser(user)');
  const deniedIndex = initSource.indexOf("showGateMessage('Access denied.'");
  const routeIndex = initSource.indexOf('applyRouteFromHash({ initial: true })');
  const renderIndex = initSource.indexOf('render();', routeIndex);

  assert.ok(authIndex >= 0 && authIndex < routeIndex, 'Administrator validation must precede routing');
  assert.ok(deniedIndex > authIndex && deniedIndex < routeIndex, 'Denied users must be handled before routing');
  assert.ok(routeIndex >= 0, 'Expected initial hash routing in init');
  assert.ok(renderIndex > routeIndex, 'Expected render after initial hash routing');
});
