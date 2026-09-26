'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/recovery.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup() {
  const controls = new Map(), events = {}, storage = new Map(), posts = [], reads = [];
  let actor = 'actor-a', revision = 1, holdRead = null, readHandler = null;
  function el(name) {
    if (!controls.has(name)) controls.set(name, { value: name === 'lifecycle' ? 'active' : name === 'type' ? 'task' : 'done', textContent: '', innerHTML: '', hidden: false, disabled: false, open: false, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } });
    return controls.get(name);
  }
  const root = { innerHTML: '', hidden: false, querySelector(selector) { return el(selector.slice(15, -1)); }, querySelectorAll() { return []; }, addEventListener(name, fn) { events[name] = fn; } };
  const context = { console, URLSearchParams, sessionStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } };
  vm.runInNewContext(source, context);
  const controller = context.CrmProjectsRecovery.createController({ elements: { projectsBoardRecovery: root }, getCurrentUser: () => ({ uid: actor }), refreshBoard: async () => {}, apiFetchJson: async (url, options) => {
    if (options?.method === 'POST') { const item = deferred(); posts.push({ ...item, url, body: options.body }); return item.promise; }
    reads.push(url);
    if (url.includes('/history?')) return { operations: [] };
    if (holdRead) { const item = holdRead; holdRead = null; return item.promise; }
    if (readHandler) return readHandler(url);
    return { entries: ['a', 'b'].map((id) => ({ targetType: 'task', targetId: id, title: id, lifecycle: 'active', revision, allowedActions: { archive: true } })) };
  } });
  controller.init();
  const choose = async (projectId) => { controller.setSelection({ projectId, role: 'Owner', lifecycle: 'active' }); el('disclosure').open = true; el('disclosure').listeners.toggle(); await flush(); };
  const select = (index) => events.change({ target: { matches: (s) => s === '[data-select]', checked: true, dataset: { select: String(index) } } });
  const click = (name) => { const button = { disabled: false, hasAttribute: (s) => s === `data-recovery-${name}` }; events.click({ target: { closest: () => button } }); };
  return { controller, choose, select, click, el, posts, reads, storage, setReadHandler: fn => { readHandler = fn; }, setRevision: (n) => { revision = n; }, setActor: (s) => { actor = s; }, holdRead: () => { holdRead = deferred(); return holdRead; } };
}
(async () => {
  const passed = [];
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush();
    await h.choose('Q'); await h.choose('P'); h.select(1); h.setRevision(2); const before = h.reads.length;
    h.posts[0].resolve({ success: true }); await flush();
    assert.equal(h.el('retry').hidden, true); assert.ok(h.reads.length > before);
    assert.equal(h.controller.getState().selectedTasks[0].targetId, 'b'); assert.equal(h.controller.getState().selectedTasks[0].revision, 2);
    passed.push('late success settles retry and refreshes retained selected IDs with current revisions');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); await h.choose('Q'); await h.choose('P'); h.click('retry'); await flush();
    assert.equal(h.posts[0].body, h.posts[1].body);
    h.posts[0].resolve({ success: true }); await flush();
    assert.equal(h.controller.getState().pending, true); assert.equal(h.el('retry').hidden, true);
    h.posts[1].reject(Object.assign(new Error('late uncertain error'), { status: 503 })); await flush();
    assert.equal(h.controller.getState().pending, false); assert.equal(h.el('retry').hidden, true); assert.equal(h.storage.size, 0);
    assert.ok(!h.el('status').textContent.includes('late uncertain error'));
    passed.push('concurrent replay retains exact operation body; old completion does not clear replay pending or resurrect uncertainty');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); await h.choose('Q'); await h.choose('P'); h.click('retry'); await flush();
    h.posts[0].resolve({ success: true }); await flush(); await h.choose('Q'); await h.choose('P'); h.select(1); h.click('bulk'); await flush();
    const newStatus = h.el('status').textContent;
    h.posts[1].reject(Object.assign(new Error('older request failed'), { status: 409 })); await flush();
    assert.equal(h.controller.getState().pending, true); assert.equal(h.el('status').textContent, newStatus); assert.equal(h.el('retry').hidden, false);
    h.posts[2].resolve({ success: true }); await flush();
    passed.push('older known error preserves newer mutation pending status and exact retry');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); await h.choose('Q'); await h.choose('P');
    const read = h.holdRead(); h.posts[0].resolve({ success: true }); await flush(); h.select(1);
    read.resolve({ entries: ['a', 'b'].map((id) => ({ targetType: 'task', targetId: id, title: id, lifecycle: 'active', revision: 3, allowedActions: { archive: true } })) }); await flush();
    assert.equal(h.controller.getState().selectedTasks[0].targetId, 'b'); assert.equal(h.controller.getState().selectedTasks[0].revision, 3); assert.equal(h.controller.getState().entries[0].revision, 3);
    passed.push('late refresh preserves a newer selected ID and updates its authoritative revision');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); await h.choose('Q'); await h.choose('P'); h.select(1);
    const read = h.holdRead(); h.posts[0].resolve({ success: true }); await flush(); h.click('benign');
    read.resolve({ entries: [{ targetType: 'task', targetId: 'b', title: 'b refreshed', lifecycle: 'active', revision: 4, allowedActions: { archive: true } }] }); await flush();
    assert.equal(h.controller.getState().entries.length, 1); assert.equal(h.controller.getState().entries[0].revision, 4); assert.equal(h.controller.getState().selectedTasks[0].revision, 4);
    passed.push('benign click during a held read cannot discard authoritative records');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); await h.choose('Q'); await h.choose('P');
    h.posts[0].reject(Object.assign(new Error('known conflict'), { status: 409 })); await flush(); assert.equal(h.el('retry').hidden, true); assert.equal(h.storage.size, 0);
    h.select(0); h.click('bulk'); await flush(); h.posts[1].reject(Object.assign(new Error('uncertain'), { status: 503 })); await flush();
    assert.equal(h.el('retry').hidden, false); assert.equal(h.storage.size, 1); h.click('retry'); await flush(); assert.equal(h.posts[1].body, h.posts[2].body);
    h.posts[2].resolve({ success: true }); await flush();
    passed.push('late known conflict settles; uncertainty keeps exact retry');
  }
  {
    const h = setup(); await h.choose('P'); h.select(0); h.click('bulk'); await flush(); h.setActor('actor-b'); await h.choose('P'); h.select(1); h.click('bulk'); await flush();
    const before = h.el('status').textContent; h.posts[0].resolve({ success: true }); await flush();
    assert.equal(h.controller.getState().pending, true); assert.equal(h.el('status').textContent, before); assert.equal(h.el('retry').hidden, false); assert.equal(h.storage.size, 1);
    h.posts[1].resolve({ success: true }); await flush();
    passed.push('old actor settlement does not change the new actor pending retry or status');
  }
  const result = { success: true, checks: passed };

  {
    const h = setup(); await h.choose('P'); h.select(0); h.el('disclosure').open = false;
    const before = h.reads.length; h.controller.invalidate('P'); h.controller.invalidate('P'); await flush();
    assert.equal(h.reads.length, before, 'Closed recovery stays lazy');
    h.setRevision(8); h.el('disclosure').open = true; h.el('disclosure').listeners.toggle(); await flush();
    assert.equal(h.reads.length, before + 1);
    assert.equal(h.controller.getState().selectedTasks[0].targetId, 'a');
    assert.equal(h.controller.getState().selectedTasks[0].revision, 8);
    const next = h.reads.length; h.controller.invalidate('P'); h.controller.invalidate('P'); await flush();
    assert.equal(h.reads.length, next + 1, 'Same-turn invalidations share one read');
    passed.push('closed invalidation is lazy; open invalidations coalesce and retain selected tasks with fresh revisions');
  }
  {
    const h = setup(); await h.choose('P'); const held = h.holdRead(); const before = h.reads.length;
    h.click('more'); h.click('more'); await flush(); assert.equal(h.reads.length, before + 1);
    held.resolve({ entries: [{ targetType: 'task', targetId: 'a', title: 'new a', lifecycle: 'active', revision: 9 }, { targetType: 'task', targetId: 'a', title: 'new a', lifecycle: 'active', revision: 9 }] }); await flush();
    assert.equal(h.controller.getState().entries.length, 2);
    assert.equal(h.controller.getState().entries.find(row => row.targetId === 'a').revision, 9);
    passed.push('duplicate paging clicks share one read and overlapping rows are deduplicated');
  }

  {
    const h = setup(); let revision = 1, unavailable = false, failValidation = false;
    const row = id => ({ targetType: 'task', targetId: id, title: id, lifecycle: 'active', revision, allowedActions: { archive: true } });
    h.setReadHandler(url => {
      const query = new URLSearchParams(url.split('?')[1]);
      if (url.includes('/recovery/preview?')) {
        if (failValidation) throw Object.assign(new Error('Network interruption'), { status: 503 });
        if (unavailable) throw Object.assign(new Error('Task unavailable'), { status: 404 });
        return { target: row(query.get('targetId')) };
      }
      return query.has('cursor')
        ? { entries: unavailable ? [] : [row('page-two-task')], hasMore: false }
        : { entries: Array.from({ length: 50 }, (_, i) => row(`first-${i}`)), hasMore: true, nextCursor: 'second-page' };
    });
    await h.choose('P'); h.click('more'); await flush(); h.select(50);
    revision = 7; const before = h.reads.length; h.controller.invalidate('P'); await flush();
    assert.equal(h.reads.length, before + 2, 'Automatic refresh rereads only the loaded two-page range');
    assert.equal(h.controller.getState().selectedTasks[0].targetId, 'page-two-task');
    assert.equal(h.controller.getState().selectedTasks[0].revision, 7);
    assert.equal(h.reads.some(url => url.includes('/recovery/preview?')), false, 'No automatic individual-read fanout');
    unavailable = true; h.controller.invalidate('P'); await flush();
    assert.equal(h.controller.getState().selectedTasks.length, 1, 'Paginated absence alone cannot drop a selection');
    assert.equal(h.el('bulk').disabled, true);
    assert.match(h.el('status').textContent, /need checking/);
    failValidation = true; h.click('refresh'); await flush();
    assert.equal(h.controller.getState().selectedTasks.length, 1, 'Interrupted validation preserves the selected task');
    assert.equal(h.el('bulk').disabled, true);
    failValidation = false; h.click('refresh'); await flush();
    assert.equal(h.controller.getState().selectedTasks.length, 0, 'Explicit canonical unavailable response clears the selected task');
    passed.push('page-two selection survives automatic refresh with fresh revision; absent selection requires explicit validation, failures retain it and actual unavailability clears it');
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
