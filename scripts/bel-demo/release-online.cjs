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
    return Number(value ?? Date.now());
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

function createReleaseDriver(options = {}) {
    const readState = options.readState;
    if (typeof readState !== 'function') throw new TypeError('readState must be a function');
    const actions = options.actions;
    validateActions(actions);
    const execute = options.execute === true;
    const evidenceDir = options.evidenceDir ? assertExternalEvidenceDir(options.evidenceDir) : null;
    const candidateSha = asNonEmptyString(options.candidateSha, 'candidateSha');
    const scope = options.scope && typeof options.scope === 'object' ? clone(options.scope) : null;
    if (!scope) throw new TypeError('scope is required');
    const scopeHash = stableHash(scope);
    const now = options.now || (() => Date.now());
    let expectedState = options.expectedState === undefined ? undefined : clone(options.expectedState);

    function assertLeaseAndApproval() {
        if (!options.lease || !options.approval) {
            throw new ReleaseGateError('APPROVAL_REQUIRED', 'Execution requires an active release lease and explicit approval.');
        }
        const lease = options.lease;
        const approval = options.approval;
        const currentTime = nowValue(now);
        if (!asNonEmptyString(lease.owner, 'lease.owner') || !asNonEmptyString(approval.owner, 'approval.owner')) {
            throw new ReleaseGateError('LEASE_INVALID', 'Release lease and approval owners are required.');
        }
        if (lease.owner !== approval.owner) throw new ReleaseGateError('LEASE_INVALID', 'Lease and approval owners do not match.');
        if (Number(lease.expiresAt) <= currentTime || Number(approval.expiresAt) <= currentTime) {
            throw new ReleaseGateError('LEASE_EXPIRED', 'Release lease or approval has expired.');
        }
        if (approval.owner !== lease.owner) throw new ReleaseGateError('LEASE_INVALID', 'Approval owner does not hold the release lease.');
        if (approval.candidateSha !== candidateSha || approval.baseSha !== scope.baseSha || approval.scopeHash !== scopeHash) {
            throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval does not match the candidate SHA, base SHA and exact scope.');
        }
        const expectedActions = actionNames(actions);
        if (!Array.isArray(approval.actions) || stableJson(approval.actions) !== stableJson(expectedActions)) {
            throw new ReleaseGateError('APPROVAL_SCOPE_MISMATCH', 'Approval action sequence does not match the requested release.');
        }
    }

    function assertResourceLease(action) {
        const resources = options.lease?.resources;
        if (!Array.isArray(resources) || !resources.includes(action.resource)) {
            throw new ReleaseGateError('LEASE_SCOPE_MISMATCH', `Lease does not cover resource ${action.resource}.`, { resource: action.resource });
        }
    }

    async function freshness(action, index) {
        if (execute) assertLeaseAndApproval();
        if (execute) assertResourceLease(action);
        const current = await readState({ phase: action.name, actionIndex: index });
        if (expectedState === undefined) expectedState = clone(current);
        if (!equalState(current, expectedState)) {
            throw new ReleaseGateError('BASELINE_DRIFT', `Current production drifted before ${action.name}; no action was applied.`, {
                phase: action.name,
                actionIndex: index,
                expectedStateHash: stableHash(expectedState),
                currentStateHash: stableHash(current)
            });
        }
        return current;
    }

    async function run() {
        const report = {
            schemaVersion: 1,
            mode: execute ? 'execute' : 'read-only',
            candidateSha,
            scopeHash,
            actions: []
        };
        for (let index = 0; index < actions.length; index += 1) {
            const action = actions[index];
            let current;
            try {
                current = await freshness(action, index);
            } catch (error) {
                const failure = safeFailure(error, action.name, index, { action: action.name });
                report.failure = failure;
                try { report.failureEvidence = writeJson(evidenceDir, 'release-online-failure.json', failure); } catch (_) { /* preserve the original gate failure */ }
                throw error;
            }
            if (!execute) {
                report.actions.push({ name: action.name, resource: action.resource, status: 'planned', baselineStateHash: stableHash(current) });
                continue;
            }
            const entry = { name: action.name, resource: action.resource, status: 'started', baselineStateHash: stableHash(current) };
            try {
                const result = await action.apply({
                    phase: action.name,
                    actionIndex: index,
                    currentState: clone(current),
                    expectedState: clone(expectedState)
                });
                const observed = await readState({ phase: action.name, actionIndex: index, afterMutation: true });
                const expectedAfter = typeof action.expectedStateAfter === 'function'
                    ? await action.expectedStateAfter({ phase: action.name, actionIndex: index, before: clone(current), result, observed: clone(observed) })
                    : observed;
                if (!equalState(observed, expectedAfter)) {
                    throw new ReleaseGateError('POST_MUTATION_MISMATCH', `Observed state after ${action.name} does not equal the approved result.`, {
                        phase: action.name,
                        actionIndex: index,
                        expectedStateHash: stableHash(expectedAfter),
                        currentStateHash: stableHash(observed)
                    });
                }
                expectedState = clone(observed);
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
                try { report.failureEvidence = writeJson(evidenceDir, 'release-online-failure.json', failure); } catch (_) { /* preserve the original failure */ }
                throw error;
            }
        }
        if (evidenceDir) report.evidence = writeJson(evidenceDir, 'release-online-report.json', report);
        return report;
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
        console.log('Default mode writes a read-only release preflight. Execute mode is available only through createReleaseDriver with a reviewed provider adapter.');
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

module.exports = { createReleaseDriver, ReleaseGateError, stableHash, stableJson, parseArgs };
