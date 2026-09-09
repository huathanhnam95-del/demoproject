#!/usr/bin/env node
'use strict';
// Explicit initial/catch-up migration. Each invocation has a hard page bound;
// omit --reset to resume the persisted cursor after interruption.
const { createDueScheduling } = require('../../functions/src/crm/projects/automation/due-scheduling');
async function rebuild({ db, projectId, reset = false, pages = 10, pageSize = 100, now }) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId || '')) throw new Error('An explicit valid projectId is required.');
    if (!Number.isInteger(pages) || pages < 1 || pages > 100 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Use 1-100 pages of 1-100 tasks.');
    const scheduling = createDueScheduling({ db, now });
    if (reset) await scheduling.enqueue(projectId);
    else {
        const { ref } = require('../../functions/src/crm/projects/automation/store');
        if (!(await ref(db, 'dueRebuilds', projectId).get()).exists) throw new Error('No rebuild job exists; use --reset for initial indexing.');
    }
    let scanned = 0; let result;
    for (let page = 0; page < pages; page += 1) {
        result = await scheduling.rebuildPage(projectId, { limit: pageSize });
        scanned += result.scanned;
        if (result.done || result.stale) break;
    }
    return { ...result, projectId, scanned };
}
async function main() {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, value] = arg.replace(/^--/, '').split('='); return [key, value === undefined ? true : value]; }));
    if (Object.keys(args).some(key => !['project', 'reset', 'pages', 'page-size'].includes(key))) throw new Error('Usage: --project=ID [--reset] [--pages=10] [--page-size=100]');
    // This repair package is local-only. A deployment migration needs a separate
    // explicitly reviewed production operator entrypoint.
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.CRM_PROJECTS_EMULATOR_FIRESTORE_PORT) throw new Error('Explicit dedicated Firestore emulator configuration required.');
    const { getEmulatorConfig } = require('./projects/emulator-config');
    const config = getEmulatorConfig();
    if (process.env.GCLOUD_PROJECT !== config.projectId) throw new Error('GCLOUD_PROJECT must match the dedicated demo project.');
    const admin = require('firebase-admin');
    const app = admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
    try { console.log(JSON.stringify(await rebuild({ db: app.firestore(), projectId: args.project, reset: args.reset === true, pages: args.pages === undefined ? 10 : Number(args.pages), pageSize: args['page-size'] === undefined ? 100 : Number(args['page-size']) }))); }
    finally { await app.delete(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { rebuild };
