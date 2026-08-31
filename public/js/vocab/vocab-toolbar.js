/**
 * vocab-toolbar.js — search / sort / filter controls for the full vocab list.
 *
 * WHY THIS EXISTS
 * The Vocab Book had no way to find a word. Every entry was rendered, unsorted
 * beyond one fixed order, with no search and no pagination — which stops being
 * usable somewhere around a hundred words.
 *
 * Controlled component: it owns no data, it just reports state changes upward.
 */

import { escapeHtml } from './vocab-list-view.js';
import { ICON_CLOSE, ICON_SEARCH } from './vocab-icons.js';

/** Filter chips. `all` is always present; the rest map to SRS ui statuses. */
export const FILTERS = Object.freeze([
    { id: 'all', label: 'All' },
    { id: 'due', label: 'Due' },
    { id: 'learning', label: 'Learning' },
    { id: 'mastered', label: 'Mastered' }
]);

export const SORTS = Object.freeze([
    { id: 'default', label: 'Default order' },
    { id: 'recent', label: 'Recently added' },
    { id: 'alpha', label: 'A – Z' },
    { id: 'missed', label: 'Most missed' }
]);

const DEBOUNCE_MS = 150;

/**
 * @param {HTMLElement} host
 * @param {{onChange: (state: {query:string, sort:string, filter:string}) => void,
 *          listKind?: string}} options
 */
export function createVocabToolbar(host, options = {}) {
    if (!host) return null;

    const state = { query: '', sort: 'default', filter: 'all' };
    let debounceTimer = null;

    host.classList.add('vb-toolbar');
    host.innerHTML = `
        <div class="vb-search">
          <span class="vb-search-icon">${ICON_SEARCH}</span>
          <input type="search" class="vb-search-input" data-role="search"
                 placeholder="Search words or meanings" aria-label="Search your vocabulary">
          <button type="button" class="vb-search-clear" data-role="clear"
                  aria-label="Clear search" hidden>${ICON_CLOSE}</button>
        </div>
        <div class="vb-filters" role="group" aria-label="Filter by review status">
          ${FILTERS.map((f) => `
            <button type="button" class="vb-chip${f.id === 'all' ? ' is-active' : ''}"
                    data-role="filter" data-filter="${f.id}" aria-pressed="${f.id === 'all'}">
              <span class="vb-chip-label">${escapeHtml(f.label)}</span>
              <span class="vb-chip-count" data-count="${f.id}"></span>
            </button>`).join('')}
        </div>
        <label class="vb-sort">
          <span class="vb-sr-only">Sort by</span>
          <select class="vb-sort-select" data-role="sort">
            ${SORTS.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </label>
        <p class="vb-result-count" data-role="count" aria-live="polite"></p>`;

    const searchInput = host.querySelector('[data-role="search"]');
    const clearBtn = host.querySelector('[data-role="clear"]');
    const countEl = host.querySelector('[data-role="count"]');

    const emit = () => options.onChange?.({ ...state });

    searchInput.addEventListener('input', () => {
        state.query = searchInput.value;
        clearBtn.hidden = !state.query;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(emit, DEBOUNCE_MS);
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.query = '';
        clearBtn.hidden = true;
        searchInput.focus();
        emit();
    });

    host.querySelector('[data-role="sort"]').addEventListener('change', (event) => {
        state.sort = event.target.value;
        emit();
    });

    host.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-role="filter"]');
        if (!chip) return;
        state.filter = chip.dataset.filter;
        host.querySelectorAll('[data-role="filter"]').forEach((el) => {
            const active = el === chip;
            el.classList.toggle('is-active', active);
            el.setAttribute('aria-pressed', String(active));
        });
        emit();
    });

    return {
        getState: () => ({ ...state }),

        /** Show how many words sit behind each filter. */
        setCounts(counts = {}) {
            host.querySelectorAll('[data-count]').forEach((el) => {
                const value = counts[el.dataset.count];
                el.textContent = Number.isFinite(value) ? String(value) : '';
            });
        },

        /** Report the visible/total result count. */
        setResultCount(shown, total) {
            if (!countEl) return;
            countEl.textContent = shown === total
                ? `${total} word${total === 1 ? '' : 's'}`
                : `${shown} of ${total} words`;
        },

        reset() {
            state.query = '';
            state.sort = 'default';
            state.filter = 'all';
            searchInput.value = '';
            clearBtn.hidden = true;
            host.querySelector('[data-role="sort"]').value = 'default';
            host.querySelectorAll('[data-role="filter"]').forEach((el) => {
                const active = el.dataset.filter === 'all';
                el.classList.toggle('is-active', active);
                el.setAttribute('aria-pressed', String(active));
            });
        },

        destroy() {
            clearTimeout(debounceTimer);
            host.innerHTML = '';
        }
    };
}

/**
 * Filter items by SRS review status.
 * @param {object[]} items
 * @param {string} filterId
 * @param {(key: string) => ({status?: string}|null)} getCardStatus
 */
export function applyStatusFilter(items, filterId, getCardStatus) {
    if (!filterId || filterId === 'all' || typeof getCardStatus !== 'function') {
        return Array.isArray(items) ? [...items] : [];
    }

    return (items || []).filter((item) => {
        const card = getCardStatus(item.key);
        if (!card) return false;
        if (filterId === 'due') return card.isDue === true;
        if (filterId === 'mastered') return card.status === 'mastered';
        if (filterId === 'learning') return card.status === 'learning' || card.status === 'review';
        return true;
    });
}
