'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { compileRows, parseRmcsaAnswer } = require('../../scripts/performance/rmcsa-content-core.cjs');
const { scalar } = require('../../scripts/performance/publish-rmcsa.cjs');
const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function row(id = 1) {
  return { ID: id, TITLE: 'Học cùng BEL', ANSWER: 'A passage.\n---\nWhat is true?\n---\n[ ] Wrong\n[X] Correct', EXPLANATION: '<p>Evidence: “correct”.</p>' };
}

test('compiler preserves text and checkbox semantics', () => {
  const result = compileRows([row()]);
  assert.equal(result.bank.questions[0].title, 'Học cùng BEL');
  assert.equal(result.bank.questions[0].choices[1].isCorrect, true);
  assert.equal(result.bank.questions[0].explanation, row().EXPLANATION);
  assert.equal(result.manifest.bytes, result.bytes.length);
});
test('compiler is deterministic, sorted and content addressed', () => {
  const a = compileRows([row(2), row(1)]);
  const b = compileRows([row(1), row(2)]);
  assert.equal(a.hash, b.hash);
  assert.ok(a.bytes.equals(b.bytes));
  assert.match(a.manifest.url, /^\/content\/rmcsa\/rmcsa\.[a-f0-9]{64}\.json$/);
  assert.notEqual(compileRows([{ ...row(), TITLE: 'Changed' }]).hash, a.hash);
});
test('compiler rejects invalid IDs, duplicates and bad answer count', () => {
  assert.throws(() => compileRows([row(0)]), /invalid ID/);
  assert.throws(() => compileRows([row(1), row(1)]), /duplicate/);
  assert.throws(() => compileRows([{ ...row(), ANSWER: row().ANSWER.replace('[ ]', '[x]') }]), /exactly one/);
  assert.throws(() => compileRows([]), /no data/);
});
test('legacy delimiter grammar supports CRLF and inline separators', () => {
  assert.equal(parseRmcsaAnswer(row().ANSWER.replace(/\n/g, '\r\n')).choices.length, 2);
  assert.equal(parseRmcsaAnswer('Text---Question---[x] yes\n[ ] no').question, 'Question');
});
test('Excel cell normalizer preserves rich text and rejects uncached formula', () => {
  assert.equal(scalar({ richText: [{ text: 'Học ' }, { text: 'BEL' }] }, 'A1'), 'Học BEL');
  assert.equal(scalar({ formula: '1+1', result: 2 }, 'A1'), 2);
  assert.throws(() => scalar({ formula: '1+1' }, 'A1'), /no cached result/);
});

