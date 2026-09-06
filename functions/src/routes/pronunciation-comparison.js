const express = require('express');
const multer = require('multer');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const IPA_VOWELS = new Set([
  'a', 'e', 'i', 'o', 'u', 'ɑ', 'ɒ', 'ɔ', 'ə', 'ɛ', 'ɪ', 'ʊ', 'ʌ',
  'æ', 'ɐ', 'ɜ', 'ɝ', 'ɚ', 'aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ', 'əʊ',
  'ɪə', 'ɛə', 'ʊə', 'aː', 'eː', 'iː', 'oː', 'uː', 'ɑː', 'ɔː', 'ɜː',
  'ɑɹ', 'ɔɹ', 'ɛɹ', 'ɪɹ', 'ʊɹ', 'ɔːɹ', 'oːɹ', 'm̩', 'n̩', 'ŋ̩', 'l̩', 'ɹ̩', 'r̩'
]);

function isVowel(phone) {
  if (!phone) return false;
  const clean = String(phone).trim().toLowerCase().replace(/[ˈˌ.·]/g, '');
  if (IPA_VOWELS.has(clean)) return true;
  // Check if any character is a core vowel symbol
  return /[aeiouɑɒɔəɛɪʊʌæɐɜɝɚ]/.test(clean);
}

function buildPronunciationAssessmentHeader(referenceText) {
  const config = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    PhonemeAlphabet: 'IPA',
    EnableMiscue: true,
    NBestPhonemeCount: 5
  };
  return Buffer.from(JSON.stringify(config)).toString('base64');
}

async function callAzureAssessment(buffer, referenceText, sampleRate = 16000) {
  // Check mock environment override
  const mockRaw = String(process.env.PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE || '').trim();
  if (mockRaw) {
    try {
      return JSON.parse(mockRaw);
    } catch (_) {
      // Ignore invalid mock
    }
  }

  const key = String(process.env.AZURE_SPEECH_KEY || '').trim();
  const region = String(process.env.AZURE_SPEECH_REGION || '').trim();

  if (!key || !region) {
    // Generate synthetic hypothesis if Azure credentials not configured in local dev
    return {
      RecognitionStatus: 'Success',
      NBest: [{
        Confidence: 0.95,
        Lexical: referenceText,
        Display: referenceText,
        AccuracyScore: 90,
        FluencyScore: 88,
        CompletenessScore: 100,
        PronScore: 89,
        Words: [{
          Word: referenceText,
          Offset: 2000000,
          Duration: 6000000,
          PronunciationAssessment: { AccuracyScore: 90 },
          Phonemes: buildSyntheticPhonemes(referenceText)
        }]
      }]
    };
  }

  const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate}`,
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': buildPronunciationAssessmentHeader(referenceText)
      },
      body: buffer
    });

    const text = await response.text();
    const payload = JSON.parse(text);
    if (!response.ok || !payload) {
      throw new Error(`Azure assessment failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function buildSyntheticPhonemes(word) {
  // Simple heuristic vowel/consonant split for fallback
  const chars = word.toLowerCase().split('');
  const durationPerChar = 6000000 / Math.max(1, chars.length);
  return chars.map((char, index) => ({
    Phoneme: char,
    Offset: Math.round(2000000 + index * durationPerChar),
    Duration: Math.round(durationPerChar),
    PronunciationAssessment: { AccuracyScore: 88 }
  }));
}

function extractSampleRate(buffer) {
  if (Buffer.isBuffer(buffer) && buffer.length >= 28) {
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
      const rate = buffer.readUInt32LE(24);
      if (rate >= 8000 && rate <= 96000) return rate;
    }
  }
  return 16000;
}

function resolvePythonBackendUrl(req) {
  const queryOrHeader = req.query?.backendUrl || req.headers?.['x-python-backend-url'] || req.body?.backendUrl;
  if (queryOrHeader && typeof queryOrHeader === 'string' && queryOrHeader.trim()) {
    return queryOrHeader.trim().replace(/\/+$/, '');
  }
  return (process.env.PYTHON_BACKEND_URL || process.env.PRAAT_BACKEND_URL || 'https://praat-api-1071929245506.us-central1.run.app').replace(/\/+$/, '');
}

