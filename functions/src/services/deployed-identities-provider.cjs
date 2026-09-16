'use strict';

const crypto = require('node:crypto');
const { GoogleAuth } = require('google-auth-library');

const SCHEMA_VERSION = 1;
const EXPIRY_UNIT = 'epoch-seconds';
const RESOURCE_NAMES = new Set(['hosting', 'functions', 'firestore', 'realtime', 'gateway']);

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function stableHash(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

class DeployedIdentitiesError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DeployedIdentitiesError';
        this.code = code;
    }
}

function requireObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', `${label} did not return an object.`);
    }
    return value;
}

function parseReleaseMetadata(message) {
    const value = String(message || '').trim();
    const match = /^BEL-RELEASE schema=(1) candidate=([0-9a-f]{40}) base=([0-9a-f]{40}) scope=([0-9a-f]{64}) owner=([A-Za-z0-9._-]{1,80}) resources=([a-z][a-z0-9-]*(?:,[a-z][a-z0-9-]*)*)$/.exec(value);
    if (!match) throw new DeployedIdentitiesError('IDENTITY_PROVENANCE_MISSING', 'Current Hosting release has no complete release provenance.');
    const resources = match[6].split(',');
    if (!resources.length || new Set(resources).size !== resources.length || resources.some((resource) => !RESOURCE_NAMES.has(resource))) {
        throw new DeployedIdentitiesError('IDENTITY_PROVENANCE_INVALID', 'Current Hosting release provenance has an invalid resource scope.');
    }
    return {
        schemaVersion: SCHEMA_VERSION,
        candidateSha: match[2],
        baseSha: match[3],
        scopeHash: match[4],
        owner: match[5],
        resources
    };
}

function createGoogleApiReader({ auth, authOptions = {}, request = null } = {}) {
    let clientPromise = null;
    const googleAuth = auth || new GoogleAuth({
        ...authOptions,
        scopes: [
            'https://www.googleapis.com/auth/cloud-platform.read-only',
            'https://www.googleapis.com/auth/firebase.database',
            'https://www.googleapis.com/auth/userinfo.email'
        ]
    });
    return async function readJson(url) {
        try {
            if (typeof request === 'function') return requireObject(await request(url), 'Google API response');
            if (!clientPromise) clientPromise = googleAuth.getClient();
            const client = await clientPromise;
            const response = await client.request({
                url,
                method: 'GET',
                maxRedirects: 0,
                headers: {
                    Accept: 'application/json',
                    'Cache-Control': 'no-store'
                }
            });
            return requireObject(response?.data, 'Google API response');
        } catch (error) {
            if (error instanceof DeployedIdentitiesError) throw error;
            throw new DeployedIdentitiesError('IDENTITY_SOURCE_UNAVAILABLE', 'An authoritative deployment identity read failed.');
        }
    };
}

