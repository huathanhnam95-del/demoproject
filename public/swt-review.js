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

  function normalizePhrase(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\s\u00A0\u202F\u2007]+/g, ' ')
      .trim();
  }

  function findPhraseOccurrences(source, phrase) {
    if (typeof source !== 'string' || typeof phrase !== 'string') return [];
    const trimmed = phrase.trim();
    if (!trimmed) return [];

    const normPhrase = normalizePhrase(trimmed).toLowerCase();
    if (!normPhrase) return [];

    // 1. Direct exact search
    const matches = [];
    let pos = 0;
    while ((pos = source.indexOf(trimmed, pos)) !== -1) {
      matches.push({ start: pos, end: pos + trimmed.length, quote: source.slice(pos, pos + trimmed.length) });
      pos += trimmed.length;
    }
    if (matches.length > 0) return matches;

    // 2. Normalized fallback (curly quotes, dashes, unicode spaces, zero-width chars)
    let normSource = '';
    const indexMap = [];
    let inWhitespace = false;

    const zeroWidthRegex = /[\u200B-\u200D\u2060\uFEFF\u00AD]/;
    const singleQuoteRegex = /[\u2018\u2019\u201A\u201B\u2032]/;
    const doubleQuoteRegex = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/;
    const dashRegex = /[\u2010-\u2015\u2212]/;
    const spaceRegex = /[\s\u00A0\u202F\u2007]/;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (zeroWidthRegex.test(ch)) {
        continue;
      }
      let normCh = ch;
      if (singleQuoteRegex.test(ch)) normCh = "'";
      else if (doubleQuoteRegex.test(ch)) normCh = '"';
      else if (dashRegex.test(ch)) normCh = '-';

      if (spaceRegex.test(ch)) {
        if (!inWhitespace) {
          normSource += ' ';
          indexMap.push(i);
          inWhitespace = true;
        }
      } else {
        normSource += normCh.toLowerCase();
        indexMap.push(i);
        inWhitespace = false;
      }
    }

    let nPos = 0;
    while ((nPos = normSource.indexOf(normPhrase, nPos)) !== -1) {
      const origStart = indexMap[nPos];
      const nEnd = nPos + normPhrase.length - 1;
      let origEnd = indexMap[nEnd] !== undefined ? indexMap[nEnd] + 1 : undefined;
      if (origStart !== undefined && origEnd !== undefined && origEnd > origStart) {
        while (origEnd < source.length && zeroWidthRegex.test(source[origEnd])) {
          origEnd++;
        }
        matches.push({
          start: origStart,
          end: origEnd,
          quote: source.slice(origStart, origEnd)
        });
      }
      nPos += normPhrase.length;
    }

    return matches;
  }

  function buildSampleSegments(text, ranges) {
    if (typeof text !== 'string') return [];
    if (!Array.isArray(ranges) || !ranges.length) {
      return [{ text, start: 0, end: text.length, pointIds: [] }];
    }
    const validRanges = ranges.filter(r =>
      r &&
      typeof r.start === 'number' &&
      typeof r.end === 'number' &&
      Number.isInteger(r.start) &&
      Number.isInteger(r.end) &&
      r.start >= 0 &&
      r.end <= text.length &&
      r.end > r.start
    );
    if (!validRanges.length) {
      return [{ text, start: 0, end: text.length, pointIds: [] }];
    }
    const boundaries = new Set([0, text.length]);
    for (const r of validRanges) {
      boundaries.add(r.start);
      boundaries.add(r.end);
    }
    const cuts = [...boundaries].sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i];
      const end = cuts[i + 1];
      if (start === end) continue;
      const matchingRanges = validRanges.filter(r => r.start < end && r.end > start);
      const pointIds = [...new Set(matchingRanges.map(r => r.pointId).filter(Boolean))];
      segments.push({
        text: text.slice(start, end),
        start,
        end,
        pointIds
      });
    }
    return segments;
  }

  class SWTReviewController {
    constructor() {
      this.container = null;
      this.question = null;
      this.sourceText = '';
      this.analysis = null;
      this.activeKind = 'core'; // 'core' | 'ignore' | 'sample'
      this.activePointId = null;
      this.overview = false;
      this.activeEvidence = [];
      this.evidenceIndex = -1;
      this.entries = new Map();
      this.tabScroll = { core: 0, ignore: 0, sample: 0 };
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
      if (this.activeKind === 'ignore') return this.analysis.ignorePoints || [];
      return this.analysis.corePoints || [];
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
              <button type="button" class="swt-review-view-btn" data-view="analysis" aria-pressed="true" aria-controls="swt-review-analysis-pane">Points &amp; explanation</button>
              <button type="button" class="swt-review-view-btn" data-view="source" aria-pressed="false" aria-controls="swt-review-source-pane">Original passage</button>
            </div>

            <div class="swt-review-workspace">
              <!-- Left Pane: Original Passage -->
              <section id="swt-review-source-pane" class="swt-review-pane swt-review-source-pane" aria-labelledby="swt-review-passage-title">
                <header class="swt-review-pane-head swt-review-source-head">
                  <div>
                    <h4 id="swt-review-passage-title" class="swt-review-pane-title">Original passage</h4>
                    <p class="swt-review-meta swt-review-question-meta"></p>
                  </div>
                  <div class="swt-review-source-actions">
                    <button type="button" class="swt-review-small-button swt-review-show-all-btn swt-review-show-all-passage-btn" aria-pressed="false" aria-controls="swt-review-source-passage">Show all points</button>
                    <button type="button" class="swt-review-small-button swt-review-clear-btn">Clear highlights</button>
                  </div>
                </header>
                <div class="swt-review-pane-body swt-review-source-scroll" tabindex="0" role="region" aria-label="Original passage, scrollable in side-by-side view">
                  <div id="swt-review-source-passage" class="swt-review-passage"></div>
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
              <section id="swt-review-analysis-pane" class="swt-review-pane swt-review-analysis-pane" aria-labelledby="swt-review-analysis-title">
                <header class="swt-review-pane-head swt-review-analysis-head">
                  <h4 id="swt-review-analysis-title" class="swt-review-pane-title">Answer breakdown</h4>
                  <p class="swt-review-meta">Select an idea. See the words that support it.</p>
                  <div class="swt-review-tabs" role="tablist" aria-label="Answer point category">
                    <button id="swt-review-tab-core" class="swt-review-tab swt-review-tab-core" data-kind="core" type="button" role="tab" aria-selected="true" aria-controls="swt-review-panel-core" tabindex="0">Core points <span class="swt-review-tab-count swt-review-count-core"></span></button>
                    <button id="swt-review-tab-ignore" class="swt-review-tab swt-review-tab-ignore" data-kind="ignore" type="button" role="tab" aria-selected="false" aria-controls="swt-review-panel-ignore" tabindex="-1">Points to ignore <span class="swt-review-tab-count swt-review-count-ignore"></span></button>
                    <button id="swt-review-tab-sample" class="swt-review-tab swt-review-tab-sample" data-kind="sample" type="button" role="tab" aria-selected="false" aria-controls="swt-review-panel-sample" tabindex="-1">Example summary <span class="swt-review-tab-count swt-review-count-sample"></span></button>
                  </div>
                </header>
                <div class="swt-review-pane-body swt-review-analysis-scroll" tabindex="0" role="region" aria-label="Points and explanations, scrollable in side-by-side view">
                  <div id="swt-review-panel-core" class="swt-review-panel swt-review-panel-core" role="tabpanel" aria-labelledby="swt-review-tab-core">
                    <div class="swt-review-list-tools">
                      <p>Preserve these ideas in your own words.</p>
                      <button type="button" class="swt-review-small-button swt-review-show-all swt-review-show-all-core" aria-pressed="false" aria-controls="swt-review-source-passage">Highlight all</button>
                    </div>
                    <ol class="swt-review-point-list swt-review-core-list"></ol>
                    <p class="swt-review-note">Keep the meaning, not necessarily the exact wording. Unhighlighted text is not automatically irrelevant.</p>
                  </div>
                  <div id="swt-review-panel-ignore" class="swt-review-panel swt-review-panel-ignore" role="tabpanel" aria-labelledby="swt-review-tab-ignore" hidden>
                    <div class="swt-review-list-tools">
                      <p>Details you can omit—not factual errors.</p>
                      <button type="button" class="swt-review-small-button swt-review-show-all swt-review-show-all-ignore" aria-pressed="false" aria-controls="swt-review-source-passage">Highlight all</button>
                    </div>
                    <ol class="swt-review-point-list swt-review-ignore-list"></ol>
                    <p class="swt-review-note">These choices apply to this passage. Dates, names and figures are not always optional. Each item explains why it can be left out here.</p>
                  </div>
                  <div id="swt-review-panel-sample" class="swt-review-panel swt-review-panel-sample" role="tabpanel" aria-labelledby="swt-review-tab-sample" hidden>
                    <div class="swt-review-sample-body">
                      <div class="swt-review-sample-tabs" role="tablist" aria-label="Example summary versions" hidden></div>
                      <div id="swt-review-sample-panel" class="swt-review-sample-panel">
                        <div class="swt-review-sample-desc" hidden></div>
                        <div class="swt-review-sample-legend" role="group" aria-label="Core points in sample summary" hidden></div>
                        <p class="swt-review-sample-summary"></p>
                        <small class="swt-review-summary-meta"></small>
                        <div class="swt-review-paraphrase-guide" hidden></div>
                      </div>
                    </div>
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
      this.showAllPassageBtn = c.querySelector('.swt-review-show-all-passage-btn');
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
      this.tabSample = c.querySelector('.swt-review-tab-sample');
      this.countCore = c.querySelector('.swt-review-count-core');
      this.countIgnore = c.querySelector('.swt-review-count-ignore');
      this.countSample = c.querySelector('.swt-review-count-sample');
      this.analysisScroll = c.querySelector('.swt-review-analysis-scroll');
      this.panelCore = c.querySelector('.swt-review-panel-core');
      this.panelIgnore = c.querySelector('.swt-review-panel-ignore');
      this.panelSample = c.querySelector('.swt-review-panel-sample');
      this.showAllCore = c.querySelector('.swt-review-show-all-core');
      this.showAllIgnore = c.querySelector('.swt-review-show-all-ignore');
      this.coreList = c.querySelector('.swt-review-core-list');
      this.ignoreList = c.querySelector('.swt-review-ignore-list');
      this.sampleSummaryDetails = c.querySelector('.swt-review-sample');
      this.sampleSummaryTabs = c.querySelector('.swt-review-sample-tabs');
      this.sampleSummaryPanel = c.querySelector('#swt-review-sample-panel');
      this.sampleSummaryDesc = c.querySelector('.swt-review-sample-desc');
      this.sampleSummaryLegend = c.querySelector('.swt-review-sample-legend');
      this.sampleSummary = c.querySelector('.swt-review-sample-summary');
      this.summaryMeta = c.querySelector('.swt-review-summary-meta');
      this.paraphraseGuide = c.querySelector('.swt-review-paraphrase-guide');

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

      this.setupSampleSummary();
    }

    setupSampleSummary() {
      const raw = this.analysis?.sampleSummary || this.analysis?.sampleSummaries;
      if (!raw) {
        if (this.activeKind === 'sample') this.setCategory('core');
        if (this.tabSample) {
          this.tabSample.hidden = true;
          this.tabSample.tabIndex = -1;
        }
        if (this.panelSample) this.panelSample.hidden = true;
        if (this.countSample) this.countSample.textContent = '';
        if (this.sampleSummaryDetails) this.sampleSummaryDetails.hidden = true;
        if (this.sampleSummary) this.sampleSummary.textContent = '';
        if (this.summaryMeta) this.summaryMeta.textContent = '';
        if (this.sampleSummaryDesc) this.sampleSummaryDesc.textContent = '';
        if (this.sampleSummaryTabs) this.sampleSummaryTabs.hidden = true;
        if (this.sampleSummaryLegend) {
          this.sampleSummaryLegend.hidden = true;
          this.sampleSummaryLegend.replaceChildren();
        }
        this.sampleVersions = [];
        this.activeSampleVersionId = null;
        return;
      }

      let versions = [];
      if (typeof raw === 'string') {
        const text = raw.trim();
        if (text) {
          versions = [{
            id: 'versionA',
            label: 'Example Summary',
            tagline: '',
            text,
            pointHighlights: []
          }];
        }
      } else if (Array.isArray(raw)) {
        versions = raw.map((item, idx) => {
          const rawObj = (item && typeof item === 'object') ? item : { text: String(item) };
          const key = rawObj.id || `version${idx === 0 ? 'A' : idx === 1 ? 'B' : idx + 1}`;
          let defaultLabel;
          if (/^version_?a$/i.test(key) || idx === 0) {
            defaultLabel = 'Version A (Simple)';
          } else if (/^version_?b$/i.test(key) || idx === 1) {
            defaultLabel = 'Version B (Advanced)';
          } else if (/^version/i.test(key)) {
            defaultLabel = key.replace(/^version_?([A-Za-z0-9])/i, (_, c) => `Version ${c.toUpperCase()}`);
          } else {
            defaultLabel = `Version ${idx + 1}`;
          }
          return {
            id: rawObj.id || (idx === 0 ? 'versionA' : idx === 1 ? 'versionB' : `version-${idx + 1}`),
            label: rawObj.label || rawObj.title || defaultLabel,
            tagline: rawObj.tagline || rawObj.description || '',
            text: (rawObj.text || rawObj.summary || String(item)).trim(),
            pointHighlights: Array.isArray(rawObj.pointHighlights) ? rawObj.pointHighlights : (Array.isArray(rawObj.highlights) ? rawObj.highlights : []),
            paraphrasingGuide: Array.isArray(rawObj.paraphrasingGuide) ? rawObj.paraphrasingGuide.filter(g => g && typeof g === 'object') : []
          };
        }).filter(v => v.text);
      } else if (typeof raw === 'object') {
        versions = Object.entries(raw).map(([key, val], idx) => {
          let defaultLabel;
          if (/^version_?a$/i.test(key) || idx === 0) {
            defaultLabel = 'Version A (Simple)';
          } else if (/^version_?b$/i.test(key) || idx === 1) {
            defaultLabel = 'Version B (Advanced)';
          } else if (/^version/i.test(key)) {
            defaultLabel = key.replace(/^version_?([A-Za-z0-9])/i, (_, c) => `Version ${c.toUpperCase()}`);
          } else {
            defaultLabel = `Version ${idx + 1}`;
          }
          if (typeof val === 'string') {
            return {
              id: key,
              label: defaultLabel,
              tagline: '',
              text: val.trim(),
              pointHighlights: [],
              paraphrasingGuide: []
            };
          }
          return {
            id: val.id || key,
            label: val.label || val.title || defaultLabel,
            tagline: val.tagline || val.description || '',
            text: (val.text || val.summary || '').trim(),
            pointHighlights: Array.isArray(val.pointHighlights) ? val.pointHighlights : (Array.isArray(val.highlights) ? val.highlights : []),
            paraphrasingGuide: Array.isArray(val.paraphrasingGuide) ? val.paraphrasingGuide.filter(g => g && typeof g === 'object') : []
          };
        }).filter(v => v.text);
      } else {
        console.warn('[SWT Review] Unsupported sampleSummary format:', typeof raw);
      }

      if (!versions.length) {
        if (this.activeKind === 'sample') this.setCategory('core');
        if (this.tabSample) {
          this.tabSample.hidden = true;
          this.tabSample.tabIndex = -1;
        }
        if (this.panelSample) this.panelSample.hidden = true;
        if (this.countSample) this.countSample.textContent = '';
        if (this.sampleSummaryDetails) this.sampleSummaryDetails.hidden = true;
        if (this.sampleSummary) this.sampleSummary.textContent = '';
        if (this.summaryMeta) this.summaryMeta.textContent = '';
        if (this.sampleSummaryDesc) this.sampleSummaryDesc.textContent = '';
        if (this.sampleSummaryTabs) this.sampleSummaryTabs.hidden = true;
        if (this.sampleSummaryLegend) {
          this.sampleSummaryLegend.hidden = true;
          this.sampleSummaryLegend.replaceChildren();
        }
        if (this.paraphraseGuide) {
          this.paraphraseGuide.hidden = true;
          this.paraphraseGuide.replaceChildren();
        }
        this.sampleVersions = [];
        this.activeSampleVersionId = null;
        return;
      }

      if (this.tabSample) this.tabSample.hidden = false;
      if (this.countSample) this.countSample.textContent = String(versions.length);
      if (this.sampleSummaryDetails) this.sampleSummaryDetails.hidden = false;
      this.sampleVersions = versions;
      this.activeSampleVersionId = versions[0].id;

      if (this.sampleSummaryTabs) {
        if (versions.length > 1) {
          this.sampleSummaryTabs.hidden = false;
          this.sampleSummaryTabs.replaceChildren();
          versions.forEach((v, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'swt-review-sample-tab';
            btn.id = `swt-review-sample-tab-${v.id}`;
            btn.dataset.version = v.id;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
            btn.setAttribute('aria-controls', 'swt-review-sample-panel');
            btn.tabIndex = idx === 0 ? 0 : -1;
            btn.textContent = v.label;

            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.selectSampleVersion(v.id);
            });
            this.sampleSummaryTabs.append(btn);
          });
          if (this.sampleSummaryPanel) {
            this.sampleSummaryPanel.setAttribute('role', 'tabpanel');
            this.sampleSummaryPanel.setAttribute('aria-labelledby', `swt-review-sample-tab-${this.activeSampleVersionId}`);
          }
        } else {
          this.sampleSummaryTabs.hidden = true;
          if (this.sampleSummaryPanel) {
            this.sampleSummaryPanel.removeAttribute('role');
            this.sampleSummaryPanel.removeAttribute('aria-labelledby');
          }
        }
      }

      this.renderActiveSampleVersion();
    }

    getPointIndex(pointId) {
      if (!pointId || !this.analysis?.corePoints) return 0;
      const idx = this.analysis.corePoints.findIndex(p => p.id === pointId);
      if (idx !== -1) return idx;
      const m = String(pointId).match(/\d+/);
      return m ? (parseInt(m[0], 10) - 1) : 0;
    }

    selectSampleVersion(id) {
      if (!this.sampleVersions?.some(v => v.id === id)) return;
      this.activeSampleVersionId = id;

      if (this.sampleSummaryTabs) {
        const tabs = this.sampleSummaryTabs.querySelectorAll('.swt-review-sample-tab');
        tabs.forEach(tab => {
          const isSelected = tab.dataset.version === id;
          tab.setAttribute('aria-selected', String(isSelected));
          tab.tabIndex = isSelected ? 0 : -1;
        });
      }

      if (this.sampleSummaryPanel && this.sampleVersions?.length > 1) {
        this.sampleSummaryPanel.setAttribute('aria-labelledby', `swt-review-sample-tab-${id}`);
      }

      if (this.analysisScroll) {
        this.analysisScroll.scrollTop = 0;
      }

      this.renderActiveSampleVersion();
    }

    renderActiveSampleVersion() {
      const v = this.sampleVersions?.find(item => item.id === this.activeSampleVersionId) || this.sampleVersions?.[0];
      if (!v) return;

      if (this.sampleSummaryDesc) {
        if (v.tagline) {
          this.sampleSummaryDesc.textContent = v.tagline;
          this.sampleSummaryDesc.hidden = false;
        } else {
          this.sampleSummaryDesc.hidden = true;
          this.sampleSummaryDesc.textContent = '';
        }
      }

      this.renderSampleSummaryLegend(v);

      if (this.sampleSummary) {
        this.renderSampleSummaryText(this.sampleSummary, v.text, v.pointHighlights);
      }

      if (this.summaryMeta) {
        const sampleWords = v.text.trim().split(/\s+/).filter(Boolean).length;
        this.summaryMeta.textContent = `${sampleWords} words (Target: 50–70 words) · Illustrative answer, not an official answer key.`;
      }

      this.renderParaphrasingGuide(v);

      this.updatePointUI();
    }

    renderParaphrasingGuide(version) {
      if (!this.paraphraseGuide) return;
      const rawItems = Array.isArray(version?.paraphrasingGuide) ? version.paraphrasingGuide : [];
      const items = rawItems.filter(item => item && typeof item === 'object');

      if (!items.length) {
        this.paraphraseGuide.hidden = true;
        this.paraphraseGuide.replaceChildren();
        return;
      }

      const doc = this.container?.ownerDocument || (typeof document !== 'undefined' ? document : null);
      if (!doc) return;

      this.paraphraseGuide.hidden = false;
      this.paraphraseGuide.replaceChildren();

      const header = doc.createElement('div');
      header.className = 'swt-paraphrase-header';

      const title = doc.createElement('h4');
      title.className = 'swt-paraphrase-title';
      title.textContent = 'Paraphrasing Guide';

      const subtitle = doc.createElement('span');
      subtitle.className = 'swt-paraphrase-subtitle';
      subtitle.textContent = `${items.length} key transformation${items.length === 1 ? '' : 's'} used in this summary:`;

      header.append(title, subtitle);
      this.paraphraseGuide.append(header);

      const list = doc.createElement('div');
      list.className = 'swt-paraphrase-list';
      list.setAttribute('role', 'list');

      items.forEach((item) => {
        const itemEl = doc.createElement('div');
        itemEl.className = 'swt-paraphrase-item';
        itemEl.setAttribute('role', 'listitem');

        const metaEl = doc.createElement('div');
        metaEl.className = 'swt-paraphrase-meta';

        const badge = doc.createElement('span');
        const rawType = (item && item.type) ? String(item.type).toLowerCase() : '';
        const itemType = (rawType === 'structure' || rawType === 'synonym') ? rawType : (rawType ? rawType.replace(/[^a-z0-9_-]/g, '') : 'synonym');
        badge.className = `swt-paraphrase-badge swt-paraphrase-badge--${itemType}`;
        badge.textContent = item.technique || item.label || (itemType === 'structure' ? 'Structure' : 'Synonym');
        metaEl.append(badge);

        const transEl = doc.createElement('div');
        transEl.className = 'swt-paraphrase-transformation';

        const origText = item.original || item.originalPhrase || '';
        const origEl = doc.createElement('span');
        origEl.className = 'swt-paraphrase-original';
        origEl.textContent = origText ? `“${origText}”` : '';

        const arrowEl = doc.createElement('span');
        arrowEl.className = 'swt-paraphrase-arrow';
        arrowEl.setAttribute('aria-hidden', 'true');
        arrowEl.textContent = '→';

        const srEl = doc.createElement('span');
        srEl.className = 'sr-only';
        srEl.textContent = 'paraphrased as';

        const resText = item.paraphrased || item.paraphrasedPhrase || '';
        const resultEl = doc.createElement('span');
        resultEl.className = 'swt-paraphrase-result';
        resultEl.textContent = resText ? `“${resText}”` : '';

        transEl.append(origEl, arrowEl, srEl, resultEl);

        const noteText = item.note || item.explanation;
        let noteEl = null;
        if (noteText) {
          noteEl = doc.createElement('p');
          noteEl.className = 'swt-paraphrase-note';
          noteEl.textContent = noteText;
        }

        itemEl.append(metaEl, transEl);
        if (noteEl) itemEl.append(noteEl);

        list.append(itemEl);
      });

      this.paraphraseGuide.append(list);
    }

    renderSampleSummaryLegend(version) {
      if (!this.sampleSummaryLegend) return;
      const corePoints = this.analysis?.corePoints || [];
      const hasHighlights = Boolean(version?.pointHighlights && version.pointHighlights.length);
      const hasMatchingHighlights = hasHighlights && version.pointHighlights.some(item => {
        const phrases = Array.isArray(item.phrases)
          ? item.phrases
          : (item.phrase ? [item.phrase] : (item.text ? [item.text] : []));
        return phrases.some(p => findPhraseOccurrences(version.text, p).length > 0);
      });

      if (!corePoints.length || !hasMatchingHighlights) {
        this.sampleSummaryLegend.hidden = true;
        this.sampleSummaryLegend.replaceChildren();
        return;
      }

      this.sampleSummaryLegend.hidden = false;
      this.sampleSummaryLegend.replaceChildren();

      const titleEl = document.createElement('span');
      titleEl.className = 'swt-sample-legend-title';
      titleEl.textContent = 'Core points:';
      this.sampleSummaryLegend.append(titleEl);

      corePoints.forEach((cp, idx) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `swt-sample-legend-item swt-point-${idx + 1}`;
        item.dataset.pointId = cp.id;
        item.dataset.pointIndex = String(idx);
        item.title = `Core point ${idx + 1}: ${cp.label}`;
        item.setAttribute('aria-label', `Core point ${idx + 1}: ${cp.label}`);
        item.setAttribute('aria-pressed', String(cp.id === this.activePointId));

        const chip = document.createElement('span');
        chip.className = 'swt-sample-legend-chip';
        chip.textContent = String(idx + 1).padStart(2, '0');
        chip.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'swt-sample-legend-label';
        label.textContent = `Point ${idx + 1}`;

        item.append(chip, label);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectPoint(this.activePointId === cp.id ? null : cp.id);
        });

        // ArrowLeft / ArrowRight / Home / End keyboard loop wrapping
        item.addEventListener('keydown', (e) => {
          const items = Array.from(this.sampleSummaryLegend.querySelectorAll('.swt-sample-legend-item'));
          const currentIdx = items.indexOf(item);
          if (currentIdx === -1) return;
          let nextIdx = -1;

          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            nextIdx = (currentIdx + 1) % items.length;
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            nextIdx = (currentIdx - 1 + items.length) % items.length;
          } else if (e.key === 'Home') {
            e.preventDefault();
            nextIdx = 0;
          } else if (e.key === 'End') {
            e.preventDefault();
            nextIdx = items.length - 1;
          }

          if (nextIdx >= 0 && nextIdx !== currentIdx) {
            items[nextIdx].focus();
          }
        });

        this.sampleSummaryLegend.append(item);
      });
    }

    renderSampleSummaryText(container, text, highlights) {
      container.replaceChildren();
      if (!highlights || !highlights.length) {
        container.textContent = text;
        return;
      }

      const ranges = [];
      for (const item of highlights) {
        const pointId = item.pointId || item.id;
        const phrases = Array.isArray(item.phrases)
          ? item.phrases
          : (item.phrase ? [item.phrase] : (item.text ? [item.text] : []));

        for (const phrase of phrases) {
          if (typeof phrase !== 'string' || !phrase.trim()) continue;
          const matches = findPhraseOccurrences(text, phrase);
          for (const m of matches) {
            ranges.push({ ...m, pointId });
          }
        }
      }

      if (!ranges.length) {
        container.textContent = text;
        return;
      }

      const segments = buildSampleSegments(text, ranges);
      const doc = container.ownerDocument;
      const fragment = doc.createDocumentFragment();

      for (const seg of segments) {
        if (!seg.pointIds.length) {
          fragment.appendChild(doc.createTextNode(seg.text));
        } else {
          const mark = doc.createElement('mark');
          const pointIndices = seg.pointIds.map(pid => this.getPointIndex(pid));
          const primaryPointId = seg.pointIds[0];
          const primaryIndex = pointIndices[0];

          mark.className = 'swt-sample-highlight ' +
            seg.pointIds.map(pid => `swt-sample-highlight--${pid}`).join(' ') + ' ' +
            pointIndices.map(idx => `swt-point-${idx + 1}`).join(' ');

          mark.dataset.pointId = primaryPointId;
          mark.dataset.pointIds = seg.pointIds.join(' ');
          mark.dataset.pointIndex = String(primaryIndex);
          mark.dataset.pointIndices = pointIndices.join(' ');
          mark.dataset.sourceStart = String(seg.start);
          mark.dataset.sourceEnd = String(seg.end);

          const pointLabels = seg.pointIds.map(pid => {
            const pObj = this.analysis?.corePoints?.find(p => p.id === pid);
            const pIdx = this.getPointIndex(pid);
            return pObj ? `Core point ${pIdx + 1}: ${pObj.label}` : `Point ${pIdx + 1}`;
          });

          mark.title = pointLabels.join(' | ');
          mark.setAttribute('aria-label', `${pointLabels[0]}: ${seg.text}`);
          mark.tabIndex = 0;
          mark.setAttribute('role', 'button');
          mark.setAttribute('aria-pressed', 'false');
          mark.textContent = seg.text;

          mark.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.activePointId && seg.pointIds.includes(this.activePointId)) {
              this.selectPoint(null);
            } else {
              this.selectPoint(primaryPointId);
            }
          });

          mark.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              mark.click();
            }
          });

          fragment.appendChild(mark);
        }
      }

      container.appendChild(fragment);
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
        item.dataset.pointId = point.id;
        item.dataset.pointIndex = String(index);
        if (kind === 'core') {
          item.classList.add(`swt-point-${index + 1}`);
        }

        const button = document.createElement('button');
        button.className = 'swt-review-point-button';
        button.type = 'button';
        button.id = `point-${point.id}`;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', `swt-review-source-passage detail-${point.id}`);

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

        detail.append(whyLabel, rationale);
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

      // Show all points from passage header
      this.showAllPassageBtn?.addEventListener('click', () => {
        if (this.overview && this.activeKind === 'core') {
          this.selectPoint(null, { scroll: false });
        } else {
          if (this.activeKind !== 'core') {
            this.setCategory('core');
          }
          this.highlightAll();
        }
      });

      // Evidence nav
      this.prevEvidenceBtn.addEventListener('click', () => this.selectEvidence(this.evidenceIndex - 1, true));
      this.nextEvidenceBtn.addEventListener('click', () => this.selectEvidence(this.evidenceIndex + 1, true));

      // Category tabs
      const categoryTabs = [
        { btn: this.tabCore, kind: 'core' },
        { btn: this.tabIgnore, kind: 'ignore' },
        { btn: this.tabSample, kind: 'sample' }
      ];

      categoryTabs.forEach(({ btn, kind }) => {
        if (!btn) return;
        btn.addEventListener('click', () => this.setCategory(kind));
        btn.addEventListener('keydown', (event) => {
          const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
          if (!keys.includes(event.key)) return;
          event.preventDefault();

          const available = categoryTabs.filter(t => t.btn && !t.btn.hidden);
          if (!available.length) return;

          const currentIdx = available.findIndex(t => t.kind === kind);
          let nextIdx = -1;

          if (event.key === 'Home') {
            nextIdx = 0;
          } else if (event.key === 'End') {
            nextIdx = available.length - 1;
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIdx = (currentIdx + 1) % available.length;
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIdx = (currentIdx - 1 + available.length) % available.length;
          }

          if (nextIdx >= 0 && nextIdx < available.length) {
            this.setCategory(available[nextIdx].kind, { focus: true });
          }
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
          const epoch = this.selectionEpoch;
          requestAnimationFrame(() => {
            if (this.isMounted && epoch === this.selectionEpoch) {
              this.ensureEvidenceVisible();
            }
          });
        }
      });

      // Mobile view switch buttons keyboard navigation (ArrowLeft / ArrowRight / Home / End loop wrapping)
      const mobileSwitch = this.container?.querySelector('.swt-review-mobile-switch');
      if (mobileSwitch) {
        mobileSwitch.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const currentView = this.shell?.dataset?.view || 'analysis';
            let nextView;
            if (event.key === 'Home') nextView = 'analysis';
            else if (event.key === 'End') nextView = 'source';
            else nextView = currentView === 'analysis' ? 'source' : 'analysis';
            this.setView(nextView);
            const targetBtn = nextView === 'analysis' ? this.viewAnalysisBtn : this.viewSourceBtn;
            targetBtn?.focus({ preventScroll: true });
          }
        });
      }

      // Point list keyboard navigation (ArrowUp / ArrowDown loop wrapping)
      const bindListKeyboardNav = (listEl) => {
        if (!listEl) return;
        listEl.addEventListener('keydown', (event) => {
          const btns = Array.from(listEl.querySelectorAll('.swt-review-point-button'));
          if (!btns.length) return;
          const currentIdx = btns.indexOf(document.activeElement);
          if (currentIdx === -1) return;

          let nextIdx = -1;
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            nextIdx = (currentIdx + 1) % btns.length;
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            event.preventDefault();
            nextIdx = (currentIdx - 1 + btns.length) % btns.length;
          } else if (event.key === 'Home') {
            event.preventDefault();
            nextIdx = 0;
          } else if (event.key === 'End') {
            event.preventDefault();
            nextIdx = btns.length - 1;
          }

          if (nextIdx >= 0 && nextIdx !== currentIdx) {
            btns[nextIdx].focus();
          }
        });
      };
      bindListKeyboardNav(this.coreList);
      bindListKeyboardNav(this.ignoreList);

      // Sample summary version tabs keyboard navigation
      if (this.sampleSummaryTabs) {
        this.sampleSummaryTabs.addEventListener('keydown', (event) => {
          const tabs = Array.from(this.sampleSummaryTabs.querySelectorAll('.swt-review-sample-tab'));
          if (!tabs.length) return;
          let currentIdx = tabs.indexOf(document.activeElement);
          if (currentIdx < 0) {
            currentIdx = tabs.findIndex(t => t.dataset.version === this.activeSampleVersionId);
          }
          if (currentIdx < 0) currentIdx = 0;
          let nextIdx = -1;

          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            nextIdx = (currentIdx + 1) % tabs.length;
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
          } else if (event.key === 'Home') {
            event.preventDefault();
            nextIdx = 0;
          } else if (event.key === 'End') {
            event.preventDefault();
            nextIdx = tabs.length - 1;
          }

          if (nextIdx >= 0 && nextIdx !== currentIdx) {
            const nextTab = tabs[nextIdx];
            this.selectSampleVersion(nextTab.dataset.version);
            nextTab.focus();
          }
        });
      }

      // Keyboard escape
      this.onKeydownBound = (event) => {
        if (event.key === 'Escape' && (this.activePointId || this.overview)) {
          if (typeof document !== 'undefined' && (document.querySelector('.ra-v7-sheet.is-open') || document.querySelector('.modal.is-open, dialog[open]'))) {
            return;
          }
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
      if (!this.isMounted || !this.shell || !this.wrap) return;
      const prevSplit = this.isSplit();
      const wrapRect = this.wrap.getBoundingClientRect();
      if (wrapRect.width === 0 && wrapRect.height === 0 && !this.wrap.offsetParent) {
        return;
      }
      const split = wrapRect.width >= 1024 && window.innerHeight >= 600;

      this.shell.classList.toggle('is-split', split);
      this.introCopy.textContent = split
        ? 'Choose a point on the right. Its evidence lights up on the left—without moving the page.'
        : 'Choose a point, then switch between its explanation and the highlighted passage.';

      if (prevSplit !== split) {
        if (split) {
          // If transitioning to desktop split and no point is selected, auto-select first core point
          if (!this.activePointId && !this.overview) {
            const firstId = this.analysis?.corePoints?.[0]?.id || null;
            if (firstId) this.selectPoint(firstId, { scroll: false, openSource: false });
          }
        } else {
          // Narrowing down to stacked/mobile view: preserve visible panel and focus
          const focused = document.activeElement;
          if (this.sourcePane?.contains(focused)) this.setView('source');
          else if (this.analysisPane?.contains(focused)) this.setView('analysis');
          else if (this.activePointId || this.overview) this.setView('source');
        }
      }
    }

    redraw(points, kind) {
      const oldTop = this.sourceScroll ? this.sourceScroll.scrollTop : 0;
      const pointsWithIndices = points.map(p => {
        const entry = this.entries.get(p.id);
        const pointIndex = (entry && typeof entry.index === 'number')
          ? entry.index
          : this.getPointIndex(p.id);
        return (typeof p.pointIndex === 'number') ? p : { ...p, pointIndex };
      });
      if (this.evidenceEngine && this.source) {
        this.evidenceEngine.renderSource(this.source, this.sourceText, pointsWithIndices, kind);
      }
      if (this.sourceScroll) {
        this.sourceScroll.scrollTop = oldTop;
      }
      this.activeEvidence = points
        .flatMap(p => (p.evidence || []).map((e, i) => ({ ...e, pointId: p.id, excerptIndex: i })))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      this.evidenceIndex = this.activeEvidence.length ? 0 : -1;

      if (this.source && typeof this.source.querySelectorAll === 'function' && (kind === 'core' || kind === 'sample')) {
        this.source.querySelectorAll('mark').forEach(m => {
          const indices = (m.dataset.pointIndices || '').split(/\s+/).filter(Boolean);
          indices.forEach(idx => {
            const num = parseInt(idx, 10);
            if (!Number.isNaN(num) && num >= 0) {
              m.classList.add(`swt-point-${num + 1}`);
            }
          });
        });
      }
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
      if (entry && this.activeKind !== 'sample') this.activeKind = entry.kind;
      this.updatePointUI();

      // Preserve the clicked row's position when a preceding explanation collapses.
      if (this.isSplit() && entry && this.analysisScroll && this.activeKind !== 'sample') {
        this.analysisScroll.scrollTop = oldRightScroll + entry.button.getBoundingClientRect().top - oldButtonTop;
      }

      if (entry && openSource && !this.isSplit()) {
        this.setView('source', { fromPoint: true });
      }

      this.updateEvidenceUI();

      const epoch = this.selectionEpoch;
      if (scroll && this.activeEvidence.length) {
        requestAnimationFrame(() => {
          if (epoch === this.selectionEpoch && this.isMounted) this.ensureEvidenceVisible();
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
      const isCoreOverview = Boolean(this.overview && this.activeKind === 'core');
      this.showAllCore?.setAttribute('aria-pressed', String(isCoreOverview));
      this.showAllPassageBtn?.setAttribute('aria-pressed', String(isCoreOverview));
      this.showAllPassageBtn?.classList.toggle('is-active', isCoreOverview);
      this.showAllIgnore?.setAttribute('aria-pressed', String(this.overview && this.activeKind === 'ignore'));

      if (this.sampleSummaryLegend) {
        const legendItems = this.sampleSummaryLegend.querySelectorAll('.swt-sample-legend-item');
        legendItems.forEach(item => {
          const isSelected = item.dataset.pointId === this.activePointId;
          item.classList.toggle('is-selected', isSelected);
          item.setAttribute('aria-pressed', String(isSelected));
        });
      }

      if (this.sampleSummary) {
        const marks = this.sampleSummary.querySelectorAll('.swt-sample-highlight');
        marks.forEach(m => {
          const pointIds = (m.dataset.pointIds || m.dataset.pointId || '').split(/\s+/).filter(Boolean);
          const isSelected = Boolean(this.activePointId && pointIds.includes(this.activePointId));
          m.classList.toggle('is-selected', isSelected);
          m.setAttribute('aria-pressed', String(isSelected));
          if (isSelected && this.activePointId) {
            const pIdx = this.getPointIndex(this.activePointId);
            m.style.setProperty('--selected-highlight-color', `var(--point-${pIdx + 1}-color)`);
          } else {
            m.style.removeProperty('--selected-highlight-color');
          }
        });
      }
    }

    highlightAll() {
      if (this.overview) {
        this.selectPoint(null, { scroll: false });
        return;
      }
      ++this.selectionEpoch;
      this.activePointId = null;
      this.overview = true;

      try {
        this.redraw(this.currentPoints(), this.activeKind);
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
        console.error('[SWT Review] Redraw failed in highlightAll:', error);
        return;
      }

      this.updatePointUI();
      this.updateEvidenceUI();
      if (!this.isSplit()) this.setView('source', { fromPoint: true });
      if (this.status) {
        const label = this.activeKind === 'ignore' ? 'optional details' : 'core points';
        this.status.textContent = `Showing all ${label}. Use the excerpt arrows to explore.`;
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
      if (!this.isMounted) return;
      const entry = this.entries.get(this.activePointId);
      if (this.sourceFoot) {
        this.sourceFoot.dataset.kind = entry ? entry.kind : this.activeKind;
        if (entry) {
          this.sourceFoot.dataset.pointId = entry.point.id;
          this.sourceFoot.dataset.pointIndex = String(entry.index);
        } else if (this.overview && this.activeEvidence[this.evidenceIndex]) {
          const curEv = this.activeEvidence[this.evidenceIndex];
          this.sourceFoot.dataset.pointId = curEv.pointId;
          this.sourceFoot.dataset.pointIndex = String(this.getPointIndex(curEv.pointId));
        } else {
          delete this.sourceFoot.dataset.pointId;
          delete this.sourceFoot.dataset.pointIndex;
        }
      }
      if (this.evidenceCaption) {
        this.evidenceCaption.textContent = entry
          ? `${entry.kind === 'core' ? 'Core point ' : 'Point to ignore '}${String(entry.index + 1).padStart(2, '0')}`
          : this.overview
            ? (this.activeKind === 'ignore' ? 'All points to ignore' : 'All core points')
            : 'Choose a point to see its evidence';
      }

      if (this.evidenceCounter) {
        this.evidenceCounter.textContent = this.activeEvidence.length
          ? (this.overview && this.activeKind !== 'ignore'
            ? `Excerpt ${this.evidenceIndex + 1} of ${this.activeEvidence.length} · All core points in distinct colors`
            : `Excerpt ${this.evidenceIndex + 1} of ${this.activeEvidence.length} · Exact wording from the passage`)
          : 'Core ideas and optional details use different underlines.';
      }

      if (this.prevEvidenceBtn) this.prevEvidenceBtn.disabled = this.evidenceIndex <= 0;
      if (this.nextEvidenceBtn) this.nextEvidenceBtn.disabled = this.evidenceIndex < 0 || this.evidenceIndex >= this.activeEvidence.length - 1;

      if (this.source) {
        const curEv = this.activeEvidence[this.evidenceIndex];
        const curPointIdx = curEv ? this.getPointIndex(curEv.pointId) : -1;
        this.source.querySelectorAll('.is-current-evidence').forEach(m => {
          m.classList.remove('is-current-evidence');
          m.style.removeProperty('--current-evidence-color');
        });
        if (curEv) {
          this.marksForEvidence(curEv).forEach(m => {
            m.classList.add('is-current-evidence');
            if (curPointIdx >= 0) {
              m.style.setProperty('--current-evidence-color', `var(--point-${curPointIdx + 1}-color)`);
            }
          });
        }
      }
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
      if (!this.isMounted) return;
      const mark = this.marksForEvidence(this.activeEvidence[this.evidenceIndex])[0];
      if (!mark) return;
      const rect = mark.getBoundingClientRect();

      if (this.isSplit() && this.sourceScroll) {
        const pane = this.sourceScroll.getBoundingClientRect();
        const top = pane.top + this.sourceScroll.clientTop;
        const bottom = top + this.sourceScroll.clientHeight;

        // Never call scrollIntoView here: only target the dedicated source scroll container!
        if (rect.top < top + 20 || rect.bottom > bottom - 20) {
          const position = this.sourceScroll.scrollTop + rect.top - top - Math.min(70, this.sourceScroll.clientHeight * 0.22);
          this.sourceScroll.scrollTo({ top: Math.max(0, position), behavior: this.behavior() });
        }
      } else if (this.shell?.dataset?.view === 'source') {
        const header = typeof document !== 'undefined' ? document.querySelector('.site-header') : null;
        const headerHeight = (header && typeof window !== 'undefined' && window.getComputedStyle(header).position === 'fixed')
          ? header.getBoundingClientRect().height
          : 0;
        const mobileSwitch = this.container ? this.container.querySelector('.swt-review-mobile-switch') : null;
        const switchHeight = mobileSwitch ? mobileSwitch.getBoundingClientRect().height : 48;
        const sticky = headerHeight + switchHeight + 16;
        if (rect.top < sticky || rect.bottom > window.innerHeight - 24) {
          window.scrollTo({
            top: Math.max(0, window.scrollY + rect.top - sticky - 20),
            behavior: this.behavior()
          });
        }
      }
    }

    getCategoryTab(kind) {
      if (kind === 'core') return this.tabCore;
      if (kind === 'ignore') return this.tabIgnore;
      if (kind === 'sample') return this.tabSample;
      return null;
    }

    getCategoryPanel(kind) {
      if (kind === 'core') return this.panelCore;
      if (kind === 'ignore') return this.panelIgnore;
      if (kind === 'sample') return this.panelSample;
      return null;
    }

    setCategory(kind, { focus = false } = {}) {
      if (kind !== 'core' && kind !== 'ignore' && kind !== 'sample') return;
      if (kind === 'sample' && (this.tabSample?.hidden || (this.isMounted && (!this.sampleVersions || !this.sampleVersions.length)))) return;
      if (kind === this.activeKind) {
        if (focus) this.getCategoryTab(kind)?.focus({ preventScroll: true });
        return;
      }

      const prevKind = this.activeKind;
      this.tabScroll[prevKind] = this.analysisScroll ? this.analysisScroll.scrollTop : 0;
      this.activeKind = kind;

      ['core', 'ignore', 'sample'].forEach(k => {
        const tab = this.getCategoryTab(k);
        const panel = this.getCategoryPanel(k);
        if (tab) {
          tab.setAttribute('aria-selected', String(k === kind));
          tab.tabIndex = k === kind ? 0 : -1;
        }
        if (panel) {
          panel.hidden = k !== kind;
        }
      });

      const currentEntry = this.activePointId && this.entries ? this.entries.get(this.activePointId) : null;
      const isCoreCompatible = currentEntry?.kind === 'core' && (kind === 'core' || kind === 'sample') && (prevKind === 'core' || prevKind === 'sample');
      if (!isCoreCompatible) {
        this.selectPoint(null, { scroll: false, openSource: false });
      } else {
        this.updatePointUI();
        this.updateEvidenceUI();
      }

      if (this.analysisScroll) {
        this.analysisScroll.scrollTop = this.tabScroll[kind] || 0;
      }
      if (focus) this.getCategoryTab(kind)?.focus({ preventScroll: true });
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
        const header = typeof document !== 'undefined' ? document.querySelector('.site-header') : null;
        const headerHeight = (header && typeof window !== 'undefined' && window.getComputedStyle(header).position === 'fixed')
          ? header.getBoundingClientRect().height
          : 0;
        const wrapTop = this.wrap ? (this.wrap.getBoundingClientRect().top + window.scrollY) : 0;
        const componentTop = Math.max(0, wrapTop - headerHeight - 12);

        let targetY;
        if (view === 'analysis') {
          targetY = this.mobilePointScroll || componentTop;
        } else if (fromPoint) {
          targetY = componentTop;
        } else {
          targetY = this.sourcePageScroll || componentTop;
        }

        window.scrollTo({
          top: targetY,
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
        evidenceCount: this.activeEvidence?.length || 0,
        view: this.shell?.dataset?.view || 'analysis',
        split: this.isSplit(),
        isSplit: this.isSplit(),
        isMounted: this.isMounted,
        activeSampleVersion: this.activeSampleVersionId || null,
        sampleVersionCount: this.sampleVersions?.length || 0
      };
    }

    destroy() {
      ++this.selectionEpoch;
      this.isMounted = false;
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
      this.container = null;
      this.shell = null;
      this.introCopy = null;
      this.wrap = null;
      this.workspace = null;
      this.sourcePane = null;
      this.sourceHead = null;
      this.questionMeta = null;
      this.showAllPassageBtn = null;
      this.clearBtn = null;
      this.sourceScroll = null;
      this.source = null;
      this.sourceFoot = null;
      this.evidenceCaption = null;
      this.evidenceCounter = null;
      this.prevEvidenceBtn = null;
      this.nextEvidenceBtn = null;
      this.analysisPane = null;
      this.tabCore = null;
      this.tabIgnore = null;
      this.tabSample = null;
      this.countCore = null;
      this.countIgnore = null;
      this.countSample = null;
      this.analysisScroll = null;
      this.panelCore = null;
      this.panelIgnore = null;
      this.panelSample = null;
      this.showAllCore = null;
      this.showAllIgnore = null;
      this.coreList = null;
      this.ignoreList = null;
      this.sampleSummaryDetails = null;
      this.sampleSummaryTabs = null;
      this.sampleSummaryPanel = null;
      this.sampleSummaryDesc = null;
      this.sampleSummaryLegend = null;
      this.sampleSummary = null;
      this.summaryMeta = null;
      if (this.paraphraseGuide) {
        this.paraphraseGuide.replaceChildren();
        this.paraphraseGuide = null;
      }
      this.viewAnalysisBtn = null;
      this.viewSourceBtn = null;
      this.status = null;
      this.activeKind = 'core';
      this.tabScroll = { core: 0, ignore: 0, sample: 0 };
      this.mobilePointScroll = 0;
      this.sourcePageScroll = 0;
      this.activePointId = null;
      this.overview = false;
      this.activeEvidence = [];
      this.evidenceIndex = -1;
      this.entries.clear();
      this.sampleVersions = [];
      this.activeSampleVersionId = null;
    }
  }

  const api = { SWTReviewController, findPhraseOccurrences, buildSampleSegments, normalizePhrase };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SWTReview = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
