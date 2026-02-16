# Type Mode (Dictation) Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Type Mode is the core "listen -> type" loop. Users listen to audio, type what they heard, and receive immediate feedback, scaffolding, and calibrated rewards.

## 2. Goals (The "Why")

- Train listening precision and spelling under time pressure (as appropriate).
- Provide scaffolding that reduces cognitive overload without removing the learning signal.

## 3. Requirements (The "What")

### Functional

- Play audio and allow replay (bounded by replay limits).
- Accept typed input and score against canonical content.
- Provide hint ladder integration (word count -> first letters -> transcript glimpse/reveal).
- Allow saving missed words to the Vocabulary Book.

### Non-Functional

- Scoring must be server-authoritative for rewards.
- UI must remain responsive while audio plays and while scoring is in flight.

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{type_<id>}` (canonical sentence/audio metadata).
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'type'`).

## 5. Rewards & Progression

- Awards XP/Coins (Track A) and updates proficiency (Track B).
- Assist usage affects calibration multipliers (reduced rewards for heavy assists).

## 6. Verification

- Manual:
  - Complete a clean attempt (no assists) -> verify normal rewards.
  - Use hints/reveal -> verify reduced rewards (calibration).
