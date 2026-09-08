'use strict';

const { createHash } = require('crypto');
const { isDeepStrictEqual } = require('node:util');
const { parseCalendarDate } = require('./context-service');

const LIMITS = Object.freeze({ actions: 25, bytes: 65536, string: 32000, depth: 8, ttlMs: 86400000 });
const studentFields = 'name label email phone zalo facebook facebookProfileUrl facebookPersonalOwner acquisitionSource agentSourceId notes learningProfile targets preferredSchedule preferredLearningDays preferredLearningHours contacts counselingNotes dateOfBirth gender';
const leadFields = 'name email phone zalo facebook facebookProfileUrl facebookPersonalOwner source agentSourceId stage probability nextActionAt notes learningProfile targets preferredLearningDays preferredLearningHours learningNeeds dateOfBirth gender';
const DEFINITIONS = Object.freeze({
    createLead: { fields: leadFields, outputs: ['leadId'], required: ['source'] },
    updateLead: { fields: `leadId ${leadFields}`, outputs: ['leadId'], required: ['leadId'] },
    createStudent: { fields: studentFields, outputs: ['studentId'], required: [] },
    updateStudent: { fields: `studentId ${studentFields}`, outputs: ['studentId'], required: ['studentId'] },
    convertLead: { fields: 'leadId', outputs: ['leadId', 'studentId'], required: ['leadId'] },
    createEntranceTest: { fields: 'leadId studentId testType', outputs: ['testId'], required: ['testType'] },
    createEnrollment: { fields: 'studentId classId courseId teacherUid startDate endDate timezone slots notes', outputs: ['enrollmentId', 'classId'], required: ['studentId'] },
    seedClassSchedule: { fields: 'classId teacherUid startDate endDate weekdayNumbers startTime', outputs: ['classId'], required: ['classId', 'startDate', 'weekdayNumbers', 'startTime'] },
    createInvoice: { fields: 'studentId enrollmentId courseId amount discount dueDate notes currency', outputs: ['invoiceId'], required: ['studentId', 'amount'] },
    recordPayment: { fields: 'studentId invoiceId enrollmentId amount method paidAt notes reference currency', outputs: ['paymentId'], required: ['studentId', 'invoiceId', 'amount'] }
});
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;

