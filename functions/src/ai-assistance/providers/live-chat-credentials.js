'use strict';
const fs = require('node:fs');
const path = require('node:path');
function invalid() { throw Object.assign(new Error('Live chat credential configuration is unavailable.'), { code: 'LIVE_CHAT_CREDENTIAL_CONFIG' }); }
function key(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n]/.test(value)) invalid();
    return value.trim();
}
// This resolver is only for CRM live chat and its supporting interpretation calls.
// General Gemini consumers retain their existing credential configuration.
function resolveLiveChatApiKey(env = process.env) {
    if (Object.hasOwn(env, 'CRM_VOICE_GEMINI_API_KEY')) return key(env.CRM_VOICE_GEMINI_API_KEY);
    const explicit = env.CRM_VOICE_CREDENTIAL_FILE;
    const file = explicit || (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Codex', 'private-provider-config', 'live-chat.env') : null);
    if (explicit && !path.isAbsolute(explicit)) invalid();
    if (file && (explicit || fs.existsSync(file))) {
        try {
            const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 8192) invalid();
            const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
            if (lines.length !== 1 || !lines[0].startsWith('CRM_VOICE_GEMINI_API_KEY=')) invalid();
            let value = lines[0].slice('CRM_VOICE_GEMINI_API_KEY='.length);
            if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            return key(value);
        } catch (_) { invalid(); }
    }
    return key(env.GEMINI_API_KEY);
}
module.exports = { resolveLiveChatApiKey };
