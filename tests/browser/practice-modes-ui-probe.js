/* eslint-disable no-console */
/**
 * In-page probe for practice-modes-ui-full-audit.js (Task 756).
 *
 * Exported as a single function serialised into the page by page.evaluate().
 * Everything inside `probe` runs in the browser; keep it dependency-free and
 * ES2020-compatible.
 */

function probe(opts) {
  const rootSel = opts.rootSel;
  const isMobile = opts.isMobile;
  const CAP = 60;

  const root = document.querySelector(rootSel);
  if (!root) return { missing: true, rootSel };

  // ---- helpers ------------------------------------------------------------
  const cs = (el) => getComputedStyle(el);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const pathOf = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) { parts.unshift(describe(n)); n = n.parentElement; }
    return parts.join(' > ');
  };
  const rendered = (el) => {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const visibleChain = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      const s = cs(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      n = n.parentElement;
    }
    return true;
  };

  const parseColor = (str) => {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((v) => parseFloat(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const relLum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  // Porter-Duff source-over. The alpha has to accumulate: an earlier version
  // hard-coded the result to a=1, so the first translucent layer was treated as
  // opaque and the walk stopped there. That reported the Write Essay filter labels
  // as slate-on-blue at 1.79:1 when they are in fact slate on white.
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a
    };
  };
  const effectiveBg = (el) => {
    let n = el;
    let acc = { r: 0, g: 0, b: 0, a: 0 };
    while (n && n.nodeType === 1) {
      const s = cs(n);
      // A gradient or image behind the text makes a flat contrast number
      // meaningless; bail rather than report a wrong ratio.
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a > 0) {
        acc = over(acc, c);
        if (acc.a >= 0.999) return acc;
      }
      n = n.parentElement;
    }
    // Anything still translucent at the root composites onto the canvas.
    return over(acc, { r: 255, g: 255, b: 255, a: 1 });
  };
  const contrastRatio = (fg, bg) => {
    const l1 = relLum(fg); const l2 = relLum(bg);
    const hi = Math.max(l1, l2); const lo = Math.min(l1, l2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };

  const CONTROL_SEL = 'button, [role="button"], a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [onclick]';
  const all = Array.from(root.querySelectorAll('*'));
  const controls = Array.from(root.querySelectorAll(CONTROL_SEL)).filter(rendered);

  const result = {
    rootSel,
    rootRect: rect(root),
    counts: { descendants: all.length, rendered: all.filter(rendered).length, controls: controls.length }
  };

  // ---- 1. overflow / clipping --------------------------------------------
  // Only flag elements the parent actually constrains: static/relative flow,
  // parent not a scroll container, element not intentionally clipped.
  const overflow = [];
  for (const el of all) {
    if (overflow.length >= CAP) break;
    if (!rendered(el)) continue;
    const s = cs(el);
    if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') continue;
    if (s.float !== 'none') continue;
    const p = el.parentElement;
    if (!p || p === document.body || p === document.documentElement) continue;
    const ps = cs(p);
    const parentScrolls = /auto|scroll/.test(ps.overflowX);

    // (a) border box wider than the parent's content box -> spills out (bug 755)
    if (!parentScrolls && p.clientWidth > 0) {
      const delta = el.offsetWidth - p.clientWidth;
      if (delta > 1) {
        overflow.push({
          kind: 'wider-than-parent',
          el: pathOf(el),
          elWidth: el.offsetWidth,
          parent: describe(p),
          parentContentWidth: p.clientWidth,
          overflowPx: delta,
          width: s.width,
          padding: s.padding,
          border: s.borderWidth,
          boxSizing: s.boxSizing
        });
        continue;
      }
    }

    // (b) content wider than the element and clipped or spilling
    const contentDelta = el.scrollWidth - el.clientWidth;
    if (contentDelta > 1 && el.clientWidth > 0 && !/auto|scroll/.test(s.overflowX)) {
      overflow.push({
        kind: s.overflowX === 'hidden' ? 'content-clipped' : 'content-spills',
        el: pathOf(el),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        overflowPx: contentDelta,
        overflowX: s.overflowX,
        boxSizing: s.boxSizing
      });
    }
  }
  result.overflow = overflow;

  // ---- 2. page-level horizontal scroll ------------------------------------
  const de = document.documentElement;
  result.pageScroll = {
    docScrollWidth: de.scrollWidth,
    innerWidth: window.innerWidth,
    overflowsBy: Math.max(0, de.scrollWidth - window.innerWidth)
  };

  // ---- 3. inert controls ---------------------------------------------------
  // A rendered, enabled control that never received a click-ish listener and has
  // no native behaviour of its own.
  const inert = [];
  for (const el of controls) {
    if (inert.length >= CAP) break;
    const tag = el.tagName.toLowerCase();
    if (el.disabled) continue;
    if (tag === 'a' && el.getAttribute('href')) continue;           // native navigation
    if (tag === 'input' || tag === 'select' || tag === 'textarea') continue; // native editing
    if (el.closest('label')) continue;                               // implicit control
    if (el.type === 'submit' && el.closest('form')) continue;        // native submit
    if (el.getAttribute('onclick')) continue;
    const hasOwn = window.__hasListener && window.__hasListener(el);
    if (hasOwn) continue;
    // Delegated handlers are common here; record the ancestor that owns one so
    // triage can tell "unhandled" from "handled by a delegate".
    let delegate = null;
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      if (window.__hasListener && window.__hasListener(n)) { delegate = describe(n); break; }
      n = n.parentElement;
    }
    inert.push({
      el: pathOf(el),
      text: (el.textContent || '').trim().slice(0, 40),
      delegateAncestor: delegate,
      rect: rect(el)
    });
  }
  result.inertControls = inert;

  // ---- 4. hit-testing ------------------------------------------------------
  const covered = [];
  for (const el of controls) {
    if (covered.length >= CAP) break;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue; // off-screen, not covered
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) continue;
    if (hit === el || el.contains(hit) || hit.contains(el)) continue;
    covered.push({ el: pathOf(el), text: (el.textContent || '').trim().slice(0, 40), coveredBy: pathOf(hit), rect: rect(el) });
  }
  result.coveredControls = covered;

  // ---- 5. geometry sanity --------------------------------------------------
  const zeroSize = [];
  for (const el of all) {
    if (zeroSize.length >= CAP) break;
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (!visibleChain(el)) continue;
    const r = el.getBoundingClientRect();
    const hasText = (el.textContent || '').trim().length > 0;
    const isControl = el.matches(CONTROL_SEL);
    if ((r.width === 0 || r.height === 0) && (hasText || isControl) && el.children.length === 0) {
      zeroSize.push({ el: pathOf(el), rect: rect(el), text: (el.textContent || '').trim().slice(0, 40) });
    }
  }
  result.zeroSize = zeroSize;

  const smallTargets = [];
  if (isMobile) {
    for (const el of controls) {
      if (smallTargets.length >= CAP) break;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.width < 44 || r.height < 44) {
        smallTargets.push({ el: pathOf(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 30) });
      }
    }
  }
  result.smallTargets = smallTargets;

  // ---- 6. text legibility --------------------------------------------------
  const contrast = [];
  const seen = new Set();
  // Form controls paint their own value text, so the own-text-node walk below
  // never reaches them. The Write Essay filter selects rendered #1e293b on
  // #1e293b - a 1:1 ratio, completely invisible - and went unreported until
  // these were added explicitly.
  // Only controls that actually paint value text. A range slider, checkbox or
  // colour swatch renders no glyphs, so its `color` is irrelevant - including
  // them reported every volume slider in the listening modes as white-on-white.
  const TEXTY_INPUT = /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week|)$/;
  const controlText = Array.from(root.querySelectorAll('select, input, textarea'))
    .filter(rendered)
    .filter((el) => el.tagName !== 'INPUT' || TEXTY_INPUT.test((el.getAttribute('type') || '').toLowerCase()));
  for (const el of controlText) {
    const s = cs(el);
    const fg = parseColor(s.color);
    if (!fg) continue;
    const ownBg = parseColor(s.backgroundColor);
    const bg = (ownBg && ownBg.a >= 0.999) ? ownBg : effectiveBg(el);
    if (!bg) continue;
    const flat = fg.a >= 0.999 ? fg : over(fg, bg);
    const ratio = contrastRatio(flat, bg);
    if (ratio < 4.5) {
      contrast.push({
        el: pathOf(el),
        text: '(control value text)',
        color: s.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        ratio,
        floor: 4.5
      });
    }
  }
  for (const el of all) {
    if (contrast.length >= CAP) break;
    if (!rendered(el)) continue;
    // Only elements that own a direct non-empty text node.
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    own = own.trim();
    if (!own) continue;
    const s = cs(el);
    const fg = parseColor(s.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    if (!bg) continue;
    const flat = fg.a >= 0.999 ? fg : over(fg, bg);
    const ratio = contrastRatio(flat, bg);
    const px = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    if (ratio < floor) {
      const key = describe(el) + '|' + s.color + '|' + ratio;
      if (seen.has(key)) continue;
      seen.add(key);
      contrast.push({
        el: pathOf(el),
        text: own.slice(0, 40),
        color: s.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        ratio,
        floor
      });
    }
  }
  result.contrast = contrast;

  const clippedText = [];
  for (const el of all) {
    if (clippedText.length >= CAP) break;
    if (!rendered(el)) continue;
    const s = cs(el);
    if (s.overflow === 'visible' && s.overflowY === 'visible') continue;
    if (/auto|scroll/.test(s.overflowY)) continue;
    // The visually-hidden pattern clips a 1x1 box on purpose (read-aloud ships an
    // accessible plain-text mirror of the prompt this way). A box that small is
    // never a layout failure.
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if (s.clip && s.clip !== 'auto') continue;
    // -webkit-line-clamp is deliberate truncation (the Watch video cards clamp
    // their blurb to two lines), not a container that is too short.
    if ((s.webkitLineClamp && s.webkitLineClamp !== 'none') || (s.lineClamp && s.lineClamp !== 'none')) continue;
    const hidden = el.scrollHeight - el.clientHeight;
    if (hidden > 2 && (el.textContent || '').trim().length > 0 && s.overflowY === 'hidden') {
      clippedText.push({ el: pathOf(el), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, hiddenPx: hidden, text: (el.textContent || '').trim().slice(0, 40) });
    }
  }
  result.clippedText = clippedText;

  // ---- 7. style inventory (cross-mode drift) -------------------------------
  const inv = {};
  const audio = root.querySelector('[class*="-audio"], .spc-slot-media, audio');
  if (audio) {
    const s = cs(audio);
    inv.audioPlayer = {
      el: describe(audio), width: s.width, boxSizing: s.boxSizing, padding: s.padding,
      background: s.backgroundColor, borderRadius: s.borderRadius, offsetWidth: audio.offsetWidth
    };
  }
  const buttons = Array.from(root.querySelectorAll('button')).filter(rendered).slice(0, 12);
  inv.buttons = buttons.map((b) => {
    const s = cs(b);
    return {
      el: describe(b), text: (b.textContent || '').trim().slice(0, 24),
      font: s.fontFamily.split(',')[0].replace(/["']/g, ''), fontSize: s.fontSize,
      height: Math.round(b.getBoundingClientRect().height), radius: s.borderRadius,
      bg: s.backgroundColor, color: s.color
    };
  });
  const selects = Array.from(root.querySelectorAll('select')).filter(rendered).slice(0, 8);
  inv.selects = selects.map((el) => {
    const s = cs(el);
    return { el: describe(el), boxSizing: s.boxSizing, width: s.width, offsetWidth: el.offsetWidth, parentContentWidth: el.parentElement ? el.parentElement.clientWidth : null, font: s.fontFamily.split(',')[0].replace(/["']/g, ''), height: Math.round(el.getBoundingClientRect().height) };
  });
  result.inventory = inv;

  // ---- 8. media surface ----------------------------------------------------
  const mediaEls = Array.from(root.querySelectorAll('audio, video'));
  result.media = mediaEls.slice(0, 6).map((m) => ({
    el: describe(m),
    tag: m.tagName.toLowerCase(),
    srcAttr: m.getAttribute('src') || '',
    currentSrc: m.currentSrc || '',
    sourceChildren: Array.from(m.querySelectorAll('source')).map((s) => s.getAttribute('src') || '').slice(0, 3),
    paused: m.paused,
    readyState: m.readyState,
    rendered: rendered(m),
    controlsAttr: m.hasAttribute('controls')
  }));

  return result;
}

module.exports = { probe };
