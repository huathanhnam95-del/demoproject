# AI Services Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> AI services support prompt generation and writing feedback. The system uses a mix of:
> - Node/Express proxy endpoints for LLM calls (with caching + rate limits)
> - Firebase callable functions for Gemini-based "AI Check"
> - Client-side fallbacks (LanguageTool) for grammar checks when AI is limited/unavailable

## 2. Goals (The "Why")

- Keep AI usage safe, rate-limited, and debuggable.
- Keep UX responsive (cache outputs; stream when possible).
- Provide graceful fallbacks so practice never hard-stops.

## 3. Requirements (The "What")

### Functional

- Non-streaming AI proxy endpoint for short prompt generations:
  - request: `{ prompt, model, max_tokens }`
  - response: `{ generated_text, fromCache? }`
- Streaming feedback endpoint for writing feedback (SSE).
- Cross-request caching for deterministic prompts.
- Rate limiting for all AI endpoints.
- Gemini-based grammar/style analysis callable function:
  - daily per-user limit
  - returns structured JSON corrections
  - signals fallback to LanguageTool when limited

### Non-Functional

- Never expose AI API keys to the client.
- Bound token limits and timeouts to avoid runaway requests.
- AI/provider/network failures must return structured fallback signals so the client can continue practice without hard-stop.
- Streaming endpoints must terminate cleanly on upstream failure (send terminal error payload, close stream, keep UI responsive).

## 4. Data & Contracts (The "Contract")

- Node/Express routes:
  - `POST /api/ai-proxy` in `src/routes/ai-proxy.js`
    - Uses Firestore collection `ai_cache` (hash-keyed) with 7-day TTL.
    - Cache key derives from `prompt + model + max_tokens` and is not user-scoped.
    - Error contract includes fallback metadata for client handling.
  - `POST /api/ai-feedback-stream` in `src/routes/ai-proxy.js` (SSE to Hugging Face router).
    - On stream errors, event payload includes `fallback: true`.
- Firebase callable function:
  - `assessWriting` in `functions/src/assessWriting.js`
    - Uses `gemini-1.5-flash`
    - Enforces a per-user daily quota (20/day)
    - Returns structured JSON, or `{ limited: true, fallback: true }`
- Client fallback:
  - LanguageTool public API is used when Gemini is limited/unavailable (`public/js/writing-challenge.js`).

## 5. Taste Invariants (The "How")

- Prefer small, structured outputs (JSON) over long free-form text for "check" workflows.
- Cache only when prompts are deterministic and safe to reuse across users.
- Ensure AI failures never break the core learning loop.

## 6. Verification

- Manual:
  - Run prompt generation twice with identical prompt -> verify `fromCache` becomes true.
  - Exceed daily `assessWriting` quota -> verify LanguageTool fallback is used.
  - Force AI endpoint failure (invalid key/upstream timeout) -> verify client receives fallback signal and flow continues with non-AI path.
  - Simulate offline/disconnected mode during AI check -> verify UI stays usable and user gets actionable retry/fallback messaging.
