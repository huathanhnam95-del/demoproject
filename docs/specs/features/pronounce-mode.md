# Pronounce Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Pronounce Mode provides high-fidelity pronunciation feedback using audio analysis (pitch, intensity, syllables) with visualizations and targeted coaching.

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
- Provide "A/B" playback for user vs reference audio (when available).

### Non-Functional

- The analysis pipeline must be robust to noisy recordings and short clips.
- Prefer fast approximate feedback over slow perfect analysis.

## 4. Data & Contracts (The "Contract")

- Client hooks:
  - `public/phonetics.js` (phonetic helpers)
- Python analysis (local service):
  - `backend/local_server/server.py`
    - `POST /analyze` accepts an audio file and returns analysis JSON.
    - Uses Parselmouth/Praat for pitch/intensity and an adaptive syllable detector.

## 5. Verification

- Manual:
  - Record audio -> verify analysis returns pitch/intensity arrays and syllable segmentation.
  - Try a very short/noisy clip -> verify errors are handled gracefully.
