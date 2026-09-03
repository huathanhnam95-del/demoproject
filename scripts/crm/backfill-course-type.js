#!/usr/bin/env node
'use strict';

/**
 * Backfill `courseType` (and optionally `durationDays`) on existing crmCourses documents.
 *
 * `courseType` became required at create time when 1-on-1 scheduling landed, but courses
 * created before that have no value. This maps the known catalog by name and reports
 * anything it cannot classify rather than guessing.
 *
 * Dry run (default):  node scripts/crm/backfill-course-type.js
 * Apply:              node scripts/crm/backfill-course-type.js --apply
 */

const admin = require('firebase-admin');
const { resolveServiceAccountPath } = require('../../src/utils/service-account-path');
const { CRM_COURSES } = require('../../functions/src/crm/collections');
const { COURSE_TYPES } = require('../../functions/src/crm/course-service');

// Keyed by lower-cased course name. Anything not listed here is reported, never guessed.
const NAME_TO_COURSE_TYPE = {
    'pronunciation': 'pronun',
    'pte academic tutoring': '1on1'
};

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

function classify(doc) {
    const data = doc.data() || {};
    const name = String(data.name || '').trim();
    const existing = String(data.courseType || '').trim();

    if (COURSE_TYPES.includes(existing)) {
        return { status: 'skip', reason: `already ${existing}`, name, courseType: existing };
    }

    const mapped = NAME_TO_COURSE_TYPE[name.toLowerCase()];
    if (!mapped) {
        return { status: 'unmapped', reason: 'name not in mapping table', name, courseType: null };
    }

    return { status: 'update', reason: `name matched "${name}"`, name, courseType: mapped };
}

async function main() {
    const { apply } = parseArgs(process.argv.slice(2));
    const db = await initializeFirestore();
    const snapshot = await db.collection(CRM_COURSES).get();

    const rows = snapshot.docs.map((doc) => ({ id: doc.id, ...classify(doc) }));
    const updates = rows.filter((row) => row.status === 'update');
    const skipped = rows.filter((row) => row.status === 'skip');
    const unmapped = rows.filter((row) => row.status === 'unmapped');

    console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} — ${snapshot.size} course(s) in ${CRM_COURSES}\n`);

    rows.forEach((row) => {
        const mark = row.status === 'update' ? '+' : row.status === 'skip' ? '=' : '?';
        const target = row.courseType ? ` -> ${row.courseType}` : '';
        console.log(`  ${mark} ${row.id}  ${JSON.stringify(row.name)}${target}  (${row.reason})`);
    });

    console.log(`\n  ${updates.length} to update · ${skipped.length} already set · ${unmapped.length} unmapped`);

    if (unmapped.length) {
        console.log('\n  Unmapped courses keep courseType = null. They stay editable, but cannot be');
        console.log('  used for 1-on-1 enrolment until a type is chosen in the Course modal.');
    }

    if (!apply) {
        console.log('\n  No writes performed. Re-run with --apply to write these changes.\n');
        return;
    }

    if (!updates.length) {
        console.log('\n  Nothing to write.\n');
        return;
    }

    const batch = db.batch();
    updates.forEach((row) => {
        batch.update(db.collection(CRM_COURSES).doc(row.id), { courseType: row.courseType });
    });
    await batch.commit();

    console.log(`\n  Wrote courseType to ${updates.length} course(s).\n`);
}

main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
});
