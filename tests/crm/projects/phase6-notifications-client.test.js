'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/notifications.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const item = (id = 'n1', available = true) => ({ notificationId: id, projectId: 'p1', category: 'assignment', createdAt: '2026-09-07', available, read: false, message: 'Private update', taskLabel: 'Private task', href: '/untrusted' });
function harness(root) {
  let navigation = 0;
  let actor = 'u1', handler = async () => ({ items: [item()], hasMore: false });
  const calls = [], opened = [], context = { URLSearchParams, console };
  vm.runInNewContext(source, context);
  const controller = context.CrmProjectsNotifications.createController({ root, getNavigationGeneration: () => navigation, getCurrentUser: () => ({ uid: actor }), apiFetchJson: async (url, options) => { calls.push({ url, options }); return handler(url, options); }, openTarget: async (target, current) => { if (current()) opened.push(target); } });
  controller.setAccount(actor); controller.setProjects([{ id: 'p1', name: 'Project' }]);
  return { controller, calls, opened, navigate: () => { navigation++; }, handle: (fn) => { handler = fn; }, account: (value) => { actor = value; controller.setAccount(value); } };
}
test('authorized feed pages deduplicate and cursor is scoped to current filters', async () => {
  const h = harness(); let page = 0;
  h.handle(async () => ++page === 1 ? { items: [item()], nextCursor: 'scope token', hasMore: true } : { items: [item(), item('n2')], hasMore: false });
  await h.controller.setFilters({ projectId: 'p1', category: 'assignment', unread: 'true' }); await h.controller.refresh(true);
  assert.equal(h.controller.getState().items.length, 2);
  assert.match(h.calls[1].url, /projectId=p1&category=assignment&unread=true&cursor=scope\+token/);
  assert.equal(h.controller.getState().cursor, null);
});
test('held old filter response cannot replace newer feed; tombstone discards labels and href', async () => {
  const h = harness(), held = deferred(); h.handle(() => held.promise);
  const first = h.controller.refresh(); h.handle(async () => ({ items: [item('safe', false)] }));
  await h.controller.setFilters({ category: 'deadline' }); held.resolve({ items: [item('old')] }); await first;
  const state = h.controller.getState(); assert.equal(state.items[0].notificationId, 'safe');
  assert.equal(state.items[0].message, undefined); assert.equal(state.items[0].taskLabel, undefined); assert.equal(state.items[0].href, undefined);
});
test('account switch clears feed and preferences and drops all held responses', async () => {
  const h = harness(), feed = deferred(), prefs = deferred();
  h.handle((url) => url.includes('preferences') ? prefs.promise : feed.promise);
  const a = h.controller.refresh(), b = h.controller.loadPreferences(); h.account('u2');
  feed.resolve({ items: [item()] }); prefs.resolve({ revision: 4, muted: [{ projectId: 'p1', category: 'assignment' }] }); await Promise.all([a, b]);
  assert.equal(h.controller.getState().items.length, 0); assert.equal(h.controller.getState().draft.length, 0); assert.equal(h.controller.getState().revision, null);
});
test('project denial invalidates held target, preferences and feed callbacks', async () => {
  const h = harness(); await h.controller.refresh(); const held = deferred(); h.handle(() => held.promise);
  const target = h.controller.open('n1'), prefs = h.controller.loadPreferences(); h.controller.deny('p1');
  held.resolve({ available: true, projectId: 'p1', taskId: 't1', revision: 2, muted: [{ projectId: 'p1', category: 'assignment' }] }); await Promise.all([target, prefs]);
  assert.equal(h.opened.length, 0); assert.equal(h.controller.getState().items.length, 0); assert.equal(h.controller.getState().draft.length, 0);
});
test('read failure preserves previous state; acknowledgement wins over a held feed', async () => {
  const h = harness(); await h.controller.refresh(); h.handle(async () => { throw new Error('offline'); });
  await h.controller.setRead('n1', true); assert.equal(h.controller.getState().items[0].read, false);
  const read = deferred(), feed = deferred(); h.handle((url, options) => options ? read.promise : feed.promise);
  const a = h.controller.setRead('n1', true), b = h.controller.refresh(); read.resolve({ notificationId: 'n1', read: true }); await a;
  feed.resolve({ items: [item()] }); await b;
  assert.equal(h.controller.getState().items.length, 0); // Refresh cleared feed; stale server snapshot is never republished.
});
test('read mutation after account switch and forbidden response cannot leak content', async () => {
  const h = harness(); await h.controller.refresh(); const held = deferred(); h.handle(() => held.promise);
  const pending = h.controller.setRead('n1', true); h.account('u2'); held.resolve({ read: true }); await pending;
  assert.equal(h.controller.getState().items.length, 0);
  h.handle(async () => ({ items: [item()] })); await h.controller.refresh(); h.handle(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); });
  await h.controller.setRead('n1', true); assert.equal(h.controller.getState().items.length, 0);
});
test('target is resolved on each open and unavailable target drops cached sensitive labels', async () => {
  const h = harness(); await h.controller.refresh(); h.handle(async () => ({ available: false, taskLabel: 'stale', projectId: 'p1' }));
  await h.controller.open('n1'); assert.equal(h.opened.length, 0); assert.equal(h.controller.getState().items[0].taskLabel, undefined);
  h.handle(async () => ({ items: [item()] })); await h.controller.refresh();
  h.handle(async () => ({ available: true, projectId: 'p1', taskId: 't1', messageId: 'm1', href: '/evil' }));
  await h.controller.open('n1'); assert.deepEqual(JSON.parse(JSON.stringify(h.opened)), [{ projectId: 'p1', taskId: 't1', messageId: 'm1' }]);
});
test('preference transient failure and explicit conflict refresh retain draft with current revision', async () => {
  const h = harness(); h.handle(async () => ({ revision: 0, muted: [] })); await h.controller.loadPreferences(); h.controller.setMute('p1', 'deadline', true);
  h.handle(async () => { throw new Error('offline'); }); await h.controller.savePreferences(); assert.equal(h.controller.getState().dirty, true); assert.equal(h.controller.getState().draft.length, 1);
  h.handle(async () => { throw Object.assign(new Error('conflict'), { status: 409 }); }); await h.controller.savePreferences(); assert.equal(h.controller.getState().conflict, true);
  const count = h.calls.length; await h.controller.savePreferences(); assert.equal(h.calls.length, count);
  h.handle(async () => ({ revision: 3, muted: [] })); await h.controller.loadPreferences(); assert.equal(h.controller.getState().draft[0].category, 'deadline');
  h.handle(async (_url, options) => { const body = JSON.parse(options.body); assert.equal(body.expectedRevision, 3); assert.deepEqual(body.muted, [{ projectId: 'p1', category: 'deadline' }]); return { revision: 4, muted: body.muted }; });
  await h.controller.savePreferences(); assert.equal(h.controller.getState().dirty, false); assert.equal(h.controller.getState().revision, 4);
});
test('access removal clears sensitive preferences draft and blocks stale target', async () => {
  const h = harness(); await h.controller.refresh(); h.handle(async () => ({ revision: 1, muted: [] })); await h.controller.loadPreferences(); h.controller.setMute('p1', 'discussion', true);
  h.controller.setProjects([], []); assert.equal(h.controller.getState().items.length, 0); assert.equal(h.controller.getState().draft.length, 0);
  await h.controller.open('n1'); assert.equal(h.opened.length, 0);
});

