# Reading Journey Spec

**Status**: Prototype (hidden route, disabled by default)
**Owner**: Admin

## 1. Overview

Reading Journey is a story-driven reading practice mode. Users provide a few interest keywords, then read a short interactive story in 50-60 word segments. After each segment, users choose what happens next or write a short response to practice comprehension and production. The current local prototype uses 3 interactive beats, 1 ending beat, and an optional post-story formative quiz.

Access is intentionally hidden: users can only enter by visiting `/readingjourney`. There is no UI button, card, or link that navigates to this mode.

## 2. Goals (The "Why")

- Provide an engaging way to practice reading comprehension via short narrative segments.
- Require active language production through short open-ended responses.
- Personalize the theme using user interests while controlling drift via a locked outline and cached beat path.
- Reduce LLM cost via cross-user caching keyed on canonical topic tags and choice path.
- Add a retention-focused post-story quiz grounded in the actual completed story path.

## 3. Requirements (The "What")

### Functional

- **Hidden entry**: Only accessible by visiting `/readingjourney` directly.
- **Setup**:
  - User enters up to 8 comma-separated keywords.
  - User selects CEFR level: A2, B1, B2, or C1.
- **Story loop** (current prototype: 3 interactive beats + 1 ending beat):
  - Each turn shows:
    - 50-60 word story segment
    - recap sentence
    - either a 3-option plot choice or a short open-ended prompt
  - Backend enforces the current beat structure and ends with a short wrap-up beat.
- **Caching**:
  - Cache outline and beat outputs.
  - Never cache raw user free-text.
- **Assessment**:
  - Provide a backend-only endpoint to assess a full story text for simulation and audits.
  - Provide `POST /api/reading-journey/quiz` to reconstruct the completed story from cache and return a normalized quiz deck.

### Non-Functional

- **Hidden in production**:
  - Backend endpoints return `404` unless `READING_JOURNEY_ENABLED=true`.
  - Frontend redirects to `/` if health check fails or the feature is disabled.
- **Safety**:
  - Classroom-safe, PG content.
  - Avoid real celebrities, politicians, and brands as characters.
- **Privacy**:
  - No raw user free-text stored in shared caches.
  - Avoid logging prompts or responses containing user input.
- **Cost control**:
  - Gemini-only via backend, with caching when available.

### Environment (local)

- `READING_JOURNEY_ENABLED=true`
- `READING_JOURNEY_ALLOW_REMOTE=true` for non-local access when needed
- `READING_JOURNEY_GEMINI_MODEL=gemini-3.1-pro-preview`
- `READING_JOURNEY_CACHE_TTL_DAYS=30`
- `READING_JOURNEY_DISABLE_RATE_LIMIT=true` for local simulation tooling only

## 4. Data & Contracts (The "Contract")

### Backend (Node/Express)

- Health: `GET /api/reading-journey/health`
- Setup: `POST /api/reading-journey/setup`
- Advance: `POST /api/reading-journey/advance`
- Suggest keywords: `POST /api/reading-journey/suggest-keywords`
- Assess story: `POST /api/reading-journey/assess-story`
- Quiz: `POST /api/reading-journey/quiz`

### Cache collections

- `reading_journey_keyword_tags_v1`
- `reading_journey_outlines_v1`
- `reading_journey_beats_v1`

### Frontend (vanilla JS)

- Route-only UI container: `#readingjourney-root` in `public/index.html`
- Client controller: `public/js/reading-journey.js`
- Assessment view helpers: `public/js/reading-journey-assessment.js`

## 5. Verification

- Manual:
  - With feature disabled, `/readingjourney` redirects to `/`.
  - With feature enabled locally, `/readingjourney` runs the full story-to-quiz flow successfully.
  - No UI element on `/` links to Reading Journey.
- Automated:
  - `node tests/reading-journey-cache-keys.test.js`
  - `node tests/reading-journey-json-parse.test.js`
  - `node tests/browser/reading-journey-quiz-browser-check.js`
  - `node tests/reading-journey-quiz-regenerated-corpus.test.js`
  - `node scripts/smoke-reading-journey.js --start-server --port 8787`

## 6. Promotion Gate

Reading Journey remains a hidden prototype until the assessment path is validated. The current post-story quiz is formative, not exam-secure, so client-side grading is acceptable only while the feature stays behind the hidden route.

Do not promote this work into `functions/src/` or public navigation until:

- browser test passes for the completion-to-quiz flow
- smoke test passes for story generation and `POST /api/reading-journey/quiz`
- no critical accessibility blockers remain
- review queue survives reload and keeps its missed-item schedule
- generated decks stay valid across the supported CEFR bands
- regenerated-corpus fixtures stay grounded after story regeneration
