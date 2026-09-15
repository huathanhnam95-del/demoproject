'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function stableHash(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

class ReleaseGateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ReleaseGateError';
        this.code = code;
        Object.assign(this, details);
    }
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asNonEmptyString(value, label) {
    const result = String(value || '').trim();
    if (!result) throw new TypeError(`${label} is required`);
    return result;
}

function assertExternalEvidenceDir(evidenceDir) {
    const resolved = path.resolve(evidenceDir);
    const relative = path.relative(ROOT, resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..') || path.isAbsolute(relative)) {
        throw new TypeError('evidenceDir must be outside the repository');
    }
    return resolved;
}

function actionNames(actions) {
    return actions.map(action => action.name);
}

function equalState(left, right) {
    return stableHash(left) === stableHash(right);
}

function nowValue(now) {
    const value = typeof now === 'function' ? now() : now;
    return Number(value ?? (Date.now() / 1000));
}

function assertSha(value, label) {
    const result = asNonEmptyString(value, label);
    if (!/^[0-9a-f]{40}$/.test(result)) throw new TypeError(`${label} must be a full lowercase SHA-1 revision`);
    return result;
}

function assertSha256(value, label) {
    const result = asNonEmptyString(value, label);
    if (!/^[0-9a-f]{64}$/.test(result)) throw new TypeError(`${label} must be a full lowercase SHA-256 hash`);
    return result;
}

function validateActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) throw new TypeError('actions must be a non-empty array');
    const names = new Set();
    for (const action of actions) {
        asNonEmptyString(action?.name, 'action.name');
        asNonEmptyString(action?.resource, `resource for ${action.name}`);
        if (typeof action.apply !== 'function') throw new TypeError(`action ${action.name} must provide apply()`);
        if (names.has(action.name)) throw new TypeError(`action ${action.name} is duplicated`);
        names.add(action.name);
    }
}

function writeJson(evidenceDir, filename, value) {
    if (!evidenceDir) return null;
    const target = path.join(evidenceDir, filename);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return target;
}

function safeFailure(error, phase, index, details = {}) {
    return {
        schemaVersion: 1,
        failedAt: new Date().toISOString(),
        phase,
        actionIndex: index,
        code: error.code || 'RELEASE_ERROR',
        message: error.message || String(error),
        ...details
    };
}

function assertProviderMethod(provider, method, label) {
    if (!provider || typeof provider[method] !== 'function') {
        const code = label === 'lease provider' ? 'LEASE_PROVIDER_REQUIRED' : 'PUBLISHER_REQUIRED';
        throw new ReleaseGateError(code, `A reviewed ${label} adapter with ${method}() is required.`);
    }
}

function assertReviewedBaseline(baseline, { candidateSha, scope, scopeHash }) {
    if (!baseline || typeof baseline !== 'object' || baseline.state === undefined) {
        throw new ReleaseGateError('BASELINE_REVIEW_REQUIRED', 'Execution requires a reviewed production baseline; observations cannot become the baseline.');
    }
    if (!asNonEmptyString(baseline.source, 'reviewedBaseline.source') || !asNonEmptyString(baseline.reviewedAt, 'reviewedBaseline.reviewedAt')) {
        throw new ReleaseGateError('BASELINE_REVIEW_REQUIRED', 'Reviewed baseline source and review timestamp are required.');
    }
    if (baseline.candidateSha !== candidateSha || baseline.baseSha !== scope.baseSha || baseline.scopeHash !== scopeHash) {
        throw new ReleaseGateError('BASELINE_SCOPE_MISMATCH', 'Reviewed baseline does not match the candidate, base SHA, and exact scope.');
    }
    if (baseline.stateHash !== stableHash(baseline.state)) {
        throw new ReleaseGateError('BASELINE_HASH_MISMATCH', 'Reviewed baseline stateHash does not match its state.');
    }
    return clone(baseline.state);
}

