# Adaptive Difficulty Browser Retest Plan

## Objective

Revalidate the adaptive difficulty manager in the browser with enough evidence to support a real sign-off.

This retest plan is intentionally narrower and stricter than the previous broad walkthrough. It focuses on the gaps that still matter:
- incomplete evidence for Phases 1-3
- missing edge-case coverage
- under-specified cross-browser validation
- under-documented auth and persistence behavior

## What Is Needed For Credible Sign-Off

The retest is not complete unless all of the following are true:
- one fresh end-to-end retest run is documented in a single report
- the run names the exact browser, environment, and URL for every manual section
- Chrome desktop is used for the full manual pass
- Edge desktop is used for parity
- Firefox is used for smoke
- mobile emulation is explicitly checked
- storage corruption, migration, and reload timing edge cases are exercised
- auth transitions are demonstrated with guest and signed-in storage keys
- every failed or suspicious step includes console and localStorage evidence

## Scope

In scope:
- Adaptive/manual switching
- Organic profile preservation
- Question-difficulty browser override persistence
- Legacy key migration from `difficultyFilter_*` to `questionDifficulty_*`
- Invalid stored value self-healing
- Adaptive modal freshness
- CEFR to content-tier mapping
- Notes and Extended recommendation sync
- Guest/login/logout override isolation
- Cross-browser UI and persistence parity
- Multi-tab storage conflict behavior

Out of scope:
- General app smoke unrelated to adaptive difficulty
- Full visual QA for all practice modes
- Backend or Firebase auditing beyond what is needed to verify browser behavior

## Environment

Base URL:
- `https://localhost:8443`

Required runtime:
- local app server running
- browser-accessible HTTPS certificate already working
- Chrome or Chromium
- Edge
- Firefox

Auth-required checks:
- use the admin account from `C:\Cursor AI\.local\browser-test-credentials.md`

Do not use a static file server as the source of truth for this retest.

## Evidence Standard

For every manual scenario, capture:
- browser name and version
- exact URL
- guest or logged-in state
- screenshot or screen recording
- relevant `localStorage` keys before and after, when persistence is involved
- console errors if any appear

For every failure, also capture:
- whether it reproduces after hard refresh
- whether it reproduces in a second tab
- whether the issue is Chrome-only, Edge-only, Firefox-only, or all browsers

## Pre-Run Checklist

1. Start the local app and confirm `https://localhost:8443/api/health` returns `200`.
2. Confirm the current branch includes the adaptive-difficulty cleanup.
3. Open a clean Chrome profile or clear site storage for `https://localhost:8443`.
4. Prepare DevTools with:
   - Console
   - Network
   - Application > Local Storage
5. Keep one additional browser tab available for cross-tab storage tests.
6. Keep the admin credentials file available for the auth pass.

## Automated Baseline

Run these first. If any fail, stop manual QA and fix the failure before continuing.

1. Run the adaptive unit and storage suite.
   Command:

   ```powershell
   npm run test:difficulty
   ```

   Expected:
   - exit code `0`

2. Run the main adaptive browser state test.
   Command:

   ```powershell
   node tests/adaptive_browser_test.js
   ```

   Expected:
   - adaptive defaults on
   - Type starts uncalibrated
   - ten strong Type attempts promote the organic profile
   - manual mode changes effective level only
   - organic profile is restored when adaptive is re-enabled

3. Run adjacent recommendation regressions.
   Commands:

   ```powershell
   node tests/recommendation-notes-regression.test.js
   node tests/recommendation-extended-regression.test.js
   node tests/notes-smart-jump-regression.test.js
   node tests/smart-jump-race-regression.test.js
   ```

   Expected:
   - all exit `0`

4. Run the lightweight DOM/browser smoke.
   Command:

   ```powershell
   npm run test:difficulty:browser
   ```

   Expected:
   - adaptive modal exists
   - all expected tabs render
   - difficulty labels render as expected

## Manual Retest Matrix

### Scenario 1: Fresh Chrome Baseline

Purpose:
- Verify the current browser state starts clean and the core adaptive surfaces load.

Steps:
1. Open `https://localhost:8443/` in Chrome.
2. Clear site storage.
3. Hard refresh.
4. Open the main practice page.
5. Confirm the badge and adaptive modal can be opened.

Expected:
- no uncaught adaptive-related console errors
- `#difficulty-badge` is visible when appropriate
- `#adaptive-engine-modal` opens successfully
- question-difficulty controls are visible for supported modes

Artifacts:
- screenshot of initial state
- screenshot of adaptive modal

### Scenario 2: Adaptive to Manual to Adaptive Contract

