/* eslint-disable no-console */
const assert = require('assert');
const swtEvidence = require('../public/swt-evidence.js');
const swtReview = require('../public/swt-review.js');

const { isBoundary, validateRange, resolveQuote, buildSegments, renderSource } = swtEvidence;
const { findPhraseOccurrences, buildSampleSegments, normalizePhrase, SWTReviewController } = swtReview;

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

// 5. Empty points array test
const emptySegments = buildSegments(sourceText, []);
assert.strictEqual(emptySegments.length, 1, '5a: Empty points should return 1 segment');
assert.deepStrictEqual(emptySegments[0], { text: sourceText, start: 0, end: sourceText.length, pointIds: [] }, '5b: Segment should span full text without pointIds');
const emptyMark = renderSource(mockContainer, sourceText, [], 'core');
assert.strictEqual(emptyMark, null, '5c: renderSource with empty points should return null (no mark)');
assert.strictEqual(mockChildren.length, 1, '5d: Should render single text node');
assert.strictEqual(mockChildren[0].nodeType, 3, '5e: Child should be text node');
assert.strictEqual(mockChildren[0].textContent, sourceText, '5f: Text content should match source');

// 6. Special HTML characters safety test
const xssSource = '<script>alert("xss")</script> & "quotes" \'tags\'';
const xssPoints = [{ id: 'pxss', evidence: [{ start: 0, end: 8, quote: '<script>' }] }];
const xssMark = renderSource(mockContainer, xssSource, xssPoints, 'core');
assert.ok(xssMark, '6a: Should create mark for script tag text');
assert.strictEqual(mockChildren[0].textContent, '<script>', '6b: Mark textContent must be literal string without evaluation');
assert.strictEqual(mockChildren[1].textContent, 'alert("xss")</script> & "quotes" \'tags\'', '6c: Remaining text node must be literal string');

// 7. Empty evidence array on point throws
assert.throws(() => {
  buildSegments(sourceText, [{ id: 'p_empty', evidence: [] }]);
}, /Invalid point evidence/, '7: Point with empty evidence array should throw');

// 8. Stale/invalid evidence range throws with point id
assert.throws(() => {
  buildSegments(sourceText, [{ id: 'p_stale', evidence: [{ start: 0, end: 5, quote: 'mismatched' }] }]);
}, /Invalid or stale evidence range for p_stale/, '8: Stale range should throw with point id');

// 9. Identical boundary overlap test
const identicalSource = 'Universal health coverage';
const overlapPoints = [
  { id: 'pA', evidence: [{ start: 0, end: 9, quote: 'Universal' }] },
  { id: 'pB', evidence: [{ start: 0, end: 9, quote: 'Universal' }] }
];
const overlapSegments = buildSegments(identicalSource, overlapPoints);
assert.strictEqual(overlapSegments.length, 2, '9a: Should have 2 segments (marked + remainder)');
assert.deepStrictEqual(overlapSegments[0].pointIds, ['pA', 'pB'], '9b: Identical overlap segment should contain both pointIds');

// 10. Type and non-integer bounds validation in validateRange
assert.strictEqual(validateRange(null, { start: 0, end: 5, quote: 'hello' }), false, '10a: null source should return false');
assert.strictEqual(validateRange(sourceText, null), false, '10b: null range should return false');
assert.strictEqual(validateRange(sourceText, { start: 0, end: 0, quote: '' }), false, '10c: empty quote should return false');
assert.strictEqual(validateRange(sourceText, { start: 1.5, end: 4.5, quote: 'he' }), false, '10d: float offsets should return false');
assert.strictEqual(validateRange(sourceText, { start: NaN, end: 5, quote: 'The q' }), false, '10e: NaN start should return false');
assert.strictEqual(validateRange(sourceText, { start: '0', end: '5', quote: 'The q' }), false, '10f: string numbers should return false');

// 11. Type validation in resolveQuote
assert.throws(() => resolveQuote(null, 'test'), TypeError, '11a: null source should throw TypeError');
assert.throws(() => resolveQuote(sourceText, null), TypeError, '11b: null quote should throw TypeError');
assert.throws(() => resolveQuote(sourceText, ''), TypeError, '11c: empty quote should throw TypeError');

