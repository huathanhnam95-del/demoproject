/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const {
  buildGenericEvents,
  buildConnectedSpeechAnalysis
} = require(path.join(process.cwd(), 'src/read-aloud/connected-speech-service.js'));
const deployedConnectedSpeechService = require(path.join(
  process.cwd(),
  'functions/src/read-aloud/connected-speech-service.js'
));

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
  assert.equal(weakFormEvent?.targetFormRole, 'weak');
  assert.equal(weakFormEvent?.targetIpa, '/tə/');
  assert.deepEqual(weakFormEvent?.acceptedFormRoles, ['strong', 'weak']);

  const andEvent = buildGenericEvents('bread and butter', 'and-forms')
    .find((event) => event.family === 'weak_form_reduction' && event.leftWord === 'and');
  assert.equal(andEvent?.targetIpa, '/ən/', 'the backend coaching target should use Oxford American’s preferred weak form');

  const lowAccuracyStrongOnly = buildConnectedSpeechAnalysis({
    questionId: '6',
    referenceText: 'Want to go',
    azurePayload: {
      NBest: [{
        Display: 'Want to go',
        Words: [
          { Word: 'Want', Offset: 0, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 94 } },
          { Word: 'to', Offset: 2100000, Duration: 4200000, PronunciationAssessment: { AccuracyScore: 60 } },
          { Word: 'go', Offset: 6400000, Duration: 2200000, PronunciationAssessment: { AccuracyScore: 92 } }
        ]
      }]
    }
  });
  assert.notEqual(
    lowAccuracyStrongOnly.events.find((event) => event.family === 'weak_form_reduction')?.status,
    'detected',
    'low accuracy without weak-form phoneme or timing evidence must not prove reduction'
  );

  const nestedNBestWeakForm = buildConnectedSpeechAnalysis({
    questionId: '8',
    referenceText: 'Want to go',
    azurePayload: {
      NBest: [{
        Display: 'Want to go',
        Words: [
          { Word: 'Want', Offset: 0, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 94 } },
          {
            Word: 'to',
            Offset: 2100000,
            Duration: 2200000,
            PronunciationAssessment: { AccuracyScore: 90 },
            Phonemes: [
              {
                Phoneme: 't',
                PronunciationAssessment: {
                  NBestPhonemes: [{ Phoneme: 't', Score: 100 }, { Phoneme: 'd', Score: 12 }]
                }
              },
              {
                Phoneme: 'u',
                PronunciationAssessment: {
                  NBestPhonemes: [{ Phoneme: 'ə', Score: 96 }, { Phoneme: 'u', Score: 44 }]
                }
              }
            ]
          },
          { Word: 'go', Offset: 4400000, Duration: 2200000, PronunciationAssessment: { AccuracyScore: 92 } }
        ]
      }]
    }
  });
  const nestedWeakEvent = nestedNBestWeakForm.events.find((event) => event.family === 'weak_form_reduction');
  assert.equal(
    nestedWeakEvent?.status,
    'detected',
    'Azure phoneme-level NBestPhonemes should supply the spoken weak-vowel evidence'
  );
  assert.deepEqual(nestedWeakEvent?.evidence?.leftPhonemeHints, ['t', 'ə']);

  const strongWereAnalysis = buildConnectedSpeechAnalysis({
    questionId: 'were-strong',
    referenceText: 'Were you ready',
    azurePayload: {
      NBest: [{
        Display: 'Were you ready',
        Words: [
          {
            Word: 'Were',
            Offset: 0,
            Duration: 3600000,
            PronunciationAssessment: { AccuracyScore: 98 },
            Phonemes: [{ Phoneme: 'w' }, { Phoneme: 'ə' }, { Phoneme: 'r' }]
          },
          {
            Word: 'you',
            Offset: 3700000,
            Duration: 2000000,
            PronunciationAssessment: { AccuracyScore: 96 }
          },
          {
            Word: 'ready',
            Offset: 5800000,
            Duration: 3000000,
            PronunciationAssessment: { AccuracyScore: 96 }
          }
        ]
      }]
    }
  });
  assert.equal(
    strongWereAnalysis.events.find((event) => (
      event.family === 'weak_form_reduction' && event.leftWord === 'were'
    ))?.status,
    'not_detected',
    'the non-contrastive schwa in /wər/ must not by itself prove that “were” was reduced'
  );

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
  assert.deepStrictEqual(
    deployedConnectedSpeechService.buildGenericEvents('bread and butter', 'parity'),
    buildGenericEvents('bread and butter', 'parity'),
    'the deployed Functions copy must keep the same weak-form event contract'
  );
  const omissionAnalysis = buildConnectedSpeechAnalysis({
    questionId: 'omission-test',
    referenceText: 'It is important to give a clear and concise presentation on pottery',
    azurePayload: {
      NBest: [{
        Display: 'It is important to give a clear and concise presentation on pottery',
        Words: [
          { Word: 'It', Offset: 0, Duration: 2000000, PronunciationAssessment: { AccuracyScore: 95, ErrorType: 'None' } },
          { Word: 'is', Offset: 2100000, Duration: 1500000, PronunciationAssessment: { AccuracyScore: 92, ErrorType: 'None' } },
          { Word: 'important', Offset: 3700000, Duration: 4000000, PronunciationAssessment: { AccuracyScore: 90, ErrorType: 'None' } },
          { Word: 'to', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'give', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'a', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'clear', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'and', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'concise', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'presentation', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'on', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } },
          { Word: 'pottery', Offset: 0, Duration: 0, PronunciationAssessment: { AccuracyScore: 0, ErrorType: 'Omission' } }
        ]
      }]
    }
  });

  const omittedEvents = omissionAnalysis.events.filter((e) => e.startWordIndex >= 3);
  assert.ok(omittedEvents.length > 0, 'should have events in the omitted section');
  for (const ev of omittedEvents) {
    assert.notStrictEqual(ev.status, 'detected', `omitted section event "${ev.phrase}" must never be detected (green)`);
    assert.strictEqual(ev.status, 'not_detected', `omitted section event "${ev.phrase}" should be not_detected`);
  }

  const breadEvents = buildGenericEvents('the significance of attending', 'single-word-check');
  const weakFormSignificance = breadEvents.filter((e) => e.family === 'weak_form_reduction');
  assert.strictEqual(weakFormSignificance.length, 2, 'should find weak forms for "the" and "of"');
  for (const wf of weakFormSignificance) {
    assert.strictEqual(wf.startWordIndex, wf.endWordIndex, `weak form event for "${wf.phrase}" must be a single-word range`);
  }

  console.log('read-aloud connected-speech service tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
