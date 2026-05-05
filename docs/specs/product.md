# Better English Learning - Product Overview

**Status**: Active
**Last updated**: 2026-05-04
**Audience**: Product, design, operations, and engineering

This document is the product-level source of truth. Detailed feature specs live in `docs/specs/features/`. The engineering takeover document for IT/senior engineers is `docs/specs/it-product-spec.md`.

## 1. Product Vision

Better English Learning is a gamified English and PTE preparation platform that combines:

- **Learner practice**: a browser-based practice page with listening, speaking, reading, writing, pronunciation, vocabulary, SRS, and RPG progression loops.
- **Teaching operations**: an admin CRM for lead intake, entrance testing, student profiles, classroom scheduling, attendance, finance, communications, reporting, and governance.

The product goal is to make deliberate English practice feel like building an RPG character while giving the teaching/admin team a single operational cockpit for managing the learner lifecycle.

## 2. Product Surfaces

### Learner Practice Page

- Main shell: `public/index.html`, `public/script.js`, `public/style.css`.
- Default route: `/`; practice deep links use `/practice/{skill}/{mode}[/{questionId}]`.
- Users can enter as guests, sign in with Firebase Auth, select an initial level, and practice through the launcher.
- Authenticated learners get persistent progress, SRS, vocabulary, attempts, XP, unlocks, and profile data.
- Guest learners can use the practice flow with local-only state where supported.

### Admin / CRM

- Main shell: `public/crm-admin.html`, `public/crm-admin.js`, `public/crm-admin.css`, and `public/js/crm/*.js`.
- Admin-only workflows cover lead management, student records, entrance tests, classrooms, schedules, attendance, finance, communications, governance, reporting, recycle bin, and devtools.
- CRM data lives in Firestore `crm*` collections and is exposed through `/api/admin/*` and `/api/teacher/*` routes.

## 3. Primary Personas

- **Learner**: practices English/PTE tasks, tracks progress, saves vocabulary, reviews weak items, and receives AI-assisted feedback.
- **Guest learner**: tries practice without account creation; persistence is intentionally limited to local state.
- **Teacher**: schedules sessions, manages class outcomes, opens attendance, adds notes, and handles classroom delivery tasks.
- **Counselor/Admin**: creates leads, schedules entrance tests, converts leads to students, manages student 360 data, and monitors follow-ups.
- **Finance/Admin**: manages invoices, payments, commissions, summaries, and student finance handoff.
- **Senior engineer / IT owner**: maintains app architecture, Firebase rules, APIs, data migrations, tests, deployment, and operational safety.

## 4. Core Product Loops

### Learner Loop

1. Select English Practice or PTE Practice.
2. Choose a skill group and mode.
3. Complete a practice attempt.
4. Receive scoring, feedback, hints, replay support, or AI guidance.
5. Earn XP/progression, save vocabulary, and review weak items through SRS.
6. Return through recommendations, bookmarks, shared attempts, or classroom assignments.

### CRM Loop

1. Create or import a lead.
2. Log tasks/activities and schedule an entrance test.
3. Review entrance-test results and convert the lead into a student.
4. Enroll the student into courses/classrooms.
5. Schedule sessions, track attendance, manage homework/submissions, and record outcomes.
6. Manage finance, communications, reports, duplicate handling, and audit history.

## 5. Practice Scope and Mode Roster

The practice launcher supports two scopes:

- **English Practice**: default mode grouping and labels.
- **PTE Practice**: exam-specific labels and visibility without changing the underlying mode engines.

Current launcher groups:

| Skill group | Modes |
| --- | --- |
| Speaking | Repeat, Pronounce, Read Aloud, Answer Short Question, Summarize Group Discussion, Describe Image |
| Listening | Dictate, Collo-dictate, Fill In the Blanks, Watch, Take Notes |
| Reading | Reading Fill in the Blanks |
| Writing | Write Essay |

PTE Practice currently exposes Read Aloud, Repeat Sentence, Retell Lecture, Fill In the Blanks, Write from Dictation, Reading Fill in the Blanks, Summarize Group Discussion, Write Essay, and Describe Image. Answer Short Question exists as a mode but is launcher-hidden unless explicitly enabled.

## 6. Core Functions and Specs

