'use strict';

const collections = require('../collections');
const identityFields = 'name label crmId phone email zalo facebook facebookProfileUrl facebookPersonalOwner';
const kinds = Object.freeze({
    agentSource: { collection: collections.CRM_AGENT_SOURCES, search: 'name', fields: 'name status' },
    teacher: { collection: collections.USERS, search: 'displayName name email', fields: 'displayName name email' },
    lead: { collection: collections.CRM_LEADS, search: 'name label crmId phone email', fields: `${identityFields} source agentSourceId stage studentId notes learningNeeds dateOfBirth preferredLearningDays preferredLearningHours` },
    student: { collection: collections.CRM_STUDENTS, search: 'name label crmId phone email', fields: `${identityFields} acquisitionSource agentSourceId leadId notes preferredLearningDays preferredLearningHours` },
    course: { collection: collections.CRM_COURSES, search: 'name', fields: 'name courseType durationDays sessionCount totalSessions fee currency status' },
    classroom: { collection: collections.CRM_CLASSROOMS, search: 'name', fields: 'name courseId teacherUid startDate endDate status timezone' },
    enrollment: { collection: collections.CRM_ENROLLMENTS, search: 'studentId classId', fields: 'studentId classId courseId startDate endDate status notes' },
    invoice: { collection: collections.CRM_INVOICES, search: 'studentId enrollmentId', fields: 'studentId enrollmentId courseId amount totalAmount paidAmount balance currency status dueDate' }
});
const nestedFields = Object.freeze({
    learningProfile: 'overall listening reading speaking writing entryLevel testResultDueDate visaType targetLevel',
    targets: 'exam score'
});
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const MAX_RESULTS = 20;

