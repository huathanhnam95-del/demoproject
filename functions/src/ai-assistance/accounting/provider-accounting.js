'use strict';
const { strict, reject, integer, text, digest } = require('./money-pricing');

// Legacy default-off indicator only. Runtime availability is resolved by the
// ledger from explicit native configuration, policy and provider registration.
const NATIVE_PAID_DISPATCH_AVAILABLE = false;
const NATIVE_BOUNDS = Object.freeze({
    'gemini-3.8-flash': Object.freeze({ versionId: 'flash-unproven', proven: false }),
    'gemini-3.1-flash-live-preview': Object.freeze({ versionId: 'live-unproven', proven: false })
});
function count(value, label) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) reject('INVALID_USAGE', `${label} must be a non-negative safe integer.`); return BigInt(value); }
function normalizeFlashUsage(usage) {
    strict(usage, ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'toolUsePromptTokenCount', 'promptTokensDetails', 'candidatesTokensDetails', 'cacheTokensDetails', 'toolUsePromptTokensDetails', 'serviceTier']);
    if (usage.serviceTier !== 'standard') reject('UNSUPPORTED_SERVICE_TIER', 'Only explicit standard service-tier evidence is supported.');
    for (const key of ['cachedContentTokenCount', 'toolUsePromptTokenCount']) if (usage[key] !== undefined && count(usage[key], key) !== 0n) reject('UNSUPPORTED_BILLING_CATEGORY', 'Caching/tool billing is not supported.');
    for (const key of ['cacheTokensDetails', 'toolUsePromptTokensDetails']) if (usage[key] !== undefined && (!Array.isArray(usage[key]) || usage[key].length)) reject('UNSUPPORTED_BILLING_CATEGORY', 'Caching/tool detail evidence is unsupported.');
    const prompt = count(usage.promptTokenCount, 'promptTokenCount'); const candidates = count(usage.candidatesTokenCount, 'candidatesTokenCount'); const thoughts = count(usage.thoughtsTokenCount ?? 0, 'thoughtsTokenCount');
    if (count(usage.totalTokenCount, 'totalTokenCount') !== prompt + candidates + thoughts) reject('USAGE_TOTAL_MISMATCH', 'Total tokens disagree with disjoint counts.');
    for (const [key, total] of [['promptTokensDetails', prompt], ['candidatesTokensDetails', candidates]]) {
        if (usage[key] === undefined) continue;
        if (!Array.isArray(usage[key]) || usage[key].length > 1) reject('UNSUPPORTED_BILLING_CATEGORY', 'Only unambiguous text usage details are supported.');
        let sum = 0n; for (const detail of usage[key]) { strict(detail, ['modality', 'tokenCount']); if (detail.modality !== 'TEXT') reject('UNSUPPORTED_BILLING_CATEGORY', 'Non-text billing requires a proven adapter.'); sum += count(detail.tokenCount, 'tokenCount'); }
        if (sum !== total) reject('USAGE_TOTAL_MISMATCH', 'Modality details disagree with totals.');
    }
    return { inputText: prompt.toString(), outputText: (candidates + thoughts).toString() };
}
function validateBoundedRequest(raw) {
    strict(raw, ['inputTokens', 'outputTokens', 'maxRequests']);
    const input = integer(raw.inputTokens, 'inputTokens'); const output = integer(raw.outputTokens, 'outputTokens');
    if (input > 1048576n || output < 1n || output > 65536n || typeof raw.maxRequests !== 'number' || !Number.isInteger(raw.maxRequests) || raw.maxRequests < 1 || raw.maxRequests > 3) reject('REQUEST_BOUND_EXCEEDED', 'Request exceeds its explicit engineering limits.');
    return { inputTokens: input.toString(), outputTokens: output.toString(), maxRequests: raw.maxRequests };
}
function validateNormalizedEvidence(raw, expectedCategories = [], native = null) {
    if (native) {
        strict(raw, ['evidenceId', 'dispatchIdentity', 'providerRequestId', 'complete', 'quantities', 'provenance']);
        text(raw.evidenceId, 'evidence ID'); if (raw.dispatchIdentity !== native.dispatchIdentity) reject('EVIDENCE_CONFLICT', 'Local dispatch identity does not match reservation.');
        if (raw.providerRequestId !== null) text(raw.providerRequestId, 'provider request ID');
        if (typeof raw.complete !== 'boolean') reject('INVALID_EVIDENCE', 'Completeness required.');
        strict(raw.provenance, ['usageMetadata', 'usageDigest', 'normalizationVersion', 'aggregation', 'reasons', 'derived', 'serviceTier']);
        if (Buffer.byteLength(JSON.stringify(raw.provenance)) > 20000 || digest(raw.provenance.usageMetadata) !== raw.provenance.usageDigest) reject('INVALID_EVIDENCE', 'Usage provenance is invalid or oversized.');
        if (raw.complete) { if (!raw.quantities || typeof raw.quantities !== 'object' || Array.isArray(raw.quantities) || !Object.keys(raw.quantities).length || Object.keys(raw.quantities).length > 16 || expectedCategories.some(category => !Object.hasOwn(raw.quantities, category))) reject('INVALID_EVIDENCE', 'Complete native quantities must cover expected categories.'); for (const [key, value] of Object.entries(raw.quantities)) { text(key, 'category', 64); integer(value); } return { ...raw, quantities: { ...raw.quantities } }; }
        if (raw.quantities !== undefined) reject('INVALID_EVIDENCE', 'Incomplete evidence cannot release pending quantities.');
        return { ...raw };
    }
    strict(raw, ['evidenceId', 'providerRequestId', 'complete', 'quantities']); text(raw.evidenceId, 'evidence ID'); text(raw.providerRequestId, 'provider request ID');
    if (typeof raw.complete !== 'boolean') reject('INVALID_EVIDENCE', 'Evidence completeness is required.');
    if (!raw.complete) { if (raw.quantities !== undefined) reject('INVALID_EVIDENCE', 'Incomplete evidence cannot settle quantities.'); return { evidenceId: raw.evidenceId, providerRequestId: raw.providerRequestId, complete: false }; }
    if (!raw.quantities || typeof raw.quantities !== 'object' || Array.isArray(raw.quantities) || !Object.keys(raw.quantities).length || Object.keys(raw.quantities).length > 16) reject('INVALID_EVIDENCE', 'Final evidence requires bounded disjoint quantities.');
    if (expectedCategories.some(category => !Object.hasOwn(raw.quantities, category))) reject('INVALID_EVIDENCE', 'Final evidence must explicitly report every expected billing category, including zero usage.');
    for (const [key, value] of Object.entries(raw.quantities)) { text(key, 'billing category', 64); integer(value, 'usage quantity'); }
    return { evidenceId: raw.evidenceId, providerRequestId: raw.providerRequestId, complete: true, quantities: { ...raw.quantities } };
}
function normalizeNativeUsage({ kind, usageMetadata, serviceTier, dispatchIdentity, providerRequestId = null, evidenceId, final = false, aggregation = 'single_response', inputModalities = ['TEXT'] }) {
    text(dispatchIdentity, 'local dispatch identity'); text(evidenceId, 'evidence ID'); if (providerRequestId !== null) text(providerRequestId, 'provider request ID');
    const raw = JSON.parse(JSON.stringify(usageMetadata ?? null));
    if (Buffer.byteLength(JSON.stringify(raw)) > 16000) reject('INVALID_USAGE', 'Usage metadata exceeds provenance limit.');
    const provenance = { usageMetadata: raw, usageDigest: digest(raw), normalizationVersion: 'gemini-reported-v1', aggregation, serviceTier: serviceTier || null, reasons: [], derived: [] };
    const base = { evidenceId, dispatchIdentity, providerRequestId, complete: false, provenance };
    try {
        if (!['flash', 'live'].includes(kind) || final !== true || (kind === 'live' ? aggregation !== 'final_session_snapshot' : aggregation !== 'single_response')) reject('USAGE_INCOMPLETE', 'Final aggregation scope is not established.');
        if (serviceTier !== 'standard' || raw?.serviceTier !== undefined && raw.serviceTier !== 'standard') reject('UNSUPPORTED_SERVICE_TIER', 'Pinned Standard request tier is required.');
        if (raw.serviceTier === undefined) provenance.derived.push('service_tier_from_pinned_request');
        const outputKey = kind === 'flash' ? 'candidatesTokenCount' : 'responseTokenCount', detailsKey = kind === 'flash' ? 'candidatesTokensDetails' : 'responseTokensDetails';
        strict(raw, ['promptTokenCount', outputKey, 'thoughtsTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'toolUsePromptTokenCount', 'promptTokensDetails', detailsKey, 'cacheTokensDetails', 'toolUsePromptTokensDetails', 'serviceTier']);
        for (const key of ['cachedContentTokenCount', 'toolUsePromptTokenCount']) if (raw[key] !== undefined && count(raw[key], key) !== 0n) reject('UNSUPPORTED_BILLING_CATEGORY', 'Cache/tool accounting is incomplete.');
        for (const key of ['cacheTokensDetails', 'toolUsePromptTokensDetails']) if (raw[key]?.length) reject('UNSUPPORTED_BILLING_CATEGORY', 'Cache/tool modality accounting is incomplete.');
        const prompt = count(raw.promptTokenCount, 'prompt'), output = count(raw[outputKey], 'output'), total = count(raw.totalTokenCount, 'total');
        const residual = total - prompt - output; let thoughts;
        if (raw.thoughtsTokenCount === undefined) { if (residual !== 0n) reject('AMBIGUOUS_THOUGHTS', 'Unreported nonzero residual cannot be assigned.'); thoughts = 0n; provenance.derived.push('omitted_thoughts_zero_from_reconciled_total'); }
        else thoughts = count(raw.thoughtsTokenCount, 'thoughts');
        if (residual === 0n && thoughts > 0n) reject('AMBIGUOUS_THOUGHTS', 'Totals do not establish disjoint thought usage.');
        else if (residual !== thoughts) reject('USAGE_TOTAL_MISMATCH', 'Reported categories do not reconcile.');
        const quantities = kind === 'live' ? { inputText: '0', outputText: '0', inputAudio: '0', outputAudio: '0', inputImage: '0', inputVideo: '0' } : { inputText: '0', outputText: '0', inputAudio: '0', inputImage: '0' };
        const vector = (details, amount, side) => {
            if (details === undefined) {
                if (kind === 'flash' && side === 'input' && inputModalities.includes('IMAGE')) reject('MISSING_MODALITY_COUNTS', 'Image requests require explicit modality counts.');
                if (amount === 0n) { provenance.derived.push(`${side}_zero_from_total`); return; }
                if (kind === 'flash' && (side === 'output' || inputModalities.length === 1 && inputModalities[0] === 'TEXT')) { quantities[`${side}Text`] = amount.toString(); provenance.derived.push(`${side}_text_from_request_and_total`); return; }
                reject('MISSING_MODALITY_COUNTS', 'Nonzero modality split is missing.');
            }
            if (!Array.isArray(details) || details.length > 6) reject('INVALID_USAGE', 'Invalid modality vector.');
            let sum = 0n; const seen = new Set();
            for (const detail of details) { strict(detail, ['modality', 'tokenCount']); const suffix = { TEXT: 'Text', AUDIO: 'Audio', IMAGE: 'Image', VIDEO: 'Video' }[detail.modality], key = `${side}${suffix}`; if (!suffix || !Object.hasOwn(quantities, key) || seen.has(key) || kind === 'flash' && side === 'input' && !inputModalities.includes(detail.modality)) reject('UNSUPPORTED_BILLING_CATEGORY', 'Unsupported or duplicate modality.'); seen.add(key); const value = count(detail.tokenCount, 'modality tokens'); sum += value; quantities[key] = value.toString(); }
            if (kind === 'flash' && side === 'input' && inputModalities.includes('IMAGE') && inputModalities.some(modality => !seen.has(`input${{ TEXT: 'Text', IMAGE: 'Image' }[modality]}`))) reject('MISSING_MODALITY_COUNTS', 'Image requests require the complete pinned modality split.');
            if (sum !== amount) reject('USAGE_TOTAL_MISMATCH', 'Modality sum differs from reported total.');
        };
        vector(raw.promptTokensDetails, prompt, 'input'); vector(raw[detailsKey], output, 'output');
        // Included thoughts need text attribution; never add them again or
        // silently charge them as audio when the split is ambiguous.
        quantities.outputText = (BigInt(quantities.outputText) + thoughts).toString();
        return { ...base, complete: true, quantities };
    } catch (error) { provenance.reasons.push(error.code || 'INVALID_USAGE'); return base; }
}
module.exports = { NATIVE_PAID_DISPATCH_AVAILABLE, NATIVE_BOUNDS, normalizeNativeUsage, normalizeFlashUsage, validateBoundedRequest, validateNormalizedEvidence };
