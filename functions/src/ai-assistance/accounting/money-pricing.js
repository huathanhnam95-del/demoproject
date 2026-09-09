'use strict';
const crypto = require('crypto');

const NANO_PER_CENT = 10000000n;
const MAX_ALLOWANCE_NANO = 5000000000n;
const MAX_INTEGER = 10n ** 30n;
class AccountingError extends Error {
    constructor(code, message, status = 400) { super(message); this.name = 'AccountingError'; this.code = code; this.status = status; }
}
function reject(code, message, status = 400) { throw new AccountingError(code, message, status); }
function integer(value, label = 'integer', { signed = false } = {}) {
    if (typeof value !== 'string' || !(signed ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/).test(value) || value === '-0' || value.length > 32) reject('INVALID_INTEGER', `${label} must be a canonical decimal integer string.`);
    const number = BigInt(value); if (number > MAX_INTEGER || number < -MAX_INTEGER) reject('INTEGER_LIMIT', `${label} exceeds its bound.`); return number;
}
function centsToNano(value) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 500) reject('INVALID_ALLOWANCE', 'Allowance configuration must be integer cents between zero and the $5 monitored monthly target.'); return (BigInt(value) * NANO_PER_CENT).toString(); }
function validateAllowanceNano(value) { const amount = integer(value, 'allowance'); if (amount > MAX_ALLOWANCE_NANO) reject('ALLOWANCE_CAP_EXCEEDED', 'Configured monthly target cannot exceed $5.', 409); return amount; }
function strict(value, fields) { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !fields.includes(key))) reject('INVALID_ACCOUNTING_INPUT', 'Unsupported fields or invalid object.'); return value; }
function text(value, label = 'identifier', max = 128) { if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || value.includes('/') || value.includes('\\')) reject('INVALID_IDENTIFIER', `Invalid ${label}.`); return value; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])); return value; }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function instant(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) reject('INVALID_CLOCK', 'Server clock is invalid.', 500); return date; }
function vietnamMonth(value) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(instant(value)); return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`; }
function monthEnd(month) { if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) reject('INVALID_MONTH', 'Invalid Vietnam month.'); const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number, 1) - 7 * 3600000).toISOString(); }
function deepFreeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
const STANDARD_PRICING = deepFreeze([
    { versionId: 'gemini-3.8-flash-standard-2026', provider: 'gemini', model: 'gemini-3.8-flash', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', ratesNano: { inputText: '750', outputText: '3750' } },
    { versionId: 'gemini-3.8-flash-standard-2027', provider: 'gemini', model: 'gemini-3.8-flash', serviceTier: 'standard', effectiveAt: '2027-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z', ratesNano: { inputText: '1500', outputText: '7500' } },
    { versionId: 'gemini-3.1-live-standard-2026', provider: 'gemini', model: 'gemini-3.1-flash-live-preview', serviceTier: 'standard', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', ratesNano: { inputText: '750', outputText: '4500', inputAudio: '3000', outputAudio: '12000', inputImage: '1000', inputVideo: '1000' } }
]);
// Separate native versions preserve the historical embedded pricing vectors.
// Token-based calculation uses the published generic Flash input rate, not an invoice.
const NATIVE_STANDARD_PRICING = deepFreeze(STANDARD_PRICING.map(price => price.model === 'gemini-3.8-flash' ? { ...price, versionId: price.versionId + '-native-multimodal-v2', ratesNano: { ...price.ratesNano, inputAudio: price.ratesNano.inputText, inputImage: price.ratesNano.inputText } } : price));
function validatePricing(raw) {
    strict(raw, ['versionId', 'provider', 'model', 'serviceTier', 'effectiveAt', 'expiresAt', 'ratesNano']);
    for (const key of ['versionId', 'provider', 'model']) text(raw[key], key);
    if (raw.serviceTier !== 'standard' || instant(raw.expiresAt) <= instant(raw.effectiveAt)) reject('INVALID_PRICING', 'Pricing interval or tier is invalid.');
    if (!raw.ratesNano || Array.isArray(raw.ratesNano) || !Object.keys(raw.ratesNano).length || Object.keys(raw.ratesNano).length > 16) reject('INVALID_PRICING', 'Bounded rates are required.');
    for (const [category, rate] of Object.entries(raw.ratesNano)) { text(category, 'billing category', 64); integer(rate, 'unit rate'); }
    return deepFreeze(JSON.parse(JSON.stringify(raw)));
}
function selectPricing(registry, model, at) { const time = instant(at).getTime(); const rows = registry.filter(p => p.model === model && Date.parse(p.effectiveAt) <= time && time < Date.parse(p.expiresAt)); if (rows.length !== 1) reject('PRICING_UNAVAILABLE', 'Exactly one effective pricing version is required.', 409); return rows[0]; }
function calculateCost(pricing, quantities) {
    if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities) || Object.keys(quantities).length > 16) reject('INVALID_USAGE', 'Invalid quantity vector.');
    let cost = 0n;
    for (const [category, quantity] of Object.entries(quantities)) { if (!Object.hasOwn(pricing.ratesNano, category)) reject('UNSUPPORTED_BILLING_CATEGORY', 'Usage category lacks pinned pricing.'); cost += integer(quantity, 'quantity') * integer(pricing.ratesNano[category], 'unit rate'); }
    if (cost > MAX_INTEGER) reject('INTEGER_LIMIT', 'Cost exceeds accounting bound.'); return cost.toString();
}
module.exports = { AccountingError, reject, integer, centsToNano, validateAllowanceNano, MAX_ALLOWANCE_NANO, strict, text, digest, instant, vietnamMonth, monthEnd, deepFreeze, STANDARD_PRICING, NATIVE_STANDARD_PRICING, validatePricing, selectPricing, calculateCost };
