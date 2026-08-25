import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function filesUnder(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.name.endsWith('.js')) files.push(child);
  }
  return files;
}

test('Echo Forge production modules remain isolated from account progression and Survival runtime', async () => {
  const moduleRoot = new URL('../../public/js/echo-forge/', import.meta.url);
  const source = (await Promise.all((await filesUnder(moduleRoot)).map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /from\s+['"][^'"]*survival|SurvivalGame|UpgradeManager|submitAttempt|pointsLogic|Firestore|firebase-admin|accountXp|mastery|currency/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('Echo Forge assessment route is stateless and never imports persistence systems', async () => {
  const localRoute = await readFile(new URL('../../src/routes/echo-forge.js', import.meta.url), 'utf8');
  const functionsRoute = await readFile(new URL('../../functions/src/routes/echo-forge.js', import.meta.url), 'utf8');
  for (const source of [localRoute, functionsRoute]) {
    assert.doesNotMatch(source, /firebase|firestore|uploadConnectedSpeech|persistConnectedSpeech|getStorageBucket|recognizedText|Display\b/i);
    assert.match(source, /ECHO_FORGE_SANDBOX_ENABLED/);
    assert.match(source, /createEchoForgeRouter/);
  }
});

test('standalone shell is animation-free, A1-C1-only, and absent from main navigation', async () => {
  const shell = await readFile(new URL('../../public/echo-forge-sandbox.html', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /<option[^>]*>\s*C2\s*</i);
  assert.doesNotMatch(shell, /@keyframes|requestAnimationFrame/);
  assert.doesNotMatch(await readFile(new URL('../../public/js/echo-forge/sandbox-entry.js', import.meta.url), 'utf8'), /speechSynthesis|SpeechSynthesisUtterance/);
  assert.match(shell, /prefers-reduced-motion/);
  assert.match(shell, /role="status" aria-live="polite"/);
  assert.match(shell, /<progress[^>]+aria-label="Hero health"/);
  assert.match(shell, /<progress[^>]+aria-label="Echo Warden health"/);
  assert.match(shell, /min-height:44px/);

  const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../../public/script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(`${index}\n${launcher}`, /echo-forge|echoForge/i);
});