| Core function | What it does | Primary source/spec |
| --- | --- | --- |
| Authentication & Onboarding | Guest/login entry, Firebase Auth, initial level selection, profile bootstrap | [auth-and-onboarding](features/auth-and-onboarding.md) |
| Practice Scope Launcher | Switches English/PTE mode grouping, labels, visibility, routing, and active mode metadata | `public/script.js`; [IT spec](it-product-spec.md) |
| RPG Progression & Economy | XP, coins, skill ratings, CEFR progression, unlocks, shop/skills | [rpg-progression-and-economy](features/rpg-progression-and-economy.md) |
| Smart Difficulty Engine | Adaptive question recommendations, filters, hint ladder, performance tracking | [smart-difficulty-engine](features/smart-difficulty-engine.md) |
| Dictionary & Phonetics | Definitions, translations, examples, collocations, IPA, local dictionary/cache | [dictionary-and-phonetics](features/dictionary-and-phonetics.md) |
| Vocabulary Book | Bookmarks, missed-word tracking, improving words, manual add, panel UI | [vocabulary-book](features/vocabulary-book.md) |
| SRS Review | Review queue, SM-2/FSRS scheduling, stats, mastery lifecycle | [srs-review](features/srs-review.md) |
| Dictate / Type Mode | Listening dictation loop; PTE label: Write from Dictation | [type-mode](features/type-mode.md) |
| Collo-dictate | Collocation-focused dictation mode using dedicated data and utilities | `public/js/collo-dictate-mode.js`; [IT spec](it-product-spec.md) |
| Repeat / Speak Mode | Sentence-level speaking accuracy; PTE label: Repeat Sentence | [speak-mode](features/speak-mode.md) |
| Read Aloud Mode | Timed prep/record flow with reference audio, connected-speech guides, assessment, and reporting | `public/read-aloud-mode.js`; [IT spec](it-product-spec.md) |
| Pronounce Mode | Pronunciation analyzer with pitch, intensity, syllables, stress, A/B playback, and fallbacks | [pronounce-mode](features/pronounce-mode.md) |
| Answer Short Question | Audio prompt, short spoken answer, browser speech recognition, scoring/result flow | `public/asq-mode.js`; [IT spec](it-product-spec.md) |
| Summarize Group Discussion | Multi-speaker listening, speaker-tab notes, two-minute recording, who-said-what scoring | `public/sgd-mode.js`; [IT spec](it-product-spec.md) |
| Describe Image | PTE image speaking flow with prep timer, recording timer, transcript, sample answer, key points, AI review | `public/describe-image-mode.js`; [IT spec](it-product-spec.md) |
| Fill Mode | Listening cloze/completion with context and scaffolding | [fill-mode](features/fill-mode.md) |
| Reading Fill in the Blanks | Reading cloze mode with dropdown options, support variants, review metadata, and audio support | `public/rfib-mode.js`; [IT spec](it-product-spec.md) |
| Notes Mode | Structured note-taking and scoring; PTE label: Retell Lecture | [notes-mode](features/notes-mode.md) |
| Watch Mode | Video-synced comprehension tasks and admin-managed question sets | [watch-mode](features/watch-mode.md) |
| Write Essay | PTE essay prompts, target vocabulary, AI/local assessment, and B2 sample-answer pilot | [writing-challenge](features/writing-challenge.md); [B2 samples](2026-04-21-write-essay-b2-sample-essays-pilot.md) |
| Writing Challenge | Contextual writing prompts, target vocabulary usage, AI checks, history | [writing-challenge](features/writing-challenge.md) |
| Survival Mode | Vampire-Survivors-like typing game that still feeds progression | [survival-mode](features/survival-mode.md) |
| Reading Journey | Hidden story-driven reading prototype with AI-generated beats and formative quiz | [reading-journey](features/reading-journey.md) |
| Reading Journey Assessment | Post-story quiz, missed-item local review queue, accessibility rules | [reading-journey-assessment](features/reading-journey-assessment.md) |
| AI Services | AI proxy, Gemini/Vertex paths, Hugging Face, Ollama essay assessment, caching, rate limits, fallbacks | [ai-services](features/ai-services.md) |
| Practice Attempts | Server-owned speaking attempts, retention, bookmarks, sharing, teacher feedback | `functions/src/routes/practice-attempts.js`; [IT spec](it-product-spec.md) |
| Entrance Tests | Single-use learner links, 36+ test flow, audio upload/ASR, scoring, CRM result/PDF views | [admin-and-crm](features/admin-and-crm.md); [IT spec](it-product-spec.md) |
| Admin & CRM | Lead-to-student operations, classrooms, scheduling, attendance, finance, communications, reporting, governance | [admin-and-crm](features/admin-and-crm.md) |
| Teacher Scheduler | Teacher-scoped scheduling workspace, quick add, weekly patterns, recurrence activation, session notes/outcomes | [admin-and-crm](features/admin-and-crm.md); [IT spec](it-product-spec.md) |

