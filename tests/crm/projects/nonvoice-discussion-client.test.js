'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/discussion.js'), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  let actor = 'alice', handler;
  const calls = [], posts = [];
  const rows = Array.from({ length: 65 }, (_, i) => ({ id: `m${i}`, body: `update ${i}`, authorUid: actor }));
  function element() { return { value: '', disabled: false, selectionStart: 0, selectionEnd: 0, innerHTML: '', listeners: {}, classList: { toggle() {} }, addEventListener(n, f) { this.listeners[n] = f; }, focus() {}, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }, querySelectorAll() { return []; }, insertAdjacentHTML(where, html) { this.innerHTML = where === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html; } }; }
  const elements = Object.fromEntries(['Input', 'Form', 'List', 'Status', 'History', 'Retry', ''].map(k => [`projectsBoardDiscussion${k}`, element()]));
  const context = { URLSearchParams, document: { getElementById: () => null } };
  vm.runInNewContext(source, context);
  const controller = context.CrmProjectsDiscussion.createController({ elements, getCurrentUser: () => ({ uid: actor }), apiFetchJson: async (url, options) => {
    calls.push(url);
    if (url.includes('member-directory')) return { people: [] };
    if (options?.method === 'POST') { const body = JSON.parse(options.body); posts.push(body); if (handler) return handler(url, options); const message = { id: `m${rows.length}`, ...body, authorUid: actor }; rows.push(message); return { message }; }
    if (handler) return handler(url, options);
    const query = new URLSearchParams(url.split('?')[1]);
    const ordered = query.get('order') === 'desc' ? rows.slice().reverse() : rows.slice();
    const start = Number(query.get('cursor') || 0), pageSize = Number(query.get('pageSize'));
    return { messages: ordered.slice(start, start + pageSize), hasMore: start + pageSize < rows.length, nextCursor: start + pageSize < rows.length ? String(start + pageSize) : null };
  } });
  controller.init();
  const select = (taskId = 'a', projectId = 'p', role = 'Editor') => controller.setSelection({ projectId, taskId, role });
  const input = elements.projectsBoardDiscussionInput;
  return { controller, elements, calls, posts, input, select, actor: value => { actor = value; }, handle: fn => { handler = fn; }, draft(value) { input.value = value; input.listeners.input(); }, click(key, value = '') { elements.projectsBoardDiscussionList.listeners.click({ target: { closest: selector => selector === `[data-discussion-${key}]` ? { disabled: false, dataset: { discussionReply: value } } : null } }); }, send: () => elements.projectsBoardDiscussionForm.listeners.submit({ preventDefault() {} }) };
}
test('long conversations retain loaded updates when a newest message arrives and append older rows', async () => {
  const h = harness(); h.select(); await tick(); h.draft('newest update'); await h.send();
  assert.equal(h.controller.getState().messages[0].body, 'newest update');
  assert.equal(h.controller.getState().messages.length, 51);
  assert.ok(h.controller.getState().messages.some(message => message.id === 'm15'), 'oldest previously loaded update survives the newest message');
  assert.match(h.elements.projectsBoardDiscussionList.innerHTML, /Load older updates/);
  await h.controller.refresh({ append: true });
  assert.equal(new Set(h.controller.getState().messages.map(m => m.id)).size, 66);
});
test('reply target, text and caret survive task navigation and posting settles the matching draft', async () => {
  const h = harness(); h.select(); await tick(); h.click('reply', 'm64'); h.draft('reply draft'); h.input.setSelectionRange(2, 6);
  h.select('b'); await tick(); h.select(); await tick();
  assert.equal(h.input.value, 'reply draft'); assert.equal(h.input.selectionStart, 2); assert.equal(h.input.selectionEnd, 6);
  assert.match(h.elements.projectsBoardDiscussionList.innerHTML, /Replying to/);
  await h.send(); assert.equal(h.posts[0].parentMessageId, 'm64'); assert.equal(h.input.value, '');
  assert.doesNotMatch(h.elements.projectsBoardDiscussionList.innerHTML, /Replying to/);
});
test('reply cancellation keeps text and is isolated by actor, project and task', async () => {
  const h = harness(); h.select(); await tick(); h.click('reply', 'm64'); h.draft('alice draft');
  h.actor('bob'); h.select(); await tick(); assert.equal(h.input.value, ''); assert.ok(!h.elements.projectsBoardDiscussionList.innerHTML.includes('Replying to'));
  h.draft('bob draft'); h.click('reply', 'm63');
  h.actor('alice'); h.select('a', 'other'); await tick(); assert.equal(h.input.value, '');
  h.select(); await tick(); assert.equal(h.input.value, 'alice draft');
  h.click('cancel-reply'); assert.equal(h.input.value, 'alice draft');
  h.select('b'); h.select(); await tick(); await h.send(); assert.equal(h.posts[0].parentMessageId, null);
  h.actor('bob'); h.select(); await tick(); await h.send(); assert.equal(h.posts[1].parentMessageId, 'm63');
});
test('late mutation settlement preserves a newer draft after navigating away and back', async () => {
  const h = harness(); h.select(); await tick(); h.click('reply', 'm64'); h.draft('submitted');
  const held = deferred(); h.handle((_url, options) => options?.method === 'POST' ? held.promise : Promise.resolve({ messages: [], hasMore: false }));
  const sending = h.send(); h.select('b'); h.select(); h.draft('newer text');
  held.resolve({ message: { id: 'saved' } }); await sending;
  assert.equal(h.input.value, 'newer text'); assert.match(h.elements.projectsBoardDiscussionList.innerHTML, /Replying to the selected update/);
  h.handle(null); await h.send(); assert.equal(h.posts[1].body, 'newer text'); assert.equal(h.posts[1].parentMessageId, 'm64');
});
test('old task and old authority responses cannot replace the selected conversation', async () => {
  const h = harness(); h.select(); await tick(); const held = deferred(); h.handle(() => held.promise);
  const loading = h.controller.refresh(); h.select('b'); h.handle(null); await h.controller.refresh();
  held.resolve({ messages: [{ id: 'stale', body: 'stale' }], hasMore: false }); await loading; await tick();
  assert.ok(!h.controller.getState().messages.some(m => m.id === 'stale'));
  const authority = deferred(); h.handle(() => authority.promise); const old = h.controller.refresh();
  h.select('b', 'p', 'Viewer'); h.handle(null); await h.controller.refresh();
  authority.resolve({ messages: [{ id: 'secret', body: 'old owner response' }] }); await old; await tick();
  assert.ok(!h.controller.getState().messages.some(m => m.id === 'secret')); assert.equal(h.input.disabled, true);
});
