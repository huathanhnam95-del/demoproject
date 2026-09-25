'use strict';

const { analyzeAudioQuality } = require('../read-aloud/audio-quality');
const {
  VERSION, buildConnectedSpeechAnalysis, buildConnectedSpeechEventSpecs,
  hasConnectedSpeechEvents, buildEventFamilyCounts
} = require('../read-aloud/connected-speech-service');
const { buildConnectedSpeechAttemptRecord } = require('../read-aloud/connected-speech-storage');

function assessReadAloudQuality(wav) {
  const quality = analyzeAudioQuality(wav, { maximumSpeechDurationMs: 45000 });
  if (quality?.passed === false && ['decode_failed', 'no_speech', 'too_short', 'too_long'].includes(quality.reason)) {
    const error = new Error(`READ_ALOUD_AUDIO_${quality.reason.toUpperCase()}`);
    error.unrateable = true;
    throw error;
  }
  return quality;
}

async function enrichReadAloud({ job, result, wav, audioQuality }) {
  const words = result.rawProviderEvidence?.flatMap(utterance => utterance.NBest?.[0]?.Words || []) || [];
  const azurePayload = { RecognitionStatus: 'Success', DisplayText: result.recognizedText,
    NBest: [{ Display: result.recognizedText, Words: words,
      PronunciationAssessment: {
        AccuracyScore: result.overallScores?.accuracyScore,
        FluencyScore: result.overallScores?.fluencyScore,
        CompletenessScore: result.overallScores?.completenessScore,
        PronScore: result.overallScores?.pronunciationScore
      } }] };
  const questionId = String(job.questionId || '');
  const referenceText = job.reference?.text || '';
  const empty = { status: 'not_applicable', version: VERSION,
    summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 }, events: [] };
  let connectedSpeech = empty;
  let workerStatus = 'not_applicable';
  if (process.env.READ_ALOUD_CONNECTED_SPEECH_ENABLED !== 'false' &&
      hasConnectedSpeechEvents(referenceText, questionId) && audioQuality?.passed !== false) {
    connectedSpeech = buildConnectedSpeechAnalysis({ questionId, referenceText, azurePayload, audioQuality });
    workerStatus = 'local';
    const workerUrl = String(process.env.CONNECTED_SPEECH_API_URL || '').trim();
    if (workerUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.CONNECTED_SPEECH_TIMEOUT_MS) || 12000);
      try {
        const form = new FormData();
        form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'recording.wav');
        form.append('analysisSpec', JSON.stringify({ attemptId: job.assessmentId,
          questionId, referenceText, version: VERSION, azurePayload, audioQuality,
          events: buildConnectedSpeechEventSpecs(referenceText, questionId) }));
        const response = await fetch(workerUrl, { method: 'POST', body: form, signal: controller.signal,
          headers: process.env.CONNECTED_SPEECH_API_AUDIENCE ?
            { 'X-Connected-Speech-Audience': process.env.CONNECTED_SPEECH_API_AUDIENCE } : undefined });
        if (!response.ok) throw new Error(`CONNECTED_SPEECH_${response.status}`);
        const remote = await response.json();
        if (!Array.isArray(remote.events)) throw new Error('CONNECTED_SPEECH_INVALID');
        connectedSpeech = remote;
        workerStatus = 'complete';
      } catch (_) { workerStatus = 'fallback'; }
      finally { clearTimeout(timeout); }
    }
  }
  const record = buildConnectedSpeechAttemptRecord({
    attemptId: job.assessmentId, questionId, referenceText, recognizedText: result.recognizedText,
    azureSummary: { ...result.overallScores, wordCount: words.length },
    connectedSpeechVersion: connectedSpeech.version || VERSION,
    connectedSpeechSummary: connectedSpeech.summary,
    connectedSpeechEvents: connectedSpeech.events,
    eventFamilyCounts: buildEventFamilyCounts(connectedSpeech.events || []),
    workerStatus, audioQuality, audioStatus: 'complete', storageStatus: 'complete',
    audioPath: job.audioStoragePath, audioSampleRate: 16000,
    referenceWordCount: referenceText.split(/\s+/).filter(Boolean).length,
    recognizedWordCount: words.length
  });
  return { connectedSpeech, audioQuality, connectedSpeechRecord: record };
}

module.exports = { assessReadAloudQuality, enrichReadAloud };
