# Fill Mode (Extended) Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Fill Mode trains contextual usage: the user completes a sentence or short context with missing pieces. Scaffolding includes "ghost word" hints and collocation-driven prompting.

## 2. Goals (The "Why")

- Train context sensitivity (not just transcription).
- Teach common patterns and collocations explicitly.

## 3. Requirements (The "What")

### Functional

- Present a context with blanks/cloze slots.
- Allow users to fill in missing words/phrases.
- Provide scaffolding hints (ghost word, collocation prompts).
- Score against canonical answers and award rewards.

### Non-Functional

- Keep prompts understandable at low levels (A1-B1) and progressively remove scaffolding.

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{extended_<id>}`.
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'extended'`).

## 5. Verification

- Manual:
  - Complete a correct fill -> verify scoring and rewards.
  - Use scaffolding -> verify calibration/reward changes (if applicable).
