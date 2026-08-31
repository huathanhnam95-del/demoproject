/**
 * vocab-item-model.js — canonical view-model for Vocabulary Book entries.
 *
 * WHY THIS EXISTS
 * The Vocab Book previously had four renderers (the modal table plus three side-panel
 * lists) that each resolved the word text differently, each re-implemented the same
 * two sorts, each hand-wrote the same badge markup, and each carried its own
 * empty-state string. This module is the single place those decisions live, so the
 * side panel and the full list can be driven from one shape.
 *
 * Pure module: no DOM, no globals. Node-testable.
 */

/**
 * The three lists a vocab entry can belong to.
 * @typedef {'bookmarks'|'missed'|'improving'} ListKind
 */

/**
 * Fallback mode labels. The authoritative registry is PRACTICE_LAUNCHER.modes in
 * script.js, reachable at runtime via window.getModeMeta(). This map only covers
 * the modes that actually reach the Vocab Book, and exists so the module stays
 * pure and testable outside a browser.
 */
export const FALLBACK_MODE_LABELS = Object.freeze({
    type: 'Dictate',
    speak: 'Repeat',
    'collo-dictate': 'Collo-dictate',
    rfib: 'Fill in the Blanks',
    notes: 'Notes',
    watch: 'Watch',
    extended: 'Extended Dictation',
    manual: 'Added manually',
    srs: 'Daily Review'
});

/**
 * Empty-state copy. One home for what used to be four literal strings in JS plus
 * three more hardcoded in index.html.
 *
 * NOTE: `bookmarks` is asserted verbatim by scripts/audit/run-a2-auth-admin-audit.js
 * (regex /No bookmarked words yet/i). Do not reword it without updating that audit.
 */
export const EMPTY_STATES = Object.freeze({
    bookmarks: 'No bookmarked words yet',
    missed: 'No frequently missed words',
    improving: 'No improving words yet',
    // Shown when a search/filter excludes everything, as opposed to an empty book.
    noMatches: 'No words match your filters'
});

/** Part-of-speech values that carry no information and should not be rendered. */
const UNKNOWN_POS = new Set(['', 'unknown', '-', 'null', 'undefined']);

/**
 * Resolve the display text for an entry.
 * Bookmarks store `word`; frequentlyMissed/usedToMiss store `originalWord`.
 * @param {object} raw
 * @returns {string}
 */
export function resolveWordText(raw) {
    if (!raw) return '';
    return String(raw.word || raw.originalWord || '').trim();
}

/**
 * Normalise part of speech to a label or null. Never returns the placeholder '-'
 * that the old table printed for roughly half its rows.
 * @param {object} raw
 * @returns {string|null}
 */
export function resolvePartOfSpeech(raw) {
    const pos = String(raw?.partOfSpeech ?? '').trim().toLowerCase();
    if (UNKNOWN_POS.has(pos)) return null;
    return pos;
}

/**
 * Human label for the practice mode an entry came from.
 * @param {string} mode
 * @param {(mode: string) => ({label?: string}|null)} [resolveModeMeta]
 *   Optional injection of window.getModeMeta, so the browser gets the
 *   authoritative registry while tests stay pure.
 * @returns {string|null}
 */
export function resolveModeLabel(mode, resolveModeMeta) {
    const key = String(mode ?? '').trim();
    if (!key || key === '-') return null;

    if (typeof resolveModeMeta === 'function') {
        try {
            const label = resolveModeMeta(key)?.label;
            if (label) return String(label);
        } catch (_) {
            // Registry unavailable — fall through to the local map.
        }
    }

    return FALLBACK_MODE_LABELS[key] || key;
}

/**
 * Relative "added" label, e.g. "Added 3 weeks ago".
 * @param {string|Date|null} addedAt
 * @param {Date} [now]
 * @returns {string|null}
 */
export function formatAddedLabel(addedAt, now = new Date()) {
    if (!addedAt) return null;
    const date = addedAt instanceof Date ? addedAt : new Date(addedAt);
    if (Number.isNaN(date.getTime())) return null;

    const seconds = Math.max(0, Math.floor((now - date) / 1000));
    const days = Math.floor(seconds / 86400);

    if (seconds < 60) return 'Added just now';
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        return `Added ${m} minute${m === 1 ? '' : 's'} ago`;
    }
    if (days < 1) {
        const h = Math.floor(seconds / 3600);
        return `Added ${h} hour${h === 1 ? '' : 's'} ago`;
    }
    if (days === 1) return 'Added yesterday';
    if (days < 7) return `Added ${days} days ago`;
    if (days < 30) {
        const w = Math.floor(days / 7);
        return `Added ${w} week${w === 1 ? '' : 's'} ago`;
    }
    if (days < 365) {
        const mo = Math.floor(days / 30);
        return `Added ${mo} month${mo === 1 ? '' : 's'} ago`;
    }
    const y = Math.floor(days / 365);
    return `Added ${y} year${y === 1 ? '' : 's'} ago`;
}

