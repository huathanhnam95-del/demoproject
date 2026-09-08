'use strict';

const crypto = require('crypto');

const ALLOWED_COLUMN_TYPES = Object.freeze(['text', 'number', 'date', 'people', 'status', 'priority', 'dropdown']);
const STATUS_KEYS = Object.freeze(['not_started', 'in_progress', 'blocked', 'done']);
const MAX_TEXT = 5000;
const MAX_LABEL = 200;
const MAX_OPTIONS = 100;
const MAX_ASSIGNEES = 50;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class DomainError extends Error {
    constructor(status, code, message, details = null) {
        super(message);
        this.name = 'ProjectsDomainError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function reject(status, code, message, details = null) {
    throw new DomainError(status, code, message, details);
}

function text(value, max = MAX_TEXT) {
    if (typeof value !== 'string') return '';
    const result = value.trim();
    if (!result || result.length > max || Array.from(result).some((character) => {
        const code = character.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
    })) return '';
    return result;
}

function id(value, label = 'ID') {
    const result = text(value, 128);
    if (!result || result === '.' || result === '..' || result.includes('/') || result.includes('\\') || RESERVED_RECORD_KEYS.has(result) || /^__.*__$/.test(result)) {
        reject(400, `INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`, `${label} is invalid.`);
    }
    return result;
}

function safeColumnId(value, label = 'column ID') {
    const result = id(value, label);
    return result;
}

function optionalId(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return id(value, label);
}

function uid(value, label = 'UID') {
    const result = text(value, 128);
    if (!result || result.includes('/') || result.includes('\\')) {
        reject(400, `INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`, `${label} is invalid.`);
    }
    return result;
}

function assertPlainObject(value, code, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject(400, code, message);
    return value;
}

function canonicalize(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(canonicalize);
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) Object.defineProperty(result, key, {
        value: canonicalize(value[key]), enumerable: true, writable: true, configurable: true
    });
    return result;
}

function setOwn(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
    return target;
}

function copyOwnRecord(value) {
    const result = {};
    for (const key of Object.keys(value || {})) setOwn(result, key, value[key]);
    return result;
}

function digestPayload(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function operationId(value) { return id(value, 'operationId'); }

function validateProjectInput(raw = {}) {
    assertPlainObject(raw, 'INVALID_PROJECT', 'Project payload must be an object.');
    if (Object.keys(raw).some((key) => !['name', 'title', 'description', 'crmLinks', 'links'].includes(key))) reject(400, 'INVALID_PROJECT', 'Project payload contains an unsupported field.');
    const name = text(raw.name ?? raw.title, 200);
    if (!name) reject(400, 'INVALID_PROJECT', 'Project name is required.');
    const result = { name };
    if (raw.description !== undefined) {
        const description = text(raw.description, 20000);
        if (!description && raw.description !== '') reject(400, 'INVALID_PROJECT', 'Project description is invalid.');
        result.description = description;
    }
    if (raw.crmLinks !== undefined || raw.links !== undefined) {
        const links = raw.crmLinks ?? raw.links;
        if (!Array.isArray(links) || links.length > 50) reject(400, 'INVALID_PROJECT_LINKS', 'Project links are invalid.');
        result.crmLinks = links.map((link) => {
            assertPlainObject(link, 'INVALID_PROJECT_LINKS', 'Project links are invalid.');
            const module = text(link.module || link.type, 100);
            const recordId = text(link.recordId || link.id, 200);
            if (!module || !recordId) reject(400, 'INVALID_PROJECT_LINKS', 'Project links require a module and record ID.');
            const normalized = { module, recordId };
            if (link.type !== undefined) normalized.type = text(link.type, 100) || module;
            if (link.label !== undefined) {
                normalized.label = text(link.label, 200);
                if (!normalized.label) reject(400, 'INVALID_PROJECT_LINKS', 'Project link label is invalid.');
            }
            return normalized;
        });
    }
    return result;
}

function validateSectionInput(raw = {}) {
    assertPlainObject(raw, 'INVALID_SECTION', 'Section payload must be an object.');
    if (Object.keys(raw).some((key) => !['title', 'name'].includes(key))) reject(400, 'INVALID_SECTION', 'Section payload contains an unsupported field.');
    const title = text(raw.title ?? raw.name, 200);
    if (!title) reject(400, 'INVALID_SECTION', 'Section title is required.');
    return { title };
}

function normalizeOptions(options) {
    if (options === undefined) return undefined;
    if (!Array.isArray(options) || options.length > MAX_OPTIONS || options.length === 0) {
        reject(400, 'INVALID_COLUMN_OPTIONS', 'Dropdown options are invalid.');
    }
    const keys = new Set();
    const result = options.map((option) => {
        assertPlainObject(option, 'INVALID_COLUMN_OPTIONS', 'Dropdown options are invalid.');
        const key = text(option.key, 80);
        const label = text(option.label, MAX_LABEL);
        if (!key || !label || keys.has(key)) reject(400, 'INVALID_COLUMN_OPTIONS', 'Dropdown option keys must be unique.');
        keys.add(key);
        return { key, label };
    });
    return result;
}

function validateColumnInput(raw = {}) {
    assertPlainObject(raw, 'INVALID_COLUMN', 'Column payload must be an object.');
    const type = text(raw.type, 40).toLowerCase();
    if (!ALLOWED_COLUMN_TYPES.includes(type)) reject(400, 'INVALID_COLUMN_TYPE', 'Column type is not supported.');
    const label = text(raw.label ?? raw.name, MAX_LABEL);
    if (!label) reject(400, 'INVALID_COLUMN', 'Column label is required.');
    const result = { type, label };
    const options = normalizeOptions(raw.options);
    if (type === 'dropdown' && !options) reject(400, 'INVALID_COLUMN_OPTIONS', 'Dropdown columns require options.');
    if (options) result.options = options;
    if (raw.statusLabels !== undefined) {
        assertPlainObject(raw.statusLabels, 'INVALID_STATUS_LABELS', 'Status labels are invalid.');
        const labels = {};
        for (const key of STATUS_KEYS) {
            if (raw.statusLabels[key] !== undefined) {
                labels[key] = text(raw.statusLabels[key], MAX_LABEL);
                if (!labels[key]) reject(400, 'INVALID_STATUS_LABELS', 'Status labels are invalid.');
            }
        }
        result.statusLabels = labels;
    }
    return result;
}

function normalizeDate(value, label = 'date') {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) reject(400, 'INVALID_DATE', `${label} must be an ISO calendar date.`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) reject(400, 'INVALID_DATE', `${label} must be an ISO calendar date.`);
    return value;
}

