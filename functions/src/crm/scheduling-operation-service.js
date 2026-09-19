'use strict';

const { createHash, randomUUID } = require('crypto');
const {
    CRM_SCHEDULED_SESSIONS,
    CRM_SCHEDULING_OPERATION_RECEIPTS,
    CRM_TEACHER_SCHEDULE_LOCKS
} = require('./collections');
const { normalizeScheduledSession } = require('./scheduling-service');

class SchedulingOperationError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'SchedulingOperationError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function cleanOptionalString(value, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeSchedulingOperationId(value, prefix = 'server') {
    const supplied = cleanOptionalString(value);
    const safePrefix = String(prefix || 'server').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
    const operationId = supplied || `sched_${safePrefix}_${Date.now().toString(36)}_${randomUUID()}`;
    if (operationId.length < 8 || operationId.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(operationId)) {
        throw new SchedulingOperationError(
            400,
            'INVALID_OPERATION_ID',
            'operationId must be 8-180 characters using letters, numbers, dot, underscore, colon, or hyphen.'
        );
    }
    return operationId;
}

function canonicalize(value, seen = new Set()) {
    if (value === null) return 'null';
    if (value === undefined) return undefined;
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Scheduling operation payload numbers must be finite.');
        }
        return JSON.stringify(value);
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
        throw new TypeError(`Unsupported scheduling operation payload value: ${typeof value}.`);
    }
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (seen.has(value)) throw new TypeError('Scheduling operation payload must not contain cycles.');

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.map((entry) => canonicalize(entry, seen) ?? 'null').join(',')}]`;
        }
        const entries = Object.keys(value)
            .sort()
            .map((key) => [key, canonicalize(value[key], seen)])
            .filter(([, serialized]) => serialized !== undefined);
        return `{${entries.map(([key, serialized]) => `${JSON.stringify(key)}:${serialized}`).join(',')}}`;
    } finally {
        seen.delete(value);
    }
}

function sha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function fingerprintSchedulingPayload(operationType, payload) {
    const normalizedType = cleanOptionalString(operationType);
    if (!normalizedType) throw new TypeError('operationType is required.');
    return sha256(`${normalizedType}\n${canonicalize(payload ?? null)}`);
}

function schedulingReceiptId(operationId) {
    return sha256(normalizeSchedulingOperationId(operationId));
}

function teacherLockId(teacherUid) {
    const uid = cleanOptionalString(teacherUid);
    if (!uid || uid === 'all') throw new TypeError('A concrete teacherUid is required.');
    return sha256(uid);
}

function normalizeTeacherUids(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map((value) => cleanOptionalString(value))
        .filter((value) => value && value !== 'all'))).sort();
}

function normalizeCommittedIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map((value) => cleanOptionalString(value))
        .filter(Boolean)));
}

function sanitizeReceiptValue(value, transformTimestamp) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;
    const constructorName = String(value.constructor?.name || '');
    if (constructorName === 'ServerTimestampTransform' || value._methodName === 'FieldValue.serverTimestamp') {
        return transformTimestamp;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeReceiptValue(entry, transformTimestamp) ?? null);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value)
        .map(([key, entry]) => [key, sanitizeReceiptValue(entry, transformTimestamp)])
        .filter(([, entry]) => entry !== undefined));
}

function readReceiptReplay(receipt, { actorUid, operationType, payloadFingerprint, operationId }) {
    if (cleanOptionalString(receipt.actorUid) !== actorUid) {
        throw new SchedulingOperationError(
            403,
            'OPERATION_ID_ACTOR_MISMATCH',
            'This operationId belongs to a different authenticated actor.'
        );
    }
    if (cleanOptionalString(receipt.operationType) !== operationType || receipt.payloadFingerprint !== payloadFingerprint) {
        throw new SchedulingOperationError(
            409,
            'OPERATION_ID_PAYLOAD_MISMATCH',
            'This operationId was already used with a different scheduling payload.'
        );
    }
    if (receipt.status !== 'committed' || !receipt.authoritativeResult || typeof receipt.authoritativeResult !== 'object') {
        throw new SchedulingOperationError(
            409,
            'OPERATION_NOT_COMMITTED',
            'The scheduling operation receipt is not in a committed state.'
        );
    }
    return {
        operationId,
        idempotentReplay: true,
        ...receipt.authoritativeResult
    };
}

async function executeSchedulingOperation(options = {}) {
    const {
        db,
        prepare,
        commit
    } = options;
    if (!db || typeof db.runTransaction !== 'function') {
        throw new TypeError('A Firestore db with runTransaction is required.');
    }
    if (typeof prepare !== 'function' || typeof commit !== 'function') {
        throw new TypeError('prepare and commit callbacks are required.');
    }

    const operationId = normalizeSchedulingOperationId(options.operationId, options.operationType);
    const actorUid = cleanOptionalString(options.actorUid);
    const operationType = cleanOptionalString(options.operationType);
    if (!actorUid) {
        throw new SchedulingOperationError(401, 'UNAUTHORIZED', 'Authenticated actor UID is required.');
    }
    if (!operationType) throw new TypeError('operationType is required.');

    const payloadFingerprint = fingerprintSchedulingPayload(operationType, options.payload ?? null);
    const receiptRef = db.collection(CRM_SCHEDULING_OPERATION_RECEIPTS).doc(schedulingReceiptId(operationId));
    const serverTimestamp = typeof options.serverTimestamp === 'function'
        ? options.serverTimestamp
        : () => new Date();

    const transactionOutcome = await db.runTransaction(async (tx) => {
        const receiptSnap = await tx.get(receiptRef);
        if (receiptSnap.exists) {
            return readReceiptReplay(receiptSnap.data() || {}, {
                actorUid,
                operationType,
                payloadFingerprint,
                operationId
            });
        }

        const prepared = await prepare({ tx, db, actorUid, operationId });
        const teacherUids = normalizeTeacherUids(prepared?.teacherUids);
        const lockRefs = teacherUids.map((teacherUid) =>
            db.collection(CRM_TEACHER_SCHEDULE_LOCKS).doc(teacherLockId(teacherUid))
        );
        const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));

        const teacherSessionsByUid = new Map();
        for (const teacherUid of teacherUids) {
            const sessionSnap = await tx.get(
                db.collection(CRM_SCHEDULED_SESSIONS).where('teacherUid', '==', teacherUid)
            );
            teacherSessionsByUid.set(teacherUid, sessionSnap.docs
                .map((doc) => normalizeScheduledSession({ sessionId: doc.id, ...doc.data() }))
                .filter((session) => String(session.status || 'scheduled') === 'scheduled'));
        }

        const committed = await commit({
            tx,
            db,
            actorUid,
            operationId,
            state: prepared?.state,
            teacherUids,
            teacherSessionsByUid
        });
        const authoritativeResult = sanitizeReceiptValue(committed?.result, new Date());
        if (!authoritativeResult || typeof authoritativeResult !== 'object' || Array.isArray(authoritativeResult)) {
            throw new TypeError('Scheduling operation commit must return an authoritative result object.');
        }
        const committedIds = normalizeCommittedIds(committed?.committedIds);
        const timestamp = serverTimestamp();

        lockRefs.forEach((ref, index) => {
            const before = lockSnaps[index].exists ? (lockSnaps[index].data() || {}) : {};
            tx.set(ref, {
                teacherUid: teacherUids[index],
                revision: Math.max(Number(before.revision || 0) + 1, 1),
                lastOperationId: operationId,
                updatedAt: timestamp
            }, { merge: true });
        });
        tx.set(receiptRef, {
            operationId,
            operationType,
            actorUid,
            payloadFingerprint,
            status: 'committed',
            teacherUids,
            committedIds,
            authoritativeResult,
            createdAt: timestamp,
            committedAt: timestamp,
            updatedAt: timestamp
        });

        return {
            operationId,
            idempotentReplay: false,
            ...authoritativeResult
        };
    });

    if (transactionOutcome.idempotentReplay) return transactionOutcome;

    const committedReceiptSnap = await receiptRef.get();
    if (!committedReceiptSnap.exists) {
        throw new SchedulingOperationError(
            503,
            'OPERATION_RECEIPT_UNAVAILABLE',
            'The scheduling operation committed, but its authoritative receipt could not be read. Retry with the same operationId.'
        );
    }
    const authoritativeOutcome = readReceiptReplay(committedReceiptSnap.data() || {}, {
        actorUid,
        operationType,
        payloadFingerprint,
        operationId
    });
    return {
        ...authoritativeOutcome,
        idempotentReplay: false
    };
}

module.exports = {
    SchedulingOperationError,
    executeSchedulingOperation,
    fingerprintSchedulingPayload,
    normalizeSchedulingOperationId,
    schedulingReceiptId,
    teacherLockId
};
