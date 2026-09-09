'use strict';
const { AI_ASSISTANCE_COLLECTIONS } = require('../collections');
const { integer, digest, reject } = require('./money-pricing');
const { CALIBRATION_VERSION, METERING_VERSION, COUNTERS, zeroCounters, validateCounters, validateUsageEvidence, calculateUsageMicrocredits, deriveUsageReservation, estimateVoice } = require('./usage-credit-policy');
const { prepareQuotaMonth, reconcileLegacyMonth } = require('./usage-quota-migration');

function summary(value) {
    return { state: value.state, stage: value.stage, bounds: value.bounds, calibrationVersion: value.calibrationVersion, meteringVersion: value.meteringVersion,
        reservedMicrocredits: ['reserved', 'dispatched'].includes(value.state) ? value.maximumMicrocredits : '0', chargedMicrocredits: value.chargedMicrocredits || '0',
        usageBasis: 'server_activity_and_policy_processing_estimate' };
}
function createUsageQuotaService({ db }) {
    const ref = id => db.collection(AI_ASSISTANCE_COLLECTIONS.usageReservations).doc(id);
    async function load(transaction, reservation) {
        const snapshot = await transaction.get(ref(reservation.reservationId));
        if (!snapshot.exists) reject('LEDGER_INTEGRITY', 'Usage reservation is missing.', 409);
        const value = snapshot.data();
        if (value.uid !== reservation.uid || value.month !== reservation.month || value.requestDigest !== reservation.requestDigest || value.source !== 'local_usage'
            || value.reservationId !== reservation.reservationId || value.calibrationVersion !== CALIBRATION_VERSION) reject('LEDGER_INTEGRITY', 'Usage reservation identity is inconsistent.', 409);
        try {
            validateCounters(value.bounds); validateCounters(value.counters);
            if (!['reserved', 'dispatched', 'finalized', 'canceled'].includes(value.state) || value.meteringVersion !== METERING_VERSION
                || !Number.isSafeInteger(value.eventCount) || value.eventCount < 0 || value.eventCount > 10000
                || COUNTERS.some(key => value.counters[key] > value.bounds[key])
                || value.maximumMicrocredits !== calculateUsageMicrocredits(value.stage, value.bounds)
                || value.chargedMicrocredits !== (value.state === 'finalized' ? calculateUsageMicrocredits(value.stage, value.counters) : '0')
                || digest(summary(value)) !== digest(reservation.quota)) reject('LEDGER_INTEGRITY', 'Usage state and financial link disagree.', 409);
            integer(value.maximumMicrocredits); integer(value.chargedMicrocredits);
        } catch (_) { reject('LEDGER_INTEGRITY', 'Usage reservation counters, limits or link are invalid.', 409); }
        return value;
    }
    const prepareMonth = (transaction, reservation, money) => prepareQuotaMonth(transaction, db, reservation.uid, reservation.month, money);
    async function reserve(transaction, reservation, money, allowance) {
        const prepared = await prepareMonth(transaction, reservation, money);
        const old = await transaction.get(ref(reservation.reservationId)); if (old.exists) reject('LEDGER_INTEGRITY', 'Orphan usage reservation.', 409);
        const policy = deriveUsageReservation({ model: reservation.model, request: reservation.usageRequest, at: reservation.createdAt });
        const total = integer(prepared.value.usedMicrocredits) + integer(prepared.value.reservedMicrocredits) + integer(policy.maximumMicrocredits);
        if (total > integer(allowance)) reject('BUDGET_EXHAUSTED', 'Monthly usage credits are fully used or reserved.', 409);
        const value = { reservationId: reservation.reservationId, uid: reservation.uid, month: reservation.month, requestDigest: reservation.requestDigest,
            source: 'local_usage', state: 'reserved', ...policy, counters: zeroCounters(), chargedMicrocredits: '0', eventCount: 0 };
        transaction.create(ref(reservation.reservationId), value);
        transaction.set(prepared.ref, { ...prepared.value, reservedMicrocredits: (integer(prepared.value.reservedMicrocredits) + integer(policy.maximumMicrocredits)).toString(), revision: prepared.value.revision + 1 });
        return summary(value);
    }
    async function dispatch(transaction, reservation, money, allowance) {
        const value = await load(transaction, reservation), prepared = await prepareMonth(transaction, reservation, money);
        if (value.state !== 'reserved') reject('LEDGER_INTEGRITY', 'Quota dispatch state disagrees with financial permit.', 409);
        if (integer(prepared.value.usedMicrocredits) + integer(prepared.value.reservedMicrocredits) > integer(allowance)) reject('BUDGET_EXHAUSTED', 'Allowance changed before dispatch.', 409);
        const next = { ...value, state: 'dispatched' }; transaction.set(ref(reservation.reservationId), next); return summary(next);
    }
    async function cancel(transaction, reservation, money) {
        const value = await load(transaction, reservation), prepared = await prepareMonth(transaction, reservation, money);
        if (value.state !== 'reserved') reject('DISPATCH_AMBIGUOUS', 'Dispatched quota cannot be canceled.', 409);
        const pending = integer(prepared.value.reservedMicrocredits) - integer(value.maximumMicrocredits);
        if (pending < 0n) reject('LEDGER_INTEGRITY', 'Usage reservation exceeds pending quota.', 409);
        const next = { ...value, state: 'canceled' }; transaction.set(ref(reservation.reservationId), next);
        transaction.set(prepared.ref, { ...prepared.value, reservedMicrocredits: pending.toString(), revision: prepared.value.revision + 1 }); return summary(next);
    }
    async function reconcileLegacy(transaction, reservation, money, charge) {
        const prepared = await prepareMonth(transaction, reservation, money), link = await transaction.get(ref(reservation.reservationId));
        if (link.exists) reject('LEDGER_INTEGRITY', 'Legacy reservation already has a quota reconciliation.', 409);
        transaction.create(ref(reservation.reservationId), { reservationId: reservation.reservationId, uid: reservation.uid, month: reservation.month, source: 'legacy_import', state: 'reconciled', chargedMicrocredits: charge, importedPendingMicrocredits: reservation.maximumNano });
        transaction.set(prepared.ref, reconcileLegacyMonth(prepared, reservation, charge));
    }
    async function record(transaction, reservation, money, raw) {
        const evidence = validateUsageEvidence(raw), value = await load(transaction, reservation);
        const eventRef = db.collection(AI_ASSISTANCE_COLLECTIONS.usageEvents).doc(digest([reservation.reservationId, evidence.eventId]));
        const old = await transaction.get(eventRef), payloadDigest = digest(evidence);
        const prepared = await prepareMonth(transaction, reservation, money);
        if (old.exists) {
            if (old.data().payloadDigest !== payloadDigest) reject('USAGE_EVENT_CONFLICT', 'Usage event ID is bound to another payload.', 409);
            return { quota: summary(value), replayed: true };
        }
        if (value.state !== 'dispatched' || evidence.stage !== value.stage || evidence.meteringVersion !== value.meteringVersion) reject('INVALID_USAGE_STATE', 'Metering must match its dispatched stage.', 409);
        for (const key of COUNTERS) {
            if (evidence.counters[key] < value.counters[key]) reject('USAGE_COUNTER_REGRESSION', 'Cumulative usage counters cannot decrease.', 409);
            if (evidence.counters[key] > value.bounds[key]) reject('USAGE_QUOTA_BOUND_EXCEEDED', 'Usage exceeds the admitted resource bound.', 409);
        }
        const charge = calculateUsageMicrocredits(value.stage, evidence.counters);
        if (integer(charge) > integer(value.maximumMicrocredits)) reject('USAGE_QUOTA_BOUND_EXCEEDED', 'Usage charge exceeds admitted quota.', 409);
        if (!Number.isSafeInteger(value.eventCount) || value.eventCount >= 10000) reject('USAGE_EVENT_LIMIT', 'Usage event limit exceeded.', 409);
        const next = { ...value, counters: evidence.counters, eventCount: value.eventCount + 1, ...(evidence.final ? { state: 'finalized', chargedMicrocredits: charge } : {}) };
        let nextMonth;
        if (evidence.final) {
            const pending = integer(prepared.value.reservedMicrocredits) - integer(value.maximumMicrocredits);
            if (pending < 0n) reject('LEDGER_INTEGRITY', 'Usage reservation exceeds pending quota.', 409);
            nextMonth = { ...prepared.value, reservedMicrocredits: pending.toString(), usedMicrocredits: (integer(prepared.value.usedMicrocredits) + integer(charge)).toString(), revision: prepared.value.revision + 1 };
        }
        transaction.create(eventRef, { reservationId: reservation.reservationId, payloadDigest, ...evidence }); transaction.set(ref(reservation.reservationId), next);
        if (nextMonth) transaction.set(prepared.ref, nextMonth);
        return { quota: summary(next), replayed: false };
    }
    async function budget(transaction, { uid, month, money, allowance, providerAccounting, blockedReason }) {
        const prepared = await prepareQuotaMonth(transaction, db, uid, month, money);
        const available = integer(allowance) - integer(prepared.value.usedMicrocredits) - integer(prepared.value.reservedMicrocredits);
        const remaining = (available < 0n ? 0n : available).toString(), overdrawn = (available < 0n ? -available : 0n).toString();
        if (prepared.imported) transaction.set(prepared.ref, prepared.value);
        return { schemaVersion: 2, quotaMode: 'usage_credits', uid, month, timezone: 'Asia/Ho_Chi_Minh', allowanceMicrocredits: allowance,
            usedMicrocredits: prepared.value.usedMicrocredits, reservedMicrocredits: prepared.value.reservedMicrocredits, legacyCarryMicrocredits: '0', remainingMicrocredits: remaining, overdrawnMicrocredits: overdrawn,
            blocked: !!blockedReason || available <= 0n, blockReason: blockedReason || (available <= 0n ? 'BUDGET_EXHAUSTED' : null), paidDispatchAvailable: providerAccounting.paidDispatchAvailable,
            calibrationVersion: CALIBRATION_VERSION, voiceEstimate: estimateVoice(remaining), equivalence: { currency: 'USD', monthlyTargetNano: allowance, invoiceCap: false }, providerAccounting };
    }
    return Object.freeze({ reserve, dispatch, cancel, reconcileLegacy, record, budget });
}
module.exports = { createUsageQuotaService };
