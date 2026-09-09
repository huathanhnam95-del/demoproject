'use strict';

const path = require('path');

const DEMO_PROJECT_ID = 'demo-crm-projects';
const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORTS = Object.freeze({
    auth: 9180,
    firestore: 8188,
    firestoreWebsocket: 8189,
    storage: 9199
});
const ROOT = path.resolve(__dirname, '../..', '..');
const FIREBASE_CONFIG_PATH = path.join(__dirname, 'firebase.json');

function parseEndpoint(value, label) {
    const match = String(value || '').trim().match(/^(?:https?:\/\/)?(\[[^\]]+\]|[^:]+):(\d+)$/i);
    if (!match) throw new Error(`${label} must be a host:port emulator endpoint.`);
    return {
        host: assertLoopbackHost(match[1].replace(/^\[|\]$/g, ''), `${label} host`),
        port: parsePort(match[2], `${label} port`)
    };
}

function parsePort(value, label, fallback) {
    const candidate = value === undefined || value === null || value === ''
        ? fallback
        : Number(value);
    if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535) {
        throw new Error(`${label} must be an integer loopback port between 1024 and 65535.`);
    }
    return candidate;
}

function assertLoopbackHost(host, label = 'host') {
    const normalized = String(host || '').trim().toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(normalized)) {
        throw new Error(`${label} must be loopback; refusing endpoint ${host || '(empty)'}.`);
    }
    return normalized === 'localhost' || normalized === '::1' ? LOOPBACK_HOST : normalized;
}

function assertSafeEmulatorConfig(config) {
    if (config.projectId !== DEMO_PROJECT_ID) {
        throw new Error(`CRM Projects emulator requires demo project ${DEMO_PROJECT_ID}; refusing ${config.projectId || '(empty)'}.`);
    }
    assertLoopbackHost(config.host, 'emulator host');
    assertLoopbackHost(config.auth.host, 'Auth emulator host');
    assertLoopbackHost(config.firestore.host, 'Firestore emulator host');
    assertLoopbackHost(config.storage.host, 'Storage emulator host');
    parsePort(config.auth.port, 'Auth emulator port', DEFAULT_PORTS.auth);
    parsePort(config.firestore.port, 'Firestore emulator port', DEFAULT_PORTS.firestore);
    parsePort(config.firestore.websocketPort, 'Firestore emulator websocket port', DEFAULT_PORTS.firestoreWebsocket);
    parsePort(config.storage.port, 'Storage emulator port', DEFAULT_PORTS.storage);
    const ports = [config.auth.port, config.firestore.port, config.firestore.websocketPort, config.storage.port];
    if (new Set(ports).size !== ports.length) {
        throw new Error('Auth, Firestore, Firestore websocket, and Storage emulator ports must be distinct.');
    }
    return config;
}

function getEmulatorConfig(env = process.env) {
    const projectId = String(env.CRM_PROJECTS_EMULATOR_PROJECT || DEMO_PROJECT_ID).trim();
    const host = assertLoopbackHost(env.CRM_PROJECTS_EMULATOR_HOST || LOOPBACK_HOST, 'emulator host');
    const config = {
        projectId,
        host,
        auth: {
            host: assertLoopbackHost(env.CRM_PROJECTS_EMULATOR_AUTH_HOST || host, 'Auth emulator host'),
            port: parsePort(env.CRM_PROJECTS_EMULATOR_AUTH_PORT, 'Auth emulator port', DEFAULT_PORTS.auth)
        },
        firestore: {
            host: assertLoopbackHost(env.CRM_PROJECTS_EMULATOR_FIRESTORE_HOST || host, 'Firestore emulator host'),
            port: parsePort(env.CRM_PROJECTS_EMULATOR_FIRESTORE_PORT, 'Firestore emulator port', DEFAULT_PORTS.firestore),
            websocketPort: parsePort(env.CRM_PROJECTS_EMULATOR_FIRESTORE_WEBSOCKET_PORT, 'Firestore emulator websocket port', DEFAULT_PORTS.firestoreWebsocket)
        },
        storage: {
            host: assertLoopbackHost(env.CRM_PROJECTS_EMULATOR_STORAGE_HOST || host, 'Storage emulator host'),
            port: parsePort(env.CRM_PROJECTS_EMULATOR_STORAGE_PORT, 'Storage emulator port', DEFAULT_PORTS.storage)
        },
        firebaseConfigPath: FIREBASE_CONFIG_PATH
    };
    const expectedEndpoints = {
        FIREBASE_AUTH_EMULATOR_HOST: config.auth,
        FIRESTORE_EMULATOR_HOST: config.firestore,
        FIREBASE_STORAGE_EMULATOR_HOST: config.storage
    };
    for (const [envKey, expected] of Object.entries(expectedEndpoints)) {
        if (!env[envKey]) continue;
        const actual = parseEndpoint(env[envKey], envKey);
        if (actual.host !== expected.host || actual.port !== expected.port) {
            throw new Error(`${envKey} points to ${actual.host}:${actual.port}; refusing non-dedicated emulator state.`);
        }
    }
    return assertSafeEmulatorConfig(config);
}

function emulatorEnvironment(config) {
    assertSafeEmulatorConfig(config);
    return {
        GCLOUD_PROJECT: config.projectId,
        FIREBASE_PROJECT_ID: config.projectId,
        FIREBASE_AUTH_EMULATOR_HOST: `${config.auth.host}:${config.auth.port}`,
        FIRESTORE_EMULATOR_HOST: `${config.firestore.host}:${config.firestore.port}`,
        FIREBASE_STORAGE_EMULATOR_HOST: `${config.storage.host}:${config.storage.port}`,
        CRM_PROJECTS_EMULATOR_PROJECT: config.projectId,
        CRM_PROJECTS_EMULATOR_HOST: config.host,
        CRM_PROJECTS_EMULATOR_AUTH_HOST: config.auth.host,
        CRM_PROJECTS_EMULATOR_AUTH_PORT: String(config.auth.port),
        CRM_PROJECTS_EMULATOR_FIRESTORE_HOST: config.firestore.host,
        CRM_PROJECTS_EMULATOR_FIRESTORE_PORT: String(config.firestore.port),
        CRM_PROJECTS_EMULATOR_FIRESTORE_WEBSOCKET_PORT: String(config.firestore.websocketPort),
        CRM_PROJECTS_EMULATOR_STORAGE_HOST: config.storage.host,
        CRM_PROJECTS_EMULATOR_STORAGE_PORT: String(config.storage.port)
    };
}

module.exports = {
    DEMO_PROJECT_ID,
    LOOPBACK_HOST,
    DEFAULT_PORTS,
    ROOT,
    FIREBASE_CONFIG_PATH,
    assertLoopbackHost,
    assertSafeEmulatorConfig,
    parseEndpoint,
    getEmulatorConfig,
    emulatorEnvironment
};
