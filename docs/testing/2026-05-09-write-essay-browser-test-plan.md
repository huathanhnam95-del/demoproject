# Write Essay Browser Test Plan (Chrome Only)

Date: 2026-05-09
Feature area: Write Essay

This plan verifies the essay workflow in Chrome end-to-end:
- Basic submit shows the submitted essay plus detailed feedback only
- No numeric score appears on the free submit path
- "Submit to AI scoring" is visible after submit and is login-gated
- Logged-in AI scoring returns the full rubric breakdown from Gemini
- BEL Assistant receives the teacher-style coaching message after AI scoring
- The Sample Essays panel still renders and behaves correctly

## Prerequisites

- Start the app and supporting services with the normal local dev setup.
- Open the app in Chrome at `https://localhost:8443`.
- If a step requires login, use the admin credentials from `C:\Cursor AI\.local\browser-test-credentials.md`.
- Keep the plan Chrome-only; do not add Firefox or WebKit coverage.

## Test Data

- Prepare one essay in the 200-300 word range so the form check passes.
- Use a prompt that already has sample essays available, so the Sample Essays panel can be verified.

## Automated Checks

### 1) Existing essay smoke check

- Command:
  - `node tests/browser/write-essay-samples-browser-check.js`
- Expected:
  - Passes.
  - Confirms the essay mode loads, a prompt can be selected, and Sample Essays still render.
  - Confirms basic submit shows the submitted essay and the AI scoring control is present.

### 2) Recommended follow-up check for the new AI flow

Create a dedicated browser check, recommended name:
- `tests/browser/write-essay-feedback-and-ai-scoring-browser-check.js`

This check should cover both guest and logged-in behavior.

Suggested assertions:
1. Enter Write Essay mode and submit a 200-300 word essay.
2. Verify a `Submitted essay` block appears with the prompt, word count, and formatted essay text.
3. Verify free submit does not render any numeric score summary.
4. Verify the `#essay-ai-score-btn` button appears after submit.
5. Verify the Sample Essays panel still renders for the selected prompt.
6. Guest mode:
   - Button is disabled.
   - Inline login hint is visible.
   - The login CTA calls `showLoginForm()`.
7. Logged-in mode:
   - Button is enabled.
   - Clicking it calls the scoring function and renders the full rubric breakdown.
   - The result includes all seven criteria from the rubric.
   - The overall total and percent are displayed.
   - BEL Assistant opens and receives the teacher advice text.

Recommended stubs for the check:
- Stub Gemini or the callable response so the browser test stays deterministic.
- Keep the LanguageTool path deterministic if the check exercises feedback details.

## Manual Chrome Pass

### 1) Basic submit

1. Open Write Essay mode.
2. Choose a prompt with sample essays.
3. Enter a 200-300 word essay.
4. Click `Submit Essay`.
5. Expected:
   - The submitted essay is shown on the page.
   - Word count is shown.
   - Form / Grammar / Spelling feedback appears.
   - No numeric score widget appears.
   - The Sample Essays panel is still available.

### 2) Guest AI scoring gate

1. Stay logged out.
2. Click `Submit to AI scoring`.
3. Expected:
   - The button is disabled.
   - A login hint is visible.
   - The login action opens the login form.

### 3) Logged-in AI scoring

1. Log in with the admin credentials from `C:\Cursor AI\.local\browser-test-credentials.md`.
2. Submit the same essay again.
3. Click `Submit to AI scoring`.
4. Expected:
   - The results title switches to a scores view.
   - The overall score and percentage are visible.
   - All rubric criteria render with scores, rationale, evidence, and fix tips.
   - BEL Assistant opens with the teacher-style coaching message.

### 4) Sample Essays regression

1. Switch sample level or variant.
2. Expected:
   - The selected sample re-renders.
   - The essay text, idea flow, and vocabulary sections still work.

## Debug Checklist

- Submitted essay does not appear:
  - Confirm `Submit Essay` was used, not the AI scoring button.
  - Confirm the essay text is long enough to pass the form check.
- Numeric scores appear after free submit:
  - The basic submit path should remain feedback-only.
  - The numeric score summary should only appear after AI scoring succeeds.
- AI scoring is disabled unexpectedly:
  - Check guest mode state and login status.
  - Confirm the login CTA invokes `showLoginForm()`.
- BEL Assistant does not open:
  - Confirm the scoring response completed successfully first.
  - Confirm the page can access the chat bubble element before posting advice.
- Sample Essays disappear:
  - Verify the selected prompt still has sample essay data in the database.

