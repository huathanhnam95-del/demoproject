# Smart Difficulty Engine Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Smart Difficulty is an **always-on adaptive engine** that tunes difficulty and scaffolding based on user performance, while keeping scoring fair via calibration and replay limits.

## 2. Goals (The "Why")

- Make practice feel "right-sized" for the user (not too easy, not too punishing).
- Keep UX honest: UI state must match actual engine behavior.
- Keep the engine local-first and fast, with server-side validation for rewards.

## 3. Requirements (The "What")

### Functional

- Maintain separate performance profiles for core domains (Type / Speak / SRS).
- Use CEFR-like levels (1-6) to control:
  - content selection / filtering
  - baseline scaffolding
  - replay limits
- Enforce replay limits consistently across Type + Speak.
- Provide a coherent hint ladder that integrates with the Skill Tree:
  - Baseline hints (free) at low levels.
  - Paid active assists (coin cost per use) when logged in.

### Non-Functional

- Local performance: per-attempt updates should be < 50ms.
- Storage stability: the difficulty profile schema should migrate cleanly.

## 4. Data & Contracts (The "Contract")

- Local storage: `localStorage['difficulty_profile']`
  - Canonical contract is documented in `docs/specs/smart-difficulty-ux-v2.md`.
- Core modules:
  - Difficulty manager: `public/js/difficulty-manager.js`
  - Adaptive engine UI: `public/js/adaptive-engine-ui.js`
  - Performance tracker: `public/js/performance-tracker.js`
  - Hint system: `public/hint-system.js`

## 5. Taste Invariants (The "How")

- No "bait-and-switch": never show "Active" if the engine is effectively off.
- Keep tuning changes visible in the UI (calibrating/evaluating/ready states).
- Prefer local-only logic for adaptation; reserve server calls for scoring/rewards.

## 6. Verification

- See test list in `docs/specs/smart-difficulty-ux-v2.md`.
