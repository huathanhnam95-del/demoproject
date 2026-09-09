'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/ai-assistance/budget.js'), 'utf8'), sandbox);
const Budget = sandbox.CrmAiBudget;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const dto = (extra = {}) => ({ uid: 'staff-a', month: '2026-09', currency: 'USD', allowanceNano: '5000000000', settledNano: '1000000000', pendingNano: '2000000000', availableNano: '2000000000', blocked: false, blockReason: null, paidDispatchAvailable: false, ...extra });
function harness() {
  let actor = 'staff-a', handler = async () => ({ budget: dto({ uid: actor }) });
  const calls = [], root = { innerHTML: '', hidden: true, setAttribute() {}, addEventListener() {}, querySelector() {} };
  const c = Budget.createController({ root, endpoint: '/shared-test/budget', apiFetchJson: url => { calls.push(url); return handler(); }, getCurrentUser: () => actor ? { uid: actor } : null });
  c.init(); c.setAccount(actor);
  return { c, root, calls, handle: value => { handler = value; }, actor: (value, notify = true) => { actor = value; if (notify) c.setAccount(value); } };
}

test('exact USD formatting handles fractional nanodollars and integers beyond Number precision', () => {
  assert.equal(Budget.formatUsd('1'), '$0.000000001'); assert.equal(Budget.formatUsd('-1'), '-$0.000000001');
  assert.equal(Budget.formatUsd('5000000000'), '$5.00');
  assert.equal(Budget.formatUsd('9007199254740993000000001'), '$9,007,199,254,740,993.000000001');
});

test('shared client uses injected endpoint only once when eligibility first becomes current', async () => {
  const h = harness(); assert.equal(h.calls.length, 0); await h.c.setEligible(true);
  assert.deepEqual(h.calls, ['/shared-test/budget']); assert.equal(h.c.getState().budget.uid, 'staff-a');
  await h.c.setEligible(true); assert.equal(h.calls.length, 1); assert.match(h.root.innerHTML, /Monthly CRM AI budget/);
  assert.match(h.root.innerHTML, /AI assistance is not available yet/);
});

test('negative availability and exhaustion remain honest without disabling manual editing', async () => {
  const h = harness(); h.handle(async () => ({ budget: dto({ allowanceNano: '1000000000', availableNano: '-2000000000' }) })); await h.c.setEligible(true);
  assert.match(h.root.innerHTML, /-\$2\.00/); assert.match(h.root.innerHTML, /No AI budget is available/); assert.match(h.root.innerHTML, /Manual editing and saved drafts remain available/);
  assert.doesNotMatch(h.root.innerHTML, /data-ai-budget-refresh disabled/);
  h.handle(async () => ({ budget: dto({ allowanceNano: '3000000000', availableNano: '0' }) })); await h.c.refresh(); assert.match(h.root.innerHTML, /No AI budget is available/);
});

test('blocked budget uses safe product copy without exposing server block details', async () => {
  const h = harness(); h.handle(async () => ({ budget: dto({ blocked: true, blockReason: 'INTERNAL_LEASE_BOUND_SECRET' }) })); await h.c.setEligible(true);
  assert.match(h.root.innerHTML, /spending is paused/); assert.doesNotMatch(h.root.innerHTML, /INTERNAL_LEASE_BOUND_SECRET/);
});

test('native usage distinguishes calculations and pending estimates from an invoice or hard cap', async () => {
  const h = harness(); h.handle(async () => ({ budget: dto({ policyMode: 'monitored_target', allowanceNano: '1000000000', availableNano: '-2000000000', paidDispatchAvailable: true }) })); await h.c.setEligible(true);
  for (const text of ['Monthly target', 'Calculated usage', 'Pending estimates', 'Unreserved target', 'not a provider invoice', 'final charges can exceed the monthly target', 'reserved or exceeded']) assert.ok(h.root.innerHTML.includes(text), text);
  assert.equal(h.c.getState().budget.policyMode, 'monitored_target');
  assert.throws(() => Budget.validateBudget(dto({ policyMode: 'guaranteed' }), 'staff-a'), /could not be verified/);
});

test('malformed money and inconsistent totals clear previously displayed private totals', async () => {
  for (const patch of [{ settledNano: 1 }, { settledNano: '1.5' }, { settledNano: '1e9' }, { settledNano: ' 0' }, { settledNano: '00' }, { settledNano: '-1' }, { settledNano: '9'.repeat(81) }, { availableNano: '999' }, { currency: 'VND' }, { month: '2026-13' }]) {
    const h = harness(); await h.c.setEligible(true); h.handle(async () => ({ budget: dto(patch) })); await h.c.refresh();
    assert.equal(h.c.getState().budget, null, JSON.stringify(patch)); assert.match(h.c.getState().status, /could not be verified/); assert.doesNotMatch(h.root.innerHTML, /data-ai-budget-amount/);
  }
});

