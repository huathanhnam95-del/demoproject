/**
 * swt-review.js — Summarize Written Text Parallel Answer Review Controller
 *
 * Implements two-column parallel evidence comparison for the SWT review stage:
 * - Left pane: original source text with exact-quote highlights
 * - Right pane: interactive answer breakdown (Core points and Points to ignore)
 * - Stationary headers/footers with independent pane scrolling
 * - Targeted source container scrolling without page travel
 * - Responsive side-by-side (>=1024px, >=600px) and toggle view (<1024px)
 * - Complete keyboard accessibility (ArrowLeft/Right/Home/End tabs, Space/Enter, Escape)
 */
(function (root) {
  'use strict';

  class SWTReviewController {
    constructor() {
      this.container = null;
      this.question = null;
      this.sourceText = '';
      this.analysis = null;
      this.activeKind = 'core'; // 'core' | 'ignore'
      this.activePointId = null;
      this.overview = false;
      this.activeEvidence = [];
      this.evidenceIndex = -1;
      this.entries = new Map();
      this.tabScroll = { core: 0, ignore: 0 };
      this.mobilePointScroll = 0;
      this.sourcePageScroll = 0;
      this.selectionEpoch = 0;
      this.resizeObserver = null;
      this.onResizeBound = null;
      this.onKeydownBound = null;
      this.isMounted = false;
    }

    isSplit() {
      if (!this.shell) return false;
      return this.shell.classList.contains('is-split');
    }

    behavior() {
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      }
      return 'auto';
    }

    currentPoints() {
      if (!this.analysis) return [];
      return this.activeKind === 'core'
        ? (this.analysis.corePoints || [])
        : (this.analysis.ignorePoints || []);
    }

    mount({ container, question, sourceText, answerAnalysis }) {
      if (!container) throw new TypeError('A container element is required to mount SWTReviewController.');
      this.destroy(); // Clean up any prior instance

      const analysis = answerAnalysis || question?.answerAnalysis;
      const canonicalSource = typeof sourceText === 'string' && sourceText.length > 0
        ? sourceText
        : question?.sourceText;

      if (!analysis || !canonicalSource) {
        throw new Error('SWT Review requires valid answerAnalysis and canonical sourceText.');
      }

      const evidenceEngine = (typeof window !== 'undefined' && window.SWTEvidence) ||
        (typeof globalThis !== 'undefined' && globalThis.SWTEvidence);

      if (!evidenceEngine) {
        throw new Error('SWTEvidence engine is required but not loaded.');
      }

      this.evidenceEngine = evidenceEngine;
      this.container = container;
      this.question = question || {};
      this.sourceText = canonicalSource;
      this.analysis = analysis;
      this.isMounted = true;

      this.renderTemplate();
      this.cacheElements();
      this.buildPointLists();
      this.bindEvents();

      this.updateLayout();

      // Desktop initial state: select first core point; mobile: start unselected
      const initialPointId = this.isSplit() ? (this.analysis.corePoints?.[0]?.id || null) : null;
      this.selectPoint(initialPointId, { scroll: false, openSource: false });

      return this;
    }

    renderTemplate() {
      this.container.innerHTML = `
        <div class="swt-review-shell" data-view="analysis">
          <div class="swt-review-intro">
            <div>
              <p class="swt-review-kicker">Answer review · Evidence explorer</p>
              <h3 class="swt-review-title">Understand it, side by side.</h3>
              <p class="swt-review-intro-copy">Choose a point to explore its evidence in the original passage.</p>
            </div>
            <div class="swt-review-badge">
              <strong>One connected workspace</strong>
              The passage and explanation stay together.
            </div>
          </div>

          <div class="swt-review-workspace-wrap">
            <div class="swt-review-mobile-switch" role="group" aria-label="Review view">
              <button type="button" class="swt-review-view-btn" data-view="analysis" aria-pressed="true">Points &amp; explanation</button>
              <button type="button" class="swt-review-view-btn" data-view="source" aria-pressed="false">Original passage</button>
            </div>

            <div class="swt-review-workspace">
              <!-- Left Pane: Original Passage -->
              <section class="swt-review-pane swt-review-source-pane" aria-label="Original passage">
                <header class="swt-review-pane-head swt-review-source-head">
                  <div>
                    <h4 class="swt-review-pane-title">Original passage</h4>
                    <p class="swt-review-meta swt-review-question-meta"></p>
                  </div>
                  <button type="button" class="swt-review-small-button swt-review-clear-btn">Clear highlights</button>
                </header>
                <div class="swt-review-pane-body swt-review-source-scroll" tabindex="0" role="region" aria-label="Original passage, scrollable in side-by-side view">
                  <div class="swt-review-passage"></div>
                </div>
                <div class="swt-review-source-foot">
                  <div>
                    <p class="swt-review-link-caption"><span class="swt-review-link-dot" aria-hidden="true"></span><span class="swt-review-evidence-caption">Choose a point</span></p>
                    <p class="swt-review-evidence-counter">Its exact evidence will appear here.</p>
                  </div>
                  <div class="swt-review-evidence-navigation">
                    <button type="button" class="swt-review-icon-button swt-review-prev-evidence" aria-label="Previous source excerpt" disabled>←</button>
                    <button type="button" class="swt-review-icon-button swt-review-next-evidence" aria-label="Next source excerpt" disabled>→</button>
                  </div>
                </div>
              </section>

              <!-- Right Pane: Answer Breakdown -->
              <section class="swt-review-pane swt-review-analysis-pane" aria-label="Answer breakdown">
                <header class="swt-review-pane-head swt-review-analysis-head">
                  <h4 class="swt-review-pane-title">Answer breakdown</h4>
                  <p class="swt-review-meta">Select an idea. See the words that support it.</p>
                  <div class="swt-review-tabs" role="tablist" aria-label="Answer point category">
                    <button class="swt-review-tab swt-review-tab-core" data-kind="core" type="button" role="tab" aria-selected="true" tabindex="0">Core points <span class="swt-review-tab-count swt-review-count-core"></span></button>
                    <button class="swt-review-tab swt-review-tab-ignore" data-kind="ignore" type="button" role="tab" aria-selected="false" tabindex="-1">Points to ignore <span class="swt-review-tab-count swt-review-count-ignore"></span></button>
                  </div>
                </header>
                <div class="swt-review-pane-body swt-review-analysis-scroll" tabindex="0" role="region" aria-label="Points and explanations, scrollable in side-by-side view">
                  <div class="swt-review-panel swt-review-panel-core" role="tabpanel">
                    <div class="swt-review-list-tools">
                      <p>Preserve these ideas in your own words.</p>
                      <button type="button" class="swt-review-small-button swt-review-show-all swt-review-show-all-core" aria-pressed="false">Highlight all</button>
                    </div>
                    <ol class="swt-review-point-list swt-review-core-list"></ol>
                    <p class="swt-review-note">Keep the meaning, not necessarily the exact wording. Unhighlighted text is not automatically irrelevant.</p>
                    <details class="swt-review-sample">
                      <summary>See an example summary</summary>
                      <p class="swt-review-sample-summary"></p>
                      <small class="swt-review-summary-meta"></small>
                    </details>
                  </div>
                  <div class="swt-review-panel swt-review-panel-ignore" role="tabpanel" hidden>
                    <div class="swt-review-list-tools">
                      <p>Details you can omit—not factual errors.</p>
                      <button type="button" class="swt-review-small-button swt-review-show-all swt-review-show-all-ignore" aria-pressed="false">Highlight all</button>
                    </div>
                    <ol class="swt-review-point-list swt-review-ignore-list"></ol>
                    <p class="swt-review-note">These choices apply to this passage. Dates, names and figures are not always optional. Each item explains why it can be left out here.</p>
                  </div>
                </div>
                <div class="swt-review-analysis-foot">
                  <span class="swt-review-key-legend">Core idea</span>
                  <span class="swt-review-key-legend swt-review-omit">Optional detail</span>
                  <span>Escape clears highlights</span>
                </div>
              </section>
            </div>
          </div>
          <p class="swt-review-bottom-note">Concept review · Illustrative teaching annotations, not an official answer key</p>
          <p class="sr-only swt-review-status" role="status" aria-live="polite" aria-atomic="true"></p>
        </div>`;
    }

    cacheElements() {
      const c = this.container;
      this.shell = c.querySelector('.swt-review-shell');
      this.introCopy = c.querySelector('.swt-review-intro-copy');
      this.wrap = c.querySelector('.swt-review-workspace-wrap');
      this.workspace = c.querySelector('.swt-review-workspace');

      // Source pane
      this.sourcePane = c.querySelector('.swt-review-source-pane');
      this.sourceHead = c.querySelector('.swt-review-source-head');
      this.questionMeta = c.querySelector('.swt-review-question-meta');
      this.clearBtn = c.querySelector('.swt-review-clear-btn');
      this.sourceScroll = c.querySelector('.swt-review-source-scroll');
      this.source = c.querySelector('.swt-review-passage');
      this.sourceFoot = c.querySelector('.swt-review-source-foot');
      this.evidenceCaption = c.querySelector('.swt-review-evidence-caption');
      this.evidenceCounter = c.querySelector('.swt-review-evidence-counter');
      this.prevEvidenceBtn = c.querySelector('.swt-review-prev-evidence');
      this.nextEvidenceBtn = c.querySelector('.swt-review-next-evidence');

      // Analysis pane
      this.analysisPane = c.querySelector('.swt-review-analysis-pane');
      this.tabCore = c.querySelector('.swt-review-tab-core');
      this.tabIgnore = c.querySelector('.swt-review-tab-ignore');
      this.countCore = c.querySelector('.swt-review-count-core');
      this.countIgnore = c.querySelector('.swt-review-count-ignore');
      this.analysisScroll = c.querySelector('.swt-review-analysis-scroll');
      this.panelCore = c.querySelector('.swt-review-panel-core');
      this.panelIgnore = c.querySelector('.swt-review-panel-ignore');
      this.showAllCore = c.querySelector('.swt-review-show-all-core');
      this.showAllIgnore = c.querySelector('.swt-review-show-all-ignore');
      this.coreList = c.querySelector('.swt-review-core-list');
      this.ignoreList = c.querySelector('.swt-review-ignore-list');
      this.sampleSummary = c.querySelector('.swt-review-sample-summary');
      this.summaryMeta = c.querySelector('.swt-review-summary-meta');

      // View switch & status
      this.viewAnalysisBtn = c.querySelector('.swt-review-view-btn[data-view="analysis"]');
      this.viewSourceBtn = c.querySelector('.swt-review-view-btn[data-view="source"]');
      this.status = c.querySelector('.swt-review-status');

      // Meta info
      const wordCount = this.sourceText.trim().split(/\s+/).filter(Boolean).length;
      const title = this.question.title || 'Question Passage';
      this.questionMeta.textContent = `${title} · ${wordCount} words`;

      const coreCount = this.analysis.corePoints?.length || 0;
      const ignoreCount = this.analysis.ignorePoints?.length || 0;
      this.countCore.textContent = String(coreCount);
      this.countIgnore.textContent = String(ignoreCount);

      if (this.analysis.sampleSummary) {
        this.sampleSummary.textContent = this.analysis.sampleSummary;
        const sampleWords = this.analysis.sampleSummary.trim().split(/\s+/).filter(Boolean).length;
        this.summaryMeta.textContent = `${sampleWords} words · Illustrative answer, not an official answer key.`;
      }
    }

    buildPointLists() {
      this.entries.clear();
      this.buildList(this.analysis.corePoints || [], 'core', this.coreList);
      this.buildList(this.analysis.ignorePoints || [], 'ignore', this.ignoreList);
    }

    buildList(points, kind, listEl) {
      listEl.replaceChildren();
      points.forEach((point, index) => {
        const item = document.createElement('li');
        item.className = 'swt-review-point-item';
        item.dataset.kind = kind;

        const button = document.createElement('button');
        button.className = 'swt-review-point-button';
        button.type = 'button';
        button.id = `point-${point.id}`;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-expanded', 'false');

        const number = document.createElement('span');
        number.className = 'swt-review-point-number';
        number.textContent = String(index + 1).padStart(2, '0');
        number.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'swt-review-point-label';
        label.textContent = point.label;

        const arrow = document.createElement('span');
        arrow.className = 'swt-review-point-arrow';
        arrow.textContent = '↗';
        arrow.setAttribute('aria-hidden', 'true');

        button.append(number, label, arrow);

        const detail = document.createElement('div');
        detail.className = 'swt-review-point-detail';
        detail.id = `detail-${point.id}`;
        detail.hidden = true;

        const whyLabel = document.createElement('p');
        whyLabel.className = 'swt-review-why-label';
        whyLabel.textContent = kind === 'core' ? 'Why keep this idea?' : 'Why can you leave it out?';

        const rationale = document.createElement('p');
        rationale.className = 'swt-review-rationale';
        rationale.textContent = point.rationale;

        const chips = document.createElement('div');
        chips.className = 'swt-review-evidence-chips';
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'Source excerpts for this point');

        (point.evidence || []).forEach((range, excerptIndex) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'swt-review-evidence-chip';
          chip.textContent = `Excerpt ${excerptIndex + 1} ↗`;
          chip.dataset.pointId = point.id;
          chip.dataset.excerpt = String(excerptIndex);
          chip.setAttribute('aria-pressed', 'false');
          chip.setAttribute('aria-label', `Show source excerpt ${excerptIndex + 1}: ${range.quote}`);

          chip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.activePointId !== point.id) {
              this.selectPoint(point.id, { scroll: false, openSource: false });
            }
            const idx = this.activeEvidence.findIndex(
              ev => ev.pointId === point.id && ev.start === range.start && ev.end === range.end
            );
            if (idx >= 0) {
              if (!this.isSplit()) this.setView('source', { fromPoint: true });
              this.selectEvidence(idx, true);
            }
          });

          chips.append(chip);
        });

        detail.append(whyLabel, rationale, chips);
        item.append(button, detail);
        listEl.append(item);

        this.entries.set(point.id, { point, kind, index, item, button, detail });

        button.addEventListener('click', () => {
          this.selectPoint(this.activePointId === point.id ? null : point.id);
        });
      });
    }

    bindEvents() {
      // Clear highlights
      this.clearBtn.addEventListener('click', () => this.selectPoint(null, { scroll: false }));

      // Evidence nav
      this.prevEvidenceBtn.addEventListener('click', () => this.selectEvidence(this.evidenceIndex - 1, true));
      this.nextEvidenceBtn.addEventListener('click', () => this.selectEvidence(this.evidenceIndex + 1, true));

      // Category tabs
      [
        { btn: this.tabCore, kind: 'core' },
        { btn: this.tabIgnore, kind: 'ignore' }
      ].forEach(({ btn, kind }) => {
        btn.addEventListener('click', () => this.setCategory(kind));
        btn.addEventListener('keydown', (event) => {
          const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
          if (!keys.includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'core' : event.key === 'End' ? 'ignore' : (kind === 'core' ? 'ignore' : 'core');
          this.setCategory(next, { focus: true });
        });
      });

      // Highlight all
      this.showAllCore.addEventListener('click', () => this.highlightAll());
      this.showAllIgnore.addEventListener('click', () => this.highlightAll());

      // Mobile view buttons
      this.viewAnalysisBtn.addEventListener('click', () => this.setView('analysis'));
      this.viewSourceBtn.addEventListener('click', () => {
        this.setView('source');
        if (this.activeEvidence.length) {
          requestAnimationFrame(() => this.ensureEvidenceVisible());
        }
      });

      // Keyboard escape
      this.onKeydownBound = (event) => {
        if (event.key === 'Escape' && (this.activePointId || this.overview)) {
          this.selectPoint(null, { scroll: false, openSource: false });
        }
      };
      document.addEventListener('keydown', this.onKeydownBound);

      // Layout observers
      this.onResizeBound = () => this.updateLayout();
      window.addEventListener('resize', this.onResizeBound);

      if (typeof ResizeObserver !== 'undefined' && this.wrap) {
        this.resizeObserver = new ResizeObserver(this.onResizeBound);
        this.resizeObserver.observe(this.wrap);
      }
    }

    updateLayout() {
      if (!this.shell || !this.wrap) return;
      const prevSplit = this.isSplit();
      const wrapRect = this.wrap.getBoundingClientRect();
      const split = wrapRect.width >= 1024 && window.innerHeight >= 600;

      this.shell.classList.toggle('is-split', split);
      this.introCopy.textContent = split
        ? 'Choose a point on the right. Its evidence lights up on the left—without moving the page.'
        : 'Choose a point, then switch between its explanation and the highlighted passage.';

      if (prevSplit !== split) {
        if (split) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        } else {
          const focused = document.activeElement;
          if (this.sourcePane?.contains(focused)) this.setView('source');
          if (this.analysisPane?.contains(focused)) this.setView('analysis');
        }
      }
    }

    redraw(points, kind) {
      const oldTop = this.sourceScroll.scrollTop;
      this.evidenceEngine.renderSource(this.source, this.sourceText, points, kind);
      this.sourceScroll.scrollTop = oldTop;
      this.activeEvidence = points
        .flatMap(p => (p.evidence || []).map((e, i) => ({ ...e, pointId: p.id, excerptIndex: i })))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      this.evidenceIndex = this.activeEvidence.length ? 0 : -1;
    }

    selectPoint(pointId, { scroll = true, openSource = true } = {}) {
      const entry = pointId ? this.entries.get(pointId) : null;
      if (pointId && !entry) return;

      const oldButtonTop = entry?.button ? entry.button.getBoundingClientRect().top : 0;
      const oldRightScroll = this.analysisScroll ? this.analysisScroll.scrollTop : 0;
      ++this.selectionEpoch;

      try {
        this.redraw(entry ? [entry.point] : [], entry?.kind || this.activeKind);
      } catch (error) {
        this.activePointId = null;
        this.overview = false;
        this.activeEvidence = [];
        this.evidenceIndex = -1;
        this.source.textContent = this.sourceText;
        this.updatePointUI();
        this.updateEvidenceUI();
        if (this.status) {
          this.status.textContent = 'Highlighting is unavailable: the saved evidence does not match this passage.';
        }
        console.error('[SWT Review] Redraw failed:', error);
        return;
      }

      this.activePointId = entry?.point.id || null;
      this.overview = false;
      if (entry) this.activeKind = entry.kind;
      this.updatePointUI();

      // Preserve the clicked row's position when a preceding explanation collapses.
      if (this.isSplit() && entry && this.analysisScroll) {
        this.analysisScroll.scrollTop = oldRightScroll + entry.button.getBoundingClientRect().top - oldButtonTop;
      }

      if (entry && openSource && !this.isSplit()) {
        this.setView('source', { fromPoint: true });
      }

      this.updateEvidenceUI();

      const epoch = this.selectionEpoch;
      if (scroll && this.activeEvidence.length) {
        requestAnimationFrame(() => {
          if (epoch === this.selectionEpoch) this.ensureEvidenceVisible();
        });
      }

      if (this.status) {
        this.status.textContent = entry
          ? `${entry.kind === 'core' ? 'Core point ' : 'Point to ignore '}${entry.index + 1} selected. ${entry.point.evidence?.length || 0} source excerpts highlighted. ${entry.point.rationale}`
          : 'Highlights cleared. The original passage is unchanged.';
      }
    }

    updatePointUI() {
      for (const [id, e] of this.entries) {
        const selected = id === this.activePointId;
        e.item.classList.toggle('is-selected', selected);
        e.button.setAttribute('aria-pressed', String(selected));
        e.button.setAttribute('aria-expanded', String(selected));
        e.detail.hidden = !selected;
      }
      this.showAllCore.setAttribute('aria-pressed', String(this.overview && this.activeKind === 'core'));
      this.showAllIgnore.setAttribute('aria-pressed', String(this.overview && this.activeKind === 'ignore'));
    }

    highlightAll() {
      if (this.overview) {
        this.selectPoint(null, { scroll: false });
        return;
      }
      ++this.selectionEpoch;
      this.activePointId = null;
      this.overview = true;
      this.redraw(this.currentPoints(), this.activeKind);
      this.updatePointUI();
      this.updateEvidenceUI();
      if (!this.isSplit()) this.setView('source', { fromPoint: true });
      if (this.status) {
        this.status.textContent = `Showing all ${this.activeKind === 'core' ? 'core points' : 'optional details'}. Use the excerpt arrows to explore.`;
      }
    }

    marksForEvidence(evidence) {
      if (!evidence || !this.source) return [];
      return [...this.source.querySelectorAll('mark')].filter(m => {
        const s = +m.dataset.sourceStart;
        const e = +m.dataset.sourceEnd;
        const pids = (m.dataset.pointIds || '').split(' ');
        return s < evidence.end && e > evidence.start && pids.includes(evidence.pointId);
      });
    }

    updateEvidenceUI() {
      const entry = this.entries.get(this.activePointId);
      this.sourceFoot.dataset.kind = this.activeKind;
      this.evidenceCaption.textContent = entry
        ? `${entry.kind === 'core' ? 'Core point ' : 'Point to ignore '}${String(entry.index + 1).padStart(2, '0')}`
        : this.overview
          ? (this.activeKind === 'core' ? 'All core points' : 'All points to ignore')
          : 'Choose a point to see its evidence';

      this.evidenceCounter.textContent = this.activeEvidence.length
        ? `Excerpt ${this.evidenceIndex + 1} of ${this.activeEvidence.length} · Exact wording from the passage`
        : 'Core ideas and optional details use different underlines.';

      this.prevEvidenceBtn.disabled = this.evidenceIndex <= 0;
      this.nextEvidenceBtn.disabled = this.evidenceIndex < 0 || this.evidenceIndex >= this.activeEvidence.length - 1;

      this.source.querySelectorAll('.is-current-evidence').forEach(m => m.classList.remove('is-current-evidence'));
      this.marksForEvidence(this.activeEvidence[this.evidenceIndex]).forEach(m => m.classList.add('is-current-evidence'));

      this.container.querySelectorAll('.swt-review-evidence-chip').forEach(b => {
        const e = this.activeEvidence[this.evidenceIndex];
        const match = Boolean(e && b.dataset.pointId === e.pointId && +b.dataset.excerpt === e.excerptIndex);
        b.setAttribute('aria-pressed', String(match));
      });
    }

    selectEvidence(index, scroll) {
      if (index < 0 || index >= this.activeEvidence.length) return;
      this.evidenceIndex = index;
      this.updateEvidenceUI();
      if (scroll) this.ensureEvidenceVisible();
      if (this.status) {
        this.status.textContent = `Source excerpt ${index + 1} of ${this.activeEvidence.length}: ${this.activeEvidence[index].quote}`;
      }
    }

    ensureEvidenceVisible() {
      const mark = this.marksForEvidence(this.activeEvidence[this.evidenceIndex])[0];
      if (!mark) return;
      const rect = mark.getBoundingClientRect();

      if (this.isSplit()) {
        const pane = this.sourceScroll.getBoundingClientRect();
        const top = pane.top + this.sourceScroll.clientTop;
        const bottom = top + this.sourceScroll.clientHeight;

        // Never call scrollIntoView here: only target the dedicated source scroll container!
        if (rect.top < top + 20 || rect.bottom > bottom - 20) {
          const position = this.sourceScroll.scrollTop + rect.top - top - Math.min(70, this.sourceScroll.clientHeight * 0.22);
          this.sourceScroll.scrollTo({ top: Math.max(0, position), behavior: this.behavior() });
        }
      } else if (this.shell.dataset.view === 'source') {
        const mobileSwitch = this.container.querySelector('.swt-review-mobile-switch');
        const sticky = (mobileSwitch ? mobileSwitch.getBoundingClientRect().height : 48) + 20;
        if (rect.top < sticky || rect.bottom > window.innerHeight - 24) {
          window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - sticky - 30), behavior: this.behavior() });
        }
      }
    }

    setCategory(kind, { focus = false } = {}) {
      if (kind !== 'core' && kind !== 'ignore') return;
      if (kind === this.activeKind) {
        if (focus) (kind === 'core' ? this.tabCore : this.tabIgnore).focus({ preventScroll: true });
        return;
      }

      this.tabScroll[this.activeKind] = this.analysisScroll.scrollTop;
      this.activeKind = kind;

      ['core', 'ignore'].forEach(k => {
        const tab = k === 'core' ? this.tabCore : this.tabIgnore;
        const panel = k === 'core' ? this.panelCore : this.panelIgnore;
        tab.setAttribute('aria-selected', String(k === kind));
        tab.tabIndex = k === kind ? 0 : -1;
        panel.hidden = k !== kind;
      });

      this.selectPoint(null, { scroll: false, openSource: false });
      this.analysisScroll.scrollTop = this.tabScroll[kind];
      if (focus) (kind === 'core' ? this.tabCore : this.tabIgnore).focus({ preventScroll: true });
    }

    setView(view, { fromPoint = false } = {}) {
      if (view !== 'source' && view !== 'analysis') return;
      if (!this.isSplit()) {
        if (this.shell.dataset.view === 'analysis') this.mobilePointScroll = window.scrollY;
        else this.sourcePageScroll = window.scrollY;
      }

      this.shell.dataset.view = view;
      this.viewAnalysisBtn.setAttribute('aria-pressed', String(view === 'analysis'));
      this.viewSourceBtn.setAttribute('aria-pressed', String(view === 'source'));

      if (!this.isSplit()) {
        window.scrollTo({
          top: view === 'analysis' ? this.mobilePointScroll : (fromPoint ? 0 : this.sourcePageScroll),
          behavior: 'auto'
        });
        if (fromPoint) {
          this.viewSourceBtn.focus({ preventScroll: true });
        } else if (view === 'analysis' && this.activePointId) {
          this.entries.get(this.activePointId)?.button.focus({ preventScroll: true });
        }
      }
    }

    getState() {
      return {
        activeKind: this.activeKind,
        activePointId: this.activePointId,
        overview: this.overview,
        evidenceIndex: this.evidenceIndex,
        split: this.isSplit(),
        isMounted: this.isMounted
      };
    }

    destroy() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.onResizeBound) {
        window.removeEventListener('resize', this.onResizeBound);
        this.onResizeBound = null;
      }
      if (this.onKeydownBound) {
        document.removeEventListener('keydown', this.onKeydownBound);
        this.onKeydownBound = null;
      }
      if (this.container) {
        this.container.replaceChildren();
      }
      this.activePointId = null;
      this.overview = false;
      this.activeEvidence = [];
      this.evidenceIndex = -1;
      this.entries.clear();
      this.isMounted = false;
    }
  }

  const api = { SWTReviewController };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SWTReview = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
