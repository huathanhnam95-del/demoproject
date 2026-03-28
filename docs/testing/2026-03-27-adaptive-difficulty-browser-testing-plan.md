# Adaptive Difficulty Browser Testing Plan

## Summary

This plan covers browser validation for the adaptive difficulty manager and the adjacent flows changed with it: question-difficulty browser overrides, adaptive/manual switching, adaptive modal correctness, Notes/Extended recommendation sync, and persistence across guest/auth transitions.

The plan has three layers:

1. Automated browser preflight on the local HTTPS app.
2. Manual browser QA on Chrome and Edge, with smoke on Firefox and mobile emulation.
3. Edge-case validation for corrupted storage, migrated keys, reload timing, zero-result states, and cross-tab behavior.

Primary sign-off rule:

- the adaptive engine must be correct
- the UI must not mislead the user
- persisted browser override state must self-heal
- recommendation and playback flows must stay in sync

## Public Interfaces And Contracts Under Test

- `window.DifficultyManager.setAutoAdjustEnabled(enabled)`
- `window.DifficultyManager.setManualLevel(level)`
- `window.DifficultyManager.getCurrentSettings(mode)`
- `window.DifficultyManager.getProfile(mode)`
- `window.DifficultyManager.getGlobalSettings()`
- `window.DifficultyManager.getContentTier(mode)`
- `window.DifficultyFilter.selectDifficulty(mode, value)`
- `window.DifficultyFilter.reloadSavedDifficulty(mode)`
- `localStorage['difficulty_profile']`
- `localStorage['questionDifficulty_<mode>_<userId>']`
- migration from `difficultyFilter_<mode>_<userId>`
- browser selectors already present in the app:
  - `#adaptive-engine-modal`
  - `#difficulty-badge`
  - `#difficulty-filter-label-type`
  - `#difficulty-filter-label-speak`
  - `#difficulty-filter-label-extended`
  - `#difficulty-filter-label-notes`
  - `#recommended-btn-type`
  - `#recommended-btn-speak`
  - `#recommended-btn-extended`
  - `#recommended-btn-notes`

## Environments And Browser Matrix

### Environment

- Primary environment: local HTTPS app at `https://localhost:8443/`
- Start command if needed: `node server.js`
- Readiness check: `https://localhost:8443/api/health` returns `200`
- Do not use the static `http.server` flow as the main source of truth for adaptive testing
- Use the admin credentials from `C:\Cursor AI\.local\browser-test-credentials.md` for auth-required checks

### Browser Matrix

- Chrome latest stable, desktop
- Edge latest stable, desktop
- Firefox latest stable, desktop smoke
- Chrome DevTools mobile emulation
- WebKit or Safari smoke if available

## Step-By-Step Execution Order

### Phase 1: Automated Preflight

1. Confirm the HTTPS app is running on `8443`.
   Expected: `/api/health` returns `200`.

2. Run the adaptive unit and storage preflight.
   Command: `npm run test:difficulty`
   Expected: exit `0`.

3. Run the main adaptive stateful browser flow.
   Command: `node tests/adaptive_browser_test.js`
   Expected:
   - adaptive defaults on
   - uncalibrated state is detected
   - ten strong attempts promote organic Type to level `2`
   - manual level `4` changes effective level only
   - organic profile remains `2` in manual mode
   - re-enabling adaptive restores the organic profile
   - untouched Speak remains isolated

4. Run adjacent browser regressions.
   Commands:
   - `node tests/recommendation-notes-regression.test.js`
   - `node tests/recommendation-extended-regression.test.js`
   - `node tests/notes-smart-jump-regression.test.js`
   - `node tests/smart-jump-race-regression.test.js`
   Expected: all exit `0`.

5. Run the lightweight adaptive DOM smoke.
   Command: `npm run test:difficulty:browser`
   Expected:
   - adaptive modal exists
   - five mode tabs exist
   - difficulty labels show `Recommended`
   - Notes and Extended browser-override controls stay visible

### Phase 2: Manual Chrome Desktop Validation

1. Open `https://localhost:8443/` in a clean Chrome profile.
2. Clear `localStorage` for the site.
3. Hard refresh.
   Expected:
   - no uncaught console errors
   - adaptive badge is visible
   - question-difficulty labels start at `Recommended`

4. Open the adaptive settings/badge flow.
   Expected:
   - settings open successfully
   - no stale per-mode difficulty toggle confusion
   - adaptive/manual controls are understandable

5. Open the Adaptive Engine modal.
   Expected:
   - tabs for `type`, `speak`, `extended`, `notes`, `srs`
   - current state matches live engine data, not stale storage

6. In Type mode, verify a fresh user is uncalibrated.
   Expected:
   - no premature filtering to a single tier
   - question list is available

7. Perform or simulate ten strong Type attempts.
   Expected:
   - organic Type profile becomes calibrated
   - adaptive level advances from `1` to `2`
   - modal and badge reflect the new state

