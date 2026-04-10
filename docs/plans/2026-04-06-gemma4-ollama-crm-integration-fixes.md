# Gemma4 (Ollama) CRM Integration Fixes (Admin + Teacher Scheduler)

Date: 2026-04-06

## Summary

This plan fixes and hardens the CRM Admin integration with a local Ollama-served Gemma4 model:

- **Student profile:** “AI Profile Snapshot” generates a 3-sentence summary as strict JSON and renders safely.
- **Teacher scheduler:** Voice dictation drafts a “Class Note” and optionally sets an allowed session outcome.
- **Reliability:** Adds request timeouts, handles aborts correctly, and avoids stale UI updates from in-flight requests.

## Environment Verification (Local)

Validated on the same machine hosting the CRM Admin UI:

- `ollama` installed at `C:\Users\Admin\AppData\Local\Programs\Ollama\ollama.exe`
- Ollama API responding: `GET http://localhost:11434/api/version` → `0.20.2`
- Gemma model installed: `gemma4:latest` present in `GET http://localhost:11434/api/tags`
- CORS allows admin origin: `Access-Control-Allow-Origin: https://localhost:8443`

## Key Changes

### 1) Local Ollama JSON helper

Add/maintain `fetchGemmaJSON(prompt, opts)` in `public/crm-admin.js`:

- Calls `POST http://localhost:11434/api/generate` with:
  - `model`: defaults to `gemma4:latest`
  - `stream: false`
  - `format: "json"`
- Robust JSON parsing from `data.response`:
  - strict JSON parse
  - JSON fenced blocks (```json)
  - first `{` … last `}` fallback
- Supports:
  - timeout (`opts.timeoutMs` or `opts.timeout`)
  - external abort (`opts.signal`)
- Distinguishes:
  - **Abort** (`AbortError`) vs **Timeout** (`TimeoutError`)
- Debug: exposed as `window.fetchGemmaJSON`

Optional overrides (for debugging only):

- `localStorage["crm:ollama_base_url"]` (default `http://localhost:11434`)
- `localStorage["crm:ollama_model"]` (default `gemma4:latest`)

### 2) Student “AI Profile Snapshot”

In `public/crm-admin.js`:

- Uses `fetchGemmaJSON()` with an `AbortController` to cancel prior clicks.
- Prevents stale UI updates by only applying results if the request is still current.
- Truncates long fields (e.g., counseling notes) before building the prompt.
- Renders output with `escapeHtml()` (no untrusted `innerHTML` from model content).

### 3) Teacher Scheduler: Voice-to-Note

In `public/crm-admin.html`:

- Adds missing UI elements inside the session bubble:
  - `textarea#teacher-scheduler-session-note`
  - `button#btn-teacher-scheduler-voice-note`
  - `small#teacher-scheduler-voice-status` (`aria-live="polite"`)

In `public/crm-admin.js`:

- Caches the new elements and injects `fetchGemmaJSON` into `TeacherSchedulerWorkspace.createController()`.

In `public/js/crm/teacher-scheduler-workspace.js`:

- Hides the voice button if required deps are missing.
- Uses the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) when available.
- Prompts the model to return strict JSON:
  - `{"note":"...","outcome":"completed|absent_counted|absent_makeup|none"}`
- Outcome rules are aligned with backend validation (no `cancelled` outcome via outcome API).
- Stops recognition when the session bubble closes to avoid “recording while hidden”.

## Test Plan (Chrome Only)

1. **Ollama sanity**
   - `ollama --version`
   - `ollama list` (confirm `gemma4:latest`)
   - `curl http://localhost:11434/api/version`
2. **Student summary**
   - Open `https://localhost:8443/crm-admin.html`
   - Login with admin account in `C:\Cursor AI\.local\browser-test-credentials.md`
   - Open a student profile → click “Generate with Gemma 4”
   - Verify summary renders and no HTML is injected.
3. **Teacher voice note**
   - Navigate to Teacher Scheduler → open a session bubble
   - Dictate → verify status “Listening…” then “Processing…”
   - Verify note populated and outcome set only to allowed values (or left as “No outcome”)
   - Save outcome → refresh → verify persistence
4. **Failure modes**
   - Stop Ollama → verify UI shows a clear error and dictation transcript is still preserved in the note field.
5. **Repo checks**
   - `npm run lint:crm`
   - `npm run verify:crm`

## Assumptions

- CRM Admin is used on the same machine that runs Ollama (`http://localhost:11434`).
- This is a local/desktop productivity feature; prompts and results are not sent to third-party LLM services.

