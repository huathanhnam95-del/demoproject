# Listening Practice RPG - Product Overview

**Status**: Active
**Last updated**: 2026-03-03

This document is the **product-level overview**. Detailed specs live in `docs/specs/features/` and are linked below.

## Vision

A gamified language learning platform that merges **rigorous study tools** (SRS, dictionary, pronunciation analysis) with **engaging gameplay loops** (RPG progression, Survival Mode). The goal is to make deliberate practice feel like building an RPG character.

## Target Audience

- Gamers who want to learn languages (skill trees, builds, runs).
- Serious learners who want fast feedback (accuracy, pronunciation, vocabulary usage) without a sterile UI.

## Core Loop (North Star)

1. Practice in a mode (Type / Speak / Fill / Watch / Notes / Pronounce / Writing).
2. Earn **XP + Coins** (Track A) and update **proficiency / CEFR** (Track B).
3. Spend Coins on the **Skill Tree** (active assists + passive perks).
4. Save vocabulary, review via **SRS**, and convert weak words into mastered words.
5. Optional: play **Survival Mode** for a high-intensity "run" that still trains language skills.

## Activation Notes (A2/PTE-first)

- Landing hero must map directly to PTE tasks (WFD / RS / RL) in simple language.
- Demo entry (`?demo=1`) should reach first practice without auth blocking.
- Day-0 guest flow includes local Vocabulary + SRS loop before account creation.

## Offline Resilience Contract

- The landing page and app shell register a service worker via `public/js/sw-register.js` (HTTPS or localhost only).
- Service worker entrypoint is `public/sw.js` with shell pre-cache for:
  - `/`, `/index.html`
  - `/landing/`, `/landing/index.html`
  - `/offline.html`
  - core CSS (`/style.css`, `/landing/landing.css`)
- Navigation requests are network-first with cache fallback:
  - return cached route when available
  - use `/landing/index.html` for landing routes
  - fall back to `/offline.html` if no route cache exists
- API routes (`/api/*`) are network-only and are never served from cache.
- Offline shell reliability assumes at least one successful online load to prime caches.

## Audit Automation Contract

- Canonical runner: `scripts/audit/run-a2-onboarding-audit.js`.
- Baseline command (local HTTPS): `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --no-server --full-only --assert-p0`.
- Critical-only gate: add `--p0-only` for fast CI-style checks.
- Multi-scenario matrix (includes offline shell validation): `node scripts/audit/run-a2-onboarding-audit.js --base-url https://localhost:8443 --no-server`.
- Video recording is opt-in (`--record-video`) to avoid lock/contention during regular smoke runs.
- Reports must be written under `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/` with screenshots, logs, and JSON run output.

## Core Functions (Spec Map)

| Core function | What it does | Spec |
| --- | --- | --- |
| Authentication & Onboarding | Guest vs login, seed starting level, persistent profile | [auth-and-onboarding](features/auth-and-onboarding.md) |
| RPG Progression & Economy | XP/Coins, levels, skill tree, shop, assist calibration | [rpg-progression-and-economy](features/rpg-progression-and-economy.md) |
| Smart Difficulty Engine | Always-on adaptive difficulty + hint ladder + replay limits | [smart-difficulty-engine](features/smart-difficulty-engine.md) |
| Dictionary & Phonetics | Definitions, translations, examples, collocations, IPA | [dictionary-and-phonetics](features/dictionary-and-phonetics.md) |
| Vocabulary Book | Bookmark words, track missed words, mastery lifecycle | [vocabulary-book](features/vocabulary-book.md) |
| SRS Review | Scheduling (SM-2 + FSRS), review UX, stats, mastery | [srs-review](features/srs-review.md) |
| Type Mode (Dictation) | Listening precision loop (audio -> type -> score) | [type-mode](features/type-mode.md) |
| Speak Mode | Sentence-level speaking accuracy (record -> STT -> score) | [speak-mode](features/speak-mode.md) |
| Fill Mode (Extended) | Cloze/completion with context + collocation scaffolding | [fill-mode](features/fill-mode.md) |
| Notes Mode | Structured note-taking + scoring/feedback loop | [notes-mode](features/notes-mode.md) |
| Watch Mode | Video-synced comprehension tasks + evidence-based scoring | [watch-mode](features/watch-mode.md) |
| Pronounce Mode | High-fidelity pronunciation analysis (pitch/intensity/syllables) | [pronounce-mode](features/pronounce-mode.md) |
| Writing Challenge | Contextual prompts + targeted vocab usage + AI checks | [writing-challenge](features/writing-challenge.md) |
| Survival Mode | Vampire-Survivors-like typing game (still feeds progression) | [survival-mode](features/survival-mode.md) |
| Admin & CRM | Entrance tests, CRM dashboard, watch admin tooling | [admin-and-crm](features/admin-and-crm.md) |
| AI Services | AI proxy, caching, model selection, rate limits, fallbacks | [ai-services](features/ai-services.md) |

## Product Guidelines (Tone / UX / Visuals)

- See [Product Guidelines](product-guidelines.md) for voice, UI principles, and visual style.

## System Architecture (High Level)

- Frontend: Vanilla JS/HTML/CSS in `public/` (multi-mode single-page app).
- Backend API: Node/Express server (see `server.js`, `src/routes/*`) for AI proxying and server-side helpers.
- Server-authoritative scoring + economy: Firebase Cloud Functions in `functions/src/*` (e.g., attempt scoring, purchases).
- Optional local Python services: Flask-based analyzers/proxies in `backend/` (audio analysis and auxiliary endpoints).
- Heavy non-core mode assets (Watch/Notes/Survival) are lazy-loaded with timeout-safe script loading to reduce initial load friction without indefinite hangs.
- Storage:
  - Firestore: user profiles, attempts/ledger, skills/items, writing checks, etc.
  - Local storage: UX caches (dictionary, drafts, difficulty profiles) and guest-local vocab/SRS loop state.

## Related Specs

- Smart Difficulty deep spec: [smart-difficulty-ux-v2](smart-difficulty-ux-v2.md)
- AI suggested practice (draft): [ai-suggested-practice](ai-suggested-practice.md)
- New user roadmap: [new-user-workflow](new-user-workflow.md)
