const assert = require('node:assert/strict');

const { setStaticCacheHeaders } = require('../../src/server/app');

function getCacheControl({ hostname, query }, filePath) {
  const headers = {};
  setStaticCacheHeaders({
    req: { hostname, query },
    setHeader(name, value) {
      headers[name] = value;
    }
  }, filePath);
  return headers['Cache-Control'];
}

const localVersionedAsset = getCacheControl(
  { hostname: 'localhost', query: { v: '20260703_tab_swap' } },
  'C:\\Cursor AI\\public\\script.js'
);
assert.match(localVersionedAsset, /no-cache/);
assert.doesNotMatch(localVersionedAsset, /immutable/);

const productionVersionedAsset = getCacheControl(
  { hostname: 'betterenglishlearning.com', query: { v: '20260703_tab_swap' } },
  'C:\\Cursor AI\\public\\script.js'
);
assert.match(productionVersionedAsset, /immutable/);

console.log('static cache contract passed');