function error(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function validKeys(value, keys) { return plain(value) && Object.keys(value).every(key => keys.includes(key)); }
function validate(input) {
    if (!validKeys(input, ['actorUid', 'kind', 'id', 'match']) || typeof input.actorUid !== 'string' || !idPattern.test(input.actorUid)
        || typeof input.kind !== 'string' || !Object.hasOwn(kinds, input.kind)) throw error('INVALID_LOOKUP', 'Invalid context lookup.');
    const definition = kinds[input.kind];
    if (Object.hasOwn(input, 'id')) {
        if (typeof input.id !== 'string' || !idPattern.test(input.id) || Object.hasOwn(input, 'match')) throw error('INVALID_LOOKUP', 'Choose one record lookup.');
    } else {
        if (!validKeys(input.match, ['field', 'value']) || !definition.search.split(' ').includes(input.match.field)
            || typeof input.match.value !== 'string' || !input.match.value.trim() || input.match.value.length > 128) throw error('INVALID_LOOKUP', 'Choose a supported exact match field and value.');
    }
    return definition;
}

function mapContext(kind, snapshot) {
    const data = snapshot.data() || {}, values = {}, truncatedFields = [];
    const version = snapshot.updateTime;
    if (!version || !Number.isSafeInteger(version.seconds) || !Number.isInteger(version.nanoseconds)
        || version.nanoseconds < 0 || version.nanoseconds >= 1e9) throw error('CONTEXT_VERSION_UNAVAILABLE', 'Record version is unavailable; reload context.', 409);
    function scalar(value, field) {
        if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
        if (typeof value !== 'string') return undefined;
        if (value.length > 8000) { truncatedFields.push(field); return value.slice(0, 8000); }
        return value;
    }
    for (const field of kinds[kind].fields.split(' ')) {
        const raw = data[field];
        const value = Array.isArray(raw) && ['preferredLearningDays', 'preferredLearningHours'].includes(field)
            ? raw.slice(0, 32).map(item => scalar(item, field)).filter(item => item !== undefined)
            : scalar(raw, field);
        if (Array.isArray(raw) && raw.length > 32 && ['preferredLearningDays', 'preferredLearningHours'].includes(field)) truncatedFields.push(field);
        if (value !== undefined) values[field] = value;
    }
    if (kind === 'lead' || kind === 'student') {
        for (const [field, allowed] of Object.entries(nestedFields)) {
            if (!plain(data[field])) continue;
            const nested = {};
            for (const key of allowed.split(' ')) {
                const value = scalar(data[field][key], `${field}.${key}`);
                if (value !== undefined) nested[key] = value;
            }
            values[field] = nested;
        }
    }
    if (kind === 'student' && plain(data.contacts)) {
        values.contacts = {};
        for (const group of ['guardians', 'companies']) {
            const entries = data.contacts[group];
            if (entries === undefined) continue;
            if (!Array.isArray(entries)) { truncatedFields.push(`contacts.${group}`); continue; }
            if (entries.length > 20) truncatedFields.push(`contacts.${group}`);
            values.contacts[group] = entries.slice(0, 20).map((entry, index) => {
                const contact = {};
                if (!plain(entry)) { truncatedFields.push(`contacts.${group}`); return contact; }
                for (const key of ['name', 'phone', 'email']) {
                    const value = scalar(entry[key], `contacts.${group}.${index}.${key}`);
                    if (value === null || typeof value === 'string') contact[key] = value;
                    else if (entry[key] !== undefined) truncatedFields.push(`contacts.${group}`);
                }
                return contact;
            });
        }
    }
    // Context is advisory untrusted data, never a substitute for transaction reads.
    return { kind, id: snapshot.id, version: { seconds: version.seconds, nanoseconds: version.nanoseconds }, trust: 'untrusted-record-data', values, truncatedFields: [...new Set(truncatedFields)] };
}

/** Inject current CRM admission and record-access checks; no default grants. */
function createContextService({ db, authorize, authorizeRecord }) {
    if (!db || typeof authorize !== 'function' || typeof authorizeRecord !== 'function') throw new TypeError('Context requires database and explicit authorization adapters.');
    return { async resolve(input) {
        const definition = validate(input);
        const { actorUid, kind } = input;
        if (await authorize({ actorUid, feature: 'crm-data-input' }) !== true) throw error('FORBIDDEN', 'CRM data input access is required.', 403);
        const collection = db.collection(definition.collection);
        const result = Object.hasOwn(input, 'id')
            ? { docs: [await collection.doc(input.id).get()] }
            : await collection.where(input.match.field, '==', input.match.value.trim()).limit(MAX_RESULTS + 1).get();
        const candidates = [];
        for (const snapshot of result.docs) {
            if (!snapshot.exists) continue;
            const data = snapshot.data() || {};
            if (kind === 'agentSource' && !Object.hasOwn(input, 'id') && (data.status || 'active') !== 'active') continue;
            // A users record is teacher context only while its current role qualifies.
            // Do not expose general account data through this lookup surface.
            if (kind === 'teacher' && (data.disabled === true || !(data.isTeacher === true || data.crmRole === 'teacher'))) continue;
            if (data.deletedAt || await authorizeRecord({ actorUid, kind, id: snapshot.id, data }) !== true) continue;
            candidates.push(mapContext(kind, snapshot));
        }
        candidates.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        if (!candidates.length) return { status: 'not_found', candidates: [] };
        if (!Object.hasOwn(input, 'id') && result.docs.length > MAX_RESULTS) return { status: 'refine_query', candidates: candidates.slice(0, MAX_RESULTS) };
        if (candidates.length !== 1) return { status: 'ambiguous', candidates };
        return { status: 'resolved', record: candidates[0] };
    } };
}

/** Calendar-only dates remain local days; locale-relative input requires clarification. */
function parseCalendarDate(input) {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return { status: 'needs_clarification' };
    const [year, month, day] = input.split('-').map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1) return { status: 'needs_clarification' };
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { status: 'needs_clarification' };
    return { status: 'resolved', value: input };
}

module.exports = { createContextService, parseCalendarDate, NESTED_CONTEXT_FIELDS: nestedFields };
