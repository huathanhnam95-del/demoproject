'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../public/js/crm/ai-assistance/budget.js'), 'utf8'), sandbox);
const Budget = sandbox.CrmAiBudget;
const dto = (patch = {}) => ({ schemaVersion: 2, quotaMode: 'usage_credits', uid: 'staff-a', month: '2026-09', timezone: 'Asia/Ho_Chi_Minh',
  allowanceMicrocredits: '5000000000', usedMicrocredits: '1000000000', reservedMicrocredits: '2000000000', legacyCarryMicrocredits: '0', remainingMicrocredits: '2000000000', overdrawnMicrocredits: '0',
  blocked: false, blockReason: null, paidDispatchAvailable: true, calibrationVersion: 'crm-ai-usage-v1-2026-09',
  voiceEstimate: { remainingSeconds: 123, profileVersion: 'voice-v1', basis: 'Estimated mixed voice activity' },
  equivalence: { currency: 'USD', monthlyTargetNano: '5000000000', invoiceCap: false }, providerAccounting: { pendingNano: '1000000000', blocked: true }, ...patch });
function harness() {
  let actor = 'staff-a', handler = async () => ({ budget: dto() }), focused = 0;
  const root = { innerHTML: '', hidden: true, setAttribute() {}, addEventListener() {}, ownerDocument: { activeElement: { matches: () => true } }, querySelector: () => ({ focus: () => focused++ }) };
  const c = Budget.createController({ root, endpoint: '/budget', apiFetchJson: () => handler(), getCurrentUser: () => actor ? { uid: actor } : null });
  c.init(); c.setAccount(actor);
  return { c, root, focusCount: () => focused, handle: next => { handler = next; }, actor: next => { actor = next; c.setAccount(next); } };
}
test('usage credits preserve exact precision and verify clamped remaining and overdrawn including legacy carry', () => {
  assert.equal(Budget.validateBudget(dto(), 'staff-a').remainingMicrocredits, '2000000000');
  assert.equal(Budget.formatCredits('9007199254740993000001'), '9,007,199,254,740,993.000001');
  const huge = dto({ allowanceMicrocredits: '9007199254740993000001', remainingMicrocredits: '9007199254737993000001' });
  assert.equal(Budget.validateBudget(huge, 'staff-a').remainingMicrocredits, huge.remainingMicrocredits);
  assert.equal(Budget.validateBudget(dto({ legacyCarryMicrocredits: '3000000000', remainingMicrocredits: '0', overdrawnMicrocredits: '1000000000' }), 'staff-a').overdrawnMicrocredits, '1000000000');
});
test('schema2 rejects malformed identity, precision, arithmetic and estimates', () => {
  for (const patch of [{ uid: '' }, { uid: 'other' }, { schemaVersion: 3 }, { quotaMode: 'other' }, { month: '2026-13' }, { month: ['2026-09'] }, { timezone: 'UTC' },
    { usedMicrocredits: 1 }, { usedMicrocredits: '-1' }, { usedMicrocredits: '01' }, { usedMicrocredits: '1e6' }, { usedMicrocredits: '9'.repeat(81) },
    { remainingMicrocredits: '1' }, { overdrawnMicrocredits: '1' }, { calibrationVersion: '' }, { blocked: 'false' },
    { voiceEstimate: null }, { voiceEstimate: { remainingSeconds: -1, profileVersion: 'v', basis: 'b' } },
    { voiceEstimate: { remainingSeconds: 1.5, profileVersion: 'v', basis: 'b' } }, { voiceEstimate: { remainingSeconds: Number.MAX_SAFE_INTEGER + 1, profileVersion: 'v', basis: 'b' } },
    { voiceEstimate: { remainingSeconds: 10, profileVersion: '', basis: 'b' } }, { voiceEstimate: { remainingSeconds: 10, profileVersion: 'v', basis: '' } },
    { equivalence: { currency: 'USD', monthlyTargetNano: '5000000000', invoiceCap: true } }]) {
    assert.throws(() => Budget.validateBudget(dto(patch), 'staff-a'), /could not be verified|Invalid budget amount/, JSON.stringify(patch));
  }
});
test('credit rendering uses supplied voice seconds only and separates provider accounting from quota', async () => {
  const h = harness(); await h.c.setEligible(true);
  for (const expected of ['Monthly usage credits', 'Used', 'Reserved', 'Remaining', '2,000', 'Approx. 2.1 voice minutes', 'USD 5-equivalent app allowance', 'not a guaranteed provider invoice cap', 'No rollover', 'shared across covered CRM AI features']) assert.ok(h.root.innerHTML.includes(expected), expected);
  assert.doesNotMatch(h.root.innerHTML, /spending is paused/);
  h.handle(async () => ({ budget: dto({ voiceEstimate: { remainingSeconds: 600, profileVersion: 'v', basis: '<unsafe>' } }) })); await h.c.refresh();
  assert.match(h.root.innerHTML, /Approx. 10 voice minutes/); assert.doesNotMatch(h.root.innerHTML, /<unsafe>/); assert.ok(h.focusCount() > 0);
});
test('schema2 exhaustion and malformed refresh keep manual drafts available without stale totals', async () => {
  const h = harness(); h.handle(async () => ({ budget: dto({ usedMicrocredits: '5000000000', reservedMicrocredits: '0', remainingMicrocredits: '0' }) })); await h.c.setEligible(true);
  assert.match(h.root.innerHTML, /No usage credits are available/); assert.match(h.root.innerHTML, /Manual editing and saved drafts remain available/);
  h.handle(async () => ({ budget: dto({ remainingMicrocredits: 'wrong' }) })); await h.c.refresh();
  assert.equal(h.c.getState().budget, null); assert.doesNotMatch(h.root.innerHTML, /data-ai-budget-amount/);
});
test('schema2 delayed responses cannot restore private totals after account switch or logout', async () => {
  for (const next of ['staff-b', '']) {
    const h = harness(); let release; h.handle(() => new Promise(resolve => { release = resolve; })); const pending = h.c.setEligible(true);
    h.actor(next); release({ budget: dto() }); await pending;
    assert.equal(h.c.getState().budget, null); assert.equal(h.root.hidden, true);
  }
});
