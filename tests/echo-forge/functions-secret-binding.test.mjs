import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('only the stateless API export binds the Echo Forge Azure secret', async () => {
  const source = await readFile(new URL('../../functions/src/index.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /api:\s*onRequest\(\{\s*region:\s*['"]us-central1['"],\s*secrets:\s*\[['"]AZURE_SPEECH_KEY['"]\]\s*\},\s*apiApp\)/,
    'the API function must explicitly bind AZURE_SPEECH_KEY',
  );
  assert.equal((source.match(/AZURE_SPEECH_KEY/g) || []).length, 1, 'the key name should appear only in the API binding');
  assert.doesNotMatch(source, /defineSecret|secret\.value|functions:secrets:access|process\.env\.AZURE_SPEECH_KEY/);
});