/** Absolute short date, matching the old table's en-GB "07 Jan 26" format. */
export function formatShortDate(addedAt) {
    if (!addedAt) return null;
    const date = addedAt instanceof Date ? addedAt : new Date(addedAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * Convert a raw vocabCache entry into the canonical shape every renderer consumes.
 *
 * @param {object} raw entry from bookmarkedWords / frequentlyMissed / usedToMiss
 * @param {ListKind} listKind
 * @param {{ resolveModeMeta?: Function, now?: Date }} [opts]
 * @returns {object|null} null when the entry has no usable word text
 */
export function toVocabItem(raw, listKind, opts = {}) {
    if (!raw) return null;
    const text = resolveWordText(raw);
    if (!text) return null;

    const now = opts.now || new Date();
    const sourceMode = raw.mode && raw.mode !== '-' ? String(raw.mode) : null;
    const questionId = raw.questionId && raw.questionId !== '-' ? String(raw.questionId) : null;

    // collo-dictate entries are not tied to a numbered question, so the old
    // renderers suppressed the Q badge for them. Encoded once, here.
    const showQuestionBadge = Boolean(questionId) && sourceMode !== 'collo-dictate' && questionId !== 'manual';

    return {
        key: raw.lemma || text.toLowerCase(),
        text,
        entryType: raw.entryType === 'phrase' ? 'phrase' : 'word',
        pos: resolvePartOfSpeech(raw),
        sourceMode,
        sourceLabel: resolveModeLabel(sourceMode, opts.resolveModeMeta),
        questionId,
        showQuestionBadge,
        addedAt: raw.addedAt || null,
        addedLabel: formatAddedLabel(raw.addedAt, now),
        addedShort: formatShortDate(raw.addedAt),
        missCount: typeof raw.missCount === 'number' ? raw.missCount : null,
        // usedToMiss entries track how close they are to regressing (3 strikes).
        missesAfterMove: typeof raw.consecutiveMissesAfterMove === 'number'
            ? raw.consecutiveMissesAfterMove
            : null,
        movedAt: raw.movedAt || null,
        definition: raw.definition || null,
        example: raw.example || raw.sentence || null,
        listKind
    };
}

/**
 * Map a whole list, dropping entries with no usable word text.
 * @returns {object[]}
 */
export function toVocabItems(rawList, listKind, opts = {}) {
    if (!Array.isArray(rawList)) return [];
    const now = opts.now || new Date();
    return rawList
        .map((raw) => toVocabItem(raw, listKind, { ...opts, now }))
        .filter(Boolean);
}

/**
 * Sort orders available in the list toolbar.
 * `default` reproduces the historical per-list ordering: bookmarks newest-first,
 * missed most-missed-first, improving most-recently-moved-first.
 */
export const SORT_ORDERS = Object.freeze(['default', 'alpha', 'missed', 'recent']);

const byDateDesc = (a, b) => new Date(b || 0) - new Date(a || 0);

/**
 * Single home for the sorts that were duplicated across the four renderers.
 * Returns a new array; does not mutate the input.
 *
 * @param {object[]} items
 * @param {ListKind} listKind
 * @param {'default'|'alpha'|'missed'|'recent'} [order]
 * @returns {object[]}
 */
export function sortItems(items, listKind, order = 'default') {
    const list = Array.isArray(items) ? [...items] : [];

    switch (order) {
        case 'alpha':
            return list.sort((a, b) => a.text.localeCompare(b.text, 'en', { sensitivity: 'base' }));
        case 'missed':
            return list.sort((a, b) => (b.missCount || 0) - (a.missCount || 0));
        case 'recent':
            return list.sort((a, b) => byDateDesc(a.addedAt, b.addedAt));
        case 'default':
        default:
            if (listKind === 'missed') {
                return list.sort((a, b) => (b.missCount || 0) - (a.missCount || 0));
            }
            if (listKind === 'improving') {
                return list.sort((a, b) => byDateDesc(a.movedAt, b.movedAt));
            }
            return list.sort((a, b) => byDateDesc(a.addedAt, b.addedAt));
    }
}

/**
 * Case-insensitive search across the word and its translation.
 * @param {object[]} items
 * @param {string} query
 * @param {(key: string) => string|null} [getTranslation] optional translation lookup
 * @returns {object[]}
 */
export function filterItems(items, query, getTranslation) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return Array.isArray(items) ? [...items] : [];

    return (items || []).filter((item) => {
        if (item.text.toLowerCase().includes(q)) return true;
        if (item.pos && item.pos.toLowerCase().includes(q)) return true;
        if (typeof getTranslation === 'function') {
            const vi = getTranslation(item.key);
            if (vi && String(vi).toLowerCase().includes(q)) return true;
        }
        return false;
    });
}
