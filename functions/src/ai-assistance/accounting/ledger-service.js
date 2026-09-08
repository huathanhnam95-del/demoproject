'use strict';
const crypto = require('crypto');
const { AI_ASSISTANCE_COLLECTIONS } = require('../collections');
const { reject, integer, validateAllowanceNano, strict, text, digest, instant, vietnamMonth, monthEnd, deepFreeze, STANDARD_PRICING, validatePricing, selectPricing, calculateCost } = require('./money-pricing');
const { validateNormalizedEvidence } = require('./provider-accounting');

const snapshotData = snapshot => snapshot?.exists ? snapshot.data() : null;
const MAX_EVIDENCE = 32;
const { NATIVE_MODELS } = require('./native-policy');
function createLedgerService({ db, runTransaction, now = () => new Date(), featureAdapters, resolveAllowance, pricingRegistry = STANDARD_PRICING, boundsRegistry = {}, providerAdapters = {}, engineeringMode = false, nativeMode = false, nativePolicy = null }) {
    if (!db || typeof runTransaction !== 'function' || typeof resolveAllowance !== 'function') throw new Error('Accounting requires database, transaction runner and allowance resolver.');
    const features = new Map(Object.entries(featureAdapters || {}).map(([key, adapter]) => {
        text(key, 'feature'); if (typeof adapter.authorize !== 'function' || typeof adapter.normalizeContext !== 'function' || !Array.isArray(adapter.models)) throw new Error('Registered feature requires authority, context normalization and model allowlist.');
        return [key, Object.freeze({ ...adapter, models: Object.freeze([...adapter.models]) })];
    }));
    const prices = Object.freeze(pricingRegistry.map(validatePricing));
    const proofs = new Map(Object.entries(boundsRegistry).map(([key, value]) => [key, Object.freeze({ ...value, models: Object.freeze([...(value.models || [])]) })]));
    const providers = new Map(Object.entries(providerAdapters).map(([key, value]) => [key, Object.freeze({ ...value })]));
    if (nativeMode === true && nativePolicy) { text(nativePolicy.versionId, 'native policy version'); if (!Array.isArray(nativePolicy.models) || nativePolicy.models.some(model => !NATIVE_MODELS.includes(model))) reject('INVALID_NATIVE_POLICY', 'Native model registration invalid.'); }
    const nativeAvailable = () => nativeMode === true && nativePolicy?.kind === 'estimated' && typeof nativePolicy.deriveEstimatedQuantities === 'function' && Array.isArray(nativePolicy.models) && nativePolicy.models.length > 0 && providers.get('gemini')?.native === true && typeof providers.get('gemini')?.normalizeEvidence === 'function' && nativePolicy.models.some(model => prices.filter(price => price.model === model && price.provider === 'gemini' && Date.parse(price.effectiveAt) <= instant(now()).getTime() && instant(now()).getTime() < Date.parse(price.expiresAt)).length === 1);
    const document = (kind, key) => db.collection(AI_ASSISTANCE_COLLECTIONS[kind]).doc(key);
    const accountRef = uid => document('accounts', digest(['account', uid]));
    const ledgerRef = (uid, month) => document('ledgers', digest(['ledger', uid, month]));
    const timestamp = () => instant(now()).toISOString();
    const execute = callback => runTransaction(callback);
    function feature(name) { const adapter = features.get(name); if (!adapter) reject('FEATURE_NOT_REGISTERED', 'AI feature is not registered.', 403); return adapter; }
    function guardData(value, uid) {
        if (!value) return { uid, unknownCount: 0, estimatedUnknownCount: 0, boundsViolated: false, dispatchedByMonth: {} };
        if (value.uid !== uid || !Number.isSafeInteger(value.unknownCount) || value.unknownCount < 0 || typeof value.boundsViolated !== 'boolean') reject('LEDGER_INTEGRITY', 'Account guard is invalid.', 409);
        // Older guards count every intent as unknown. Retain that conservative
        // fence when their month map is absent; never infer released obligations.
        const map = value.dispatchedByMonth === undefined ? {} : value.dispatchedByMonth;
        if (!map || typeof map !== 'object' || Array.isArray(map) || ![Object.prototype, null].includes(Object.getPrototypeOf(map)) || Object.keys(map).length > 1200) reject('LEDGER_INTEGRITY', 'Dispatch month counters are invalid.', 409);
        let total = 0;
        for (const [month, count] of Object.entries(map)) {
            if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || !Number.isSafeInteger(count) || count < 1) reject('LEDGER_INTEGRITY', 'Dispatch month counters are invalid.', 409);
            total += count;
            if (!Number.isSafeInteger(total)) reject('LEDGER_INTEGRITY', 'Dispatch month counters overflow.', 409);
        }
        const estimatedUnknownCount = value.estimatedUnknownCount === undefined ? 0 : value.estimatedUnknownCount;
        if (!Number.isSafeInteger(estimatedUnknownCount) || estimatedUnknownCount < 0 || estimatedUnknownCount > value.unknownCount || estimatedUnknownCount > total) reject('LEDGER_INTEGRITY', 'Estimated unknown counters are invalid.', 409);
        return { ...value, estimatedUnknownCount, dispatchedByMonth: { ...map } };
    }
    function ledgerData(value, uid, month) {
        if (!value) return { uid, month, currency: 'USD', settledNano: '0', pendingNano: '0', revision: 0 };
        if (value.uid !== uid || value.month !== month || value.currency !== 'USD' || !Number.isSafeInteger(value.revision) || value.revision < 0) reject('LEDGER_INTEGRITY', 'Monthly ledger is invalid.', 409);
        integer(value.settledNano); integer(value.pendingNano); return value;
    }
    function blockReason(guard, month = vietnamMonth(now()), allowEstimated = nativeAvailable()) { return guard.boundsViolated ? 'BOUNDS_VIOLATED' : guard.unknownCount > 0 && (!allowEstimated || guard.unknownCount !== guard.estimatedUnknownCount) ? 'USAGE_UNKNOWN' : Object.keys(guard.dispatchedByMonth).some(key => key !== month) ? 'PRIOR_MONTH_DISPATCH' : guard.estimatedUnknownCount >= 8 ? 'NATIVE_UNKNOWN_LIMIT' : null; }
    function checkedDispatchCounters(reservation, guard) {
        if (reservation.estimatedUnknownCounted !== undefined && typeof reservation.estimatedUnknownCounted !== 'boolean'
            || reservation.estimatedUnknownCounted && (!reservation.unknownCounted || reservation.reservationKind !== 'estimated' || guard.estimatedUnknownCount < 1)
            || typeof reservation.unknownCounted !== 'boolean' || reservation.dispatchCounted !== undefined && typeof reservation.dispatchCounted !== 'boolean'
            || reservation.dispatchCounted !== true && reservation.unknownCounted !== true
            || reservation.unknownCounted && guard.unknownCount < 1
            || reservation.dispatchCounted && !(guard.dispatchedByMonth[reservation.month] > 0)) reject('LEDGER_INTEGRITY', 'Reservation dispatch counters are inconsistent.', 409);
    }
    function unknownGuard(reservation, guard) {
        checkedDispatchCounters(reservation, guard);
        const unknownCount = guard.unknownCount + (reservation.unknownCounted ? 0 : 1);
        if (!Number.isSafeInteger(unknownCount)) reject('LEDGER_INTEGRITY', 'Unknown usage counter overflow.', 409);
        return { ...guard, unknownCount, estimatedUnknownCount: guard.estimatedUnknownCount + (!reservation.unknownCounted && reservation.reservationKind === 'estimated' ? 1 : 0) };
    }
    function receipt(reservation) { return { reservationId: reservation.reservationId, uid: reservation.uid, month: reservation.month, feature: reservation.feature, purpose: reservation.purpose, model: reservation.model, state: reservation.state, maximumNano: reservation.maximumNano, settledNano: reservation.settledNano || '0', pricingVersion: reservation.pricing.versionId, boundsVersion: reservation.boundsVersion, engineeringOnly: reservation.engineeringOnly, reservationKind: reservation.reservationKind || 'proven', reservedNano: reservation.maximumNano, estimatedNano: reservation.reservationKind === 'estimated' ? reservation.maximumNano : null, estimateExceeded: reservation.estimateExceeded === true, costBasis: reservation.costBasis || null, createdAt: reservation.createdAt, updatedAt: reservation.updatedAt }; }
    async function authorize(transaction, name, actorUid, purpose, context, operation) {
        text(actorUid, 'UID'); const adapter = feature(name);
        const authority = await adapter.authorize(transaction, { actorUid, purpose, context, operation });
        if (!authority || authority.uid !== actorUid) reject('ACCOUNT_INELIGIBLE', 'Current staff authority is required.', 403);
        return adapter;
    }
    function normalizedContext(adapter, context) { const value = adapter.normalizeContext(context); if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 8192) reject('INVALID_CONTEXT', 'Feature context is invalid or too large.'); return JSON.parse(JSON.stringify(value)); }
    function boundFor(model, version) {
        if (nativeAvailable() && nativePolicy.versionId === version && nativePolicy.models.includes(model)) return nativePolicy;
        const proof = proofs.get(version); if (!proof || !proof.proven || !proof.models.includes(model) || typeof proof.deriveMaximum !== 'function') reject('BOUNDS_UNPROVEN', 'No proven request maximum is registered.', 409);
        // This release has no usable native-provider permit path. Engineering
        // fixtures must use their own non-native model and provider namespace.
        if (!engineeringMode || proof.engineeringOnly !== true || model.startsWith('gemini-')) reject('PAID_DISPATCH_DISABLED', 'Native paid dispatch remains disabled.', 409);
        return proof;
    }
    async function reserve(name, actorUid, input) {
        strict(input, ['requestId', 'purpose', 'context', 'model', 'request', 'boundsVersion']); text(input.requestId, 'request ID'); text(input.purpose, 'purpose'); text(input.model, 'model'); text(input.boundsVersion, 'bounds version');
        const adapter = feature(name); const context = normalizedContext(adapter, input.context);
        if (!input.request || typeof input.request !== 'object' || Array.isArray(input.request) || Buffer.byteLength(JSON.stringify(input.request)) > 65536) reject('INVALID_REQUEST', 'Request must be a bounded object.');
        const requestDigest = digest({ feature: name, purpose: input.purpose, context, model: input.model, boundsVersion: input.boundsVersion, request: input.request });
        const reservationId = digest(['reservation', text(actorUid, 'UID'), input.requestId]);
        return execute(async transaction => {
            await authorize(transaction, name, actorUid, input.purpose, context, 'reserve');
            const existing = snapshotData(await transaction.get(document('reservations', reservationId)));
            if (existing) { if (existing.uid !== actorUid || existing.requestDigest !== requestDigest) reject('RESERVATION_CONFLICT', 'Logical request ID is bound to another request.', 409); return { ...receipt(existing), replayed: true }; }
            if (!adapter.models.includes(input.model)) reject('MODEL_NOT_ALLOWED', 'Feature model is not allowed.', 403);
            const date = instant(now()); const month = vietnamMonth(date); const pricing = selectPricing(prices, input.model, date); const proof = boundFor(input.model, input.boundsVersion);
            const estimated = proof.kind === 'estimated';
            const provider = providers.get(pricing.provider); if (!provider || (estimated ? pricing.provider !== 'gemini' || provider.native !== true : provider.engineeringOnly !== true || pricing.provider === 'gemini')) reject('PAID_DISPATCH_DISABLED', 'No engineering provider is registered.', 409);
            const maximumQuantities = estimated ? proof.deriveEstimatedQuantities(JSON.parse(JSON.stringify(input.request))) : proof.deriveMaximum({ request: JSON.parse(JSON.stringify(input.request)), pricing, purpose: input.purpose }); const maximumNano = calculateCost(pricing, maximumQuantities);
            if (integer(maximumNano) <= 0n) reject('INVALID_MAXIMUM', 'A positive validated maximum is required.');
            const guard = guardData(snapshotData(await transaction.get(accountRef(actorUid))), actorUid);
            const ledger = ledgerData(snapshotData(await transaction.get(ledgerRef(actorUid, month))), actorUid, month);
            const allowance = await resolveAllowance(transaction, actorUid); const allowanceNano = validateAllowanceNano(allowance.allowanceNano);
            if (blockReason(guard, month, estimated && nativeAvailable())) reject(blockReason(guard, month, estimated && nativeAvailable()), 'Unresolved billing blocks further admission.', 409);
            if (integer(ledger.settledNano) + integer(ledger.pendingNano) + integer(maximumNano) > allowanceNano) reject('BUDGET_EXHAUSTED', 'Monthly AI allowance is exhausted.', 409);
            const dispatchBefore = new Date(Math.min(Date.parse(monthEnd(month)), Date.parse(pricing.expiresAt))).toISOString();
            const reservation = { reservationId, uid: actorUid, month, feature: name, purpose: input.purpose, context, model: input.model, requestDigest, pricing, boundsVersion: input.boundsVersion, maximumQuantities, maximumNano, reservationKind: estimated ? 'estimated' : 'proven', engineeringOnly: !estimated, state: 'reserved', unknownCounted: false, dispatchCounted: false, evidence: [], dispatchBefore, createdAt: date.toISOString(), updatedAt: date.toISOString() };
            transaction.create(document('reservations', reservationId), reservation);
            transaction.set(ledgerRef(actorUid, month), { ...ledger, pendingNano: (integer(ledger.pendingNano) + integer(maximumNano)).toString(), revision: ledger.revision + 1, updatedAt: timestamp() });
            transaction.set(accountRef(actorUid), guard); return { ...receipt(reservation), replayed: false };
        });
    }
    async function authorizeDispatch(name, actorUid, reservationId) {
        text(reservationId, 'reservation ID');
        return execute(async transaction => {
            const reservation = snapshotData(await transaction.get(document('reservations', reservationId)));
            if (!reservation || reservation.uid !== actorUid || reservation.feature !== name) reject('RESERVATION_NOT_FOUND', 'Reservation not found.', 404);
            await authorize(transaction, name, actorUid, reservation.purpose, reservation.context, 'dispatch');
            if (reservation.state !== 'reserved') return { ...receipt(reservation), sendPermit: null, replayed: true };
            boundFor(reservation.model, reservation.boundsVersion);
            const guard = guardData(snapshotData(await transaction.get(accountRef(actorUid))), actorUid); if (blockReason(guard, undefined, reservation.reservationKind === 'estimated' && nativeAvailable())) reject(blockReason(guard, undefined, reservation.reservationKind === 'estimated' && nativeAvailable()), 'Billing block prevents dispatch.', 409);
            if (instant(now()).getTime() >= Date.parse(reservation.dispatchBefore)) reject('DISPATCH_WINDOW_EXPIRED', 'Month or price boundary requires a new admission.', 409);
            // Durable intent fences rollover even if this process disappears.
            // Same-month supporting requests remain bounded by pending funds.
            const count = (guard.dispatchedByMonth[reservation.month] || 0) + 1;
            if (!Number.isSafeInteger(count)) reject('LEDGER_INTEGRITY', 'Dispatch counter overflow.', 409);
            const token = crypto.randomUUID(); const next = { ...reservation, state: 'dispatch_intent', dispatchToken: token, unknownCounted: false, dispatchCounted: true, updatedAt: timestamp() };
            transaction.set(document('reservations', reservationId), next);
            transaction.set(accountRef(actorUid), { ...guard, dispatchedByMonth: { ...guard.dispatchedByMonth, [reservation.month]: count } });
            return { ...receipt(next), replayed: false, sendPermit: { reservationId, token, provider: reservation.pricing.provider, model: reservation.model, engineeringOnly: reservation.engineeringOnly, dispatchIdentity: reservationId } };
        });
    }
    async function cancelBeforeDispatch(name, actorUid, reservationId) {
        text(reservationId, 'reservation ID'); return execute(async transaction => {
            const reservation = snapshotData(await transaction.get(document('reservations', reservationId))); if (!reservation || reservation.uid !== actorUid || reservation.feature !== name) reject('RESERVATION_NOT_FOUND', 'Reservation not found.', 404);
            await authorize(transaction, name, actorUid, reservation.purpose, reservation.context, 'cancel');
            if (reservation.state === 'canceled_before_dispatch') return receipt(reservation);
            if (reservation.state !== 'reserved') reject('DISPATCH_AMBIGUOUS', 'Dispatched or ambiguous work cannot be refunded.', 409);
            const ledger = ledgerData(snapshotData(await transaction.get(ledgerRef(actorUid, reservation.month))), actorUid, reservation.month); const guard = guardData(snapshotData(await transaction.get(accountRef(actorUid))), actorUid);
            const pending = integer(ledger.pendingNano) - integer(reservation.maximumNano); if (pending < 0n) reject('LEDGER_INTEGRITY', 'Reservation exceeds pending ledger.', 409);
            const next = { ...reservation, state: 'canceled_before_dispatch', updatedAt: timestamp() };
            transaction.set(document('reservations', reservationId), next); transaction.set(accountRef(actorUid), guard);
            transaction.set(ledgerRef(actorUid, reservation.month), { ...ledger, pendingNano: pending.toString(), revision: ledger.revision + 1, updatedAt: timestamp() }); return receipt(next);
        });
    }
    async function markUnknown(reservationId) {
        text(reservationId, 'reservation ID'); return execute(async transaction => {
            const reservation = snapshotData(await transaction.get(document('reservations', reservationId))); if (!reservation) reject('RESERVATION_NOT_FOUND', 'Reservation not found.', 404);
            if (reservation.state === 'usage_unknown') return receipt(reservation);
            if (reservation.state !== 'dispatch_intent') reject('INVALID_RESERVATION_STATE', 'Only ambiguous dispatched work can be marked unknown.', 409);
            const guard = guardData(snapshotData(await transaction.get(accountRef(reservation.uid))), reservation.uid);
            ledgerData(snapshotData(await transaction.get(ledgerRef(reservation.uid, reservation.month))), reservation.uid, reservation.month);
            const next = { ...reservation, state: 'usage_unknown', estimatedUnknownCounted: reservation.unknownCounted ? reservation.estimatedUnknownCounted === true : reservation.reservationKind === 'estimated', unknownCounted: true, updatedAt: timestamp() };
            transaction.set(document('reservations', reservationId), next); transaction.set(accountRef(reservation.uid), unknownGuard(reservation, guard)); return receipt(next);
        });
    }
    async function settle(reservationId, trustedEvidence) {
        text(reservationId, 'reservation ID');
        try { return await execute(async transaction => {
            const reservation = snapshotData(await transaction.get(document('reservations', reservationId))); if (!reservation) reject('RESERVATION_NOT_FOUND', 'Reservation not found.', 404);
            const provider = providers.get(reservation.pricing.provider); if (!provider || typeof provider.normalizeEvidence !== 'function') reject('PROVIDER_NOT_REGISTERED', 'Trusted accounting provider is unavailable.', 403);
            const expectedCategories = [...new Set([...Object.keys(reservation.pricing.ratesNano), ...Object.keys(reservation.maximumQuantities)])];
            const evidence = validateNormalizedEvidence(await provider.normalizeEvidence({ reservation: deepFreeze(JSON.parse(JSON.stringify(reservation))), evidence: trustedEvidence }), expectedCategories, reservation.reservationKind === 'estimated' ? { dispatchIdentity: reservationId } : null);
            const evidenceDigest = digest(evidence); const previous = reservation.evidence.find(e => e.evidenceId === evidence.evidenceId);
            if (previous) { if (previous.digest !== evidenceDigest) reject('EVIDENCE_CONFLICT', 'Evidence ID has conflicting content.', 409); return { ...receipt(reservation), replayed: true }; }
            if (!['dispatch_intent', 'usage_unknown'].includes(reservation.state)) reject('INVALID_RESERVATION_STATE', 'Reservation cannot accept a new usage report.', 409);
            if (reservation.evidence.length >= MAX_EVIDENCE) reject('EVIDENCE_LIMIT', 'Evidence count is bounded; manual reconciliation is required.', 409);
            if (reservation.providerRequestId && reservation.providerRequestId !== evidence.providerRequestId) reject('EVIDENCE_CONFLICT', 'Provider request identity changed.', 409);
            const guard = guardData(snapshotData(await transaction.get(accountRef(reservation.uid))), reservation.uid);
            const ledger = ledgerData(snapshotData(await transaction.get(ledgerRef(reservation.uid, reservation.month))), reservation.uid, reservation.month);
            checkedDispatchCounters(reservation, guard);
            const next = { ...reservation, providerRequestId: evidence.providerRequestId, evidence: [...reservation.evidence, { ...evidence, digest: evidenceDigest }], updatedAt: timestamp() };
            if (!evidence.complete) {
                next.state = 'usage_unknown'; next.unknownCounted = true; next.estimatedUnknownCounted = reservation.unknownCounted ? reservation.estimatedUnknownCounted === true : reservation.reservationKind === 'estimated';
                transaction.set(document('reservations', reservationId), next); transaction.set(accountRef(reservation.uid), unknownGuard(reservation, guard)); return { ...receipt(next), replayed: false };
            }
            const cost = calculateCost(reservation.pricing, evidence.quantities); const pending = integer(ledger.pendingNano) - integer(reservation.maximumNano);
            if (pending < 0n || reservation.unknownCounted && guard.unknownCount < 1) reject('LEDGER_INTEGRITY', 'Pending usage counters are inconsistent.', 409);
            const estimateExceeded = integer(cost) > integer(reservation.maximumNano) || Object.entries(evidence.quantities).some(([key, count]) => integer(count) > integer(reservation.maximumQuantities[key] || '0'));
            const violated = reservation.reservationKind !== 'estimated' && estimateExceeded;
            next.estimateExceeded = reservation.reservationKind === 'estimated' && estimateExceeded;
            next.costBasis = 'reported_usage_calculation';
            next.state = 'settled'; next.settledNano = cost; next.unknownCounted = false; next.estimatedUnknownCounted = false; next.dispatchCounted = false; next.boundsViolated = violated; next.settledAt = timestamp();
            transaction.set(document('reservations', reservationId), next);
            transaction.set(ledgerRef(reservation.uid, reservation.month), { ...ledger, pendingNano: pending.toString(), settledNano: (integer(ledger.settledNano) + integer(cost)).toString(), revision: ledger.revision + 1, updatedAt: timestamp() });
            const dispatchedByMonth = { ...guard.dispatchedByMonth };
            if (reservation.dispatchCounted) { dispatchedByMonth[reservation.month]--; if (!dispatchedByMonth[reservation.month]) delete dispatchedByMonth[reservation.month]; }
            transaction.set(accountRef(reservation.uid), { ...guard, dispatchedByMonth, unknownCount: guard.unknownCount - (reservation.unknownCounted ? 1 : 0), estimatedUnknownCount: guard.estimatedUnknownCount - (reservation.estimatedUnknownCounted ? 1 : 0), boundsViolated: guard.boundsViolated || violated }); return { ...receipt(next), boundsViolated: violated, replayed: false };
        }); } catch (error) {
            // A malformed trusted report cannot turn an ambiguous dispatch into
            // free allowance. Preserve the original error and durable obligation.
            if (!['EVIDENCE_CONFLICT', 'INVALID_RESERVATION_STATE', 'RESERVATION_NOT_FOUND'].includes(error.code)) { try { await markUnknown(reservationId); } catch (_) { /* Preserve the original evidence failure. */ } }
            throw error;
        }
    }
    async function getBudget(name, actorUid) { return execute(async transaction => {
        await authorize(transaction, name, actorUid, null, null, 'read'); const month = vietnamMonth(now());
        const guard = guardData(snapshotData(await transaction.get(accountRef(actorUid))), actorUid); const ledger = ledgerData(snapshotData(await transaction.get(ledgerRef(actorUid, month))), actorUid, month);
        const allowance = await resolveAllowance(transaction, actorUid); const availableNano = (validateAllowanceNano(allowance.allowanceNano) - integer(ledger.settledNano) - integer(ledger.pendingNano)).toString();
        return { uid: actorUid, month, currency: 'USD', allowanceNano: allowance.allowanceNano, settledNano: ledger.settledNano, pendingNano: ledger.pendingNano, availableNano, blocked: !!blockReason(guard, month), blockReason: blockReason(guard, month), paidDispatchAvailable: nativeAvailable(), policyMode: nativeAvailable() ? 'monitored_target' : 'engineering', possibleOverage: nativeAvailable(), costBasis: 'reported_usage_calculation', targetExceeded: integer(ledger.settledNano) > validateAllowanceNano(allowance.allowanceNano), unknownCount: guard.unknownCount, estimatedUnknownCount: guard.estimatedUnknownCount };
    }); }
    async function listReservations(name, actorUid, options = {}) {
        strict(options, ['cursor', 'pageSize']); const pageSize = options.pageSize === undefined ? 25 : Number(options.pageSize); if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) reject('INVALID_PAGE_SIZE', 'Page size must be 1 through 50.');
        const scope = digest([actorUid, name]); let after = null;
        if (options.cursor) { try { const parsed = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()); if (parsed.scope !== scope) throw new Error(); after = text(parsed.id); } catch (_) { reject('INVALID_CURSOR', 'Cursor is invalid for the current account.'); } }
        return execute(async transaction => { await authorize(transaction, name, actorUid, null, null, 'read'); let query = db.collection(AI_ASSISTANCE_COLLECTIONS.reservations).where('uid', '==', actorUid).orderBy('__name__'); if (after) query = query.startAfter(after); const snapshot = await transaction.get(query.limit(pageSize + 1)); const rows = snapshot.docs.slice(0, pageSize); const hasMore = snapshot.docs.length > pageSize; return { items: rows.map(row => receipt(row.data())), hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ scope, id: rows[rows.length - 1].id })).toString('base64url') : null }; });
    }
    function forFeature(name) { feature(name); return Object.freeze({ reserve: (uid, input) => reserve(name, uid, input), authorizeDispatch: (uid, id) => authorizeDispatch(name, uid, id), cancelBeforeDispatch: (uid, id) => cancelBeforeDispatch(name, uid, id), getBudget: uid => getBudget(name, uid), listReservations: (uid, options) => listReservations(name, uid, options) }); }
    return Object.freeze({ forFeature, settle, markUnknown });
}
module.exports = { createLedgerService, MAX_EVIDENCE };