Purpose:
- Revalidate the highest-risk contract: manual override must not destroy the organic profile.

Steps:
1. In Type mode, confirm a fresh user starts uncalibrated.
2. Perform or simulate enough strong attempts to promote Type once.
3. Record:
   - `window.DifficultyManager.getProfile('type')`
   - `window.DifficultyManager.getCurrentSettings('type')`
4. Switch to manual mode and choose level `4`.
5. Record the same two values again.
6. Perform several weak attempts while still in manual mode.
7. Re-enable adaptive mode.
8. Record the same two values a final time.

Expected:
- promotion occurs in adaptive mode
- manual mode changes effective settings
- the organic profile does not collapse in manual mode
- adaptive mode restores the preserved organic profile

Artifacts:
- screenshots of settings before manual mode, during manual mode, and after re-enabling adaptive
- console copies of the manager state snapshots

### Scenario 3: Question-Difficulty Override Persistence

Purpose:
- Prove browser override persistence works independently of engine difficulty.

Steps:
1. In Type mode, choose `Level 1`.
2. Verify the visible question pool changes.
3. Reload the page.
4. Confirm the same override is restored.
5. Switch to manual engine level `4`.
6. Confirm the browser override remains `Level 1`.

Expected:
- browser override persists through reload
- browser override remains independent from manual engine level

Artifacts:
- screenshot before reload
- screenshot after reload
- relevant `questionDifficulty_*` key value

### Scenario 4: Legacy Key Migration

Purpose:
- Verify old filter keys migrate forward and are removed.

Steps:
1. Remove `questionDifficulty_type_guest` from `localStorage`.
2. Set `difficultyFilter_type_guest = 2`.
3. Reload the page.
4. Inspect local storage.

Expected:
- UI restores `Level 2`
- `questionDifficulty_type_guest = 2`
- `difficultyFilter_type_guest` is deleted

Artifacts:
- before and after localStorage screenshots

### Scenario 5: Invalid Stored Value Self-Healing

Purpose:
- Verify corrupt browser-override values do not create false empty states.

Steps:
1. Set `questionDifficulty_notes_guest = bogus`.
2. Reload the page.
3. Open Notes mode.
4. Inspect the label, question list, and localStorage value.

Expected:
- Notes falls back to `Recommended`
- Notes does not render an empty state solely because of the invalid key
- stored value is normalized to `all`

Artifacts:
- screenshot of Notes after reload
- localStorage screenshot

### Scenario 6: Reload Timing Around Promotion

Purpose:
- Verify profile persistence is safe around threshold boundaries.

Steps:
1. Start from a clean or known baseline Type profile.
2. Perform nine strong attempts.
3. Reload.
4. Confirm no premature promotion occurred.
5. Perform the tenth strong attempt.
6. Confirm promotion occurs.
7. Reload immediately.
8. Confirm the promoted state remains.

Expected:
- no promotion before the threshold
- promotion at the expected threshold
- no loss of state after immediate reload

Artifacts:
- manager state snapshots before attempt 10, after attempt 10, and after reload

### Scenario 7: Reload Timing Around Demotion

Purpose:
- Mirror the promotion timing test for downward movement.

Steps:
1. Start from a calibrated Type profile.
2. Perform enough weak attempts to trigger a demotion.
3. Reload immediately after the demotion event.
4. Inspect the profile and effective settings.

Expected:
- demotion occurs only when the threshold is met
- demoted state survives immediate reload

Artifacts:
- manager state snapshots before demotion, after demotion, and after reload

### Scenario 8: Corrupt And Partial `difficulty_profile`

Purpose:
- Verify the browser recovers from bad adaptive state in storage.

Steps:
1. Set `difficulty_profile` to malformed JSON.
2. Reload.
3. Observe app startup behavior.
4. Replace it with a partial payload containing only one mode.
5. Reload again.
6. Inspect manager state for all modes.

Expected:
- app does not crash
- adaptive UI still renders
- missing modes are hydrated with defaults
- corrupt storage is healed or replaced with safe defaults

Artifacts:
- console output
- localStorage before and after
- screenshot of the adaptive modal

### Scenario 9: CEFR 4-6 Mapping To Content Tiers

Purpose:
- Verify higher engine levels still yield content instead of empty pools.

Steps:
1. Set manual level to `4`.
2. Check Type, Speak, Extended, and Notes question availability.
3. Repeat with manual level `5`.
4. Repeat with manual level `6`.

Expected:
- non-empty question pools remain available
- no mode incorrectly shows empty solely due to CEFR-to-tier mapping

