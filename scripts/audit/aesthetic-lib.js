/* eslint-disable */
// Extracts the *rendered* design DNA of a page: type scale, spacing rhythm,
// radii, elevation, colour roles, motion. Runs inside the browser.
function aestheticFn() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const nodes = [...document.querySelectorAll('body *')].filter(vis).slice(0, 4000);
  const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

  const typeCombo = {}, sizes = {}, weights = {}, families = {}, lineHeights = {}, letterSpacings = {};
  const pads = {}, margins = {}, gaps = {};
  const radii = {}, shadows = {}, borders = {};
  const textColors = {}, bgColors = {}, borderColors = {};
  const transitions = {}, animations = {}, durations = {};
  const measures = [];
  let uppercaseCount = 0, italicCount = 0;

  for (const el of nodes) {
    const s = getComputedStyle(el);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length > 1);

    if (hasText) {
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '');
      const size = Math.round(parseFloat(s.fontSize) * 10) / 10;
      const w = s.fontWeight;
      bump(typeCombo, `${fam} ${size}px/${w}`);
      bump(sizes, size + 'px');
      bump(weights, w);
      bump(families, fam);
      bump(lineHeights, s.lineHeight);
      if (s.letterSpacing !== 'normal') bump(letterSpacings, s.letterSpacing);
      if (s.textTransform === 'uppercase') uppercaseCount++;
      if (s.fontStyle === 'italic') italicCount++;
      // measure: characters per line for body-ish text
      const txt = el.innerText || '';
      if (txt.length > 90 && size >= 13 && size <= 22) {
        const w2 = el.getBoundingClientRect().width;
        const ch = w2 / (size * 0.5);
        measures.push({ ch: Math.round(ch), px: Math.round(w2), size, sel: el.tagName + '.' + String(el.className).slice(0, 28) });
      }
    }

    ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'].forEach(k => { const v = parseFloat(s[k]); if (v > 0) bump(pads, Math.round(v) + 'px'); });
    ['marginTop', 'marginBottom'].forEach(k => { const v = parseFloat(s[k]); if (v > 0) bump(margins, Math.round(v) + 'px'); });
    if (s.display === 'flex' || s.display === 'grid') { const g = parseFloat(s.gap); if (g > 0) bump(gaps, Math.round(g) + 'px'); }

    const r = s.borderRadius;
    if (r && r !== '0px') bump(radii, r);
    if (s.boxShadow && s.boxShadow !== 'none') bump(shadows, s.boxShadow);
    const bw = parseFloat(s.borderTopWidth);
    if (bw > 0) bump(borders, `${s.borderTopWidth} ${s.borderTopStyle}`);

    if (hasText) bump(textColors, s.color);
    const bg = s.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)') bump(bgColors, bg);
    if (s.backgroundImage && s.backgroundImage !== 'none' && /gradient/.test(s.backgroundImage)) bump(bgColors, 'GRADIENT:' + s.backgroundImage.slice(0, 60));
    if (bw > 0) bump(borderColors, s.borderTopColor);

    if (s.transition && s.transition !== 'all 0s ease 0s' && s.transitionProperty !== 'none' && s.transitionDuration !== '0s') {
      bump(transitions, s.transitionProperty.slice(0, 40) + ' | ' + s.transitionDuration + ' | ' + s.transitionTimingFunction.slice(0, 30));
      bump(durations, s.transitionDuration);
    }
    if (s.animationName && s.animationName !== 'none') bump(animations, s.animationName + ' ' + s.animationDuration + ' ' + s.animationIterationCount);
  }

  return {
    url: location.href,
    nodeCount: nodes.length,
    type: {
      comboCount: Object.keys(typeCombo).length,
      combos: top(typeCombo, 22),
      sizeCount: Object.keys(sizes).length, sizes: top(sizes, 18),
      weights: top(weights, 10),
      families: top(families, 8),
      lineHeightCount: Object.keys(lineHeights).length, lineHeights: top(lineHeights, 10),
      letterSpacings: top(letterSpacings, 8),
      uppercaseCount, italicCount,
      measures: measures.sort((a, b) => b.ch - a.ch).slice(0, 10)
    },
    space: {
      padCount: Object.keys(pads).length, pads: top(pads, 18),
      marginCount: Object.keys(margins).length, margins: top(margins, 14),
      gapCount: Object.keys(gaps).length, gaps: top(gaps, 14)
    },
    surface: {
      radiusCount: Object.keys(radii).length, radii: top(radii, 14),
      shadowCount: Object.keys(shadows).length, shadows: top(shadows, 10).map(([k, v]) => [k.slice(0, 78), v]),
      borders: top(borders, 8)
    },
    color: {
      textCount: Object.keys(textColors).length, text: top(textColors, 14),
      bgCount: Object.keys(bgColors).length, bg: top(bgColors, 16).map(([k, v]) => [k.slice(0, 72), v]),
      borderCount: Object.keys(borderColors).length, borders: top(borderColors, 10)
    },
    motion: {
      transitionCount: Object.keys(transitions).length, transitions: top(transitions, 12),
      durations: top(durations, 10),
      animations: top(animations, 10)
    }
  };
}
module.exports = { aestheticFn };
