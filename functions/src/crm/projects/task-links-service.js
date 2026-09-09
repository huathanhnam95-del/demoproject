'use strict';
const { DomainError, id } = require('./domain/validation');
const { projectCollection, projectRef } = require('./domain/storage');
const { assertProjectTask, nowIso } = require('./phase4-utils');
const COLLECTIONS = Object.freeze({ lead: 'crmLeads', student: 'crmStudents', classroom: 'crmClassrooms' });
function normalizeLinks(value) {
    if (!Array.isArray(value) || value.length > 50) throw new DomainError(400, 'INVALID_TASK_LINKS', 'At most 50 links are allowed.');
    const links = value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((key) => !['type', 'recordId'].includes(key)) || !Object.hasOwn(COLLECTIONS, entry.type)) throw new DomainError(400, 'INVALID_TASK_LINKS', 'Invalid link type or fields.');
        return { type: entry.type, recordId: id(entry.recordId, 'record ID') };
    });
    if (new Set(links.map((link) => `${link.type}:${link.recordId}`)).size !== links.length) throw new DomainError(400, 'INVALID_TASK_LINKS', 'Links must be unique.');
    return links;
}
function safeRecord(type, snapshot) {
    if (!snapshot?.exists) return null;
    const data = snapshot.data() || {};
    if (data.deleted === true || data.isDeleted === true || data.archived === true || data.deletedAt || ['deleted', 'trashed', 'archived'].includes(data.lifecycle || data.status)) return null;
    const label = String(data.name || data.fullName || data.displayName || data.title || '').trim().slice(0, 200);
    if (!label) return null;
    return { type, recordId: snapshot.id, label, href: `/crm-admin.html#${{ lead: 'enquiry', student: 'students', classroom: 'courses/class-management' }[type]}` };
}
function createTaskLinksService({ db, accessService, commandService, authorizeCrmIdentity, now = () => new Date() }) {
    async function canManage(identity, transaction) { return typeof authorizeCrmIdentity === 'function' && await authorizeCrmIdentity({ identity, transaction }) === true; }
    async function requireCrm(identity, transaction) { if (!await canManage(identity, transaction)) throw new DomainError(403, 'CRM_ACCESS_DENIED', 'Current CRM access is required.'); }
    async function resolve(link, transaction) { return safeRecord(link.type, await (transaction ? transaction.get(db.collection(COLLECTIONS[link.type]).doc(link.recordId)) : db.collection(COLLECTIONS[link.type]).doc(link.recordId).get())); }
    async function readLinksInTransaction(transaction, identity, projectId, taskId) {
        projectId = id(projectId, 'project ID'); taskId = id(taskId, 'task ID');
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId);
            await assertProjectTask(transaction, db, projectId, taskId);
            if (!await canManage(access.identity, transaction)) return { links: [], canManage: false };
            const doc = await transaction.get(projectCollection(db, projectId, 'taskLinks').doc(taskId));
            const links = [];
            const candidates = doc.exists ? doc.data().links : [];
            for (const link of (Array.isArray(candidates) ? candidates : []).slice(0, 50)) {
                if (!link || !Object.hasOwn(COLLECTIONS, link.type)) continue;
                let normalized; try { normalized = normalizeLinks([link])[0]; } catch (_) { continue; }
                const record = await resolve(normalized, transaction); if (record) links.push(record);
            }
            return { links, canManage: ['Owner', 'Editor'].includes(access.role) };
    }
    async function readLinks(identity, projectId, taskId) {
        return db.runTransaction(transaction => readLinksInTransaction(transaction, identity, projectId, taskId), { readOnly: true });
    }
    async function updateLinks(identity, projectId, taskId, input) {
        projectId = id(projectId, 'project ID'); taskId = id(taskId, 'task ID');
        const links = normalizeLinks(input.links);
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new DomainError(400, 'INVALID_REVISION', 'expectedRevision is required.');
        return commandService.runCommand({ actorUid: identity.uid, command: 'updateTaskLinks', projectId, targetId: taskId, operationId: input.operationId, payload: { links, expectedRevision: input.expectedRevision }, access: { write: true },
            authorize: ({ transaction, contentAccess }) => requireCrm(contentAccess.identity, transaction),
            execute: async ({ transaction }) => {
                const task = await assertProjectTask(transaction, db, projectId, taskId);
                if (Number(task.data.revision || 0) !== input.expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'Task changed; refresh.');
                for (const link of links) if (!await resolve(link, transaction)) throw new DomainError(400, 'CRM_LINK_UNAVAILABLE', 'A selected CRM record is unavailable.');
                const revision = input.expectedRevision + 1;
                transaction.set(projectCollection(db, projectId, 'taskLinks').doc(taskId), { links, taskId, revision, updatedAt: nowIso(now) });
                transaction.update(task.ref, { revision, updatedAt: nowIso(now), updatedBy: identity.uid });
                // Never place link IDs or labels in generic operation/history records.
                return { result: { task: { id: taskId, revision }, operationId: input.operationId }, before: { taskId, revision: input.expectedRevision }, after: { taskId, revision }, affectedIds: [taskId] };
            } });
    }
    async function options(identity, projectId, input = {}) {
        if (!Object.hasOwn(COLLECTIONS, input.type)) throw new DomainError(400, 'INVALID_LINK_TYPE', 'Invalid CRM record type.');
        const query = String(input.query || '').trim();
        const limit = input.limit === undefined ? 25 : Number(input.limit);
        if (query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new DomainError(400, 'INVALID_LINK_QUERY', 'Invalid CRM lookup.');
        return db.runTransaction(async (transaction) => {
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, id(projectId, 'project ID'));
            await requireCrm(access.identity, transaction);
            // Bounded canonical-name prefix lookup, never a dump of legacy objects.
            const field = 'name';
            let collection = db.collection(COLLECTIONS[input.type]).orderBy(field);
            if (query) collection = collection.startAt(query).endAt(`${query}\uf8ff`);
            const rows = await transaction.get(collection.limit(limit));
            return { options: rows.docs.map((doc) => safeRecord(input.type, doc)).filter(Boolean).map(({ type, recordId, label }) => ({ type, recordId, label })) };
        }, { readOnly: true });
    }

    async function projectLinksInTransaction(transaction, identity, projectId) {
        projectId = id(projectId, 'project ID');
            const access = await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId);
            if (!await canManage(access.identity, transaction)) return { links: [], canManage: false };
            const doc = await transaction.get(projectCollection(db, projectId, 'projectLinks').doc('current'));
            // An existing dedicated record, including an empty list, replaces legacy links.
            const candidates = doc.exists ? doc.data().links || [] : access.project.data.crmLinks || access.project.data.links || [];
            const links = [];
            for (const raw of (Array.isArray(candidates) ? candidates : []).slice(0, 50)) {
                let link; try { link = normalizeLinks([{ type: ({ crmLeads: 'lead', crmStudents: 'student', crmClassrooms: 'classroom' })[raw.type || raw.module] || raw.type || raw.module, recordId: raw.recordId || raw.id }])[0]; } catch (_) { continue; }
                const record = await resolve(link, transaction); if (record) links.push(record);
            }
            return { links, canManage: access.role === 'Owner' };
    }
    async function projectLinks(identity, projectId) {
        return db.runTransaction(transaction => projectLinksInTransaction(transaction, identity, projectId), { readOnly: true });
    }
    async function updateProjectLinks(identity, projectId, input) {
        projectId = id(projectId, 'project ID'); const links = normalizeLinks(input.links);
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new DomainError(400, 'INVALID_REVISION', 'expectedRevision is required.');
        return commandService.runCommand({ actorUid: identity.uid, command: 'updateProjectLinks', projectId, targetId: projectId, operationId: input.operationId, payload: { links, expectedRevision: input.expectedRevision }, access: { owner: true },
            authorize: ({ transaction, contentAccess }) => requireCrm(contentAccess.identity, transaction), execute: async ({ transaction, contentAccess }) => {
                if ((contentAccess.project.data.lifecycle || 'active') !== 'active') throw new DomainError(409, 'PROJECT_LIFECYCLE_FORBIDDEN', 'Project is not active.');
                if (Number(contentAccess.project.data.revision || 0) !== input.expectedRevision) throw new DomainError(409, 'STALE_REVISION', 'Project changed; refresh.');
                for (const link of links) if (!await resolve(link, transaction)) throw new DomainError(400, 'CRM_LINK_UNAVAILABLE', 'A selected CRM record is unavailable.');
                const revision = input.expectedRevision + 1;
                transaction.set(projectCollection(db, projectId, 'projectLinks').doc('current'), { links, revision, updatedAt: nowIso(now) });
                transaction.update(projectRef(db, projectId), { revision, updatedAt: nowIso(now), updatedBy: identity.uid });
                return { result: { project: { id: projectId, revision }, operationId: input.operationId }, before: { projectId, revision: input.expectedRevision }, after: { projectId, revision }, affectedIds: [projectId] };
            } });
    }
    return { canManage, readLinksInTransaction, projectLinksInTransaction, readLinks, updateLinks, options, projectLinks, updateProjectLinks };
}
module.exports = { createTaskLinksService, normalizeLinks, safeRecord };
