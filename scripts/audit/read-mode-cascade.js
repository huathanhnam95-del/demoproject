#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Guards the Reading-mode stylesheet layering.
 *
 * read-mode-base.css loads BEFORE the per-mode sheets, so it can only provide
 * defaults: any equal-specificity rule in a mode sheet wins, including over the
 * base's media queries. That bit us once — the base stacked .rmcsa-split-layout
 * at 900px while rmcsa-mode.css re-declared grid-template-columns outside any
 * media query, so the MC modes never stacked on mobile.
 *
 * A mode sheet may legitimately override a base default. What it must NOT do is
 * override a property the base only sets inside a media query — that silently
 * disables the responsive rule at every width.
 *
 * Usage: node scripts/audit/read-mode-cascade.js   (exit 1 on any violation)
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const BASE = 'read-mode-base';
// Must match the <link> order in public/index.html
const MODES = ['rfib-mode', 'dd-mode', 'rmcma-mode', 'rmcsa-mode', 'rop-mode'];

function declarations(file) {
  const css = fs.readFileSync(path.join(PUBLIC, `${file}.css`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(text, media) {
    let plain = '';
    let i = 0;
    while (i < text.length) {
      const at = text.indexOf('@media', i);
      if (at < 0) { plain += text.slice(i); break; }
      plain += text.slice(i, at);
      const open = text.indexOf('{', at);
      let depth = 1, j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      walk(text.slice(open + 1, j - 1), text.slice(at + 6, open).trim());
      i = j;
    }
    for (const rule of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1].split(',').map((s) => s.trim()).filter(Boolean);
      const props = [...rule[2].matchAll(/([-\w]+)\s*:/g)].map((m) => m[1]);
      for (const sel of selectors) for (const prop of props) out.push({ sel, prop, media });
    }
  })(css, null);
  return out;
}

const base = declarations(BASE);
const responsive = new Set(
  base.filter((d) => d.media).map((d) => `${d.sel}|${d.prop}`)
);

const violations = [];
for (const mode of MODES) {
  for (const d of declarations(mode)) {
    const key = `${d.sel}|${d.prop}`;
    // A mode sheet redeclaring, outside any media query, a property the base
    // only sets responsively defeats the base rule at every viewport width.
    if (!d.media && responsive.has(key)) {
      violations.push({ mode, sel: d.sel, prop: d.prop });
    }
  }
}

if (violations.length === 0) {
  console.log(`read-mode cascade OK — ${base.length} base declarations, no defeated media queries.`);
  process.exit(0);
}

console.error('read-mode cascade VIOLATIONS\n');
for (const v of violations) {
  console.error(`  ${v.mode}.css declares { ${v.prop} } on "${v.sel}" outside a media query,`);
  console.error(`    defeating the responsive rule in ${BASE}.css. Move the default into ${BASE}.css\n`);
}
console.error(`${violations.length} violation(s).`);
process.exit(1);
