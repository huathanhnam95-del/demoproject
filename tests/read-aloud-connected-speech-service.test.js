/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const {
  buildGenericEvents,
  buildConnectedSpeechAnalysis
} = require(path.join(process.cwd(), 'src/read-aloud/connected-speech-service.js'));

function eventIds(events) {
  return events.map((event) => event.eventId);
}

(async () => {
  const overrideEvents = buildGenericEvents('Did you see it?', '2');
  assert.ok(overrideEvents.some((event) => event.family === 'yod_coalescence'), 'question 2 should inject a yod coalescence event');
  assert.ok(!overrideEvents.some((event) => event.family === 'catenation' && /see it/i.test(String(event.phrase || ''))), 'question 2 should suppress the baseline see-it catenation');

  const punctuationEvents = buildGenericEvents('Pick it, up now', '4');
  assert.ok(!punctuationEvents.some((event) => event.family === 'catenation' && event.startWordIndex === 1 && event.endWordIndex === 2), 'punctuation should block the it-up boundary');

  const repeatedWordEvents = buildGenericEvents('to to go', '5');
  const weakFormEvents = repeatedWordEvents.filter((event) => event.family === 'weak_form_reduction');
  assert.ok(weakFormEvents.length >= 2, 'repeated words should still produce separate weak-form events');
  assert.strictEqual(new Set(eventIds(weakFormEvents)).size, weakFormEvents.length, 'repeated words should preserve unique event ids');

  const analysis = buildConnectedSpeechAnalysis({
    questionId: '2',
    referenceText: 'Did you see it?',
    azurePayload: {
      NBest: [{
        Display: 'Did you see it',
        PronunciationAssessment: {
          AccuracyScore: 92,
          FluencyScore: 88,
          CompletenessScore: 100,
          PronScore: 91
        },
        Words: [
          { Word: 'Did', Offset: 0, Duration: 2600000, PronunciationAssessment: { AccuracyScore: 84, ErrorType: 'None' } },
          { Word: 'you', Offset: 2780000, Duration: 1600000, PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
          { Word: 'see', Offset: 4600000, Duration: 1800000, PronunciationAssessment: { AccuracyScore: 93, ErrorType: 'None' } },
          { Word: 'it', Offset: 6500000, Duration: 1500000, PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' } }
        ]
      }]
    }
  });

  assert.strictEqual(analysis.status, 'complete', 'analysis should still complete for override prompts');
  assert.ok(analysis.events.some((event) => event.eventId === 'q-2-yod_coalescence-0-1'), 'analysis should surface the curated extra event');
  assert.ok(analysis.events.some((event) => event.phrase === 'Did you'), 'analysis should preserve phrase context on scored events');
  assert.strictEqual(analysis.familyCounts.yod_coalescence, 1, 'analysis should summarize family counts');

  const phonemeHintAnalysis = buildConnectedSpeechAnalysis({
    questionId: '2',
    referenceText: 'Did you see it?',
    azurePayload: {
      NBest: [{
        Display: 'Did you see it',
        PronunciationAssessment: {
          AccuracyScore: 91,
          FluencyScore: 88,
          CompletenessScore: 100,
          PronScore: 90
        },
        Words: [
          { Word: 'Did', Offset: 0, Duration: 2600000, PronunciationAssessment: { AccuracyScore: 84, ErrorType: 'None' } },
          {
            Word: 'you',
            Offset: 3000000,
            Duration: 1500000,
            PronunciationAssessment: {
              AccuracyScore: 89,
              ErrorType: 'None',
              NBestPhonemes: [{ Phoneme: 'd\u0292', Score: 91 }]
            }
          },
          { Word: 'see', Offset: 4700000, Duration: 1800000, PronunciationAssessment: { AccuracyScore: 93, ErrorType: 'None' } },
          { Word: 'it', Offset: 6600000, Duration: 1500000, PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' } }
        ]
      }]
    }
  });

  assert.strictEqual(
    phonemeHintAnalysis.events.find((event) => event.eventId === 'q-2-yod_coalescence-0-1')?.status,
    'detected',
    'phoneme candidates should help borderline yod cases score as detected'
  );

  const weakFormPhonemeHintAnalysis = buildConnectedSpeechAnalysis({
    questionId: '6',
    referenceText: 'Want to go',
    azurePayload: {
      NBest: [{
        Display: 'Want to go',
        PronunciationAssessment: {
          AccuracyScore: 90,
          FluencyScore: 87,
          CompletenessScore: 100,
          PronScore: 89
        },
        Words: [
          { Word: 'Want', Offset: 0, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 94, ErrorType: 'None' } },
          {
            Word: 'to',
            Offset: 2100000,
            Duration: 2200000,
            PronunciationAssessment: {
              AccuracyScore: 90,
              ErrorType: 'None',
              NBestPhonemes: [{ Phoneme: '\u0259', Score: 93 }]
            }
          },
          { Word: 'go', Offset: 4400000, Duration: 2200000, PronunciationAssessment: { AccuracyScore: 92, ErrorType: 'None' } }
        ]
      }]
    }
  });

  const weakFormEvent = weakFormPhonemeHintAnalysis.events.find((event) => event.family === 'weak_form_reduction');
  assert.strictEqual(
    weakFormEvent?.status,
    'detected',
    'schwa phoneme hints should mark weak-form reductions as detected in borderline timing cases'
  );
  assert.ok(weakFormEvent?.phrase, 'weak-form events should keep the phrase field');
  assert.ok(weakFormEvent?.leftWord, 'weak-form events should keep the leftWord field');
  assert.ok(weakFormEvent?.rightWord, 'weak-form events should keep the rightWord field');
  assert.strictEqual(typeof weakFormEvent?.startWordIndex, 'number', 'weak-form events should keep the startWordIndex field');
  assert.strictEqual(typeof weakFormEvent?.endWordIndex, 'number', 'weak-form events should keep the endWordIndex field');

  const assimilationAnalysis = buildConnectedSpeechAnalysis({
    questionId: '7',
    referenceText: 'green park',
    azurePayload: {
      NBest: [{
        Display: 'green park',
        PronunciationAssessment: {
          AccuracyScore: 90,
          FluencyScore: 86,
          CompletenessScore: 100,
          PronScore: 89
        },
        Words: [
          { Word: 'green', Offset: 0, Duration: 2600000, PronunciationAssessment: { AccuracyScore: 78, ErrorType: 'None' } },
          { Word: 'park', Offset: 2720000, Duration: 2200000, PronunciationAssessment: { AccuracyScore: 91, ErrorType: 'None' } }
        ]
      }]
    }
  });

  assert.strictEqual(
    assimilationAnalysis.events.find((event) => event.family === 'n_bilabial_assimilation')?.status,
    'detected',
    'assimilation detection should follow the left boundary word evidence rather than averaging both words'
  );

  const notRateableAnalysis = buildConnectedSpeechAnalysis({
    questionId: '2',
    referenceText: 'Did you see it?',
    audioQuality: {
      passed: false,
      reason: 'clipped'
    },
    azurePayload: {
      NBest: [{
        Display: 'Did you see it',
        Words: []
      }]
    }
  });

  assert.strictEqual(notRateableAnalysis.status, 'not_rateable', 'analysis should abstain on clipped audio');
  assert.deepStrictEqual(notRateableAnalysis.events, [], 'not_rateable audio should not produce event scores');

  console.log('read-aloud connected-speech service tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
