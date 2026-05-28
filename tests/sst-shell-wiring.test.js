/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const html = read('public/index.html');
const script = read('public/script.js');
const lazyLoader = read('public/js/lazy-loader.js');
const attributes = read('.gitattributes');

assert.match(html, /id="mode-btn-sst"[\s\S]*data-practice-skill="listening"/, 'SST needs a Listening launcher card');
assert.match(html, /id="tab-sst"/, 'SST needs a mode tab');
assert.match(html, /id="mode-sst"/, 'SST needs a mode panel');
assert.match(script, /listening:\s*\{[\s\S]*?modeIds:\s*\[\s*'sst'/, 'SST must be first in Listening');
assert.match(script, /visibleModes:\s*new Set\(\[[\s\S]*?'sst'/, 'SST must be visible in PTE scope');
assert.match(script, /ensureModeAssets[\s\S]*?'sst'/, 'SST must participate in lazy asset loading');
assert.match(script, /window\.SSTMode\?\.onExit/, 'SST needs route-exit cleanup');
assert.match(script, /window\.SSTMode[\s\S]*?activate/, 'SST needs route activation');
assert.match(lazyLoader, /ensureSstModeLoaded/, 'SST needs a lazy loader');
assert.match(lazyLoader, /sst-mode\.js/, 'SST controller must be loaded lazily');
assert.match(attributes, /public\/database\/SST\/audio\/\*\*\/\*\.mp3.*filter=lfs/, 'SST audio must use Git LFS');
assert(fs.existsSync(path.join(root, 'public', 'sst-mode.js')), 'SST controller file must exist');
assert(fs.existsSync(path.join(root, 'public', 'sst-mode.css')), 'SST stylesheet file must exist');

console.log('SST shell wiring tests passed.');
