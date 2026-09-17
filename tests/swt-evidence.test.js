/* eslint-disable no-console */
const assert = require('assert');
const swtEvidence = require('../public/swt-evidence.js');

const { isBoundary, validateRange, resolveQuote, buildSegments, renderSource } = swtEvidence;

console.log('Running SWT Evidence Engine tests...');

// 1. validateRange tests
const sourceText = 'The quick brown fox jumps over the lazy dog.';

// 1a. Valid range
const validRange = { start: 4, end: 9, quote: 'quick' };
assert.strictEqual(validateRange(sourceText, validRange), true, '1a: Should validate exact quote and bounds');

// 1b. Mismatched quote
const mismatchedRange = { start: 4, end: 9, quote: 'sloww' };
assert.strictEqual(validateRange(sourceText, mismatchedRange), false, '1b: Should reject mismatched quote');

// 1c. Negative or inverted bounds
assert.strictEqual(validateRange(sourceText, { start: -1, end: 5, quote: 'The q' }), false, '1c: Should reject negative start');
assert.strictEqual(validateRange(sourceText, { start: 9, end: 4, quote: 'quick' }), false, '1c: Should reject inverted range');

// 1d. Out of bounds
assert.strictEqual(validateRange(sourceText, { start: 40, end: 55, quote: 'dog.' }), false, '1d: Should reject out of bounds range');

// 1e. Surrogate boundary check
const textWithEmoji = 'Hello 😀 world!';
// 😀 is \uD83D\uDE00 at index 6 and 7
assert.strictEqual(isBoundary(textWithEmoji, 6), true, '1e: Boundary before emoji is valid');
assert.strictEqual(isBoundary(textWithEmoji, 7), false, '1e: Boundary between surrogate halves is invalid');
assert.strictEqual(isBoundary(textWithEmoji, 8), true, '1e: Boundary after emoji is valid');
assert.strictEqual(validateRange(textWithEmoji, { start: 6, end: 7, quote: '\uD83D' }), false, '1e: Range splitting surrogate pair must be invalid');

// 2. resolveQuote tests
const repeatingText = 'apple orange banana apple grape';
// 2a. Unambiguous quote
const resolvedBanana = resolveQuote(repeatingText, 'banana');
assert.deepStrictEqual(resolvedBanana, { start: 13, end: 19, quote: 'banana' }, '2a: Should find unambiguous quote');

// 2b. Ambiguous quote throws without context
assert.throws(() => {
  resolveQuote(repeatingText, 'apple');
}, /Ambiguous quote/, '2b: Ambiguous quote without context should throw');

// 2c. Disambiguation with prefix / suffix
const resolvedFirstApple = resolveQuote(repeatingText, 'apple', { suffix: ' orange' });
assert.deepStrictEqual(resolvedFirstApple, { start: 0, end: 5, quote: 'apple' }, '2c: Should resolve first apple with suffix');

const resolvedSecondApple = resolveQuote(repeatingText, 'apple', { prefix: 'banana ' });
assert.deepStrictEqual(resolvedSecondApple, { start: 20, end: 25, quote: 'apple' }, '2c: Should resolve second apple with prefix');

// 2d. Non-existent quote throws
assert.throws(() => {
  resolveQuote(repeatingText, 'watermelon');
}, /Quote not found/, '2d: Non-existent quote should throw');

// 3. buildSegments tests
const complexSource = 'Alpha Beta Gamma Delta Epsilon';
const points = [
  {
    id: 'p1',
    evidence: [{ start: 0, end: 10, quote: 'Alpha Beta' }] // 'Alpha Beta'
  },
  {
    id: 'p2',
    evidence: [{ start: 6, end: 16, quote: 'Beta Gamma' }] // 'Beta Gamma'
  },
  {
    id: 'p3',
    evidence: [{ start: 23, end: 30, quote: 'Epsilon' }] // 'Epsilon'
  }
];

const segments = buildSegments(complexSource, points);
// Check segmentation:
// 0..6: 'Alpha ' (p1)
// 6..10: 'Beta' (p1, p2)
// 10..16: ' Gamma' (p2)
// 16..23: ' Delta ' (none)
// 23..30: 'Epsilon' (p3)
assert.strictEqual(segments.length, 5, '3: Should split into 5 disjoint segments');
assert.deepStrictEqual(segments[0], { text: 'Alpha ', start: 0, end: 6, pointIds: ['p1'] });
assert.deepStrictEqual(segments[1], { text: 'Beta', start: 6, end: 10, pointIds: ['p1', 'p2'] });
assert.deepStrictEqual(segments[2], { text: ' Gamma', start: 10, end: 16, pointIds: ['p2'] });
assert.deepStrictEqual(segments[3], { text: ' Delta ', start: 16, end: 23, pointIds: [] });
assert.deepStrictEqual(segments[4], { text: 'Epsilon', start: 23, end: 30, pointIds: ['p3'] });

// Reconstructed text must equal original source exactly
const reconstructed = segments.map(s => s.text).join('');
assert.strictEqual(reconstructed, complexSource, '3: Reconstructed text must match original source exactly');

// 4. renderSource DOM test using minimal DOM mock
const mockChildren = [];
const mockDoc = {
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  createElement: (tag) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    textContent: ''
  }),
  createDocumentFragment: () => {
    const fragChildren = [];
    return {
      appendChild: (node) => fragChildren.push(node),
      get children() { return fragChildren; }
    };
  }
};
const mockContainer = {
  ownerDocument: mockDoc,
  replaceChildren: (frag) => {
    mockChildren.length = 0;
    mockChildren.push(...frag.children);
  },
  querySelector: (sel) => {
    if (sel === 'mark') return mockChildren.find(c => c.tagName === 'MARK') || null;
    return null;
  }
};

const firstMark = renderSource(mockContainer, complexSource, points, 'core');
assert.ok(firstMark, '4: Should return first mark');
assert.strictEqual(mockChildren.length, 5, '4: Rendered container should have 5 children');
assert.strictEqual(mockChildren[0].tagName, 'MARK');
assert.strictEqual(mockChildren[0].className, 'swt-evidence swt-evidence--core');
assert.strictEqual(mockChildren[0].dataset.pointIds, 'p1');
assert.strictEqual(mockChildren[1].dataset.pointIds, 'p1 p2');
assert.strictEqual(mockChildren[3].nodeType, 3); // text node

console.log('All 9 SWT Evidence Engine tests passed successfully!');
