'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    createReleaseDriver,
    createDryRunPublisherAdapter,
    createFileLeaseProvider,
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
    const lease = {
        leaseId: 'lease-1',
        owner: 'release-owner',
        candidateSha: scope.candidateSha,
        baseSha: scope.baseSha,
        scopeHash: stableHash(scope),
        resources: actions.map(action => action.resource),
        acquiredAt: now - 10,
        expiresAt: now + 3_600
    };
    const options = {
        readState,
        actions,
        execute,
        now: () => now,
        candidateSha: scope.candidateSha,
        scope,
        approval: {
            owner: 'release-owner',
            leaseId: 'lease-1',
            candidateSha: scope.candidateSha,
            baseSha: scope.baseSha,
            scopeHash: stableHash(scope),
            actions: scope.actions.map(action => action.name),
            expiresAt: now + 3_600
        },
        publisher: { publish: async ({ action, ...context }) => action.apply(context) },
        reviewedBaseline: {
            source: 'reviewed-production-readback.json',
            reviewedAt: '2026-09-16T00:00:00.000Z',
            candidateSha: scope.candidateSha,
            baseSha: scope.baseSha,
            scopeHash: stableHash(scope),
            state: clone(expectedState === undefined ? {} : expectedState),
            stateHash: stableHash(expectedState === undefined ? {} : expectedState)
        },
        evidenceDir: null
    };
    if (expectedState !== undefined) options.expectedState = clone(expectedState);
    options.leaseProvider = {
        async acquire() { return clone(lease); },
        async renew(lease) { return clone(lease); },
        async release() {}
    };
    return options;
}

function action(name, resource, apply, expectedStateAfter = ({ before }) => before) {
    return {
        name,
        resource,
        apply,
        expectedStateAfter
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
        }, { hosting: { version: 'v2', uploads: 0, released: false } }),
        action('upload', 'hosting', async () => {
            applied.push('upload');
            state.hosting.uploads += 1;
        }, { hosting: { version: 'v2', uploads: 1, released: false } }),
        action('release', 'hosting', async () => {
            applied.push('release');
            state.hosting.released = true;
        }, { hosting: { version: 'v2', uploads: 1, released: true } })
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
        actions,
        expectedState: clone(state)
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

function reviewedReleaseOptions({ readState, actions, now = 1_000, baseline = {}, leaseProvider, publisher, approvalOverrides = {} } = {}) {
    const scope = {
        candidateSha: 'candidate-sha',
        baseSha: 'base-sha',
        actions: actions.map(item => ({ name: item.name, resource: item.resource }))
    };
    const lease = {
        leaseId: 'lease-1',
        owner: 'release-owner',
        candidateSha: scope.candidateSha,
        baseSha: scope.baseSha,
        scopeHash: stableHash(scope),
        resources: actions.map(item => item.resource),
        acquiredAt: now - 10,
        expiresAt: now + 100
    };
    return {
        readState,
        actions,
        execute: true,
        now: () => now,
        candidateSha: scope.candidateSha,
        scope,
        leaseProvider,
        publisher,
        reviewedBaseline: {
            source: 'reviewed-production-readback.json',
            reviewedAt: '2026-09-16T00:00:00.000Z',
            candidateSha: scope.candidateSha,
            baseSha: scope.baseSha,
            scopeHash: stableHash(scope),
            state: clone(baseline),
            stateHash: stableHash(baseline)
        },
        approval: {
            owner: lease.owner,
            leaseId: lease.leaseId,
            candidateSha: scope.candidateSha,
            baseSha: scope.baseSha,
            scopeHash: stableHash(scope),
            actions: scope.actions.map(item => item.name),
            expiresAt: now + 100,
            ...approvalOverrides
        },
        evidenceDir: null,
        _lease: lease
    };
}

function fakeLeaseProvider(lease, events = []) {
    return {
        async acquire(request) { events.push(['acquire', request]); return clone(lease); },
        async renew(current) {
            events.push(['renew', current.leaseId]);
            return { ...clone(lease), acquiredAt: current.acquiredAt, expiresAt: current.expiresAt };
        },
        async release(current) { events.push(['release', current.leaseId]); }
    };
}

test('execution requires an externally backed lease provider', async () => {
    const actions = [{ name: 'version-create', resource: 'hosting', apply: async () => {} }];
    const options = reviewedReleaseOptions({ readState: async () => ({}), actions, baseline: {} });
    delete options.leaseProvider;

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'LEASE_PROVIDER_REQUIRED'
    );
});

