import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Speech V3 API and workers bind their required secrets without reading values in source', async () => {
  const source = await readFile(new URL('../../functions/src/index.js', import.meta.url), 'utf8');
  const apiBinding = source.match(/api:\s*onRequest\(\{([\s\S]*?)\},\s*apiApp\)/)?.[1];
  const scoreWorkerBinding = source.match(/scoreWorkerTask:\s*onTaskDispatched\(\{([\s\S]*?)\},\s*async/)?.[1];
  const entranceWorkerBinding = source.match(/entranceSpeechWorkerTask:\s*onTaskDispatched\(\{([\s\S]*?)\},\s*async/)?.[1];
  assert.ok(apiBinding, 'the API function declaration must exist');
  assert.ok(scoreWorkerBinding, 'the score worker declaration must exist');
  assert.ok(entranceWorkerBinding, 'the entrance speech worker declaration must exist');
  assert.match(apiBinding, /region:\s*\['asia-southeast1',\s*'us-central1'\]/);
  assert.match(apiBinding, /secrets:\s*\['AZURE_SPEECH_KEY',\s*'GROQ_API_KEY'\]/);
  assert.match(scoreWorkerBinding, /secrets:\s*\['AZURE_SPEECH_KEY',\s*'GROQ_API_KEY'\]/);
  assert.match(entranceWorkerBinding, /secrets:\s*\['AZURE_SPEECH_KEY'\]/);
  assert.equal((source.match(/AZURE_SPEECH_KEY/g) || []).length, 3);
  assert.equal((source.match(/GROQ_API_KEY/g) || []).length, 2);
  assert.doesNotMatch(source, /defineSecret|secret\.value|functions:secrets:access|process\.env\.(?:AZURE_SPEECH_KEY|GROQ_API_KEY)/);
});
