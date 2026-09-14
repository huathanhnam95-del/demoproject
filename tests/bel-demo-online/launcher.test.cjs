const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const crmHtml = fs.readFileSync('public/crm-admin.html', 'utf8');
const crmJs = fs.readFileSync('public/crm-admin.js', 'utf8');
const entry = fs.readFileSync('public/presentation-demo/index.html', 'utf8');
const legacy = fs.readFileSync('public/prototypes/bel-working-as-equals-demo/index.html', 'utf8');

test('CRM exposes the authenticated Presentation Demo route and popup entry', () => {
  assert.match(crmHtml, /data-main="presentation-demo"/);
  assert.match(crmHtml, /data-panel="presentation-demo"/);
  assert.match(crmHtml, /presentation-demo-workspace\.js/);
  assert.match(crmJs, /presentation-demo/);
});

test('online entry has presenter gate, room-code join and separate game-tab controls', () => {
  assert.match(entry, /id="pd-presenter-tools"[^>]+hidden/);
  assert.match(entry, /id="pd-join-form"/);
  assert.match(entry, /id="pd-room-code"/);
  assert.match(entry, /id="pd-open-game"/);
  assert.match(entry, /id="pd-deck"/);
  assert.match(entry, /type="module" src="\/js\/presentation-demo\/app\.mjs"/);
});

test('legacy prototype only redirects when the server feature flag is active', () => {
  assert.match(legacy, /api\/config/);
  assert.match(legacy, /presentationDemoOnline/);
  assert.match(legacy, /presentation-demo\/index\.html/);
  assert.match(legacy, /id="create-session"/);
});