// 12. Type validation in buildSegments
assert.throws(() => buildSegments(null, []), TypeError, '12a: null source should throw TypeError');
assert.throws(() => buildSegments(sourceText, null), TypeError, '12b: null points should throw TypeError');
assert.throws(() => buildSegments(sourceText, [{ id: 'p1', evidence: null }]), Error, '12c: non-array evidence should throw');

// 13. Type validation in renderSource
assert.throws(() => renderSource(null, sourceText, []), TypeError, '13a: null container should throw TypeError');
assert.throws(() => renderSource({}, sourceText, []), TypeError, '13b: container without ownerDocument should throw TypeError');

// 14. Multiple disjoint evidence excerpts on a single point
const disjointPoints = [
  {
    id: 'p_disjoint',
    evidence: [
      { start: 4, end: 9, quote: 'quick' },
      { start: 35, end: 39, quote: 'lazy' }
    ]
  }
];
const disjointSegments = buildSegments(sourceText, disjointPoints);
assert.strictEqual(disjointSegments.length, 5, '14a: Should produce 5 segments (text, mark1, text, mark2, text)');
assert.deepStrictEqual(disjointSegments[1].pointIds, ['p_disjoint'], '14b: First mark belongs to p_disjoint');
assert.deepStrictEqual(disjointSegments[3].pointIds, ['p_disjoint'], '14c: Second mark belongs to p_disjoint');
assert.strictEqual(disjointSegments.map(s => s.text).join(''), sourceText, '14d: Disjoint segments reconstructed must match original text');

// 15. Single point spanning entire source text
const fullSpanPoints = [{ id: 'p_full', evidence: [{ start: 0, end: sourceText.length, quote: sourceText }] }];
const fullSegments = buildSegments(sourceText, fullSpanPoints);
assert.strictEqual(fullSegments.length, 1, '15a: Full span should produce exactly 1 segment');
assert.deepStrictEqual(fullSegments[0].pointIds, ['p_full'], '15b: Full segment should belong to p_full');

// 16. pointIndices dataset preservation on rendered marks
const multiIndexPoints = [
  { id: 'c1', evidence: [{ start: 0, end: 3, quote: 'The' }] },
  { id: 'c2', evidence: [{ start: 4, end: 9, quote: 'quick' }] }
];
renderSource(mockContainer, sourceText, multiIndexPoints, 'core');
const renderedMarks = mockChildren.filter(c => c.tagName === 'MARK');
assert.strictEqual(renderedMarks[0].dataset.pointIndices, '0', '16a: First mark should have pointIndices 0');
assert.strictEqual(renderedMarks[1].dataset.pointIndices, '1', '16b: Second mark should have pointIndices 1');

// 17. Single point preserving explicit pointIndex
const singlePointWithIndex = {
  id: 'c2',
  pointIndex: 1,
  evidence: [{ start: 4, end: 9, quote: 'quick' }]
};
renderSource(mockContainer, sourceText, [singlePointWithIndex], 'core');
const singleMarkWithIndex = mockChildren.filter(c => c.tagName === 'MARK');
assert.strictEqual(singleMarkWithIndex[0].dataset.pointIndices, '1', '17: Single point with pointIndex: 1 should have pointIndices 1');

// 18. Points with non-sequential explicit indices (e.g. index property)
const customIndexPoints = [
  { id: 'c3', index: 2, evidence: [{ start: 0, end: 3, quote: 'The' }] },
  { id: 'c4', index: 3, evidence: [{ start: 4, end: 9, quote: 'quick' }] }
];
renderSource(mockContainer, sourceText, customIndexPoints, 'core');
const customMarks = mockChildren.filter(c => c.tagName === 'MARK');
assert.strictEqual(customMarks[0].dataset.pointIndices, '2', '18a: First mark should preserve index: 2');
assert.strictEqual(customMarks[1].dataset.pointIndices, '3', '18b: Second mark should preserve index: 3');