function assertLease(lease, { candidateSha, scope, scopeHash, now }) {
    if (!lease || typeof lease !== 'object') throw new ReleaseGateError('LEASE_INVALID', 'Lease provider returned no lease.');
    if (lease.schemaVersion !== 1 || lease.expiryUnit !== 'epoch-seconds') throw new ReleaseGateError('LEASE_INVALID', 'Externally backed lease must use schemaVersion 1 and epoch-seconds expiry.');
    asNonEmptyString(lease.operationId, 'lease.operationId');
    if (lease.operationState !== 'pending' || lease.state !== 'ACTIVE') throw new ReleaseGateError('LEASE_UNRESOLVED', 'Externally backed lease is not an active pending operation.');
    asNonEmptyString(lease.leaseId, 'lease.leaseId');
    asNonEmptyString(lease.owner, 'lease.owner');
    assertSha(lease.candidateSha, 'lease.candidateSha');
    assertSha(lease.baseSha, 'lease.baseSha');
    assertSha256(lease.scopeHash, 'lease.scopeHash');
    if (lease.candidateSha !== candidateSha || lease.baseSha !== scope.baseSha || lease.scopeHash !== scopeHash) {
        throw new ReleaseGateError('LEASE_SCOPE_MISMATCH', 'Externally backed lease does not match the candidate, base SHA, and exact scope.');
    }
    if (!Array.isArray(lease.resources) || !lease.resources.length) throw new ReleaseGateError('LEASE_INVALID', 'Lease resources are required.');
    if (!Number.isFinite(Number(lease.expiresAt)) || Number(lease.expiresAt) <= nowValue(now)) {
        throw new ReleaseGateError('LEASE_EXPIRED', 'Externally backed release lease is expired.');
    }
    return lease;
}

function assertApproval(approval, lease, { candidateSha, scope, scopeHash, now, actions }) {
    if (!approval || typeof approval !== 'object') throw new ReleaseGateError('APPROVAL_REQUIRED', 'Execution requires explicit approval.');
    if (approval.schemaVersion !== 1 || approval.expiryUnit !== 'epoch-seconds') throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval must use schemaVersion 1 and epoch-seconds expiry.');
    if (approval.owner !== lease.owner || approval.leaseId !== lease.leaseId) {
        throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval does not identify the acquired lease owner and lease ID.');
    }
    const approvalExpiry = Number(approval.expiresAt);
    if (!Number.isFinite(approvalExpiry) || approvalExpiry <= nowValue(now)) {
        throw new ReleaseGateError('APPROVAL_EXPIRED', 'Release approval has expired or has no valid expiry.');
    }
    assertSha(approval.candidateSha, 'approval.candidateSha');
    assertSha(approval.baseSha, 'approval.baseSha');
    assertSha256(approval.scopeHash, 'approval.scopeHash');
    if (approval.candidateSha !== candidateSha || approval.baseSha !== scope.baseSha || approval.scopeHash !== scopeHash) {
        throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval does not match the candidate SHA, base SHA and exact scope.');
    }
    if (!Array.isArray(approval.resources) || !approval.resources.length || actions.some(action => !approval.resources.includes(action.resource))) {
        throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval resources do not cover the requested release.');
    }
    const expectedActions = actionNames(actions);
    if (!Array.isArray(approval.actions) || stableJson(approval.actions) !== stableJson(expectedActions)) {
        throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval action sequence does not match the requested release.');
    }
}

