/**
 * swt-evidence.js — SWT Canonical Evidence Engine
 *
 * Validates and segments exact source text against pedagogical answer annotations.
 * Guaranteed never to mutate canonical source text or nest <mark> elements.
 */
(function (root) {
  'use strict';

  function isBoundary(text, index) {
    if (index === 0 || index === text.length) return true;
    const before = text.charCodeAt(index - 1);
    const after = text.charCodeAt(index);
    return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
  }

  function validateRange(source, range) {
    if (typeof source !== 'string' || !range || typeof range.quote !== 'string' || !range.quote.length) return false;
    const { start, end, quote } = range;
    return Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= source.length &&
      isBoundary(source, start) &&
      isBoundary(source, end) &&
      source.slice(start, end) === quote;
  }

  // Authoring/build-time helper: never guess when the quote occurs more than once.
  function resolveQuote(source, quote, { prefix = '', suffix = '' } = {}) {
    if (typeof source !== 'string' || typeof quote !== 'string' || quote.length === 0) {
      throw new TypeError('A nonempty exact quote is required.');
    }
    const matches = [];
    for (let cursor = 0; cursor <= source.length - quote.length;) {
      const start = source.indexOf(quote, cursor);
      if (start === -1) break;
      const end = start + quote.length;
      if ((!prefix || source.slice(0, start).endsWith(prefix)) &&
          (!suffix || source.slice(end).startsWith(suffix)) &&
          validateRange(source, { start, end, quote })) {
        matches.push({ start, end, quote });
      }
      cursor = start + 1;
    }
    if (matches.length !== 1) {
      throw new Error(matches.length ? 'Ambiguous quote: supply exact surrounding context.' : 'Quote not found in canonical source.');
    }
    return matches[0];
  }

  // Splits once at all boundaries; overlapping evidence never nests <mark>s.
  function buildSegments(source, points) {
    if (typeof source !== 'string' || !Array.isArray(points)) {
      throw new TypeError('Invalid source/points.');
    }
    const ranges = [];
    const boundaries = new Set([0, source.length]);
    for (const p of points) {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.evidence) || p.evidence.length === 0) {
        throw new Error('Invalid point evidence.');
      }
      for (const r of p.evidence) {
        if (!validateRange(source, r)) {
          throw new Error('Invalid or stale evidence range for ' + p.id);
        }
        ranges.push({ ...r, pointId: p.id });
        boundaries.add(r.start);
        boundaries.add(r.end);
      }
    }
    const cuts = [...boundaries].sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const start = cuts[i];
      const end = cuts[i + 1];
      if (start === end) continue;
      const pointIds = [...new Set(ranges.filter(r => r.start < end && r.end > start).map(r => r.pointId))];
      segments.push({ text: source.slice(start, end), start, end, pointIds });
    }
    return segments;
  }

  function renderSource(container, source, points, kind = 'core') {
    if (!container || !container.ownerDocument) {
      throw new TypeError('A DOM container is required.');
    }
    const segments = buildSegments(source, points);
    const doc = container.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const segment of segments) {
      if (!segment.pointIds.length) {
        fragment.appendChild(doc.createTextNode(segment.text));
      } else {
        const mark = doc.createElement('mark');
        mark.className = kind === 'ignore' ? 'swt-evidence swt-evidence--ignore' : 'swt-evidence swt-evidence--core';
        mark.dataset.pointIds = segment.pointIds.join(' ');
        mark.dataset.sourceStart = String(segment.start);
        mark.dataset.sourceEnd = String(segment.end);
        mark.textContent = segment.text;
        fragment.appendChild(mark);
      }
    }
    container.replaceChildren(fragment);
    return container.querySelector('mark');
  }

  const api = { isBoundary, validateRange, resolveQuote, buildSegments, renderSource };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SWTEvidence = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