// 19. findPhraseOccurrences exact matching and empty fallback
const sampleText = 'Alpha Beta Gamma Alpha Delta';
const exactMatches = findPhraseOccurrences(sampleText, 'Alpha');
assert.strictEqual(exactMatches.length, 2, '19a: Should find 2 occurrences of Alpha');
assert.strictEqual(exactMatches[0].start, 0, '19b: First Alpha at index 0');
assert.strictEqual(exactMatches[1].start, 17, '19c: Second Alpha at index 17');
assert.deepStrictEqual(findPhraseOccurrences(sampleText, ''), [], '19d: Empty phrase should return empty array');
assert.deepStrictEqual(findPhraseOccurrences('', 'Alpha'), [], '19e: Empty source should return empty array');
assert.deepStrictEqual(findPhraseOccurrences(null, 'Alpha'), [], '19f: null source should return empty array');
assert.deepStrictEqual(findPhraseOccurrences(sampleText, 'NonExistent'), [], '19g: Non-existent phrase returns empty array');

// 20. findPhraseOccurrences smart quote and flexible whitespace resilience
const richText = 'The team’s “innovative” solution – tested   widely – succeeded.';
const normMatch = findPhraseOccurrences(richText, "team's \"innovative\" solution - tested widely");
assert.strictEqual(normMatch.length, 1, '20a: Should match phrase across smart quotes, dashes, and multiple spaces');
assert.strictEqual(normMatch[0].quote, 'team’s “innovative” solution – tested   widely', '20b: Extracted quote should match exact original text slice');

// 21. buildSampleSegments with empty ranges
const emptySegs = buildSampleSegments(sampleText, []);
assert.strictEqual(emptySegs.length, 1, '21a: Empty ranges should produce single segment');
assert.strictEqual(emptySegs[0].text, sampleText, '21b: Segment text should match full input');
assert.deepStrictEqual(emptySegs[0].pointIds, [], '21c: Segment pointIds should be empty');

// 22. buildSampleSegments with overlapping ranges
const r1 = { start: 0, end: 10, pointId: 'core-1' }; // "Alpha Beta"
const r2 = { start: 6, end: 16, pointId: 'core-2' }; // "Beta Gamma"
const overlapSegs = buildSampleSegments('Alpha Beta Gamma Delta', [r1, r2]);
assert.strictEqual(overlapSegs.length, 4, '22a: Overlapping ranges should produce 4 disjoint slices');
assert.strictEqual(overlapSegs[0].text, 'Alpha ', '22b: First slice Alpha ');
assert.deepStrictEqual(overlapSegs[0].pointIds, ['core-1'], '22c: First slice belongs to core-1');
assert.strictEqual(overlapSegs[1].text, 'Beta', '22d: Second slice is overlap Beta');
assert.deepStrictEqual(overlapSegs[1].pointIds, ['core-1', 'core-2'], '22e: Overlap slice belongs to both core-1 and core-2');
assert.strictEqual(overlapSegs[2].text, ' Gamma', '22f: Third slice Gamma belongs to core-2');
assert.deepStrictEqual(overlapSegs[2].pointIds, ['core-2'], '22g: Third slice belongs to core-2');
assert.strictEqual(overlapSegs[3].text, ' Delta', '22h: Fourth slice remainder unhighlighted');
assert.deepStrictEqual(overlapSegs[3].pointIds, [], '22i: Fourth slice unhighlighted');
assert.strictEqual(overlapSegs.map(s => s.text).join(''), 'Alpha Beta Gamma Delta', '22j: Slices reconstructed must equal original string');

// 23. buildSampleSegments with identical boundary overlap
const identicalSegs = buildSampleSegments('Alpha Beta', [
  { start: 0, end: 5, pointId: 'core-1' },
  { start: 0, end: 5, pointId: 'core-2' }
]);
assert.strictEqual(identicalSegs.length, 2, '23a: Should produce 2 slices (shared mark + remainder)');
assert.strictEqual(identicalSegs[0].text, 'Alpha', '23b: Shared slice is Alpha');
assert.deepStrictEqual(identicalSegs[0].pointIds, ['core-1', 'core-2'], '23c: Both core-1 and core-2 are preserved in shared slice');

// 24. buildSampleSegments with nested span (inner inside outer)
const nestedSegs = buildSampleSegments('One Two Three Four', [
  { start: 0, end: 13, pointId: 'core-1' }, // "One Two Three"
  { start: 4, end: 7, pointId: 'core-2' }   // "Two"
]);
assert.strictEqual(nestedSegs.length, 4, '24a: Nested span should produce 4 slices');
assert.strictEqual(nestedSegs[0].text, 'One ', '24b: Slice 1: One ');
assert.deepStrictEqual(nestedSegs[0].pointIds, ['core-1']);
assert.strictEqual(nestedSegs[1].text, 'Two', '24c: Slice 2: Two (overlap)');
assert.deepStrictEqual(nestedSegs[1].pointIds, ['core-1', 'core-2']);
assert.strictEqual(nestedSegs[2].text, ' Three', '24d: Slice 3:  Three');
assert.deepStrictEqual(nestedSegs[2].pointIds, ['core-1']);
assert.strictEqual(nestedSegs[3].text, ' Four', '24e: Slice 4:  Four (unhighlighted)');
assert.deepStrictEqual(nestedSegs[3].pointIds, []);

