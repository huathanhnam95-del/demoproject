const { CRM_COURSES } = require('../../functions/src/crm/collections');

const LEGACY_COLLECTION = 'courses';
const isDryRun = process.argv.includes('--dry-run');

function summarize(result, suffix = '') {
    const extra = suffix ? ` ${suffix}` : '';
    console.log(`${isDryRun ? 'dry-run complete' : 'migration complete'}: ${result.migrate} migrate, ${result.conflict} conflict, ${result.skip} skip${extra}`);
}

function mapLegacyCourse(data) {
    return {
        name: data.name || '',
        code: data.code || null,
        label: data.label || null,
        level: data.level || null,
        category: data.category || null,
        status: data.status || 'active',
        description: data.description || null,
        teachers: Array.isArray(data.teachers) ? data.teachers : [],
        createdAt: data.createdAt || null,
        createdBy: data.createdBy || null,
        createdByEmail: data.createdByEmail || null,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || null
    };
}

function hasConflict(existing, incoming) {
    const keys = ['name', 'code', 'label', 'level', 'category', 'status', 'description'];
    return keys.some((key) => {
        const left = existing[key] ?? null;
        const right = incoming[key] ?? null;
        return left !== right;
    });
}

async function main() {
    if (isDryRun) {
        summarize({ migrate: 0, conflict: 0, skip: 0 }, '(firebase unavailable in dry-run)');
        return;
    }

    const { db } = require('../../src/utils/firebase');
    if (!db) {
        throw new Error('Firebase Admin not initialized.');
    }

    const legacySnap = await db.collection(LEGACY_COLLECTION).get();
    const result = { migrate: 0, conflict: 0, skip: 0 };
    const batch = db.batch();

    for (const doc of legacySnap.docs) {
        const mapped = mapLegacyCourse(doc.data() || {});
        const targetRef = db.collection(CRM_COURSES).doc(doc.id);
        const targetSnap = await targetRef.get();

        if (targetSnap.exists) {
            const existing = targetSnap.data() || {};
            if (hasConflict(existing, mapped)) {
                result.conflict += 1;
                continue;
            }
            result.skip += 1;
            continue;
        }

        result.migrate += 1;
        if (!isDryRun) {
            batch.set(targetRef, mapped, { merge: true });
        }
    }

    if (!isDryRun && result.migrate > 0) {
        await batch.commit();
    }

    summarize(result);
}

main().catch((error) => {
    console.error('[crm migration] failed:', error?.message || error);
    process.exitCode = 1;
});
