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
- If a review session is active and the due count is zero (early review), the UI must show a clear "Early review" or "Review session active" label instead of "0 words due."
- Support guest-local review sessions using browser persistence so Day-0 users can complete practice -> vocab -> SRS before registration.
- Integrate Writing Challenge as an optional deeper check for selected words.

### Non-Functional

- The scheduler must be deterministic and auditable (show interval previews).
- Storage writes should be resilient (per-card writes + debounced summary saves).
- Guest-local writes must never attempt Firestore updates (local-only fallback path).
- When offline or on transient backend failure, review flow must remain playable from local state and sync should retry when connectivity returns.
- Dictionary/AI enrichments are optional; failure to fetch enrichment must not block rating cards or session completion.

## 4. Data & Contracts (The "Contract")

- Scheduler module: `public/srs-scheduler.js` (SM-2 + FSRS via `ts-fsrs`)
- Review UI/controller: `public/srs-review.js`
- Guest local cache: `localStorage['bel_guest_srs_v1']`
- Pending sync buffer: `localStorage['srs_pending_data']` (flushes when online/session recovers).
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
  - Start an early review session (no due words) -> confirm the header does not show "0 words due" while the session is active.
  - Run as guest -> add vocab -> start SRS -> refresh -> confirm guest SRS state restores.
  - Change algorithm preference -> confirm scheduling changes but data remains consistent.
  - Seed cards, switch browser offline, continue a review session -> verify ratings still apply and progress persists locally.
  - Reconnect network -> verify pending sync is attempted without duplicating or losing reviewed cards.