// 25. buildSampleSegments safely discards invalid/inverted/out-of-bound ranges
const badSegs = buildSampleSegments('Sample Text', [
  { start: -5, end: 2, pointId: 'bad1' },
  { start: 10, end: 5, pointId: 'bad2' },
  { start: 50, end: 60, pointId: 'bad3' },
  { start: 0, end: 6, pointId: 'good' }
]);
assert.strictEqual(badSegs.length, 2, '25a: Should produce 2 slices ignoring bad ranges');
assert.deepStrictEqual(badSegs[0].pointIds, ['good'], '25b: Only valid range is preserved');
assert.strictEqual(badSegs.map(s => s.text).join(''), 'Sample Text', '25c: Reconstructed string matches');

// 26. findPhraseOccurrences with zero-width spaces and format characters
const zeroWidthSource = 'Major athletic events strive to neutralize their carbon \u200Bfootprint.';
const normMatches = findPhraseOccurrences(zeroWidthSource, 'carbon footprint');
assert.strictEqual(normMatches.length, 1, '26a: Should match phrase across zero-width space in source');
assert.strictEqual(normMatches[0].quote, 'carbon \u200Bfootprint', '26b: Matched quote preserves exact source characters');
const zeroWidthInsideWord = 'Major athletic events strive to neutralize their carbonfoot\u200Bprint.';
const wordMatches = findPhraseOccurrences(zeroWidthInsideWord, 'carbonfootprint');
assert.strictEqual(wordMatches.length, 1, '26c: Should match zero-width character inside word');
assert.strictEqual(wordMatches[0].quote, 'carbonfoot\u200Bprint', '26d: Word match preserves zero-width format char');
const zeroWidthPhrase = 'neutralize their carbon \u200Bfootprint';
const phraseMatches = findPhraseOccurrences('Major athletic events strive to neutralize their carbon footprint.', zeroWidthPhrase);
assert.strictEqual(phraseMatches.length, 1, '26e: Should match phrase containing zero-width space against clean source');

// 27. findPhraseOccurrences with non-breaking hyphens and minus signs
const nonBreakingHyphenSource = 'world\u2011wide climate network and long\u2012term goals';
const hyphenMatches = findPhraseOccurrences(nonBreakingHyphenSource, 'world-wide climate network');
assert.strictEqual(hyphenMatches.length, 1, '27a: Should match non-breaking hyphen in source');
assert.strictEqual(hyphenMatches[0].quote, 'world\u2011wide climate network');
const hyphenMatches2 = findPhraseOccurrences('world-wide climate network', 'world\u2011wide climate network');
assert.strictEqual(hyphenMatches2.length, 1, '27b: Should match non-breaking hyphen in phrase');

// 28. findPhraseOccurrences with pure zero-width string returns [] without infinite loop
const pureZeroWidth = findPhraseOccurrences('Some random text', '\u200B\u200C\u200D');
assert.deepStrictEqual(pureZeroWidth, [], '28: Pure zero-width phrase returns empty array safely');

// 29. findPhraseOccurrences with non-breaking spaces (\u00A0, \u202F)
const nbspSource = 'tested\u00A0widely\u202Facross the globe';
const nbspMatches = findPhraseOccurrences(nbspSource, 'tested widely across');
assert.strictEqual(nbspMatches.length, 1, '29a: Should match non-breaking space and narrow non-breaking space');
assert.strictEqual(nbspMatches[0].quote, 'tested\u00A0widely\u202Facross');

