# Reading Journey Spec

**Status**: Prototype (hidden route, disabled by default)
**Owner**: Admin

## 1. Overview

Reading Journey is a story-driven reading practice mode. Users provide a few interest keywords, then read a short interactive story in 50–60 word segments. After each segment, users choose what happens next (multiple choice) and write a short response (1–2 sentences) to practice comprehension + production. The story runs for a maximum of 5 user turns.

Access is intentionally hidden: users can only enter by visiting `/readingjourney`. There is no UI button/card/link that navigates to this mode.

## 2. Goals (The "Why")

- Provide an engaging way to practice reading comprehension via short narrative segments.
- Require active language production (short open-ended response each turn).
- Personalize the theme using user interests while controlling drift via a locked 5-beat outline.
- Reduce LLM cost via cross-user caching keyed on canonical topic tags + choice path.

## 3. Requirements (The "What")

### Functional

- **Hidden entry**: Only accessible by visiting `/readingjourney` directly.
- **Setup**:
  - User enters up to 8 comma-separated keywords.
  - User selects CEFR level: A2, B1, B2, or C1.
- **Story loop** (max 5 turns):
  - Each turn shows:
    - 50–60 word story segment
    - recap sentence
    - 3-option plot choice (steers plot)
    - 1 open-ended prompt (“summarize + explain your choice”)
  - Backend enforces max turn count and ends at beat 5 with a 20–30 word wrap-up.
- **Caching**:
  - Cache outline + beat outputs.
  - Never cache raw user free-text.
- **Assessment**:
  - Provide a backend-only endpoint to assess a full story text (used by simulation).

### Non-Functional

- **Hidden in production**:
  - Backend endpoints return 404 unless `READING_JOURNEY_ENABLED=true`.
  - Frontend redirects to `/` if health check fails or is disabled.
- **Safety**:
  - Classroom-safe, PG content; avoid real celebrities/politicians/brands as characters.
- **Privacy**:
  - No raw user free-text stored in shared caches.
  - Avoid logging prompts/responses containing user input.
- **Cost control**:
  - Gemini-only via backend, with caching (Firestore when available; fallback to in-memory).

### Environment (local)

- `READING_JOURNEY_ENABLED=true` (required)
- `READING_JOURNEY_ALLOW_REMOTE=true` (optional; default local-only)
- `READING_JOURNEY_GEMINI_MODEL=gemini-3.1-pro-preview` (optional; defaults to `gemini-3.1-pro-preview`)
- `READING_JOURNEY_CACHE_TTL_DAYS=30` (optional)
- `READING_JOURNEY_DISABLE_RATE_LIMIT=true` (optional; local-only bypass for simulation tooling)

## 4. Data & Contracts (The "Contract")

### Backend (Node/Express)

- Health: `GET /api/reading-journey/health`
- Setup: `POST /api/reading-journey/setup`
- Advance: `POST /api/reading-journey/advance`
- Suggest keywords: `POST /api/reading-journey/suggest-keywords`
- Assess story: `POST /api/reading-journey/assess-story`

### Cache collections (Firestore, if available)

- `reading_journey_keyword_tags_v1` (hashed keywords → topic tags)
- `reading_journey_outlines_v1` (outline key hash → outline)
- `reading_journey_beats_v1` (beat key hash → beat response)

### Frontend (vanilla JS)

- Route-only UI container: `#readingjourney-root` in `public/index.html`
- Client controller: `public/js/reading-journey.js`

## 5. Verification

- Manual:
  - With feature disabled, `/readingjourney` redirects to `/`.
  - With feature enabled locally, `/readingjourney` runs a 5-turn story successfully.
  - No UI element on `/` links to Reading Journey.
- Automated:
  - `node tests/reading-journey-cache-keys.test.js`
  - `node tests/reading-journey-json-parse.test.js`
  - `node scripts/smoke-reading-journey.js` (setup + 4 advances; asserts response shape and word counts)
