'use strict';
const { memberDocumentId } = require('../access-service');
const { projectCollection } = require('../domain/storage');
const { calendarSummary } = require('../calendar-model');
const { reject } = require('../../../ai-assistance/accounting/money-pricing');
const ELIGIBILITY_DENIALS = new Set(['ACCOUNT_INACTIVE', 'PROJECTS_ACCESS_DENIED', 'UNAUTHORIZED', 'REVOKED_TOKEN', 'ACCOUNT_NOT_FOUND']);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sortedLinks = links => [...links].sort((a, b) => order(a.type, b.type) || order(a.recordId, b.recordId));
function createProjectsContextDetails({ db, accessService, now = Date.now, taskLinksService = null }) {
    async function resolve({ tx, actorUid, projectId, selectedTaskIds, access }) {
        // Drain both independent reads before any failure can end this transaction.
        const [membershipOutcome, calendarOutcome] = await Promise.allSettled([
            Promise.resolve().then(() => tx.get(db.collection('crmProjectMembers').where('projectId', '==', projectId).limit(100))),
            Promise.resolve().then(() => tx.get(db.collection('crmProjectOrganizationConfig').doc('calendar')))
        ]);
        if (membershipOutcome.status === 'rejected') throw membershipOutcome.reason;
        const membership = membershipOutcome.value;
        const people = [];
        for (let offset = 0; offset < membership.docs.length; offset += 4) {
            const chunk = membership.docs.slice(offset, offset + 4);
            const outcomes = await Promise.allSettled(chunk.map(async doc => {
                const row = doc.data();
                if (row.projectId !== projectId || !row.uid || doc.id !== memberDocumentId(projectId, row.uid) || row.active === false || !['Owner', 'Editor', 'Viewer'].includes(row.role)) return null;
                let identity;
                try { identity = await accessService.assertTransactionEligible(tx, row.uid); }
                catch (error) { if (ELIGIBILITY_DENIALS.has(error.code)) return null; throw error; }
                return { row, identity };
            }));
            // Completion order must not change denial filtering or first error.
            for (let index = 0; index < chunk.length; index++) {
                const outcome = outcomes[index];
                if (outcome.status === 'rejected') throw outcome.reason;
                if (!outcome.value) continue;
                const { row, identity } = outcome.value;
                if (identity.uid !== row.uid) reject('INVALID_CONTEXT_IDENTITY', 'Member identity changed.', 409);
                const name = identity.profile?.displayName || identity.profile?.name || identity.authUser?.displayName || '';
                people.push({ uid: row.uid, displayName: typeof name === 'string' ? name.trim().slice(0, 200) : '', role: row.role });
            }
        }
        people.sort((a, b) => order(a.displayName, b.displayName) || order(a.uid, b.uid));
        if (calendarOutcome.status === 'rejected') throw calendarOutcome.reason;
        const snapshot = calendarOutcome.value;
        const config = snapshot.exists ? snapshot.data() : {};
        const current = new Date(now());
        if (!Number.isFinite(current.getTime())) reject('INVALID_CONTEXT_TIME', 'Current date is unavailable.', 409);
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(current).map(part => [part.type, part.value]));
        const localDate = `${parts.year}-${parts.month}-${parts.day}`;
        const summary = calendarSummary(config, [Number(parts.year)]);
        if (!Number.isSafeInteger(summary.revision) || summary.revision < 0) reject('INVALID_CONTEXT_REVISION', 'Calendar revision is invalid.', 409);
        const calendar = { localDate, localDateTimezone: 'Asia/Ho_Chi_Minh', timezone: summary.timezone, revision: summary.revision, workingWeekdays: [...new Set(config.workingWeekdays || [1, 2, 3, 4, 5])].sort(), feedVersion: summary.feedVersion, coverage: summary.coverage, requiresConfiguration: summary.requiresConfiguration };
        let remaining = 30;
        const discussions = [];
        for (const taskId of [...selectedTaskIds].sort(order)) {
            // A bounded unordered scan avoids an additional composite index. At
            // its cap, these are only the latest messages within the scan.
            const rows = await tx.get(projectCollection(db, projectId, 'discussions').where('taskId', '==', taskId).limit(100));
            const matching = rows.docs.map(doc => ({ id: doc.id, data: doc.data() })).filter(row => row.data.projectId === projectId && row.data.taskId === taskId);
            matching.sort((a, b) => order(String(b.data.createdAt || ''), String(a.data.createdAt || '')) || order(a.id, b.id));
            const chosen = matching.slice(0, Math.min(5, remaining)); remaining -= chosen.length;
            discussions.push({ taskId, hasMore: matching.length > chosen.length || rows.docs.length === 100, incomplete: rows.docs.length === 100 || (remaining === 0 && matching.length > chosen.length), messages: chosen.map(({ id, data }) => {
                const visible = data.moderationState === 'visible' || data.authorUid === actorUid || access.role === 'Owner';
                const body = visible && typeof data.body === 'string' ? data.body.slice(0, 1000) : null;
                return { id, authorUid: typeof data.authorUid === 'string' ? data.authorUid : null, createdAt: typeof data.createdAt === 'string' ? data.createdAt.slice(0, 40) : null, body, excerpt: visible && typeof data.body === 'string' && data.body.length > 1000, redacted: !visible };
            }) });
        }
        const linkedRecords = { project: [], tasks: [] };
        if (taskLinksService) {
            linkedRecords.project = sortedLinks((await taskLinksService.projectLinksInTransaction(tx, access.identity, projectId)).links);
            for (const taskId of [...selectedTaskIds].sort(order)) linkedRecords.tasks.push({ taskId, links: sortedLinks((await taskLinksService.readLinksInTransaction(tx, access.identity, projectId, taskId)).links) });
        }
        return { people: { members: people, incomplete: membership.docs.length === 100 }, calendar, discussions, linkedRecords };
    }
    return Object.freeze({ resolve });
}
module.exports = { createProjectsContextDetails };
