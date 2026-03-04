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
- Guest users can trigger baseline hints directly from the hint control (session-limited free usage).
- Paid active hint skills remain account/skill-tree gated; guest mode never hard-blocks baseline hint access.
- Allow saving missed words to the Vocabulary Book.

### Non-Functional

- Scoring must be server-authoritative for rewards.
- UI must remain responsive while audio plays and while scoring is in flight.
- If backend scoring fails or network drops, local diff/feedback + hint flow must still complete (no hard-stop on check).
- If content/audio loading fails, the mode must degrade to a safe fallback item/state rather than a blank panel.

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{type_<id>}` (canonical sentence/audio metadata).
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'type'`).
- Client loop + resilience: `public/script.js` (local diff scoring, retry flow, best-effort server scoring call).
- Hint ladder contract: `public/hint-system.js` (progressive hints independent from economy writes).
- Local dataset source: `public/database/type/index.json` (used by client loader with fallback item behavior).

## 5. Rewards & Progression

- Awards XP/Coins (Track A) and updates proficiency (Track B).
- Assist usage affects calibration multipliers (reduced rewards for heavy assists).

## 6. Verification

- Manual:
  - Complete a clean attempt (no assists) -> verify normal rewards.
  - Use hints/reveal -> verify reduced rewards (calibration).
  - In guest mode, tap hint -> verify no login-blocking modal appears and baseline hint content is shown.
  - Simulate scoring endpoint failure -> verify check flow still shows correction feedback and user can continue next item.
  - Simulate temporary network loss during practice -> verify hint ladder and local result rendering still work without UI lockup.
