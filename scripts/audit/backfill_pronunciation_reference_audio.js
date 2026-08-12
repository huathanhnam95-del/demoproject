/* eslint-disable no-console */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const core = require('./pronunciation_reference_backfill_core');
const {
  resolveDiscoveryReason,
  upsertReferenceAudioNeed
} = require('../../functions/src/pronunciation-reference-audio/service');

const ROOT = path.resolve(__dirname, '../..');

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`${response.status} ${response.statusText}`);
  return payload;
}

async function analyzeVariant(backendUrl, variant) {
  return jsonRequest(`${backendUrl.replace(/\/+$/, '')}/analyze-url/v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audioUrl: variant.audioUrl,
      variantId: variant.id,
      expectedSyllableCount: variant.syllableCount,
      referenceIpa: variant.displayIpa,
      referencePrimaryStress: variant.primaryStress,
      referenceSyllables: variant.syllables,
      partOfSpeech: variant.partOfSpeech || null,
      audioSourceKind: 'dictionary'
    })
  });
}

async function main() {
  const options = core.parseArgs(process.argv.slice(2));
  const checkpointPath = options.checkpoint || path.join(ROOT, 'test-results', 'pronunciation-reference-backfill-checkpoint.json');
  const completed = core.loadCheckpoint(checkpointPath);
  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId }, `pronunciation-reference-backfill-${Date.now()}`);
  const db = getFirestore(app);
  const cacheSnapshot = await db.collection('word_references').get();
  const cached = new Map(cacheSnapshot.docs.map((doc) => [doc.id, doc.data()]));
  const oxford = options.cachedOnly ? [] : core.parseOxfordWords(await fsp.readFile(path.join(ROOT, 'public', 'The_Oxford_5000.csv'), 'utf8'));
  const words = [...new Set([...cached.keys(), ...oxford])].filter((word) => !completed.has(word)).slice(0, options.limit);
  const stats = { words: words.length, refreshed: 0, queued: 0, compatible: 0, failed: 0, apply: options.apply };
  console.log(JSON.stringify(stats, null, 2));

  for (const word of words) {
    try {
      const cachedReference = cached.get(word)?.referenceV2;
      const reference = cachedReference || await jsonRequest(`${options.backendUrl.replace(/\/+$/, '')}/dictionary/v2/${encodeURIComponent(word)}`);
      const variants = [];
      for (const sourceVariant of reference.variants || []) {
        const variant = { ...sourceVariant };
        let analysis = variant.nativeAnalysis || null;
        const sharedSource = variant.audioUrl && (reference.variants || []).filter((candidate) => candidate.audioUrl === variant.audioUrl).length > 1;
        if (variant.audioUrl && (core.referenceNeedsRefresh(variant) || sharedSource)) {
          analysis = await analyzeVariant(options.backendUrl, variant);
          variant.nativeAnalysis = analysis;
          variant.capabilities = {
            ...(variant.capabilities || {}),
            showNativeGraphs: analysis?.capabilities?.showNativeGraphs === true,
            showReferenceGraph: analysis?.capabilities?.showNativeGraphs === true
          };
          stats.refreshed += 1;
        }
        const reason = resolveDiscoveryReason(reference, variant, analysis);
        if (reason) {
          stats.queued += 1;
          if (options.apply) await upsertReferenceAudioNeed({ db, reference, variant, reason });
        } else if (variant.audioUrl) {
          stats.compatible += 1;
        }
        variants.push(variant);
      }
      if (options.apply) {
        await db.collection('word_references').doc(word).set({
          word,
          referenceV2: {
            ...reference,
            variants,
            referenceAcousticRevision: 'canonical-pitch-v1',
            referenceCompatibilityRevision: 'reference-audio-compatibility-v1'
          },
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      completed.add(word);
    } catch (error) {
      stats.failed += 1;
      console.error(`${word}: ${error.message}`);
    }
    await fsp.mkdir(path.dirname(checkpointPath), { recursive: true });
    await fsp.writeFile(checkpointPath, `${JSON.stringify({ completedWords: [...completed], stats }, null, 2)}\n`);
  }
  console.log(JSON.stringify(stats, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { analyzeVariant };
