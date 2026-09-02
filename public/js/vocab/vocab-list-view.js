/**
 * vocab-list-view.js — the single renderer behind BOTH vocab surfaces.
 *
 * WHY THIS EXISTS
 * The side panel and the full-screen list used to be four separate render
 * functions with duplicated sorting, duplicated badge markup, four different
 * empty-state strings, and divergent event wiring (delegation in one, per-render
 * listeners in the others). Removing a word in one surface left the other stale.
 * This module renders one card-row component that both surfaces consume.
 *
 * WHY CARDS, NOT A TABLE
 * The old 8-column <table> could not fit a phone, so it was made to scroll
 * sideways. It also coupled styling to column position via nth-child(4..7) rules.
 * One grid-based row that reflows removes both problems and lets the side panel
 * reuse the same markup at a denser setting.
 */

import { EMPTY_STATES } from './vocab-item-model.js';
import {
    ICON_BOOK,
    ICON_CHEVRON,
    ICON_NO_RESULTS,
    ICON_SPEAKER,
    ICON_TRASH
} from './vocab-icons.js';

/** Escape text for safe interpolation into markup. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** CSS.escape with a defensive fallback, matching vocab-book.js's helper. */
export function escapeForSelector(value) {
    const str = String(value ?? '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
    return str.replace(/(["\\])/g, '\\$1');
}

/* ------------------------------------------------------------------ *
 * Pronunciation
 * ------------------------------------------------------------------ */

const FORM_LABELS = { citation: 'Citation', strong: 'Strong', weak: 'Weak' };

/**
 * Pick the form a learner should see first: the citation form if present,
 * otherwise the strong form, otherwise whatever came first.
 */
function pickPrimaryForm(forms) {
    return forms.find((f) => f.formRole === 'citation')
        || forms.find((f) => f.formRole === 'strong')
        || forms[0];
}

/**
 * Render the pronunciation cell.
 *
 * Replaces the old formatPronunciationDisplay(), which printed the literal word
 * "Citation:" in front of EVERY entry — internal linguistics jargon shown to
 * learners — and stacked one labelled line per form, so a function word like
 * "and" rendered six lines and blew the row height out.
 *
 * New rule:
 *   - one form  -> bare IPA, no label
 *   - many forms-> the primary form bare, plus a "+N" disclosure for the rest
 *   - never the string "Citation:"
 *
 * IPA values still come from Phonetics.getPronunciations(); this function never
 * reads the IPA corpora directly, so Oxford American notation stays owned by
 * Phonetics.normalizeIPA().
 *
 * @param {null|string|{forms: Array<{formRole?: string, ipa?: string}>}} pron
 * @returns {string} HTML
 */
export function renderPronunciation(pron) {
    if (!pron) return '';

    if (typeof pron === 'string') {
        const trimmed = pron.trim();
        if (!trimmed || trimmed === '-') return '';
        return `<span class="vocab-phonetic">${escapeHtml(trimmed)}</span>`;
    }

    const forms = (Array.isArray(pron.forms) ? pron.forms : []).filter((f) => f && f.ipa);
    if (!forms.length) return '';

    const primary = pickPrimaryForm(forms);
    const primaryHtml = `<span class="vocab-phonetic">${escapeHtml(primary.ipa)}</span>`;
    if (forms.length === 1) return primaryHtml;

    const others = forms.filter((f) => f !== primary);
    const detail = others
        .map((f) => {
            const label = FORM_LABELS[f.formRole] || 'Variant';
            return `<span class="vb-ipa-variant"><span class="vb-ipa-variant-label">${label}</span>`
                + `<span class="vocab-phonetic">${escapeHtml(f.ipa)}</span></span>`;
        })
        .join('');

    return `${primaryHtml}`
        + `<button type="button" class="vb-ipa-more" data-action="toggle-forms" aria-expanded="false"`
        + ` title="Show ${others.length} more pronunciation form${others.length === 1 ? '' : 's'}">`
        + `+${others.length}</button>`
        + `<span class="vb-ipa-variants" hidden>${detail}</span>`;
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

function renderPosTag(item) {
    // Omitted entirely when unknown. The old table printed "-" here, which was
    // roughly half the rows.
    if (!item.pos) return '';
    return `<span class="vb-tag vb-tag-pos vb-tag-pos-${escapeHtml(item.pos)}">${escapeHtml(item.pos)}</span>`;
}

function renderMeta(item) {
    const bits = [];
    if (item.missCount !== null && item.listKind === 'missed') {
        bits.push(
            `<span class="vb-badge vb-badge-miss" title="Missed ${item.missCount} times">`
            + `${item.missCount}\u00d7</span>`
        );
    }
    if (item.listKind === 'improving' && item.missesAfterMove !== null) {
        const warn = item.missesAfterMove > 0;
        bits.push(
            `<span class="vb-badge ${warn ? 'vb-badge-warn' : 'vb-badge-ok'}">`
            + `${warn ? `${item.missesAfterMove}/3` : 'Stable'}</span>`
        );
    }
    return bits.join('');
}

/**
 * The detail region: example sentences plus the source/date metadata that used
 * to occupy two mostly-useless top-level columns ("Source" showed raw values
 * like `type` / `Q107`).
 */
function renderProvenance(item) {
    const parts = [];
    if (item.sourceLabel) parts.push(`From ${escapeHtml(item.sourceLabel)}`);
    if (item.showQuestionBadge) parts.push(`Question ${escapeHtml(item.questionId)}`);
    if (item.addedLabel) parts.push(escapeHtml(item.addedLabel));
    if (!parts.length) return '';
    return `<p class="vb-provenance">${parts.join(' \u00b7 ')}</p>`;
}

function renderRow(item, opts) {
    const wordAttr = escapeHtml(item.text);
    const detailsId = `vb-details-${opts.instanceId}-${escapeHtml(item.key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const removeBtn = opts.showRemove
        ? `<button type="button" class="vb-icon-btn vb-icon-btn-danger" data-action="remove-word"`
        + ` data-key="${escapeHtml(item.key)}" aria-label="Remove ${wordAttr} from bookmarks"`
        + ` title="Remove">${ICON_TRASH}</button>`
        : '';

    // The disclosure starts hidden and is revealed by hydration only when the
    // dictionary actually returned sentences — the old table reserved a whole
    // "Examples" column for a chevron that was usually invisible.
    const expandBtn = `<button type="button" class="vb-icon-btn vb-expand" data-action="toggle-details"`
        + ` aria-expanded="false" aria-controls="${detailsId}" aria-label="Show examples for ${wordAttr}"`
        + ` hidden>${ICON_CHEVRON}</button>`;

    return `
        <li class="vb-row" data-key="${escapeHtml(item.key)}" data-word="${wordAttr}">
          <div class="vb-row-main">
            <div class="vb-word-block">
              <span class="vb-word">${escapeHtml(item.text)}</span>
              ${item.entryType === 'phrase' ? '<span class="vb-tag vb-tag-phrase">phrase</span>' : ''}
              ${renderPosTag(item)}
            </div>
            <div class="vb-pron-block">
              <span class="vb-pron" data-role="pron"></span>
              <button type="button" class="vb-icon-btn vb-audio" data-action="play-audio"
                data-word="${wordAttr}" aria-label="Listen to ${wordAttr}" title="Listen">${ICON_SPEAKER}</button>
            </div>
            <div class="vb-translation" data-role="translation"></div>
            <div class="vb-meta">${renderMeta(item)}</div>
            <div class="vb-actions">${expandBtn}${removeBtn}</div>
          </div>
          <div class="vb-row-details" id="${detailsId}" data-role="details" hidden>
            <div data-role="sentences"></div>
            ${renderProvenance(item)}
          </div>
        </li>`;
}

/* ------------------------------------------------------------------ *
 * Empty state
 * ------------------------------------------------------------------ */

function renderEmptyState(opts) {
    const isFiltered = opts.emptyKind === 'no-matches';
    const icon = isFiltered ? ICON_NO_RESULTS : ICON_BOOK;
    // A filtered-out list is NOT an empty book. Falling through to the list's
    // own empty copy produced the contradiction "No bookmarked words yet /
    // Try a different search term".
    const message = isFiltered
        ? EMPTY_STATES.noMatches
        : (opts.emptyMessage || EMPTY_STATES[opts.listKind] || 'Nothing here yet');
    const body = isFiltered
        ? 'Try a different search term, or clear the filters.'
        : opts.emptyHint || '';
    const cta = !isFiltered && opts.emptyCtaLabel
        ? `<button type="button" class="vb-empty-cta" data-action="empty-cta">${escapeHtml(opts.emptyCtaLabel)}</button>`
        : '';

    // The plain-text message is kept as a direct text node because
    // scripts/audit/run-a2-auth-admin-audit.js reads innerText of the bookmarked
    // list and regex-matches the copy.
    return `
        <div class="vb-empty vocab-empty">
          <span class="vb-empty-icon">${icon}</span>
          <p class="vb-empty-title">${escapeHtml(message)}</p>
          ${body ? `<p class="vb-empty-body">${escapeHtml(body)}</p>` : ''}
          ${cta}
        </div>`;
}

/* ------------------------------------------------------------------ *
 * Delegation
 * ------------------------------------------------------------------ */

function attachDelegation(container, opts) {
    // Idempotency flag, same pattern the old table renderer used, so repeated
    // renders never stack duplicate listeners.
    if (container.dataset.vbDelegated === 'true') {
        container._vbHandlers = opts;
        return;
    }
    container.dataset.vbDelegated = 'true';
    container._vbHandlers = opts;

    container.addEventListener('click', (event) => {
        const handlers = container._vbHandlers || {};
        const target = event.target;

        const audioBtn = target.closest('[data-action="play-audio"]');
        if (audioBtn) {
            handlers.onPlayAudio?.(audioBtn.dataset.word);
            return;
        }

        const removeBtn = target.closest('[data-action="remove-word"]');
        if (removeBtn) {
            handlers.onRemove?.(removeBtn.dataset.key);
            return;
        }

        const formsBtn = target.closest('[data-action="toggle-forms"]');
        if (formsBtn) {
            const variants = formsBtn.parentElement?.querySelector('.vb-ipa-variants');
            if (variants) {
                const open = formsBtn.getAttribute('aria-expanded') === 'true';
                formsBtn.setAttribute('aria-expanded', String(!open));
                variants.hidden = open;
            }
            return;
        }

        const expandBtn = target.closest('[data-action="toggle-details"]');
        if (expandBtn) {
            const row = expandBtn.closest('.vb-row');
            const details = row?.querySelector('[data-role="details"]');
            if (details) {
                const open = expandBtn.getAttribute('aria-expanded') === 'true';
                expandBtn.setAttribute('aria-expanded', String(!open));
                expandBtn.classList.toggle('is-open', !open);
                details.hidden = open;
            }
            return;
        }

        const cta = target.closest('[data-action="empty-cta"]');
        if (cta) handlers.onEmptyCta?.();
    });
}

/* ------------------------------------------------------------------ *
 * Hydration
 * ------------------------------------------------------------------ */

/**
 * Fill in IPA, translation and example sentences after the rows are on screen.
 * Network work is injected so this module stays independent of vocab-book.js.
 */
async function hydrate(container, items, opts) {
    const { fetchPhonetics, getEntry, mapLimit, concurrency = 8 } = opts.hydration || {};
    if (!fetchPhonetics && !getEntry) return;

    const run = typeof mapLimit === 'function'
        ? mapLimit
        : async (list, _limit, fn) => { await Promise.all(list.map(fn)); };

    await run(items, concurrency, async (item) => {
        // querySelectorAll, not querySelector: two entries can share a lemma
        // (e.g. the same word bookmarked from two questions), and matching only
        // the first left every later duplicate permanently unhydrated.
        const selector = `.vb-row[data-key="${escapeForSelector(item.key)}"]`;
        const rows = container.querySelectorAll(selector);
        if (!rows.length) return;

        const [pron, entry] = await Promise.all([
            fetchPhonetics ? fetchPhonetics(item.text).catch(() => null) : Promise.resolve(null),
            getEntry ? getEntry(item.text).catch(() => null) : Promise.resolve(null)
        ]);

        const pronHtml = renderPronunciation(pron);
        const sentences = Array.isArray(entry?.sentences) ? entry.sentences.slice(0, 3) : [];
        const sentenceHtml = sentences.map((s) => `
                    <div class="vb-sentence">
                      <span class="vb-sentence-en">${escapeHtml(s.en)}</span>
                      <span class="vb-sentence-vi">${escapeHtml(s.vi)}</span>
                    </div>`).join('');

        rows.forEach((row) => {
            const pronEl = row.querySelector('[data-role="pron"]');
            if (pronEl) pronEl.innerHTML = pronHtml;

            const translationEl = row.querySelector('[data-role="translation"]');
            if (translationEl && entry?.translation && entry.translation !== '-') {
                translationEl.textContent = entry.translation;
            }

            if (!sentences.length) return;
            const holder = row.querySelector('[data-role="sentences"]');
            if (holder && !holder.innerHTML) holder.innerHTML = sentenceHtml;
            const expand = row.querySelector('.vb-expand');
            if (expand) expand.hidden = false;
        });
    });
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ */

let instanceCounter = 0;

/**
 * Render a vocabulary list into `container`.
 *
 * @param {HTMLElement} container
 * @param {object[]} items canonical items from vocab-item-model
 * @param {object} [opts]
 * @param {'comfortable'|'compact'} [opts.density] compact = side panel
 * @param {'bookmarks'|'missed'|'improving'} [opts.listKind]
 * @param {boolean} [opts.showRemove]
 * @param {number|null} [opts.limit] cap rows (side panel "show more")
 * @param {'empty'|'no-matches'} [opts.emptyKind]
 * @param {Function} [opts.onRemove] receives the item key
 * @param {Function} [opts.onPlayAudio] receives the word text
 * @param {Function} [opts.onEmptyCta]
 * @param {{fetchPhonetics:Function,getEntry:Function,mapLimit:Function}} [opts.hydration]
 * @returns {Promise<void>} resolves once hydration has finished
 */
export function renderVocabList(container, items, opts = {}) {
    if (!container) return Promise.resolve();

    const settings = {
        density: 'comfortable',
        listKind: 'bookmarks',
        showRemove: false,
        limit: null,
        emptyKind: 'empty',
        ...opts
    };
    settings.instanceId = container.id || `vb${(instanceCounter += 1)}`;

    const list = Array.isArray(items) ? items : [];
    const visible = settings.limit ? list.slice(0, settings.limit) : list;

    container.classList.add('vb-list-host');
    container.classList.toggle('vb-compact', settings.density === 'compact');

    if (!visible.length) {
        container.innerHTML = renderEmptyState(settings);
        attachDelegation(container, settings);
        return Promise.resolve();
    }

    const hiddenCount = list.length - visible.length;
    container.innerHTML = `
        <ul class="vb-list" role="list">
          ${visible.map((item) => renderRow(item, settings)).join('')}
        </ul>
        ${hiddenCount > 0
        ? `<p class="vb-more-note">+${hiddenCount} more \u2014 open the full list to see everything</p>`
        : ''}`;

    attachDelegation(container, settings);
    return hydrate(container, visible, settings);
}
