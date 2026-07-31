import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dictionaryPath = path.join(workspace, 'public', 'ipa-dict.json');
const overlayPath = path.join(workspace, 'public', 'oxford-american-ipa.json');

const [dictionary, overlay] = await Promise.all([
  fs.readFile(dictionaryPath, 'utf8').then(JSON.parse),
  fs.readFile(overlayPath, 'utf8').then(JSON.parse)
]);

const next = { ...dictionary };
const updates = [];
for (const [word, variants] of Object.entries(overlay.entries || {})) {
  if (!Array.isArray(variants) || variants.length === 0) continue;
  next[word] = [...new Set(variants)];
  updates.push(word);
}

const quarantined = [];
for (const word of overlay.quarantine || []) {
  if (Object.prototype.hasOwnProperty.call(next, word)) {
    delete next[word];
    quarantined.push(word);
  }
}

await fs.writeFile(dictionaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  dictionaryPath,
  updatedWords: updates.length,
  quarantinedWords: quarantined
}, null, 2));
