const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* eslint-disable no-console */

console.log('Starting PTE attempt archive scope contract test...');

const helperPath = path.join(process.cwd(), 'public', 'js', 'pte-attempt-archive.js');
const helper = fs.readFileSync(helperPath, 'utf8');

const fetchCalls = [];
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
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {},
      className: '',
      textContent: '',
      append: () => {},
      appendChild: () => {},
      addEventListener: () => {},
      setAttribute: () => {},
      querySelector: () => null
    })
  },
  console,
  URLSearchParams,
  setTimeout: () => 0,
  fetch: async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ success: true, attempts: [{ attemptId: 'attempt-1' }] })
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
  console.log('PTE attempt archive scope contract test passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
