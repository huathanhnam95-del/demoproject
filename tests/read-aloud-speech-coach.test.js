const assert = require('node:assert/strict');

require('../public/js/read-aloud-speech-coach.js');
const speechCoach = globalThis.ReadAloudSpeechCoach;

const test = (name, callback) => {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

test('classifies event aliases into the three scored modes', () => {
  assert.equal(speechCoach.classifyEvent({ category: 'catenation' }), 'linking');
  assert.equal(speechCoach.classifyEvent({ category: 'weak_forms' }), 'reduced_words');
  assert.equal(speechCoach.classifyEvent({ family: 'n_bilabial_assimilation' }), 'sound_changes');
  assert.equal(speechCoach.classifyEvent({ subtype: 'yod_coalescence' }), 'sound_changes');
});

test('does not silently classify an unknown event as linking', () => {
  assert.equal(speechCoach.classifyEvent({ category: 'future_backend_family' }), null);
  assert.equal(speechCoach.classifyEvent({}), null);
});

test('resolves an immutable explicit mode snapshot before legacy fallbacks', () => {
  const explicit = ['linking'];
  const resolved = speechCoach.resolveSelectedModes({
    sessionConnectedSpeechModes: explicit,
    sessionConnectedSpeechLevel: 'v2_reduced_words'
  });
  explicit.push('sound_changes');
  assert.deepEqual(resolved, ['linking']);
  assert.deepEqual(speechCoach.resolveSelectedModes({ sessionConnectedSpeechModes: [] }), []);
  assert.deepEqual(speechCoach.resolveSelectedModes({ sessionConnectedSpeechLevel: 'v2_reduced_words' }), ['reduced_words']);
  assert.deepEqual(speechCoach.resolveSelectedModes({
    sessionConnectedSpeechModes: undefined,
    sessionConnectedSpeechLevel: 'v1_linking'
  }), ['linking']);
  assert.deepEqual(speechCoach.resolveSelectedModes({}), ['linking', 'reduced_words', 'sound_changes']);
});

test('normalizes backend statuses and counts every non-detected status as attention', () => {
  assert.equal(speechCoach.normalizeStatus('DETECTED'), 'detected');
  assert.equal(speechCoach.normalizeStatus('not-detected'), 'not_detected');
  assert.equal(speechCoach.normalizeStatus('Uncertain'), 'uncertain');
  assert.equal(speechCoach.normalizeStatus('new_backend_status'), 'unknown');

  const model = speechCoach.buildResultModel({
    sessionConnectedSpeechModes: ['linking'],
    events: [
      { category: 'linking', status: 'detected' },
      { category: 'linking', status: 'uncertain' },
      { category: 'linking', status: 'UNCERTAIN' },
      { category: 'linking', status: 'not-detected' }
    ]
  });
  assert.deepEqual(model.counts, { detected: 1, attention: 3 });
  assert.deepEqual(model.events.map((event) => event.status), ['detected', 'uncertain', 'uncertain', 'not_detected']);
  assert.equal(model.headline, 'You nailed 1 pattern! 3 need attention.');
});

test('filters and groups only events belonging to the recording-time modes', () => {
  const model = speechCoach.buildResultModel({
    sessionConnectedSpeechModes: ['linking', 'sound_changes'],
    events: [
      { eventId: 'l1', category: 'linking', status: 'detected' },
      { eventId: 'r1', category: 'weak_forms', status: 'detected' },
      { eventId: 's1', family: 'yod_coalescence', status: 'uncertain' },
      { eventId: 'u1', category: 'future_backend_family', status: 'detected' }
    ]
  });

  assert.deepEqual(model.events.map((event) => event.eventId), ['l1', 's1']);
  assert.deepEqual(model.groups.linking.detected.map((event) => event.eventId), ['l1']);
  assert.deepEqual(model.groups.sound_changes.attention.map((event) => event.eventId), ['s1']);
  assert.deepEqual(model.groups.reduced_words.detected, []);
  assert.deepEqual(model.sections.linkingSuccesses.map((event) => event.eventId), ['l1']);
  assert.deepEqual(model.sections.linkingIssues, []);
  assert.deepEqual(model.sections.soundChanges.map((event) => event.eventId), ['s1']);
  assert.deepEqual(model.sections.reducedWords, []);
});

test('builds accessible no-mode and partial-mode guidance copy', () => {
  assert.deepEqual(speechCoach.getGuidance([]), {
    kind: 'detailed',
    triggerLabel: 'How to get detailed feedback',
    message: 'For detailed Speech Coach feedback next time, select Linking, Reduced words, or Sound changes before you record.'
  });
  assert.deepEqual(speechCoach.getGuidance(['linking']), {
    kind: 'fuller',
    triggerLabel: 'How to get fuller feedback',
    message: 'For fuller feedback next time, also select Reduced words and Sound changes before you record. Speech Coach reviews only the modes you enable.'
  });
  assert.equal(speechCoach.getGuidance(['linking', 'reduced_words', 'sound_changes']), null);
});

console.log('Read Aloud Speech Coach pure result checks passed.');
