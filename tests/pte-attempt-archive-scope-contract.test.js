const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* eslint-disable no-console */

console.log('Starting PTE attempt archive scope contract test...');

const helperPath = path.join(process.cwd(), 'public', 'js', 'pte-attempt-archive.js');
const helper = fs.readFileSync(helperPath, 'utf8');

const fetchCalls = [];
const nodes = {};
const head = createElement('head');
const historyContainer = createElement('div');
historyContainer.style.display = 'block';
nodes['start-essay-btn'] = createElement('button');
nodes['essay-history-toggle'] = createElement('button');
nodes['essay-history-container'] = historyContainer;
nodes['current-question-id-essay'] = createElement('span');
nodes['current-question-id-essay'].textContent = 'snap-essay-1';

function createElement(tagName = 'div') {
  const el = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    className: '',
    id: '',
    type: '',
    textContent: '',
    innerHTML: '',
    append(...items) {
      items.forEach((item) => this.appendChild(item));
    },
    appendChild(item) {
      this.children.push(item);
      return item;
    },
    insertAdjacentElement(_position, item) {
      this.appendChild(item);
      return item;
    },
    addEventListener() {},
    setAttribute(name, value) {
      this[name] = String(value);
    },
    closest() {
      return null;
    },
    querySelector(selector) {
      if (selector === '.history-attempt-content') {
        return this.children.find((child) => child.className === 'history-attempt-content') || null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  return el;
}

function collectText(node) {
  if (!node) return '';
  return [
    node.textContent || '',
    node.innerHTML || '',
    ...(Array.isArray(node.children) ? node.children.map(collectText) : [])
  ].join(' ');
}
const sandboxWindow = {
  location: { pathname: '/practice/writing/essay/1' },
  PracticeScopeManager: {
    getScope: () => 'english',
    subscribe: () => () => {}
  },
  __FIREBASE_INTERNAL__: {
    auth: {
      currentUser: {
        getIdToken: async () => 'test-token'
      }
    }
  },
  addEventListener: () => {},
  dispatchEvent: () => {}
};

const sandbox = {
  window: sandboxWindow,
  PracticeScopeManager: sandboxWindow.PracticeScopeManager,
  document: {
    readyState: 'complete',
    head,
    addEventListener: () => {},
    getElementById: (id) => nodes[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement
  },
  console,
  URLSearchParams,
  setTimeout: () => 0,
  fetch: async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        success: true,
        attempts: [
          {
            attemptId: 'attempt-1',
            practiceMode: 'essay',
            promptSnapshot: { promptId: 'snap-essay-1' },
            responseSummary: 'History row from prompt snapshot'
          }
        ]
      })
    };
  }
};

sandboxWindow.window = sandboxWindow;
vm.runInNewContext(helper, sandbox, { filename: helperPath });

(async () => {
  const result = await sandboxWindow.PTEAttemptArchive.listAttempts({ scope: 'mine', practiceScope: 'pte' });
  assert.strictEqual(result.skipped, undefined, 'legacy essay route should not skip PTE attempt history as non-pte-scope');
  assert.strictEqual(fetchCalls.length, 1, 'legacy essay route should call the practice attempts API');
  assert.strictEqual(result.attempts.length, 1, 'legacy essay route should return attempts from the API');
  await sandboxWindow.PTEAttemptArchive.updateHistoryUI('essay', 'snap-essay-1');
  const historyText = collectText(historyContainer);
  assert.match(
    historyText,
    /History row from prompt snapshot/,
    'history UI should match attempts by promptSnapshot.promptId when top-level promptId is absent'
  );
  console.log('PTE attempt archive scope contract test passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
