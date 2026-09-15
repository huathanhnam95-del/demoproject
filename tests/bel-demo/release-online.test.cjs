'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    createReleaseDriver,
    createDryRunPublisherAdapter,
    createFileLeaseProvider,
    createRollbackManifest,
    ReleaseGateError,
    stableHash
} = require('../../scripts/bel-demo/release-online.cjs');

const CANDIDATE_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const SCOPE_HASH = 'c'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));

function approvedOptions({ readState, actions, execute = true, now = 1_000, expectedState } = {}) {
    const scope = {
        candidateSha: CANDIDATE_SHA,
        baseSha: BASE_SHA,
        actions: actions.map(action => ({ name: action.name, resource: action.resource }))
    };
    const lease = {
        schemaVersion: 1,
        expiryUnit: 'epoch-seconds',
        operationId: 'operation-1',
        operationState: 'pending',
        state: 'ACTIVE',
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
            schemaVersion: 1,
            expiryUnit: 'epoch-seconds',
            resources: [...new Set(actions.map(action => action.resource))],
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
        async release() {},
        async markUnresolved(lease, details) { return { ...clone(lease), operationState: 'uncertain', state: 'HOLD', failure: details }; }
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
        candidateSha: CANDIDATE_SHA,
        baseSha: BASE_SHA,
        actions: actions.map(item => ({ name: item.name, resource: item.resource }))
    };
    const lease = {
        schemaVersion: 1,
        expiryUnit: 'epoch-seconds',
        operationId: 'operation-1',
        operationState: 'pending',
        state: 'ACTIVE',
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
            schemaVersion: 1,
            expiryUnit: 'epoch-seconds',
            resources: [...new Set(actions.map(item => item.resource))],
            expiresAt: now + 100,
            ...approvalOverrides
        },
        evidenceDir: null,
        _lease: lease
    };
}

function fakeLeaseProvider(lease, events = []) {
    const normalizedLease = {
        schemaVersion: 1,
        expiryUnit: 'epoch-seconds',
        operationId: lease.operationId || 'operation-1',
        operationState: 'pending',
        state: 'ACTIVE',
        ...lease
    };
    return {
        async acquire(request) { events.push(['acquire', request]); return clone(normalizedLease); },
        async renew(current) {
            events.push(['renew', current.leaseId]);
            return { ...clone(normalizedLease), acquiredAt: current.acquiredAt, expiresAt: current.expiresAt };
        },
        async release(current) { events.push(['release', current.leaseId]); },
        async markUnresolved(current, details) { events.push(['unresolved', current.operationId, details.code]); return { ...clone(current), operationState: 'uncertain', state: 'HOLD' }; }
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
    const scope = { candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, actions: [{ name: 'version-create', resource: 'hosting' }] };
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
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA,
            scopeHash: stableHash({ candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, actions: actions.map(item => ({ name: item.name, resource: item.resource })) }),
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
    assert.equal(events.filter(([kind]) => kind === 'release').length, 0, 'post-publish lease loss must retain the unresolved hold');
    assert.ok(renewals >= 3);
});

