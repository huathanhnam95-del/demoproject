'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    createDeployedIdentitiesProvider,
    parseReleaseMetadata,
    stableHash
} = require('../../functions/src/services/deployed-identities-provider.cjs');
const { createDeployedIdentitiesRoute } = require('../../functions/src/routes/admin/deployed-identities.js');

const candidateSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const scopeHash = '3'.repeat(64);
const releaseMessage = `BEL-RELEASE schema=1 candidate=${candidateSha} base=${baseSha} scope=${scopeHash} owner=release-owner resources=hosting,functions,firestore,realtime,gateway`;

function responseRecorder() {
    return {
        statusCode: null,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name] = value; },
        json(value) { this.body = value; return this; }
    };
}

function makeAuthoritativeFixtures() {
    return {
        'https://firebasehosting.googleapis.com/v1beta1/sites/listening-tasks-3ae34/channels/live': {
            release: {
                name: 'sites/listening-tasks-3ae34/channels/live/releases/release-1',
                version: { name: 'sites/listening-tasks-3ae34/versions/version-1' },
                releaseTime: '2026-09-16T00:00:00Z',
                message: releaseMessage
            }
        },
        'https://firebasehosting.googleapis.com/v1beta1/sites/listening-tasks-3ae34/versions/version-1': {
            name: 'sites/listening-tasks-3ae34/versions/version-1',
            status: 'FINALIZED',
            createTime: '2026-09-16T00:00:00Z',
            config: { rewrites: [{ source: '/api/**', function: 'api' }] },
            fileCount: '2'
        },
        'https://cloudfunctions.googleapis.com/v2/projects/listening-tasks-3ae34/locations/us-central1/functions/api': {
            name: 'projects/listening-tasks-3ae34/locations/us-central1/functions/api',
            state: 'ACTIVE',
            updateTime: '2026-09-16T00:00:01Z',
            buildConfig: {
                runtime: 'nodejs22',
                source: { storageSource: { bucket: 'gcf-source', object: 'api.zip', generation: '9' } }
            },
            serviceConfig: {
                serviceAccountEmail: 'runtime@example.iam.gserviceaccount.com',
                uri: 'https://api.example.run.app',
                revision: 'api-00001-abc',
                availableMemory: '1Gi',
                timeoutSeconds: 300,
                maxInstanceCount: 20,
                maxInstanceRequestConcurrency: 80,
                ingressSettings: 'ALLOW_ALL'
            }
        },
        'https://run.googleapis.com/v2/projects/listening-tasks-3ae34/locations/us-central1/services/api': {
            name: 'projects/listening-tasks-3ae34/locations/us-central1/services/api',
            uid: 'run-service-1',
            updateTime: '2026-09-16T00:00:02Z',
            latestReadyRevision: 'api-00001-abc',
            latestCreatedRevision: 'api-00001-abc',
            template: {
                serviceAccount: 'runtime@example.iam.gserviceaccount.com',
                containers: [{ image: 'us-central1-docker.pkg.dev/project/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
                timeout: '300s',
                maxInstanceRequestConcurrency: 80
            },
            traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, revision: 'api-00001-abc' }],
            ingress: 'INGRESS_TRAFFIC_ALL'
        },
        'https://firebaserules.googleapis.com/v1/projects/listening-tasks-3ae34/releases/cloud.firestore': {
            name: 'projects/listening-tasks-3ae34/releases/cloud.firestore',
            rulesetName: 'projects/listening-tasks-3ae34/rulesets/ruleset-1',
            updateTime: '2026-09-16T00:00:03Z'
        },
        'https://firebaserules.googleapis.com/v1/projects/listening-tasks-3ae34/rulesets/ruleset-1': {
            name: 'projects/listening-tasks-3ae34/rulesets/ruleset-1',
            source: { files: [{ name: 'firestore.rules', content: 'match /databases/{database}/documents {}' }] }
        },
        'https://firestore.googleapis.com/v1/projects/listening-tasks-3ae34/databases/(default)': {
            name: 'projects/listening-tasks-3ae34/databases/(default)',
            uid: 'database-1',
            locationId: 'asia-southeast1',
            type: 'FIRESTORE_NATIVE',
            updateTime: '2026-09-16T00:00:03Z'
        },
        'https://firestore.googleapis.com/v1/projects/listening-tasks-3ae34/databases/(default)/collectionGroups/-/indexes?pageSize=1000': {
            indexes: [{ name: 'projects/listening-tasks-3ae34/databases/(default)/indexes/index-1', queryScope: 'COLLECTION', fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }] }]
        },
        'https://firebasedatabase.googleapis.com/v1beta/projects/listening-tasks-3ae34/locations/-/instances?pageSize=100': {
            instances: [{ name: 'projects/listening-tasks-3ae34/locations/asia-southeast1/instances/default', state: 'ACTIVE', databaseUrl: 'https://listening-tasks-3ae34-default-rtdb.asia-southeast1.firebasedatabase.app' }]
        }
    };
}

test('release metadata requires a complete provenance message', () => {
    assert.deepEqual(parseReleaseMetadata(releaseMessage), {
        schemaVersion: 1,
        candidateSha,
        baseSha,
        scopeHash,
        owner: 'release-owner',
        resources: ['hosting', 'functions', 'firestore', 'realtime', 'gateway']
    });
    assert.throws(() => parseReleaseMetadata('BEL-RELEASE schema=1 candidate=missing'), /provenance/i);
});