test('execution requires a reviewed baseline and does not adopt the first read', async () => {
    const state = { hosting: { version: 'reviewed-v1' } };
    const actions = [{
        name: 'version-create', resource: 'hosting', apply: async () => {},
        expectedStateAfter: { hosting: { version: 'reviewed-v2' } }
    }];
    const scope = { candidateSha: 'candidate-sha', baseSha: 'base-sha', actions: [{ name: 'version-create', resource: 'hosting' }] };
    const lease = {
        leaseId: 'lease-1', owner: 'release-owner', candidateSha: scope.candidateSha, baseSha: scope.baseSha,
        scopeHash: stableHash(scope), resources: ['hosting'], acquiredAt: 990, expiresAt: 1100
    };
    const options = reviewedReleaseOptions({
        readState: async () => clone(state), actions, baseline: state,
        leaseProvider: fakeLeaseProvider(lease),
        publisher: { publish: async ({ action, ...context }) => action.apply(context) }
    });
    delete options.reviewedBaseline;

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'BASELINE_REVIEW_REQUIRED'
    );
});

test('lease is renewed around every publication boundary and expiry fails closed', async () => {
    const state = { hosting: { version: 'v1' } };
    const actions = [
        { name: 'version-create', resource: 'hosting', apply: async () => {}, expectedStateAfter: clone(state) },
        { name: 'version-release', resource: 'hosting', apply: async () => {}, expectedStateAfter: clone(state) }
    ];
    const events = [];
    const options = reviewedReleaseOptions({
        readState: async () => clone(state), actions, baseline: state,
        leaseProvider: fakeLeaseProvider({
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: 'candidate-sha', baseSha: 'base-sha',
            scopeHash: stableHash({ candidateSha: 'candidate-sha', baseSha: 'base-sha', actions: actions.map(item => ({ name: item.name, resource: item.resource })) }),
            resources: ['hosting'], acquiredAt: 990, expiresAt: 1001
        }, events),
        publisher: { publish: async ({ action, ...context }) => action.apply(context) }
    });
    let renewals = 0;
    const provider = options.leaseProvider;
    options.leaseProvider = {
        ...provider,
        async renew(current) {
            renewals += 1;
            if (renewals === 3) throw new ReleaseGateError('LEASE_EXPIRED', 'lease expired during rehearsal');
            return provider.renew(current);
        }
    };

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'LEASE_EXPIRED'
    );
    assert.equal(events.filter(([kind]) => kind === 'release').length, 1);
    assert.ok(renewals >= 3);
});

test('execution requires an explicit approved post-mutation state', async () => {
    const state = { gateway: { revision: 'r1' } };
    const actionWithoutExpectation = { name: 'gateway-deploy', resource: 'gateway', apply: async () => {} };
    const options = reviewedReleaseOptions({
        readState: async () => clone(state), actions: [actionWithoutExpectation], baseline: state,
        leaseProvider: fakeLeaseProvider({
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: 'candidate-sha', baseSha: 'base-sha',
            scopeHash: stableHash({ candidateSha: 'candidate-sha', baseSha: 'base-sha', actions: [{ name: 'gateway-deploy', resource: 'gateway' }] }),
            resources: ['gateway'], acquiredAt: 990, expiresAt: 1100
        }),
        publisher: { publish: async ({ action, ...context }) => action.apply(context) }
    });

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'EXPECTED_POST_STATE_REQUIRED'
    );
});

test('execution rejects approval without a finite expiry', async () => {
    const state = { version: 'old' };
    const actions = [action('version-create', 'hosting', async () => ({ version: 'new' }), { version: 'new' })];
    const options = reviewedReleaseOptions({
        readState: async () => clone(state), actions, baseline: state,
        leaseProvider: fakeLeaseProvider({
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: 'candidate-sha', baseSha: 'base-sha',
            scopeHash: stableHash({ candidateSha: 'candidate-sha', baseSha: 'base-sha', actions: [{ name: 'version-create', resource: 'hosting' }] }),
            resources: ['hosting'], acquiredAt: 990, expiresAt: 1100
        }),
        publisher: { publish: async ({ action, ...context }) => action.apply(context) },
        approvalOverrides: { expiresAt: undefined }
    });

    await assert.rejects(
        createReleaseDriver(options).run(),
        error => error instanceof ReleaseGateError && error.code === 'APPROVAL_EXPIRED'
    );
});

test('dry-run publisher adapter cannot publish until a real publisher is configured', async () => {
    await assert.rejects(
        createDryRunPublisherAdapter().publish({}),
        error => error instanceof ReleaseGateError && error.code === 'PROVIDER_REQUIRED'
    );
});

