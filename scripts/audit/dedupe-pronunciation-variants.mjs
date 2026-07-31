import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dictionaryPath = path.join(workspace, 'public', 'ipa-dict.json');

global.window = {};
global.arpabetToIPA = require(path.join(workspace, 'public', 'arpabet-ipa-map.js')).arpabetToIPA;
require(path.join(workspace, 'public', 'phonetics.js'));
const { normalizeIPA } = global.window.Phonetics;

const dictionary = JSON.parse(await fs.readFile(dictionaryPath, 'utf8'));
let changedWords = 0;
let removedVariants = 0;

for (const [word, rawValue] of Object.entries(dictionary)) {
  const variants = Array.isArray(rawValue) ? rawValue : [rawValue];
  const seen = new Set();
  const deduped = variants.filter((variant) => {
    const normalized = normalizeIPA(variant, word);
    if (seen.has(normalized)) {
      removedVariants += 1;
      return false;
    }
    seen.add(normalized);
    return true;
  });
  if (deduped.length !== variants.length) {
    dictionary[word] = deduped;
    changedWords += 1;
  }
}

await fs.writeFile(dictionaryPath, `${JSON.stringify(dictionary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ dictionaryPath, changedWords, removedVariants }, null, 2));
