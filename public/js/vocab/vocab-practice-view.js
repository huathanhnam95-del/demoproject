/**
 * vocab-practice-view.js — the Vocabulary Practice dashboard.
 *
 * WHY THIS EXISTS
 * The Practice tab used to be one 48px emoji, one button, and a tutorial-replay
 * settings panel that took roughly 70% of the tab's height. Its primary CTA called
 * launchReviewFromDashboard(), which does not start a review — it closes the modal
 * and scrolls to a dashboard card whose only action is to reopen the modal. This
 * replaces that with real state (due count, streak, mastery) and entry points that
 * actually start a session.
 *
 * All numbers come from SRSReview read APIs; this module owns no data.
 */

import { escapeHtml } from './vocab-list-view.js';

/**
 * The four practice entries. The first three are in-session drill types passed to
 * startReviewSession({ mode }); Writing Challenge is a separate surface.
 */
export const PRACTICE_MODES = Object.freeze([
    {
        id: 'listen',
        label: 'Listen and Type',
        blurb: 'Hear the word, type what you hear.',
        icon: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'
    },
    {
        id: 'speak',
        label: 'Listen and Repeat',
        blurb: 'Hear it, then say it back.',
        icon: '<path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/>'
    },
    {
        id: 'cloze',
        label: 'Fill in the Blank',
        blurb: 'Recall the word from its sentence.',
        icon: '<path d="M4 7h16"/><path d="M4 12h7"/><path d="M4 17h12"/>'
    },
    {
        id: 'writing',
        label: 'Writing Challenge',
        blurb: 'Use the word in your own sentence.',
        icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
    }
]);

const icon = (paths, size = 20) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
    + ` focusable="false">${paths}</svg>`;

/** Read every number the dashboard needs, tolerating a missing SRS module. */
export function readPracticeState(srs = window.SRSReview) {
    if (!srs) {
        return {
            available: false,
            dueCount: 0, totalWords: 0, entryLabel: 'Review unavailable',
            nextLabel: '-', streak: 0, longestStreak: 0, mastered: 0, masteryPct: 0
        };
    }

    const entry = srs.getEntryState?.() || {};
    const tiers = srs.getTierCounts?.() || {};
    const stats = srs.getReviewStats?.() || {};
    const next = srs.getNextReviewSummary?.() || {};

    const total = Number(tiers.total ?? entry.totalWords ?? 0);
    const mastered = Number(tiers.mastered ?? 0);

    return {
        available: true,
        dueCount: Number(entry.dueCount ?? tiers.due ?? 0),
        totalWords: total,
        entryLabel: entry.entryLabel || (total ? 'All caught up' : 'No review items yet'),
        nextLabel: next.label || '-',
        streak: Number(stats.streak ?? 0),
        longestStreak: Number(stats.longestStreak ?? 0),
        mastered,
        masteryPct: total > 0 ? Math.round((mastered / total) * 100) : 0
    };
}

function renderHero(state) {
    const hasWords = state.totalWords > 0;
    const ctaLabel = state.dueCount > 0 ? 'Start Daily Review' : 'Practice Anyway';

    return `
      <section class="vb-practice-hero">
        <div class="vb-practice-headline">
          <p class="vb-practice-due" data-role="due-count">${state.dueCount}</p>
          <p class="vb-practice-due-label">${escapeHtml(state.entryLabel)}</p>
          ${state.dueCount === 0 && hasWords
        ? `<p class="vb-practice-next">Next review: <strong>${escapeHtml(state.nextLabel)}</strong></p>`
        : ''}
        </div>
        <div class="vb-ring" style="--vb-ring-p:${state.masteryPct}" role="img"
             aria-label="${state.masteryPct}% of your words are mastered">
          <span class="vb-ring-value">${state.masteryPct}<span class="vb-ring-unit">%</span></span>
          <span class="vb-ring-label">mastered</span>
        </div>
      </section>

      <button type="button" class="vb-practice-cta" data-action="start-review"
        ${hasWords ? '' : 'disabled'}>
        ${escapeHtml(ctaLabel)}
        ${state.dueCount > 0 ? `<span class="vb-practice-cta-badge" id="srs-due-badge">${state.dueCount}</span>` : ''}
      </button>
      ${hasWords ? '' : '<p class="vb-practice-hint">Bookmark a few words first — then they will show up here for review.</p>'}

      <section class="vb-stat-row" aria-label="Your review statistics">
        <div class="vb-stat">
          <span class="vb-stat-value">${state.streak}</span>
          <span class="vb-stat-label">Day streak</span>
        </div>
        <div class="vb-stat">
          <span class="vb-stat-value">${state.longestStreak}</span>
          <span class="vb-stat-label">Best streak</span>
        </div>
        <div class="vb-stat">
          <span class="vb-stat-value">${state.totalWords}</span>
          <span class="vb-stat-label">Words tracked</span>
        </div>
        <div class="vb-stat">
          <span class="vb-stat-value">${state.mastered}</span>
          <span class="vb-stat-label">Mastered</span>
        </div>
      </section>`;
}

