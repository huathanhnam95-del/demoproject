require('dotenv').config();
const cache = require('../src/services/reading-journey/cache');

(async () => {
  const outlines = await cache.listCachedOutlines();
  const first = outlines[0];
  const outlineId = first.id;
  
  const b1 = cache.computeBeatCacheKey({ outlineId, beatNumber: 1, path: [] });
  const b2 = cache.computeBeatCacheKey({ outlineId, beatNumber: 2, path: ['investigate'] });
  const b3 = cache.computeBeatCacheKey({ outlineId, beatNumber: 3, path: ['investigate', 'investigate'] });
  
  const v1 = await cache.getCachedValue({ collection: 'reading_journey_beats_v1', id: b1.id });
  const v2 = await cache.getCachedValue({ collection: 'reading_journey_beats_v1', id: b2.id });
  const v3 = await cache.getCachedValue({ collection: 'reading_journey_beats_v1', id: b3.id });
  
  const result = {
    title: first.value.title,
    b1_segment: v1?.segment,
    b2_segment: v2?.segment,
    b3_segment: v3?.segment,
  };
  
  require('fs').writeFileSync('test_beats_output.json', JSON.stringify(result, null, 2));
  process.exit(0);
})();
