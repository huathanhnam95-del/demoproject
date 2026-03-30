#!/usr/bin/env node
'use strict';

const admin = require('firebase-admin');
const { resolveServiceAccountPath } = require('../../src/utils/service-account-path');
const {
    ENTRANCE_TEST_LINK_RECOVERY,
    buildEntranceTestRecoveryBackfillPlan
} = require('../../functions/src/crm/entrance-test-link-recovery');

function printUsage() {
    console.log('Usage: node scripts/crm/backfill-entrance-test-link-recovery.js [--apply] <token-or-url> [more tokens-or-urls]');
}

function parseArgs(argv) {
    const args = Array.from(argv || []);
    const apply = args.includes('--apply');
    const values = args.filter((arg) => arg !== '--apply').map((arg) => String(arg || '').trim()).filter(Boolean);
    return { apply, values };
}

function previewToken(token) {
    const raw = String(token || '').trim();
    return raw ? `${raw.slice(0, 6)}...` : '';
}

async function initializeFirestore() {
    const serviceAccountPath = resolveServiceAccountPath(process.cwd());
    if (!serviceAccountPath) {
        throw new Error('serviceAccountKey.json not found.');
    }

    if (!admin.apps.length) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    return admin.firestore();
}

async function runBackfill(inputs, { apply = false, db = null } = {}) {
    const firestore = db || await initializeFirestore();
    const plan = await buildEntranceTestRecoveryBackfillPlan(firestore, inputs, {
        actor: process.env.USER || process.env.USERNAME || 'manual_backfill_script',
        serverTimestamp: typeof admin.firestore?.FieldValue?.serverTimestamp === 'function'
            ? admin.firestore.FieldValue.serverTimestamp()
            : null
    });

    if (!apply) {
        return {
            apply: false,
            collection: ENTRANCE_TEST_LINK_RECOVERY,
            rows: plan.map((row) => ({
                input: row.input,
                testId: row.testId || null,
                deliveryTokenPreview: row.deliveryTokenPreview || previewToken(row.input),
                status: row.status,
                reason: row.reason || null
            }))
        };
    }

    const readyRows = plan.filter((row) => row.status === 'ready' && row.record);
    if (readyRows.length > 0) {
        const batch = firestore.batch();
        for (const row of readyRows) {
            batch.set(
                firestore.collection(ENTRANCE_TEST_LINK_RECOVERY).doc(row.testId),
                row.record,
                { merge: true }
            );
        }
        await batch.commit();
    }

    return {
        apply: true,
        collection: ENTRANCE_TEST_LINK_RECOVERY,
        count: readyRows.length,
        rows: plan.map((row) => ({
            input: row.input,
            testId: row.testId || null,
            status: row.status,
            reason: row.reason || null
        }))
    };
}

async function main(argv = process.argv.slice(2)) {
    const { apply, values } = parseArgs(argv);
    if (values.length === 0) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const result = await runBackfill(values, { apply });
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    previewToken,
    runBackfill,
    main
};
