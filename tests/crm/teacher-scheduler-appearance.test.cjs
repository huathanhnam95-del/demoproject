const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const schedulerCss = fs.readFileSync(path.join(ROOT, 'public/css/teacher-scheduler-google.css'), 'utf8');
const adminCss = fs.readFileSync(path.join(ROOT, 'public/crm-admin.css'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'public/crm-admin.html'), 'utf8');

const PASTELS = Object.freeze({
  blue: '#D2E3FC',
  purple: '#E8DEF8',
  teal: '#CDEBE6',
  green: '#CEEAD6',
  orange: '#FCE3C1',
  red: '#FAD2CF',
  indigo: '#DDE3FA',
  coral: '#F8D9E5'
});

function hexToRgb(hex) {
  const normalized = String(hex).replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssCustomProperty(name) {
  const match = schedulerCss.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `Expected ${name} to be declared as an opaque six-digit hex color.`);
  return match[1].toUpperCase();
}

test('markup defaults appearance to Pastel and recurring moves to this session only', () => {
  assert.match(
    adminHtml,
    /<select id="ts-setting-appearance">\s*<option value="pastel" selected>Pastel · soft colors<\/option>\s*<option value="solid">Solid · stronger colors<\/option>\s*<\/select>/,
    'Appearance settings must present Pastel as the selected default while retaining Solid.'
  );
  assert.match(
    adminHtml,
    /<label class="teacher-scheduler-scope-option is-selected" id="scope-option-single-label">\s*<input[^>]+id="scope-choice-single"[^>]+value="single"[^>]+checked>/,
    'The single-session recurrence option must own both the selected styling and checked control.'
  );
  assert.match(
    adminHtml,
    /<label class="teacher-scheduler-scope-option" id="scope-option-series-label">\s*<input[^>]+id="scope-choice-series"[^>]+value="series">/,
    'The series option must remain available but not selected by default.'
  );
  assert.match(adminHtml, /<dialog class="[^"]*ts-modal-dialog[^"]*" id="teacher-scheduler-settings-dialog"/);
  assert.match(adminHtml, /<div id="teacher-scheduler-scope-modal"[^>]+role="dialog"[^>]+aria-modal="true"/);
});

test('all eight approved Pastel families are opaque and exceed 4.5:1 for title and metadata', () => {
  for (const [family, expectedBackground] of Object.entries(PASTELS)) {
    const background = cssCustomProperty(`--ts-pastel-${family}-bg`);
    const hoverBackground = cssCustomProperty(`--ts-pastel-${family}-hover-bg`);
    assert.equal(background, expectedBackground, `${family} must use the approved Pastel background.`);
    assert.match(hoverBackground, /^#[0-9A-F]{6}$/);
    assert.ok(contrastRatio('#1F1F1F', background) >= 4.5, `${family} title contrast must be at least 4.5:1.`);
    assert.ok(contrastRatio('#3C4043', background) >= 4.5, `${family} metadata contrast must be at least 4.5:1.`);
    assert.ok(contrastRatio('#1F1F1F', hoverBackground) >= 4.5, `${family} hover title contrast must be at least 4.5:1.`);
    assert.ok(contrastRatio('#3C4043', hoverBackground) >= 4.5, `${family} hover metadata contrast must be at least 4.5:1.`);
    assert.match(schedulerCss, new RegExp(`\\[data-ts-color=["']${family}["']\\][^{]*\\{[^}]*--ts-event-bg:\\s*var\\(--ts-pastel-${family}-bg\\)`, 'is'));
  }
});

test('Solid remains an explicit contrast-safe family mapping', () => {
  for (const family of Object.keys(PASTELS)) {
    const background = cssCustomProperty(`--ts-solid-${family}-bg`);
    const hoverBackground = cssCustomProperty(`--ts-solid-${family}-hover-bg`);
    assert.ok(contrastRatio('#FFFFFF', background) >= 4.5, `${family} Solid title contrast must be at least 4.5:1.`);
    assert.ok(contrastRatio('#FFFFFF', hoverBackground) >= 4.5, `${family} Solid hover contrast must be at least 4.5:1.`);
    assert.match(
      schedulerCss,
      new RegExp(`\\.ts-appearance-solid[^}]*\\[data-ts-color=["']${family}["']\\][^{]*\\{[^}]*--ts-event-bg:\\s*var\\(--ts-solid-${family}-bg\\)[^}]*--ts-event-title:\\s*#(?:fff|ffffff)`, 'is')
    );
  }
});

test('events and detached previews consume one six-token theme contract', () => {
  assert.match(schedulerCss, /#teacher-scheduler-calendar \.teacher-scheduler-session-pill,\s*\.teacher-scheduler-drag-ghost\s*\{[^}]*background-color:\s*var\(--ts-event-bg,\s*#D2E3FC\)[^}]*color:\s*var\(--ts-event-title,\s*#1F1F1F\)[^}]*opacity:\s*1/is);
  assert.match(schedulerCss, /\.teacher-scheduler-drag-ghost \.pill-title[^}]*color:\s*var\(--ts-event-title,\s*#1F1F1F\)/is);
  assert.match(schedulerCss, /\.teacher-scheduler-drag-ghost :is\(\.pill-time,\s*\.pill-teacher,\s*\.drag-ghost-chip\)[^}]*color:\s*var\(--ts-event-meta,\s*#3C4043\)[^}]*opacity:\s*1/is);
  for (const token of ['bg', 'title', 'meta', 'accent', 'hover-bg', 'focus']) {
    assert.match(schedulerCss, new RegExp(`--ts-event-${token}`));
  }
  assert.doesNotMatch(schedulerCss, /\.teacher-scheduler-drag-ghost\s*\{[^}]*background:\s*var\(--color[^}]*!important/is);
  assert.doesNotMatch(schedulerCss, /\.teacher-scheduler-drag-ghost\s*\{[^}]*color:\s*#(?:fff|ffffff)\s*!important/is);
});

test('hover, focus, completed, pending, and Agenda markers preserve the resolved family', () => {
  assert.match(schedulerCss, /teacher-scheduler-session-pill:hover[^}]*background-color:\s*var\(--ts-event-hover-bg/is);
  assert.match(schedulerCss, /teacher-scheduler-session-pill:focus-visible[^}]*outline:\s*2px solid var\(--ts-event-focus/is);
  assert.match(schedulerCss, /teacher-scheduler-session-pill\.is-completed[^}]*background-color:\s*var\(--ts-event-bg/is);
  assert.match(schedulerCss, /teacher-scheduler-session-pill\.is-saving[^}]*opacity:\s*1/is);
  assert.match(schedulerCss, /\.ts-schedule-row \.event-dot[^}]*background:\s*var\(--ts-event-accent/is);
  assert.doesNotMatch(schedulerCss, /teacher-scheduler-session-pill:hover[^}]*transform:\s*translateY/is);
});

test('crm-admin stylesheet no longer competes with scheduler theme ownership', () => {
  assert.doesNotMatch(adminCss, /Teacher scheduler: Pastel Session Pills Color System/);
  assert.doesNotMatch(adminCss, /scheduler-session-pill\.is-completed\s*\{[^}]*(?:background|--pill-bg)/is);
  assert.doesNotMatch(adminCss, /teacher-scheduler-drag-ghost\s*\{[^}]*background(?:-color)?\s*:/is);
  assert.match(
    adminCss,
    /\[data-panel="courses\/teacher-schedule"\]\[style\*="display:\s*block"\]\s*\{[^}]*display:\s*flex\s*!important/is,
    'The active-only scheduler flex rule must preserve CRM panel visibility behavior.'
  );
});
