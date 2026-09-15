import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../public/js/crm/entrance-test-ui-lab.js', import.meta.url), 'utf8');

test('CRM host extends the existing rater with Demo D and preserves the historical frame route', () => {
  assert.match(source, /id: 'a'/);
  assert.match(source, /id: 'b'/);
  assert.match(source, /id: 'c'/);
  assert.match(source, /id: 'd', label: 'D · Signal Noto'/);
  assert.match(source, /const NEED_RATINGS = SKINS\.length \* PAGES\.length \* CRITERIA\.length/);
  assert.match(source, /return '\/entrance-test-ui\/\?revisionId=academic-noto-v1'/);
  assert.match(source, /return 'entrance-test-ui-lab\.html\?' \+ p\.toString\(\)/);
  assert.match(source, /type: 'etui:goto', skin: 'd', revisionId: 'academic-noto-v1'/);
  assert.match(source, /msg\.type === 'etui:page'/);
});

test('CRM host never bypasses the ordinary five-star rating path for Demo D', () => {
  assert.match(source, /const k = key\(state\.skin, pageId, criterion\.id\)/);
  assert.match(source, /const k = key\(state\.skin, state\.page, critId\)/);
  assert.match(source, /data-rate="' \+ esc\(criterion\.id\) \+ '"/);
});
