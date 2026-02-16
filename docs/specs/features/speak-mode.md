# Speak Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Speak Mode checks sentence-level speaking accuracy: the user records speech, the system transcribes it, compares against canonical text, and awards calibrated rewards.

## 2. Goals (The "Why")

- Provide a low-friction speaking loop that complements typing and listening.
- Encourage repeated speaking with bounded replays (avoid infinite retries).

## 3. Requirements (The "What")

### Functional

- Record user speech and transcribe to text (STT).
- Score the transcription against canonical content using word-level matching (anti-cheat).
- Enforce replay limits consistent with Type Mode.
- Surface actionable feedback (what was missing/extra/misheard).

### Non-Functional

- Server-side scoring remains the source of truth for rewards.
- Handle noisy environments gracefully (don't hard-fail the session UI).

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{speak_<id>}`.
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'speak'`).

## 5. Rewards & Progression

- Awards XP/Coins and updates speaking-related proficiency signals.

## 6. Verification

- Manual:
  - Record a near-perfect attempt -> verify high accuracy and normal rewards.
  - Exceed replay limit -> verify UI blocks further replays for that item.