test('provider reads authoritative surfaces and omits secret material', async () => {
    const fixtures = makeAuthoritativeFixtures();
    const requested = [];
    const provider = createDeployedIdentitiesProvider({
        projectId: 'listening-tasks-3ae34',
        region: 'us-central1',
        firebaseConfig: { projectId: 'listening-tasks-3ae34', storageBucket: 'listening-tasks-3ae34.firebasestorage.app' },
        now: () => 1789516804,
        readJson: async (url) => {
            requested.push(url);
            if (!fixtures[url]) throw new Error(`unexpected URL: ${url}`);
            return fixtures[url];
        }
    });

    const identity = await provider.read({ requestNonce: 'nonce_1234567890' });

    assert.equal(identity.schemaVersion, 1);
    assert.equal(identity.expiryUnit, 'epoch-seconds');
    assert.equal(identity.candidateSha, candidateSha);
    assert.equal(identity.baseSha, baseSha);
    assert.equal(identity.scopeHash, scopeHash);
    assert.equal(identity.owner, 'release-owner');
    assert.deepEqual(identity.resources, ['hosting', 'functions', 'firestore', 'realtime', 'gateway']);
    assert.equal(identity.requestNonce, 'nonce_1234567890');
    assert.equal(identity.stateHash, stableHash(identity.state));
    assert.equal(identity.state.hosting.versionName, 'sites/listening-tasks-3ae34/versions/version-1');
    assert.equal(identity.state.api.revision, 'api-00001-abc');
    assert.equal(identity.state.api.source.storageGeneration, '9');
    assert.equal(identity.state.gateway.imageDigest, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(identity.state.firestore.database.locationId, 'asia-southeast1');
    assert.equal(identity.state.firestore.rules.sourceHash.length, 64);
    assert.equal(identity.state.firestore.indexes.hash.length, 64);
    assert.equal(identity.state.realtime.instances[0].databaseUrlHash.length, 64);
    assert.equal(Object.prototype.hasOwnProperty.call(identity.state.api, 'environment'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(identity.state, 'secrets'), false);
    assert.equal(requested.length, 9);
});

test('provider fails closed when current release provenance is absent', async () => {
    const fixtures = makeAuthoritativeFixtures();
    fixtures['https://firebasehosting.googleapis.com/v1beta1/sites/listening-tasks-3ae34/channels/live'].release.message = 'old release';
    const provider = createDeployedIdentitiesProvider({
        projectId: 'listening-tasks-3ae34',
        readJson: async (url) => fixtures[url],
        firebaseConfig: { projectId: 'listening-tasks-3ae34' }
    });
    await assert.rejects(provider.read({ requestNonce: 'nonce_1234567890' }), error => error.code === 'IDENTITY_PROVENANCE_MISSING');
});

test('Google API adapter uses GET with no-store headers and does not expose response errors', async () => {
    const requests = [];
    const reader = require('../../functions/src/services/deployed-identities-provider.cjs').createGoogleApiReader({
        auth: {
            getClient: async () => ({
                request: async (request) => {
                    requests.push(request);
                    return { data: { name: 'safe-identity' } };
                }
            })
        }
    });
    assert.deepEqual(await reader('https://example.com/identity'), { name: 'safe-identity' });
    assert.deepEqual(requests, [{
        url: 'https://example.com/identity',
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }
    }]);
});

test('route rejects invalid credentials or nonce without reading state', async () => {
    let reads = 0;
    const route = createDeployedIdentitiesRoute({
        token: 'provider-token',
        provider: { read: async () => { reads += 1; return { ok: true }; } }
    });
    const invalidToken = responseRecorder();
    await route({ get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer wrong' : name.toLowerCase() === 'x-bel-request-nonce' ? 'nonce_1234567890' : '' }, invalidToken);
    assert.equal(invalidToken.statusCode, 404);
    const invalidNonce = responseRecorder();
    await route({ get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer provider-token' : name.toLowerCase() === 'x-bel-request-nonce' ? 'bad nonce!' : '' }, invalidNonce);
    assert.equal(invalidNonce.statusCode, 400);
    assert.equal(reads, 0);
});

test('route binds the validated nonce and sets no-store security headers', async () => {
    let received;
    const route = createDeployedIdentitiesRoute({
        token: 'provider-token',
        provider: { read: async (request) => { received = request; return { schemaVersion: 1 }; } }
    });
    const response = responseRecorder();
    await route({ get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer provider-token' : name.toLowerCase() === 'x-bel-request-nonce' ? 'nonce_1234567890' : '' }, response);
    assert.deepEqual(received, { requestNonce: 'nonce_1234567890' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
});

test('route does not expose deployment identity data to browser-origin requests', async () => {
    let reads = 0;
    const route = createDeployedIdentitiesRoute({
        token: 'provider-token',
        provider: { read: async () => { reads += 1; return { ok: true }; } }
    });
    const response = responseRecorder();
    await route({ get: (name) => name.toLowerCase() === 'authorization' ? 'Bearer provider-token' : name.toLowerCase() === 'origin' ? 'https://example.com' : 'nonce_1234567890' }, response);
    assert.equal(response.statusCode, 404);
    assert.equal(reads, 0);
});

test('production API wiring declares the dedicated secret and HTTPS route', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '../../functions/src/apiApp.js'), 'utf8');
    const indexSource = fs.readFileSync(path.join(__dirname, '../../functions/src/index.js'), 'utf8');
    assert.match(apiSource, /createDeployedIdentitiesProvider/);
    assert.match(apiSource, /\/api\/release\/deployed-identities/);
    assert.match(indexSource, /secrets:\s*\[[^\]]*'BEL_DEPLOYED_IDENTITIES_TOKEN'/);
});
