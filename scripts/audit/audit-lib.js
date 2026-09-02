/* eslint-disable */
// In-page UI/UX audit collector. Runs inside the browser via page.evaluate.
function auditPageFn(opts) {
  const MIN_TAP = opts && opts.minTap ? opts.minTap : 44;
  const out = { url: location.href, viewport: { w: innerWidth, h: innerHeight } };

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
    return true;
  };
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    if (cls) s += '.' + cls;
    return s;
  };
  const accName = (el) => {
    const lbl = el.getAttribute('aria-labelledby');
    const byId = lbl ? (lbl.split(/\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')) : '';
    return ((el.getAttribute('aria-label') || '') + byId + (el.getAttribute('title') || '') + (el.innerText || '') + (el.value || '') + (el.getAttribute('alt') || '')).trim();
  };

  // ---------- color / contrast ----------
  const parseRGB = (str) => {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effBg = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseRGB(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.85) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (t.length < 2) continue;
    const p = n.parentElement;
    if (!p || !vis(p)) continue;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) continue;
    textNodes.push({ el: p, text: t });
  }
  const seenC = new Set();
  out.contrast = [];
  out.tinyText = [];
  for (const { el, text } of textNodes) {
    const s = getComputedStyle(el);
    const fg = parseRGB(s.color);
    if (!fg) continue;
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    if (size && size < 11.5) {
      const k2 = 'T' + sel(el) + Math.round(size);
      if (!seenC.has(k2)) { seenC.add(k2); out.tinyText.push({ sel: sel(el), px: Math.round(size * 10) / 10, text: text.slice(0, 40) }); }
    }
    const bg = effBg(el);
    const ratio = contrast(fg, bg);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      const k = sel(el) + '|' + s.color + '|' + Math.round(ratio * 10);
      if (seenC.has(k)) continue;
      seenC.add(k);
      out.contrast.push({
        sel: sel(el), text: text.slice(0, 45), fg: s.color,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        px: Math.round(size), weight, ratio: Math.round(ratio * 100) / 100, need: min
      });
    }
  }
  out.contrast = out.contrast.sort((a, b) => a.ratio - b.ratio).slice(0, 40);
  out.tinyText = out.tinyText.slice(0, 30);

  // ---------- interactive elements ----------
  const interSel = 'button,a[href],input:not([type=hidden]),select,textarea,[role="button"],[role="tab"],[role="link"],[onclick]';
  const inter = [...document.querySelectorAll(interSel)].filter(vis);
  out.interactiveCount = inter.length;
  out.unnamed = inter.filter(e => !accName(e)).map(sel).slice(0, 30);
  out.smallTargets = inter.filter(e => {
    const r = e.getBoundingClientRect();
    return r.height < MIN_TAP || r.width < MIN_TAP;
  }).map(e => {
    const r = e.getBoundingClientRect();
    return { sel: sel(e), name: accName(e).slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) };
  }).slice(0, 40);

  // ---------- forms ----------
  out.inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).filter(i => {
    if (i.getAttribute('aria-label') || i.getAttribute('aria-labelledby')) return false;
    if (i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]')) return false;
    if (i.closest('label')) return false;
    return true;
  }).map(i => ({ sel: sel(i), placeholderOnly: !!i.getAttribute('placeholder') })).slice(0, 30);
  out.placeholderAsLabel = [...document.querySelectorAll('input[placeholder],textarea[placeholder]')].filter(vis).filter(i => {
    if (i.getAttribute('aria-label') || i.getAttribute('aria-labelledby')) return false;
    if (i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]')) return false;
    if (i.closest('label')) return false;
    return true;
  }).map(i => sel(i)).slice(0, 30);

  // ---------- images ----------
  out.imgNoAlt = [...document.querySelectorAll('img')].filter(vis).filter(i => !i.hasAttribute('alt')).map(i => (i.getAttribute('src') || '').slice(-55)).slice(0, 20);

  // ---------- headings ----------
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis);
  out.headings = hs.map(h => ({ lv: +h.tagName[1], t: h.innerText.trim().slice(0, 45) }));
  out.h1Count = hs.filter(h => h.tagName === 'H1').length;
  out.headingSkips = [];
  let prev = 0;
  hs.forEach(h => { const lv = +h.tagName[1]; if (prev && lv > prev + 1) out.headingSkips.push({ from: prev, to: lv, t: h.innerText.trim().slice(0, 40) }); prev = lv; });

  // ---------- landmarks ----------
  out.landmarks = {
    main: document.querySelectorAll('main,[role=main]').length,
    nav: document.querySelectorAll('nav,[role=navigation]').length,
    header: document.querySelectorAll('header,[role=banner]').length,
    skipLink: !!document.querySelector('a[href^="#"].skip-link, a.skip-to-content, [class*="skip-link"]')
  };

  // ---------- modals ----------
  out.modals = [...document.querySelectorAll('[id*="modal"],[class*="modal"],[class*="Modal"],[class*="sheet"],[class*="drawer"],[class*="popup"],[class*="overlay"],dialog')]
    .filter(d => d.children.length > 0 && !d.closest('[class*="modal"] [class*="modal"]'))
    .map(d => ({ sel: sel(d), role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), labelled: !!(d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')), visible: vis(d) }));
  out.modalsMissingRole = out.modals.filter(m => m.role !== 'dialog').map(m => m.sel);
  out.modalCount = out.modals.length;

  // ---------- overflow ----------
  out.horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 2;
  out.scrollWidth = document.documentElement.scrollWidth;
  out.overflowingEls = [];
  if (out.horizontalOverflow) {
    out.overflowingEls = [...document.querySelectorAll('body *')].filter(vis).filter(e => {
      const r = e.getBoundingClientRect();
      return r.right > innerWidth + 2 && r.width > 40;
    }).map(e => { const r = e.getBoundingClientRect(); return { sel: sel(e), right: Math.round(r.right), w: Math.round(r.width) }; }).slice(0, 15);
  }

  // ---------- duplicate ids ----------
  const ids = {};
  [...document.querySelectorAll('[id]')].forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  out.duplicateIds = Object.entries(ids).filter(([, c]) => c > 1).map(([k, c]) => k + ' x' + c).slice(0, 25);

  // ---------- design-token consistency ----------
  const all = [...document.querySelectorAll('body *')].filter(vis).slice(0, 3000);
  const radii = {}, shadows = {}, fams = {}, sizes = {}, colors = {};
  all.forEach(e => {
    const s = getComputedStyle(e);
    if (s.borderRadius && s.borderRadius !== '0px') radii[s.borderRadius] = (radii[s.borderRadius] || 0) + 1;
    if (s.boxShadow && s.boxShadow !== 'none') shadows[s.boxShadow] = (shadows[s.boxShadow] || 0) + 1;
    fams[s.fontFamily.split(',')[0].replace(/"/g, '')] = (fams[s.fontFamily.split(',')[0]] || 0) + 1;
    sizes[s.fontSize] = (sizes[s.fontSize] || 0) + 1;
    if (s.color) colors[s.color] = (colors[s.color] || 0) + 1;
  });
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
  out.tokens = {
    radiusVariants: Object.keys(radii).length, radiiTop: top(radii, 12),
    shadowVariants: Object.keys(shadows).length, shadowsTop: top(shadows, 8).map(([k, v]) => [k.slice(0, 70), v]),
    fontFamilies: top(fams, 6), fontSizeVariants: Object.keys(sizes).length, sizesTop: top(sizes, 14),
    textColorVariants: Object.keys(colors).length, colorsTop: top(colors, 12)
  };

  // ---------- nesting: boxes in boxes ----------
  const isCard = (e) => {
    const s = getComputedStyle(e);
    const hasBg = s.backgroundColor && parseRGB(s.backgroundColor) && parseRGB(s.backgroundColor).a > 0.05;
    const hasBorder = parseFloat(s.borderTopWidth) > 0 || (s.boxShadow && s.boxShadow !== 'none');
    const rounded = parseFloat(s.borderTopLeftRadius) >= 6;
    const r = e.getBoundingClientRect();
    return (hasBg || hasBorder) && rounded && r.width > 120 && r.height > 60;
  };
  const cards = all.filter(isCard);
  out.cardNesting = [];
  cards.forEach(c => {
    let depth = 0, p = c.parentElement, chain = [sel(c)];
    while (p && p !== document.body) { if (isCard(p)) { depth++; chain.push(sel(p)); } p = p.parentElement; }
    if (depth >= 2) out.cardNesting.push({ depth: depth + 1, chain: chain.slice(0, 5) });
  });
  out.cardNesting = out.cardNesting.sort((a, b) => b.depth - a.depth).slice(0, 12);
  out.cardCount = cards.length;

  // ---------- focus visibility ----------
  out.focusOutlineRemoved = inter.filter(e => {
    const s = getComputedStyle(e);
    return (s.outlineStyle === 'none' || s.outlineWidth === '0px');
  }).length;

  // ---------- misc ----------
  out.emptyLinks = [...document.querySelectorAll('a[href="#"],a[href=""],a:not([href])')].filter(vis).length;
  out.titleAttrOnlyButtons = inter.filter(e => e.tagName === 'BUTTON' && !e.innerText.trim() && !e.getAttribute('aria-label') && e.getAttribute('title')).map(sel).slice(0, 20);
  out.langAttr = document.documentElement.getAttribute('lang');
  out.metaViewport = (document.querySelector('meta[name=viewport]') || {}).content || null;
  out.pageTitle = document.title;
  out.prefersReducedMotionRules = (() => {
    let c = 0;
    for (const ss of document.styleSheets) {
      try { for (const r of ss.cssRules) { if (r.conditionText && /prefers-reduced-motion/.test(r.conditionText)) c++; } } catch (e) { }
    }
    return c;
  })();
  out.animatedEls = all.filter(e => { const s = getComputedStyle(e); return s.animationName && s.animationName !== 'none'; }).length;

  return out;
}
module.exports = { auditPageFn };
