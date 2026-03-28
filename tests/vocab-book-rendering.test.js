const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(process.cwd(), 'public/vocab-book.js'), 'utf8');

assert(
  source.includes('escapeHtml(w.originalWord)'),
  'Improving list must escape originalWord.'
);
assert(
  !source.includes('<span class="vocab-word-text">${w.originalWord}</span>'),
  'Improving list must not interpolate originalWord directly.'
);

console.log('vocab-book rendering regression passed');
