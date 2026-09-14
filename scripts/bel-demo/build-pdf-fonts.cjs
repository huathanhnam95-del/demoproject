'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const pairs = [
  ['public/fonts/Roboto-Regular.ttf', 'functions/src/crm/presentation-demo/fonts/Roboto-Regular.ttf'],
  ['public/fonts/Roboto-Bold.ttf', 'functions/src/crm/presentation-demo/fonts/Roboto-Bold.ttf']
];

function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function build({ check = false } = {}) {
  const results = pairs.map(([sourceRel, outputRel]) => {
    const source = path.join(repo, sourceRel);
    const output = path.join(repo, outputRel);
    const sourceBytes = fs.readFileSync(source);
    if (check) {
      const outputBytes = fs.readFileSync(output);
      if (!outputBytes.equals(sourceBytes)) throw new Error(`PDF font drift detected: ${outputRel}`);
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, sourceBytes);
    }
    return { source: sourceRel, output: outputRel, sha256: digest(source), bytes: sourceBytes.length };
  });
  return { checked: check, pairs: results };
}

if (require.main === module) {
  try { console.log(JSON.stringify(build({ check: process.argv.includes('--check') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { build };
