# Authentication & Onboarding Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Support **guest-first** usage with an upgrade path to **Firebase-authenticated** accounts so users can persist progression (XP, roadmap unlocks), vocabulary, and SRS data across devices.

## 2. Goals (The "Why")

- Keep the first session playable without sign-up.
- Make "log in" feel like unlocking persistence, not unlocking learning.
- Seed sensible defaults (starting level) without breaking Smart Difficulty.

## 3. Requirements (The "What")

### Functional

- Guest users can access the main practice modes and see feedback loops.
- Landing/demo entry (`/index.html?demo=1`) auto-activates guest mode and skips the entry-choice block.
- Users can authenticate via Firebase Authentication.
- Authenticated users get a stable `uid` used as the primary key for persistence.
- Onboarding includes an English level selection (Beginner / Intermediate / Expert) used to seed initial settings.
- Guest -> logged-in transition does not lose local UX caches (difficulty profile, dictionary caches, drafts).
- Guest mode initializes Vocabulary Book + SRS Review in local-only mode (no Firestore writes) so users can complete the full first loop before login.
- Logged-out non-guest state clears user bindings for Vocabulary Book/SRS to avoid stale data.
- Landing + app entry register `public/sw.js` and provide an offline shell fallback once the user has loaded online at least once.

### Non-Functional

- Privacy: do not store raw audio or long-form text unless explicitly submitted by the user.
- Resilience: if Firestore is unavailable, the UI should degrade gracefully and keep the session usable.
- Preloader fallback copy must be trust-safe: neutral slow-network messaging with `Retry` / `Continue`, no security panic wording.
- Offline resilience: browser-level disconnected navigation should degrade to cached app/landing shell instead of hard navigation failure.

## 4. Data & Contracts (The "Contract")

- Primary identity: Firebase Auth `uid`.
- Persistent profile (Firestore):
  - `users/{uid}` stores progression and feature state (XP, roadmap unlocks, skills, etc.).
- Local UX caches (browser):
  - Difficulty profile (`localStorage`) to keep mode loops responsive.
  - Dictionary caches (`localStorage`) for definitions/translations.
  - Writing drafts (`localStorage`) for the Writing Challenge.
- Guest-local learning loop:
  - Vocabulary Book cache: `localStorage['bel_guest_vocab_v1']`
  - SRS cache: `localStorage['bel_guest_srs_v1']`
  - Demo/guest activation marker: `sessionStorage['guestMode']`
- Service worker shell/runtime caches:
  - Registration: `public/js/sw-register.js`
  - Worker: `public/sw.js`
  - Cache names: `bel-offline-v1-shell`, `bel-offline-v1-runtime`
  - Offline fallback page: `public/offline.html`

## 5. Taste Invariants (The "How")

- No "hard gates" that block learning loops; gates should primarily affect persistence and optional assists.
- Guest experience must be honest (no "Active" UI states when logic is disabled).

## 6. Verification

- Automated (Playwright audit harness):
  - P0 gate only: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --no-server --full-only --p0-only --assert-p0`
  - Full journey smoke: `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --no-server --full-only --assert-p0`
  - Matrix run (device/network/offline): `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --no-server`
  - Optional video capture: add `--record-video` when diagnosing a specific flow.
  - P0 pass criteria:
    - `L1_landing_load` is successful and keeps PTE task mapping visible.
    - `A1_click_demo_cta` reaches app entry without hard auth block.
    - `P2_type_assisted_attempt` does not force login for hints.
    - `V1_vocab_manual_add` works in guest flow without login blocking.
    - `S1_start_srs_review` opens SRS from guest flow.
- Manual:
  - Use the app as a guest -> complete a few attempts -> verify the UI still works offline.
  - First load online, then switch browser offline mode -> verify `/landing/` and `/index.html` still open from cache (or `/offline.html` fallback).
  - Enter via `?demo=1` -> verify no entry modal blocks the first interaction.
  - In guest mode, add vocabulary + open SRS -> refresh -> verify local data persists.
  - Log in -> verify profile-driven features (roadmap unlocks / skills / SRS sync) become persistent.
