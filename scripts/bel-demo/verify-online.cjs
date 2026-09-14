'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!process.argv.includes('--unit')) throw new Error('Usage: node scripts/bel-demo/verify-online.cjs --unit');
run(process.execPath, ['scripts/bel-demo/build-online-core.cjs', '--check']);
run(process.execPath, ['scripts/bel-demo/package-online-deck.cjs', '--check']);
run(process.execPath, ['scripts/bel-demo/build-pdf-fonts.cjs', '--check']);
const onlineTests = fs.readdirSync(path.join(repo, 'tests/bel-demo-online'))
  .filter(name => /\.test\.(cjs|mjs)$/.test(name))
  .sort()
  .map(name => path.join('tests/bel-demo-online', name));
run(process.execPath, ['--test', ...onlineTests]);
