require('dotenv').config();
const cache = require('../src/services/reading-journey/cache');

(async () => {
  const outlines = await cache.listCachedOutlines();
  const first = outlines[0];
  const outlineId = first.id;
  
  const b1 = cache.computeBeatCacheKey({ outlineId, beatNumber: 1, path: [] });
  const b2 = cache.computeBeatCacheKey({ outlineId, beatNumber: 2, path: ['investigate'] });
  const b3 = cache.computeBeatCacheKey({ outlineId, beatNumber: 3, path: ['investigate', 'investigate'] });
  
  const result = {
    title: first.value.title,
    b1_id: b1.id,
    b1_key: b1.key,
    b2_id: b2.id,
    b2_key: b2.key,
    b3_id: b3.id,
    b3_key: b3.key,
  };
  
  require('fs').writeFileSync('test_keys_output.json', JSON.stringify(result, null, 2));
  process.exit(0);
})();