function discussionHarness() {
  const discussionSource = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/discussion.js'), 'utf8');
  let handler = async () => ({ messages: [], hasMore: false });
  let focused = 0;
  const article = { dataset: { messageId: 'older' }, focus: () => { focused++; }, scrollIntoView: () => {} };
  const list = { innerHTML: '', querySelectorAll: () => [article], insertAdjacentHTML: () => {} };
  const context = { console, URLSearchParams, document: { getElementById: () => null } };
  vm.runInNewContext(discussionSource, context);
  const controller = context.CrmProjectsDiscussion.createController({ elements: { projectsBoardDiscussionList: list }, getCurrentUser: () => ({ uid: 'u1' }), apiFetchJson: (url) => handler(url) });
  controller.setSelection({ projectId: 'p1', taskId: 't1', role: 'Viewer' });
  return { controller, focused: () => focused, handle: (fn) => { handler = fn; } };
}
test('discussion focus follows cursor to older message and focuses its actual article', async () => {
  const h = discussionHarness();
  h.handle(async (url) => url.includes('cursor=older-page') ? { messages: [{ id: 'older', body: 'Older update' }], hasMore: false } : { messages: [{ id: 'recent', body: 'Recent update' }], hasMore: true, nextCursor: 'older-page' });
  assert.equal(await h.controller.focusMessage('older'), true); assert.equal(h.focused(), 1);
});
test('discussion focus stops on account/navigation guard while older response is held', async () => {
  const h = discussionHarness(), held = deferred(); let valid = true;
  h.handle((url) => url.includes('cursor=older-page') ? held.promise : Promise.resolve({ messages: [{ id: 'recent', body: 'Recent update' }], hasMore: true, nextCursor: 'older-page' }));
  const pending = h.controller.focusMessage('older', { isCurrent: () => valid });
  await new Promise(setImmediate); valid = false; held.resolve({ messages: [{ id: 'older', body: 'Older update' }], hasMore: false });
  assert.equal(await pending, false); assert.equal(h.focused(), 0);
});
test('404 on read or target clears all prior project labels and drafts', async () => {
  for (const operation of ['open', 'setRead']) {
    const h = harness(); await h.controller.refresh();
    h.handle(async () => { throw Object.assign(new Error('missing'), { status: 404 }); });
    await h.controller[operation]('n1', true);
    assert.equal(h.controller.getState().items.length, 0);
    assert.equal(h.controller.getState().draft.length, 0);
  }
});
test('successful read acknowledgement updates state and removes row from unread filter', async () => {
  const h = harness(); await h.controller.setFilters({ unread: 'true' });
  h.handle(async () => ({ notificationId: 'n1', read: true }));
  await h.controller.setRead('n1', true);
  assert.equal(h.controller.getState().items.length, 0);
  assert.match(h.controller.getState().status, /marked read/);
});