8. Switch to manual mode and choose level `4`.
   Expected:
   - effective level becomes `4`
   - organic profile remains whatever adaptive had reached
   - question-difficulty browser override still works independently

9. Perform several weak attempts in manual mode.
   Expected:
   - effective level stays `4`
   - organic profile does not collapse
   - no misleading “demotion” UI

10. Re-enable adaptive mode.
    Expected:
    - effective level returns to the preserved organic profile
    - no reset or destructive loss of history

### Phase 3: Browser Override And Persistence

1. In Type mode, choose `Level 1`.
   Expected:
   - label changes to `Level 1 (Easy)`
   - visible question pool narrows accordingly

2. Reload the page.
   Expected:
   - `questionDifficulty_type_guest` persists
   - the same override is restored

3. Remove `questionDifficulty_type_guest` and manually create `difficultyFilter_type_guest=2` in DevTools.
4. Reload.
   Expected:
   - UI restores `Level 2`
   - legacy key is deleted
   - new key is written as `questionDifficulty_type_guest=2`

5. Set `questionDifficulty_notes_guest=bogus`.
6. Reload.
   Expected:
   - Notes falls back to `Recommended`
   - stored value is normalized to `all`
   - Notes does not show a false empty state

### Phase 4: Recommendation And Sync Flows

1. In Extended mode, confirm the recommended button is enabled when a better question exists.
2. Click the recommended button.
   Expected:
   - current question id updates
   - dropdown selection updates
   - audio source updates to the same target item

3. In Notes mode, click the recommended button, then start playback.
   Expected:
   - selected entry, displayed current id, and audio source all align
   - practice area remains coherent

4. Reapply filters after a recommendation jump.
   Expected:
   - selection remains stable
   - recommendation summary remains coherent
   - no stale question/audio mismatch

### Phase 5: Auth Transition Validation

1. As guest, choose a non-default question-difficulty browser override.
2. Log in with the admin account from `C:\Cursor AI\.local\browser-test-credentials.md`.
   Expected:
   - the app reads the user-scoped `questionDifficulty_*` key
   - guest value does not leak into the signed-in profile unless intentionally absent

3. Change the override while signed in.
4. Reload.
   Expected:
   - signed-in value persists

5. Log out.
   Expected:
   - guest-scoped value returns
   - no mixed guest/user override state

### Phase 6: Cross-Browser Validation

1. Repeat Phase 2 and Phase 3 smoke checks in Edge.
   Expected: same behavior as Chrome.

2. In Firefox, run a lighter pass:
   - adaptive badge visible
   - modal opens
   - five tabs render
   - question-difficulty labels render
   - persistence survives reload
   Expected: no adaptive-specific UI failure.

3. In Chrome mobile emulation, verify:
   - badge is tappable
   - settings modal fits viewport
   - difficulty dropdowns open and close correctly
   - recommendation buttons are usable
   Expected: no clipping, overlap, or unusable controls.

## Edge Cases That Must Be Explicitly Tested

- Corrupt `difficulty_profile` JSON
- Partial `difficulty_profile` with only one mode populated
- One calibrated mode plus one untouched mode
- Reload between attempt `9` and `10`
- Reload immediately after a promotion or demotion event
- Manual override plus explicit browser override conflict
- CEFR `4-6` mapping still yielding valid content pools
- Zero visible questions after an override or mapping mismatch
- Guest session becoming authenticated mid-flow
- Authenticated session logging out mid-flow
- Two tabs open with different overrides writing to `localStorage`
- Slow hydration where adaptive UI appears after initial page load
- Browser console/network errors during adaptive modal render
- Audio autoplay or delayed media load affecting Notes smart-jump verification

## Failure Capture Requirements

For every failure, capture:

- browser and version
- exact URL
- guest or logged-in state
- screenshot
- console errors
- relevant network failures
- `difficulty_profile` value
- `questionDifficulty_*` and any `difficultyFilter_*` keys
- whether the issue reproduces after hard refresh
- whether it reproduces in a second tab

## Pass Criteria

The feature passes browser validation only if:

- all automated adaptive browser commands pass
- Chrome desktop manual validation passes end-to-end
- Edge matches Chrome on adaptive/manual and persistence behavior
- Firefox smoke shows no adaptive UI failure
- bad and legacy browser-override storage values self-heal
- auth transitions correctly swap guest and user-scoped override state
- recommendation buttons keep selector, current item, and media state synchronized
- no uncaught console errors remain tied to adaptive difficulty or adjacent flows

## Assumptions And Defaults

- The authoritative browser environment is the real HTTPS app on `https://localhost:8443/`
- Chrome is the primary validation browser
- Edge is a required parity browser
- Firefox is smoke-only unless failures appear
- Guest-first testing is the default baseline
- Auth checks are required because browser override state is user-scoped
- Existing browser tests are the starting point, but this plan treats them as preflight, not as the full sign-off by themselves
