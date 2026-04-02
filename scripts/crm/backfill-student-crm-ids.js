#!/usr/bin/env node
'use strict';

const admin = require('firebase-admin');
const { resolveServiceAccountPath } = require('../../src/utils/service-account-path');
const { CRM_STUDENTS } = require('../../functions/src/crm/collections');
const {
    ensureCrmIdOnDoc,
    isValidCrmId,
    normalizeCrmId
} = require('../../functions/src/crm/business-id-service');

function parseArgs(argv) {
    const args = Array.from(argv || []);
    return {
        apply: args.includes('--apply')
    };
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

function toStudentDoc(db, doc) {
    const data = typeof doc.data === 'function'
        ? (doc.data() || {})
        : (doc.data || {});
    return {
        id: doc.id,
        data,
        ref: doc.ref || db.collection(CRM_STUDENTS).doc(doc.id)
    };
}

function buildPreviewRows(studentDocs) {
    const seenCrmIds = new Map();
    const duplicateCrmIds = new Map();
    const rows = [];

    for (const doc of studentDocs) {
        const rawCrmId = String(doc.data?.crmId || '').trim();
        const crmId = normalizeCrmId(rawCrmId);
        const valid = isValidCrmId(crmId);
        const isCanonical = valid && rawCrmId === crmId;
        if (valid) {
            if (seenCrmIds.has(crmId)) {
                const existing = duplicateCrmIds.get(crmId) || new Set([seenCrmIds.get(crmId)]);
                existing.add(doc.id);
                duplicateCrmIds.set(crmId, existing);
            } else {
                seenCrmIds.set(crmId, doc.id);
            }
        }

        rows.push({
            studentId: doc.id,
            crmId: valid ? crmId : null,
            status: isCanonical ? 'ok' : 'needs_backfill'
        });
    }

    return {
        rows,
        duplicateCrmIds: Array.from(duplicateCrmIds.entries()).map(([crmId, studentIds]) => ({
            crmId,
            studentIds: Array.from(studentIds)
        }))
    };
}

async function runBackfill({ db = null, apply = false, actor = null } = {}) {
    const firestore = db || await initializeFirestore();
    const snap = await firestore.collection(CRM_STUDENTS).get();
    const studentDocs = snap.docs.map((doc) => toStudentDoc(firestore, doc));
    const preview = buildPreviewRows(studentDocs);
    const needsBackfillRows = preview.rows.filter((row) => row.status === 'needs_backfill');

    if (!apply) {
        return {
            apply: false,
            totalCount: preview.rows.length,
            needsBackfillCount: needsBackfillRows.length,
            duplicateCrmIds: preview.duplicateCrmIds,
            rows: preview.rows
        };
    }

    if (preview.duplicateCrmIds.length > 0) {
        const details = preview.duplicateCrmIds
            .map((entry) => `${entry.crmId}: ${entry.studentIds.join(', ')}`)
            .join('; ');
        throw new Error(`Duplicate crmId detected. Resolve before applying backfill. ${details}`);
    }

    let updatedCount = 0;
    for (const row of needsBackfillRows) {
        const doc = studentDocs.find((entry) => entry.id === row.studentId);
        if (!doc) continue;

        const result = await ensureCrmIdOnDoc(firestore, doc.ref, doc.data, {
            user: actor ? { uid: actor, email: null } : null,
            serverTimestamp: typeof firestore?.FieldValue?.serverTimestamp === 'function'
                ? () => firestore.FieldValue.serverTimestamp()
                : () => new Date()
        });
        row.crmId = result.crmId;
        row.status = 'updated';
        updatedCount += 1;
    }

    return {
        apply: true,
        totalCount: preview.rows.length,
        updatedCount,
        duplicateCrmIds: [],
        rows: preview.rows
    };
}

async function main(argv = process.argv.slice(2)) {
    const { apply } = parseArgs(argv);
    const result = await runBackfill({ apply });
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
    runBackfill,
    main
};
