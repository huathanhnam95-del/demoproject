/* eslint-disable no-console */
/**
 * Triage view over a practice-modes-ui-full-audit report.json (Task 756).
 *
 * Groups raw probe output into the priority bands used by the audit doc and
 * filters the console noise a static file server unavoidably produces
 * (Firebase, Dialogflow, /api/* — none of which exist in this harness).
 *
 * Usage:
 *   node tests/browser/practice-modes-ui-summarize.js [report.json] [--diff other-report.json]
 */
const fs = require('fs');
const path = require('path');

const DEFAULT = path.resolve(__dirname, '../../test-results/practice-ui-audit-2026-09-01/report.json');

// Errors caused by the harness serving public/ statically, not by the UI.
const NOISE = [
  /ERR_CONNECTION_RESET/,
  /gstatic\.com/,
  /googleapis\.com/,
  /dialogflow/i,
  /df-messenger/i,
  /firebase/i,
  /identitytoolkit/,
  /\/api\//,
  /word-reference-service/,
  /Failed to load resource: the server responded with a status of 404/
];
const isNoise = (s) => NOISE.some((re) => re.test(s));

// Structural non-defects. Kept as named filters rather than dropped silently so a
// later reader can see what was excluded and why.
const IGNORE = {
  // <option> nodes inside a closed <select> have no box by definition.
  zeroSize: (d) => /> option$| > option /.test(d) || /select#[\w-]+[^>]*> option/.test(d),
  // The visually-hidden pattern (clip a label to 0 for screen readers) is a
  // deliberate clip, not a layout failure.
  clippedText: (d) => /sr-only|visually-hidden|screen-reader/i.test(d)
};

// Floating page chrome sits above everything by design. A control under it is
// still worth knowing about on mobile, but it is a stacking question, not a
// broken panel, so it is reported separately from in-panel occlusion.
const FLOATING_CHROME = /#guest-toast|#mobile-toolbar|#bel-chat-trigger|df-messenger/;

function load(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function summarize(report) {
  const bySurface = new Map();
  for (const r of report.results) {
    if (!bySurface.has(r.surface)) bySurface.set(r.surface, {});
    bySurface.get(r.surface)[r.viewport] = r;
  }

  const p1 = [];
  const p2 = [];
  const p3 = [];

  for (const [surface, vps] of bySurface) {
    for (const [vp, r] of Object.entries(vps)) {
      const p = r.probe || {};
      if (r.error) p1.push({ surface, vp, kind: 'harness-error', detail: r.error });
      if (p.missing) p1.push({ surface, vp, kind: 'root-missing', detail: p.rootSel });
      if (r.neverBecameVisible) p1.push({ surface, vp, kind: 'panel-never-visible', detail: 'switchToMode did not reveal the panel' });

      for (const m of r.media || []) {
        if (m.inertPlay) {
          p1.push({ surface, vp, kind: 'inert-play', detail: m.control + '  "' + m.text.replace(/\s+/g, ' ') + '"  (click landed, play() never called, no error)' });
        } else if (m.mediaError && m.mediaError.length) {
          p1.push({ surface, vp, kind: 'media-error', detail: m.control + ' -> ' + m.mediaError.join(', ') });
        }
      }

      for (const c of p.coveredControls || []) {
        const band = FLOATING_CHROME.test(c.coveredBy) ? p3 : p1;
        band.push({
          surface, vp,
          kind: FLOATING_CHROME.test(c.coveredBy) ? 'under-floating-chrome' : 'covered-control',
          detail: c.el + '  covered by  ' + c.coveredBy
        });
      }

      const realErrors = (r.consoleErrors || []).filter((e) => !isNoise(e));
      for (const e of realErrors) p1.push({ surface, vp, kind: 'console-error', detail: e.replace(/\s+/g, ' ').slice(0, 180) });

      for (const o of p.overflow || []) {
        const band = o.kind === 'wider-than-parent' ? p2 : p3;
        band.push({
          surface, vp, kind: o.kind,
          detail: o.el + '  +' + o.overflowPx + 'px'
            + (o.kind === 'wider-than-parent'
              ? '  (el ' + o.elWidth + ' > parent content ' + o.parentContentWidth + ', box-sizing:' + o.boxSizing + ', padding:' + o.padding + ')'
              : '  (content ' + o.scrollWidth + ' > box ' + o.clientWidth + ', overflow-x:' + o.overflowX + ')')
        });
      }

      if (p.pageScroll && p.pageScroll.overflowsBy > 0) {
        p2.push({ surface, vp, kind: 'page-h-scroll', detail: 'document ' + p.pageScroll.docScrollWidth + 'px vs viewport ' + p.pageScroll.innerWidth + 'px (+' + p.pageScroll.overflowsBy + ')' });
      }

      for (const c of p.contrast || []) {
        p2.push({ surface, vp, kind: 'contrast', detail: c.ratio + ':1 (needs ' + c.floor + ') ' + c.el + '  ' + c.color + ' on ' + c.bg + '  "' + c.text.replace(/\s+/g, ' ') + '"' });
      }

      for (const z of p.zeroSize || []) {
        if (IGNORE.zeroSize(z.el)) continue;
        p2.push({ surface, vp, kind: 'zero-size', detail: z.el + '  "' + z.text.replace(/\s+/g, ' ') + '"' });
      }

      for (const t of p.clippedText || []) {
        if (IGNORE.clippedText(t.el)) continue;
        p2.push({ surface, vp, kind: 'clipped-text', detail: t.el + '  ' + t.hiddenPx + 'px hidden  "' + t.text.replace(/\s+/g, ' ') + '"' });
      }

      for (const s of p.smallTargets || []) {
        p3.push({ surface, vp, kind: 'small-touch-target', detail: s.el + '  ' + s.w + 'x' + s.h + '  "' + s.text.replace(/\s+/g, ' ') + '"' });
      }

      for (const c of p.inertControls || []) {
        p3.push({ surface, vp, kind: 'no-listener', detail: c.el + '  "' + c.text.replace(/\s+/g, ' ') + '"' + (c.delegateAncestor ? '  (delegate on ' + c.delegateAncestor + ')' : '  (no delegate found)') });
      }
    }
  }

  return { p1, p2, p3, bySurface };
}

function printBand(name, rows) {
  console.log('\n' + '='.repeat(78));
  console.log(name + '  —  ' + rows.length + ' finding(s)');
  console.log('='.repeat(78));
  const byKind = new Map();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log('\n  [' + kind + ']  x' + list.length);
    for (const r of list) console.log('    ' + (r.surface + '/' + r.vp).padEnd(26) + r.detail);
  }
}