function createFileLeaseProvider({ path: leasePath, now = () => Date.now() / 1000, ttlSeconds = 60 } = {}) {
    const target = leasePath && path.resolve ? path.resolve(leasePath) : leasePath;
    if (!target || typeof target !== 'string') throw new TypeError('lease provider path is required');
    const ttl = Number(ttlSeconds);
    if (!Number.isFinite(ttl) || ttl <= 0) throw new TypeError('lease provider ttlSeconds must be positive');
    const lockPath = `${target}.lock`;

    function readLease() {
        try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
        catch (error) {
            if (error.code === 'ENOENT') return null;
            throw new ReleaseGateError('LEASE_INVALID', `External publisher lease is not valid JSON: ${error.message || error}`);
        }
    }

    function atomicWrite(value) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
        try {
            try { fs.renameSync(temporary, target); }
            catch (error) {
                // Windows refuses to replace an existing file with rename. The
                // exclusive lock still makes this fallback single-writer; the
                // normal path remains an atomic temp-file replacement.
                if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
                try { fs.unlinkSync(target); } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
                fs.renameSync(temporary, target);
            }
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
    }

    function withLock(callback) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        let descriptor;
        try { descriptor = fs.openSync(lockPath, 'wx'); }
        catch (error) {
            if (error.code === 'EEXIST') throw new ReleaseGateError('LEASE_BUSY', 'Another publisher lease operation is in flight.');
            throw error;
        }
        try { return callback(); }
        finally {
            fs.closeSync(descriptor);
            if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
        }
    }

    function sameLease(left, right) {
        return Boolean(left && right && left.leaseId === right.leaseId && left.operationId === right.operationId && left.owner === right.owner);
    }

    async function acquire(request = {}) {
        return withLock(() => {
            const currentTime = nowValue(now);
            const existing = readLease();
            if (existing && (existing.operationState === 'pending' || existing.operationState === 'uncertain' || existing.state === 'HOLD')) {
                throw new ReleaseGateError('LEASE_BUSY', 'A pending or unresolved publisher operation retains the external hold.');
            }
            if (existing && Number(existing.expiresAt) > currentTime) {
                throw new ReleaseGateError('LEASE_BUSY', 'Another externally backed publisher lease is active.');
            }
            if (existing) {
                try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            const resources = [...new Set(request.resources || [])].map(item => asNonEmptyString(item, 'lease resource'));
            if (!resources.length) throw new TypeError('lease request resources are required');
            const lease = {
                schemaVersion: 1,
                expiryUnit: 'epoch-seconds',
                operationId: request.operationId || crypto.randomUUID(),
                operationState: 'pending',
                state: 'ACTIVE',
                status: 'ACTIVE',
                leaseId: request.requestedLeaseId || crypto.randomUUID(),
                owner: asNonEmptyString(request.owner, 'lease request owner'),
                candidateSha: assertSha(request.candidateSha, 'lease request candidateSha'),
                baseSha: assertSha(request.baseSha, 'lease request baseSha'),
                scopeHash: assertSha256(request.scopeHash, 'lease request scopeHash'),
                resources,
                acquiredAt: currentTime,
                expiresAt: currentTime + ttl
            };
            atomicWrite(lease);
            return lease;
        });
    }

    async function renew(lease) {
        return withLock(() => {
            const currentTime = nowValue(now);
            const current = readLease();
            if (!sameLease(current, lease)) throw new ReleaseGateError('LEASE_LOST', 'External publisher lease is no longer held.');
            if (current.operationState !== 'pending' || current.state !== 'ACTIVE') throw new ReleaseGateError('LEASE_UNRESOLVED', 'External publisher lease is held for unresolved completion.');
            const renewed = { ...current, renewedAt: currentTime, expiresAt: currentTime + ttl };
            atomicWrite(renewed);
            return renewed;
        });
    }

    async function markUnresolved(lease, details = {}) {
        return withLock(() => {
            const current = readLease();
            if (!sameLease(current, lease)) throw new ReleaseGateError('LEASE_LOST', 'Cannot retain an external lease that is no longer owned.');
            const unresolved = { ...current, operationState: 'uncertain', state: 'HOLD', status: 'HOLD', unresolvedAt: nowValue(now), failure: clone(details) };
            atomicWrite(unresolved);
            return unresolved;
        });
    }

    async function resolveUnresolved(lease, { release = true, resolution = 'manual' } = {}) {
        return withLock(() => {
            const current = readLease();
            if (!sameLease(current, lease)) throw new ReleaseGateError('LEASE_LOST', 'Cannot resolve an external lease that is no longer owned.');
            if (current.operationState !== 'uncertain' || current.state !== 'HOLD') throw new ReleaseGateError('LEASE_INVALID', 'External lease is not unresolved.');
            if (release) {
                fs.unlinkSync(target);
                return { ...current, resolution };
            }
            const resolved = { ...current, operationState: 'pending', state: 'ACTIVE', status: 'ACTIVE', resolvedAt: nowValue(now), resolution, expiresAt: nowValue(now) + ttl };
            atomicWrite(resolved);
            return resolved;
        });
    }

    async function release(lease) {
        return withLock(() => {
            const current = readLease();
            if (!current || !sameLease(current, lease)) return;
            if (current.operationState !== 'pending' || current.state !== 'ACTIVE') throw new ReleaseGateError('LEASE_UNRESOLVED', 'Unresolved external lease requires explicit reconciliation before release.');
            fs.unlinkSync(target);
        });
    }

    return { acquire, renew, markUnresolved, resolveUnresolved, release, path: target, lockPath };
}

