'use strict';

/**
 * Reference Reconstruction Provider
 * Implements Plan V3 §11 unconditioned transcription for unscripted spoken responses.
 * Uses Groq-hosted Whisper (whisper-large-v3) as the primary interchangeable provider.
 * Strictly forbids silent fallback to paid Azure STT on quota exhaustion.
 */

const crypto = require('crypto');

class ReferenceReconstructionProvider {
  async transcribe({ audioBuffer, audioIdentity = null, locale = 'en-US', options = {} }) {
    throw new Error('NOT_IMPLEMENTED');
  }
}

class GroqWhisperAdapter extends ReferenceReconstructionProvider {
  constructor({
    apiKey = process.env.GROQ_API_KEY,
    fetchFn = globalThis.fetch,
    model = 'whisper-large-v3',
    endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions'
  } = {}) {
    super();
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
    this.model = model;
    this.endpoint = endpoint;
  }

  async transcribe({ audioBuffer, audioIdentity = null, locale = 'en', options = {} }) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new TypeError('VALID_AUDIO_BUFFER_REQUIRED');
    }

    const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
    const apiKey = this.apiKey || process.env.GROQ_API_KEY;

    // Deterministic mock / test execution
    if (options.useMock === true) {
      return this._generateMockTranscription(audioBuffer, audioHash, options.mockResult);
    }

    if (!apiKey) {
      const err = new Error('GROQ_API_KEY_REQUIRED');
      err.code = 'MISSING_GROQ_API_KEY';
      throw err;
    }

    // Build standard multipart/form-data for OpenAI-compatible transcription endpoint
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = `response_${Date.now()}.wav`;
    const mimeType = 'audio/wav';

    const parts = [];

    // 'file' field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // 'model' field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${this.model}\r\n`
    ));

    // 'response_format' field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `verbose_json\r\n`
    ));

    // 'timestamp_granularities[]' word-level timestamps
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `word\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `segment\r\n`
    ));

    // 'temperature' field (0 for deterministic greedy decoding)
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="temperature"\r\n\r\n` +
      `0\r\n`
    ));

    // 'language' field if English
    const langCode = locale.split('-')[0].toLowerCase();
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `${langCode}\r\n`
    ));

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const payload = Buffer.concat(parts);

    const response = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(payload.length)
      },
      body: payload
    });

    // Plan V3 & User Mandate: Explicit Quota / Availability Handling without silent Azure STT fallback
    if (response.status === 429) {
      const err = new Error('RECONSTRUCTION_QUOTA_EXHAUSTED');
      err.code = 'RECONSTRUCTION_QUOTA_EXHAUSTED';
      err.status = 429;
      err.provider = 'groq-whisper';
      throw err;
    }

    if (response.status === 503 || response.status === 502 || response.status === 504) {
      const err = new Error('RECONSTRUCTION_UNAVAILABLE');
      err.code = 'RECONSTRUCTION_UNAVAILABLE';
      err.status = response.status;
      err.provider = 'groq-whisper';
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(`GROQ_WHISPER_ERROR_${response.status}: ${errText}`);
      err.status = response.status;
      err.provider = 'groq-whisper';
      throw err;
    }

    const data = await response.json();
    return this._normalizeWhisperOutput(data, audioHash);
  }

  _normalizeWhisperOutput(data, audioHash) {
    let rawTranscript = String(data?.text || '').trim();
    // Strip non-speech audio tags like [music], [applause], (cheering), etc.
    rawTranscript = rawTranscript.replace(/\[[^\]]*\]|\([^\)]*\)/g, '').replace(/\s+/g, ' ').trim();
    let rawWords = Array.isArray(data?.words) ? data.words : [];

    // Fallback: extract words from segments if top-level words is missing
    if (rawWords.length === 0 && Array.isArray(data?.segments)) {
      for (const seg of data.segments) {
        if (Array.isArray(seg?.words)) {
          rawWords.push(...seg.words);
        }
      }
    }

    const tokens = rawWords.map((w, idx) => {
      const wordText = String(w.word || '').trim();
      const startMs = Number.isFinite(w.start) ? Math.max(0, Math.round(w.start * 1000)) : null;
      const endMs = Number.isFinite(w.end) && startMs !== null ? Math.max(startMs, Math.round(w.end * 1000)) : null;
      const confidence = typeof w.probability === 'number'
        ? Math.round(w.probability * 100) / 100
        : (typeof w.confidence === 'number' ? w.confidence : null);

      return {
        index: idx,
        word: wordText,
        startMs,
        endMs,
        confidence
      };
    }).filter(t => t.word.length > 0 && !/^\[.*\]$|^\(.*\)$/.test(t.word));

    const known = tokens.map(t => t.confidence).filter(Number.isFinite);
    const overallConfidence = known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100) / 100 : null;

    const lastToken = tokens[tokens.length - 1];
    const detectedSpeechDurationMs = lastToken?.endMs ?? null;

    return {
      provider: 'groq-whisper',
      model: this.model,
      audioHash,
      rawTranscript,
      tokens,
      segments: Array.isArray(data?.segments) ? data.segments.map(segment => ({
        text: String(segment.text || ''),
        startMs: Number.isFinite(segment.start) ? Math.round(segment.start * 1000) : null,
        endMs: Number.isFinite(segment.end) ? Math.round(segment.end * 1000) : null
      })) : [],
      confidence: overallConfidence,
      detectedSpeechDurationMs,
      transcriptRevision: `groq-whisper-${crypto.randomBytes(8).toString('hex')}`
    };
  }

  _generateMockTranscription(audioBuffer, audioHash, customMock) {
    if (customMock && (customMock.rawTranscript || customMock.tokens || customMock.words)) {
      return {
        provider: 'groq-whisper-mock',
        model: this.model,
        audioHash,
        ...customMock
      };
    }

    const sampleWords = [
      { word: 'The', startMs: 100, endMs: 300, confidence: 0.95 },
      { word: 'image', startMs: 350, endMs: 800, confidence: 0.92 },
      { word: 'illustrates', startMs: 850, endMs: 1400, confidence: 0.90 },
      { word: 'the', startMs: 1450, endMs: 1600, confidence: 0.95 },
      { word: 'data', startMs: 1650, endMs: 2000, confidence: 0.91 },
      { word: 'distribution', startMs: 2050, endMs: 2700, confidence: 0.89 }
    ];

    return {
      provider: 'groq-whisper-mock',
      model: this.model,
      audioHash,
      rawTranscript: 'The image illustrates the data distribution',
      tokens: sampleWords.map((w, idx) => ({ index: idx, ...w })),
      confidence: 0.92,
      detectedSpeechDurationMs: 2700,
      transcriptRevision: `mock-whisper-${crypto.randomBytes(8).toString('hex')}`
    };
  }
}

// Registry for interchangeable reconstruction providers
const providerRegistry = new Map();
const defaultGroqAdapter = new GroqWhisperAdapter();
providerRegistry.set('groq-whisper', defaultGroqAdapter);
providerRegistry.set('default', defaultGroqAdapter);

function registerReconstructionProvider(name, provider) {
  providerRegistry.set(name, provider);
}

function getReconstructionProvider(name = 'default') {
  const provider = providerRegistry.get(name);
  if (!provider) {
    throw new Error(`UNKNOWN_RECONSTRUCTION_PROVIDER: ${name}`);
  }
  return provider;
}

module.exports = {
  ReferenceReconstructionProvider,
  GroqWhisperAdapter,
  registerReconstructionProvider,
  getReconstructionProvider
};