// 30. SWTReviewController teardown state hygiene (destroy resets activeKind and scroll positions)
const mockCtrl = new SWTReviewController();
mockCtrl.activeKind = 'ignore';
mockCtrl.tabScroll = { core: 150, ignore: 200, sample: 250 };
mockCtrl.mobilePointScroll = 350;
mockCtrl.sourcePageScroll = 400;
mockCtrl.destroy();
assert.strictEqual(mockCtrl.activeKind, 'core', '30a: destroy() must reset activeKind to core');
assert.deepStrictEqual(mockCtrl.tabScroll, { core: 0, ignore: 0, sample: 0 }, '30b: destroy() must reset tabScroll');
assert.strictEqual(mockCtrl.mobilePointScroll, 0, '30c: destroy() must reset mobilePointScroll');
assert.strictEqual(mockCtrl.sourcePageScroll, 0, '30d: destroy() must reset sourcePageScroll');

// 31. 3-category switching test (core, ignore, sample) with synchronized ARIA, hidden state, and tabScroll
const ctrl3 = new SWTReviewController();
const createMockTab = (id, kind) => ({
  id,
  dataset: { kind },
  attributes: {},
  tabIndex: -1,
  setAttribute(k, v) { this.attributes[k] = String(v); },
  getAttribute(k) { return this.attributes[k] || null; },
  focus() { this.focused = true; }
});
const createMockPanel = (id) => ({
  id,
  hidden: false
});

ctrl3.tabCore = createMockTab('swt-review-tab-core', 'core');
ctrl3.tabIgnore = createMockTab('swt-review-tab-ignore', 'ignore');
ctrl3.tabSample = createMockTab('swt-review-tab-sample', 'sample');
ctrl3.panelCore = createMockPanel('swt-review-panel-core');
ctrl3.panelIgnore = createMockPanel('swt-review-panel-ignore');
ctrl3.panelSample = createMockPanel('swt-review-panel-sample');
ctrl3.analysisScroll = { scrollTop: 0 };
ctrl3.source = { textContent: '' };
ctrl3.sourceText = 'Source text';

// Initial state
assert.strictEqual(ctrl3.activeKind, 'core', '31a: Default activeKind must be core');

// Switch to ignore
ctrl3.analysisScroll.scrollTop = 120;
ctrl3.setCategory('ignore');
assert.strictEqual(ctrl3.activeKind, 'ignore', '31b: activeKind must switch to ignore');
assert.strictEqual(ctrl3.tabCore.getAttribute('aria-selected'), 'false', '31c: tabCore aria-selected must be false');
assert.strictEqual(ctrl3.tabIgnore.getAttribute('aria-selected'), 'true', '31d: tabIgnore aria-selected must be true');
assert.strictEqual(ctrl3.tabSample.getAttribute('aria-selected'), 'false', '31e: tabSample aria-selected must be false');
assert.strictEqual(ctrl3.panelCore.hidden, true, '31f: panelCore must be hidden');
assert.strictEqual(ctrl3.panelIgnore.hidden, false, '31g: panelIgnore must be visible');
assert.strictEqual(ctrl3.panelSample.hidden, true, '31h: panelSample must be hidden');
assert.strictEqual(ctrl3.tabScroll.core, 120, '31i: core tabScroll must be preserved');

// Switch to sample
ctrl3.analysisScroll.scrollTop = 80;
ctrl3.setCategory('sample');
assert.strictEqual(ctrl3.activeKind, 'sample', '31j: activeKind must switch to sample');
assert.strictEqual(ctrl3.tabCore.getAttribute('aria-selected'), 'false', '31k: tabCore aria-selected must be false');
assert.strictEqual(ctrl3.tabIgnore.getAttribute('aria-selected'), 'false', '31l: tabIgnore aria-selected must be false');
assert.strictEqual(ctrl3.tabSample.getAttribute('aria-selected'), 'true', '31m: tabSample aria-selected must be true');
assert.strictEqual(ctrl3.tabSample.tabIndex, 0, '31n: tabSample tabIndex must be 0');
assert.strictEqual(ctrl3.tabCore.tabIndex, -1, '31o: tabCore tabIndex must be -1');
assert.strictEqual(ctrl3.tabIgnore.tabIndex, -1, '31p: tabIgnore tabIndex must be -1');
assert.strictEqual(ctrl3.panelCore.hidden, true, '31q: panelCore must be hidden');
assert.strictEqual(ctrl3.panelIgnore.hidden, true, '31r: panelIgnore must be hidden');
assert.strictEqual(ctrl3.panelSample.hidden, false, '31s: panelSample must be visible');
assert.strictEqual(ctrl3.tabScroll.ignore, 80, '31t: ignore tabScroll must be preserved');

