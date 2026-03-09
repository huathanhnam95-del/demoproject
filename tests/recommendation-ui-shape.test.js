const assert = require('assert');
const fs = require('fs');

console.log('Starting recommendation UI shape test...');

const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');

[
  'recommended-btn-type',
  'recommended-btn-speak',
  'recommended-btn-extended',
  'recommended-btn-notes',
  'recommendation-summary-type',
  'recommendation-summary-speak',
  'recommendation-summary-extended',
  'recommendation-summary-notes'
].forEach((id) => assert(html.includes(id), `${id} missing from index.html`));

assert(css.includes('.recommended-jump-btn'), 'missing .recommended-jump-btn styles');
assert(css.includes('.recommendation-summary'), 'missing .recommendation-summary styles');

console.log('recommendation ui shape tests passed');

