import assert from 'node:assert/strict';
import {
  mapCefrToQuestionLevel,
  createQuestionRecommendationEngine
} from '../public/js/question-recommendation-engine.js';

console.log('Starting question recommendation engine tests...');

assert.equal(mapCefrToQuestionLevel(1), 1);
assert.equal(mapCefrToQuestionLevel(2), 1);
assert.equal(mapCefrToQuestionLevel(3), 2);
assert.equal(mapCefrToQuestionLevel(4), 2);
assert.equal(mapCefrToQuestionLevel(6), 3);

const engine = createQuestionRecommendationEngine({ recentWindowSize: 3 });

{
  const items = [
    { id: 101, level: 2, correctSentence: 'Public policy shapes media debate.' },
    { id: 102, level: 2, correctSentence: 'Media policy affects public trust.' },
    { id: 103, level: 3, correctSentence: 'Quantum mechanics confuses many students.' }
  ];
  const index = engine.buildIndex('type', items);

  const recommendation = engine.recommendNext({
    mode: 'type',
    currentQuestionId: 101,
    visibleQuestionIds: [101, 102, 103],
    currentCefrLevel: 4,
    recentQuestionIds: [100],
    index
  });

  assert.equal(recommendation.nextQuestionId, 102);
  assert.equal(recommendation.reasonCode, 'level_and_continuity');

  const repeatPenalty = engine.recommendNext({
    mode: 'type',
    currentQuestionId: 101,
    visibleQuestionIds: [101, 102, 103],
    currentCefrLevel: 4,
    recentQuestionIds: [102, 104, 105],
    index
  });

  assert.equal(repeatPenalty.nextQuestionId, 103);
  assert.ok(['difficulty_only', 'fallback'].includes(repeatPenalty.reasonCode));

  const visibleOnly = engine.recommendNext({
    mode: 'type',
    currentQuestionId: 101,
    visibleQuestionIds: [101, 103],
    currentCefrLevel: 4,
    recentQuestionIds: [],
    index
  });

  assert.equal(visibleOnly.nextQuestionId, 103);
}

{
  const notesItems = [
    { id: '1', level: 2, transcript: 'Public policy affects university funding.' },
    { id: '2', level: 2, transcript: 'University policy affects public trust.' },
    { id: '3', level: 1, transcript: 'Small birds live in dense forest habitats.' }
  ];
  const notesIndex = engine.buildIndex('notes', notesItems);

  const notesRecommendation = engine.recommendNext({
    mode: 'notes',
    currentQuestionId: 1,
    visibleQuestionIds: [1, 2, 3],
    currentCefrLevel: 4,
    recentQuestionIds: [],
    index: notesIndex
  });

  assert.equal(notesRecommendation.nextQuestionId, 2);
  assert.equal(notesRecommendation.reasonCode, 'level_and_continuity');
}

{
  const items = [{ id: 50, level: 1, correctSentence: 'Only one visible item remains.' }];
  const index = engine.buildIndex('type', items);
  const fallback = engine.recommendNext({
    mode: 'type',
    currentQuestionId: 50,
    visibleQuestionIds: [50],
    currentCefrLevel: 1,
    recentQuestionIds: [],
    index
  });
  assert.equal(fallback.nextQuestionId, 50);
  assert.equal(fallback.reasonCode, 'fallback');
}

console.log('question recommendation engine tests passed');