/**
 * POST /api/pronunciation-assessment/option-a
 * Option A: Azure Speech (Phoneme granularity) + Praat Prosody Fusion
 */
router.post('/option-a', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No audio file provided', success: false });
    }

    const word = String(req.body.word || req.body.target_word || '').trim();
    if (!word) {
      return res.status(400).json({ error: 'Missing target word parameter', success: false });
    }

    const referenceIpa = String(req.body.reference_ipa || '').trim();
    const backendUrl = resolvePythonBackendUrl(req);
    const audioBuffer = req.file.buffer;
    const sampleRate = extractSampleRate(audioBuffer);

    // 1. Call Azure Pronunciation Assessment
    const azurePayload = await callAzureAssessment(audioBuffer, word, sampleRate);
    const bestHypo = azurePayload?.NBest?.[0];
    const bestWord = bestHypo?.Words?.[0] || {};
    const rawPhonemes = Array.isArray(bestWord.Phonemes) ? bestWord.Phonemes : [];

    // 2. Extract vowel nuclei intervals
    const vowelIntervals = [];
    const allPhonemes = [];

    rawPhonemes.forEach((p, idx) => {
      const phoneSymbol = String(p.Phoneme || '').trim();
      const offsetTicks = Number(p.Offset || 0);
      const durTicks = Number(p.Duration || 0);
      const startTime = Math.round((offsetTicks / 1e7) * 10000) / 10000;
      const duration = Math.round((durTicks / 1e7) * 10000) / 10000;
      const endTime = Math.round((startTime + duration) * 10000) / 10000;
      const accuracy = Number(p.PronunciationAssessment?.AccuracyScore || 0);

      const phoneItem = {
        index: idx,
        phoneme: phoneSymbol,
        startTime,
        endTime,
        duration,
        accuracyScore: accuracy,
        isVowel: isVowel(phoneSymbol)
      };
      allPhonemes.push(phoneItem);

      if (phoneItem.isVowel) {
        vowelIntervals.push({
          id: vowelIntervals.length,
          phoneme: phoneSymbol,
          startTime,
          endTime,
          vowelDuration: duration,
          accuracy
        });
      }
    });

    // 3. Check for /ə/ vowel reduction
    const reductionChecks = vowelIntervals.map((nucleus) => {
      const clean = String(nucleus.phoneme || '').trim().toLowerCase().replace(/[ˈˌ.·]/g, '');
      const isSchwa = clean === 'ə' || clean === 'ɚ' || clean === 'ɨ' || clean === 'ax';
      return {
        id: nucleus.id,
        phoneme: nucleus.phoneme,
        isReduced: isSchwa,
        accuracyScore: nucleus.accuracy,
        verdict: isSchwa
          ? 'Weak reduction to [ə] detected'
          : `Full vowel [${nucleus.phoneme}] maintained`
      };
    });

    // 4. Proxy to Python backend /analyze-nucleus-prosody for Praat pitch (F0) and intensity
    let prosodyIntervals = vowelIntervals.map(v => ({
      id: v.id,
      phoneme: v.phoneme,
      startTime: v.startTime,
      endTime: v.endTime,
      vowelDuration: v.vowelDuration,
      maxPitch: 0,
      meanPitch: 0,
      peakIntensity: 0,
      meanIntensity: 0
    }));

    let prosodySource = 'praat-fusion';

    try {
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('audio', blob, 'sample.wav');
      formData.append('intervals', JSON.stringify(vowelIntervals));

      const prosodyResponse = await fetch(`${backendUrl}/analyze-nucleus-prosody`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(8000)
      });

      if (prosodyResponse.ok) {
        const prosodyData = await prosodyResponse.json();
        if (prosodyData && Array.isArray(prosodyData.intervals)) {
          prosodyIntervals = prosodyData.intervals;
        }
      } else {
        prosodySource = 'fallback-azure-durations';
      }
    } catch (prosodyErr) {
      prosodySource = `fallback-azure-durations (${prosodyErr.message || 'connection failed'})`;
    }

    // 5. Calculate lexical stress prominence across vowel nuclei
    const maxVowelDur = Math.max(...prosodyIntervals.map(i => i.vowelDuration || 0), 0.001);
    const maxPitch = Math.max(...prosodyIntervals.map(i => i.maxPitch || i.meanPitch || 0), 0.001);
    const maxInt = Math.max(...prosodyIntervals.map(i => i.peakIntensity || i.meanIntensity || 0), 0.001);

    let highestProminence = -1;
    let detectedStressedIdx = 0;

    const syllables = prosodyIntervals.map((interval, idx) => {
      const durRel = (interval.vowelDuration || 0) / maxVowelDur;
      const pitchRel = (interval.maxPitch || interval.meanPitch || 0) / maxPitch;
      const intRel = (interval.peakIntensity || interval.meanIntensity || 0) / maxInt;

      // Weighted: Pitch (0.50) + Vowel Duration (0.30) + Intensity (0.20)
      const prominence = Math.round((0.50 * pitchRel + 0.30 * durRel + 0.20 * intRel) * 1000) / 1000;

      if (prominence > highestProminence) {
        highestProminence = prominence;
        detectedStressedIdx = idx;
      }

      return {
        syllableNumber: idx + 1,
        nucleusPhoneme: interval.phoneme,
        startTime: interval.startTime,
        endTime: interval.endTime,
        vowelDuration: interval.vowelDuration,
        maxPitch: interval.maxPitch || 0,
        meanPitch: interval.meanPitch || 0,
        peakIntensity: interval.peakIntensity || 0,
        meanIntensity: interval.meanIntensity || 0,
        prominence,
        isStressed: false,
        reduction: reductionChecks[idx] || null
      };
    });

    if (syllables[detectedStressedIdx]) {
      syllables[detectedStressedIdx].isStressed = true;
    }

    return res.json({
      success: true,
      engine: 'option-a',
      targetWord: word,
      referenceIpa,
      prosodySource,
      azureScores: {
        accuracy: bestHypo?.AccuracyScore ?? 0,
        fluency: bestHypo?.FluencyScore ?? 0,
        completeness: bestHypo?.CompletenessScore ?? 0,
        pronScore: bestHypo?.PronScore ?? 0
      },
      detectedStressedIndex: detectedStressedIdx,
      stressedSyllableNumber: detectedStressedIdx + 1,
      syllables,
      phonemes: allPhonemes,
      reductionChecks,
      summary: {
        totalSyllables: syllables.length,
        detectedStressed: detectedStressedIdx,
        stressedSyllableNumber: detectedStressedIdx + 1,
        stressConfidence: highestProminence >= 0 ? highestProminence : 0
      }
    });
  } catch (error) {
    console.error('Option A assessment error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Option A assessment encountered an internal error',
      engine: 'option-a'
    });
  }
});

/**
 * POST /api/pronunciation-assessment/option-b
 * Proxy to Python Backend Option B (Repaired Self-Hosted V4 + Praat Native)
 */
router.post('/option-b', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No audio file provided', success: false });
    }

    const backendUrl = resolvePythonBackendUrl(req);
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: 'audio/wav' });
    formData.append('audio', blob, 'sample.wav');

    if (req.body.word || req.body.target_word) {
      formData.append('word', req.body.word || req.body.target_word);
    }
    if (req.body.reference_ipa) {
      formData.append('reference_ipa', req.body.reference_ipa);
    }
    if (req.body.expected_syllables) {
      formData.append('expected_syllables', String(req.body.expected_syllables));
    }

    const response = await fetch(`${backendUrl}/analyze/option-b`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(15000)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Option B proxy error:', error);
    return res.status(502).json({
      success: false,
      error: `Option B backend proxy failed: ${error.message || 'unreachable'}`,
      engine: 'option-b'
    });
  }
});

module.exports = router;
