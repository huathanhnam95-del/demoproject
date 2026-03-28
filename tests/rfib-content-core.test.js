const assert = require('assert');
const {
  parseAnswerText,
  countBlanks,
  buildRfibCandidateList,
  buildRfibDataset,
  mapDifficultyToLevel,
  mapDifficultyToMultiplier
} = require('../scripts/rfib-content-core');

function testParseAnswerTextHandlesParagraphsAndFiveOptions() {
  const parsed = parseAnswerText('First __a/b/c/d__.\n\nSecond __one/two/three/four/five__.');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].blankCount, 1);
  assert.equal(parsed[0].parts[1].correctAnswer, 'a');
  assert.equal(parsed[1].parts[1].options.length, 5);
  assert.equal(countBlanks('First __a/b/c/d__.\n\nSecond __one/two/three/four/five__.') , 2);
}

function testBuildRfibCandidateListDedupesWordsAndPhrases() {
  const candidates = buildRfibCandidateList(
    'Alpha __beta/gamma__ and __delta/epsilon__',
    [
      { word: 'beta', contextual_definition: 'Definition 1' },
      { word: 'multi word', contextual_definition: 'Definition 2' },
      { word: 'beta', contextual_definition: 'Duplicate should be ignored' }
    ]
  );

  const keys = candidates.map((candidate) => candidate.key);
  assert.ok(keys.includes('beta'));
  assert.ok(keys.includes('delta'));
  assert.ok(keys.includes('multi word'));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(candidates.find((candidate) => candidate.key === 'multi word')?.allowedModes?.[0], 'cloze');
}

function testDifficultyMapping() {
  assert.equal(mapDifficultyToLevel('A2'), 1);
  assert.equal(mapDifficultyToLevel('B2'), 2);
  assert.equal(mapDifficultyToLevel('C1'), 3);
  assert.equal(mapDifficultyToMultiplier('A1'), 1.0);
  assert.equal(mapDifficultyToMultiplier('B1'), 1.5);
  assert.equal(mapDifficultyToMultiplier('C2'), 2.0);
}

function testBuildRfibDatasetIncludesParagraphPayload() {
  const result = buildRfibDataset([
    {
      ID: '0001',
      TITLE: 'Sample',
      ANSWER: 'A __b/c__.',
      'Full Text': 'A b.',
      'Beginner Ver': 'A b.',
      'Inter Ver': 'A b.',
      Topic: 'Demo',
      Enrichment_Difficulty: 'A2',
      Enrichment_Blocking_Vocab: '[]'
    }
  ], new Map());

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].paragraphs.length, 1);
  assert.equal(result.items[0].paragraphs[0].parts[1].type, 'blank');
  assert.equal(result.firestoreDocs[0].gaps[0].answers[0], 'b');
}

function testBuildRfibDatasetReportsValidationIssues() {
  const result = buildRfibDataset([
    {
      ID: '0002',
      TITLE: 'No blanks',
      ANSWER: 'Plain text only.',
      'Full Text': 'Plain text only.'
    },
    {
      ID: '0003',
      TITLE: 'Unbalanced',
      ANSWER: 'Prefix __a/b__ suffix __',
      'Full Text': 'Prefix a suffix'
    },
    {
      ID: '0004',
      TITLE: 'Single option',
      ANSWER: 'Prefix __onlyone__ suffix.',
      'Full Text': 'Prefix onlyone suffix.'
    },
    {
      ID: '0005',
      TITLE: 'Duplicate options',
      ANSWER: 'Prefix __Beta/beta/Gamma__ suffix.',
      'Full Text': 'Prefix Beta suffix.'
    }
  ], new Map());

  assert.equal(result.validation.hasStructuralErrors, true);

  const structuralMessages = result.validation.structuralErrors.map((issue) => issue.message);
  assert(structuralMessages.some((message) => message.includes('No parsed blanks were found')));
  assert(structuralMessages.some((message) => message.includes('Unbalanced blank delimiters')));
  assert(structuralMessages.some((message) => message.includes('must have at least two options')));
  assert(structuralMessages.some((message) => message.includes('duplicate options')));

  const warningMessages = result.validation.contentWarnings.map((issue) => issue.message);
  assert(warningMessages.some((message) => message.includes('Missing Beginner version text')));
  assert(warningMessages.some((message) => message.includes('Missing Intermediate version text')));
  assert(warningMessages.some((message) => message.includes('Missing blocking vocabulary metadata')));
}

testParseAnswerTextHandlesParagraphsAndFiveOptions();
testBuildRfibCandidateListDedupesWordsAndPhrases();
testDifficultyMapping();
testBuildRfibDatasetIncludesParagraphPayload();
testBuildRfibDatasetReportsValidationIssues();

console.log('rfib-content-core tests passed');