// Switch back to core and check scroll restore
ctrl3.setCategory('core');
assert.strictEqual(ctrl3.activeKind, 'core', '31u: activeKind must switch back to core');
assert.strictEqual(ctrl3.analysisScroll.scrollTop, 120, '31v: analysisScroll must restore core scroll position');

// Invalid category rejection
ctrl3.setCategory('invalid');
assert.strictEqual(ctrl3.activeKind, 'core', '31w: invalid category must be rejected');

ctrl3.destroy();
assert.strictEqual(ctrl3.tabSample, null, '31x: destroy() must nullify tabSample');
assert.strictEqual(ctrl3.panelSample, null, '31y: destroy() must nullify panelSample');

// 32. Rejection of 'sample' category when tabSample is hidden or sampleVersions empty
const ctrlHidden = new SWTReviewController();
ctrlHidden.tabCore = createMockTab('swt-review-tab-core', 'core');
ctrlHidden.tabIgnore = createMockTab('swt-review-tab-ignore', 'ignore');
ctrlHidden.tabSample = createMockTab('swt-review-tab-sample', 'sample');
ctrlHidden.tabSample.hidden = true;
ctrlHidden.panelCore = createMockPanel('swt-review-panel-core');
ctrlHidden.panelIgnore = createMockPanel('swt-review-panel-ignore');
ctrlHidden.panelSample = createMockPanel('swt-review-panel-sample');
ctrlHidden.panelSample.hidden = true;

ctrlHidden.setCategory('sample');
assert.strictEqual(ctrlHidden.activeKind, 'core', '32a: setCategory(sample) must be rejected when tabSample.hidden is true');
assert.strictEqual(ctrlHidden.panelCore.hidden, false, '32b: panelCore must remain visible');
assert.strictEqual(ctrlHidden.panelSample.hidden, true, '32c: panelSample must remain hidden');
ctrlHidden.destroy();

// 33. currentPoints() behavior across all 3 active categories
const ctrlPoints = new SWTReviewController();
ctrlPoints.analysis = {
  corePoints: [{ id: 'core-1', label: 'C1' }, { id: 'core-2', label: 'C2' }],
  ignorePoints: [{ id: 'ignore-1', label: 'I1' }]
};
ctrlPoints.activeKind = 'core';
assert.strictEqual(ctrlPoints.currentPoints().length, 2, '33a: core activeKind returns corePoints');
ctrlPoints.activeKind = 'ignore';
assert.strictEqual(ctrlPoints.currentPoints().length, 1, '33b: ignore activeKind returns ignorePoints');
ctrlPoints.activeKind = 'sample';
assert.strictEqual(ctrlPoints.currentPoints().length, 2, '33c: sample activeKind returns corePoints');
ctrlPoints.destroy();

// 34. setupSampleSummary() resilience against unsupported types and auto-fallback
const ctrlResilient = new SWTReviewController();
ctrlResilient.tabSample = createMockTab('swt-review-tab-sample', 'sample');
ctrlResilient.panelSample = createMockPanel('swt-review-panel-sample');
ctrlResilient.countSample = { textContent: '' };
ctrlResilient.analysis = { sampleSummary: 12345 }; // unsupported type
ctrlResilient.activeKind = 'sample';
ctrlResilient.tabCore = createMockTab('swt-review-tab-core', 'core');
ctrlResilient.tabIgnore = createMockTab('swt-review-tab-ignore', 'ignore');
ctrlResilient.panelCore = createMockPanel('swt-review-panel-core');
ctrlResilient.panelIgnore = createMockPanel('swt-review-panel-ignore');

ctrlResilient.setupSampleSummary();
assert.strictEqual(ctrlResilient.tabSample.hidden, true, '34a: tabSample must be hidden on unsupported raw data');
assert.strictEqual(ctrlResilient.activeKind, 'core', '34b: activeKind must fallback to core when no sample versions exist');
assert.strictEqual(ctrlResilient.sampleVersions.length, 0, '34c: sampleVersions must be empty');

