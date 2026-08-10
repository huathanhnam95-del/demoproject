const assert = require('assert');
const fs = require('fs');
const path = require('path');

const productionRoute = fs.readFileSync(
  path.join(process.cwd(), 'functions/src/routes/read-aloud.js'),
  'utf8'
);

assert(
  productionRoute.includes("const startMs = getAzureWordTimingMs(word, 'Offset');"),
  'Firebase Read Aloud must preserve Azure word timing precision.'
);
assert(
  productionRoute.includes("const durationMs = getAzureWordTimingMs(word, 'Duration');"),
  'Firebase Read Aloud must convert Azure duration with the shared timing contract.'
);
assert(
  productionRoute.includes('endMs: startMs != null && durationMs != null ? startMs + durationMs : null'),
  'Firebase Read Aloud must return explicit null timing when Azure omits offset or duration.'
);
assert(
  !productionRoute.includes('Math.round(offset / 10000)'),
  'Firebase Read Aloud must not round word timestamps before browser playback.'
);

console.log('read-aloud production route timing contract passed');
