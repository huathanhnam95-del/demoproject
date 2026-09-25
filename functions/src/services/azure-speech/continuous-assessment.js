'use strict';

const { normalizeFinalResult, readScore, ticksToCanonicalSpan } = require('./normalize');
const { resolveWordClipTiming } = require('./word-clip-policy');
const { groupLexicalExpressions, isCurrencyExpression, expandCurrencyToken } = require('./lexical-grouping');
const { parseCanonicalWav } = require('./audio-manifest');
const { getAzureSpeechCredentials } = require('../pronunciation-assessment-service');

const ASSESSMENT_AGGREGATION_VERSION = 'bel.speech.aggregate.v1';

function lexicalTokens(text) {
  return String(text || '').toLowerCase().replace(/[—–]/g, ' ')
    .match(/[$€£¥]\s*\d[\d,.]*(?:\s+(?:trillion|billion|million|thousand))?|[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu) || [];
}

function alignReference(referenceText, words = []) {
  const expand = token => (isCurrencyExpression(token) ? expandCurrencyToken(token) : [token])
    .flatMap(part => String(part).split('-')).map(part => part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const reference = lexicalTokens(referenceText).flatMap(expand);
  const spokenEntries = words.flatMap((word, wordIndex) => lexicalTokens(word.word)
    .flatMap(expand).map(token => ({ token, wordIndex })));
  const spoken = spokenEntries.map(entry => entry.token);
  const m = reference.length, n = spoken.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = reference[i] === spoken[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matchedWords = [], omittedWords = [], insertedWords = [], operations = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && reference[i] === spoken[j]) {
      matchedWords.push(reference[i]); operations.push({ type: 'match', referenceIndex: i, wordIndex: spokenEntries[j].wordIndex }); i++; j++;
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      insertedWords.push(spoken[j]); operations.push({ type: 'insert', wordIndex: spokenEntries[j].wordIndex }); j++;
    } else {
      omittedWords.push(reference[i]); operations.push({ type: 'omit', referenceIndex: i }); i++;
    }
  }
  return {
    source: 'bel_reference_comparison', totalReferenceTokens: m,
    matchedCount: matchedWords.length, omittedCount: omittedWords.length,
    insertedCount: insertedWords.length, matchedWords, omittedWords, insertedWords,
    completenessRatio: m ? matchedWords.length / m : 1,
    completenessScore: m ? Math.round(matchedWords.length * 100 / m) : 100,
    operations
  };
}

function occurrenceResults(referenceText, words, comparison) {
  const source = String(referenceText || '');
  const referenceSpans = [];
  const regex = /[$€£¥]\s*\d[\d,.]*(?:\s+(?:trillion|billion|million|thousand))?|[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
  for (const match of source.matchAll(regex)) {
    const count = match[0].includes('-') && !/[$€£¥]/.test(match[0]) ? match[0].split('-').length :
      /[$€£¥]/.test(match[0]) ? require('./lexical-grouping').expandCurrencyToken(match[0]).flatMap(x => x.split('-')).length : 1;
    for (let i = 0; i < count; i++) referenceSpans.push({ start: match.index, end: match.index + match[0].length });
  }
  const matches = new Map(), omitted = [], inserted = new Set();
  for (const op of comparison.operations) {
    if (op.type === 'match' && !matches.has(op.wordIndex)) matches.set(op.wordIndex, op.referenceIndex);
    if (op.type === 'omit') omitted.push(op.referenceIndex);
    if (op.type === 'insert') inserted.add(op.wordIndex);
  }
  const wordResults = words.map((word, index) => {
    const referenceIndex = matches.get(index);
    const display = referenceSpans[referenceIndex] || null;
    return { ...word, displayStart: display?.start ?? null, displayEnd: display?.end ?? null,
      displayText: display ? source.slice(display.start, display.end) : word.word,
      errorType: referenceIndex == null ? 'Insertion' : word.errorType,
      presence: referenceIndex == null ? 'extra' : 'spoken',
      acousticState: word.accuracyScore === null ? 'unavailable' : 'scored',
      clip: word.clipTiming?.clipSpan || null, rawPhonesRef: null };
  });
  omitted.forEach((referenceIndex, ordinal) => {
    const display = referenceSpans[referenceIndex];
    if (!display) return;
    wordResults.push({ occurrenceId: `omitted-${referenceIndex}-${ordinal}`,
      word: source.slice(display.start, display.end), displayText: source.slice(display.start, display.end),
      errorType: 'Omission',
      displayStart: display.start, displayEnd: display.end,
      presence: 'omitted', acousticState: 'unavailable', accuracyScore: null,
      clip: null, clipSpan: null, syllables: [], phonemes: [], rawPhonesRef: null });
  });
  return { wordResults, extraSpeech: [...inserted].map(index => wordResults[index]) };
}

function mockUtterance(referenceText, sampleCount) {
  const words = lexicalTokens(referenceText);
  const width = Math.floor(sampleCount * 625 / Math.max(1, words.length));
  return { RecognitionStatus: 'Success', DisplayText: referenceText, NBest: [{
    PronunciationAssessment: { AccuracyScore: 88, FluencyScore: 85, PronScore: 87, ProsodyScore: 80 },
    Words: words.map((word, index) => ({
      Word: word, Offset: index * width, Duration: Math.floor(width * 0.8),
      PronunciationAssessment: { AccuracyScore: 88 },
      Syllables: [{ Syllable: word, Offset: index * width, Duration: Math.floor(width * 0.8), PronunciationAssessment: { AccuracyScore: 88 } }]
    }))
  }] };
}

function runAzureContinuous({ pcm, referenceText, credentials, timeoutMs = 180000, sdk = null }) {
  const speechSdk = sdk || require('microsoft-cognitiveservices-speech-sdk');
  if (!credentials?.key || !credentials?.region) throw new Error('AZURE_SPEECH_CREDENTIALS_REQUIRED');
  const format = speechSdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
  const stream = speechSdk.AudioInputStream.createPushStream(format);
  const audioConfig = speechSdk.AudioConfig.fromStreamInput(stream);
  const config = speechSdk.SpeechConfig.fromSubscription(credentials.key, credentials.region);
  config.speechRecognitionLanguage = 'en-US';
  config.outputFormat = speechSdk.OutputFormat.Detailed;
  config.setProperty(speechSdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '1500');
  const recognizer = new speechSdk.SpeechRecognizer(config, audioConfig);
  const assessment = new speechSdk.PronunciationAssessmentConfig(
    referenceText, speechSdk.PronunciationAssessmentGradingSystem.HundredMark,
    speechSdk.PronunciationAssessmentGranularity.Phoneme, false
  );
  assessment.enableProsodyAssessment = true;
  assessment.applyTo(recognizer);

  return new Promise((resolve, reject) => {
    const utterances = [];
    let done = false;
    const timer = setTimeout(() => finish(new Error('AZURE_CONTINUOUS_TIMEOUT')), timeoutMs);
    function finish(error = null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { stream.close(); } catch (_) {}
      try { recognizer.stopContinuousRecognitionAsync(() => recognizer.close(), () => recognizer.close()); }
      catch (_) { try { recognizer.close(); } catch (_) {} }
      if (error) reject(error); else resolve(utterances);
    }
    recognizer.recognized = (_, event) => {
      if (done || event.result?.reason !== speechSdk.ResultReason.RecognizedSpeech) return;
      try {
        const json = event.result.properties.getProperty(speechSdk.PropertyId.SpeechServiceResponse_JsonResult);
        const parsed = JSON.parse(json);
        if (parsed.RecognitionStatus === 'Success') utterances.push(parsed);
      } catch (error) { finish(error); }
    };
    recognizer.canceled = (_, event) => {
      if (event.reason === speechSdk.CancellationReason.Error) finish(new Error(`AZURE_CONTINUOUS_CANCELED: ${event.errorDetails || 'unknown'}`));
      else finish();
    };
    recognizer.sessionStopped = () => finish();
    recognizer.startContinuousRecognitionAsync(() => {
      if (done) return;
      try {
        for (let offset = 0; offset < pcm.length; offset += 32000) {
          const chunk = pcm.subarray(offset, Math.min(pcm.length, offset + 32000));
          stream.write(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        }
        stream.close();
      } catch (error) { finish(error); }
    }, error => finish(new Error(`AZURE_CONTINUOUS_START_FAILED: ${error}`)));
  });
}

function weightedScore(utterances, key) {
  let sum = 0, weight = 0;
  for (const utterance of utterances) {
    const score = readScore(utterance.NBest?.[0], key);
    if (score === null) continue;
    const duration = Math.max(1, Number(utterance.Duration) || 0);
    sum += score * duration;
    weight += duration;
  }
  return weight ? Math.round(sum / weight * 100) / 100 : null;
}

async function assessFixedReference({ mode, referenceText, audioBuffer, audioIdentity = null, attemptId = null }, deps = {}) {
  if (!referenceText || typeof referenceText !== 'string') throw new TypeError('REFERENCE_TEXT_REQUIRED');
  if (!Buffer.isBuffer(audioBuffer)) throw new TypeError('VALID_AUDIO_BUFFER_REQUIRED');
  let pcm, audio;
  if (deps.useMock && audioIdentity?.sampleCount && audioBuffer.length === audioIdentity.sampleCount * 2) {
    pcm = audioBuffer;
    audio = audioIdentity;
  } else {
    const parsed = parseCanonicalWav(audioBuffer);
    pcm = parsed.pcm;
    audio = { ...audioIdentity, sampleRateHz: 16000, sampleCount: parsed.sampleCount };
    if (audioIdentity?.sampleCount && audioIdentity.sampleCount !== parsed.sampleCount) throw new Error('AUDIO_SAMPLE_COUNT_MISMATCH');
  }
  const utterances = deps.mockResult ? [deps.mockResult]
    : deps.useMock ? [mockUtterance(referenceText, audio.sampleCount)]
      : await runAzureContinuous({ pcm, referenceText, credentials: deps.credentials || getAzureSpeechCredentials(), sdk: deps.sdk });
  const rawWords = utterances.flatMap(u => u.NBest?.[0]?.Words || []);
  const recognizedText = utterances.map(u => u.DisplayText || u.NBest?.[0]?.Display || '').filter(Boolean).join(' ').trim();
  const normalized = normalizeFinalResult({
    rawResult: { NBest: [{ Words: rawWords }] }, audio, mode, assessmentId: attemptId,
    reference: { kind: 'scoring_reference', text: referenceText }
  });
  const words = normalized.words;
  for (let index = 0; index < words.length; index++) {
    const next = words.slice(index + 1).find(w => w.errorType !== 'Omission' && w.startMs != null) || null;
    words[index].clipTiming = resolveWordClipTiming(words[index], next, audio);
  }
  const grouped = groupLexicalExpressions(words, lexicalTokens(referenceText));
  const comparison = alignReference(referenceText, grouped);
  const occurrences = occurrenceResults(referenceText, grouped, comparison);
  const scoredWordCount = grouped.filter(w => w.errorType !== 'Omission' && w.accuracyScore !== null).length;
  const overallScores = {
    accuracyScore: weightedScore(utterances, 'AccuracyScore'),
    fluencyScore: weightedScore(utterances, 'FluencyScore'),
    completenessScore: ['read_aloud', 'repeat_sentence'].includes(mode) ? comparison.completenessScore : null,
    pronunciationScore: weightedScore(utterances, 'PronScore'),
    prosodyScore: weightedScore(utterances, 'ProsodyScore')
  };
  const providerUtterances = utterances.map((u, index) => ({
    index, text: u.DisplayText || u.NBest?.[0]?.Display || '', span: ticksToCanonicalSpan(u, audio),
    scores: {
      accuracyScore: readScore(u.NBest?.[0], 'AccuracyScore'),
      fluencyScore: readScore(u.NBest?.[0], 'FluencyScore'),
      pronunciationScore: readScore(u.NBest?.[0], 'PronScore'),
      prosodyScore: readScore(u.NBest?.[0], 'ProsodyScore')
    }
  }));
  return {
    schemaVersion: 'bel.speech.v3', engineVersion: 'bel.speech.v3', mode, attemptId,
    status: scoredWordCount > 0 ? 'completed' : 'unrateable',
    audio, referenceText, reference: { kind: 'scoring_reference', text: referenceText },
    recognizedText, overallScores, words: grouped, wordResults: occurrences.wordResults,
    extraSpeech: occurrences.extraSpeech, utterances: providerUtterances,
    coverage: { ...normalized.coverage, scoredWordCount, referenceComparison: comparison },
    referenceComparison: comparison,
    provenance: { provider: deps.useMock || deps.mockResult ? 'explicit-test-double' : 'azure-speech-sdk',
      aggregationVersion: ASSESSMENT_AGGREGATION_VERSION, transport: 'continuous_push_pcm16',
      utteranceCount: utterances.length },
    rawProviderEvidence: utterances, timingSource: 'azure_continuous_ticks_v1'
  };
}

module.exports = { assessFixedReference, computeReferenceComparison: alignReference, runAzureContinuous, ASSESSMENT_AGGREGATION_VERSION };
