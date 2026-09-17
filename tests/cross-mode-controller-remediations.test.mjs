import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

// Test 1: getColloEssayTip in Write Essay mode
test('getColloEssayTip handles null/undefined item and prioritizes viGloss', () => {
  const code = fs.readFileSync('public/write-essay-mode.js', 'utf8');
  
  // Extract getColloEssayTip function definition using regex
  const fnMatch = code.match(/function getColloEssayTip\(item, currentEntry, activePlan\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'getColloEssayTip function should be found');

  const context = vm.createContext({
    console,
    String,
    Boolean
  });
  vm.runInContext(fnMatch[0], context);
  const getColloEssayTip = context.getColloEssayTip;

  // 1. null / undefined item should not throw TypeError
  assert.doesNotThrow(() => getColloEssayTip(null));
  assert.doesNotThrow(() => getColloEssayTip(undefined));
  assert.doesNotThrow(() => getColloEssayTip({}));

  const nullResult = getColloEssayTip(null);
  assert.ok(nullResult.includes('Từ vựng (Lexical Resource)'), 'Null item should return default tip');

  // 2. Curated term match
  const curated = getColloEssayTip({ term: 'Critical Thinking' });
  assert.ok(curated.includes('tư duy phản biện'), 'Curated term should return bespoke pedagogical tip');

  // 3. contextTip priority
  const customTip = getColloEssayTip({ term: 'custom term', contextTip: 'Bespoke context tip' });
  assert.equal(customTip, 'Bespoke context tip');

  // 4. viGloss / vi candidate priority
  const glossTip = getColloEssayTip({ term: 'academic excellence', viGloss: 'sự xuất sắc trong học thuật' });
  assert.ok(glossTip.includes('sự xuất sắc trong học thuật'), 'viGloss should be reflected in dynamic tip');

  const viTip = getColloEssayTip({ term: 'another term', vi: 'ý nghĩa tiếng Việt' });
  assert.ok(viTip.includes('ý nghĩa tiếng Việt'), 'item.vi should be reflected in dynamic tip');
});

// Test 2: RTS sample response fallback logic
test('RTS sample response logic safely falls back to currentEntry on empty or malformed backend responses', () => {
  const code = fs.readFileSync('public/rts-mode.js', 'utf8');

  // Verify the exact pattern exists in rts-mode.js
  assert.ok(code.includes('const hasValidSample = Boolean(data?.sampleResponse && (data.sampleResponse.full || data.sampleResponse.simplified));'),
    'rts-mode.js must contain hasValidSample check');

  function evaluateFallback(data, currentEntry) {
    const hasValidSample = Boolean(data?.sampleResponse && (data.sampleResponse.full || data.sampleResponse.simplified));
    return hasValidSample ? data.sampleResponse : currentEntry?.sampleResponse;
  }

  const defaultModel = {
    full: 'I am calling to request an extension because our project requires more user feedback.',
    simplified: 'I need an extension because we need more user feedback.'
  };

  // Case A: data has valid full response
  const customModel = { full: 'Custom model from AI', simplified: 'Simplified model' };
  assert.deepEqual(evaluateFallback({ sampleResponse: customModel }, { sampleResponse: defaultModel }), customModel);

  // Case B: data.sampleResponse is empty object {}
  assert.deepEqual(evaluateFallback({ sampleResponse: {} }, { sampleResponse: defaultModel }), defaultModel);

  // Case C: data.sampleResponse has empty strings
  assert.deepEqual(evaluateFallback({ sampleResponse: { full: '', simplified: '' } }, { sampleResponse: defaultModel }), defaultModel);

  // Case D: data.sampleResponse is null or undefined
  assert.deepEqual(evaluateFallback({ sampleResponse: null }, { sampleResponse: defaultModel }), defaultModel);
  assert.deepEqual(evaluateFallback({}, { sampleResponse: defaultModel }), defaultModel);
  assert.deepEqual(evaluateFallback(null, { sampleResponse: defaultModel }), defaultModel);
});

// Test 3: Describe Image keyPoints safety
test('Describe Image displayResults handles keyPoints robustly', () => {
  const code = fs.readFileSync('public/describe-image-mode.js', 'utf8');
  assert.ok(code.includes('const points = Array.isArray(currentEntry?.keyPoints) ? currentEntry.keyPoints : [];'),
    'describe-image-mode.js must check Array.isArray for keyPoints');

  // Verify key points in questions JSON
  const diData = JSON.parse(fs.readFileSync('public/database/Describe Image/describe-image-questions.json', 'utf8'));
  assert.equal(diData.length, 1170);
  for (const q of diData) {
    assert.ok(Array.isArray(q.keyPoints), `Q${q.id} keyPoints must be array`);
    assert.ok(q.keyPoints.length >= 2, `Q${q.id} keyPoints must have at least 2 points`);
  }
});

// Test 4: Explanation persona cleaner edge cases
test('clean_explanation_personas handles plaintext emoji headers, varied heading levels, and preserves pedagogy', () => {
  const pythonScript = [
    'import sys',
    'sys.stdout.reconfigure(encoding="utf-8")',
    'from scripts.clean_explanation_personas import clean_explanation',
    '# Case 1: Plaintext emoji header with newline',
    's1 = clean_explanation("🔬 PTE Listening Mastery: Incorrect Words Analysis\\n\\n<p>Hello! As a premium PTE teacher...</p><p>Substantive</p>")',
    'assert s1 == "<p>Substantive</p>", f"Failed case 1: {s1}"',
    '# Case 2: Plaintext emoji header without newline',
    's2 = clean_explanation("🔬 PTE Listening Mastery: Incorrect Words Analysis<p>Hello! As a premium PTE teacher...</p><p>Substantive</p>")',
    'assert s2 == "<p>Substantive</p>", f"Failed case 2: {s2}"',
    '# Case 3: HTML h2 header with PTE Expert Analysis',
    's3 = clean_explanation("<h2>🌟 PTE Expert Analysis: Decoding Details 🌟</h2>\\n\\n<p>Hello! As your PTE Academic tutor...</p><p>Substantive</p>")',
    'assert s3 == "<p>Substantive</p>", f"Failed case 3: {s3}"',
    '# Case 4: HTML h5 header with PTE Deep Dive',
    's4 = clean_explanation("<h5>PTE Deep Dive Analysis</h5><p>Substantive</p>")',
    'assert s4 == "<p>Substantive</p>", f"Failed case 4: {s4}"',
    '# Case 5: Greeting with comma',
    's5 = clean_explanation("<p>Hello, as your PTE tutor, let us review.</p><p>Substantive</p>")',
    'assert s5 == "<p>Substantive</p>", f"Failed case 5: {s5}"',
    '# Case 6: Preserves pedagogy headers',
    'p1 = "<h3>Correct Answer Analysis</h3><p>Substantive</p>"',
    'assert clean_explanation(p1) == p1, "Failed pedagogy protection 1"',
    'p2 = "<h4>Why this is correct</h4><p>Substantive</p>"',
    'assert clean_explanation(p2) == p2, "Failed pedagogy protection 2"',
    'p3 = "<h3>Key Takeaway</h3><p>Substantive</p>"',
    'assert clean_explanation(p3) == p3, "Failed pedagogy protection 3"',
    'print("ALL_EDGE_CASES_PASSED")'
  ].join('\n');

  const output = execFileSync('python', ['-c', pythonScript], { encoding: 'utf8' });
  assert.ok(output.includes('ALL_EDGE_CASES_PASSED'), 'All persona cleaning edge cases must pass');
});

