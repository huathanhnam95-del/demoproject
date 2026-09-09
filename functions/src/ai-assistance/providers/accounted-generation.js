'use strict';
const crypto = require('node:crypto');
const { reject, strict, text, digest, deepFreeze } = require('../accounting/money-pricing');
const { DATA_INPUT_FEATURE } = require('../adapters/data-input');
const { quotaBounds, assertWithinBounds, usageEvidence } = require('../accounting/usage-meter');
const MAX_DESCRIPTOR_BYTES = 60000;
const PROJECTS_PURPOSES = new Set(['planning', 'task_draft', 'task_correction', 'automation_draft']);
// Only this server bridge can prove that a budget rejection preceded dispatch.
// A provider error with a matching code or copied properties is not that proof.
const budgetAdmissionDenials = new WeakSet();
function isBudgetAdmissionDenial(error) { return budgetAdmissionDenials.has(error); }
function ordered(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
    reject('INVALID_DESCRIPTOR', 'Descriptor must contain only JSON data.');
}
// Domain attachment ownership, expiry and canonical decoding remain the consumer's responsibility.
// Recheck the immutable transport bytes here before any ledger admission.
function checkedImage(image) {
    strict(image, ['attachmentId', 'sha256', 'width', 'height', 'bytesLength', 'inlineData']);
    text(image.attachmentId, 'attachment ID'); strict(image.inlineData, ['mimeType', 'data']);
    const { width, height, bytesLength, sha256, inlineData } = image;
    if (![width, height, bytesLength].every(value => Number.isSafeInteger(value) && value > 0) || width > 8192 || height > 8192 || width * height > 16000000 || bytesLength > 8 * 1024 * 1024) reject('INVALID_IMAGE', 'Image metadata exceeds local limits.');
    if (inlineData.mimeType !== 'image/png' || typeof inlineData.data !== 'string' || inlineData.data.length !== 4 * Math.ceil(bytesLength / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(inlineData.data)) reject('INVALID_IMAGE', 'Canonical PNG base64 is required.');
    const bytes = Buffer.from(inlineData.data, 'base64');
    if (bytes.length !== bytesLength || bytes.toString('base64') !== inlineData.data || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) reject('INVALID_IMAGE', 'Image bytes do not match their metadata.');
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) reject('INVALID_IMAGE', 'PNG header dimensions must match image metadata.');
    return ordered(image);
}
function descriptorRequest(request) {
    strict(request, ['model', 'systemInstruction', 'input', 'responseSchema', 'requestDigest', 'image']);
    if (typeof request.systemInstruction !== 'string' || !request.systemInstruction || typeof request.input !== 'string' || !request.input || !request.responseSchema || typeof request.responseSchema !== 'object' || Array.isArray(request.responseSchema)) reject('INVALID_DESCRIPTOR', 'A full text proposal descriptor is required.');
    text(request.model, 'model');
    const descriptor = ordered({ model: request.model, systemInstruction: request.systemInstruction, input: request.input, responseSchema: request.responseSchema });
    const serialized = JSON.stringify(descriptor); const inputBytes = Buffer.byteLength(serialized);
    if (inputBytes > MAX_DESCRIPTOR_BYTES) reject('DESCRIPTOR_TOO_LARGE', 'Proposal descriptor exceeds the accounting bridge byte limit.');
    if (request.image !== undefined) descriptor.image = checkedImage(request.image);
    const descriptorDigest = crypto.createHash('sha256').update(JSON.stringify(ordered(descriptor))).digest('hex');
    if (request.requestDigest !== descriptorDigest) reject('DESCRIPTOR_DIGEST_MISMATCH', 'Proposal descriptor digest does not match its full contents.');
    return { descriptor, descriptorDigest, inputBytes };
}
/** Server-only consumer bridge. Engineering mappings are explicit local fixtures,
 * not native token bounds. Explicit native policy uses monitored estimates, not
 * guaranteed cost caps. No provider result is durably cached here: a consumed
 * send permit requires external trusted recovery, never another transport call. */
