'use strict';

const { CRM_COUNTERS } = require('./collections');

const ID_GROUP_SIZE = 9999;
const DEFAULT_COUNTER_DOC = 'crmId';
const CRM_ID_PATTERN = /^[a-z]+[0-9]{4}$/i;

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeCrmId(value) {
    const normalized = cleanOptionalString(value);
    return normalized ? normalized.toLowerCase() : null;
}

function isValidCrmId(value) {
    const normalized = normalizeCrmId(value);
    return !!normalized && CRM_ID_PATTERN.test(normalized);
}

function indexToPrefix(index) {
    let n = Math.max(0, Math.floor(Number(index) || 0)) + 1;
    let out = '';
    while (n > 0) {
        n -= 1;
        out = String.fromCharCode(97 + (n % 26)) + out;
        n = Math.floor(n / 26);
    }
    return out || 'a';
}

function formatCrmId(index) {
    const normalized = Math.max(0, Math.floor(Number(index) || 0));
    const group = Math.floor(normalized / ID_GROUP_SIZE);
    const sequence = (normalized % ID_GROUP_SIZE) + 1;
    return `${indexToPrefix(group)}${String(sequence).padStart(4, '0')}`;
}

function normalizeNextIndex(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
}

async function allocateNextCrmId(db, options = {}) {
    if (!db || typeof db.collection !== 'function') {
        throw new Error('Firestore database is unavailable.');
    }

    const collectionName = cleanOptionalString(options.collectionName) || CRM_COUNTERS;
    const docId = cleanOptionalString(options.docId) || DEFAULT_COUNTER_DOC;
    const ref = db.collection(collectionName).doc(docId);
    const serverTimestamp = typeof options.serverTimestamp === 'function' ? options.serverTimestamp : null;

    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() || {}) : {};
        const nextIndex = normalizeNextIndex(data.nextIndex);
        const crmId = formatCrmId(nextIndex);

        tx.set(ref, {
            nextIndex: nextIndex + 1,
            lastAllocatedCrmId: crmId,
            updatedAt: serverTimestamp ? serverTimestamp() : new Date()
        }, { merge: true });

        return {
            crmId,
            nextIndex
        };
    });
}

async function ensureCrmIdOnDoc(db, ref, existingData = {}, options = {}) {
    const data = existingData && typeof existingData === 'object' ? existingData : {};
    const rawCurrent = cleanOptionalString(data.crmId);
    const current = normalizeCrmId(rawCurrent);
    if (current && isValidCrmId(current)) {
        if (rawCurrent !== current) {
            await ref.set({
                crmId: current,
                updatedAt: typeof options.serverTimestamp === 'function' ? options.serverTimestamp() : new Date(),
                updatedBy: options.user?.uid || null
            }, { merge: true });
        }
        return { crmId: current, allocated: false };
    }

    const allocation = await allocateNextCrmId(db, options);
    await ref.set({
        crmId: allocation.crmId,
        updatedAt: typeof options.serverTimestamp === 'function' ? options.serverTimestamp() : new Date(),
        updatedBy: options.user?.uid || null
    }, { merge: true });

    return {
        crmId: allocation.crmId,
        allocated: true
    };
}

module.exports = {
    ID_GROUP_SIZE,
    DEFAULT_COUNTER_DOC,
    CRM_ID_PATTERN,
    formatCrmId,
    allocateNextCrmId,
    ensureCrmIdOnDoc,
    normalizeCrmId,
    isValidCrmId
};