// 34d. setupSampleSummary() with 2-version object format
ctrlResilient.analysis = {
  sampleSummary: {
    versionA: { text: 'Summary A text', pointHighlights: [] },
    versionB: { text: 'Summary B text', pointHighlights: [], paraphrasingGuide: [] }
  }
};
ctrlResilient.setupSampleSummary();
assert.strictEqual(ctrlResilient.sampleVersions.length, 2, '34d: Must produce exactly 2 versions');
assert.strictEqual(ctrlResilient.sampleVersions[0].label, 'Version A (Simple)', '34e: First tab must be Version A (Simple)');
assert.strictEqual(ctrlResilient.sampleVersions[1].label, 'Version B (Advanced)', '34f: Second tab must be Version B (Advanced)');

// 34g. setupSampleSummary() with string map format
ctrlResilient.analysis = {
  sampleSummary: {
    versionA: 'String summary A',
    versionB: 'String summary B'
  }
};
ctrlResilient.setupSampleSummary();
assert.strictEqual(ctrlResilient.sampleVersions.length, 2, '34g: String map must produce 2 versions');
assert.strictEqual(ctrlResilient.sampleVersions[0].label, 'Version A (Simple)', '34h: String map first tab must be Version A (Simple)');
assert.strictEqual(ctrlResilient.sampleVersions[1].label, 'Version B (Advanced)', '34i: String map second tab must be Version B (Advanced)');

// 34j. setupSampleSummary() with array format
ctrlResilient.analysis = {
  sampleSummary: [
    { text: 'Array summary A' },
    { text: 'Array summary B' }
  ]
};
ctrlResilient.setupSampleSummary();
assert.strictEqual(ctrlResilient.sampleVersions.length, 2, '34j: Array must produce 2 versions');
assert.strictEqual(ctrlResilient.sampleVersions[0].label, 'Version A (Simple)', '34k: Array first tab must be Version A (Simple)');
assert.strictEqual(ctrlResilient.sampleVersions[1].label, 'Version B (Advanced)', '34l: Array second tab must be Version B (Advanced)');

ctrlResilient.destroy();

// 35. renderParaphrasingGuide behavior, rendering fidelity, and resilience
const createMockElement = (tag = 'div') => {
  const children = [];
  return {
    tagName: tag.toUpperCase(),
    children,
    hidden: false,
    className: '',
    textContent: '',
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] || null; },
    append(...nodes) { children.push(...nodes); },
    appendChild(node) { children.push(node); return node; },
    replaceChildren(...nodes) { children.length = 0; if (nodes.length) children.push(...nodes); },
    querySelectorAll(sel) {
      const results = [];
      const matchSel = (node) => {
        if (!node) return;
        if (sel.startsWith('.') && (node.className || '').includes(sel.slice(1))) results.push(node);
        if (node.children) node.children.forEach(matchSel);
      };
      children.forEach(matchSel);
      return results;
    }
  };
};

const guideDoc = {
  createElement(tag) {
    const el = createMockElement(tag);
    el.ownerDocument = guideDoc;
    return el;
  },
  createTextNode(text) {
    return { textContent: text };
  },
  createDocumentFragment() {
    return createMockElement('fragment');
  }
};

const ctrlGuide = new SWTReviewController();
ctrlGuide.container = createMockElement('div');
ctrlGuide.container.ownerDocument = guideDoc;
ctrlGuide.paraphraseGuide = createMockElement('div');

// 35a. Version without paraphrasingGuide sets hidden=true and clears children
ctrlGuide.renderParaphrasingGuide({ id: 'versionA', text: 'Simple summary' });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, true, '35a: Guide must be hidden when paraphrasingGuide is missing');
assert.strictEqual(ctrlGuide.paraphraseGuide.children.length, 0, '35b: Guide children must be cleared when missing');

