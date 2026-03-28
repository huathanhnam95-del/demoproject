const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(process.cwd(), 'public/watch-mode.js'), 'utf8');

assert(!source.includes('onclick="WatchMode.selectVideo('), 'Legacy video-card inline handler must be removed.');
assert(!source.includes('onclick="WatchMode.selectMCOption('), 'Legacy MC option inline handler must be removed.');
assert(!source.includes('onclick="WatchMode.seekToQuestion('), 'Legacy question-marker inline handler must be removed.');

console.log('watch-mode rendering regression passed');
