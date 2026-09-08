'use strict';
const { id } = require('./domain/validation');
const { assertProjectTask } = require('./phase4-utils');
const { runTransactionWithClosedRetry } = require('./domain/transaction-retry');
const { ref, data, hash, fail, strict, iso, pageSize, COLLECTIONS } = require('./automation/store');
const CATEGORIES = Object.freeze(['assignment', 'discussion', 'deadline', 'automation']);
function category(value) { if (!CATEGORIES.includes(value)) fail('INVALID_CATEGORY', 'Unknown notification category.'); return value; }
function createProjectsNotificationService({ db, accessService, now = () => new Date() }) {
    const tx = fn => runTransactionWithClosedRetry(db, fn);
    async function resolve(transaction, identity, record) {
        if (record.recipientUid !== identity.uid) fail('NOTIFICATION_NOT_FOUND', 'Notification not found.', 404);
        await accessService.assertTransactionContentAccess(transaction, identity.uid, record.projectId);
        try {
            const task = await assertProjectTask(transaction, db, record.projectId, record.taskId);
            if (record.messageId) {
                const message = data(await transaction.get(db.doc(`crmProjects/${record.projectId}/discussions/${record.messageId}`)));
                if (!message || message.taskId !== record.taskId || message.moderationState !== 'visible' || (message.lifecycle && message.lifecycle !== 'active')) return { available: false };
            }
            return { available: true, task };
        } catch (error) { if ([404, 409].includes(error.status)) return { available: false }; throw error; }
    }
    // Read every recipient, preference and dedupe record before returning writes.
    // Executor uses this in the same transaction as the notify journal commit.
    async function prepareDelivery(transaction, input) {
        category(input.category); const recipients = [...new Set(input.recipientUids || [])]; const writes = [];
        if (recipients.length > 102) fail('NOTIFICATION_LIMIT', 'Too many notification recipients.');
        for (const recipientUid of recipients) {
            const notificationId = hash(input.identity, input.category, recipientUid);
            if (data(await transaction.get(ref(db, 'deliveries', notificationId)))) continue;
            let eligible = true;
            try { await accessService.assertTransactionContentAccess(transaction, recipientUid, input.projectId); }
            catch (error) { if (![403, 404].includes(error.status)) throw error; eligible = false; }
            const preferences = data(await transaction.get(ref(db, 'preferences', hash(recipientUid)))) || { muted: [] };
            const muted = preferences.muted.some(m => m.projectId === input.projectId && m.category === input.category);
            const suppressed = !eligible || muted || (input.excludeActor && recipientUid === input.actorUid);
            writes.push({ notificationId, delivery: { notificationId, projectId: input.projectId, category: input.category, recipientUid, state: suppressed ? 'suppressed' : 'delivered', createdAt: iso(now) }, record: suppressed ? null : { notificationId, projectId: input.projectId, taskId: input.taskId, messageId: input.messageId || null, recipientUid, category: input.category, message: input.message || '', createdAt: iso(now), read: false } });
        }
        return () => { for (const item of writes) { transaction.create(ref(db, 'deliveries', item.notificationId), item.delivery); if (item.record) transaction.create(ref(db, 'notifications', item.notificationId), item.record); } return writes.filter(w => w.record).map(w => w.notificationId); };
    }
    async function deliver(input) { return tx(async transaction => { const write = await prepareDelivery(transaction, input); return { notificationIds: write() }; }); }
    async function list(identity, options = {}) {
        strict(options, ['projectId', 'category', 'unread', 'cursor', 'pageSize']);
        const projectId = options.projectId === undefined ? null : id(options.projectId); const filterCategory = options.category === undefined ? null : category(options.category);
        if (options.unread !== undefined && ![true, false, 'true', 'false'].includes(options.unread)) fail('INVALID_UNREAD', 'unread must be boolean.');
        const unread = options.unread === undefined ? null : options.unread === true || options.unread === 'true';
        const size = pageSize(options.pageSize); const scope = hash(identity.uid, projectId, filterCategory, unread); let after = null;
        if (options.cursor) { try { after = JSON.parse(Buffer.from(options.cursor, 'base64url').toString()); if (after.scope !== scope || !Number.isFinite(Date.parse(after.createdAt))) throw new Error(); id(after.id); } catch (_) { fail('INVALID_CURSOR', 'Cursor belongs to another feed or is invalid.'); } }
        return tx(async transaction => {
            await accessService.assertTransactionEligible(transaction, identity.uid);
            if (projectId) await accessService.assertTransactionContentAccess(transaction, identity.uid, projectId);
            let query = db.collection(COLLECTIONS.notifications).where('recipientUid', '==', identity.uid);
            if (projectId) query = query.where('projectId', '==', projectId);
            if (filterCategory) query = query.where('category', '==', filterCategory);
            if (unread !== null) query = query.where('read', '==', !unread);
            query = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc'); if (after) query = query.startAfter(after.createdAt, after.id);
            const snapshot = await transaction.get(query.limit(101)); const items = []; let lastScanned = null; let scanned = 0;
            for (const document of snapshot.docs.slice(0, 100)) {
                scanned += 1; const record = document.data(); lastScanned = { id: document.id, createdAt: record.createdAt, scope };
                let current; try { current = await resolve(transaction, identity, record); } catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
                const item = { notificationId: document.id, projectId: record.projectId, category: record.category, createdAt: record.createdAt, read: record.read, available: current.available };
                if (current.available) { item.taskLabel = current.task.data.title; item.message = record.message; }
                items.push(item); if (items.length === size) break;
            }
            const hasMore = snapshot.docs.length > scanned;
            return { items, hasMore, nextCursor: hasMore && lastScanned ? Buffer.from(JSON.stringify(lastScanned)).toString('base64url') : null };
        });
    }
    async function readRecord(transaction, identity, notificationId) { const record = data(await transaction.get(ref(db, 'notifications', id(notificationId)))); if (!record) fail('NOTIFICATION_NOT_FOUND', 'Notification not found.', 404); const current = await resolve(transaction, identity, record); return { record, current }; }
    async function setRead(identity, notificationId, input) { strict(input, ['read']); if (typeof input.read !== 'boolean') fail('INVALID_READ_STATE', 'read must be boolean.'); return tx(async transaction => { await readRecord(transaction, identity, notificationId); transaction.update(ref(db, 'notifications', notificationId), { read: input.read }); return { notificationId, read: input.read }; }); }
    async function target(identity, notificationId) { return tx(async transaction => { const { record, current } = await readRecord(transaction, identity, notificationId); return current.available ? { available: true, projectId: record.projectId, taskId: record.taskId, ...(record.messageId ? { messageId: record.messageId } : {}) } : { available: false }; }); }
    async function preferences(identity, input) { return tx(async transaction => {
        await accessService.assertTransactionEligible(transaction, identity.uid); const preferenceRef = ref(db, 'preferences', hash(identity.uid)); const current = data(await transaction.get(preferenceRef)) || { revision: 0, muted: [] };
        if (input === undefined) { const muted = []; for (const item of current.muted) { try { await accessService.assertTransactionContentAccess(transaction, identity.uid, item.projectId); muted.push(item); } catch (error) { if (![403, 404].includes(error.status)) throw error; } } return { revision: current.revision, muted }; }
        strict(input, ['expectedRevision', 'muted']); if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== current.revision) fail('STALE_REVISION', 'Preferences changed; refresh and retry.', 409);
        if (!Array.isArray(input.muted) || input.muted.length > 400) fail('INVALID_PREFERENCES', 'Muted preferences must be a bounded array.');
        const muted = []; const seen = new Set();
        for (const item of input.muted) { strict(item, ['projectId', 'category']); const value = { projectId: id(item.projectId), category: category(item.category) }; const key = hash(value); if (seen.has(key)) fail('INVALID_PREFERENCES', 'Duplicate mute preference.'); seen.add(key); await accessService.assertTransactionContentAccess(transaction, identity.uid, value.projectId); muted.push(value); }
        const result = { revision: current.revision + 1, muted }; transaction.set(preferenceRef, result); return result;
    }); }
    return { list, setRead, target, preferences, deliver, prepareDelivery };
}
module.exports = { createProjectsNotificationService, CATEGORIES };
