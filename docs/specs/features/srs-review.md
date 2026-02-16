# SRS Review Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> SRS Review is the retention engine: it schedules words for review and runs fast flashcard-like sessions that strengthen recall and promote words to mastered.

## 2. Goals (The "Why")

- Maximize long-term retention with spaced repetition.
- Keep review sessions short, frequent, and rewarding.
- Integrate writing output to test "active recall" (not only recognition).

## 3. Requirements (The "What")

### Functional

- Maintain per-word SRS card state and next review date.
- Support multiple scheduling algorithms:
  - SM-2 (classic)
  - FSRS (modern, retention-targeted)
- Provide review UI with:
  - due count
  - per-card rating (Again/Hard/Good/Easy)
  - summary stats
- Integrate Writing Challenge as an optional deeper check for selected words.

### Non-Functional

- The scheduler must be deterministic and auditable (show interval previews).
- Storage writes should be resilient (per-card writes + debounced summary saves).

## 4. Data & Contracts (The "Contract")

- Scheduler module: `public/srs-scheduler.js` (SM-2 + FSRS via `ts-fsrs`)
- Review UI/controller: `public/srs-review.js`
- Typical per-card fields:
  - interval, repetitions, easeFactor, state
  - lastReviewDate, nextReviewDate
  - algorithm-specific data (FSRS stability/difficulty) when enabled

## 5. Rewards & Progression

- Reviews award points and can promote words to mastered.
- Optional: AI-based writing score can tighten/boost SRS intervals (when enabled).

## 6. Verification

- Manual:
  - Add a few words -> start review -> confirm due count decreases.
  - Change algorithm preference -> confirm scheduling changes but data remains consistent.
