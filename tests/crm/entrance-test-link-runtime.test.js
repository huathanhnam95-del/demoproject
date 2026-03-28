/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadHelper(locationOrigin = 'https://betterenglishlearning.com') {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/js/crm/entrance-test-link-state.js'),
    'utf8'
  );
  const sandbox = {
    URL,
    window: {
      location: {
        origin: locationOrigin
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.CrmEntranceTests;
}

const helper = loadHelper();
assert(helper, 'CrmEntranceTests helper should initialize.');

const staleOriginLink = 'https://listening-tasks-3ae34.web.app/crm-entrance-test-result.html?testId=test-123';
const staleLearnerLink = 'https://listening-tasks-3ae34.web.app/entrance-test.html?token=token-123';

const viewModel = helper.buildViewModel([
  {
    testId: 'test-123',
    status: 'created',
    testLink: staleLearnerLink,
    resultLink: staleOriginLink
  }
]);

assert.strictEqual(
  viewModel.tests[0].testLink,
  'https://betterenglishlearning.com/entrance-test.html?token=token-123',
  'Active learner links should be normalized to the current CRM origin.'
);
assert.strictEqual(
  viewModel.tests[0].resultLink,
  'https://betterenglishlearning.com/crm-entrance-test-result.html?testId=test-123',
  'Result links should be normalized to the current CRM origin.'
);

const controls = {
  entranceTestLinkInput: { value: '' },
  btnCopyEntranceTestLink: { disabled: true },
  btnOpenEntranceTestLink: { disabled: true },
  entranceTestLinkNote: { textContent: '' }
};

helper.applyControls(controls, viewModel.latestActiveTest, { hasAnyTests: true });
assert.strictEqual(
  controls.entranceTestLinkInput.value,
  'https://betterenglishlearning.com/entrance-test.html?token=token-123',
  'The top-level Open action should receive the normalized active learner link.'
);

console.log('entrance test link runtime passed');