function renderModeCards(state) {
    return `
      <section class="vb-mode-grid" aria-label="Choose a practice type">
        ${PRACTICE_MODES.map((mode) => `
          <button type="button" class="vb-mode-card" data-action="start-mode" data-mode="${mode.id}"
            ${state.totalWords > 0 ? '' : 'disabled'}>
            <span class="vb-mode-icon">${icon(mode.icon)}</span>
            <span class="vb-mode-label">${escapeHtml(mode.label)}</span>
            <span class="vb-mode-blurb">${escapeHtml(mode.blurb)}</span>
          </button>`).join('')}
      </section>`;
}

/**
 * Tutorial replay toggles, demoted into a collapsed disclosure.
 * The four checkbox ids are a hard contract with vocab-tutorial.js
 * (initReplayToggles / rebindReplayToggles) — do not rename them.
 */
function renderSettings() {
    const toggles = [
        ['tutorial-replay-listen', 'Listen and Type'],
        ['tutorial-replay-speak', 'Listen and Repeat'],
        ['tutorial-replay-cloze', 'Fill in the Blank'],
        ['tutorial-replay-writing', 'Writing Challenge']
    ];

    return `
      <details class="vb-settings">
        <summary class="vb-settings-summary">Practice settings</summary>
        <div class="vb-settings-body">
          <p class="vb-settings-desc">Replay the tutorial next time you open a mode.</p>
          <div class="vb-toggle-list">
            ${toggles.map(([id, label]) => `
              <div class="vb-toggle-item">
                <label class="vb-toggle-label" for="${id}">${escapeHtml(label)}</label>
                <label class="toggle-switch">
                  <input type="checkbox" id="${id}">
                  <span class="toggle-slider"></span>
                </label>
              </div>`).join('')}
          </div>
        </div>
      </details>`;
}

/**
 * Render the Practice dashboard into `container`.
 *
 * @param {HTMLElement} container
 * @param {object} [deps]
 * @param {object} [deps.srs] SRSReview module (injected for tests)
 * @param {Function} [deps.onAfterRender] called once the DOM is in place
 */
export function renderPracticeDashboard(container, deps = {}) {
    if (!container) return null;

    const srs = deps.srs || window.SRSReview;
    const state = readPracticeState(srs);

    container.classList.add('vb-practice');
    container.innerHTML = `
      ${renderHero(state)}
      ${renderModeCards(state)}
      ${renderSettings()}`;

    if (container.dataset.vbPracticeBound !== 'true') {
        container.dataset.vbPracticeBound = 'true';

        container.addEventListener('click', (event) => {
            const startBtn = event.target.closest('[data-action="start-review"]');
            if (startBtn) {
                // Directly start a session. The old button called
                // launchReviewFromDashboard(), which only closed this modal and
                // scrolled to a card that reopened it.
                srs?.startReviewSession?.();
                return;
            }

            const modeBtn = event.target.closest('[data-action="start-mode"]');
            if (!modeBtn) return;

            const mode = modeBtn.dataset.mode;
            if (mode === 'writing') {
                const word = srs?.getWordsDueForReview?.()[0] || null;
                if (word && srs?.showWritingChallenge) srs.showWritingChallenge(word);
                else srs?.startReviewSession?.();
                return;
            }
            srs?.startReviewSession?.({ mode });
        });
    }

    // The toggles were just (re)created, so re-wire them. initReplayToggles only
    // runs at DOM ready, which is long before this lazily-rendered tab exists.
    window.VocabTutorial?.rebindReplayToggles?.();
    deps.onAfterRender?.(state);

    return state;
}
