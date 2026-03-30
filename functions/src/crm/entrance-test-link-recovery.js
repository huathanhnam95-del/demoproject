'use strict';

const crypto = require('crypto');
const { buildEntranceTestLinks } = require('./public-origin');
const { ENTRANCE_TEST_LINK_RECOVERY } = require('./collections');

function toText(value) {
    return String(value || '').trim();
}

function extractDeliveryToken(value) {
    const raw = toText(value);
    if (!raw) return '';

    try {
        const parsed = new URL(raw);
        return toText(parsed.searchParams.get('token'));
    } catch {
        return raw;
    }
}

function isActiveStatus(status) {
    const normalized = toText(status).toLowerCase();
    return normalized === 'created' || normalized === 'started';
}

function getBackfillCandidateStatus(testData) {
    const status = toText(testData?.status).toLowerCase();
    if (!isActiveStatus(status)) return 'skipped_not_active';
    if (toText(testData?.deliveryToken)) return 'skipped_already_has_token';
    return 'ready';
}

function collectMissingRecoveryIds(tests) {
    const ids = [];
    const seen = new Set();

    for (const test of Array.isArray(tests) ? tests : []) {
        if (!isActiveStatus(test?.status)) continue;
        if (toText(test?.deliveryToken)) continue;

        const testId = toText(test?.testId);
        if (!testId || seen.has(testId)) continue;
        seen.add(testId);
        ids.push(testId);
    }

    return ids;
}

async function loadEntranceTestRecoveryTokens(db, tests, { collectionName = ENTRANCE_TEST_LINK_RECOVERY } = {}) {
    const ids = collectMissingRecoveryIds(tests);
    const tokenMap = new Map();

    if (!db || typeof db.collection !== 'function' || ids.length === 0) {
        return tokenMap;
    }

    const docs = await Promise.all(ids.map(async (testId) => {
        try {
            const snap = await db.collection(collectionName).doc(testId).get();
            return { testId, snap };
        } catch {
            return { testId, snap: null };
        }
    }));

    for (const entry of docs) {
        if (!entry?.snap?.exists) continue;
        const deliveryToken = toText(entry.snap.data()?.deliveryToken);
        if (!deliveryToken) continue;
        tokenMap.set(entry.testId, deliveryToken);
    }

    return tokenMap;
}

async function buildEntranceTestAdminList(req, db, tests, env = process.env) {
    const items = Array.isArray(tests) ? tests : [];
    const recoveryTokens = await loadEntranceTestRecoveryTokens(db, items);

    return items.map((test) => {
        const testId = toText(test?.testId);
        const status = toText(test?.status);
        const deliveryToken = isActiveStatus(status)
            ? (toText(test?.deliveryToken) || toText(recoveryTokens.get(testId)))
            : '';
        const links = buildEntranceTestLinks(req, {
            deliveryToken,
            testId
        }, env);
        const rest = { ...(test || {}) };
        delete rest.deliveryToken;

        return {
            ...rest,
            testId,
            status,
            testLink: links.testLink,
            resultLink: links.resultLink
        };
    });
}

async function evaluateEntranceTestRecoveryBackfillCandidate(db, input, {
    entranceTestsCollection = 'entranceTests',
    recoveryCollection = ENTRANCE_TEST_LINK_RECOVERY,
    actor = null,
    serverTimestamp = null
} = {}) {
    const deliveryToken = extractDeliveryToken(input);
    if (!deliveryToken) {
        return {
            input,
            status: 'skipped_invalid_input',
            reason: 'Could not extract token.'
        };
    }

    const testId = crypto
        .createHash('sha256')
        .update(String(deliveryToken || ''))
        .digest('hex');

    if (!db || typeof db.collection !== 'function') {
        return {
            input,
            testId,
            deliveryTokenPreview: `${deliveryToken.slice(0, 6)}...`,
            status: 'skipped_db_unavailable',
            reason: 'Firestore is unavailable.'
        };
    }

    const snap = await db.collection(entranceTestsCollection).doc(testId).get();
    if (!snap.exists) {
        return {
            input,
            testId,
            deliveryTokenPreview: `${deliveryToken.slice(0, 6)}...`,
            status: 'skipped_missing_test',
            reason: 'Entrance test not found.'
        };
    }

    const testData = snap.data() || {};
    const status = getBackfillCandidateStatus(testData);
    if (status !== 'ready') {
        return {
            input,
            testId,
            deliveryTokenPreview: `${deliveryToken.slice(0, 6)}...`,
            status,
            reason: status === 'skipped_not_active'
                ? 'Entrance test is not active.'
                : 'Primary delivery token already exists.'
        };
    }

    return {
        input,
        testId,
        deliveryTokenPreview: `${deliveryToken.slice(0, 6)}...`,
        status: 'ready',
        record: buildRecoveryRecord(deliveryToken, {
            source: 'manual_backfill_script',
            actor,
            serverTimestamp
        }),
        recoveryCollection
    };
}

async function buildEntranceTestRecoveryBackfillPlan(db, inputs, options = {}) {
    const values = Array.isArray(inputs) ? inputs : [];
    const plan = [];

    for (const input of values) {
        plan.push(await evaluateEntranceTestRecoveryBackfillCandidate(db, input, options));
    }

    return plan;
}

function buildRecoveryRecord(deliveryToken, {
    source = 'manual',
    actor = null,
    serverTimestamp = null
} = {}) {
    const token = extractDeliveryToken(deliveryToken);
    if (!token) {
        throw new Error('Missing delivery token.');
    }

    return {
        deliveryToken: token,
        source: toText(source) || 'manual',
        updatedAt: serverTimestamp || null,
        updatedBy: toText(actor) || null
    };
}

module.exports = {
    ENTRANCE_TEST_LINK_RECOVERY,
    extractDeliveryToken,
    isActiveStatus,
    getBackfillCandidateStatus,
    loadEntranceTestRecoveryTokens,
    buildEntranceTestAdminList,
    buildRecoveryRecord,
    evaluateEntranceTestRecoveryBackfillCandidate,
    buildEntranceTestRecoveryBackfillPlan
};