function fail(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function copy(value, depth = 0) {
    if (depth > LIMITS.depth) fail('DRAFT_LIMIT', 'Draft depth limit exceeded.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        if (value.length > LIMITS.string) fail('DRAFT_LIMIT', 'Draft string limit exceeded.');
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length > 100) fail('DRAFT_LIMIT', 'Draft array limit exceeded.');
        return value.map(item => copy(item, depth + 1));
    }
    if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_VALUE', 'Draft values must be plain JSON.');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (unsafeKeys.has(key)) fail('UNSAFE_FIELD', 'Unsafe draft field.');
        result[key] = copy(item, depth + 1);
    }
    return result;
}
function merge(base, patch) {
    const next = copy(base);
    for (const [key, value] of Object.entries(patch)) {
        next[key] = object(value) && object(next[key]) && !('$ref' in value) && !('$ref' in next[key])
            ? merge(next[key], value) : copy(value);
    }
    return next;
}
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!object(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function assertIdentity(value, label) {
    if (typeof value !== 'string' || !idPattern.test(value)) fail('INVALID_ID', `Invalid ${label}.`);
}
function createDraft({ draftId, actorUid, now = Date.now() }) {
    assertIdentity(draftId, 'draft ID'); assertIdentity(actorUid, 'actor UID');
    if (!Number.isFinite(now)) fail('INVALID_TIME', 'Invalid draft time.');
    return { schemaVersion: 1, draftId, actorUid, feature: 'crm-data-input', revision: 0, status: 'draft', actions: [], preview: null, confirmation: null, createdAtMs: now, updatedAtMs: now, expiresAtMs: now + LIMITS.ttlMs };
}
function sourceRecord(source) {
    if (!object(source) || !['text', 'voice', 'image'].includes(source.kind)) fail('INVALID_SOURCE', 'Invalid input source.');
    assertIdentity(source.messageId, 'source message ID');
    const result = { kind: source.kind, messageId: source.messageId };
    if (source.kind === 'image') { assertIdentity(source.attachmentId, 'source attachment ID'); result.attachmentId = source.attachmentId; }
    return result;
}

// These functions operate on a server-loaded draft. HTTP callers must never
// supply authoritative actor, status, preview or confirmation state themselves.
function applyChanges(draft, changes, source, now = Date.now()) {
    if (!Number.isFinite(now) || now >= draft.expiresAtMs) fail('DRAFT_EXPIRED', 'Draft expired.');
    if (!['draft', 'review'].includes(draft.status)) fail('DRAFT_TERMINAL', `Cannot edit a ${draft.status} draft.`);
    if (changes.expectedRevision !== draft.revision) fail('REVISION_CONFLICT', 'Draft revision changed.');
    const provenance = sourceRecord(source);
    const next = copy(draft);
    const upserts = changes.upserts || [], removals = changes.removals || [];
    if (!Array.isArray(upserts) || !Array.isArray(removals) || upserts.length > LIMITS.actions) fail('DRAFT_LIMIT', 'Draft action limit exceeded.');
    const seen = new Set();
    for (const id of removals) {
        assertIdentity(id, 'action ID');
        if (seen.has(id) || !next.actions.some(action => action.actionId === id)) fail('INVALID_ACTION', 'Unknown or duplicate removed action.');
        seen.add(id);
        next.actions = next.actions.filter(action => action.actionId !== id);
    }
    for (const raw of upserts) {
        const input = copy(raw);
        if (!object(input) || Object.keys(input).some(key => !['actionId', 'kind', 'values'].includes(key))) fail('INVALID_ACTION', 'Invalid action properties.');
        assertIdentity(input.actionId, 'action ID');
        if (seen.has(input.actionId)) fail('INVALID_ACTION', 'Duplicate action change.');
        seen.add(input.actionId);
        let action = next.actions.find(item => item.actionId === input.actionId);
        const kind = input.kind || action?.kind;
        const definition = Object.prototype.hasOwnProperty.call(DEFINITIONS, kind) ? DEFINITIONS[kind] : null;
        if (!definition || (action && action.kind !== kind)) fail('INVALID_ACTION', 'Unsupported or changed action kind.');
        if (!object(input.values)) fail('INVALID_VALUE', 'Action fields must be an object.');
        const allowed = new Set(definition.fields.split(' '));
        if (Object.keys(input.values).some(key => !allowed.has(key))) fail('INVALID_FIELD', 'Unsupported action field.');
        if (!action) { action = { actionId: input.actionId, kind, values: {}, provenance: {} }; next.actions.push(action); }
        // Corrections replace values, but do not erase an image's involvement.
        // Capture legacy field provenance too, before its last image field changes.
        const imageSources = new Set(action.imageSources || []);
        for (const previous of Object.values(action.provenance)) if (previous.kind === 'image') imageSources.add(previous.attachmentId);
        if (provenance.kind === 'image' && Object.keys(input.values).length) imageSources.add(provenance.attachmentId);
        if (imageSources.size) action.imageSources = [...imageSources].sort();
        const merged = merge(action.values, input.values);
        for (const key of Object.keys(input.values)) {
            if (!Object.hasOwn(action.values, key) || !isDeepStrictEqual(action.values[key], merged[key])) action.provenance[key] = { ...provenance };
        }
        action.values = merged;
    }
    if (next.actions.length > LIMITS.actions) fail('DRAFT_LIMIT', 'Draft action limit exceeded.');
    if (Array.isArray(next.interpretationQuestions)) {
        next.interpretationQuestions = next.interpretationQuestions.filter(question => {
            if (removals.includes(question.actionId)) return false;
            if (!question.field) return true;
            const correction = upserts.find(action => action.actionId === question.actionId);
            if (!correction) return true;
            let value = correction.values;
            for (const part of question.field.split('.')) {
                if (!object(value) || !Object.hasOwn(value, part)) return true;
                value = value[part];
                if (value === null) return false;
            }
            return false;
        });
    }
    next.revision += 1; next.updatedAtMs = now; next.status = 'draft'; next.preview = null; next.confirmation = null;
    if (Buffer.byteLength(JSON.stringify(next)) > LIMITS.bytes) fail('DRAFT_LIMIT', 'Draft byte limit exceeded.');
    return next;
}

function empty(value) { return value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length); }
function calendar(value) { return parseCalendarDate(value).status === 'resolved'; }
function explicitDateOrInstant(value) {
    if (calendar(value)) return true;
    if (typeof value !== 'string') return false;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
    return !!match && calendar(match[1]) && !/[+-]14:(?!00)/.test(match[5]) && Number.isFinite(Date.parse(value));
}
function inspectDraft(draft) {
    const questions = [], errors = [], dependencies = new Map(draft.actions.map(action => [action.actionId, new Set()]));
    const byId = new Map(draft.actions.map(action => [action.actionId, action]));
    const question = (actionId, field) => questions.push({ code: 'REQUIRED_FIELD', actionId, field });
    const referenceError = (actionId, field) => errors.push({ code: 'INVALID_REFERENCE', actionId, field });
    function references(value, action, field) {
        if (!value || typeof value !== 'object') return;
        if (object(value) && '$ref' in value) {
            const match = typeof value.$ref === 'string' && /^([a-zA-Z0-9_-]+)\.([a-zA-Z]+Id)$/.exec(value.$ref);
            const target = match && byId.get(match[1]);
            if (Object.keys(value).length !== 1 || !target || !DEFINITIONS[target.kind].outputs.includes(match[2]) || field !== match[2]) referenceError(action.actionId, field);
            else dependencies.get(action.actionId).add(target.actionId);
            return;
        }
        for (const [key, child] of Object.entries(value)) references(child, action, `${field}.${key}`);
    }
    for (const action of draft.actions) {
        const values = action.values, definition = DEFINITIONS[action.kind];
        for (const field of definition.required) if (empty(values[field])) question(action.actionId, field);
        if (action.kind === 'createStudent' && ['name', 'label', 'email', 'phone', 'zalo', 'facebook', 'facebookProfileUrl', 'facebookPersonalOwner'].every(key => empty(values[key]))) question(action.actionId, 'name');
        if (action.kind === 'createEntranceTest' && empty(values.leadId) && empty(values.studentId)) question(action.actionId, 'leadIdOrStudentId');
        if (action.kind === 'createEnrollment' && empty(values.classId)) {
            for (const field of ['courseId', 'startDate', 'slots']) if (empty(values[field])) question(action.actionId, field);
        }
        if (['createInvoice', 'recordPayment'].includes(action.kind) && !empty(values.amount) && (typeof values.amount !== 'number' || !Number.isFinite(values.amount) || values.amount <= 0)) errors.push({ code: 'INVALID_AMOUNT', actionId: action.actionId, field: 'amount' });
        const dates = { dateOfBirth: values.dateOfBirth, startDate: values.startDate, endDate: values.endDate, dueDate: values.dueDate, 'learningProfile.testResultDueDate': values.learningProfile?.testResultDueDate };
        for (const [field, value] of Object.entries(dates)) if (!empty(value) && !calendar(value)) questions.push({ code: 'CLARIFY_DATE', actionId: action.actionId, field });
        for (const field of ['paidAt', 'nextActionAt']) if (!empty(values[field]) && !explicitDateOrInstant(values[field])) questions.push({ code: 'CLARIFY_DATETIME', actionId: action.actionId, field });
        if (calendar(values.startDate) && calendar(values.endDate) && values.endDate < values.startDate) errors.push({ code: 'DATE_ORDER', actionId: action.actionId, field: 'endDate' });
        for (const [field, value] of Object.entries(values)) references(value, action, field);
    }
    const visited = new Set(), active = new Set(), executionOrder = [];
    function visit(id) {
        if (active.has(id)) { errors.push({ code: 'CYCLIC_REFERENCE', actionId: id }); return; }
        if (visited.has(id)) return;
        active.add(id);
        for (const dependency of dependencies.get(id)) visit(dependency);
        active.delete(id); visited.add(id); executionOrder.push(id);
    }
    for (const action of draft.actions) visit(action.actionId);
    for (const question of draft.interpretationQuestions || []) questions.push({ ...question, code: 'MODEL_CLARIFICATION' });
    for (const [lookupIndex, lookup] of (draft.pendingLookups || []).entries()) questions.push({ code: 'RECORD_LOOKUP_REQUIRED', lookupIndex, kind: lookup.kind });
    return { questions, errors, executionOrder, readyForPreview: draft.actions.length > 0 && questions.length === 0 && errors.length === 0 };
}
function digestDraft(draft) {
    const content = { schemaVersion: draft.schemaVersion, draftId: draft.draftId, actorUid: draft.actorUid, feature: draft.feature, revision: draft.revision, expiresAtMs: draft.expiresAtMs, actions: draft.actions, interpretationQuestions: draft.interpretationQuestions || [], pendingLookups: draft.pendingLookups || [] };
    return createHash('sha256').update(JSON.stringify(stable(content))).digest('hex');
}

module.exports = { createDraft, applyChanges, inspectDraft, digestDraft, DEFINITIONS, LIMITS };
