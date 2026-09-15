'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    createReleaseDriver,
    ReleaseGateError,
    stableHash
} = require('../../scripts/bel-demo/release-online.cjs');

const clone = value => JSON.parse(JSON.stringify(value));

function approvedOptions({ readState, actions, execute = true, now = 1_000, expectedState } = {}) {
    const scope = {
        candidateSha: 'candidate-sha',
        baseSha: 'base-sha',
        actions: actions.map(action => ({ name: action.name, resource: action.resource }))
    };
    const options = {
        readState,
        actions,
        execute,
        now: () => now,
        candidateSha: scope.candidateSha,
        scope,
        lease: {
            owner: 'release-owner',
            resources: actions.map(action => action.resource),
            acquiredAt: now - 10,
            expiresAt: now + 3_600
        },
        approval: {
            owner: 'release-owner',
            candidateSha: scope.candidateSha,
            baseSha: scope.baseSha,
            scopeHash: stableHash(scope),
            actions: scope.actions.map(action => action.name),
            expiresAt: now + 3_600
        },
        evidenceDir: null
    };
    if (expectedState !== undefined) options.expectedState = clone(expectedState);
    return options;
}

function action(name, resource, apply) {
    return {
        name,
        resource,
        apply,
        expectedStateAfter: ({ observed }) => observed
    };
}

test('read-only mode plans every action without invoking a mutation', async () => {
    const state = { hosting: { version: 'v1' } };
    let applied = 0;
    const actions = [action('version-create', 'hosting', async () => { applied += 1; })];
    const driver = createReleaseDriver(approvedOptions({
        readState: async () => clone(state),
        actions,
        execute: false
    }));

    const result = await driver.run();

    assert.equal(result.mode, 'read-only');
    assert.deepEqual(result.actions.map(item => item.status), ['planned']);
    assert.equal(applied, 0);
});

test('execution requires a matching lease and explicit approval scope', async () => {
    const actions = [action('version-create', 'hosting', async () => {})];
    const options = approvedOptions({ readState: async () => ({}), actions });
    delete options.approval;

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'APPROVAL_REQUIRED'
    );
});

async function runWithDriftBefore({ driftRead, expectedPhase }) {
    const state = { hosting: { version: 'v1', uploads: 0, released: false } };
    let reads = 0;
    const applied = [];
    const actions = [
        action('version-create', 'hosting', async () => {
            applied.push('version-create');
            state.hosting.version = 'v2';
        }),
        action('upload', 'hosting', async () => {
            applied.push('upload');
            state.hosting.uploads += 1;
        }),
        action('release', 'hosting', async () => {
            applied.push('release');
            state.hosting.released = true;
        })
    ];
    const driver = createReleaseDriver(approvedOptions({
        readState: async () => {
            reads += 1;
            if (reads === driftRead) return { ...clone(state), drift: `unowned-${driftRead}` };
            return clone(state);
        },
        actions,
        expectedState: clone(state)
    }));

    await assert.rejects(
        driver.run(),
        error => error instanceof ReleaseGateError && error.code === 'BASELINE_DRIFT' && error.phase === expectedPhase
    );
    return applied;
}

test('drift before version creation performs zero publication actions', async () => {
    assert.deepEqual(await runWithDriftBefore({ driftRead: 1, expectedPhase: 'version-create' }), []);
});

test('drift before upload stops after version creation and performs no later publication', async () => {
    assert.deepEqual(await runWithDriftBefore({ driftRead: 3, expectedPhase: 'upload' }), ['version-create']);
});

test('drift before release stops after upload and performs no release', async () => {
    assert.deepEqual(await runWithDriftBefore({ driftRead: 5, expectedPhase: 'release' }), ['version-create', 'upload']);
});

test('unexpected post-mutation state fails closed before the next action', async () => {
    const state = { gateway: { revision: 'r1' } };
    let applied = 0;
    const actions = [
        {
            name: 'gateway-deploy',
            resource: 'gateway',
            apply: async () => { applied += 1; },
            expectedStateAfter: () => ({ gateway: { revision: 'r2' } })
        },
        action('gateway-release', 'gateway', async () => { applied += 10; })
    ];
    const driver = createReleaseDriver(approvedOptions({
        readState: async () => clone(state),
        actions
    }));

    await assert.rejects(
        driver.run(),
        error => error instanceof ReleaseGateError && error.code === 'POST_MUTATION_MISMATCH' && error.phase === 'gateway-deploy'
    );
    assert.equal(applied, 1);
});

test('production gateway specification is explicit, disabled by default, and least-privilege named', () => {
    const root = path.resolve(__dirname, '../..');
    const service = fs.readFileSync(path.join(root, 'backend/presentation-demo/service.yaml'), 'utf8');
    const index = fs.readFileSync(path.join(root, 'functions/src/index.js'), 'utf8');

    assert.match(service, /run\.googleapis\.com\/ingress:\s*all/);
    assert.match(service, /autoscaling\.knative\.dev\/minScale:\s*["']?2/);
    assert.match(service, /autoscaling\.knative\.dev\/maxScale:\s*["']?4/);
    assert.match(service, /run\.googleapis\.com\/cpu-throttling:\s*["']?false/);
    assert.match(service, /serviceAccountName:\s*bel-presentation-demo@listening-tasks-3ae34\.iam\.gserviceaccount\.com/);
    assert.match(service, /cpu:\s*["']?1/);
    assert.match(service, /memory:\s*["']?1Gi/);
    assert.match(service, /PRESENTATION_DEMO_ONLINE_ENABLED[\s\S]*value:\s*["']?0/);
    assert.match(service, /PRESENTATION_DEMO_ADMISSION_ENABLED[\s\S]*value:\s*["']?0/);
    assert.match(service, /PRESENTATION_DEMO_MUTATIONS_ENABLED[\s\S]*value:\s*["']?0/);
    assert.match(service, /image:\s*asia-southeast1-docker\.pkg\.dev\/listening-tasks-3ae34\/bel\/presentation-demo@sha256:/);
    assert.doesNotMatch(service, /:TAG\b|REGION-docker\.pkg\.dev|PROJECT\//);

    assert.match(index, /presentationDemoMaintenanceRunner:\s*onSchedule\(\{[\s\S]*serviceAccount:\s*'bel-presentation-maintenance@listening-tasks-3ae34\.iam\.gserviceaccount\.com'/);
    assert.match(index, /api:\s*onRequest\(\{[\s\S]*serviceAccount:\s*'crm-api-runtime@listening-tasks-3ae34\.iam\.gserviceaccount\.com'/);
});
