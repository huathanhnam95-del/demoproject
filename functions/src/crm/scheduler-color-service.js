// Shared cosmetic preferences. Booking, attendance and payment records are never mutated.
const COLOR_COLLECTION = 'crmSchedulerColors';
const MAX_RULES = 500;

function fail(status, code, message) {
    const error = new Error(message);
    Object.assign(error, { status, code });
    throw error;
}

function normalizeColor(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
        fail(400, 'INVALID_COLOR', 'Choose a colour in #RRGGBB format.');
    }
    return value.toUpperCase();
}

function revisionOf(value) {
    return Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0;
}

function requireRevision(expected, current) {
    if (!Number.isSafeInteger(expected) || expected < 0) fail(400, 'INVALID_REVISION', 'Refresh the calendar before changing colours.');
    if (expected !== revisionOf(current)) fail(409, 'COLOR_VERSION_MISMATCH', 'Colours were changed by someone else. Refresh and try again.');
}

function sessionStart(session) {
    const value = session?.scheduledStartAtUtc;
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveColor(plan, session) {
    const start = sessionStart(session);
    const rules = Array.isArray(plan?.rules) ? plan.rules : [];
    for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i];
        if (rule.scope === 'all'
            || (rule.scope === 'session' && rule.sessionId === session.sessionId)
            || (rule.scope === 'following' && (rule.sessionId === session.sessionId || (start && start >= rule.fromUtc)))) {
            return rule.color;
        }
    }
    return null;
}

function applyColor(plan, session, payload) {
    requireRevision(payload.expectedRevision, plan);
    const color = normalizeColor(payload.color);
    const scope = payload.scope;
    if (!['session', 'all', 'following'].includes(scope)) fail(400, 'INVALID_SCOPE', 'Choose which sessions to recolour.');
    const fromUtc = sessionStart(session);
    if (scope === 'following' && !fromUtc) fail(400, 'INVALID_SESSION_TIME', 'This session needs a valid scheduled time.');
    let rules = Array.isArray(plan?.rules) ? [...plan.rules] : [];
    if (scope === 'all') rules = [];
    if (scope === 'session') rules = rules.filter((rule) => rule.scope !== 'session' || rule.sessionId !== session.sessionId);
    // Retain older boundaries: their anchor session may subsequently be rescheduled.
    if (rules.length >= MAX_RULES) fail(409, 'COLOR_RULE_LIMIT', 'This class has too many colour exceptions. Apply a colour to all its sessions to reset them.');
    rules.push({ scope, sessionId: session.sessionId, color, ...(scope === 'following' ? { fromUtc } : {}) });
    return { version: 1, revision: revisionOf(plan) + 1, rules };
}

function updateTag(book, payload) {
    requireRevision(payload.expectedRevision, book);
    const color = normalizeColor(payload.color);
    if (!color) fail(400, 'INVALID_COLOR', 'Choose a colour for the tag.');
    if (typeof payload.label !== 'string' || payload.label.trim().length > 40) fail(400, 'INVALID_TAG', 'Use a tag name of up to 40 characters.');
    const tags = { ...(book?.tags || {}) };
    const label = payload.label.trim();
    if (label) tags[color] = label;
    else delete tags[color];
    if (Object.keys(tags).length > 100) fail(400, 'TAG_LIMIT', 'You can save up to 100 colour tags.');
    return { version: 1, revision: revisionOf(book) + 1, tags };
}

function planRef(db, classId) {
    return db.collection(COLOR_COLLECTION).doc(`class_${classId}`);
}

function tagsRef(db) {
    return db.collection(COLOR_COLLECTION).doc('tags');
}

async function loadColors(db, classIds) {
    const ids = [...new Set(classIds)];
    const [book, ...plans] = await Promise.all([
        tagsRef(db).get(), ...ids.map((id) => planRef(db, id).get())
    ]);
    return {
        colorTags: book.exists ? book.data() : { version: 1, revision: 0, tags: {} },
        colorPlans: Object.fromEntries(ids.map((id, index) => [id,
            plans[index].exists ? plans[index].data() : { version: 1, revision: 0, rules: [] }]))
    };
}

module.exports = { COLOR_COLLECTION, normalizeColor, requireRevision, resolveColor, applyColor, updateTag, planRef, tagsRef, loadColors };