Artifacts:
- screenshots for each mode at level `4` or higher

### Scenario 10: Manual Override Plus Browser Override Conflict

Purpose:
- Verify the UI stays explainable when engine level and browser level intentionally differ.

Steps:
1. Set engine manual level to `6`.
2. Set question-difficulty override for Type to `Level 1`.
3. Open the adaptive modal.
4. Inspect the current question list and visible labels.

Expected:
- engine state still reflects manual level `6`
- question browser shows `Level 1`
- UI does not imply the engine itself has dropped to `1`

Artifacts:
- screenshot of modal
- screenshot of question browser label

### Scenario 11: Auth Transition Isolation

Purpose:
- Verify guest and signed-in browser overrides remain isolated.

Steps:
1. As guest, set a non-default override in Extended mode.
2. Record the guest key.
3. Log in using `C:\Cursor AI\.local\browser-test-credentials.md`.
4. Confirm the user-scoped key is read or created without mutating the guest key.
5. Change the signed-in override.
6. Reload.
7. Log out.

Expected:
- guest and signed-in values remain separate
- guest value is restored after logout
- no mixed state appears in the UI

Artifacts:
- screenshots before login, after login, and after logout
- localStorage keys for guest and signed-in scopes

### Scenario 12: Recommendation And Media Sync

Purpose:
- Reconfirm the strongest happy-path flows while capturing better evidence than the prior report.

Steps:
1. In Extended mode, use the recommended button.
2. Confirm question id, dropdown selection, and audio source all update together.
3. In Notes mode, use the recommended button.
4. Start playback.
5. Confirm selected entry, displayed question, and media are aligned.
6. Reapply filters after the recommendation jump.

Expected:
- no stale selector/media mismatch
- no stale recommendation summary

Artifacts:
- one screenshot or recording for Extended
- one screenshot or recording for Notes

### Scenario 13: Multi-Tab Storage Race

Purpose:
- Verify localStorage writes do not leave the UI in a confusing stale state.

Steps:
1. Open the app in two Chrome tabs.
2. In tab A, set Type override to `Level 1`.
3. In tab B, set Type override to `Level 3`.
4. Reload tab A.
5. Reload tab B.
6. Compare labels and stored values.

Expected:
- last write wins in storage
- reloaded UI reflects the persisted value
- no broken or mixed label state remains after reload

Artifacts:
- screenshots from both tabs
- final localStorage value

### Scenario 14: Edge Desktop Parity

Purpose:
- Verify the same core flows behave identically in Edge.

Steps:
1. Repeat Scenarios 1, 2, 3, and 11 in Edge.

Expected:
- same behavior as Chrome
- no adaptive-specific UI regressions

Artifacts:
- one screenshot per scenario

### Scenario 15: Firefox Smoke

Purpose:
- Verify adaptive UI surfaces and persistence are not browser-specific.

Steps:
1. Open the app in Firefox.
2. Verify the badge, modal, and question-difficulty labels render.
3. Set a browser override and reload.
4. Open Notes and Extended.

Expected:
- adaptive UI surfaces render
- persistence survives reload
- no adaptive-specific console errors

Artifacts:
- screenshot of modal
- screenshot after reload

### Scenario 16: Mobile Emulation

Purpose:
- Verify the controls remain usable on a small viewport.

Steps:
1. In Chrome DevTools, switch to `375x667`.
2. Open the settings/badge flow.
3. Open the adaptive modal.
4. Open question-difficulty controls.
5. Trigger a recommended button if possible.

Expected:
- no clipping or overlap blocks use
- modal content remains readable
- controls are tappable

Artifacts:
- screenshot of settings modal
- screenshot of adaptive modal

## What I Think Is Actually Needed

Needed for sign-off:
- rerun the whole baseline on Chrome in one documented pass
- explicitly document Edge and Firefox instead of calling them “cross-browser” without names
- exercise the storage and reload edge cases because those are the most likely real regressions
- capture manager state and localStorage for threshold-sensitive cases
- separate “verified this run” from “verified previously”

Not strictly needed before sign-off:
- a full rewalk of every happy path in every practice mode
- exhaustive visual QA outside the adaptive surfaces
- backend tracing beyond what the browser and localStorage already prove

## Reporting Template

The final retest report should have these sections:
- Environment
- Browser versions
- Automated results
- Chrome manual results
- Edge results
- Firefox results
- Mobile results
- Edge-case results
- Failures and open questions
- Final sign-off decision

Do not mark the run as fully passed unless every required scenario above is either:
- passed in this run, or
- explicitly deferred with a reason and a sign-off owner
