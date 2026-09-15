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

test('CRM shell starts from fully parsed markup without waiting for unrelated deferred assets', () => {
  const finalMarkup = html.indexOf('id="crm-books-elaborate-tray"');
  const shellScript = html.indexOf('src="crm-admin.js');
  const bodyEnd = html.indexOf('</body>');

  assert.ok(finalMarkup >= 0, 'Expected final CRM modal markup');
  assert.ok(shellScript > finalMarkup, 'crm-admin.js must run after the final CRM markup');
  assert.ok(shellScript < bodyEnd, 'crm-admin.js must run before the closing body tag');
  for (const deferredAsset of [
    'https://unpkg.com/wavesurfer.js@7.12.6',
    'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js',
    'js/crm/segmentation-study.js'
  ]) {
    assert.ok(shellScript < html.indexOf(deferredAsset), `crm-admin.js must start before deferred asset ${deferredAsset}`);
  }
  assert.doesNotMatch(shell, /document\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*{\s*cacheElements\(\)/);
  assert.match(shell, /function startCrmAdmin\(\)/);
  assert.match(shell, /startCrmAdmin\(\);/);
});

test('CRM shell renders the requested hash route before hiding the access gate', () => {
  const initStart = shell.indexOf('async function init()');
  const initEnd = shell.indexOf('async function initFirebaseFromServer()');
  const initSource = shell.slice(initStart, initEnd);
  const routeIndex = initSource.indexOf('applyRouteFromHash({ initial: true })');
  const renderIndex = initSource.indexOf('render();', routeIndex);
  const hideGateIndex = initSource.indexOf('hideGate();');

  assert.ok(routeIndex >= 0, 'Expected initial hash routing in init');
  assert.ok(renderIndex > routeIndex, 'Expected render after initial hash routing');
  assert.ok(hideGateIndex > renderIndex, 'Gate must remain visible until the requested route has rendered');
});
