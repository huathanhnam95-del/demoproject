/* eslint-disable no-console */
/**
 * Read-only layout probe. Paste in DevTools, or loaded in practice environment, then call:
 *   auditPracticeLayout('#ra-prompt-stage')
 *   auditPracticeLayout($0) // the selected task element in DevTools
 *
 * Does not navigate, click, read prompt text, request audio or change the DOM.
 * Registers one helper on globalThis and prints computed geometry only.
 * The supplied target must be an existing visible element on the current page.
 */
(function () {
  'use strict';

  function label(element) {
    if (element.id) return '#' + element.id;
    const classes = Array.from(element.classList).slice(0, 3);
    return element.tagName.toLowerCase() + classes.map(x => '.' + x).join('');
  }

  function round(value) {
    return Number(value.toFixed(1));
  }

  function px(value) {
    return Number.parseFloat(value) || 0;
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  }

  function innerWidth(element) {
    const style = getComputedStyle(element);
    return Math.max(0, element.clientWidth -
      px(style.paddingLeft) - px(style.paddingRight));
  }

  function measure(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const parentWidth = element.parentElement ? innerWidth(element.parentElement) : 0;
    return {
      element: label(element),
      width: round(rect.width),
      parentContentWidth: round(parentWidth),
      parentFillPercent: parentWidth ? round(100 * rect.width / parentWidth) : null,
      left: round(rect.left),
      right: round(rect.right),
      top: round(rect.top),
      height: round(rect.height),
      maxWidth: style.maxWidth,
      maxInlineSize: style.maxInlineSize,
      minWidth: style.minWidth,
      widthRuleResult: style.width,
      paddingInline: style.paddingLeft + ' / ' + style.paddingRight,
      marginInline: style.marginLeft + ' / ' + style.marginRight,
      display: style.display,
      gridColumns: style.gridTemplateColumns,
      gridColumn: style.gridColumn,
      flex: style.flex,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      position: style.position,
      hasHorizontalOverflow: element.scrollWidth > element.clientWidth + 1
    };
  }

  function hitTest(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const inViewport = x >= 0 && x < document.documentElement.clientWidth &&
      y >= 0 && y < window.innerHeight;
    const hit = inViewport ? document.elementFromPoint(x, y) : null;
    return {
      element: label(element),
      disabled: Boolean(element.disabled),
      centerInViewport: inViewport,
      centerUnobscured: Boolean(hit && (hit === element || element.contains(hit))),
      coveringElement: hit && hit !== element && !element.contains(hit) ? label(hit) : null
    };
  }

  globalThis.auditPracticeLayout = function auditPracticeLayout(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(element instanceof Element)) {
      throw new TypeError('Pass an existing CSS selector or Element, e.g. auditPracticeLayout($0).');
    }
    if (!visible(element)) {
      throw new Error('The target is hidden. Open that mode normally before measuring it.');
    }

    const ancestors = [];
    for (let node = element; node && ancestors.length < 30; node = node.parentElement) {
      ancestors.push(measure(node));
    }

    const panel = element.closest('.mode-panel') || element.closest('[data-practice-shell]');
    const controls = panel ? Array.from(panel.querySelectorAll(
      '#ra-record-btn, #ra-stop-btn, #ra-check-btn, #ra-retry-btn, ' +
      '[data-ra-emphasis="primary"], [data-practice-primary]'
    )).filter(visible).map(hitTest) : [];
    const rect = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const report = {
      viewport: { width: viewportWidth, height: window.innerHeight },
      target: label(element),
      viewportFillPercent: round(100 * rect.width / viewportWidth),
      viewportMargins: { left: round(rect.left), right: round(viewportWidth - rect.right) },
      pageOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
      ancestors,
      controls,
      notes: [
        'These are computed sizes, not proof of which source declaration won.',
        'Use DevTools Styles on the first width drop to locate the responsible declaration.',
        'Some minimum sizes and internal grids are legitimate: inspect before removing them.'
      ]
    };
    if (typeof console !== 'undefined' && console.table) {
      console.table(ancestors);
      if (controls.length) console.table(controls);
      console.log('Practice layout report:', report);
    }
    return report;
  };
})();