function clientWith(fetchImpl) {
  const context = { fetch: fetchImpl, crypto: webcrypto, AbortController, DOMException,
    TextDecoder, Uint8Array, setTimeout, clearTimeout, console };
  context.window = context;
  vm.runInNewContext(source('public/js/rmcsa-content.js'), context);
  return context.BELRmcsaContent;
}
function responder(published, intercept = () => null) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const override = intercept(url, calls.length);
    if (override) return override;
    const body = url.endsWith('/manifest.json') ? published.manifestText : published.bytes;
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}
test('content client coalesces concurrent requests and pins a validated bank', async () => {
  const published = compileRows([row()]);
  const mock = responder(published);
  const client = clientWith(mock.fetchImpl);
  const [a, b] = await Promise.all([client.load(), client.load()]);
  assert.equal(a, b);
  assert.equal(mock.calls.length, 2);
  assert.equal(await client.load(), a);
  assert.equal(mock.calls.length, 2);
  assert.ok(Object.isFrozen(a.questions[0].choices));
  assert.equal(mock.calls[0].options.cache, 'no-cache');
});
test('failed content request is evicted so a user retry can recover', async () => {
  const mock = responder(compileRows([row()]), (_, call) => call === 1 ? new Response('unavailable', { status: 503 }) : null);
  const client = clientWith(mock.fetchImpl);
  await assert.rejects(client.load(), error => error.code === 'HTTP');
  assert.equal((await client.load()).questions[0].id, 1);
  assert.equal(mock.calls.length, 3);
});
test('HTML fallback is not mistaken for valid question content', async () => {
  const client = clientWith(async () => new Response('<html>shell</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(client.load(), error => error.code === 'CONTENT_TYPE');
});
test('content corruption is rejected', async () => {
  const published = compileRows([row()]);
  const mock = responder(published, url => url.endsWith('/manifest.json') ? null :
    new Response(Buffer.from(published.bytes.toString().replace('Correct', 'Corrupt')), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(clientWith(mock.fetchImpl).load(), error => ['HASH', 'SIZE'].includes(error.code));
});
test('external manifest URL is rejected before fetching a bank', async () => {
  const published = compileRows([row()]);
  const manifest = { ...published.manifest, url: 'https://example.invalid/bank.json' };
  let calls = 0;
  const client = clientWith(async () => { calls++; return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }); });
  await assert.rejects(client.load(), error => error.code === 'MANIFEST');
  assert.equal(calls, 1);
});
test('one cancelled caller does not poison another shared load', async () => {
  const mock = responder(compileRows([row()]));
  const client = clientWith(mock.fetchImpl);
  const controller = new AbortController();
  const first = client.load({ signal: controller.signal });
  const second = client.load();
  controller.abort();
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal((await second).questions[0].id, 1);
  assert.equal(mock.calls.length, 2);
});

function bootFixture({ warm = false, brokenStorage = false, readyState = 'loading' } = {}) {
  function element() {
    const classes = new Set();
    return { hidden: false, style: {}, dataset: {}, attributes: {}, children: [],
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector() { return null; }, append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; }, addEventListener() {} };
  }
  const ids = Object.fromEntries(['app-preloader', 'preloader-text', 'page-layout-wrapper', 'preloader-text-fill-wrapper'].map(id => [id, element()]));
  const listeners = {};
  const timers = new Map();
  let nextTimer = 1;
  const document = { readyState, body: element(), documentElement: element(),
    getElementById: id => ids[id] || null, createElement: element,
    addEventListener(name, fn) { listeners[name] = fn; } };
  const context = { document, sessionStorage: {
    getItem() { if (brokenStorage) throw new Error('Storage denied'); return warm ? '1' : null; },
    setItem() { if (brokenStorage) throw new Error('Storage denied'); }
  }, setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: false }), location: { reload() {} } };
  context.window = context;
  vm.runInNewContext(source('public/js/preloader-2d.js'), context);
  return { context, ids, document, fireDom() { document.readyState = 'complete'; listeners.DOMContentLoaded?.(); },
    fireTimers() { for (const fn of [...timers.values()]) fn(); } };
}
test('preloader accepts readiness before DOMContentLoaded', () => {
  const fixture = bootFixture();
  fixture.context.finishBelPreloader();
  fixture.fireDom();
  assert.equal(fixture.ids['app-preloader'].style.display, 'none');
  assert.equal(fixture.document.documentElement.dataset.bootStatus, 'ready');
});
test('preloader closes immediately after real readiness without a minimum floor', () => {
  const fixture = bootFixture(); fixture.fireDom();
  fixture.context.BELBoot.shellReady();
  assert.equal(fixture.ids['app-preloader'].style.display, 'none');
});
test('preloader watchdog is not a success signal', () => {
  const fixture = bootFixture(); fixture.fireDom(); fixture.fireTimers();
  assert.equal(fixture.context.BELBoot.getState(), 'loading');
  assert.equal(fixture.document.documentElement.dataset.bootStatus, 'loading');
  assert.equal(fixture.ids['preloader-text'].children[1].textContent, 'Retry loading');
});
test('warm branding skip does not claim task or shell readiness', () => {
  const fixture = bootFixture({ warm: true }); fixture.fireDom();
  assert.equal(fixture.ids['app-preloader'].style.display, 'none');
  assert.equal(fixture.context.BELBoot.getState(), 'loading');
});
test('blocked session storage does not break preloader', () => {
  const fixture = bootFixture({ brokenStorage: true }); fixture.fireDom(); fixture.context.BELBoot.shellReady();
  assert.equal(fixture.context.BELBoot.getState(), 'ready');
});
test('late loading of the preloader initializes without another DOM event', () => {
  const fixture = bootFixture({ readyState: 'complete' }); fixture.context.BELBoot.shellReady();
  assert.equal(fixture.ids['app-preloader'].hidden, true);
});
test('performance records end once and remain bounded', () => {
  let now = 100;
  const context = { performance: { now: () => ++now, measure() {}, clearMeasures() {} } };
  context.window = context;
  vm.runInNewContext(source('public/js/bel-performance.js'), context);
  const end = context.BELPerf.begin('rmcsa:activate'); end(); end();
  assert.equal(context.BELPerf.snapshot().length, 1);
  for (let i = 0; i < 300; i++) context.BELPerf.begin('rmcsa:content')();
  assert.equal(context.BELPerf.snapshot().length, 250);
  context.BELPerf.begin('unapproved-answer-text')();
  assert.equal(context.BELPerf.snapshot().length, 250);
});

test('lazy loader supportsMode matches managed modes and ensures stylesheets before anchor', async () => {
  let insertedBefore = null;
  const createdElements = [];
  const anchor = { nodeName: 'META', name: 'bel-mode-styles-end', before: el => { insertedBefore = el; } };
  const doc = {
    baseURI: 'https://example.com/app/',
    readyState: 'complete',
    querySelectorAll: selector => {
      if (selector === 'link[rel="stylesheet"]') return createdElements;
      return [];
    },
    querySelector: selector => {
      if (selector === 'meta[name="bel-mode-styles-end"]') return anchor;
      return null;
    },
    createElement: tag => {
      const el = {
        tag,
        dataset: {},
        listeners: {},
        addEventListener(name, fn) { this.listeners[name] = fn; },
        removeEventListener(name, fn) { delete this.listeners[name]; }
      };
      createdElements.push(el);
      return el;
    }
  };
  const context = {
    document: doc,
    window: {},
    URL,
    setTimeout: (fn, ms) => {},
    clearTimeout: () => {}
  };
  context.window = context;
  vm.runInNewContext(source('public/js/lazy-loader.js'), context);
  const loader = context.window.BELLazyLoader;
  assert.equal(loader.supportsMode('read-aloud'), true);
  assert.equal(loader.supportsMode('rmcsa'), true);
  assert.equal(loader.supportsMode('unmanaged-mode'), false);

  const stylePromise = loader.ensureStylesheet('/rmcsa-mode.css');
  assert.equal(createdElements.length, 1);
  assert.equal(insertedBefore, createdElements[0]);
  createdElements[0].sheet = {};
  createdElements[0].listeners.load();
  await stylePromise;
});