test('execution requires an explicit approved post-mutation state', async () => {
    const state = { gateway: { revision: 'r1' } };
    const actionWithoutExpectation = { name: 'gateway-deploy', resource: 'gateway', apply: async () => {} };
    const options = reviewedReleaseOptions({
        readState: async () => clone(state), actions: [actionWithoutExpectation], baseline: state,
        leaseProvider: fakeLeaseProvider({
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA,
            scopeHash: stableHash({ candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, actions: [{ name: 'gateway-deploy', resource: 'gateway' }] }),
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
            leaseId: 'lease-1', owner: 'release-owner', candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA,
            scopeHash: stableHash({ candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, actions: [{ name: 'version-create', resource: 'hosting' }] }),
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
    const provider = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlSeconds: 100 });
    try {
        const lease = await provider.acquire({ owner: 'owner', candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, scopeHash: SCOPE_HASH, resources: ['hosting'] });
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).leaseId, lease.leaseId);
        clock = 1_050;
        const renewed = await provider.renew(lease);
        assert.equal(renewed.expiresAt, 1_150);
        clock = 1_151;
        const lateRenewed = await provider.renew(renewed);
        assert.equal(lateRenewed.expiresAt, 1_251, 'the owner may renew an expired pending operation while takeover remains blocked');
        const unresolved = await provider.markUnresolved(lateRenewed, { code: 'PUBLISH_AMBIGUOUS' });
        await assert.rejects(provider.release(unresolved), error => error.code === 'LEASE_UNRESOLVED');
        await provider.resolveUnresolved(unresolved);
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
    const identitiesPath = path.join(root, 'deployed-identities.json');
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
    const candidateSha = CANDIDATE_SHA;
    const baseSha = BASE_SHA;
    const scopeHash = SCOPE_HASH;
    const state = { hosting: { version: 'reviewed-v1' } };
    const stateHash = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const common = { schemaVersion: 1, expiryUnit: 'epoch-seconds', candidateSha, baseSha, scopeHash, leaseId: 'lease-1', operationId: 'operation-1', expiresAt, owner: 'release-owner', resources: ['hosting'], expectedStateHash: stateHash };
    fs.writeFileSync(approvalPath, JSON.stringify({
        mode: 'production-approved', owner: 'release-owner', ...common,
        actions: scenarios,
        scenarios: Object.fromEntries(scenarios.map(action => [action, { action, ...common }]))
    }));
    fs.writeFileSync(leasePath, JSON.stringify({ ...common, operationId: 'operation-1', operationState: 'pending', state: 'ACTIVE' }));
    const candidateFile = path.resolve(__dirname, '../../public/presentation-demo/index.html');
    const candidateDigest = crypto.createHash('sha256').update(fs.readFileSync(candidateFile)).digest('hex');
    fs.writeFileSync(manifestPath, JSON.stringify({ revision: candidateSha, files: { 'public/presentation-demo/index.html': candidateDigest } }));
    fs.writeFileSync(identitiesPath, JSON.stringify({ schemaVersion: 1, expiryUnit: 'epoch-seconds', owner: 'release-owner', resources: ['hosting'], candidateSha, baseSha, scopeHash, readAt: Math.floor(Date.now() / 1000), state, stateHash }));
    try {
        const script = path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py');
        const args = [
            script, '--channel', 'chrome', '--role', 'presenter', '--four-player', '--validate-only', '--allow-live-writes',
            '--base-url', 'https://demo.example.test/presentation', '--accounts-file', accountsPath, '--evidence', evidencePath,
            '--approval-file', approvalPath, '--lease-file', leasePath, '--candidate-manifest', manifestPath,
            '--deployed-identities', identitiesPath, '--candidate-sha', candidateSha, '--base-sha', baseSha, '--scope-hash', scopeHash
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

test('file lease blocks takeover after expiry while a publication operation is still pending', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-release-pending-'));
    const leasePath = path.join(root, 'publisher-lease.json');
    let clock = 1_000;
    const first = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlSeconds: 2 });
    const second = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlSeconds: 2 });
    try {
        const lease = await first.acquire({ owner: 'owner-1', candidateSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), scopeHash: 'c'.repeat(64), resources: ['hosting'] });
        assert.equal(lease.expiryUnit, 'epoch-seconds');
        assert.equal(lease.operationState, 'pending');
        clock = 1_003;
        await assert.rejects(second.acquire({ owner: 'owner-2', candidateSha: 'd'.repeat(40), baseSha: 'e'.repeat(40), scopeHash: 'f'.repeat(64), resources: ['hosting'] }), error => error.code === 'LEASE_BUSY');
        const renewed = await first.renew(lease);
        assert.ok(renewed.expiresAt > clock);
        await first.release(renewed);
    } finally {
        if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    }
});

test('file lease acquisition and renewal races serialize without split ownership', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-release-race-'));
    const leasePath = path.join(root, 'publisher-lease.json');
    let clock = 2_000;
    const providerA = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlSeconds: 20 });
    const providerB = createFileLeaseProvider({ path: leasePath, now: () => clock, ttlSeconds: 20 });
    const request = owner => ({ owner, candidateSha: CANDIDATE_SHA, baseSha: BASE_SHA, scopeHash: SCOPE_HASH, resources: ['hosting'] });
    try {
        const acquisitions = await Promise.allSettled([providerA.acquire(request('owner-a')), providerB.acquire(request('owner-b'))]);
        assert.equal(acquisitions.filter(item => item.status === 'fulfilled').length, 1);
        assert.equal(acquisitions.filter(item => item.status === 'rejected' && item.reason.code === 'LEASE_BUSY').length, 1);
        const lease = acquisitions.find(item => item.status === 'fulfilled').value;
        clock += 1;
        const renewals = await Promise.all([providerA.renew(lease), providerA.renew(lease)]);
        assert.ok(renewals.every(item => item.expiresAt > clock));
        assert.equal(JSON.parse(fs.readFileSync(leasePath, 'utf8')).leaseId, lease.leaseId);
        await providerA.release(renewals.at(-1));
    } finally {
        if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    }
});

