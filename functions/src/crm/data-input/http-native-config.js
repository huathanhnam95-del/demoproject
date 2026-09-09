'use strict';
const { resolveLiveChatApiKey } = require('../../ai-assistance/providers/live-chat-credentials');
const { createDataInputNativeServices } = require('./native-provider');

/** Trusted server composition only; never pass request data as these options. */
function buildHttpNativeConfig({ enabled = false, env = process.env, resolveApiKey = resolveLiveChatApiKey, createNative = createDataInputNativeServices } = {}) {
    if (enabled !== true || env.CRM_VOICE_NATIVE_ENABLED !== 'true') return null;
    let url;
    try { url = new URL(env.CRM_VOICE_RELAY_URL); }
    catch { throw TypeError('A secure CRM voice relay URL is required.'); }
    const demo = /^demo-[a-z][a-z0-9-]+$/.test(env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || '');
    const local = demo && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || local)) throw TypeError('A secure CRM voice relay URL is required.');
    return { nativeMode: true, native: createNative({ apiKey: resolveApiKey(env) }), voiceRelayUrl: url.origin };
}

module.exports = { buildHttpNativeConfig };
