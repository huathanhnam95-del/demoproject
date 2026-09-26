'use strict';
const crypto = require('crypto');
const { enqueueRebuild, dueRegistrySignature } = require('./due-scheduling');
const { id, uid } = require('../domain/validation');
const { runTransactionWithClosedRetry } = require('../domain/transaction-retry');
const { ref, data, hash, fail, strict, iso, pageSize, cursor, encodeCursor, COLLECTIONS } = require('./store');
const { validateReferences } = require('./references');
const { string } = require('./definition');
const { isProjectsFeatureEnabled } = require('../feature-config');
function normalizeListFilters(options = {}) {
    strict(options, ['pageSize', 'cursor', 'query', 'folder', 'enabled']);
    function text(value, name) { if (typeof value !== 'string' || value.length > 200 || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) fail('INVALID_QUERY', `${name} must be bounded plain text.`); return value.trim(); }
    const query = options.query === undefined ? '' : text(options.query, 'query').toLowerCase();
    const folder = options.folder === undefined ? null : text(options.folder, 'folder');
    const enabled = options.enabled === undefined || options.enabled === 'all' ? null : options.enabled === true || options.enabled === 'true' ? true : options.enabled === false || options.enabled === 'false' ? false : fail('INVALID_QUERY', 'enabled must be true, false or all.');
    return { query, folder, enabled };
}
function matchesListFilters(rule, filters) { return (!filters.query || String(rule.title || '').toLowerCase().includes(filters.query)) && (filters.folder === null || (rule.folder || '') === filters.folder) && (filters.enabled === null || rule.enabled === filters.enabled); }
function createAutomationRuleService({ db, accessService, now = () => new Date() }) {
    const tx = fn => runTransactionWithClosedRetry(db, fn);
    async function owner(transaction, identity, projectId) { return accessService.assertTransactionContentAccess(transaction, identity.uid, projectId, { owner: true }); }
    async function readRule(transaction, projectId, ruleId) { const rule = data(await transaction.get(ref(db, 'rules', id(ruleId)))); if (!rule || rule.projectId !== projectId) fail('AUTOMATION_NOT_FOUND', 'Automation not found.', 404); return rule; }
    async function readVersion(transaction, projectId, ruleId, versionId) { const version = data(await transaction.get(ref(db, 'versions', id(versionId)))); if (!version || version.projectId !== projectId || version.ruleId !== ruleId) fail('AUTOMATION_VERSION_NOT_FOUND', 'Immutable version not found.', 404); return version; }
    async function mutate(identity, projectId, ruleId, input, kind) {
        id(projectId); const allowed = { create: ['operationId', 'title', 'folder', 'definition'], patch: ['operationId', 'expectedRevision', 'title', 'folder', 'enabled'], versions: ['operationId', 'expectedRevision', 'definition', 'actorUid'], activate: ['operationId', 'expectedRevision', 'versionId', 'previewToken'], duplicate: ['operationId', 'expectedRevision'] }[kind]; strict(input, allowed);
        const operationId = id(input.operationId); const operationRef = db.collection('crmProjectOperations').doc(operationId);
        const requestDigest = hash(identity.uid, projectId, ruleId || null, kind, input); const freshRuleId = `rule-${hash(projectId, operationId).slice(0, 32)}`;
        return tx(async transaction => {
            await owner(transaction, identity, projectId);
            const previousOperation = data(await transaction.get(operationRef));
            if (previousOperation) { if (previousOperation.requestDigest !== requestDigest) fail('OPERATION_CONFLICT', 'Operation ID already belongs to another request.', 409); return previousOperation.result; }
            const original = kind === 'create' ? null : await readRule(transaction, projectId, ruleId);
            if (original && (!Number.isInteger(input.expectedRevision) || original.revision !== input.expectedRevision)) fail('STALE_REVISION', 'Automation changed; refresh before editing.', 409);
            let rule = original ? { ...original } : { ruleId: freshRuleId, projectId, title: string(input.title), folder: input.folder ? string(input.folder) : '', enabled: false, revision: 0, disabledGeneration: 0, createdAt: iso(now) };
            const registry = data(await transaction.get(ref(db, 'registries', projectId))) || { projectId, versions: [], revision: 0 };
            let version = null;
            if (kind === 'patch') {
                if (input.enabled !== undefined && input.enabled !== false) fail('PREVIEW_REQUIRED', 'Activation requires a version preview.');
                if (input.title !== undefined) rule.title = string(input.title);
                if (input.folder !== undefined) rule.folder = input.folder === '' ? '' : string(input.folder);
                if (input.enabled === false) { rule.enabled = false; rule.disabledGeneration += 1; }
            }
            if (['create', 'versions', 'duplicate'].includes(kind)) {
                let definition = input.definition;
                if (kind === 'duplicate') { const source = await readVersion(transaction, projectId, ruleId, original.currentVersion); definition = source.definition; rule = { ...rule, ruleId: freshRuleId, title: `${rule.title.slice(0, 190)} (copy)`, revision: 0, disabledGeneration: 0, activatedAt: null, createdAt: iso(now) }; }
                const actorUid = kind === 'versions' ? uid(input.actorUid || identity.uid) : identity.uid;
                const validated = await validateReferences(transaction, { db, accessService, projectId, definition, actorUid });
                const versionId = `version-${hash(projectId, operationId, rule.ruleId).slice(0, 32)}`;
                version = { versionId, ruleId: rule.ruleId, projectId, actorUid, definition: validated.definition, digest: hash(validated.definition), createdAt: iso(now), createdBy: identity.uid };
                if (kind === 'versions' && rule.enabled) rule.candidateVersion = versionId;
                else { rule.currentVersion = versionId; rule.candidateVersion = null; rule.enabled = false; }
            }
            if (kind === 'activate') {
                if (!isProjectsFeatureEnabled('automations')) fail('AUTOMATIONS_DISABLED', 'Automations are disabled.', 409);
                version = await readVersion(transaction, projectId, ruleId, input.versionId);
                const preview = data(await transaction.get(ref(db, 'previews', hash(input.previewToken))));
                if (!preview || preview.actorUid !== identity.uid || preview.ruleId !== ruleId || preview.versionId !== version.versionId || Date.parse(preview.expiresAt) <= new Date(now()).getTime()) fail('STALE_PREVIEW', 'Preview expired or does not match this version.', 409);
                const validated = await validateReferences(transaction, { db, accessService, projectId, definition: version.definition, actorUid: version.actorUid, sampleTaskId: preview.sampleTaskId });
                if (preview.digest !== version.digest || preview.referenceDigest !== validated.referenceDigest || preview.ruleRevision !== original.revision) fail('STALE_PREVIEW', 'Definition or references changed; preview again.', 409);
                rule.enabled = true; rule.currentVersion = version.versionId; rule.candidateVersion = null; rule.activatedAt = iso(now);
            }
            rule.revision += 1; rule.updatedAt = iso(now); rule.updatedBy = identity.uid;
            let versions = registry.versions.filter(v => v.ruleId !== rule.ruleId);
            if (rule.enabled) { const activeVersion = version?.versionId === rule.currentVersion ? version : await readVersion(transaction, projectId, rule.ruleId, rule.currentVersion); versions.push({ ruleId: rule.ruleId, versionId: activeVersion.versionId, actorUid: activeVersion.actorUid, trigger: activeVersion.definition.trigger, activatedAt: rule.activatedAt, disabledGeneration: rule.disabledGeneration }); }
            if (versions.length > 100) fail('AUTOMATION_LIMIT', 'At most 100 active rules per project.');
            const result = { rule, ...(version ? { version } : {}) };
            if (version && kind !== 'activate') transaction.create(ref(db, 'versions', version.versionId), version);
            transaction.set(ref(db, 'rules', rule.ruleId), rule);
            transaction.set(ref(db, 'registries', projectId), { projectId, revision: registry.revision + 1, versions });
            if (dueRegistrySignature(registry.versions) !== dueRegistrySignature(versions)) enqueueRebuild(transaction, db, projectId, now);
            transaction.create(operationRef, { operationId, projectId, actorUid: identity.uid, command: `automation_${kind}`, requestDigest, result, createdAt: iso(now) });
            return result;
        });
    }
    async function preview(identity, projectId, ruleId, input) {
        strict(input, ['versionId', 'sampleTaskId']); id(input.sampleTaskId); const previewToken = crypto.randomBytes(32).toString('base64url');
        return tx(async transaction => {
            await owner(transaction, identity, projectId); const rule = await readRule(transaction, projectId, ruleId); const version = await readVersion(transaction, projectId, ruleId, input.versionId);
            const value = await validateReferences(transaction, { db, accessService, projectId, definition: version.definition, actorUid: version.actorUid, sampleTaskId: input.sampleTaskId });
            const { effects, warnings, conditionMatched } = value.projection;
            const expiresAt = new Date(new Date(now()).getTime() + 15 * 60000).toISOString();
            transaction.set(ref(db, 'previews', hash(previewToken)), { actorUid: identity.uid, projectId, ruleId, versionId: version.versionId, digest: version.digest, ruleRevision: rule.revision, referenceDigest: value.referenceDigest, sampleTaskId: input.sampleTaskId, expiresAt });
            return { versionId: version.versionId, digest: version.digest, effects, warnings, conditionMatched, brokenReferences: [], previewToken, expiresAt };
        });
    }
    async function get(identity, projectId, ruleId, versionId) { return tx(async transaction => { await owner(transaction, identity, projectId); const rule = await readRule(transaction, projectId, ruleId); const version = await readVersion(transaction, projectId, ruleId, versionId || rule.candidateVersion || rule.currentVersion); let diagnostics = []; try { await validateReferences(transaction, { db, accessService, projectId, definition: version.definition, actorUid: version.actorUid }); } catch (error) { if (!error.status) throw error; diagnostics = [{ code: error.code, message: 'Automation references or designated actor require repair.' }]; } return { rule, version, diagnostics }; }); }
    async function list(identity, projectId, options = {}, kind = 'rules', ruleId = null) {
        const limit = pageSize(options.pageSize); const filters = kind === 'rules' ? normalizeListFilters(options) : null;
        if (kind !== 'rules') strict(options, ['pageSize', 'cursor']);
        const scope = [identity.uid, projectId, kind, ruleId, filters]; const after = cursor(options.cursor, scope);
        return tx(async transaction => {
            await owner(transaction, identity, projectId); if (ruleId) await readRule(transaction, projectId, ruleId);
            let query = db.collection(COLLECTIONS[kind]).where('projectId', '==', projectId);
            if (ruleId) query = query.where('ruleId', '==', ruleId);
            query = query.orderBy('__name__'); if (after) query = query.startAfter(after);
            const scanLimit = kind === 'rules' ? 200 : limit;
            const snapshot = await transaction.get(query.limit(scanLimit + 1));
            const items = []; let scanned = 0; let lastId = null;
            for (const document of snapshot.docs.slice(0, scanLimit)) {
                scanned += 1; lastId = document.id; const record = document.data();
                if (filters && !matchesListFilters(record, filters)) continue;
                if (kind === 'rules') {
                    const draftId = record.candidateVersion || record.currentVersion;
                    const active = record.enabled ? data(await transaction.get(ref(db, 'versions', record.currentVersion))) : null;
                    const draft = record.enabled && draftId === record.currentVersion ? active : data(await transaction.get(ref(db, 'versions', draftId)));
                    const actor = version => version?.ruleId === document.id && version.projectId === projectId ? version.actorUid : null;
                    items.push({ ...record, activeActorUid: actor(active), draftActorUid: actor(draft), activeTrigger: actor(active) ? active.definition?.trigger || null : null, validationState: 'not_checked' });
                } else items.push(record);
                if (items.length === limit) break;
            }
            const hasMore = snapshot.docs.length > scanned;
            return { items, hasMore, nextCursor: hasMore && lastId ? encodeCursor(lastId, scope) : null };
        });
    }
    async function run(identity, projectId, runId) { return tx(async transaction => { await owner(transaction, identity, projectId); const value = data(await transaction.get(ref(db, 'runs', runId))); if (!value || value.projectId !== projectId) fail('RUN_NOT_FOUND', 'Run not found.', 404); const logs = await transaction.get(db.collection(COLLECTIONS.journals).where('runId', '==', runId).limit(65)); return { run: value, actions: logs.docs.map(d => d.data()) }; }); }
    return { create: (i, p, v) => mutate(i, p, null, v, 'create'), patch: (i, p, r, v) => mutate(i, p, r, v, 'patch'), appendVersion: (i, p, r, v) => mutate(i, p, r, v, 'versions'), activate: (i, p, r, v) => mutate(i, p, r, v, 'activate'), duplicate: (i, p, r, v) => mutate(i, p, r, v, 'duplicate'), preview, get, list, run };
}
module.exports = { createAutomationRuleService, normalizeListFilters, matchesListFilters };