## 7. Activation and UX Principles

- The learner should reach value quickly: load app, choose mode, complete one attempt, see feedback.
- PTE users should see exam-native labels such as Read Aloud, Repeat Sentence, Retell Lecture, Write from Dictation, Summarize Group Discussion, and Describe Image.
- Guest flows should avoid hard auth blocks unless persistence, student-only access, or protected data is required.
- Heavy modules are loaded lazily where possible to protect initial load.
- AI failures should never strand the learner; fallbacks and retry states are part of the product contract.
- CRM workflows should favor operational speed but keep classroom/session constraints, permissions, and auditability strict.

## 8. Offline Resilience Contract

- Service worker registration: `public/js/sw-register.js`.
- Service worker entrypoint: `public/sw.js`.
- Pre-cached shell includes `/`, `/index.html`, `/landing/`, `/landing/index.html`, `/offline.html`, `/style.css`, and `/landing/landing.css`.
- Navigation requests are network-first with cache fallback.
- `/api/*` routes are network-only and are never served from cache.
- Offline reliability assumes at least one successful online load to prime caches.

## 9. System Architecture

- **Frontend**: Vanilla HTML/CSS/JS in `public/`; no bundler is required for the learner shell.
- **Local backend**: `server.js` creates the Express app from `src/server/app.js`, serves static files, mounts local APIs, and mirrors selected Cloud Function routes for local development.
- **Production backend**: Firebase Hosting rewrites `/api/**` to the Cloud Function `api` exported from `functions/src/index.js`.
- **Server-authoritative functions**: `functions/src/*` handles scoring, economy, CRM APIs, speaking attempts, scheduled jobs, and admin workflows.
- **Optional Python services**: `backend/` supports pronunciation/Praat and auxiliary local analyzer endpoints.
- **Storage**:
  - Firestore: user profiles, progress, SRS, practice attempts, CRM collections, reading journey caches, AI caches.
  - Firebase Storage: classroom uploads, speaking attempt recordings, teacher feedback audio.
  - LocalStorage: guest state, UI preferences, practice scope, SRS/vocab local queues, drafts, and difficulty caches.

## 10. Operational Safety Contracts

- Local dev refuses to start against production Firebase unless emulator env vars are present or `ALLOW_PROD_FIREBASE=1` is explicitly set.
- Admin access is enforced server-side; normal users must not access CRM/admin data.
- Client writes are restricted in `firestore.rules`; scoring, economy, purchases, speaking attempts, and sensitive CRM mutations are server-owned.
- Browser test plans in this workspace use Chrome and read credentials from `C:\Cursor AI\.local\browser-test-credentials.md` when login is required.

## 11. Verification Entry Points

- General lint: `npm run lint`
- CRM lint: `npm run lint:crm`
- CRM suite: `npm run verify:crm`
- Entrance test smoke: `npm run smoke:entrance-test`
- Pronunciation full verification: `npm run verify:pronounce`
- RFIB verification: `npm run verify:rfib`
- Difficulty tests: `npm run test:difficulty`
- Read Aloud route/browser/service tests: `npm run test:read-aloud:route`, `npm run test:read-aloud:browser`, `npm run test:read-aloud:connected-speech:service`
- Browser checks live under `tests/browser/`; CRM service/unit tests live under `tests/crm/`.

## 12. Related Docs

- Product guidelines: [product-guidelines](product-guidelines.md)
- IT/senior engineer handoff: [it-product-spec](it-product-spec.md)
- Feature specs index: [features README](features/README.md)
- Smart Difficulty UX V2: [smart-difficulty-ux-v2](smart-difficulty-ux-v2.md)
- New user workflow: [new-user-workflow](new-user-workflow.md)
- A2 onboarding audit: `docs/audits/2026-03-01-a2-vn-pte-onboarding/summary.md`
- CRM workflow audit: `docs/audits/2026-03-16-crm-full-workflow/summary.md`