test('release driver renews a lease during a long publication and retains an unresolved operation after ambiguity', async () => {
    const candidateSha = '1'.repeat(40);
    const baseSha = '2'.repeat(40);
    const scope = { candidateSha, baseSha, actions: [{ name: 'hosting-publish', resource: 'hosting' }] };
    const lease = {
        schemaVersion: 1, expiryUnit: 'epoch-seconds', operationId: 'op-1', operationState: 'pending', state: 'ACTIVE',
        leaseId: 'lease-1', owner: 'release-owner', candidateSha, baseSha, scopeHash: stableHash(scope), resources: ['hosting'],
        acquiredAt: 1_000, expiresAt: 1_060
    };
    const events = [];
    const provider = {
        async acquire() { return clone(lease); },
        async renew(current) { events.push('renew'); return { ...clone(current), expiresAt: current.expiresAt + 60 }; },
        async release() { events.push('release'); },
        async markUnresolved(current, details) { events.push(['unresolved', current.operationId, details.code]); return { ...clone(current), operationState: 'uncertain', state: 'HOLD' }; }
    };
    const options = {
        readState: async () => ({}), actions: [{
            name: 'hosting-publish', resource: 'hosting', apply: async () => {}, expectedStateAfter: {}
        }], execute: true, now: () => 1_000, candidateSha, scope,
        leaseProvider: provider, leaseHeartbeatMs: 10, publisher: { publish: async () => { await new Promise(resolve => setTimeout(resolve, 50)); throw new ReleaseGateError('PUBLISH_AMBIGUOUS', 'completion was uncertain'); } },
        reviewedBaseline: { source: 'reviewed.json', reviewedAt: '2026-09-16T00:00:00.000Z', candidateSha, baseSha, scopeHash: stableHash(scope), state: {}, stateHash: stableHash({}) },
        approval: { schemaVersion: 1, owner: 'release-owner', leaseId: 'lease-1', candidateSha, baseSha, scopeHash: stableHash(scope), actions: ['hosting-publish'], resources: ['hosting'], expiryUnit: 'epoch-seconds', expiresAt: 2_000 }
    };
    await assert.rejects(createReleaseDriver(options).run(), error => error.code === 'PUBLISH_AMBIGUOUS');
    assert.ok(events.filter(event => event === 'renew').length > 3, 'long publication must have heartbeat renewals');
    assert.deepEqual(events.at(-1), ['unresolved', 'op-1', 'PUBLISH_AMBIGUOUS']);
    assert.equal(events.includes('release'), false, 'ambiguous completion must retain the external hold for reconciliation');
});

test('release driver does not retry or republish after ownership is lost during an in-flight operation', async () => {
    const candidateSha = '3'.repeat(40);
    const baseSha = '4'.repeat(40);
    const scope = { candidateSha, baseSha, actions: [{ name: 'gateway-publish', resource: 'gateway' }] };
    const lease = {
        schemaVersion: 1, expiryUnit: 'epoch-seconds', operationId: 'op-2', operationState: 'pending', state: 'ACTIVE',
        leaseId: 'lease-2', owner: 'release-owner', candidateSha, baseSha, scopeHash: stableHash(scope), resources: ['gateway'],
        acquiredAt: 1_000, expiresAt: 1_060
    };
    let publishes = 0; let renewals = 0; let unresolved = 0; let released = 0;
    const options = {
        readState: async () => ({}), actions: [{ name: 'gateway-publish', resource: 'gateway', apply: async () => {}, expectedStateAfter: {} }],
        execute: true, now: () => 1_000, candidateSha, scope, leaseHeartbeatMs: 10,
        leaseProvider: {
            async acquire() { return clone(lease); },
            async renew(current) { renewals += 1; if (renewals > 3) throw new ReleaseGateError('LEASE_LOST', 'ownership lost'); return clone(current); },
            async release() { released += 1; },
            async markUnresolved() { unresolved += 1; }
        },
        publisher: { publish: async () => { publishes += 1; await new Promise(resolve => setTimeout(resolve, 50)); return {}; } },
        reviewedBaseline: { source: 'reviewed.json', reviewedAt: '2026-09-16T00:00:00.000Z', candidateSha, baseSha, scopeHash: stableHash(scope), state: {}, stateHash: stableHash({}) },
        approval: { schemaVersion: 1, owner: 'release-owner', leaseId: 'lease-2', candidateSha, baseSha, scopeHash: stableHash(scope), actions: ['gateway-publish'], resources: ['gateway'], expiryUnit: 'epoch-seconds', expiresAt: 2_000 }
    };
    await assert.rejects(createReleaseDriver(options).run(), error => error.code === 'LEASE_LOST');
    assert.equal(publishes, 1);
    assert.equal(unresolved, 1);
    assert.equal(released, 0);
});

