# Essay AI Browser Testing Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `browser-agent` after the Playwright pass for live Chrome confirmation and artifacts.

**Goal:** Verify the learner Essay AI queue flow and the CRM dashboard workflow for previewing and manually scoring all unscored essays.

**Architecture:** Run the repository's deterministic Playwright checks first, using local route/API mocks to prove request and DOM contracts. Then run an authenticated Chrome walkthrough against the local HTTPS app and Firebase emulators, exercising the rendered CRM dashboard and capturing screenshots plus console evidence. Never use a production URL or production Firebase project.

**Tech Stack:** Chrome/Chromium, Playwright, Node test scripts, local HTTPS server (`https://localhost:8443`), Firebase Auth/Firestore emulators, existing CRM dashboard controller.

---

## Safety and prerequisites

- Work from `C:\Cursor AI`.
- Use Chrome only; do not add Firefox, WebKit, or mobile coverage.
- Read login details only from `C:\Cursor AI\.local\browser-test-credentials.md`; never copy the username or password into a script, screenshot, report, or commit.
- The authenticated walkthrough must use `https://localhost:8443` with local Firebase emulators. Stop if the URL is not localhost or if the app is connected to production Firebase.
- Confirm the Chrome extension is available and the browser allowlist contains `localhost` and `127.0.0.1` before using the browser-agent path.
- Do not click the CRM trigger against a production or shared environment. The local emulator is safe for the enqueue action.

## Task 1: Run deterministic Playwright smoke checks

**Files/artifacts:** Existing scripts `tests/browser/essay-ai-queue-browser-check.js` and `tests/browser/crm-essay-ai-trigger-browser-check.js`; terminal output captured in the test report.

1. From `C:\Cursor AI`, run:

   ```powershell
   npm run test:essay-ai:browser
   ```

2. Expected output:

   ```text
   essay-ai queue browser check passed
   crm essay-ai trigger browser check passed
   ```

3. If either script fails, stop the plan and record the failing selector, URL, page error, and stack trace. Do not proceed to live browser confirmation until the deterministic check is fixed or explicitly waived.

## Task 2: Verify the learner queue flow in Chrome

**Starting URL:** `http://127.0.0.1:<temporary-test-port>/index.html` served by the existing Playwright harness, or the local app URL if the agent is reproducing it manually.

**Actions and expected results:**

1. Open the essay practice mode and wait for the question selector and essay controls to render.
2. Start an essay, enter a sufficiently long response, and submit it.
3. Wait for the results panel to become visible.
4. Click `#essay-ai-score-btn` / the visible AI scoring button.
5. Verify the status reads `Queued for local AI scoring` (or the equivalent rendered queued state).
6. Inspect the captured callable request and verify:
   - callable name is `submitEssayDeepAi`;
   - payload contains exactly `{ attemptId }`;
   - essay text, prompt text, score, and client-owned fields are not sent in the callable payload.
7. Check the browser console and page-error stream; expected result is zero page errors.
8. Capture a screenshot of the results panel showing the queued state.

**Failure cases to record:** unauthenticated/login hint, missing attempt ID, wrong callable name, client text in payload, button not disabling while queued, or any console error.

## Task 3: Start the local authenticated CRM environment

**Artifact:** Terminal output proving local services are ready.

1. Start the local Firebase emulators and HTTPS app using the repository workflow:

   ```powershell
   .\start-emulators.bat
   ```

2. Confirm these local endpoints are used:

   - App: `https://localhost:8443`
   - Firestore emulator: `localhost:8080`
   - Auth emulator: `localhost:9099`
   - Functions emulator: `localhost:5001`

3. If the local admin account is not present, seed only the emulator admin data with the repository's emulator seed workflow. Do not seed or modify production data.

## Task 4: Verify CRM dashboard readiness and preview lifecycle

**Starting URL:** `https://localhost:8443/crm-admin.html`.

**Actions and expected results:**

1. Sign in using the admin account documented in `C:\Cursor AI\.local\browser-test-credentials.md`.
2. Navigate to the Dashboard panel and wait for network idle plus the Essay AI card to render.
3. Confirm the card heading is `Essay AI scoring` and the two controls are visible:
   - `Preview unscored` (`#btn-essay-ai-preview`)
   - `Score all unscored` (`#btn-essay-ai-trigger`)
4. Before worker readiness is confirmed, verify both controls are disabled and the live status text explains that the worker is unavailable/checking.
5. Once the status reports a ready worker, click `Preview unscored` once.
6. Verify the preview button is disabled while the request is pending and the status changes through the polling state.
7. Wait for a completed preview. Verify the status includes an unscored candidate count and invalid count (for example, `N unscored essays - M invalid`).
8. Verify `Score all unscored` remains disabled until the preview completes, then becomes enabled.
9. Capture a screenshot of the completed preview state and save the browser console log.

## Task 5: Verify the manual "Score all unscored" trigger

**Starting state:** The completed preview state from Task 4, still on `https://localhost:8443/crm-admin.html`.

**Actions and expected results:**

1. Click `Score all unscored` once.
2. Verify the button disables immediately and remains disabled while the enqueue request is pending/processing.
3. Verify the request is sent to `/api/admin/essay-ai/trigger` and includes the completed preview job ID plus a fresh request ID.
4. Verify the status changes to a queued/processing state and then reflects the terminal result (`N queued`, completed, or a clear failure message).
5. Verify the preview job ID is not lost during polling and the trigger cannot be submitted twice by double-clicking.
6. Capture a screenshot showing the queued/processing or completed trigger state.
7. Check console output; expected result is no uncaught page error.

## Task 6: Verify lifecycle cleanup and failure recovery

**Artifact:** Screenshot or console evidence for each exercised state.

1. Return to another CRM panel, then return to Dashboard. Verify the Essay AI controller reactivates without duplicate listeners or duplicate status requests.
2. Refresh the dashboard once. Verify the controls return to the correct readiness state and no stale polling timer updates the detached page.
3. In a local-only mocked request or emulator state, make the preview request fail. Verify the preview button becomes usable again and the status shows a readable error.
4. Set the worker heartbeat to stale/unhealthy in the emulator fixture, reload Dashboard, and verify both Essay AI controls are disabled.
5. Restore a healthy worker fixture and verify the controls become available again after status polling.
6. Verify the status element is exposed as an accessible live region and the controls are keyboard reachable by Tab/Enter.

## Task 7: Browser-agent confirmation and handoff

**Prerequisite status to announce before starting:**

```text
Chrome extension: [installed / NOT installed] | Allowlist: [domain confirmed / domain NOT listed]
```

After Tasks 1-6 pass, use the browser-agent workflow with precise steps from Tasks 4-5. The agent must produce:

- one screenshot of the CRM preview-completed state;
- one screenshot of the manual-trigger queued/processing or completed state;
- console output showing no uncaught page errors;
- the observed URL and whether it remained localhost;
- the final status text and candidate/enqueued counts.

If the browser agent cannot reach an expected state, take a screenshot of the actual state, report the discrepancy, and stop. Do not silently retry or claim success.

## Completion criteria

The plan is complete only when:

- `npm run test:essay-ai:browser` passes;
- the authenticated CRM walkthrough verifies preview and manual trigger behavior on localhost with emulators;
- learner queue payload and queued UI state are verified;
- lifecycle, readiness, failure recovery, and keyboard accessibility checks pass;
- screenshots and console evidence are attached or saved;
- no production URL, production Firebase project, or production scoring run was used.
