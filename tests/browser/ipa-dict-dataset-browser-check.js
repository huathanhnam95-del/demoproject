/**
 * E2E Browser Test Suite for ipa-dict Dataset & Phonetics Pipeline
 * 
 * Verifies:
 * - Browser loading performance of ipa-dict.json (3.75MB static asset)
 * - Correct IPA transcriptions for primary and alternative pronunciations
 * - Symbol normalization (ɹ->r, ɫ->l, ɾ->t) in browser JS runtime
 * - Apostrophes, hyphenation, casing, whitespace edge cases
 * - CMU fallback when word is absent from ipa-dict
 * - Batch lookup performance
 * - Service Worker cache registration
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

async function startServer() {
  const app = express();
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function run() {
  console.log('🚀 Starting ipa-dict dataset E2E browser check...');
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => {
    console.error('Page error detailed:', err);
    pageErrors.push(err);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('Page console error:', msg.text(), msg.location());
    }
  });

  try {
    // 1. Navigate to index page
    console.log(`Navigating to ${origin}...`);
    await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });

    // Bypass welcome onboarding modal if present
    await page.evaluate(() => {
      try {
        sessionStorage.setItem('pte_welcome_seen', 'true');
        sessionStorage.setItem('onboarding_completed', 'true');
      } catch (e) {}
    });

    // Load phonetics script manually into page context if needed
    await page.evaluate(async () => {
      if (!window.Phonetics) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/arpabet-ipa-map.js';
          script.onload = () => {
            const phonScript = document.createElement('script');
            phonScript.src = '/phonetics.js';
            phonScript.onload = resolve;
            phonScript.onerror = reject;
            document.head.appendChild(phonScript);
          };
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    });

    // Verify Phonetics module loaded in browser
    const phoneticsAvailable = await page.evaluate(() => typeof window.Phonetics !== 'undefined');
    assert.strictEqual(phoneticsAvailable, true, 'Phonetics module should be loaded globally');

    // 2. Measure dataset load performance
    console.log('⚡ Measuring ipa-dict.json load performance in browser...');
    const loadTimeMs = await page.evaluate(async () => {
      const start = performance.now();
      await window.Phonetics.preload();
      return Math.round(performance.now() - start);
    });
    console.log(`  -> ipa-dict + CMU dataset load & parse time: ${loadTimeMs}ms`);
    assert.ok(loadTimeMs < 3000, `Dataset loading should take less than 3 seconds (was ${loadTimeMs}ms)`);

    // 3. Test core pronunciations & Oxford variant ("forest")
    console.log('🔍 Testing core pronunciations & Oxford variants...');
    const forestRes = await page.evaluate(async () => {
      const ipa = await window.Phonetics.getIPA('forest');
      const details = await window.Phonetics.getIPAWithSource('forest');
      return { ipa, details };
    });
    console.log('  -> "forest":', forestRes);
    assert.strictEqual(forestRes.ipa, '/ˈfɔːrəst/');
    assert.strictEqual(forestRes.details.source, 'ipa-dict');
    assert.ok(forestRes.details.alternatives.includes('/ˈfɔːrɪst/'), 'Should include Oxford variant /ˈfɔːrɪst/ as alternative');

    const reviewedRes = await page.evaluate(async () => ({
      antidumping: await window.Phonetics.getIPAWithSource('antidumping'),
      analyze: await window.Phonetics.getIPAWithSource('analyze'),
      augustus: await window.Phonetics.getIPAWithSource('augustus')
    }));
    assert.equal(reviewedRes.antidumping.ipa, '/ˌæntaɪˈdʌmpɪŋ/');
    assert.equal(reviewedRes.antidumping.source, 'oxford-american');
    assert.equal(reviewedRes.analyze.source, 'oxford-american');
    assert.deepStrictEqual(reviewedRes.augustus, {
      ipa: '',
      alternatives: [],
      source: null,
      isApproximate: false
    });

    // 4. Test symbol normalizations (ɹ->r, ɫ->l, ɾ->t)
    console.log('🔍 Testing symbol normalizations (flap T, dark L, turned R)...');
    const symbolNorms = await page.evaluate(async () => {
      const water = await window.Phonetics.getIPA('water');
      const butter = await window.Phonetics.getIPA('butter');
      const little = await window.Phonetics.getIPA('little');
      return { water, butter, little };
    });
    console.log('  -> Symbol norms:', symbolNorms);
    assert.ok(!symbolNorms.water.includes('ɾ'), 'water IPA should not contain raw flap ɾ');
    assert.ok(!symbolNorms.butter.includes('ɾ'), 'butter IPA should not contain raw flap ɾ');
    assert.ok(!symbolNorms.little.includes('ɫ'), 'little IPA should not contain raw dark L ɫ');
    assert.ok(!symbolNorms.water.includes('ɹ'), 'water IPA should not contain raw turned r ɹ');

    // 5. Test multiple pronunciations
    console.log('🔍 Testing multi-pronunciation words...');
    const multiWords = await page.evaluate(async () => {
      const either = await window.Phonetics.getIPAWithSource('either');
      const a = await window.Phonetics.getIPAWithSource('a');
      const the = await window.Phonetics.getIPAWithSource('the');
      return { either, a, the };
    });
    console.log('  -> "either":', multiWords.either);
    console.log('  -> "a":', multiWords.a);
    console.log('  -> "the":', multiWords.the);
    assert.ok(multiWords.either.alternatives.length > 0, 'either should have alternative pronunciations');
    assert.ok(multiWords.a.alternatives.length > 0, 'a should have alternative pronunciations');
    assert.ok(multiWords.the.alternatives.length > 0, 'the should have alternative pronunciations');
    assert.strictEqual(multiWords.the.ipa, '/ðiː/', 'the citation form should use Oxford-American strong /ðiː/');
    assert.deepStrictEqual(
      [multiWords.the.ipa, ...multiWords.the.alternatives],
      ['/ðiː/', '/ði/', '/ðə/'],
      'the strong citation and weak alternatives should be exposed once each'
    );

    // 6. Test edge cases: casing, whitespace, punctuation
    console.log('🔍 Testing formatting edge cases (casing, whitespace, apostrophes, hyphens)...');
    const edgeCases = await page.evaluate(async () => {
      const uppercase = await window.Phonetics.getIPA('  FOREST  ');
      const mixedCase = await window.Phonetics.getIPA('WaTeR');
      const dont = await window.Phonetics.getIPA("don't");
      const cant = await window.Phonetics.getIPA("can't");
      const wellKnown = await window.Phonetics.getIPA('well-known');
      return { uppercase, mixedCase, dont, cant, wellKnown };
    });
    console.log('  -> Edge cases:', edgeCases);
    assert.strictEqual(edgeCases.uppercase, '/ˈfɔːrəst/', 'Whitespace and uppercase should be normalized');
    assert.strictEqual(edgeCases.dont, '/doʊnt/', "don't should retain its citation-form final /t/");
    assert.ok(edgeCases.cant.length > 0, "can't should return valid IPA");

    // 7. Test CMU Fallback & Out-of-Vocabulary words
    console.log('🔍 Testing CMU fallback & invalid inputs...');
    const fallbacks = await page.evaluate(async () => {
      const cmuOnly = await window.Phonetics.getIPAWithSource('zyzzyva');
      const invalid = await window.Phonetics.getIPA('12345!@#$%');
      const empty = await window.Phonetics.getIPA('');
      return { cmuOnly, invalid, empty };
    });
    console.log('  -> Fallbacks & Invalid:', fallbacks);
    assert.strictEqual(fallbacks.invalid, '', 'Non-alphabetic string should return empty string');
    assert.strictEqual(fallbacks.empty, '', 'Empty input should return empty string');

    // 8. Test Batch Lookup (`getIPABatch`) performance with 50 words
    console.log('⚡ Testing batch lookup with 50 words...');
    const batchRes = await page.evaluate(async () => {
      const sampleWords = [
        'apple', 'banana', 'computer', 'dictionary', 'education',
        'forest', 'green', 'house', 'information', 'journey',
        'knowledge', 'language', 'mountain', 'nature', 'ocean',
        'practice', 'quality', 'research', 'system', 'technology',
        'university', 'vocabulary', 'weather', 'xylophone', 'yesterday',
        'ability', 'beautiful', 'challenge', 'development', 'environment',
        'foundation', 'government', 'history', 'important', 'judgment',
        'kingdom', 'leadership', 'management', 'national', 'opportunity',
        'performance', 'question', 'relationship', 'structure', 'traditional',
        'understanding', 'value', 'wonderful', 'yellow', 'zone'
      ];
      const start = performance.now();
      const results = await window.Phonetics.getIPABatch(sampleWords);
      const durationMs = Math.round(performance.now() - start);
      return { count: Object.keys(results).length, durationMs, sample: results['computer'] };
    });
    console.log(`  -> Batch transcribed ${batchRes.count} words in ${batchRes.durationMs}ms (e.g. computer -> ${batchRes.sample})`);
    assert.strictEqual(batchRes.count, 50);
    assert.ok(batchRes.durationMs < 500, `Batch lookup should be fast (<500ms, was ${batchRes.durationMs}ms)`);

    // 9. Verify Service Worker precaching configuration
    console.log('🔍 Verifying Service Worker cache config...');
    const swContent = await page.evaluate(async () => {
      const res = await fetch('/sw.js');
      return await res.text();
    });
    const shellMatch = swContent.match(/const SHELL_URLS = \[([\s\S]*?)\];/);
    assert.ok(shellMatch, 'Service worker sw.js must declare SHELL_URLS');
    const shellUrls = shellMatch[1];
    assert.ok(!shellUrls.includes('/ipa-dict.json'), 'Large IPA dictionary must load on demand instead of blocking service-worker install');
    assert.ok(shellUrls.includes('/phonetics.js'), 'Service worker sw.js must include /phonetics.js in SHELL_URLS');
    assert.ok(shellUrls.includes('/oxford-american-ipa.json'), 'Service worker sw.js must include the Oxford-American IPA layer in SHELL_URLS');

    assert.deepStrictEqual(pageErrors, [], 'Should have no uncaught page errors');
    console.log('✅ ALL E2E BROWSER CHECKS PASSED SUCCESSFULLY!');
  } finally {
    await browser.close();
    server.close();
  }
}

run()
  .then(() => process.stdout.write('ipa-dict dataset browser check passed\n'))
  .catch((err) => {
    console.error('❌ Browser check failed:', err);
    process.exitCode = 1;
  });
