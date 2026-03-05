# Reading Journey Implementation (2026-03-05)

**Goal:** Implement a hidden, link-only interactive Reading Journey at `/readingjourney` with Gemini-backed story generation, caching, and a post-implementation ≥50 story simulation + assessment.

## Scope (Shipped in this change)

- Backend endpoints under `/api/reading-journey/*` (feature-flagged, disabled by default).
- Firestore-backed caching (with in-memory fallback).
- Frontend UI rendered only on `/readingjourney` route.
- Simulation tooling to generate ≥50 stories and assess quality.

## Key constraints

- No UI entry point anywhere else in the product.
- Hidden from production unless explicitly enabled.
- Gemini-only for generation + assessment (no OpenAI/HF for this feature).
- Never cache raw user free-text.

## Deliverables checklist

- Spec: `docs/specs/features/reading-journey.md`
- Backend:
  - `src/routes/reading-journey.js`
  - `src/services/reading-journey/*`
  - `server.js` route registration
- Frontend:
  - `public/index.html` adds `#readingjourney-root`
  - `public/js/reading-journey.js`
  - `public/style.css` styles
- Tests:
  - `tests/reading-journey-cache-keys.test.js`
  - `tests/reading-journey-json-parse.test.js`
- Simulation:
  - `scripts/data/2025-topics.json`
  - `scripts/simulate-reading-journey-50.js`
  - `scripts/smoke-reading-journey.js`
  - Audit output under `docs/audits/reading-journey-sim/2026-03-05/`

## Enable locally

Set environment variables (do not commit secrets):

- `READING_JOURNEY_ENABLED=true`
- `GEMINI_API_KEY=...` (already expected by existing Gemini features)

Optional (advanced):

- `READING_JOURNEY_ALLOW_REMOTE=true` (off by default; local-only otherwise)
- `READING_JOURNEY_DISABLE_RATE_LIMIT=true` (local-only bypass for simulation tooling)
- `READING_JOURNEY_GEMINI_MODEL=gemini-3.1-pro-preview` (optional; defaults to `gemini-3.1-pro-preview`)
- `READING_JOURNEY_CACHE_TTL_DAYS=30`

Then run `npm start` (or `node server.js`) and visit `/readingjourney`.

## Verification

- Smoke: `node scripts/smoke-reading-journey.js --start-server --port 8787`
- Simulation (writes audit artifacts): `node scripts/simulate-reading-journey-50.js --count 50`
