const fs = require('fs');
const path = require('path');
const {
    CRM_AUDIT_LOGS,
    CRM_CLASSROOMS,
    CRM_SCHEDULED_SESSIONS
} = require('../../functions/src/crm/collections');
const {
    buildClassroomScheduleBackfill,
    buildScheduledSessionCanonicalBackfill
} = require('../../functions/src/crm/scheduler-migration-service');

function parseArgs(argv) {
    const args = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [flag, inlineValue] = token.split('=');
        if (inlineValue !== undefined) {
            args.set(flag, inlineValue);
            continue;
        }
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args.set(flag, true);
            continue;
        }
        args.set(flag, next);
        index += 1;
    }
    return args;
}

function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonlLine(stream, payload) {
    stream.write(`${JSON.stringify(payload)}\n`);
}

async function getDb() {
    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    if (!getApps().length) {
        initializeApp();
    }
    return getFirestore();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const applyMode = Boolean(args.get('--apply'));
    const classIdFilter = String(args.get('--classId') || '').trim() || null;
    const limit = Number(args.get('--limit') || 0) || null;
    const resumeAfter = String(args.get('--resumeAfter') || '').trim() || null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactRoot = path.resolve(process.cwd(), String(args.get('--out') || 'tmp'));
    const unresolvedPath = path.join(artifactRoot, `scheduler-backfill-unresolved-${timestamp}.jsonl`);
    const checkpointPath = path.join(artifactRoot, `scheduler-backfill-checkpoint-${timestamp}.json`);
    ensureDir(unresolvedPath);
    ensureDir(checkpointPath);

    const db = await getDb();
    const unresolvedStream = fs.createWriteStream(unresolvedPath, { flags: 'a' });
    const counters = {
        processedSessions: 0,
        patchedSessions: 0,
        skippedSessions: 0,
        unresolvedSessions: 0,
        processedClassrooms: 0,
        patchedClassrooms: 0,
        alreadyConsistentClassrooms: 0,
        unresolvedClassrooms: 0
    };

    let lastProcessedDocId = resumeAfter || null;
    let batch = applyMode && typeof db.batch === 'function' ? db.batch() : null;
    let batchWrites = 0;

    async function flushBatch() {
        if (applyMode && batch && batchWrites > 0) {
            await batch.commit();
            batch = db.batch();
            batchWrites = 0;
        }
    }

    function queueSet(ref, payload) {
        if (!applyMode) return;
        batch.set(ref, payload, { merge: true });
        batchWrites += 1;
    }

    let classroomQuery = db.collection(CRM_CLASSROOMS).orderBy('__name__');
    if (resumeAfter) {
        classroomQuery = classroomQuery.startAfter(resumeAfter);
    }
    if (limit) {
        classroomQuery = classroomQuery.limit(limit);
    }

    const classroomSnap = await classroomQuery.get();
    const classroomTimezoneById = new Map();
    for (const doc of classroomSnap.docs) {
        if (classIdFilter && doc.id !== classIdFilter) continue;
        counters.processedClassrooms += 1;
        lastProcessedDocId = doc.id;
        const classroom = doc.data() || {};
        classroomTimezoneById.set(doc.id, classroom.scheduleConfig?.timezone || null);
        const backfill = buildClassroomScheduleBackfill(classroom);
        if (backfill.status === 'patched') {
            counters.patchedClassrooms += 1;
            queueSet(doc.ref, backfill.patch);
        } else if (backfill.status === 'already_consistent') {
            counters.alreadyConsistentClassrooms += 1;
        } else {
            counters.unresolvedClassrooms += 1;
            writeJsonlLine(unresolvedStream, {
                collection: CRM_CLASSROOMS,
                docId: doc.id,
                reason: backfill.reason,
                rawTimezone: classroom.scheduleConfig?.timezone || null,
                rawScheduledStartAt: null,
                rawScheduledEndAt: null,
                classId: doc.id
            });
        }
        if (batchWrites >= 400) {
            await flushBatch();
        }
    }

    let sessionQuery = db.collection(CRM_SCHEDULED_SESSIONS).orderBy('__name__');
    if (resumeAfter) {
        sessionQuery = sessionQuery.startAfter(resumeAfter);
    }
    if (limit) {
        sessionQuery = sessionQuery.limit(limit);
    }

    const sessionSnap = await sessionQuery.get();
    for (const doc of sessionSnap.docs) {
        const session = doc.data() || {};
        if (classIdFilter && String(session.classId || '') !== classIdFilter) continue;
        counters.processedSessions += 1;
        lastProcessedDocId = doc.id;
        const backfill = buildScheduledSessionCanonicalBackfill(session, classroomTimezoneById.get(String(session.classId || '')) || null);
        if (backfill.status === 'patched') {
            counters.patchedSessions += 1;
            queueSet(doc.ref, backfill.patch);
        } else if (backfill.status === 'already_consistent') {
            counters.skippedSessions += 1;
        } else {
            counters.unresolvedSessions += 1;
            writeJsonlLine(unresolvedStream, {
                collection: CRM_SCHEDULED_SESSIONS,
                docId: doc.id,
                reason: backfill.reason,
                rawTimezone: session.timezone || null,
                rawScheduledStartAt: session.scheduledStartAt || null,
                rawScheduledEndAt: session.scheduledEndAt || null,
                classId: session.classId || null
            });
        }
        if (batchWrites >= 400) {
            await flushBatch();
        }
    }

    await flushBatch();

    if (applyMode) {
        await db.collection(CRM_AUDIT_LOGS).doc().set({
            action: 'scheduler.backfill.apply',
            entityType: 'scheduler',
            entityId: `scheduler-backfill-${timestamp}`,
            metadata: {
                ...counters,
                classIdFilter,
                resumeAfter,
                checkpointPath,
                unresolvedPath
            },
            createdAt: new Date()
        });
    }

    unresolvedStream.end();
    const checkpoint = {
        lastProcessedDocId,
        ...counters,
        runMode: applyMode ? 'apply' : 'dry-run',
        timestamp,
        classIdFilter
    };
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

    console.log(JSON.stringify({
        applyMode,
        unresolvedPath,
        checkpointPath,
        ...checkpoint
    }, null, 2));
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
