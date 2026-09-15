'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const sourceRoot = path.join(repo, 'public/prototypes/bel-working-as-equals-demo');
const source = path.join(sourceRoot, 'native/deck.html');
const output = path.join(repo, 'public/presentation-demo/native/deck.html');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function renderOnlineDeck() {
  const raw = fs.readFileSync(source, 'utf8');
  const deck = raw
    .replace(/src="\.\/support\.js"/g, 'src="/prototypes/bel-working-as-equals-demo/native/support.js"')
    .replace(/src="(?:\.\/)?deck-stage\.js"/g, 'src="/prototypes/bel-working-as-equals-demo/native/deck-stage.js"')
    .replace(/from="(?:\.\/)?deck-stage\.js"/g, 'from="/prototypes/bel-working-as-equals-demo/native/deck-stage.js"')
    .replace(/(?:href|src)="\.\.\/_ds\//g, match => `${match.slice(0, match.indexOf('"') + 1)}/prototypes/bel-working-as-equals-demo/_ds/`)
    .replace(/src="images\//g, 'src="/prototypes/bel-working-as-equals-demo/native/images/')
    .replace(/src="\.\.\/presentation\/frame\.mjs"/g, 'src="/js/presentation-demo/presentation/frame.mjs"');
  if (!deck.includes('/js/presentation-demo/presentation/frame.mjs')) {
    throw new Error('Authored deck frame adapter was not found in the source deck.');
  }
  return deck;
}

function build({ check = false } = {}) {
  const bytes = Buffer.from(renderOnlineDeck(), 'utf8');
  if (check) {
    if (!fs.existsSync(output)) throw new Error('Generated online deck is missing. Run package-online-deck.cjs first.');
    const existing = fs.readFileSync(output);
    if (!existing.equals(bytes)) throw new Error(`Online deck drift detected (expected ${sha256(bytes)}, found ${sha256(existing)}).`);
    return { checked: true, output, sha256: sha256(bytes), bytes: bytes.length };
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  return { checked: false, output, sha256: sha256(bytes), bytes: bytes.length };
}

if (require.main === module) {
  try { console.log(JSON.stringify(build({ check: process.argv.includes('--check') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { build, renderOnlineDeck };