function parseRuntimeConfig(config, projectId) {
    let value = config;
    if (typeof value === 'string' && value.trim()) {
        try { value = JSON.parse(value); } catch (_) { throw new DeployedIdentitiesError('IDENTITY_CONFIG_INVALID', 'Runtime configuration is not valid JSON.'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = { projectId };
    const publicConfig = { projectId: String(value.projectId || projectId) };
    if (value.storageBucket) publicConfig.storageBucket = String(value.storageBucket);
    if (value.databaseURL) publicConfig.databaseUrlHash = stableHash(String(value.databaseURL));
    return {
        projectId: publicConfig.projectId,
        publicFields: publicConfig,
        hash: stableHash(publicConfig)
    };
}

function storageSource(source) {
    const value = source || {};
    return {
        bucket: value.bucket || null,
        object: value.object || null,
        generation: value.generation === undefined ? null : String(value.generation)
    };
}

function imageDigest(image) {
    const value = String(image || '');
    const marker = '@sha256:';
    const index = value.lastIndexOf(marker);
    return index >= 0 ? value.slice(index + 1) : null;
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

async function readAllIndexes(readJson, url) {
    const indexes = [];
    let nextPageToken = null;
    const seenPageTokens = new Set();
    do {
        const separator = url.includes('?') ? '&' : '?';
        const page = await readJson(nextPageToken ? `${url}${separator}pageToken=${encodeURIComponent(nextPageToken)}` : url, 'firestore indexes');
        indexes.push(...(Array.isArray(page.indexes) ? page.indexes : []));
        nextPageToken = page.nextPageToken || null;
        if (nextPageToken) {
            if (seenPageTokens.has(nextPageToken)) throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Firestore index pagination did not advance.');
            seenPageTokens.add(nextPageToken);
        }
    } while (nextPageToken);
    return indexes;
}

function normalizeIndex(index) {
    return {
        name: index?.name || null,
        queryScope: index?.queryScope || null,
        fields: Array.isArray(index?.fields) ? index.fields.map((field) => ({
            fieldPath: field?.fieldPath || null,
            order: field?.order || null,
            arrayConfig: field?.arrayConfig || null
        })) : []
    };
}

async function readRealtimeInstances(readJson, url) {
    const instances = [];
    const seenTokens = new Set();
    const seenNames = new Set();
    let token = null;
    do {
        const page = requireObject(await readJson(token ? `${url}&pageToken=${encodeURIComponent(token)}` : url), 'Realtime Database instances');
        if (page.instances !== undefined && !Array.isArray(page.instances)) {
            throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Realtime Database instance list is invalid.');
        }
        for (const instance of page.instances || []) {
            if (!instance?.name || !instance.state || seenNames.has(instance.name)) {
                throw new DeployedIdentitiesError('IDENTITY_SOURCE_INCOMPLETE', 'Realtime Database instance identity is incomplete or duplicated.');
            }
            seenNames.add(instance.name);
            let databaseUrl;
            try { databaseUrl = new URL(instance.databaseUrl); } catch (_) {
                throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Realtime Database rules origin is invalid.');
            }
            if (databaseUrl.protocol !== 'https:' || databaseUrl.username || databaseUrl.password ||
                databaseUrl.port || databaseUrl.search || databaseUrl.hash || databaseUrl.pathname !== '/' ||
                !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebaseio\.com|firebasedatabase\.app)$/.test(databaseUrl.hostname)) {
                throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Realtime Database rules origin is invalid.');
            }
            const policy = requireObject(await readJson(`${databaseUrl.origin}/.settings/rules.json`), 'Realtime Database policy');
            requireObject(policy.rules, 'Realtime Database rules source');
            instances.push({
                name: instance.name,
                state: instance.state,
                databaseUrlHash: stableHash(String(instance.databaseUrl)),
                rules: { sourceHash: stableHash(policy) }
            });
        }
        token = page.nextPageToken || null;
        if (token) {
            if (typeof token !== 'string' || seenTokens.has(token)) {
                throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Realtime Database pagination did not advance.');
            }
            seenTokens.add(token);
        }
    } while (token);
    return instances.sort((a, b) => a.name.localeCompare(b.name));
}

function createDeployedIdentitiesProvider(options = {}) {
    const projectId = String(options.projectId || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '').trim();
    if (!projectId) throw new TypeError('projectId is required');
    const region = String(options.region || process.env.FUNCTION_REGION || 'us-central1');
    const gatewayService = String(options.gatewayService || 'bel-presentation-demo');
    const gatewayRegion = String(options.gatewayRegion || 'asia-southeast1');
    const gatewayName = `projects/${projectId}/locations/${gatewayRegion}/services/${gatewayService}`;
    const hostingSite = String(options.hostingSite || projectId);
    const hostingChannel = String(options.hostingChannel || 'live');
    const functionName = String(options.functionName || 'api');
    const runtimeConfig = parseRuntimeConfig(options.firebaseConfig ?? process.env.FIREBASE_CONFIG, projectId);
    const now = options.now || (() => Date.now() / 1000);
    const readJson = options.readJson || createGoogleApiReader(options);
    if (typeof readJson !== 'function') throw new TypeError('readJson must be a function');

    const urls = {
        hostingChannel: `https://firebasehosting.googleapis.com/v1beta1/sites/${encodeURIComponent(hostingSite)}/channels/${encodeURIComponent(hostingChannel)}`,
        functions: `https://cloudfunctions.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(region)}/functions/${encodeURIComponent(functionName)}`,
        gateway: `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(gatewayRegion)}/services/${encodeURIComponent(gatewayService)}`,
        rulesRelease: `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/releases/cloud.firestore`,
        firestoreDatabase: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)`,
        indexes: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/collectionGroups/-/indexes?pageSize=1000`,
        realtime: `https://firebasedatabase.googleapis.com/v1beta/projects/${encodeURIComponent(projectId)}/locations/-/instances?pageSize=100`
    };

    async function read({ requestNonce }) {
        const [hostingChannelData, functionData, gatewayData, rulesReleaseData, firestoreDatabaseData, indexes, realtimeData] = await Promise.all([
            readJson(urls.hostingChannel, 'Hosting live channel'),
            readJson(urls.functions, 'Cloud Function'),
            readJson(urls.gateway, 'Cloud Run gateway'),
            readJson(urls.rulesRelease, 'Firestore rules release'),
            readJson(urls.firestoreDatabase, 'Firestore database'),
            readAllIndexes(readJson, urls.indexes),
            readRealtimeInstances(readJson, urls.realtime)
        ]);

        const release = requireObject(hostingChannelData.release, 'Hosting live channel release');
        const versionName = String(release.version?.name || '');
        if (!versionName) throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Hosting live channel has no current version.');
        const versionUrl = `https://firebasehosting.googleapis.com/v1beta1/${versionName}`;
        const version = await readJson(versionUrl, 'Hosting live version');
        const provenance = parseReleaseMetadata(release.message);
        const rulesRelease = requireObject(rulesReleaseData, 'Firestore rules release');
        const rulesetName = String(rulesRelease.rulesetName || '');
        if (!rulesetName) throw new DeployedIdentitiesError('IDENTITY_SOURCE_INVALID', 'Firestore has no current ruleset identity.');
        const ruleset = await readJson(`https://firebaserules.googleapis.com/v1/${rulesetName}`, 'Firestore ruleset');
        const functionConfig = functionData.serviceConfig || {};
        const functionSource = storageSource(functionData.buildConfig?.sourceProvenance?.resolvedStorageSource ?? functionData.buildConfig?.source?.storageSource);
        const gatewayTemplate = gatewayData.template || {};
        const gatewayContainer = Array.isArray(gatewayTemplate.containers) ? gatewayTemplate.containers[0] || {} : {};
        if (!functionData.state || !functionData.buildConfig?.runtime || !functionSource.bucket || !functionSource.object || !functionSource.generation || !(functionData.serviceConfig?.revision || functionData.revision)) {
            throw new DeployedIdentitiesError('IDENTITY_SOURCE_INCOMPLETE', 'Cloud Function identity is incomplete.');
        }
        if (gatewayData.name !== gatewayName || (!gatewayData.latestReadyRevision && !gatewayData.latestCreatedRevision) || !imageDigest(gatewayContainer.image)) {
            throw new DeployedIdentitiesError('IDENTITY_SOURCE_INCOMPLETE', 'Cloud Run gateway identity is incomplete.');
        }
        const rulesFiles = ruleset.source?.files;
        if (!Array.isArray(rulesFiles) || !rulesFiles.length || rulesFiles.some(file =>
            !file || typeof file.name !== 'string' || !file.name.trim() ||
            typeof file.content !== 'string' || !file.content.trim())) {
            throw new DeployedIdentitiesError('IDENTITY_SOURCE_INCOMPLETE', 'Firestore rules source is incomplete.');
        }
        const normalizedIndexes = indexes.map(normalizeIndex);
        const normalizedRealtime = realtimeData;
        const state = {
            projectId,
            provenance: {
                candidateSha: provenance.candidateSha,
                baseSha: provenance.baseSha,
                scopeHash: provenance.scopeHash,
                owner: provenance.owner,
                resources: provenance.resources,
                hostingReleaseName: release.name || null,
                hostingReleaseMessageHash: stableHash(String(release.message || ''))
            },
            hosting: {
                site: hostingSite,
                channel: hostingChannel,
                releaseName: release.name || null,
                releaseTime: release.releaseTime || null,
                versionName,
                versionStatus: version.status || null,
                versionCreateTime: version.createTime || null,
                config: version.config || {},
                configHash: stableHash(version.config || {}),
                fileCount: finiteNumber(version.fileCount)
            },
            api: {
                name: functionData.name || null,
                state: functionData.state || null,
                updateTime: functionData.updateTime || null,
                revision: functionConfig.revision || functionData.revision || null,
                runtime: functionData.buildConfig?.runtime || null,
                source: {
                    bucket: functionSource.bucket,
                    object: functionSource.object,
                    storageGeneration: functionSource.generation
                },
                serviceAccount: functionConfig.serviceAccountEmail || null,
                uri: functionConfig.uri || null,
                serviceConfig: {
                    availableMemory: functionConfig.availableMemory || null,
                    timeoutSeconds: finiteNumber(functionConfig.timeoutSeconds),
                    maxInstanceCount: finiteNumber(functionConfig.maxInstanceCount),
                    maxInstanceRequestConcurrency: finiteNumber(functionConfig.maxInstanceRequestConcurrency),
                    ingressSettings: functionConfig.ingressSettings || null
                }
            },
            gateway: {
                name: gatewayData.name || null,
                uid: gatewayData.uid || null,
                updateTime: gatewayData.updateTime || null,
                revision: gatewayTemplate.revision || gatewayData.latestReadyRevision || gatewayData.latestCreatedRevision || null,
                imageDigest: imageDigest(gatewayContainer.image),
                serviceAccount: gatewayTemplate.serviceAccount || null,
                timeout: gatewayTemplate.timeout || null,
                maxInstanceRequestConcurrency: finiteNumber(gatewayTemplate.maxInstanceRequestConcurrency),
                ingress: gatewayData.ingress || null,
                configHash: stableHash({
                    serviceAccount: gatewayTemplate.serviceAccount || null,
                    timeout: gatewayTemplate.timeout || null,
                    maxInstanceRequestConcurrency: finiteNumber(gatewayTemplate.maxInstanceRequestConcurrency),
                    ingress: gatewayData.ingress || null
                }),
                traffic: Array.isArray(gatewayData.traffic) ? gatewayData.traffic.map((entry) => ({
                    type: entry?.type || null,
                    percent: finiteNumber(entry?.percent),
                    revision: entry?.revision || null
                })) : []
            },
            firestore: {
                database: {
                    name: firestoreDatabaseData.name || `projects/${projectId}/databases/(default)`,
                    uid: firestoreDatabaseData.uid || null,
                    locationId: firestoreDatabaseData.locationId || null,
                    type: firestoreDatabaseData.type || null,
                    updateTime: firestoreDatabaseData.updateTime || null
                },
                rules: {
                    releaseName: rulesRelease.name || null,
                    rulesetName,
                    updateTime: rulesRelease.updateTime || null,
                    sourceHash: stableHash(rulesFiles.map((file) => ({ name: file?.name || null, content: String(file?.content || '') }))),
                    fileNames: rulesFiles.map((file) => file?.name || null)
                },
                indexes: {
                    count: normalizedIndexes.length,
                    hash: stableHash(normalizedIndexes),
                    entries: normalizedIndexes
                }
            },
            realtime: {
                count: normalizedRealtime.length,
                hash: stableHash(normalizedRealtime),
                instances: normalizedRealtime
            },
            config: runtimeConfig
        };
        const timestamp = Number(typeof now === 'function' ? now() : now);
        if (!Number.isFinite(timestamp)) throw new DeployedIdentitiesError('IDENTITY_TIMESTAMP_INVALID', 'Provider read time is invalid.');
        return {
            schemaVersion: SCHEMA_VERSION,
            expiryUnit: EXPIRY_UNIT,
            owner: provenance.owner,
            resources: provenance.resources,
            candidateSha: provenance.candidateSha,
            baseSha: provenance.baseSha,
            scopeHash: provenance.scopeHash,
            readAt: timestamp,
            requestNonce,
            state,
            stateHash: stableHash(state)
        };
    }

    return {
        async read({ requestNonce } = {}) {
            if (!/^[A-Za-z0-9_-]{12,128}$/.test(String(requestNonce || ''))) {
                throw new DeployedIdentitiesError('IDENTITY_NONCE_INVALID', 'Provider request nonce is invalid.');
            }
            return read({ requestNonce });
        }
    };
}

module.exports = {
    createDeployedIdentitiesProvider,
    createGoogleApiReader,
    DeployedIdentitiesError,
    parseReleaseMetadata,
    stableHash,
    stableJson
};
