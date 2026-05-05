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

const EXPORT_COLLECTIONS = [
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
];

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
    const outputPath = path.resolve(process.cwd(), String(args.get('--output') || 'artifacts/crm-export.json'));

    if (dryRun) {
        console.log(`CRM export dry run: ${EXPORT_COLLECTIONS.join(', ')}`);
        return;
    }

    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');

    if (!getApps().length) {
        initializeApp();
    }

    const db = getFirestore();
    const exportPayload = {};

    for (const collectionName of EXPORT_COLLECTIONS) {
        const snap = await db.collection(collectionName).get();
        exportPayload[collectionName] = snap.docs.map((doc) => ({
            id: doc.id,
            data: doc.data()
        }));
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(exportPayload, null, 2));
    console.log(`CRM export wrote ${outputPath}`);
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
