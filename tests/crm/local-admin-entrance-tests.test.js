const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadHelper() {
    const source = fs.readFileSync(
        path.join(process.cwd(), 'public/js/crm/entrance-test-link-state.js'),
        'utf8'
    );
    const sandbox = {
        window: {}
    };

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    const helper = sandbox.window.CrmEntranceTests;
    assert(helper, 'CrmEntranceTests helper was not initialized.');
    return helper;
}

const helper = loadHelper();

const activeLink = 'https://localhost:8443/entrance-test.html?token=active-token';
const fallbackLink = 'https://localhost:8443/entrance-test.html?token=fallback-token';

const viewModel = helper.buildViewModel([
    {
        testId: 'test-active',
        status: 'created',
        testLink: activeLink,
        createdAt: '2026-03-23T10:00:00.000Z',
        resultLink: 'https://localhost:8443/crm-entrance-test-result.html?testId=test-active'
    },
    {
        testId: 'test-submitted',
        status: 'submitted',
        testLink: fallbackLink,
        createdAt: '2026-03-23T09:00:00.000Z',
        resultLink: 'https://localhost:8443/crm-entrance-test-result.html?testId=test-submitted'
    }
], new Map([
    ['test-active', fallbackLink]
]));

assert.strictEqual(viewModel.tests[0].testLink, activeLink, 'API link should win over cached link.');
assert.strictEqual(viewModel.tests[1].testLink, '', 'Submitted tests must not expose a learner link.');
assert.strictEqual(viewModel.latestActiveTest?.testId, 'test-active', 'Active test should be selected as latest.');

const fallbackViewModel = helper.buildViewModel([
    {
        testId: 'test-fallback',
        status: 'started',
        testLink: '',
        createdAt: '2026-03-23T11:00:00.000Z',
        resultLink: 'https://localhost:8443/crm-entrance-test-result.html?testId=test-fallback'
    }
], new Map([
    ['test-fallback', fallbackLink]
]));

assert.strictEqual(fallbackViewModel.tests[0].testLink, fallbackLink, 'Cache should fill a missing active test link.');

const rowsHtml = helper.buildRowsHtml(viewModel.tests, {
    formatDateTime: (value) => `fmt:${value}`
});

assert(rowsHtml.includes('>Open<'), 'Active tests must render an Open link.');
assert(rowsHtml.includes('Unavailable'), 'Submitted tests must not render a learner link.');
assert(rowsHtml.includes('>View<'), 'Result links should still render for test history.');

const activeElements = {
    entranceTestLinkInput: { value: '' },
    btnCopyEntranceTestLink: { disabled: true },
    btnOpenEntranceTestLink: { disabled: true },
    entranceTestLinkNote: { textContent: '' }
};

helper.applyControls(activeElements, viewModel.latestActiveTest, { hasAnyTests: true });

assert.strictEqual(activeElements.entranceTestLinkInput.value, activeLink, 'Active link should populate the top-level input.');
assert.strictEqual(activeElements.btnCopyEntranceTestLink.disabled, false, 'Copy must be enabled for active links.');
assert.strictEqual(activeElements.btnOpenEntranceTestLink.disabled, false, 'Open must be enabled for active links.');
assert(
    activeElements.entranceTestLinkNote.textContent.includes('ready to send'),
    'Ready note should be shown for active links.'
);

const usedElements = {
    entranceTestLinkInput: { value: 'stale' },
    btnCopyEntranceTestLink: { disabled: false },
    btnOpenEntranceTestLink: { disabled: false },
    entranceTestLinkNote: { textContent: '' }
};

helper.applyControls(usedElements, null, { hasAnyTests: true });

assert.strictEqual(usedElements.entranceTestLinkInput.value, '', 'No active test should clear the input.');
assert.strictEqual(usedElements.btnCopyEntranceTestLink.disabled, true, 'Copy must be disabled when no active test exists.');
assert.strictEqual(usedElements.btnOpenEntranceTestLink.disabled, true, 'Open must be disabled when no active test exists.');
assert(
    usedElements.entranceTestLinkNote.textContent.includes('already been used'),
    'Used note should be shown when tests exist but none are active.'
);

const idleElements = {
    entranceTestLinkInput: { value: 'stale' },
    btnCopyEntranceTestLink: { disabled: false },
    btnOpenEntranceTestLink: { disabled: false },
    entranceTestLinkNote: { textContent: '' }
};

helper.applyControls(idleElements, null, { hasAnyTests: false });

assert(
    idleElements.entranceTestLinkNote.textContent.includes('Create a test'),
    'Default note should prompt the user to create a new test.'
);

console.log('local admin entrance tests passed');