// 35b. Version B with 6 items renders complete structure
const guideItemsB = [
  { original: 'phrase 1', paraphrased: 'para 1', type: 'structure', technique: 'Voice Shift', note: 'Note 1' },
  { original: 'phrase 2', paraphrased: 'para 2', type: 'synonym', technique: 'Lexical Sub', note: 'Note 2' },
  { original: 'phrase 3', paraphrased: 'para 3', type: 'synonym', technique: 'Contextual', note: 'Note 3' },
  { original: 'phrase 4', paraphrased: 'para 4', type: 'synonym', technique: 'Academic', note: 'Note 4' },
  { original: 'phrase 5', paraphrased: 'para 5', type: 'structure', technique: 'Passive', note: 'Note 5' },
  { original: 'phrase 6', paraphrased: 'para 6', type: 'synonym', technique: 'Variation', note: 'Note 6' }
];
ctrlGuide.renderParaphrasingGuide({ id: 'versionB', text: 'Summary B', paraphrasingGuide: guideItemsB });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, false, '35c: Guide must be visible for Version B');
const renderedItemsB = ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-item');
assert.strictEqual(renderedItemsB.length, 6, '35d: Version B must render exactly 6 guide items');
const badgesB = ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-badge');
assert.strictEqual(badgesB.length, 6, '35e: Must render 6 technique badges');
assert.ok(badgesB[0].className.includes('swt-paraphrase-badge--structure'), '35f: First badge should have structure class');
assert.ok(badgesB[1].className.includes('swt-paraphrase-badge--synonym'), '35g: Second badge should have synonym class');
assert.strictEqual(badgesB[0].textContent, 'Voice Shift', '35h: Badge text matches technique');

// 35c. Secondary Version B sample with 4 items
const guideItemsB2 = [
  { original: 'c1', paraphrased: 'cp1', type: 'synonym', technique: 'Idiom', note: 'Note 1' },
  { original: 'c2', paraphrased: 'cp2', type: 'structure', technique: 'Gerund', note: 'Note 2' },
  { original: 'c3', paraphrased: 'cp3', type: 'synonym', technique: 'Register', note: 'Note 3' },
  { original: 'c4', paraphrased: 'cp4', type: 'structure', technique: 'Appositive', note: 'Note 4' }
];
ctrlGuide.renderParaphrasingGuide({ id: 'versionB', text: 'Summary B variation', paraphrasingGuide: guideItemsB2 });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, false, '35i: Guide must be visible for secondary Version B');
const renderedItemsB2 = ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-item');
assert.strictEqual(renderedItemsB2.length, 4, '35j: Secondary Version B must render exactly 4 guide items');

// 35d. Resilience with invalid/malformed inputs
ctrlGuide.renderParaphrasingGuide({ id: 'bad1', paraphrasingGuide: 'not an array' });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, true, '35k: String paraphrasingGuide safely hides guide');
ctrlGuide.renderParaphrasingGuide({ id: 'bad2', paraphrasingGuide: null });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, true, '35l: Null paraphrasingGuide safely hides guide');
ctrlGuide.renderParaphrasingGuide({ id: 'bad3', paraphrasingGuide: [{}] });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, false, '35m: Empty item in array does not throw');
assert.strictEqual(ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-item').length, 1, '35n: Empty item renders with fallbacks');

// 35d2. Resilience with null / non-object elements inside array
ctrlGuide.renderParaphrasingGuide({ id: 'bad4', paraphrasingGuide: [null, undefined, 42, 'string'] });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, true, '35p: Array with only primitives/nulls safely hides guide without throwing');

ctrlGuide.renderParaphrasingGuide({ id: 'bad5', paraphrasingGuide: [{ original: 'valid', paraphrased: 'valid para' }, null, undefined] });
assert.strictEqual(ctrlGuide.paraphraseGuide.hidden, false, '35q: Array with valid item and nulls does not crash');
assert.strictEqual(ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-item').length, 1, '35r: Valid item renders while nulls are filtered');

// 35d3. Empty string original / paraphrased phrases do not render phantom empty quotes
ctrlGuide.renderParaphrasingGuide({ id: 'bad6', paraphrasingGuide: [{ original: '', paraphrased: '', technique: 'Empty' }] });
const emptyOrig = ctrlGuide.paraphraseGuide.querySelectorAll('.swt-paraphrase-original')[0];
assert.strictEqual(emptyOrig.textContent, '', '35s: Empty original phrase renders empty text, not phantom quotes');
const srOnlyEls = ctrlGuide.paraphraseGuide.querySelectorAll('.sr-only');
assert.strictEqual(srOnlyEls.length, 1, '35t: Screen reader accessible relationship element is rendered');

// 35e. destroy() cleanup
ctrlGuide.destroy();
assert.strictEqual(ctrlGuide.paraphraseGuide, null, '35u: destroy() must nullify paraphraseGuide');

console.log('All SWT Evidence Engine & Review Helper tests passed successfully!');


