'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { inspectSource, inspectOrigin } = require('../../scripts/release/verify-entrance-test-ui.cjs');

test('selected Hosting source contains D and its runtime dependencies', () => {
  const result = inspectSource(path.resolve(__dirname, '../..'));
  assert.deepEqual(result.failures, []);
  assert.ok(result.files['entrance-test-ui/index.html']);
  assert.ok(result.files['js/entrance-test-ui/app.js']);
  assert.ok(result.files['fonts/entrance-test-ui/NotoSans-Variable-vietnamese.woff2']);
});

test('a missing D selector or fallback HTML cannot pass the release preflight', async () => {
  const sourceRoot = path.resolve(__dirname, '../..');
  const source = inspectSource(sourceRoot);
  assert.deepEqual(source.failures, []);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'etui-release-'));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Main site fallback</title>');
  });
  try {
    for (const name of Object.keys(source.files)) {
      const from = path.join(sourceRoot, 'public', name);
      const to = path.join(temp, 'public', name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    const evaluator = path.join(temp, 'public/js/crm/entrance-test-ui-lab.js');
    fs.writeFileSync(evaluator, fs.readFileSync(evaluator, 'utf8').replace("id: 'd', label: 'D · Signal Noto'", "id: 'b', label: 'B · Instrument'"));
    assert.match(inspectSource(temp).failures.join('\n'), /D selector missing/);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const served = await inspectOrigin(`http://127.0.0.1:${server.address().port}`, {
      'entrance-test-ui/index.html': source.files['entrance-test-ui/index.html'],
      'css/entrance-test-ui.css': source.files['css/entrance-test-ui.css']
    });
    assert.equal(served.checked.length, 0);
    assert.match(served.failures.join('\n'), /served bytes differ|wrong content type/);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
