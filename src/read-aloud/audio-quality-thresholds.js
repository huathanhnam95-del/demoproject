const fs = require('fs');
const path = require('path');

const THRESHOLDS_PATH = path.join(__dirname, '../../data/read-aloud/audio-quality-thresholds.json');

const DEFAULT_AUDIO_QUALITY_THRESHOLDS = Object.freeze({
  version: 'aq-v1',
  minimumContainerDurationMs: 100,
  minimumSpeechDurationMs: 250,
  maximumSpeechDurationMs: 1800,
  minimumPeakAmplitude: 320,
  minimumFrameRms: 0.01,
  frameRmsFraction: 0.18,
  minimumFrameThreshold: 0.008,
  clippedSampleRatioThreshold: 0.005
});

let cachedThresholds = null;

function normalizeThresholds(raw = {}) {
  return {
    version: String(raw.version || DEFAULT_AUDIO_QUALITY_THRESHOLDS.version),
    minimumContainerDurationMs: Number.isFinite(Number(raw.minimumContainerDurationMs))
      ? Number(raw.minimumContainerDurationMs)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.minimumContainerDurationMs,
    minimumSpeechDurationMs: Number.isFinite(Number(raw.minimumSpeechDurationMs))
      ? Number(raw.minimumSpeechDurationMs)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.minimumSpeechDurationMs,
    maximumSpeechDurationMs: Number.isFinite(Number(raw.maximumSpeechDurationMs))
      ? Number(raw.maximumSpeechDurationMs)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.maximumSpeechDurationMs,
    minimumPeakAmplitude: Number.isFinite(Number(raw.minimumPeakAmplitude))
      ? Number(raw.minimumPeakAmplitude)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.minimumPeakAmplitude,
    minimumFrameRms: Number.isFinite(Number(raw.minimumFrameRms))
      ? Number(raw.minimumFrameRms)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.minimumFrameRms,
    frameRmsFraction: Number.isFinite(Number(raw.frameRmsFraction))
      ? Number(raw.frameRmsFraction)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.frameRmsFraction,
    minimumFrameThreshold: Number.isFinite(Number(raw.minimumFrameThreshold))
      ? Number(raw.minimumFrameThreshold)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.minimumFrameThreshold,
    clippedSampleRatioThreshold: Number.isFinite(Number(raw.clippedSampleRatioThreshold))
      ? Number(raw.clippedSampleRatioThreshold)
      : DEFAULT_AUDIO_QUALITY_THRESHOLDS.clippedSampleRatioThreshold
  };
}

function loadAudioQualityThresholds() {
  if (cachedThresholds) {
    return cachedThresholds;
  }

  try {
    const raw = fs.readFileSync(THRESHOLDS_PATH, 'utf8');
    cachedThresholds = normalizeThresholds(JSON.parse(raw));
  } catch (_) {
    cachedThresholds = DEFAULT_AUDIO_QUALITY_THRESHOLDS;
  }

  return cachedThresholds;
}

module.exports = {
  DEFAULT_AUDIO_QUALITY_THRESHOLDS,
  loadAudioQualityThresholds,
  normalizeThresholds
};
