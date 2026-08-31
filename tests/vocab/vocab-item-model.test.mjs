import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EMPTY_STATES,
    FALLBACK_MODE_LABELS,
    filterItems,
    formatAddedLabel,
    resolveModeLabel,
    resolvePartOfSpeech,
    resolveWordText,
    sortItems,
    toVocabItem,
    toVocabItems
} from '../../public/js/vocab/vocab-item-model.js';

const NOW = new Date('2026-08-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

test('resolveWordText handles both storage shapes', () => {
    // bookmarkedWords entries store `word`...
    assert.equal(resolveWordText({ word: 'artists' }), 'artists');
    // ...while frequentlyMissed / usedToMiss store `originalWord`.
    assert.equal(resolveWordText({ originalWord: 'politics' }), 'politics');
    // `word` wins when both are present.
    assert.equal(resolveWordText({ word: 'made', originalWord: 'make' }), 'made');
    assert.equal(resolveWordText({}), '');
    assert.equal(resolveWordText(null), '');
});

test('unknown part of speech becomes null, never the "-" placeholder', () => {
    assert.equal(resolvePartOfSpeech({ partOfSpeech: 'noun' }), 'noun');
    assert.equal(resolvePartOfSpeech({ partOfSpeech: 'Verb' }), 'verb');
    assert.equal(resolvePartOfSpeech({ partOfSpeech: 'unknown' }), null);
    assert.equal(resolvePartOfSpeech({ partOfSpeech: '-' }), null);
    assert.equal(resolvePartOfSpeech({}), null);
});

test('phrase entries are distinguished from words', () => {
    const phrase = toVocabItem(
        { word: 'take into account', lemma: 'phrase:take into account', entryType: 'phrase' },
        'bookmarks',
        { now: NOW }
    );
    assert.equal(phrase.entryType, 'phrase');
    assert.equal(phrase.key, 'phrase:take into account');

    const word = toVocabItem({ word: 'artists', lemma: 'artist' }, 'bookmarks', { now: NOW });
    assert.equal(word.entryType, 'word');
});

test('collo-dictate suppresses the question badge', () => {
    const collo = toVocabItem(
        { word: 'set up', mode: 'collo-dictate', questionId: '12' },
        'bookmarks',
        { now: NOW }
    );
    assert.equal(collo.showQuestionBadge, false, 'collo-dictate has no numbered question');

    const typed = toVocabItem(
        { word: 'received', mode: 'type', questionId: '2' },
        'bookmarks',
        { now: NOW }
    );
    assert.equal(typed.showQuestionBadge, true);
    assert.equal(typed.questionId, '2');
});

test('manually added words carry no question badge', () => {
    // vocab-book.js calls addBookmarkedWord(word, 'manual'), which lands in questionId.
    const manual = toVocabItem({ word: 'ephemeral', questionId: 'manual' }, 'bookmarks', { now: NOW });
    assert.equal(manual.showQuestionBadge, false);
});

test('placeholder "-" values do not leak into the model', () => {
    const item = toVocabItem(
        { originalWord: 'in', mode: '-', questionId: '-', partOfSpeech: 'unknown' },
        'missed',
        { now: NOW }
    );
    assert.equal(item.sourceMode, null);
    assert.equal(item.questionId, null);
    assert.equal(item.sourceLabel, null);
    assert.equal(item.pos, null);
});

test('mode labels come from the injected registry, falling back locally', () => {
    // Fallback map when no registry is supplied.
    assert.equal(resolveModeLabel('type'), FALLBACK_MODE_LABELS.type);
    assert.equal(resolveModeLabel('rfib'), 'Fill in the Blanks');

    // Injected registry wins.
    const registry = (mode) => (mode === 'type' ? { label: 'Dictation Practice' } : null);
    assert.equal(resolveModeLabel('type', registry), 'Dictation Practice');

    // Unknown mode degrades to the raw key rather than throwing.
    assert.equal(resolveModeLabel('brand-new-mode'), 'brand-new-mode');

    // A throwing registry must not break rendering.
    const broken = () => { throw new Error('registry unavailable'); };
    assert.equal(resolveModeLabel('type', broken), FALLBACK_MODE_LABELS.type);
});

test('formatAddedLabel produces human relative text', () => {
    assert.equal(formatAddedLabel(new Date(NOW.getTime() - 30 * 1000), NOW), 'Added just now');
    assert.equal(formatAddedLabel(new Date(NOW.getTime() - 5 * 60000), NOW), 'Added 5 minutes ago');
    assert.equal(formatAddedLabel(new Date(NOW.getTime() - 3600000), NOW), 'Added 1 hour ago');
    assert.equal(formatAddedLabel(daysAgo(1), NOW), 'Added yesterday');
    assert.equal(formatAddedLabel(daysAgo(3), NOW), 'Added 3 days ago');
    assert.equal(formatAddedLabel(daysAgo(21), NOW), 'Added 3 weeks ago');
    assert.equal(formatAddedLabel(daysAgo(90), NOW), 'Added 3 months ago');
    assert.equal(formatAddedLabel(null, NOW), null);
    assert.equal(formatAddedLabel('not-a-date', NOW), null);
});

test('default sort reproduces each list\'s historical order', () => {
    const bookmarks = toVocabItems([
        { word: 'old', addedAt: daysAgo(10) },
        { word: 'newest', addedAt: daysAgo(1) },
        { word: 'middle', addedAt: daysAgo(5) }
    ], 'bookmarks', { now: NOW });
    assert.deepEqual(
        sortItems(bookmarks, 'bookmarks').map((i) => i.text),
        ['newest', 'middle', 'old'],
        'bookmarks sort newest-first by addedAt'
    );

    const missed = toVocabItems([
        { originalWord: 'few', missCount: 3 },
        { originalWord: 'many', missCount: 24 },
        { originalWord: 'some', missCount: 11 }
    ], 'missed', { now: NOW });
    assert.deepEqual(
        sortItems(missed, 'missed').map((i) => i.text),
        ['many', 'some', 'few'],
        'missed sort most-missed-first'
    );

    const improving = toVocabItems([
        { originalWord: 'older', movedAt: daysAgo(9) },
        { originalWord: 'recent', movedAt: daysAgo(2) }
    ], 'improving', { now: NOW });
    assert.deepEqual(
        sortItems(improving, 'improving').map((i) => i.text),
        ['recent', 'older'],
        'improving sort most-recently-moved-first'
    );
});

test('explicit sort orders work and do not mutate the input', () => {
    const items = toVocabItems([
        { word: 'banana', addedAt: daysAgo(1), missCount: 2 },
        { word: 'Apple', addedAt: daysAgo(9), missCount: 40 },
        { word: 'cherry', addedAt: daysAgo(5), missCount: 7 }
    ], 'bookmarks', { now: NOW });
    const original = items.map((i) => i.text);

    assert.deepEqual(
        sortItems(items, 'bookmarks', 'alpha').map((i) => i.text),
        ['Apple', 'banana', 'cherry'],
        'alpha sort is case-insensitive'
    );
    assert.deepEqual(
        sortItems(items, 'bookmarks', 'missed').map((i) => i.text),
        ['Apple', 'cherry', 'banana']
    );
    assert.deepEqual(items.map((i) => i.text), original, 'sortItems must not mutate its input');
});

test('filterItems matches word, pos and translation', () => {
    const items = toVocabItems([
        { word: 'artists', partOfSpeech: 'noun', lemma: 'artist' },
        { word: 'received', partOfSpeech: 'verb', lemma: 'receive' }
    ], 'bookmarks', { now: NOW });

    assert.deepEqual(filterItems(items, 'art').map((i) => i.text), ['artists']);
    assert.deepEqual(filterItems(items, 'verb').map((i) => i.text), ['received']);
    assert.equal(filterItems(items, '').length, 2, 'empty query returns everything');

    const translations = { artist: 'nghệ sĩ', receive: 'đã nhận' };
    assert.deepEqual(
        filterItems(items, 'nghệ', (key) => translations[key]).map((i) => i.text),
        ['artists'],
        'search reaches the Vietnamese translation'
    );
});

test('entries without usable text are dropped', () => {
    assert.equal(toVocabItem({}, 'bookmarks'), null);
    assert.equal(toVocabItem(null, 'bookmarks'), null);
    const items = toVocabItems([{ word: 'ok' }, {}, null, { originalWord: '  ' }], 'bookmarks', { now: NOW });
    assert.equal(items.length, 1);
    assert.equal(items[0].text, 'ok');
});

test('audit-contract empty-state copy is preserved verbatim', () => {
    // scripts/audit/run-a2-auth-admin-audit.js greps for this exact wording.
    assert.match(EMPTY_STATES.bookmarks, /No bookmarked words yet/i);
    assert.equal(EMPTY_STATES.bookmarks, 'No bookmarked words yet');
    assert.equal(EMPTY_STATES.missed, 'No frequently missed words');
    assert.equal(EMPTY_STATES.improving, 'No improving words yet');
});