function createDryRunPublisherAdapter({ leaseProvider = null } = {}) {
    return {
        acquire: (...args) => leaseProvider?.acquire?.(...args),
        renew: (...args) => leaseProvider?.renew?.(...args),
        markUnresolved: (...args) => leaseProvider?.markUnresolved?.(...args),
        release: (...args) => leaseProvider?.release?.(...args),
        async publish() {
            throw new ReleaseGateError('PROVIDER_REQUIRED', 'Dry-run publisher cannot publish; configure a reviewed production provider adapter first.');
        }
    };
}

function createReleaseDriver(options = {}) {
    const readState = options.readState;
    if (typeof readState !== 'function') throw new TypeError('readState must be a function');
    const actions = options.actions;
    validateActions(actions);
    const execute = options.execute === true;
    const evidenceDir = options.evidenceDir ? assertExternalEvidenceDir(options.evidenceDir) : null;
    const candidateSha = assertSha(options.candidateSha, 'candidateSha');
    const scope = options.scope && typeof options.scope === 'object' ? clone(options.scope) : null;
    if (!scope) throw new TypeError('scope is required');
    scope.baseSha = assertSha(scope.baseSha, 'scope.baseSha');
    const scopeHash = stableHash(scope);
    const now = options.now || (() => Date.now() / 1000);
    let expectedState = options.expectedState === undefined ? undefined : clone(options.expectedState);

    function assertExecutableConfiguration() {
        assertProviderMethod(options.leaseProvider, 'acquire', 'lease provider');
        assertProviderMethod(options.leaseProvider, 'renew', 'lease provider');
        assertProviderMethod(options.leaseProvider, 'release', 'lease provider');
        assertProviderMethod(options.leaseProvider, 'markUnresolved', 'lease provider');
        assertProviderMethod(options.publisher, 'publish', 'publisher');
        assertReviewedBaseline(options.reviewedBaseline, { candidateSha, scope, scopeHash });
        for (const action of actions) {
            if (!Object.prototype.hasOwnProperty.call(action, 'expectedStateAfter')) {
                throw new ReleaseGateError('EXPECTED_POST_STATE_REQUIRED', `Action ${action.name} must declare an explicit approved post-mutation state.`);
            }
        }
    }

    function assertResourceLease(action, lease) {
        if (!Array.isArray(lease?.resources) || !lease.resources.includes(action.resource)) {
            throw new ReleaseGateError('LEASE_SCOPE_MISMATCH', `Lease does not cover resource ${action.resource}.`, { resource: action.resource });
        }
    }

    async function run() {
        const report = {
            schemaVersion: 1,
            mode: execute ? 'execute' : 'read-only',
            candidateSha,
            scopeHash,
            actions: []
        };
        let activeLease = null;
        let pendingFailure = null;
        let retainLeaseForReconciliation = false;
        try {
            if (execute) {
                assertExecutableConfiguration();
                const approval = options.approval;
                activeLease = await options.leaseProvider.acquire({
                    requestedLeaseId: approval?.leaseId,
                    owner: approval?.owner,
                    candidateSha,
                    baseSha: scope.baseSha,
                    scopeHash,
                    resources: actions.map(action => action.resource),
                    ttlSeconds: options.leaseTtlSeconds
                });
                assertLease(activeLease, { candidateSha, scope, scopeHash, now });
                assertApproval(approval, activeLease, { candidateSha, scope, scopeHash, now, actions });
                expectedState = assertReviewedBaseline(options.reviewedBaseline, { candidateSha, scope, scopeHash });
                report.leaseIdFingerprint = stableHash(activeLease.leaseId).slice(0, 16);
            }

            const renewLease = async function renewLease(action, index, boundary) {
                if (!execute) return;
                const approval = options.approval;
                activeLease = await options.leaseProvider.renew(activeLease, { phase: action.name, actionIndex: index, boundary });
                assertLease(activeLease, { candidateSha, scope, scopeHash, now });
                assertApproval(approval, activeLease, { candidateSha, scope, scopeHash, now, actions });
                assertResourceLease(action, activeLease);
            };

            const publishWithHeartbeat = async function publishWithHeartbeat(action, index, payload) {
                const intervalMs = Math.max(10, Number(options.leaseHeartbeatMs || 1_000));
                let heartbeatError = null;
                let heartbeatQueue = Promise.resolve();
                let stopped = false;
                const beat = () => {
                    heartbeatQueue = heartbeatQueue.then(async () => {
                        if (stopped || heartbeatError) return;
                        try { await renewLease(action, index, 'heartbeat'); }
                        catch (error) { heartbeatError = error; }
                    });
                };
                const timer = setInterval(beat, intervalMs);
                timer.unref?.();
                try {
                    const result = await options.publisher.publish(payload);
                    await heartbeatQueue;
                    if (heartbeatError) throw heartbeatError;
                    return result;
                } finally {
                    stopped = true;
                    clearInterval(timer);
                    await heartbeatQueue;
                }
            };

            for (let index = 0; index < actions.length; index += 1) {
                const action = actions[index];
                let current;
                try {
                    await renewLease(action, index, 'before-read');
                    current = await readState({ phase: action.name, actionIndex: index });
                    if (expectedState === undefined) expectedState = clone(current);
                    if (!equalState(current, expectedState)) {
                        throw new ReleaseGateError('BASELINE_DRIFT', `Current production drifted before ${action.name}; no action was applied.`, {
                            phase: action.name,
                            actionIndex: index,
                            expectedStateHash: stableHash(expectedState),
                            currentStateHash: stableHash(current)
                        });
                    }
                } catch (error) {
                    const failure = safeFailure(error, action.name, index, { action: action.name });
                    report.failure = failure;
                    pendingFailure = error;
                    try { report.failureEvidence = writeJson(evidenceDir, 'release-online-failure.json', failure); } catch (_) { /* preserve the original gate failure */ }
                    throw error;
                }
                if (!execute) {
                    report.actions.push({ name: action.name, resource: action.resource, status: 'planned', baselineStateHash: stableHash(current) });
                    continue;
                }
                const entry = { name: action.name, resource: action.resource, status: 'started', baselineStateHash: stableHash(current) };
                let publishStarted = false;
                try {
                    await renewLease(action, index, 'before-publish');
                    publishStarted = true;
                    const result = await publishWithHeartbeat(action, index, {
                        action,
                        phase: action.name,
                        actionIndex: index,
                        currentState: clone(current),
                        expectedState: clone(expectedState)
                    });
                    await renewLease(action, index, 'before-post-read');
                    const observed = await readState({ phase: action.name, actionIndex: index, afterMutation: true });
                    const expectedAfter = typeof action.expectedStateAfter === 'function'
                        ? await action.expectedStateAfter({ phase: action.name, actionIndex: index, before: clone(current), result: clone(result) })
                        : clone(action.expectedStateAfter);
                    if (expectedAfter === undefined) {
                        throw new ReleaseGateError('EXPECTED_POST_STATE_REQUIRED', `Action ${action.name} returned no explicit approved post-mutation state.`);
                    }
                    if (!equalState(observed, expectedAfter)) {
                        throw new ReleaseGateError('POST_MUTATION_MISMATCH', `Observed state after ${action.name} does not equal the approved result.`, {
                            phase: action.name,
                            actionIndex: index,
                            expectedStateHash: stableHash(expectedAfter),
                            currentStateHash: stableHash(observed)
                        });
                    }
                    expectedState = clone(expectedAfter);
                    entry.status = 'applied';
                    entry.resultStateHash = stableHash(observed);
                    report.actions.push(entry);
                } catch (error) {
                    entry.status = 'failed';
                    entry.errorCode = error.code || 'ACTION_FAILED';
                    entry.errorMessage = error.message || String(error);
                    report.actions.push(entry);
                    const failure = safeFailure(error, action.name, index, {
                        action: action.name,
                        baselineStateHash: entry.baselineStateHash,
                        resultStateHash: entry.resultStateHash || null
                    });
                    report.failure = failure;
                    pendingFailure = error;
                    if (publishStarted) {
                        retainLeaseForReconciliation = true;
                        try {
                            activeLease = await options.leaseProvider.markUnresolved(activeLease, failure);
                            report.unresolvedOperation = {
                                operationId: activeLease.operationId,
                                state: activeLease.state,
                                operationState: activeLease.operationState
                            };
                        } catch (holdError) {
                            failure.leaseRetentionError = holdError.message || String(holdError);
                        }
                    }
                    try { report.failureEvidence = writeJson(evidenceDir, 'release-online-failure.json', failure); } catch (_) { /* preserve the original failure */ }
                    throw error;
                }
            }
            if (evidenceDir) report.evidence = writeJson(evidenceDir, 'release-online-report.json', report);
            return report;
        } finally {
            if (execute && activeLease && !retainLeaseForReconciliation) {
                try {
                    await options.leaseProvider.release(activeLease);
                } catch (error) {
                    if (!pendingFailure) throw new ReleaseGateError('LEASE_RELEASE_FAILED', `External publisher lease could not be released: ${error.message || error}`);
                }
            }
        }
    }

    return { run, scopeHash };
}

