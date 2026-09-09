'use strict';
// This engineering wire parser does not certify a Gemini schema or billing
// bound. Only the registered server provider may supply these messages.
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('INVALID_PROVIDER_MESSAGE');
}
function text(value, limit = 16000) { if (typeof value !== 'string' || value.length > limit) throw new Error('INVALID_PROVIDER_MESSAGE'); return value; }
function pcm(value) {
    if (typeof value !== 'string' || value.length > 48000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('INVALID_PROVIDER_AUDIO');
    const bytes = Buffer.from(value, 'base64'); if (!bytes.length || bytes.length % 2) throw new Error('INVALID_PROVIDER_AUDIO'); return value;
}
function parseProviderMessage(message) {
    object(message, ['userTranscription', 'assistant', 'interrupted', 'turnComplete', 'usage']); const events = [];
    if (message.userTranscription !== undefined) {
        const row = message.userTranscription; object(row, ['utteranceId', 'eventId', 'text', 'final', 'transcription']);
        if (typeof row.final !== 'boolean') throw new Error('INVALID_PROVIDER_MESSAGE');
        text(row.utteranceId, 128); text(row.eventId, 128); text(row.text);
        events.push({ type: 'user_transcription', ...row });
    }
    if (message.assistant !== undefined) {
        object(message.assistant, ['parts']); if (!Array.isArray(message.assistant.parts) || message.assistant.parts.length > 32) throw new Error('INVALID_PROVIDER_MESSAGE');
        for (const part of message.assistant.parts) {
            object(part, ['text', 'audio']); if (part.text === undefined && part.audio === undefined) throw new Error('INVALID_PROVIDER_MESSAGE');
            if (part.text !== undefined) events.push({ type: 'assistant_text', text: text(part.text) });
            if (part.audio !== undefined) { object(part.audio, ['data', 'sampleRate']); if (part.audio.sampleRate !== 24000) throw new Error('INVALID_PROVIDER_AUDIO'); events.push({ type: 'assistant_audio', data: pcm(part.audio.data), sampleRate: 24000 }); }
        }
    }
    for (const flag of ['interrupted', 'turnComplete']) if (message[flag] !== undefined) { if (typeof message[flag] !== 'boolean') throw new Error('INVALID_PROVIDER_MESSAGE'); if (message[flag]) events.push({ type: flag === 'interrupted' ? 'interrupted' : 'turn_complete' }); }
    if (message.usage !== undefined) {
        object(message.usage, ['evidenceId', 'providerRequestId', 'complete', 'quantities']);
        if (typeof message.usage.complete !== 'boolean' || !message.usage.evidenceId || !message.usage.providerRequestId) throw new Error('INVALID_PROVIDER_USAGE');
        // Completeness/categories/trust are validated by the registered ledger
        // provider adapter; never derive quantities from audio or transcript.
        events.push({ type: 'usage', evidence: message.usage });
    }
    return events;
}
// Observational native parsing only. The Live reference does not provide a
// final marker on inputTranscription or a proven utterance/audio association.
// https://ai.google.dev/api/live -- reviewed September 8, 2026.
function parseGeminiMessage(message) {
    object(message, ['setupComplete', 'serverContent', 'toolCall', 'toolCallCancellation', 'usageMetadata', 'goAway', 'sessionResumptionUpdate']);
    const events = [];
    if (message.toolCall !== undefined || message.toolCallCancellation !== undefined) throw new Error('UNSUPPORTED_PROVIDER_TOOL');
    if (message.serverContent !== undefined) {
        const content = message.serverContent;
        object(content, ['modelTurn', 'turnComplete', 'interrupted', 'generationComplete', 'inputTranscription', 'outputTranscription', 'groundingMetadata', 'urlContextMetadata', 'turnCompleteReason', 'waitingForInput']);
        if (content.inputTranscription !== undefined) { object(content.inputTranscription, ['text', 'languageCode']); events.push({ type: 'transcript', text: text(content.inputTranscription.text), final: false, attestable: false }); }
        if (content.outputTranscription !== undefined) { object(content.outputTranscription, ['text', 'languageCode']); events.push({ type: 'assistant_text', text: text(content.outputTranscription.text) }); }
        if (content.modelTurn !== undefined) {
            object(content.modelTurn, ['role', 'parts']); if (content.modelTurn.role !== undefined && content.modelTurn.role !== 'model') throw new Error('INVALID_PROVIDER_MESSAGE');
            if (!Array.isArray(content.modelTurn.parts) || content.modelTurn.parts.length > 32) throw new Error('INVALID_PROVIDER_MESSAGE');
            for (const part of content.modelTurn.parts) {
                object(part, ['text', 'inlineData', 'thought', 'thoughtSignature']);
                if (part.text !== undefined) events.push({ type: 'assistant_text', text: text(part.text) });
                if (part.inlineData !== undefined) { object(part.inlineData, ['mimeType', 'data']); if (part.inlineData.mimeType !== 'audio/pcm;rate=24000') throw new Error('UNSUPPORTED_PROVIDER_AUDIO'); events.push({ type: 'assistant_audio', data: pcm(part.inlineData.data), sampleRate: 24000 }); }
            }
        }
        for (const [key, type] of [['interrupted', 'interrupted'], ['turnComplete', 'turn_complete'], ['generationComplete', 'generation_complete']]) if (content[key] !== undefined) { if (typeof content[key] !== 'boolean') throw new Error('INVALID_PROVIDER_MESSAGE'); if (content[key]) events.push({ type }); }
    }
    if (message.usageMetadata !== undefined) events.push({ type: 'usage_unknown', reason: 'NATIVE_LIVE_USAGE_UNPROVEN' });
    return events;
}
module.exports = { parseProviderMessage, parseGeminiMessage, pcm };