function normalizeStatus(value) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !STATUS_KEYS.includes(value)) reject(400, 'INVALID_STATUS', 'Task status is invalid.');
    return value;
}

function validateStatusLabels(raw) {
    if (raw === undefined) return undefined;
    assertPlainObject(raw, 'INVALID_STATUS_LABELS', 'Status labels must be an object.');
    if (!Object.keys(raw).length) reject(400, 'INVALID_STATUS_LABELS', 'Status labels must include at least one label.');
    const labels = {};
    for (const key of Object.keys(raw)) {
        if (!STATUS_KEYS.includes(key)) reject(400, 'INVALID_STATUS_LABELS', 'Status labels contain an unsupported key.');
        const value = text(raw[key], MAX_LABEL);
        if (!value || !value.trim()) reject(400, 'INVALID_STATUS_LABELS', 'Status labels must be non-empty text.');
        labels[key] = value.trim();
    }
    return labels;
}

function normalizeAssignees(value) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_ASSIGNEES) reject(400, 'INVALID_ASSIGNEES', 'Assignees are invalid.');
    const result = value.map((entry) => uid(entry, 'assignee UID'));
    if (new Set(result).size !== result.length) reject(400, 'INVALID_ASSIGNEES', 'Assignees must be unique.');
    return result;
}

function validateTaskInput(raw = {}) {
    assertPlainObject(raw, 'INVALID_TASK', 'Task payload must be an object.');
    if (Object.keys(raw).some((key) => !['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values'].includes(key))) reject(400, 'INVALID_TASK', 'Task payload contains an unsupported field.');
    const title = text(raw.title, MAX_LABEL);
    if (!title) reject(400, 'INVALID_TASK', 'Task title is required.');
    const result = { title };
    const status = normalizeStatus(raw.status);
    if (status !== undefined) result.status = status;
    if (raw.ownerUid !== undefined) result.ownerUid = raw.ownerUid === null || raw.ownerUid === '' ? null : uid(raw.ownerUid, 'owner UID');
    const assigneeUids = normalizeAssignees(raw.assigneeUids);
    if (assigneeUids !== undefined) result.assigneeUids = assigneeUids;
    for (const key of ['startDate', 'dueDate']) {
        if (raw[key] !== undefined) result[key] = normalizeDate(raw[key], key);
    }
    if (raw.values !== undefined) {
        assertPlainObject(raw.values, 'INVALID_VALUES', 'Task values must be an object.');
        result.values = copyOwnRecord(raw.values);
    }
    return result;
}

