/**
 * Reading Journey topic utility tests
 * Run with: node tests/reading-journey-topic-utils.test.js
 */
/* eslint-disable no-console */

const assert = require('assert');

(async () => {
  const TopicUtils = await import('../public/js/reading-journey-topic-utils.js');

  console.log('Starting Reading Journey topic utility tests...');

  assert.strictEqual(
    TopicUtils.normalizeTopicTag(' Language Learning '),
    'language_learning',
    'normalizeTopicTag should trim, lowercase, and normalize separators'
  );

  assert.deepStrictEqual(
    TopicUtils.normalizeTopicTags(['Health', ' language learning ', 'health', '']),
    ['health', 'language_learning'],
    'normalizeTopicTags should normalize, dedupe, and sort topic tags'
  );

  assert.strictEqual(
    TopicUtils.formatTopicTagLabel('language_learning'),
    'Language Learning',
    'formatTopicTagLabel should render a human-readable title'
  );

  assert.deepStrictEqual(
    TopicUtils.parseOutlineMeta({
      id: 'outline-1',
      key: 'v1|lang:en|level:b1|tags:health,language_learning',
      value: {
        title: 'A Trip to Remember',
        topicTags: ['Health', 'Language Learning']
      }
    }),
    {
      outlineId: 'outline-1',
      title: 'A Trip to Remember',
      level: 'B1',
      topicTags: ['health', 'language_learning']
    },
    'parseOutlineMeta should return canonical topic tags even when cached values are legacy-formatted'
  );

  const outlines = [
    {
      outlineId: 'a',
      title: 'A Trip to Remember',
      level: 'A2',
      topicTags: ['health', 'language_learning']
    },
    {
      outlineId: 'b',
      title: 'Lina\'s Gratitude Feast',
      level: 'B1',
      topicTags: ['creativity', 'cooking']
    }
  ];

  assert.deepStrictEqual(
    TopicUtils.filterOutlinesByTags(outlines, ['health', 'language_learning']).map((outline) => outline.title),
    ['A Trip to Remember'],
    'filterOutlinesByTags should keep stories that match all selected tags'
  );

  assert.deepStrictEqual(
    TopicUtils.filterOutlinesByTags(outlines, ['health', 'creativity']).map((outline) => outline.title),
    [],
    'filterOutlinesByTags should exclude stories that only match some selected tags'
  );

  console.log('All Reading Journey topic utility tests passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