for (const navigationChanges of [1, 2]) test(`held target response cannot open after ${navigationChanges === 1 ? 'A-B' : 'A-B-A'} navigation with unchanged account and project catalog`, async () => {
  const h = harness(); await h.controller.refresh(); const held = deferred(); h.handle(() => held.promise);
  const pending = h.controller.open('n1');
  for (let n = 0; n < navigationChanges; n++) { h.navigate(); h.controller.setProjects([{ id: 'p1', name: 'Project' }]); }
  held.resolve({ available: true, projectId: 'p1', taskId: 't1' }); await pending;
  assert.equal(h.opened.length, 0);
});

test('empty authorization scan page invites continuation while exhausted empty feed stays clear', async () => {
  const list = { innerHTML: '' }, more = {};
  const h = harness({ querySelector: selector => selector === '[data-notifications-list]' ? list : selector === '[data-notifications-more]' ? more : null });
  h.handle(async () => ({ items: [], hasMore: true, nextCursor: 'continue' }));
  await h.controller.refresh();
  assert.match(list.innerHTML, /No accessible matches on this page.*Load more/);assert.equal(more.hidden, false);assert.equal(more.disabled, false);
  h.handle(async () => ({ items: [], hasMore: false }));await h.controller.refresh(true);
  assert.match(list.innerHTML, /No updates in this view/);assert.equal(more.hidden, true);
});
