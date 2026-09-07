/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  buildConnectedSpeechIndex
} = require('../scripts/read-aloud/build-connected-speech-index.js');
const {
  reportConnectedSpeechCoverage
} = require('../scripts/read-aloud/report-connected-speech-coverage.js');

async function writeWorkbook(filePath, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.columns = [
    { header: 'ID', key: 'ID', width: 12 },
    { header: 'TITLE', key: 'TITLE', width: 24 },
    { header: 'ANSWER', key: 'ANSWER', width: 60 },
    { header: 'ANSWER FOR COMPARE OR TRANSCRIPT', key: 'ANSWER FOR COMPARE OR TRANSCRIPT', width: 60 },
    { header: 'Word count', key: 'Word count', width: 12 }
  ];
  rows.forEach((row) => worksheet.addRow(row));
  await workbook.xlsx.writeFile(filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeAnalysis({ boundaries = [], tokenAnnotations = [] } = {}) {
  return {
    boundaries,
    tokenAnnotations
  };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-connected-speech-index-'));
  const workbookPath = path.join(tempDir, 'RA.xlsx');
  const audioManifestPath = path.join(tempDir, 'manifest.json');
  const publicIndexPath = path.join(tempDir, 'public', 'database', 'RA', 'connected-speech-index.json');
  const featuredPromptsPath = path.join(tempDir, 'public', 'database', 'RA', 'connected-speech-featured-prompts.json');
  const functionsIndexPath = path.join(tempDir, 'functions', 'src', 'data', 'read-aloud-connected-speech-index.json');
  const coverageDir = path.join(tempDir, 'coverage');
  const fixedGeneratedAt = '2026-09-07T00:00:00.000Z';
  const realFeaturedOutputPath = path.resolve(__dirname, '../public/database/RA/connected-speech-featured-prompts.json');
  const realFeaturedOutputBefore = fs.existsSync(realFeaturedOutputPath)
    ? fs.readFileSync(realFeaturedOutputPath)
    : null;

  await writeWorkbook(workbookPath, [
    {
      ID: '8',
      TITLE: 'Avi Loeb',
      ANSWER: 'The situation is similar to a pregnant woman who has twin babies in her belly, says Avi of the Smithsonian Center for Astrophysics.',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'The situation is similar to a pregnant woman who has twin babies in her belly, says Avi of the Smithsonian Center for Astrophysics.',
      'Word count': 22
    },
    {
      ID: '15',
      TITLE: 'Did You',
      ANSWER: 'Did you see it?',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Did you see it?',
      'Word count': 4
    },
    {
      ID: '16',
      TITLE: 'Pick It Up',
      ANSWER: 'Pick it up now.',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Pick it up now.',
      'Word count': 4
    },
    {
      ID: '17',
      TITLE: 'Ten Bikes',
      ANSWER: 'Ten bikes arrived.',
      'ANSWER FOR COMPARE OR TRANSCRIPT': 'Ten bikes arrived.',
      'Word count': 3
    }
  ]);

  fs.writeFileSync(audioManifestPath, JSON.stringify({
    '8': { male: { files: { '100': 'RA_8_male_100.mp3' } } },
    '15': { female: { files: { '100': 'RA_15_female_100.mp3' } } }
  }, null, 2));

  const linkingApi = {
    async analyzePrompt(text, options = {}) {
      const normalized = String(text || '').toLowerCase();
      if (normalized.includes('situation is similar to a pregnant woman')) {
        return makeAnalysis();
      }
      if (normalized.includes('did you see it')) {
        if (options.connectedSpeechLevel === 'v3_sound_changes') {
          return makeAnalysis({
            boundaries: [
              {
                id: 'b-1',
                leftWord: 'did',
                rightWord: 'you',
                leftDisplay: 'did',
                rightDisplay: 'you',
                blocked: false,
                confidence: 'high',
                layer: 'assimilation',
                subtype: 'coalescent_dj',
                category: 'connected_speech',
                markerText: 'sound change'
              }
            ]
          });
        }
        return makeAnalysis();
      }
      if (normalized.includes('pick it up now')) {
        if (options.connectedSpeechLevel === 'v1_linking') {
          return makeAnalysis({
            boundaries: [
              {
                id: 'b-2',
                leftWord: 'pick',
                rightWord: 'it',
                leftDisplay: 'pick',
                rightDisplay: 'it',
                blocked: false,
                confidence: 'high',
                layer: 'linking',
                subtype: 'consonant_to_vowel',
                category: 'connected_speech',
                markerText: 'link'
              }
            ]
          });
        }
        return makeAnalysis();
      }
      if (normalized.includes('ten bikes arrived')) {
        if (options.connectedSpeechLevel === 'v3_sound_changes') {
          return makeAnalysis({
            boundaries: [
              {
                id: 'b-3',
                leftWord: 'ten',
                rightWord: 'bikes',
                leftDisplay: 'ten',
                rightDisplay: 'bikes',
                blocked: false,
                confidence: 'high',
                layer: 'assimilation',
                subtype: 'n_bilabial_assimilation',
                category: 'connected_speech',
                markerText: 'sound change'
              }
            ]
          });
        }
        return makeAnalysis();
      }
      return makeAnalysis();
    }
  };

  const result = await buildConnectedSpeechIndex({
    workbookPath,
    audioManifestPath,
    publicIndexPath,
    featuredPromptsPath,
    functionsIndexPath,
    coverageDir,
    generatedAt: fixedGeneratedAt,
    concurrency: 2,
    linkingApi
  });

  assert.ok(fs.existsSync(publicIndexPath), 'public index should be written');
  assert.ok(fs.existsSync(featuredPromptsPath), 'featured prompts output should be written in the temporary candidate');
  assert.ok(fs.existsSync(functionsIndexPath), 'functions index should be written');
  assert.equal(result.index.generatedAt, fixedGeneratedAt, 'generated metadata should use the fixed test timestamp');

  const publicIndex = readJson(publicIndexPath);
  const functionsIndex = readJson(functionsIndexPath);
  assert.deepStrictEqual(functionsIndex, publicIndex, 'public and functions index copies should match');
  assert.deepStrictEqual(fs.readFileSync(functionsIndexPath), fs.readFileSync(publicIndexPath), 'public and functions index bytes should match');
  assert.equal(publicIndex.prompts.length, 4, 'all workbook rows should be indexed');

  const featuredPrompts = readJson(featuredPromptsPath);
  assert.equal(featuredPrompts.updatedAt, fixedGeneratedAt, 'featured prompt metadata should use the fixed test timestamp');
  assert.equal(featuredPrompts.version, '1', 'featured prompt metadata should preserve the index version');
  assert.ok(featuredPrompts.families && featuredPrompts.subtypes, 'featured prompt metadata should retain its curation families');

  const avi = publicIndex.prompts.find((prompt) => String(prompt.questionId) === '8');
  const didYou = publicIndex.prompts.find((prompt) => String(prompt.questionId) === '15');
  const pickItUp = publicIndex.prompts.find((prompt) => String(prompt.questionId) === '16');
  const tenBikes = publicIndex.prompts.find((prompt) => String(prompt.questionId) === '17');

  assert.ok(avi, 'Avi Loeb row should be indexed');
  assert.equal(avi.hasSampleAudio, true, 'audio manifest should mark audio availability');
  assert.equal(avi.hasSoundChanges, false, 'Avi Loeb row should not show sound changes');
  assert.equal(avi.hasAnyConnectedSpeech, false, 'Avi Loeb row should not be forced into connected speech when no boundaries are present');

  assert.ok(didYou, 'Did you row should be indexed');
  assert.equal(didYou.hasSoundChanges, true, '"Did you" should produce a sound-change record');
  assert.ok(Array.isArray(didYou.representativeExamples) && didYou.representativeExamples.some((example) => example.family === 'sound_changes'), 'sound-change rows should surface representative examples');
  assert.ok(didYou.previewExamplesByCategory?.sound_changes?.some((example) => example.subtype === 'coalescent_dj'), 'sound-change previews should be grouped by learner category');

  assert.ok(pickItUp, 'Pick it up row should be indexed');
  assert.equal(pickItUp.hasLinking, true, 'linking row should be marked as linking');

  assert.ok(tenBikes, 'Ten bikes row should be indexed');
  assert.equal(tenBikes.hasSoundChanges, true, 'bilabial-assimilation prompt should be marked as sound changes');
  assert.ok(
    Array.isArray(tenBikes.previewExamplesByCategory?.sound_changes)
    && tenBikes.previewExamplesByCategory.sound_changes.some((example) => example.subtype === 'n_bilabial_assimilation'),
    'bilabial assimilation should appear in the sound_changes preview category'
  );

  const coverageJson = readJson(path.join(coverageDir, 'coverage.json'));
  assert.equal(coverageJson.promptCount, 4, 'coverage should include all prompts');
  assert.equal(coverageJson.promptsWithSampleAudio, 2, 'coverage should count sample audio availability');
  assert.ok(coverageJson.soundChangeCount >= 1, 'coverage should report at least one sound-change prompt');
  assert.equal(coverageJson.generatedAt, fixedGeneratedAt, 'coverage metadata should use the fixed test timestamp');
  assert.ok(fs.existsSync(path.join(coverageDir, 'summary.md')), 'coverage summary markdown should be written');
  assert.ok(fs.readFileSync(path.join(coverageDir, 'summary.md'), 'utf8').includes(fixedGeneratedAt), 'coverage summary should retain the fixed test timestamp');

  const coverageReport = await reportConnectedSpeechCoverage({
    publicIndexPath,
    coverageDir
  });
  assert.equal(coverageReport.coverage.promptCount, 4, 'report script should read the generated index');

  const secondTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-connected-speech-index-repeat-'));
  const secondWorkbookPath = path.join(secondTempDir, 'RA.xlsx');
  const secondAudioManifestPath = path.join(secondTempDir, 'manifest.json');
  const secondPublicIndexPath = path.join(secondTempDir, 'public', 'database', 'RA', 'connected-speech-index.json');
  const secondFeaturedPromptsPath = path.join(secondTempDir, 'public', 'database', 'RA', 'connected-speech-featured-prompts.json');
  const secondFunctionsIndexPath = path.join(secondTempDir, 'functions', 'src', 'data', 'read-aloud-connected-speech-index.json');
  const secondCoverageDir = path.join(secondTempDir, 'coverage');
  fs.copyFileSync(workbookPath, secondWorkbookPath);
  fs.copyFileSync(audioManifestPath, secondAudioManifestPath);
  await buildConnectedSpeechIndex({
    workbookPath: secondWorkbookPath,
    audioManifestPath: secondAudioManifestPath,
    publicIndexPath: secondPublicIndexPath,
    featuredPromptsPath: secondFeaturedPromptsPath,
    functionsIndexPath: secondFunctionsIndexPath,
    coverageDir: secondCoverageDir,
    generatedAt: fixedGeneratedAt,
    concurrency: 2,
    linkingApi
  });
  assert.deepStrictEqual(fs.readFileSync(secondPublicIndexPath), fs.readFileSync(publicIndexPath), 'same source and timestamp should produce identical public index bytes');
  assert.deepStrictEqual(fs.readFileSync(secondFeaturedPromptsPath), fs.readFileSync(featuredPromptsPath), 'same source and timestamp should produce identical featured metadata bytes');
  assert.deepStrictEqual(fs.readFileSync(secondFunctionsIndexPath), fs.readFileSync(functionsIndexPath), 'same source and timestamp should produce identical functions index bytes');
  assert.deepStrictEqual(fs.readFileSync(path.join(secondCoverageDir, 'coverage.json')), fs.readFileSync(path.join(coverageDir, 'coverage.json')), 'same source and timestamp should produce identical coverage JSON bytes');
  assert.deepStrictEqual(fs.readFileSync(path.join(secondCoverageDir, 'summary.md')), fs.readFileSync(path.join(coverageDir, 'summary.md')), 'same source and timestamp should produce identical coverage summary bytes');

  const failedWriteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-connected-speech-index-write-failure-'));
  const failedPublicIndexPath = path.join(failedWriteDir, 'public-index-blocker');
  fs.mkdirSync(failedPublicIndexPath, { recursive: true });
  await assert.rejects(
    () => buildConnectedSpeechIndex({
      workbookPath,
      audioManifestPath,
      publicIndexPath: failedPublicIndexPath,
      featuredPromptsPath: path.join(failedWriteDir, 'featured.json'),
      functionsIndexPath: path.join(failedWriteDir, 'functions.json'),
      coverageDir: path.join(failedWriteDir, 'coverage'),
      generatedAt: fixedGeneratedAt,
      concurrency: 2,
      linkingApi
    }),
    /write|output|directory|index/i,
    'a failed generated-output write must reject instead of preserving stale output'
  );

  const invalidTimestampDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-connected-speech-index-invalid-time-'));
  const invalidTimestampOptions = {
    workbookPath,
    audioManifestPath,
    publicIndexPath: path.join(invalidTimestampDir, 'public-index.json'),
    featuredPromptsPath: path.join(invalidTimestampDir, 'featured.json'),
    functionsIndexPath: path.join(invalidTimestampDir, 'functions.json'),
    coverageDir: path.join(invalidTimestampDir, 'coverage'),
    linkingApi
  };
  await assert.rejects(
    () => buildConnectedSpeechIndex({ ...invalidTimestampOptions, generatedAt: '2026-09-07T00:00:00' }),
    /ISO-8601|timestamp|offset|generatedAt/i,
    'a timezone-less timestamp must be rejected'
  );
  await assert.rejects(
    () => buildConnectedSpeechIndex({ ...invalidTimestampOptions, generatedAt: 'not-a-timestamp' }),
    /ISO-8601|timestamp|generatedAt/i,
    'an invalid timestamp must be rejected'
  );

  if (realFeaturedOutputBefore) {
    assert.deepStrictEqual(fs.readFileSync(realFeaturedOutputPath), realFeaturedOutputBefore, 'test must not rewrite the repository featured prompts output');
  } else {
    assert.equal(fs.existsSync(realFeaturedOutputPath), false, 'test must not create the repository featured prompts output');
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(secondTempDir, { recursive: true, force: true });
  fs.rmSync(failedWriteDir, { recursive: true, force: true });
  fs.rmSync(invalidTimestampDir, { recursive: true, force: true });
  console.log('read-aloud connected speech index tests passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
