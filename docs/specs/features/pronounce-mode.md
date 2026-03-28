# Pronounce Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Pronounce Mode provides high-fidelity pronunciation feedback using audio analysis (pitch, intensity, syllables, and prosody match scoring) with visualizations and targeted coaching.

## 2. Goals (The "Why")

- Give learners concrete, visual feedback beyond "right/wrong".
- Enable repeatable practice on the same target with bounded replays and clear coaching cues.

## 3. Requirements (The "What")

### Functional

- Record user audio for a target word/sentence.
- Analyze audio and return:
  - pitch contour
  - intensity contour
  - syllable timing/boundaries
- Render visual feedback (contours + comparisons).
- Distinguish target stress from the learner's strongest stress cue in the feedback summary.
- Provide "A/B" playback for user vs reference audio (when available).

### Non-Functional

- The analysis pipeline must be robust to noisy recordings and short clips.
- Prefer fast approximate feedback over slow perfect analysis.
- Praat backend is optional: if backend health check fails, mode must automatically use local JS analysis.
- Dictionary/native-reference lookup failures must degrade to fallback pronunciation info or a non-blocking error state.
- Analysis failures must restore controls (`Record` re-enabled) so users can retry without page reload.
- Silent, too-short, or otherwise unusable recordings must be rejected instead of being forced into a syllable score.

## 4. Data & Contracts (The "Contract")

- Pronounce app controller: `public/pronunciation-analyzer/main.js`
  - Chooses backend or local analyzer path (`usePraatBackend`) via startup health check.
- Pronounce controller logic: `public/pronunciation-analyzer/app.js`
  - Owns the runtime analysis pipeline, unrateable handling, and prosody summary rendering.
- Backend adapter: `public/pronunciation-analyzer/praat-api.js`
  - `GET /health` availability check
  - `POST /analyze` for uploaded user audio
  - `POST /analyze-url` for native reference analysis
- Native reference + fallback pipeline: `public/pronunciation-analyzer/word-reference-service.js`
  - Dictionary lookup + optional native-audio analysis with per-audio reuse.
- Python analysis service:
  - `backend/local_server/server.py`
    - Provides `/analyze` and `/analyze-url` for Parselmouth/Praat-backed analysis.

## 5. Verification

- Manual:
  - Record audio -> verify analysis returns pitch/intensity arrays and syllable segmentation.
  - Try a very short/noisy clip -> verify errors are handled gracefully.
  - Stop backend service -> verify mode still analyzes using local JS path (no hard block).
  - Force backend analysis error -> verify error appears in summary and `Record` becomes usable again.
  - Trigger dictionary/reference failure -> verify mode remains interactive and does not crash panel switching.