function createAccountedGenerationProvider({ ledger, engineeringMode = false, engineeringMapping = null, nativeMode = false, nativeMapping = null, transport = null, onAccounting = null } = {}) {
    if (!ledger || typeof ledger.forFeature !== 'function' || typeof ledger.settle !== 'function' || typeof ledger.markUnknown !== 'function') throw new TypeError('A shared accounting ledger is required.');
    if (onAccounting !== null && typeof onAccounting !== 'function') throw new TypeError('Accounting observer must be a server callback.');
    if (nativeMapping !== null && engineeringMapping !== null) throw new TypeError('Choose one explicit generation mapping.');
    let mapping = null;
    const native = nativeMapping !== null;
    if (native) {
        strict(nativeMapping, ['sourceModel', 'model', 'boundsVersion', 'maxOutputBytes', 'maxOutputTokens']);
        if (nativeMode !== true || nativeMapping.sourceModel !== 'gemini-3.8-flash' || nativeMapping.model !== 'gemini-3.8-flash' ||
            !Number.isSafeInteger(nativeMapping.maxOutputBytes) || nativeMapping.maxOutputBytes < 1 || nativeMapping.maxOutputBytes > 65536 ||
            !Number.isSafeInteger(nativeMapping.maxOutputTokens) || nativeMapping.maxOutputTokens < 1 || nativeMapping.maxOutputTokens > 65536 || typeof transport !== 'function') throw new TypeError('Native generation requires explicit model, policy, local limits and server transport.');
        text(nativeMapping.boundsVersion, 'native policy version'); mapping = Object.freeze({ ...nativeMapping });
    }
    if (engineeringMapping !== null) {
        strict(engineeringMapping, ['sourceModel', 'model', 'boundsVersion', 'maxOutputBytes']);
        if (engineeringMode !== true || engineeringMapping.sourceModel !== 'gemini-3.8-flash' || typeof engineeringMapping.model !== 'string' || !engineeringMapping.model.startsWith('engineering-') || !Number.isSafeInteger(engineeringMapping.maxOutputBytes) || engineeringMapping.maxOutputBytes < 1 || engineeringMapping.maxOutputBytes > 65536 || typeof transport !== 'function') throw new TypeError('Only explicit bounded engineering mappings and transport are supported.');
        text(engineeringMapping.boundsVersion, 'bounds version'); mapping = Object.freeze({ ...engineeringMapping });
    }
    async function generateWithAccounting(input) {
        strict(input, ['actorUid', 'feature', 'purpose', 'operationId', 'request', 'context']);
        const featureName = input.feature, purpose = input.purpose;
        if (!(featureName === DATA_INPUT_FEATURE && purpose === 'draft') && !(featureName === 'projects' && PROJECTS_PURPOSES.has(purpose))) reject('FEATURE_PURPOSE_NOT_ALLOWED', 'This consumer supports registered data input and Projects purposes only.', 403);
        let context;
        if (featureName === 'projects') { if (input.context?.mode === 'create_project') { strict(input.context, ['mode']); context = { mode: 'create_project' }; } else { strict(input.context, ['projectId']); context = { projectId: text(input.context.projectId, 'project ID') }; } }
        else { if (input.context !== undefined) strict(input.context, []); context = {}; }
        const actorUid = text(input.actorUid, 'UID'); const operationId = text(input.operationId, 'operation ID');
        if (input.request?.image !== undefined && (!native || featureName !== DATA_INPUT_FEATURE || purpose !== 'draft')) reject('IMAGES_UNSUPPORTED', 'Images require configured native data input generation.', 409);
        const checked = descriptorRequest(input.request);
        if (!mapping || checked.descriptor.model !== mapping.sourceModel) reject('PAID_DISPATCH_DISABLED', 'Native paid generation remains disabled.', 409);
        const feature = ledger.forFeature(featureName);
        const request = deepFreeze({ ...checked, maxOutputBytes: mapping.maxOutputBytes, ...(native ? { maxOutputTokens: mapping.maxOutputTokens } : {}), maxRequests: 1 });
        // Persist only compact image metadata, while binding the full descriptor digest.
        const reservationRequest = checked.descriptor.image ? deepFreeze({ ...request, descriptor: { ...checked.descriptor, image: { attachmentId: checked.descriptor.image.attachmentId, sha256: checked.descriptor.image.sha256, width: checked.descriptor.image.width, height: checked.descriptor.image.height, bytesLength: checked.descriptor.image.bytesLength, mimeType: 'image/png' } } }) : request;
        // Stable operation identity causes changed descriptors to conflict;
        // the ledger digest binds every descriptor byte and engineering bound.
        let reservation;
        try {
            reservation = await feature.reserve(actorUid, { requestId: digest([featureName, operationId]), purpose, context, model: mapping.model, boundsVersion: mapping.boundsVersion, request: reservationRequest });
        } catch (error) {
            if (error instanceof Error && error.code === 'BUDGET_EXHAUSTED' && error.status === 409) budgetAdmissionDenials.add(error);
            throw error;
        }
        const dispatch = await feature.authorizeDispatch(actorUid, reservation.reservationId);
        if (!dispatch.sendPermit) reject('RESPONSE_RECOVERY_REQUIRED', 'This operation already consumed its send permit; trusted response recovery is required.', 409);
        const quota = dispatch.quota || dispatch.sendPermit.quota || reservation.quota;
        const permit = quota ? { ...dispatch.sendPermit, quota } : dispatch.sendPermit;
        const bounds = native ? quotaBounds(quota, 'generation') : null;
        let settled;
        try {
            if (permit.reservationId !== reservation.reservationId || permit.model !== mapping.model ||
                (native ? permit.engineeringOnly !== false || permit.provider !== 'gemini' : permit.engineeringOnly !== true || permit.provider === 'gemini')) reject('PAID_DISPATCH_DISABLED', 'Dispatch permit does not match the configured server transport.', 409);
            let response;
            try { response = await transport({ permit: deepFreeze({ ...permit }), request }); }
            catch (error) { if (native) reject('PROVIDER_GENERATION_FAILED', 'Native generation failed after dispatch; accounting requires reconciliation.', 502); throw error; }
            // Only the registered ledger adapter can trust this server
            // evidence. Incomplete native usage stays durably pending; a
            // reported cost above an estimate is still a real expense.
            settled = await ledger.settle(reservation.reservationId, response?.evidence);
            if (native ? !['settled', 'usage_unknown'].includes(settled.state) || settled.boundsViolated : settled.state !== 'settled' || settled.boundsViolated) reject('USAGE_UNRESOLVED', 'Trusted accounting state is required before returning output.', 409);
            if (typeof response?.output !== 'string' || Buffer.byteLength(response.output) > mapping.maxOutputBytes) reject('INVALID_OUTPUT', 'Provider output violates the bounded text contract.', 502);
            if (native) {
                // Domain consumers remain responsible for responseSchema
                // and authorization validation before using this JSON.
                try { JSON.parse(response.output); } catch (_) { reject('INVALID_OUTPUT', 'Provider output is not valid JSON.', 502); }
            }
            if (bounds) {
                assertWithinBounds(response.metering, bounds);
                settled = await ledger.recordUsage(reservation.reservationId, usageEvidence({ eventId: 'generation-final', stage: 'generation', counters: response.metering }));
            }
            const accounting = deepFreeze({ ...settled, unresolved: settled.state !== 'settled', policyMode: native ? 'monitored_target' : 'engineering', possibleOverage: native });
            if (onAccounting) await onAccounting(accounting);
            return { output: response.output, accounting };
        } catch (error) {
            // Never erase real settled expense for malformed model output.
            // Failures after a consumed permit otherwise retain obligation.
            if (settled?.state !== 'settled') { try { await ledger.markUnknown(reservation.reservationId); } catch (_) { /* Durable dispatch intent remains. */ } }
            throw error;
        }
    }
    return Object.freeze({ supportsImages: native && nativeMode === true && mapping !== null, generateWithAccounting, async generate(input) { return (await generateWithAccounting(input)).output; } });
}
module.exports = { createAccountedGenerationProvider, isBudgetAdmissionDenial, MAX_DESCRIPTOR_BYTES };
