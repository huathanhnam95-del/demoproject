/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function spokenRaw(tokens) {
  return tokens.filter((token) => token.type === 'spoken').map((token) => token.raw);
}

async function loadGrammar() {
  await import(pathToFileURL(path.join(__dirname, '../public/js/read-aloud-prompt-grammar.js')).href);
  return globalThis.ReadAloudPromptGrammar;
}

(async () => {
  const grammar = await loadGrammar();
  const usTokens = grammar.tokenizePrompt('The U.S. economy');
  assert.deepStrictEqual(
    spokenRaw(usTokens),
    ['The', 'U.S.', 'economy'],
    'U.S. should remain a single spoken token'
  );

  const phdTokens = grammar.tokenizePrompt('She has a Ph.D. degree.');
  assert.deepStrictEqual(
    spokenRaw(phdTokens),
    ['She', 'has', 'a', 'Ph.D.', 'degree'],
    'Ph.D. should remain a single spoken token'
  );

  const timeTokens = grammar.tokenizePrompt('Meet me at 10:30 a.m.');
  assert.deepStrictEqual(
    spokenRaw(timeTokens),
    ['Meet', 'me', 'at', '10:30', 'a.m.'],
    'times and a.m./p.m. abbreviations should remain intact'
  );

  const possessiveTokens = grammar.tokenizePrompt('Ingeborg’s idea is people\'s choice.');
  assert.deepStrictEqual(
    spokenRaw(possessiveTokens),
    ['Ingeborg’s', 'idea', 'is', "people's", 'choice'],
    'curly and straight apostrophes should stay inside spoken tokens'
  );

  const stripped = grammar.stripChunkMarkers('The amount of sunlight / that Earth reflects back into space // has decreased.');
  assert.strictEqual(
    stripped,
    'The amount of sunlight  that Earth reflects back into space  has decreased.',
    'stripChunkMarkers should only remove the marker tokens and preserve surrounding text'
  );

  const comparison = grammar.compareCanonicalPrompt(
    'Earth’s climate is changing.',
    'Earth\'s climate / is changing.'
  );
  assert.strictEqual(comparison.ok, true, 'compareCanonicalPrompt should normalize smart apostrophes for comparison');

  const mismatch = grammar.compareCanonicalPrompt(
    'The data is useful.',
    'The data / was useful.'
  );
  assert.strictEqual(mismatch.ok, false, 'text rewrites should fail canonical comparison');
  assert.strictEqual(mismatch.reason, 'token_mismatch', 'comparison failures should explain mismatch type');

  const invalidChunking = grammar.validateChunkedPrompt(
    'The data is useful.',
    'The data / // is useful.'
  );
  assert.strictEqual(invalidChunking.ok, false, 'adjacent chunk markers should be rejected');
  assert.strictEqual(invalidChunking.reason, 'consecutive_markers', 'adjacent markers should fail with a specific reason');

  const boundaries = grammar.buildSpokenBoundaryKeys(
    grammar.tokenizePrompt('Read aloud / with care // today.', { allowChunkMarkers: true })
  );
  assert.deepStrictEqual(
    Array.from(boundaries.blockedBoundarySet.values()),
    ['1:2', '3:4'],
    'chunk markers should block linking across the adjacent spoken-token boundary'
  );

  console.log('read-aloud prompt grammar tests passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
