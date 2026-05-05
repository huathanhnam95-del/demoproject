const fs = require('fs');
const path = require('path');
const {
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_AGENT_SOURCES,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_TASKS,
    CRM_ACTIVITIES,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_TEMPLATES,
    CRM_AUTOMATION_RULES,
    CRM_AUTOMATION_QUEUE,
    CRM_AUDIT_LOGS,
    CRM_MERGE_JOBS
} = require('../../functions/src/crm/collections');

const IMPORT_COLLECTIONS = new Set([
    CRM_LEADS,
    CRM_STUDENTS,
    CRM_AGENT_SOURCES,
    CRM_COURSES,
    CRM_CLASSROOMS,
    CRM_TASKS,
    CRM_ACTIVITIES,
    CRM_ENROLLMENTS,
    CRM_ATTENDANCE_SESSIONS,
    CRM_ATTENDANCE_RECORDS,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_COMMISSIONS,
    CRM_TEMPLATES,
    CRM_AUTOMATION_RULES,
    CRM_AUTOMATION_QUEUE,
    CRM_AUDIT_LOGS,
    CRM_MERGE_JOBS
]);

function parseArgs(argv) {
    const args = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args.set(token, true);
            continue;
        }
        args.set(token, next);
        index += 1;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dryRun = Boolean(args.get('--dry-run'));
    const inputPath = path.resolve(process.cwd(), String(args.get('--input') || 'artifacts/crm-export.json'));

    if (dryRun) {
        console.log(`CRM import dry run: expecting JSON for ${Array.from(IMPORT_COLLECTIONS).join(', ')}`);
        return;
    }

    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');

    if (!fs.existsSync(inputPath)) {
        throw new Error(`Import file not found: ${inputPath}`);
    }

    const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

    if (!getApps().length) {
        initializeApp();
    }

    const db = getFirestore();

    for (const [collectionName, documents] of Object.entries(payload)) {
        if (!IMPORT_COLLECTIONS.has(collectionName)) {
            continue;
        }

        const list = Array.isArray(documents) ? documents : [];
        for (const document of list) {
            const id = String(document?.id || '').trim();
            if (!id) continue;
            await db.collection(collectionName).doc(id).set(document.data || {}, { merge: true });
        }
    }

    console.log(`CRM import applied ${inputPath}`);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