function drift(bySurface) {
  console.log('\n' + '='.repeat(78));
  console.log('CROSS-MODE DRIFT — audio player (desktop)');
  console.log('='.repeat(78));
  const rows = [];
  for (const [surface, vps] of bySurface) {
    const inv = vps.desktop && vps.desktop.probe && vps.desktop.probe.inventory;
    if (inv && inv.audioPlayer) rows.push(Object.assign({ surface }, inv.audioPlayer));
  }
  if (!rows.length) { console.log('  (none rendered)'); return; }
  console.log('  ' + 'surface'.padEnd(16) + 'element'.padEnd(24) + 'offsetW'.padEnd(9) + 'box-sizing'.padEnd(13) + 'background');
  for (const r of rows) {
    console.log('  ' + r.surface.padEnd(16) + String(r.el).slice(0, 22).padEnd(24) + String(r.offsetWidth).padEnd(9) + String(r.boxSizing).padEnd(13) + r.background);
  }

  console.log('\n' + '='.repeat(78));
  console.log('CROSS-MODE DRIFT — button typography (desktop)');
  console.log('='.repeat(78));
  const fonts = new Map();
  for (const [surface, vps] of bySurface) {
    const inv = vps.desktop && vps.desktop.probe && vps.desktop.probe.inventory;
    for (const b of (inv && inv.buttons) || []) {
      const key = b.font + ' | ' + b.fontSize;
      if (!fonts.has(key)) fonts.set(key, new Set());
      fonts.get(key).add(surface);
    }
  }
  for (const [key, set] of [...fonts].sort((a, b) => b[1].size - a[1].size)) {
    console.log('  ' + key.padEnd(34) + [...set].join(', '));
  }
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reportPath = args[0] ? path.resolve(process.cwd(), args[0]) : DEFAULT;
const report = load(reportPath);
const { p1, p2, p3, bySurface } = summarize(report);

console.log('Report: ' + reportPath);
console.log('Generated: ' + report.generatedAt);
console.log('Surfaces: ' + report.surfaces.length + '  Viewports: ' + report.viewports.join(', '));

printBand('P1 — broken or unusable', p1);
printBand('P2 — visibly wrong', p2);
printBand('P3 — inconsistency / polish', p3);
drift(bySurface);

const diffIdx = process.argv.indexOf('--diff');
if (diffIdx > -1 && process.argv[diffIdx + 1]) {
  const other = load(path.resolve(process.cwd(), process.argv[diffIdx + 1]));
  const o = summarize(other);
  const key = (r) => r.surface + '|' + r.vp + '|' + r.kind + '|' + r.detail;
  const beforeKeys = new Set([...o.p1, ...o.p2, ...o.p3].map(key));
  const afterAll = [...p1, ...p2, ...p3];
  const afterKeys = new Set(afterAll.map(key));
  const fixed = [...o.p1, ...o.p2, ...o.p3].filter((r) => !afterKeys.has(key(r)));
  const introduced = afterAll.filter((r) => !beforeKeys.has(key(r)));
  console.log('\n' + '='.repeat(78));
  console.log('DIFF vs ' + process.argv[diffIdx + 1]);
  console.log('='.repeat(78));
  console.log('  resolved:   ' + fixed.length);
  console.log('  introduced: ' + introduced.length);
  for (const r of introduced) console.log('    NEW  ' + (r.surface + '/' + r.vp).padEnd(26) + '[' + r.kind + '] ' + r.detail);
}

console.log('\nTotals: P1=' + p1.length + '  P2=' + p2.length + '  P3=' + p3.length);
