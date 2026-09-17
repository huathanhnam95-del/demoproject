const { db } = require('../../src/utils/firebase');
const {
    hydrateStudentSchedule,
    hydrateClassroomSchedule
} = require('../../functions/src/crm/schedule-normalizer');

function parseArgs(argv) {
    return {
        apply: argv.includes('--apply'),
        limit: (() => {
            const index = argv.indexOf('--limit');
            if (index === -1) return null;
            const value = Number(argv[index + 1]);
            return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
        })()
    };
}

function arraysEqual(left, right) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (String(a[i] || '').trim() !== String(b[i] || '').trim()) return false;
    }
    return true;
}

function summarizeChange(before, after) {
    return {
        before,
        after
    };
}

async function scanCollection(collectionName, hydrator, fields) {
    const snap = await db.collection(collectionName).get();
    const updates = [];
    const changes = [];

    snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const hydrated = hydrator(data);
        const patch = {};

        fields.forEach((field) => {
            const current = data[field];
            const next = hydrated[field];
            if (!arraysEqual(current, next) && Array.isArray(next) && next.length > 0) {
                patch[field] = next;
            }
        });

        if (Object.keys(patch).length > 0) {
            updates.push({ id: doc.id, patch });
            changes.push({
                id: doc.id,
                ...summarizeChange(
                    fields.reduce((acc, field) => ({ ...acc, [field]: data[field] || [] }), {}),
                    fields.reduce((acc, field) => ({ ...acc, [field]: hydrated[field] || [] }), {})
                )
            });
        }
    });

    return { updates, changes };
}

async function main() {
    const { apply, limit } = parseArgs(process.argv.slice(2));
    const collections = [
        { name: 'crmStudents', hydrator: hydrateStudentSchedule, fields: ['preferredLearningDays', 'preferredLearningHours'] },
        { name: 'crmClassrooms', hydrator: hydrateClassroomSchedule, fields: ['meetingDays', 'meetingHours'] }
    ];

    let totalUpdates = 0;
    let totalChangedFields = 0;
    const preview = [];

    try {
        for (const collection of collections) {
            const result = await scanCollection(collection.name, collection.hydrator, collection.fields);
            const limitedUpdates = typeof limit === 'number' ? result.updates.slice(0, limit) : result.updates;
            totalUpdates += limitedUpdates.length;
            totalChangedFields += result.changes.length;
            preview.push({
                collection: collection.name,
                updates: limitedUpdates.slice(0, 5),
                changeCount: result.changes.length
            });

            if (apply && limitedUpdates.length) {
                const batch = db.batch();
                limitedUpdates.forEach((entry) => {
                    batch.set(db.collection(collection.name).doc(entry.id), entry.patch, { merge: true });
                });
                await batch.commit();
            }
        }
    } catch (error) {
        if (!apply && (error?.code === 16 || /UNAUTHENTICATED|invalid authentication credentials/i.test(error?.message || ''))) {
            console.log(JSON.stringify({
                apply: false,
                totalUpdates: 0,
                totalChangedFields: 0,
                preview: [],
                note: 'Firebase unavailable in dry-run/unauthenticated environment'
            }, null, 2));
            return;
        }
        throw error;
    }

    console.log(JSON.stringify({
        apply,
        totalUpdates,
        totalChangedFields,
        preview
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
