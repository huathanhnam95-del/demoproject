# Journal

## 2026-03-05 - Verify Reading Journey Vertex AI migration

- Evidence (smoke test, cache-miss): ran `node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Result: `✅ Reading Journey smoke passed.`
- Evidence (primary model works; fallback not used): ran `READING_JOURNEY_GEMINI_FALLBACK_MODEL=definitely-not-a-model node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Output included: `Reading Journey model: {"model":"gemini-2.5-pro","effectiveModel":"gemini-2.5-pro","fallbackModel":"definitely-not-a-model"}`
  - Result: `✅ Reading Journey smoke passed.`

- Fixes required to make Vertex work in this project:
  - Granted Vertex permission to the service account used by `GOOGLE_APPLICATION_CREDENTIALS`:
    - `gcloud projects add-iam-policy-binding listening-tasks-3ae34 --member="serviceAccount:firebase-adminsdk-fbsvc@listening-tasks-3ae34.iam.gserviceaccount.com" --role="roles/aiplatform.user" --condition=None`
  - Updated default Vertex model names (project does not expose `gemini-1.5-*` publisher models; `gemini-3*` models returned 404 via the Vertex SDK in this project, so defaulted to `gemini-2.5-pro`).
  - Fixed Vertex SDK response parsing (`response.text()` is not present in `@google-cloud/vertexai` responses).

## 2026-03-05 - Switch audits to Vertex (no AI Studio key required)

- Evidence (RFIB cohesion audit, Vertex, 1-row dry run): ran `node scripts/audit/run-rfib-cohesion-audit.js --input "C:\\Cursor AI\\public\\database\\RFIB\\RFIB Final ver.cohesion_audit.20260305_105054.xlsx" --dry-run --limit 1 --provider vertex --no-resume --print-first 1`
  - Output included: `Provider: vertex`, `Model: gemini-2.5-pro`, `verdict=PASS`

- Evidence (Reading Journey sim runner no longer requires `GEMINI_API_KEY`): ran `node scripts/simulate-reading-journey-50.js --count 1 --port 8796 --output-root docs/audits/reading-journey-sim/2026-03-05/quick-check3`
  - Output included: `✅ Wrote:` with run/summary/README artifacts.

## 2026-03-05 - Reading Journey provider priority: AI Studio -> Vertex

- Evidence (AI Studio pro primary; smoke): ran `node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Output included: `Reading Journey model: {"model":"ai-studio:models/gemini-3.1-pro-preview",...}`
  - Result: `✅ Reading Journey smoke passed.`

- Evidence (Vertex Gemini 3.x not usable via SDK in this project): direct `@google-cloud/vertexai` call with `model=gemini-3.1-pro-preview` returned `404 Not Found` for the publisher model.