test('production rehearsal binds every manifest digest to the exact local candidate bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-manifest-binding-'));
    const manifestPath = path.join(root, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ revision: CANDIDATE_SHA, files: { 'public/crm-admin.html': '0'.repeat(64) } }));
    const script = `import importlib.util, sys\nfrom argparse import Namespace\nspec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])\nmodule = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\ntry:\n    module.validate_candidate_manifest(Namespace(candidate_sha=sys.argv[3]), module.Path(sys.argv[2]))\nexcept module.RehearsalError as error:\n    print(error)\n    raise SystemExit(0)\nraise SystemExit(1)`;
    try {
        const result = childProcess.spawnSync('python', ['-c', script, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py'), manifestPath, CANDIDATE_SHA], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /does not match candidate bytes/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('production rehearsal revalidates the full approval and fresh provider state before any mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-rehearsal-freshness-'));
    const approvalPath = path.join(root, 'approval.json');
    const leasePath = path.join(root, 'lease.json');
    const candidateSha = CANDIDATE_SHA;
    const baseSha = BASE_SHA;
    const scopeHash = SCOPE_HASH;
    const state = { deployed: 'v1' };
    const stateHash = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    const scenario = {
        action: 'normal-crm-launch', schemaVersion: 1, expiryUnit: 'epoch-seconds', owner: 'owner', leaseId: 'lease', operationId: 'operation',
        candidateSha, baseSha, scopeHash, resources: ['hosting'], expiresAt: now + 3600, expectedState: state, expectedStateHash: stateHash
    };
    const approval = {
        mode: 'production-approved', schemaVersion: 1, expiryUnit: 'epoch-seconds', owner: 'owner', leaseId: 'lease', candidateSha, baseSha, scopeHash,
        resources: ['hosting'], actions: ['normal-crm-launch', 'open-presentation-demo'], expiresAt: now + 3600, scenarios: { 'normal-crm-launch': scenario }
    };
    const lease = { schemaVersion: 1, expiryUnit: 'epoch-seconds', operationId: 'operation', operationState: 'pending', state: 'ACTIVE', owner: 'owner', leaseId: 'lease', candidateSha, baseSha, scopeHash, resources: ['hosting'], expiresAt: now + 3600 };
    fs.writeFileSync(approvalPath, JSON.stringify(approval));
    fs.writeFileSync(leasePath, JSON.stringify(lease));
    const script = `import importlib.util, json, sys, time\nfrom argparse import Namespace\nspec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])\nmodule = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\nargs = Namespace(candidate_sha=sys.argv[4], base_sha=sys.argv[6], scope_hash=sys.argv[7], four_player=False, create_room=False, room_code=None, open_game=False, role='presenter', lease_file=sys.argv[3], deployed_identities=None, deployed_identities_url=None, validate_only=False, _fresh_deployed_reads=[])\napproval_path = module.Path(sys.argv[2])\nlease_path = module.Path(sys.argv[3])\nprovider_state = {'schemaVersion': 1, 'expiryUnit': 'epoch-seconds', 'owner': 'owner', 'resources': ['hosting'], 'candidateSha': args.candidate_sha, 'baseSha': args.base_sha, 'scopeHash': args.scope_hash, 'readAt': time.time(), 'state': {'deployed': 'v1'}, 'stateHash': module.stable_hash({'deployed': 'v1'}), 'source': 'https://provider.example/identities'}\nmutation_count = 0\ndef provider(scenario):\n    value = dict(provider_state)\n    value['readAt'] = time.time()\n    value['state'] = dict(provider_state['state'])\n    value['stateHash'] = module.stable_hash(value['state'])\n    return value\ndef check(name, mutate):\n    global mutation_count\n    approval = json.loads(approval_path.read_text())\n    lease = json.loads(lease_path.read_text())\n    mutate(approval, lease, provider_state)\n    approval_path.write_text(json.dumps(approval))\n    lease_path.write_text(json.dumps(lease))\n    try:\n        module.validate_scenario_approval(args, approval_path, 'normal-crm-launch', provider)\n    except module.RehearsalError:\n        print(name)\n        return\n    mutation_count += 1\n    raise SystemExit('expected rejection: '+name)\nmodule.validate_scenario_approval(args, approval_path, 'normal-crm-launch', provider)\nfor name, mutate in [('drift', lambda approval, lease, identity: (identity.update({'state': {'deployed': 'drifted'}}))), ('ownership-loss', lambda approval, lease, identity: lease.update({'owner': 'other'})), ('scope-mismatch', lambda approval, lease, identity: identity.update({'candidateSha': 'b' * 40})), ('revoked-approval', lambda approval, lease, identity: approval.update({'mode': 'revoked'})), ('expired-approval', lambda approval, lease, identity: approval.update({'expiresAt': time.time() - 1})), ('nan-expiry', lambda approval, lease, identity: approval.update({'expiresAt': 'NaN'})), ('infinity-expiry', lambda approval, lease, identity: approval.update({'expiresAt': 'Infinity'}))]:\n    approval = json.loads(approval_path.read_text()) if False else None\n    approval_path.write_text(json.dumps(${JSON.stringify(approval)}))\n    lease_path.write_text(json.dumps(${JSON.stringify(lease)}))\n    provider_state.update({'owner': 'owner', 'candidateSha': args.candidate_sha, 'state': {'deployed': 'v1'}})\n    check(name, mutate)\nprint('provider-read-count='+str(len(args._fresh_deployed_reads)))\nassert mutation_count == 0\nprint('freshness-matrix-passed')`;
    const adaptedScript = script.replace(
        "    value = dict(provider_state)\n    value['readAt'] = time.time()",
        "    value = dict(provider_state)\n    value['requestNonce'] = 'callback-request'\n    value['_providerRequest'] = {'requestNonce': value['requestNonce'], 'requestStartedAt': time.time() - 0.01, 'requestCompletedAt': time.time() + 0.01}\n    value['readAt'] = time.time()"
    );
    try {
        const result = childProcess.spawnSync('python', ['-c', adaptedScript, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py'), approvalPath, leasePath, candidateSha, candidateSha, baseSha, scopeHash], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        for (const marker of ['drift', 'ownership-loss', 'scope-mismatch', 'revoked-approval', 'expired-approval', 'nan-expiry', 'infinity-expiry', 'provider-read-count=1', 'freshness-matrix-passed']) assert.match(result.stdout, new RegExp(marker));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rollback reconciliation applies only the approved inverse delta and preserves an intervening unrelated release', () => {
    const interveningCurrent = {
        'public/crm-admin.html': 'intervening-crm-release',
        'public/css/entrance-test-ui-annotations.css': 'candidate-css',
        'public/unrelated-release.txt': 'intervening-release-preserved'
    };
    const reviewedCurrent = clone(interveningCurrent);
    const recovery = createRollbackManifest({
        currentFiles: interveningCurrent,
        reviewedFiles: reviewedCurrent,
        inverseOverlay: {
            'public/css/entrance-test-ui-annotations.css': 'live-baseline-css'
        }
    });
    assert.equal(recovery.files['public/css/entrance-test-ui-annotations.css'], 'live-baseline-css');
    assert.equal(recovery.files['public/unrelated-release.txt'], 'intervening-release-preserved');
    assert.equal(recovery.preservesUnrelatedCurrentState, true);
    assert.ok(recovery.preservedInterveningPaths.includes('public/unrelated-release.txt'));
    assert.throws(() => createRollbackManifest({
        currentFiles: { ...interveningCurrent, 'public/unrelated-release.txt': 'newer-than-reviewed' },
        reviewedFiles: reviewedCurrent,
        inverseOverlay: {}
    }), error => error.code === 'ROLLBACK_BASELINE_DRIFT');
});

test('production identity provider execution binds a unique request nonce and rejects a pre-request cached sample', () => {
    const script = String.raw`import importlib.util, json, sys, time
from argparse import Namespace
spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
args = Namespace(deployed_identities_url='https://provider.example/identities')
approval = {'owner': 'owner', 'resources': ['hosting'], 'candidateSha': 'a' * 40, 'baseSha': 'b' * 40, 'scopeHash': 'c' * 64}
mode = 'fresh'
headers_seen = []
class Response:
    status = 200
    def __init__(self, payload): self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return json.dumps(self.payload).encode('utf-8')
def fake_urlopen(request, timeout):
    global mode
    headers_seen.append({key.lower(): value for key, value in request.header_items()})
    nonce = request.headers.get('X-bel-request-nonce')
    state = {'deployed': 'v1'}
    read_at = time.time() if mode == 'fresh' else time.time() - 240
    return Response({'schemaVersion': 1, 'expiryUnit': 'epoch-seconds', 'owner': 'owner', 'resources': ['hosting'], 'candidateSha': 'a' * 40, 'baseSha': 'b' * 40, 'scopeHash': 'c' * 64, 'requestNonce': nonce, 'readAt': read_at, 'state': state, 'stateHash': module.stable_hash(state)})
module.urlopen = fake_urlopen
fresh = module.read_deployed_identities_provider(args, 'normal-crm-launch')
module.validate_deployed_identities(args, fresh, approval, None, provider=True)
assert fresh['_providerRequest']['requestNonce']
assert headers_seen[0]['cache-control'] == 'no-store'
assert headers_seen[0]['x-bel-request-nonce'] == fresh['_providerRequest']['requestNonce']
mode = 'stale'
stale = module.read_deployed_identities_provider(args, 'normal-crm-launch')
try:
    module.validate_deployed_identities(args, stale, approval, None, provider=True)
except module.RehearsalError as error:
    assert 'current request' in str(error) or 'stale' in str(error)
else:
    raise SystemExit('expected a pre-request cached provider sample to be rejected')
print('provider-current-request-passed')`;
    const result = childProcess.spawnSync('python', ['-c', script, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py')], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /provider-current-request-passed/);
});

test('served candidate assets map Hosting URLs to repository files and reject altered response bytes', () => {
    const script = String.raw`import importlib.util, sys
from argparse import Namespace
spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class Response:
    status = 200
    def __init__(self, url, body, content_type): self.url, self._body, self.headers = url, body, {'content-type': content_type}
    def body(self): return self._body
class Page:
    def __init__(self): self.handlers = {}
    def on(self, event, callback): self.handlers[event] = callback
    def emit(self, event, value): self.handlers[event](value)
responses = [
    Response('https://demo.example.test/presentation/crm-admin.html?v=1', b'<html>', 'text/html'),
    Response('https://demo.example.test/js/presentation-demo/app.mjs?v=1', b'import {}', 'text/javascript'),
    Response('https://demo.example.test/css/entrance-test-ui-annotations.css?v=1', b'.annotation{}', 'text/css')
]
manifest = {'files': {response_url: module.hashlib.sha256(body).hexdigest() for response_url, body in [
    ('public/crm-admin.html', responses[0]._body), ('public/js/presentation-demo/app.mjs', responses[1]._body), ('public/css/entrance-test-ui-annotations.css', responses[2]._body)
]}}
assert module.hosting_url_to_repo_path(responses[0].url, 'https://demo.example.test/presentation') == 'public/crm-admin.html'
assert module.hosting_url_to_repo_path(responses[1].url, 'https://demo.example.test/presentation') == 'public/js/presentation-demo/app.mjs'
diagnostics = {}
page = Page()
module.attach_page_diagnostics(page, diagnostics, 'presenter', 'crm', 'https://demo.example.test/presentation', manifest)
for response in responses: page.emit('response', response)
result = {}
module.assert_candidate_assets(diagnostics, 'presenter', 'crm', manifest, result)
assert len(result['browserServedCandidateAssets']) == 3
altered = Page()
altered_diagnostics = {}
module.attach_page_diagnostics(altered, altered_diagnostics, 'presenter', 'crm', 'https://demo.example.test/presentation', manifest)
altered.emit('response', Response(responses[0].url, b'<altered>', 'text/html'))
try:
    module.assert_candidate_assets(altered_diagnostics, 'presenter', 'crm', manifest, {})
except module.RehearsalError as error:
    assert 'candidate manifest' in str(error) or 'candidate' in str(error)
else:
    raise SystemExit('expected altered served bytes to be rejected')
print('served-asset-mapping-passed')`;
    const result = childProcess.spawnSync('python', ['-c', script, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py')], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /served-asset-mapping-passed/);
});

test('Chrome rehearsal reads notebook persistence from the authoritative server endpoint', () => {
    const script = String.raw`import importlib.util, sys
spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class Page:
    def evaluate(self, source, payload):
        assert 'fetch' in source and 'getIdToken' in source
        assert payload == {'roomId': 'room-1', 'uid': 'uid-1'}
        return {'status': 200, 'body': {'success': True, 'data': {'pages': [{'id': 'main', 'title': 'Server', 'body': 'Authoritative'}]}}}
notes = module.read_authoritative_notes(Page(), 'room-1', 'uid-1')
assert notes['pages'][0]['body'] == 'Authoritative'
print('authoritative-notes-readback-passed')`;
    const result = childProcess.spawnSync('python', ['-c', script, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py')], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /authoritative-notes-readback-passed/);
});

test('intervening provider deployment drift is rejected before the next approved mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-rehearsal-provider-drift-'));
    const approvalPath = path.join(root, 'approval.json');
    const leasePath = path.join(root, 'lease.json');
    const candidateSha = CANDIDATE_SHA;
    const baseSha = BASE_SHA;
    const scopeHash = SCOPE_HASH;
    const state = { deployed: 'v1' };
    const stateHash = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    const scenario = {
        action: 'normal-crm-launch', schemaVersion: 1, expiryUnit: 'epoch-seconds', owner: 'owner', leaseId: 'lease', operationId: 'operation',
        candidateSha, baseSha, scopeHash, resources: ['hosting'], expiresAt: now + 3600, expectedState: state, expectedStateHash: stateHash
    };
    const approval = {
        mode: 'production-approved', schemaVersion: 1, expiryUnit: 'epoch-seconds', owner: 'owner', leaseId: 'lease', candidateSha, baseSha, scopeHash,
        resources: ['hosting'], actions: ['normal-crm-launch', 'open-presentation-demo'], expiresAt: now + 3600, scenarios: { 'normal-crm-launch': scenario }
    };
    const lease = { schemaVersion: 1, expiryUnit: 'epoch-seconds', operationId: 'operation', operationState: 'pending', state: 'ACTIVE', owner: 'owner', leaseId: 'lease', candidateSha, baseSha, scopeHash, resources: ['hosting'], expiresAt: now + 3600 };
    fs.writeFileSync(approvalPath, JSON.stringify(approval));
    fs.writeFileSync(leasePath, JSON.stringify(lease));
    const script = String.raw`import importlib.util, json, sys, time
from argparse import Namespace
spec = importlib.util.spec_from_file_location('rehearsal', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
args = Namespace(candidate_sha=sys.argv[4], base_sha=sys.argv[6], scope_hash=sys.argv[7], four_player=False, create_room=False, room_code=None, open_game=False, role='presenter', lease_file=sys.argv[3], deployed_identities=None, deployed_identities_url='https://provider.example/identities', validate_only=False, _fresh_deployed_reads=[])
approval_path = module.Path(sys.argv[2])
lease_path = module.Path(sys.argv[3])
provider_state = {'deployed': 'v1'}
provider_calls = 0
mutation_count = 0
class Response:
    status = 200
    def __init__(self, payload): self.payload = payload
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return json.dumps(self.payload).encode('utf-8')
def fake_urlopen(request, timeout):
    global provider_calls
    provider_calls += 1
    nonce = request.headers.get('X-bel-request-nonce')
    read_at = time.time()
    return Response({'schemaVersion': 1, 'expiryUnit': 'epoch-seconds', 'owner': 'owner', 'resources': ['hosting'], 'candidateSha': args.candidate_sha, 'baseSha': args.base_sha, 'scopeHash': args.scope_hash, 'requestNonce': nonce, 'readAt': read_at, 'state': dict(provider_state), 'stateHash': module.stable_hash(provider_state)})
module.urlopen = fake_urlopen
module.validate_scenario_approval(args, approval_path, 'normal-crm-launch')
mutation_count += 1
provider_state['deployed'] = 'v2'
try:
    module.validate_scenario_approval(args, approval_path, 'normal-crm-launch')
except module.RehearsalError as error:
    assert 'expected state' in str(error) or 'deployed state' in str(error)
else:
    raise SystemExit('expected intervening provider deployment drift to be rejected')
assert mutation_count == 1
assert provider_calls == 2
print('provider-drift-blocked-before-mutation')`;
    try {
        const result = childProcess.spawnSync('python', ['-c', script, path.resolve(__dirname, '../browser/bel-demo-online/production_rehearsal.py'), approvalPath, leasePath, candidateSha, candidateSha, baseSha, scopeHash], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /provider-drift-blocked-before-mutation/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('the Chrome J table-corridor planner reaches all three participant cube pairs with real movement geometry', async () => {
    const [{ SCENES }, geometry, simulation, cubes] = await Promise.all([
        import('../../public/js/presentation-demo/core/world/scenes.mjs'),
        import('../../public/js/presentation-demo/core/world/geometry.mjs'),
        import('../../public/js/presentation-demo/core/world/simulation.mjs'),
        import('../../public/js/presentation-demo/core/activities/cubes.mjs')
    ]);
    const { RADIUS, distance, move } = geometry;
    const { solidsFor, targets } = simulation;
    const INTERACTION_RADIUS = 48;
    const WALK_SPEED = 108;
    const SERVER_STEP_SECONDS = 0.075;
    const approaches = [
        ['p1', 'cube-1', { x: 320, y: 345 }],
        ['p2', 'cube-3', { x: 360, y: 345 }],
        ['p1', 'cube-2', { x: 320, y: 345 }],
        ['p2', 'cube-5', { x: 360, y: 345 }],
        ['p1', 'cube-0', { x: 320, y: 345 }],
        ['p2', 'cube-4', { x: 360, y: 345 }]
    ];

    function worldFor(id, start) {
        return {
            players: {
                [id]: { id, scene: 'J', instance: 'J', x: start.x, y: start.y, connected: true, ride: null, carry: null }
            },
            cubes: cubes.createCubes(),
            routes: {}
        };
    }

    function planWalk(world, id, targetId) {
        const player = world.players[id];
        const target = targets(world, id).find(value => value.id === targetId);
        assert.ok(target, `target ${targetId} must remain available in the authored J scene`);
        if (distance(player, target) <= INTERACTION_RADIUS) return { done: true, player, target };
        const scene = SCENES[player.scene];
        const solids = solidsFor(world, id);
        const start = { x: player.x, y: player.y, g: 0, h: distance(player, target), parent: null };
        const open = [start];
        const seen = new Map([['0,0', 0]]);
        let found = null;
        for (let visits = 0; open.length && visits < 15000; visits += 1) {
            open.sort((a, b) => (b.g + b.h) - (a.g + a.h));
            const current = open.pop();
            if (distance(current, target) <= INTERACTION_RADIUS) { found = current; break; }
            const gap = distance(current, target);
            if (gap <= INTERACTION_RADIUS + 9) {
                const scale = (gap - INTERACTION_RADIUS + 0.1) / gap;
                const approach = move(current, (target.x - current.x) * scale, (target.y - current.y) * scale, scene, solids, RADIUS);
                if (distance(approach, target) <= INTERACTION_RADIUS) { found = { ...approach, parent: current }; break; }
            }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
                const x = current.x + dx * 6, y = current.y + dy * 6;
                if (x < 0 || x > 1000 || y < 0 || y > 480) continue;
                const moved = move(current, dx * 6, dy * 6, scene, solids, RADIUS);
                if (Math.hypot(moved.x - x, moved.y - y) > 0.01) continue;
                const cost = current.g + Math.hypot(dx, dy) * 6;
                const key = `${Math.round((x - player.x) / 6)},${Math.round((y - player.y) / 6)}`;
                if ((seen.get(key) ?? Infinity) <= cost) continue;
                seen.set(key, cost);
                open.push({ x, y, g: cost, h: Math.max(0, Math.hypot(x - target.x, y - target.y) - INTERACTION_RADIUS), parent: current });
            }
        }
        assert.ok(found, `a bounded path must exist for ${id} -> ${targetId}`);
        const raw = [];
        while (found.parent) { raw.unshift({ x: found.x, y: found.y }); found = found.parent; }
        const corners = [];
        let previous = start, direction = '';
        for (const point of raw) {
            const nextDirection = `${Math.sign(point.x - previous.x)},${Math.sign(point.y - previous.y)}`;
            if (direction && direction !== nextDirection) corners.push(previous);
            direction = nextDirection;
            previous = point;
        }
        corners.push(raw.at(-1));
        return { done: false, player, target, point: corners[0] };
    }

    function drive(world, id, targetId) {
        for (let step = 1; step <= 1200; step += 1) {
            const path = planWalk(world, id, targetId);
            if (path.done) return step - 1;
            let dx = path.point.x - path.player.x;
            let dy = path.point.y - path.player.y;
            // The tabletop blocks upward motion until the player is aligned
            // horizontally with the target from the real lower corridor.
            if (path.target.y >= 250 && path.player.y >= path.target.y + 35 && path.player.y <= path.target.y + 55
                && Math.abs(path.player.x - path.target.x) < 70) {
                dx = path.target.x - path.player.x;
                dy = Math.abs(dx) <= 12 ? path.target.y - path.player.y : 0;
            }
            const magnitude = Math.hypot(dx, dy) || 1;
            const next = move(path.player, dx / magnitude * WALK_SPEED * SERVER_STEP_SECONDS, dy / magnitude * WALK_SPEED * SERVER_STEP_SECONDS, SCENES.J, solidsFor(world, id), RADIUS);
            assert.ok(distance(next, path.player) > 0.01, `real-key movement stalled at ${id} -> ${targetId} on step ${step}`);
            Object.assign(path.player, next);
        }
        assert.fail(`real-key planner exceeded its bounded step budget for ${id} -> ${targetId}`);
    }

    const results = approaches.map(([id, targetId, start]) => {
        const world = worldFor(id, start);
        const steps = drive(world, id, targetId);
        const target = targets(world, id).find(value => value.id === targetId);
        return { id, targetId, steps, distance: distance(world.players[id], target) };
    });
    assert.equal(results.length, 6);
    assert.ok(results.every(result => result.distance <= INTERACTION_RADIUS));
    assert.ok(results.every(result => result.steps <= 1200));
    assert.deepEqual(results.map(result => result.targetId), ['cube-1', 'cube-3', 'cube-2', 'cube-5', 'cube-0', 'cube-4']);
});