function parseArgs(argv) {
    const args = { execute: false, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (item === '--execute') args.execute = true;
        else if (item === '--help' || item === '-h') args.help = true;
        else if (item.startsWith('--')) {
            const key = item.slice(2);
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${item} requires a value`);
            args[key] = value;
            index += 1;
        } else throw new Error(`Unknown argument: ${item}`);
    }
    return args;
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        console.log('Usage: node scripts/bel-demo/release-online.cjs --evidence <external-dir> [--execute]');
        console.log('Default mode writes a read-only release preflight. Execute mode remains disabled until a reviewed publisher adapter is supplied to createReleaseDriver.');
        return;
    }
    const evidenceDir = assertExternalEvidenceDir(asNonEmptyString(args.evidence, '--evidence'));
    const report = {
        schemaVersion: 1,
        mode: args.execute ? 'execute-requested' : 'read-only',
        executeRequested: args.execute,
        providerAdapter: false,
        guard: 'No provider adapter is loaded by the CLI; no mutation can occur.',
        createdAt: new Date().toISOString()
    };
    writeJson(evidenceDir, 'release-online-preflight.json', report);
    if (args.execute) throw new ReleaseGateError('PROVIDER_REQUIRED', 'CLI execution is disabled until a reviewed provider adapter is supplied to createReleaseDriver.');
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || 'RELEASE_ERROR'}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    createDryRunPublisherAdapter,
    createFileLeaseProvider,
    createReleaseDriver,
    ReleaseGateError,
    stableHash,
    stableJson,
    parseArgs
};
