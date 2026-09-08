'use strict';
const { ref, data, fail } = require('./store');
const { writeSchedule, enqueueRebuild } = require('./due-scheduling');
const { resolveTaskState } = require('../domain/hierarchy');
const SAFE_TASK = ['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'dueGeneration', 'parentTaskId', 'sectionId', 'lifecycle', 'values'];
function taskSnapshot(value) { if (!value) return null; return Object.fromEntries(SAFE_TASK.filter(k => value[k] !== undefined).map(k => [k, value[k]])); }
function dueGeneration(before, after) { if (!before) return 1; const previous = Number.isSafeInteger(before.dueGeneration) ? before.dueGeneration : 1; return (before.dueDate || null) !== (after.dueDate || null) ? previous + 1 : previous; }
async function prepareEventCapture(transaction, db, projectId, contentAccess) {
    const registry = projectId ? data(await transaction.get(ref(db, 'registries', projectId))) : null;
    const versions = registry?.versions || [];
    if (versions.length > 100) fail('AUTOMATION_LIMIT', 'Active registry exceeds limit.', 409);
    const reads = new Map(); const writes = new Map();
    function remember(snapshot) { if (snapshot?.docs) snapshot.docs.forEach(remember); else if (snapshot?.ref?.path) reads.set(snapshot.ref.path, snapshot.exists ? snapshot.data() : null); }
    const projectPath = `crmProjects/${projectId}`;
    if (contentAccess?.project) reads.set(projectPath, contentAccess.project.data);
    if (versions.some(v => v.trigger.type === 'all_direct_children_complete')) {
        for (const collection of ['tasks', 'sections']) {
            const snapshot = await transaction.get(db.collection(`${projectPath}/${collection}`).limit(10001));
            if (snapshot.size > 10000 || snapshot.docs?.length > 10000) fail('AUTOMATION_GRAPH_LIMIT', 'Completion rules support at most 10000 coherent graph records.', 409);
            remember(snapshot);
        }
    }
    const wrapped = new Proxy(transaction, { get(object, property) {
        if (property === 'get') return async (...args) => { const snapshot = await object.get(...args); remember(snapshot); return snapshot; };
        if (['set', 'update', 'create'].includes(property)) return (document, value, ...options) => {
            const path = document.path; const before = reads.get(path); const earlier = writes.get(path);
            if (path.startsWith(`${projectPath}/tasks/`) && (options[0]?.mergeFields || Object.keys(value).some(key => key.includes('.')))) fail('SEMANTIC_WRITE_SHAPE', 'Task writes require explicit complete fields for semantic capture.', 409);
            const merged = property === 'update' || options[0]?.merge ? { ...(earlier || before || {}), ...value } : { ...value };
            if (path.startsWith(`${projectPath}/tasks/`) && path.split('/').length === 4) {
                if (before === undefined && property !== 'create') {
                    // Creation paths already read their task collection; absent IDs
                    // are known absent in that transaction's query snapshot.
                    if (merged.revision !== 1) fail('SEMANTIC_CAPTURE_MISSING', 'Task mutation lacks its before snapshot.', 409);
                }
                merged.dueGeneration = dueGeneration(before, merged);
                value = { ...value, dueGeneration: merged.dueGeneration };
            }
            writes.set(path, merged); return object[property](document, value, ...options);
        };
        const value = object[property]; return typeof value === 'function' ? value.bind(object) : value;
    } });
    function finish() {
        const changes = []; const discussions = [];
        let rebuild = false;
        for (const [path, after] of writes) {
            const before = reads.get(path);
            const parts = path.split('/');
            if (path === projectPath && before && before.lifecycle !== after.lifecycle) rebuild = true;
            if (parts.length !== 4 || parts[0] !== 'crmProjects' || parts[1] !== projectId) continue;
            if (parts[2] === 'sections' && before && before.lifecycle !== after.lifecycle) rebuild = true;
            if (parts[2] !== 'tasks') continue;
            if (!before || (before.dueDate || null) !== (after.dueDate || null)) writeSchedule(transaction, db, projectId, parts[3], after, registry);
            if (before && ['lifecycle', 'parentTaskId', 'sectionId'].some(key => (before[key] || null) !== (after[key] || null))) rebuild = true;
        }
        if (rebuild) {
            const changed = [...writes.values()].find(value => value.updatedAt);
            enqueueRebuild(transaction, db, projectId, () => changed?.updatedAt || new Date());
        }
        for (const [path, after] of writes) {
            const before = reads.get(path) || null; const parts = path.split('/');
            if (parts.length !== 4 || parts[0] !== 'crmProjects' || parts[1] !== projectId) continue;
            if (parts[2] === 'tasks') { const a = taskSnapshot(before); const b = taskSnapshot(after); if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ taskId: parts[3], before: a, after: b }); }
            if (parts[2] === 'discussions') {
                const parent = after.parentMessageId ? reads.get(`${projectPath}/discussions/${after.parentMessageId}`) : null;
                const task = writes.get(`${projectPath}/tasks/${after.taskId}`) || reads.get(`${projectPath}/tasks/${after.taskId}`);
                discussions.push({ messageId: parts[3], taskId: after.taskId, authorUid: after.authorUid, beforeMentions: before?.mentions || [], mentions: after.mentions || [], created: !before, replyAuthorUid: parent?.authorUid || null, ownerUid: task?.ownerUid || null, assigneeUids: task?.assigneeUids || [], visible: after.moderationState === 'visible' });
            }
        }
        const completions = [];
        if (versions.some(v => v.trigger.type === 'all_direct_children_complete')) {
            const build = useAfter => {
                const records = new Map(reads); if (useAfter) for (const entry of writes) records.set(...entry);
                const tasks = new Map(); const sections = new Map();
                for (const [path, value] of records) { const p = path.split('/'); if (p.length === 4 && p[1] === projectId && value) { if (p[2] === 'tasks') tasks.set(p[3], { id: p[3], data: value }); if (p[2] === 'sections') sections.set(p[3], { id: p[3], data: value }); } }
                const complete = new Set(); const childGroups = new Map(); const project = records.get(projectPath);
                for (const row of tasks.values()) {
                    if (!row.data.parentTaskId) continue;
                    if (resolveTaskState({ tasks, taskId: row.id, sections, projectLifecycle: project?.lifecycle }).lifecycle !== 'active') continue;
                    const group = childGroups.get(row.data.parentTaskId) || []; group.push(row); childGroups.set(row.data.parentTaskId, group);
                }
                for (const [parent, children] of childGroups) if (children.length && children.every(c => c.data.status === 'done')) complete.add(parent);
                return { complete, tasks };
            };
            const before = build(false); const after = build(true);
            for (const taskId of after.complete) if (!before.complete.has(taskId)) completions.push({ taskId, snapshot: taskSnapshot(after.tasks.get(taskId).data) });
        }
        const semantic = { schemaVersion: 1, changes, discussions, completions, ruleVersions: versions };
        if (Buffer.byteLength(JSON.stringify(semantic)) > 800000) fail('SEMANTIC_EVENT_LIMIT', 'Semantic event exceeds bounded storage.', 413);
        return semantic;
    }
    return { transaction: wrapped, finish };
}
module.exports = { prepareEventCapture, taskSnapshot, dueGeneration };
