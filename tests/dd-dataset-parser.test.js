const assert = require('assert');
const {
  parseDragDropAnswerCell,
  buildQuestionRecord
} = require('../scripts/dd/dd-dataset-core');

function testStandardParsing() {
  const sample = [
    'In 1999, the nation __suffered__ its first budget deficit __because__ of a slump.',
    '---',
    'endure/while/enjoyed'
  ].join('\n');

  const parsed = parseDragDropAnswerCell(sample);
  assert.deepStrictEqual(parsed.correctAnswers, ['suffered', 'because']);
  assert.deepStrictEqual(parsed.distractors, ['endure', 'while', 'enjoyed']);
  assert.strictEqual(parsed.segments.filter(s => s.type === 'blank').length, 2);

  const record = buildQuestionRecord({
    id: 1,
    title: '#1 Botswana',
    sourceRow: 2,
    answerCell: sample,
    compareText: 'In 1999, the nation suffered its first budget deficit because of a slump.'
  });

  assert.strictEqual(record.mode, 'dd');
  assert.strictEqual(record.blanks.length, 2);
  assert(record.options.every(option => option.optionId));
  assert(record.validation.isUsable);
}

function testMissingSeparator() {
  const sample = 'In 1999, the nation __suffered__ its first budget deficit.';
  const parsed = parseDragDropAnswerCell(sample);
  assert.deepStrictEqual(parsed.correctAnswers, ['suffered']);
  assert.deepStrictEqual(parsed.distractors, []);
  
  const record = buildQuestionRecord({
    id: 2,
    title: '#2 Missing Separator',
    sourceRow: 3,
    answerCell: sample
  });
  // Should still parse blanks, but warnings might be generated or usable could be false depending on rule.
  // At least 1 blank is present, but maybe 0 distractors is allowed or warned.
  assert.strictEqual(record.blanks.length, 1);
}

function testMissingBlanks() {
  const sample = 'In 1999, the nation suffered its first budget deficit.\n---\nendure/while';
  const parsed = parseDragDropAnswerCell(sample);
  assert.deepStrictEqual(parsed.correctAnswers, []);
  assert.deepStrictEqual(parsed.distractors, ['endure', 'while']);
  
  const record = buildQuestionRecord({
    id: 3,
    title: '#3 Missing Blanks',
    sourceRow: 4,
    answerCell: sample
  });
  assert.strictEqual(record.validation.isUsable, false);
  assert(record.validation.warnings.some(w => w.includes('No blanks found')));
}

function testDuplicateOptionText() {
  const sample = 'We need a __solution__ soon.\n---\nsolution/alternative';
  const parsed = parseDragDropAnswerCell(sample);
  assert.deepStrictEqual(parsed.correctAnswers, ['solution']);
  assert.deepStrictEqual(parsed.distractors, ['solution', 'alternative']);
  
  const record = buildQuestionRecord({
    id: 4,
    title: '#4 Duplicate Option',
    sourceRow: 5,
    answerCell: sample
  });
  
  // The system should deduplicate by text or keep unique options with unique optionIds.
  // The implementation plan says: "One row appears to duplicate a correct answer in the distractor list,
  // so the implementation must treat options as unique option objects, not just raw strings."
  assert.strictEqual(record.options.length, 2); // 'solution' (correct) and 'alternative' (distractor). The duplicate distractor is ignored/deduplicated.
  const solutionOptions = record.options.filter(o => o.text === 'solution');
  assert.strictEqual(solutionOptions.length, 1);
  assert.strictEqual(solutionOptions[0].kind, 'correct');
}

function testBlanksWithPunctuation() {
  const sample = 'He was __suffered__, but __because__?';
  const parsed = parseDragDropAnswerCell(sample);
  assert.deepStrictEqual(parsed.correctAnswers, ['suffered', 'because']);
  
  // Make sure segments are correct and text around blanks is preserved correctly
  const textSegments = parsed.segments.filter(s => s.type === 'text');
  assert(textSegments.some(s => s.text.includes(',')));
  assert(textSegments.some(s => s.text.includes('?')));
}

// Run all tests
try {
  testStandardParsing();
  testMissingSeparator();
  testMissingBlanks();
  testDuplicateOptionText();
  testBlanksWithPunctuation();
  console.log('ALL TESTS PASSED SUCCESSFULLY');
} catch (err) {
  console.error('TEST FAILED:', err);
  process.exit(1);
}