test('file lease provider persists acquisition, renewal, expiry, and release externally', async () => {
    const os = require('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-release-lease-'));
    const leasePath = path.join(root, 'publisher-lease.json');
    let clock = 1_000;
    const provider = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlMs: 100 });
    try {
        const lease = await provider.acquire({ owner: 'owner', candidateSha: 'candidate', baseSha: 'base', scopeHash: 'scope', resources: ['hosting'] });
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).leaseId, lease.leaseId);
        clock = 1_050;
        const renewed = await provider.renew(lease);
        assert.equal(renewed.expiresAt, 1_150);
        clock = 1_151;
        await assert.rejects(provider.renew(renewed), error => error.code === 'LEASE_EXPIRED');
        await provider.release(renewed);
        assert.equal(fs.existsSync(leasePath), false);
    } finally {
        if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    }
});

test('production rehearsal accepts a valid HTTPS origin with a test DNS suffix', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-rehearsal-policy-'));
    const accountsPath = path.join(root, 'accounts.json');
    const evidencePath = path.join(root, 'evidence');
    const account = index => ({ uid: `uid-${index}`, email: `user-${index}@example.test`, password: `safe-password-${index}` });
    fs.writeFileSync(accountsPath, JSON.stringify({
        mode: 'production-approved',
        approved: true,
        projectId: 'listening-tasks-3ae34',
        accounts: {
            presenter: account('presenter'),
            participants: [account('p1'), account('p2'), account('p3')],
            negative: account('negative')
        }
    }));
    try {
        const script = path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py');
        const args = [
            script, '--channel', 'chrome', '--role', 'presenter', '--validate-only',
            '--base-url', 'https://demo.example.test/presentation',
            '--accounts-file', accountsPath, '--evidence', evidencePath
        ];
        const result = childProcess.spawnSync('python', args, { encoding: 'utf8' });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /"success": true/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('production rehearsal validates the four-player scenario contract without opening Chrome', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-rehearsal-four-player-'));
    const accountsPath = path.join(root, 'accounts.json');
    const evidencePath = path.join(root, 'evidence');
    const approvalPath = path.join(root, 'approval.json');
    const leasePath = path.join(root, 'lease.json');
    const manifestPath = path.join(root, 'candidate-manifest.json');
    const account = index => ({ uid: `uid-${index}`, email: `user-${index}@example.test`, password: `safe-password-${index}` });
    const scenarios = [
        'normal-crm-launch', 'open-presentation-demo', 'room-create', 'room-join-p1', 'room-join-p2', 'room-join-p3',
        'game-connect-p0', 'game-connect-p1', 'game-connect-p2', 'game-connect-p3', 'progression', 'reconnect',
        'notes-p1', 'notes-p2', 'notes-p3', 'end-room', 'pdf-export'
    ];
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    fs.writeFileSync(accountsPath, JSON.stringify({
        mode: 'production-approved', approved: true, projectId: 'listening-tasks-3ae34',
        accounts: { presenter: account('presenter'), participants: [account('p1'), account('p2'), account('p3')], negative: account('negative') }
    }));
    const common = { candidateSha: 'candidate-sha', baseSha: 'base-sha', scopeHash: 'scope-hash', leaseId: 'lease-1', expiresAt };
    fs.writeFileSync(approvalPath, JSON.stringify({
        mode: 'production-approved', owner: 'release-owner', ...common,
        actions: scenarios,
        scenarios: Object.fromEntries(scenarios.map(action => [action, { action, ...common }]))
    }));
    fs.writeFileSync(leasePath, JSON.stringify({ state: 'ACTIVE', owner: 'release-owner', ...common }));
    fs.writeFileSync(manifestPath, JSON.stringify({ revision: 'candidate-sha', files: { 'public/presentation-demo/index.html': '0'.repeat(64) } }));
    try {
        const script = path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py');
        const args = [
            script, '--channel', 'chrome', '--role', 'presenter', '--four-player', '--validate-only', '--allow-live-writes',
            '--base-url', 'https://demo.example.test/presentation', '--accounts-file', accountsPath, '--evidence', evidencePath,
            '--approval-file', approvalPath, '--lease-file', leasePath, '--candidate-manifest', manifestPath,
            '--candidate-sha', 'candidate-sha', '--base-sha', 'base-sha', '--scope-hash', 'scope-hash'
        ];
        const result = childProcess.spawnSync('python', args, { encoding: 'utf8' });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /four-player-progression-reconnect-notes-pdf/);
        assert.match(result.stdout, /"candidate"/);

        fs.writeFileSync(leasePath, JSON.stringify({ owner: 'release-owner', ...common }));
        const missingState = childProcess.spawnSync('python', args, { encoding: 'utf8' });
        assert.notEqual(missingState.status, 0);
        assert.match(`${missingState.stdout}\n${missingState.stderr}`, /publisher lease is expired or inactive/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
