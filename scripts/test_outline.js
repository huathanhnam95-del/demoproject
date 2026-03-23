require('dotenv').config();
const cache = require('../src/services/reading-journey/cache');

(async () => {
  const outlines = await cache.listCachedOutlines();
  const first = outlines[0];
  
  const result = {
    title: first.value.title,
    beatOutline: first.value.beatOutline
  };
  
  require('fs').writeFileSync('test_outline_output.json', JSON.stringify(result, null, 2));
  process.exit(0);
})();
