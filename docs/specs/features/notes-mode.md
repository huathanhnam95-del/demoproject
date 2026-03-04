# Notes Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Notes Mode trains comprehension and extraction: users write short notes from a source (lecture/reading/video). Scoring emphasizes coverage of key points and clarity.

## 2. Goals (The "Why")

- Train active listening/reading comprehension.
- Reward meaningful effort while discouraging copy/paste farming.

## 3. Requirements (The "What")

### Functional

- Present a prompt/source and a notes input area.
- Score notes server-side (key point overlap / quality heuristics).
- Award calibrated rewards based on effort and accuracy signals.

### Non-Functional

- Anti-farm: repeated submissions to the same content should have diminishing returns.
- Content loading must degrade gracefully: prefer Firestore, then local workbook fallback, without blocking the mode.
- Save/progress write failures must be non-blocking (results remain visible and practice can continue).

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{notes_<id>}`.
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'notes'`).
- Client controller + fallback loaders: `public/take-notes-mode.js`.
- Data fallback source: `public/database/Take%20Notes/RL/RL.xlsx` when Firestore query fails/returns empty.
- Audio loader contract: extension probing (`m4a`, `wav`, `mp3`, `aac`, `ogg`) under `public/database/Take%20Notes/RL/audio/`.

## 5. Verification

- Manual:
  - Submit meaningful notes -> verify non-zero accuracy and rewards.
  - Submit extremely short/empty notes -> verify reduced rewards.
  - Simulate Firestore read failure -> verify questions still load from workbook fallback.
  - Simulate network/write failure on progress save -> verify results UI still completes and next practice remains available.
