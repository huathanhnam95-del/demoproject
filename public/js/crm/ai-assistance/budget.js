(function (globalScope) {
  'use strict';
  const MONEY_KEYS = ['allowanceNano', 'settledNano', 'pendingNano', 'availableNano'];
  function nano(value) {
    if (typeof value !== 'string' || value.length > 80 || !/^-?(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid budget amount.');
    return BigInt(value);
  }
  function formatUsd(value) {
    const amount = nano(value), absolute = amount < 0n ? -amount : amount;
    const fraction = (absolute % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
    return `${amount < 0n ? '-' : ''}$${(absolute / 1000000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
  }
  function validateBudget(value, uid) {
    if (!value || value.uid !== uid || value.currency !== 'USD' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month || '') || typeof value.blocked !== 'boolean' || typeof value.paidDispatchAvailable !== 'boolean') throw new Error('Budget details could not be verified.');
    const amounts = Object.fromEntries(MONEY_KEYS.map(key => [key, nano(value[key])]));
    if (amounts.allowanceNano < 0n || amounts.settledNano < 0n || amounts.pendingNano < 0n || amounts.availableNano !== amounts.allowanceNano - amounts.settledNano - amounts.pendingNano) throw new Error('Budget details could not be verified.');
    if (value.policyMode !== undefined && !['monitored_target', 'engineering'].includes(value.policyMode)
      || value.costBasis !== undefined && value.costBasis !== 'reported_usage_calculation'
      || value.possibleOverage !== undefined && typeof value.possibleOverage !== 'boolean') throw new Error('Budget details could not be verified.');
    return { uid, month: value.month, currency: 'USD', ...Object.fromEntries(MONEY_KEYS.map(key => [key, value[key]])), blocked: value.blocked, paidDispatchAvailable: value.paidDispatchAvailable,
      ...Object.fromEntries(['policyMode', 'costBasis', 'possibleOverage'].filter(key => value[key] !== undefined).map(key => [key, value[key]])) };
  }
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  function createController({ root, endpoint, apiFetchJson, getCurrentUser = () => null } = {}) {
    let uid = '', eligible = false, sequence = 0, budget = null, loading = false, status = '', initialized = false;
    const currentUid = () => String(getCurrentUser()?.uid || '');
    const getState = () => ({ uid, eligible, budget: budget ? { ...budget } : null, loading, status });
    function render() {
      if (!root) return;
      const focused = root.ownerDocument?.activeElement?.matches?.('[data-ai-budget-refresh]');
      root.hidden = !uid || !eligible;
      root.setAttribute('aria-busy', String(loading));
      const exhausted = budget && nano(budget.availableNano) <= 0n;
      const monitored = budget?.policyMode === 'monitored_target';
      const totals = monitored ? [['allowanceNano', 'Monthly target'], ['settledNano', 'Calculated usage'], ['pendingNano', 'Pending estimates'], ['availableNano', 'Unreserved target']]
        : [['allowanceNano', 'Allowance'], ['settledNano', 'Settled'], ['pendingNano', 'Pending'], ['availableNano', 'Available']];
      const message = budget?.blocked ? 'AI spending is paused for this account.' : exhausted ? monitored ? 'The monthly target is fully reserved or exceeded.' : 'No AI budget is available this month.' : '';
      const month = budget ? `${budget.month} · Vietnam time · USD` : 'Shared across covered CRM AI features';
      root.innerHTML = `<div class="crm-ai-budget-heading"><div><h3>Monthly CRM AI budget</h3><p class="crm-muted">${escape(month)}</p></div><button type="button" class="crm-btn-secondary" data-ai-budget-refresh${loading ? ' disabled' : ''}>${loading ? 'Refreshing…' : 'Refresh budget'}</button></div>${budget ? `<dl class="crm-ai-budget-totals">${totals.map(([key, label]) => `<div><dt>${label}</dt><dd data-ai-budget-amount="${key}"${key === 'availableNano' && exhausted ? ' class="crm-ai-budget-exhausted"' : ''}>${formatUsd(budget[key])}</dd></div>`).join('')}</dl>` : ''}<p data-ai-budget-status role="status">${escape(status || message)}</p>${budget && message && status ? `<p class="crm-ai-budget-notice">${escape(message)}</p>` : ''}<p class="crm-muted">${budget?.paidDispatchAvailable === false ? 'AI assistance is not available yet. ' : ''}Manual editing and saved drafts remain available.</p>`;
      if (monitored) root.innerHTML += '<p class="crm-muted">Calculated from reported usage, not a provider invoice. Pending estimates may change and final charges can exceed the monthly target.</p>';
      if (focused) root.querySelector('[data-ai-budget-refresh]')?.focus();
    }
    function clear(message = '') { sequence++; budget = null; loading = false; status = message; render(); }
    function setAccount(value) { const next = String(value || ''); if (next === uid) return; uid = next; eligible = false; clear(); }
    function setEligible(value) {
      const next = value === true && !!uid && uid === currentUid();
      if (next === eligible) return;
      eligible = next; clear();
      if (eligible) return refresh();
    }
    async function refresh() {
      if (uid !== currentUid()) { setAccount(currentUid()); return; }
      if (!uid || !eligible || typeof apiFetchJson !== 'function' || !endpoint) return;
      const actor = uid, request = ++sequence; loading = true; status = 'Refreshing budget…'; render();
      const isCurrent = () => {
        if (uid !== currentUid()) { setAccount(currentUid()); return false; }
        return actor === uid && eligible && request === sequence;
      };
      try {
        const result = await apiFetchJson(endpoint);
        if (!isCurrent()) return;
        budget = validateBudget(result?.budget, actor); status = '';
      } catch (error) {
        if (!isCurrent()) return;
        if (error?.status === 401 || error?.status === 403) {
          budget = null; status = 'Budget access is unavailable. Refresh after your access is restored.';
        } else if (!error?.status && error?.message?.startsWith('Budget details') || error?.message === 'Invalid budget amount.') {
          budget = null; status = 'Budget details could not be verified. Refresh to try again.';
        } else status = budget ? 'Could not refresh. Showing the last confirmed balance.' : 'Budget could not be loaded. Refresh to try again.';
      } finally { if (isCurrent()) { loading = false; render(); } }
    }
    function init() { if (initialized) return; initialized = true; root?.addEventListener('click', event => { if (event.target.closest?.('[data-ai-budget-refresh]')) refresh(); }); render(); }
    return { init, setAccount, setEligible, refresh, clear, getState };
  }
  globalScope.CrmAiBudget = { createController, formatUsd, validateBudget };
})(typeof window !== 'undefined' ? window : globalThis);
