'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRelayServer } = require('./server');
function invalid() { throw Object.assign(new Error('Invalid voice runtime configuration'), { code: 'VOICE_RUNTIME_CONFIG' }); }
function readConfiguration(env = process.env) {
    const projectId = env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
    if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) invalid();
    const demo = projectId.startsWith('demo-');
    const emulatorKeys = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'];
    if (!demo && emulatorKeys.some(key => env[key])) invalid();
    if (demo && (!env.FIRESTORE_EMULATOR_HOST || !env.FIREBASE_AUTH_EMULATOR_HOST || env.NODE_ENV === 'production')) invalid();
    const port = Number(env.PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) invalid();
    const allowedOrigins = [...new Set(String(env.CRM_VOICE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean))];
    if (!allowedOrigins.length || allowedOrigins.some(origin => {
        try { const url = new URL(origin); return url.origin !== origin || (url.protocol !== 'https:' && !(demo && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))); } catch (_) { return true; }
    })) invalid();
    const compositionFile = env.CRM_VOICE_COMPOSITION_MODULE;
    const compositionSha256 = env.CRM_VOICE_COMPOSITION_SHA256;
    if (!!compositionFile !== !!compositionSha256 || compositionFile && !path.isAbsolute(compositionFile) || compositionSha256 && !/^[a-f0-9]{64}$/.test(compositionSha256)) invalid();
    if (env.CRM_VOICE_NATIVE_ENABLED !== undefined && !['true', 'false'].includes(env.CRM_VOICE_NATIVE_ENABLED)) invalid();
    return Object.freeze({ nativeEnabled: env.CRM_VOICE_NATIVE_ENABLED === 'true', projectId, demo, port, allowedOrigins: Object.freeze(allowedOrigins), compositionFile, compositionSha256 });
}
function loadComposition(config) {
    if (!config.compositionFile) return require('./projects-composition').composeProjects;
    const file = path.resolve(config.compositionFile);
    if (path.extname(file) !== '.js' || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== config.compositionSha256) invalid();
    const factory = require(file).composeVoice;
    if (typeof factory !== 'function') invalid();
    return factory;
}
async function createRuntime({ env = process.env, compose, relayFactory = createRelayServer } = {}) {
    const config = readConfiguration(env);
    const composition = await (compose || loadComposition(config))({ config, nativeCredentials: config.nativeEnabled ? { apiKey: require('../../functions/src/ai-assistance/providers/live-chat-credentials').resolveLiveChatApiKey(env) } : null });
    if (!composition || composition.engineeringMode === true || typeof composition.authenticate !== 'function') { await composition?.close?.(); invalid(); }
    // Native dispatch requires both explicit deployment configuration and the
    // registered composition; admission remains in the shared ledger.
    let relay;
    try {
        relay = relayFactory({ ...composition, allowedOrigins: config.allowedOrigins, engineeringMode: false });
        const handlers = relay.server.listeners('request');
        relay.server.removeAllListeners('request');
        relay.server.on('request', (req, res) => {
            if (req.method === 'GET' && ['/healthz', '/readyz'].includes(req.url)) {
                const ready = config.nativeEnabled && composition.nativeMode === true && composition.nativeReady === true && composition.providerFactory?.native === true;
                res.writeHead(req.url === '/readyz' && !ready ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(JSON.stringify({ service: 'crm-voice-relay', alive: true, nativeReady: ready, ...(ready ? {} : { reason: 'NATIVE_NOT_CONFIGURED' }) })); return;
            }
            for (const handler of handlers) handler.call(relay.server, req, res);
        });
    } catch (error) { await composition.close?.(); throw error; }
    let closing;
    return Object.freeze({ config, server: relay.server,
        async start() { await new Promise((resolve, reject) => { relay.server.once('error', reject); relay.server.listen(config.port, '0.0.0.0', () => { relay.server.removeListener('error', reject); resolve(); }); }); },
        close() { closing ||= (async () => { try { await relay.close(); } finally { await composition.close?.(); } })(); return closing; }
    });
}
function installShutdown(runtime, processLike = process) {
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        Promise.resolve().then(() => runtime.close()).catch(() => {
            processLike.stderr.write('{"event":"voice_runtime_shutdown_failed","code":"VOICE_RUNTIME_UNAVAILABLE"}\n');
            processLike.exitCode = 1;
        });
    };
    processLike.once('SIGTERM', shutdown); processLike.once('SIGINT', shutdown);
}
async function main() {
    let runtime;
    try {
        runtime = await createRuntime(); await runtime.start();
        process.stdout.write(`${JSON.stringify({ event: 'voice_runtime_started', nativeConfigured: runtime.config.nativeEnabled })}\n`);
        installShutdown(runtime);
    } catch (_) {
        try { await runtime?.close(); } catch (_) { /* startup diagnostics remain sanitized even when cleanup fails */ }
        process.stderr.write('{"event":"voice_runtime_start_failed","code":"VOICE_RUNTIME_UNAVAILABLE"}\n'); process.exitCode = 1;
    }
}
if (require.main === module) void main();
module.exports = { readConfiguration, loadComposition, createRuntime, installShutdown };
