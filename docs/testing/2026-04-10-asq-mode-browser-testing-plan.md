# ASQ (Quiz / Answer Short Question) Browser Testing Plan (Chrome Only)

Date: 2026-04-10  
Mode key: `asq`  
English label: `Quiz`  
PTE label: `Answer Short Question`

This plan validates the new ASQ mode end-to-end in the browser, including:
- Practice launcher visibility gating via `public/database/quiz/ASQ/audio/manifest.json`
- Scope label overrides (English vs PTE)
- Audio playback UX
- Browser-native STT (Web Speech `SpeechRecognition`)
- Server-authoritative scoring submit via `submitAttempt` (when logged in)

Notes:
- ASQ uses browser-native “normal STT” (Web Speech) and must not call Azure STT.
- For any future work that adds STT elsewhere, decide explicitly per feature whether to use Azure or “normal mid-performing STT”.

## Prerequisites
- Start app + emulators: `npm run dev`
- Open app: `https://localhost:8443`
- If any browser checks require login, use `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline credentials in docs or commits).

## Test Data / Gating Setup
ASQ should remain hidden until the audio manifest exists.

### Baseline (manifest missing)
- Ensure the file is absent:
  - `public/database/quiz/ASQ/audio/manifest.json` does not exist
- Expected:
  - The ASQ card is not visible in the launcher (English or PTE).

### “Audio ready” (manifest present)
Create:
- `public/database/quiz/ASQ/audio/manifest.json`
- At least one referenced audio file under `public/database/quiz/ASQ/audio/`

Recommended minimal manifest format:
```json
{
  "1": "1.mp3",
  "2": "2.mp3"
}
```

Expected:
- The ASQ card becomes visible after reload.
- Random selection prefers IDs that have an audio entry.

## Pass A: Playwright (webapp-testing workflow, Chrome-only)
Goal: catch regressions in launcher/scope wiring and ASQ UI rendering, without depending on real mic/STT.

### A1. Existing regression checks (fast smoke)
Run:
- `node tests/browser/practice-modes-browser-check.js`
- `node tests/browser/practice-scope-toggle-browser-check.js`

Expected:
- No “corrupted text marker” failures for `public/index.html` or `public/script.js`
- Speaking skill selected by default
- RFIB label and tutorial affordance behavior matches suite expectations

### A2. ASQ visibility gating (recommended new Playwright check)
Create a new browser check script (recommended name):
- `tests/browser/asq-mode-browser-check.js`

Script behaviors:
1. Load `https://localhost:8443/index.html` and dismiss preloader.
2. Intercept `HEAD /database/quiz/ASQ/audio/manifest.json`:
   - Case 1: return 404 and assert `#mode-btn-asq` is hidden.
   - Case 2: return 200 and assert `#mode-btn-asq` becomes visible after `renderPracticeLauncher()` runs (or on reload).
3. Intercept `GET /database/quiz/ASQ/ASQ.xlsx` with the real file (no stub) so dropdown populates.
4. Stub Web Speech STT:
   - `page.addInitScript` defines `window.SpeechRecognition` with a fake implementation that triggers `onresult` with a chosen transcript.
5. Enter ASQ mode and simulate:
   - Correct transcript: `source` for the river-start question
   - Incorrect transcript: `mountain`
6. Assert the result panel updates:
   - Transcript shows the mocked text
   - Correctness badge changes accordingly

Optional (auth + server scoring):
7. If you want to validate scoring + XP display:
   - Follow the login pattern in `tests/browser/practice-scope-logged-in-browser-check.js`
   - After ASQ submit, assert `window.handleDualTrackScoring('asq', ...)` returns a success payload and XP changes are reflected.

## Pass B: Manual Chrome (real mic + real STT)
Goal: validate the true user experience with actual `SpeechRecognition` and microphone permissions.

### B1. Launcher + scope labels
1. Open `https://localhost:8443`
2. Toggle scope:
   - English: label should display as `Quiz`
   - PTE: label should display as `Answer Short Question`
3. With manifest missing: confirm ASQ is not visible.
4. Add manifest + at least one MP3 and refresh: confirm ASQ is visible.

### B2. Audio playback
1. Open ASQ.
2. Click `Play`:
   - Audio starts, button toggles to `Pause`, then returns to `Play` on end.
3. Switch dropdown to a different ID:
   - Audio source changes and reloads.

### B3. Recording + STT
1. Click `Record answer`, grant mic permissions.
2. Speak a short answer that matches an accepted alias, e.g. `source`.
3. Click `Stop`.
4. Expected:
   - “Your recording” audio preview appears
   - Transcript is shown in results
   - Status becomes `Correct` when transcript contains any accepted alias as a whole word/phrase

Repeat with an incorrect answer and confirm `Incorrect`.

### B4. Logged-in scoring (emulators)
1. Login using the admin account documented in `C:\Cursor AI\.local\browser-test-credentials.md`.
2. Do one ASQ correct attempt.
3. Expected:
   - Attempt is recorded through `submitAttempt` as mode `asq`
   - Listening + Speaking points increase (small amount due to ASQ dampener)
   - Repeat same question multiple times: anti-farm rules reduce XP/rating impact.

## Debug Checklist (Common Failures)
- STT does not start:
  - Confirm Chrome is used (Web Speech STT is Chrome-only in most environments).
  - Confirm page is served over HTTPS (`https://localhost:8443`).
  - Confirm mic permission is granted for localhost.
- Transcript is empty:
  - Speak after clicking record; keep the answer short (1 to 3 words).
  - Try again and avoid background audio.
- ASQ never appears:
  - Verify `public/database/quiz/ASQ/audio/manifest.json` exists or the Playwright interceptor returns 200 for the `HEAD` request.
- “Correct” differs between local vs server:
  - UI should follow server `accuracy` when the scoring call succeeds.