test('server UID must match current account even when response otherwise appears valid', async () => {
  const h = harness(); h.handle(async () => ({ budget: dto({ uid: 'someone-else' }) })); await h.c.setEligible(true);
  assert.equal(h.c.getState().budget, null); assert.match(h.c.getState().status, /could not be verified/);
});

test('held response from prior account cannot restore old budget after account switch', async () => {
  const h = harness(), held = deferred(); h.handle(() => held.promise); const work = h.c.setEligible(true);
  h.actor('staff-b'); assert.equal(h.root.hidden, true); h.handle(async () => ({ budget: dto({ uid: 'staff-b' }) })); await h.c.setEligible(true);
  held.resolve({ budget: dto() }); await work; assert.equal(h.c.getState().budget.uid, 'staff-b');
});

test('current UID is rechecked after await even without an account notification', async () => {
  const h = harness(), held = deferred(); h.handle(() => held.promise); const work = h.c.setEligible(true); h.actor('staff-b', false);
  held.resolve({ budget: dto() }); await work; assert.equal(h.c.getState().budget, null); assert.equal(h.root.hidden, true);
});

test('latest refresh wins when requests complete in reverse order', async () => {
  const h = harness(), first = deferred(), second = deferred(); h.handle(() => first.promise); const old = h.c.setEligible(true);
  h.handle(() => second.promise); const recent = h.c.refresh(); second.resolve({ budget: dto({ month: '2026-10' }) }); await recent;
  first.resolve({ budget: dto() }); await old; assert.equal(h.c.getState().budget.month, '2026-10');
});

test('feature denial clears budget immediately and invalidates pending refresh without touching other state', async () => {
  const h = harness(); await h.c.setEligible(true); const held = deferred(); h.handle(() => held.promise); const work = h.c.refresh();
  h.c.setEligible(false); assert.equal(h.c.getState().budget, null); assert.equal(h.root.hidden, true);
  held.resolve({ budget: dto() }); await work; assert.equal(h.c.getState().budget, null);
});

test('401 and403 discard cached private totals and late old-account denial cannot clear new totals', async () => {
  for (const status of [401, 403]) {
    const h = harness(); await h.c.setEligible(true); h.handle(async () => { throw Object.assign(new Error('denied'), { status }); }); await h.c.refresh();
    assert.equal(h.c.getState().budget, null); assert.match(h.c.getState().status, /access is unavailable/);
    const held = deferred(); h.handle(() => held.promise); const work = h.c.refresh(); h.actor('staff-b'); h.handle(async () => ({ budget: dto({ uid: 'staff-b' }) })); await h.c.setEligible(true);
    held.reject(Object.assign(new Error('denied'), { status })); await work; assert.equal(h.c.getState().budget.uid, 'staff-b');
  }
});

test('transient failure labels cached balance and successful explicit retry recovers', async () => {
  const h = harness(); await h.c.setEligible(true); h.handle(async () => { throw new Error('offline'); }); await h.c.refresh();
  assert.ok(h.c.getState().budget); assert.match(h.c.getState().status, /last confirmed balance/);
  h.handle(async () => ({ budget: dto({ month: '2026-10' }) })); await h.c.refresh(); assert.equal(h.c.getState().status, ''); assert.equal(h.c.getState().budget.month, '2026-10');
});

test('administrative allowance control rejects above-cap input before API mutation and permits zero', async () => {
  const context = { document: { getElementById: () => null } }, calls = [], messages = []; let click;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/projects/access.js'), 'utf8'), context);
  const input = { value: '' }, save = { addEventListener(name, handler) { if (name === 'click') click = handler; } };
  const controller = context.CrmProjectsAccess.createController({ elements: { projectsAllowanceUsd: input, projectsAllowanceSave: save },
    showToast: message => messages.push(message), getCurrentUser: () => ({ uid: 'admin' }),
    apiFetchJson: async (url, options) => { if (options?.method === 'PATCH') calls.push(JSON.parse(options.body)); return {}; }
  });
  controller.init();
  for (const value of ['5.01', '100', '-1', '1.001']) { input.value = value; click(); assert.equal(calls.length, 0); }
  assert.equal(messages.length, 4); assert.ok(messages.every(message => message.includes('0 to 5')));
  input.value = '0'; click(); assert.equal(calls.length, 1); assert.equal(calls[0].monthlyAllowanceCents, 0);
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  input.value = '5.00'; click(); assert.equal(calls.length, 2); assert.equal(calls[1].monthlyAllowanceCents, 500);
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
});