function validateTaskPatch(raw = {}) {
    assertPlainObject(raw, 'INVALID_TASK_PATCH', 'Task patch must be an object.');
    const allowed = new Set(['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values', 'lifecycle']);
    if (Object.keys(raw).some((key) => !allowed.has(key))) reject(400, 'INVALID_TASK_PATCH', 'Task patch contains an unsupported field.');
    const result = {};
    if (raw.title !== undefined) {
        result.title = text(raw.title, MAX_LABEL);
        if (!result.title) reject(400, 'INVALID_TASK_PATCH', 'Task title is invalid.');
    }
    const status = normalizeStatus(raw.status);
    if (status !== undefined) result.status = status;
    if (raw.ownerUid !== undefined) result.ownerUid = raw.ownerUid === null || raw.ownerUid === '' ? null : uid(raw.ownerUid, 'owner UID');
    const assigneeUids = normalizeAssignees(raw.assigneeUids);
    if (assigneeUids !== undefined) result.assigneeUids = assigneeUids;
    for (const key of ['startDate', 'dueDate']) {
        if (raw[key] !== undefined) result[key] = normalizeDate(raw[key], key);
    }
    if (raw.values !== undefined) {
        assertPlainObject(raw.values, 'INVALID_VALUES', 'Task values must be an object.');
        result.values = copyOwnRecord(raw.values);
    }
    if (raw.lifecycle !== undefined) {
        if (!['active', 'archived', 'trashed'].includes(raw.lifecycle)) reject(400, 'INVALID_LIFECYCLE', 'Task lifecycle is invalid.');
        result.lifecycle = raw.lifecycle;
    }
    if (Object.keys(result).length === 0) reject(400, 'INVALID_TASK_PATCH', 'Task patch cannot be empty.');
    return result;
}

function validateTypedValues(values = {}, columns = {}) {
    assertPlainObject(values, 'INVALID_VALUES', 'Task values must be an object.');
    const result = {};
    for (const [key, value] of Object.entries(values)) {
        if (RESERVED_RECORD_KEYS.has(key)) reject(400, 'INVALID_VALUE_KEY', `Value key ${key} is reserved.`);
        const column = Object.prototype.hasOwnProperty.call(columns, key) ? columns[key] : null;
        if (!column || column.lifecycle === 'archived') reject(400, 'INVALID_COLUMN_REFERENCE', `Column ${key} is unavailable.`);
        if (value === null || value === undefined || value === '') { setOwn(result, key, null); continue; }
        switch (column.type) {
        case 'text':
            if (typeof value !== 'string' || value.length > MAX_TEXT) reject(400, 'INVALID_TEXT', `Value for ${key} is invalid.`);
            setOwn(result, key, value);
            break;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) reject(400, 'INVALID_NUMBER', `Value for ${key} is invalid.`);
            setOwn(result, key, value);
            break;
        case 'date':
            setOwn(result, key, normalizeDate(value, key));
            break;
        case 'people':
            setOwn(result, key, Array.isArray(value) ? normalizeAssignees(value) : [uid(value, 'people UID')]);
            break;
        case 'status':
            setOwn(result, key, normalizeStatus(value));
            break;
        case 'priority':
            if (typeof value !== 'string' || !['none', 'low', 'medium', 'high', 'urgent'].includes(value)) reject(400, 'INVALID_PRIORITY', `Value for ${key} is invalid.`);
            setOwn(result, key, value);
            break;
        case 'dropdown':
            if (!Array.isArray(column.options) || !column.options.some((option) => option.key === value)) reject(400, 'INVALID_OPTION', `Value for ${key} is not an available option.`);
            setOwn(result, key, value);
            break;
        default:
            reject(400, 'INVALID_COLUMN_TYPE', `Column ${key} has an invalid type.`);
        }
    }
    return result;
}

module.exports = {
    ALLOWED_COLUMN_TYPES,
    STATUS_KEYS,
    DomainError,
    canonicalize,
    digestPayload,
    operationId,
    validateProjectInput,
    validateSectionInput,
    validateColumnInput,
    validateTaskInput,
    validateTaskPatch,
    validateStatusLabels,
    validateTypedValues,
    safeColumnId,
    RESERVED_RECORD_KEYS,
    normalizeDate,
    uid,
    id
};
