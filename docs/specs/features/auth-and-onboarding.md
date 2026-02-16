# Authentication & Onboarding Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Support **guest-first** usage with an upgrade path to **Firebase-authenticated** accounts so users can persist progression (XP/Coins/Skills), vocabulary, and SRS data across devices.

## 2. Goals (The "Why")

- Keep the first session playable without sign-up.
- Make "log in" feel like unlocking persistence, not unlocking learning.
- Seed sensible defaults (starting level) without breaking Smart Difficulty.

## 3. Requirements (The "What")

### Functional

- Guest users can access the main practice modes and see feedback loops.
- Users can authenticate via Firebase Authentication.
- Authenticated users get a stable `uid` used as the primary key for persistence.
- Onboarding includes an English level selection (Beginner / Intermediate / Expert) used to seed initial settings.
- Guest -> logged-in transition does not lose local UX caches (difficulty profile, dictionary caches, drafts).

### Non-Functional

- Privacy: do not store raw audio or long-form text unless explicitly submitted by the user.
- Resilience: if Firestore is unavailable, the UI should degrade gracefully and keep the session usable.

## 4. Data & Contracts (The "Contract")

- Primary identity: Firebase Auth `uid`.
- Persistent profile (Firestore):
  - `users/{uid}` stores progression and feature state (Coins, totalPoints, skills, etc.).
- Local UX caches (browser):
  - Difficulty profile (`localStorage`) to keep mode loops responsive.
  - Dictionary caches (`localStorage`) for definitions/translations.
  - Writing drafts (`localStorage`) for the Writing Challenge.

## 5. Taste Invariants (The "How")

- No "hard gates" that block learning loops; gates should primarily affect persistence and optional assists.
- Guest experience must be honest (no "Active" UI states when logic is disabled).

## 6. Verification

- Manual:
  - Use the app as a guest -> complete a few attempts -> verify the UI still works offline.
  - Log in -> verify profile-driven features (shop/skills/SRS sync) become persistent.
