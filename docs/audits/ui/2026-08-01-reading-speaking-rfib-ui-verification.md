# Reading and Speaking RFIB UI Unification — Verification

**Date:** 2026-08-01  
**Scope:** Reading RFIB-derived controls for RFIB, DD, RMCMA, RMCSA, and ROP; the shared Speaking controller, picker, settings sheets, and adopted Speaking actions; Read Aloud mode-owned visible controls.  
**Browser scope:** Chrome/Chromium at 1440×1200, 768×1024, and 390×844.

## Outcome

The scoped UI implementation is complete in the working tree. Reading controls now share the RFIB visual language without changing their IDs or listeners. Speaking controllers, picker sheets, settings sheets, and adopted action buttons use the same semantic palette and geometry. Read Aloud keeps its native recording and playback lifecycle, including the native `#ra-user-recording-audio` element and hidden `#ra-play-recording-btn` lifecycle proxy.

No production deployment, hosting push, remote push, staging, or commit was performed. The implementation was carried out in the approved dirty checkout; unrelated working-tree changes were preserved.

## Implementation delivered

### Reading modes

- Added scoped Reading action tokens and recipes in `public/read-mode-base.css` for slate Back, purple Next, blue Play, green Check/Submit, amber Retry, and peach support/Easy Reading treatments.
- Applied 44px regular controls, 36px compact controls, RFIB radius, hover/active/disabled/focus-visible states, and reduced-motion behavior under the five Reading panels only.
- Restored the missing DD action controls with their original IDs and initial states: `dd-submit-btn`, `dd-retry-btn`, and `dd-next-question-btn`.
- Closed the malformed ROP Next button so the Random control is a sibling rather than a nested button.
- Removed the dead RFIB Random lookup without adding a placeholder control.
- Moved Speaking pagination ownership out of `read-aloud-question-picker-v7.css`; the V7 stylesheet now retains only Read Aloud selectors while shared `.spc-*` pagination is owned by `speaking-practice-controller.css`.
- Updated ROP reorder controls to remain compact and keyboard/focus accessible.

### Speaking controller and settings

- Added declarative `data-spc-action-role` recipes to the actual adopted action buttons.
- `adoptControls()` now records any pre-existing action-role metadata and `restoreControls()` restores or removes it with the existing level/scope cleanup.
- Settings nodes retain their original parent, next-sibling anchor, inline display state, and focusability across close, unmount, and remount. Restoration runs in reverse move order so outer containers are restored before descendants.
- Styled the shared controller, compact previous/next navigation, picker pill, picker sheet, search field, sheet close button, pagination, tabs, filters, adaptive controls, recommendation controls, and settings sections with one flat RFIB-derived surface treatment.
- Settings sections remain transparent and divider-based; no nested card or “box inside a box” treatment was introduced.
- Listening `type` remains excluded from new action-role styling.

### Read Aloud

- Styled the live visible mode-owned controls using stable IDs: `#ra-play-audio-btn`, `#ra-record-btn`, `#ra-stop-btn`, `#ra-check-btn`, `#ra-retry-btn`, and the conditional `#ra-next-btn` hook.
- The visible sample Play control is styled both in the mode panel and after its existing move into `#ra-settings-sheet`.
- The hidden `#ra-play-recording-btn` remains a lifecycle proxy and is not exposed or treated as a visible action.
- No new Read Aloud button or replacement playback proxy was introduced.

## Speaking action-role matrix

| Mode | Applied roles |
|---|---|
| ASQ | `asq-play-prompt-btn: play`; `asq-record-btn: record`; `asq-stop-btn: stop`; `asq-redo-btn: retry` |
| RTS | `play-rts-btn: play`; `rts-stop-btn: stop`; `rts-retry-btn: retry`; `rts-ai-score-btn: ai`; `rts-next-question-btn: next` |
| Describe Image | `play-di-btn: play`; `di-stop-btn: stop`; `di-retry-btn: retry`; `di-submit-btn: primary`; `di-results-retry-btn: retry`; `di-next-question-btn: next`; `di-ai-btn: ai` |
| Notes / Retell Lecture | `play-notes-btn: play`; `notes-submit-btn: primary`; `notes-retry-btn: retry`; `recommended-btn-notes: support` |
| SGD | `play-sgd-btn: play`; `sgd-record-btn: record`; `sgd-stop-btn: stop`; `sgd-submit-btn: primary`; `sgd-retry-btn: retry`; `recommended-btn-sgd: support` |
| Speak / Repeat Sentence | `play-btn-speak: play`; `record-btn: record`; `check-btn-speak: primary`; `retry-btn-speak: retry`; `shadow-mode-btn: support`; `recommended-btn-speak: support` |
| Type | No new action roles, by scope decision |

The planned `recommended-btn-di` support entry was not added because no such live DOM element exists; the no-placeholder contract was preserved.

## Automated verification

| Command | Result |
|---|---|
| `npm run audit:read-modes` | PASS — 949 declarations; no defeated media queries |
| `node tests/browser/reading-button-system-browser-check.js` | PASS — 45 required controls; no nested required buttons; style contract and 9 screenshots pass |
| `node tests/browser/dd-mode-browser-check.js` | PASS |
| `node tests/browser/rmcma-mode-browser-check.js` | PASS |
| `node tests/browser/rmcsa-mode-browser-check.js` | PASS |
| `node tests/browser/rop-mode-browser-check.js` | PASS |
| `node tests/browser/speaking-controller-browser-check.js` | PASS — 185 passed, 0 failed; 9 screenshots pass |
| `node tests/browser/all-modes-settings-check.js` | PASS — read-aloud, speak, type, asq, describe-image, notes, rts, and sgd |
| `npm run test:read-aloud:v7:browser` | PASS |
| `npm run test:read-aloud:lifecycle:browser` | PASS — 20 passed, 0 failed |
| `node tests/browser/read-aloud-check.js` | PASS — standalone Read Aloud smoke flow completed |
| `node tests/browser/practice-font-browser-check.js` | PASS |
| `npm run test:difficulty:browser` | PASS |
| `git diff --check` | PASS; only normal CRLF conversion warnings were emitted |

### Approved baseline failures

These failures reproduce independently of the scoped UI changes and were explicitly approved to remain untouched:

- `npm run verify:rfib` runs RFIB content and the RFIB browser check successfully, then fails in the existing aggregate `practice-modes-browser-check.js` contract because SGD currently has a difficulty-filter element while the test expects `difficulty: false`.
- `node tests/browser/practice-modes-browser-check.js` reproduces the same SGD assertion: `sgd mode should match its difficulty-filter contract`.
- The requested lint command reports two existing `no-empty` errors in `public/js/speaking-practice-controller.js` around the pre-existing guarded Read Aloud/generic settings initialization catches. Those lines were not introduced or changed by this UI work.

## Chrome screenshot matrix

All files below were generated by the passing Playwright Chrome checks and stored under `test-results/reading-speaking-rfib-ui/`.

### Reading — 1440×1200

- [RFIB default](../../../test-results/reading-speaking-rfib-ui/reading-rfib-default-desktop.png)
- [RFIB submitted](../../../test-results/reading-speaking-rfib-ui/reading-rfib-submitted-desktop.png)
- [DD](../../../test-results/reading-speaking-rfib-ui/reading-dd-desktop.png)
- [RMCMA](../../../test-results/reading-speaking-rfib-ui/reading-rmcma-desktop.png)
- [RMCSA](../../../test-results/reading-speaking-rfib-ui/reading-rmcsa-desktop.png)
- [ROP](../../../test-results/reading-speaking-rfib-ui/reading-rop-desktop.png)

### Reading — 768×1024 and 390×844

- [Reading controls tablet](../../../test-results/reading-speaking-rfib-ui/reading-controls-tablet.png)
- [Reading controls mobile](../../../test-results/reading-speaking-rfib-ui/reading-controls-mobile.png)
- [ROP mobile](../../../test-results/reading-speaking-rfib-ui/reading-rop-mobile.png)

### Speaking — 1440×1200

- [ASQ controller](../../../test-results/reading-speaking-rfib-ui/speaking-asq-desktop.png)
- [SGD controller](../../../test-results/reading-speaking-rfib-ui/speaking-sgd-desktop.png)
- [Read Aloud recorded state](../../../test-results/reading-speaking-rfib-ui/speaking-read-aloud-recorded-desktop.png)
- [Speaking settings sheet](../../../test-results/reading-speaking-rfib-ui/speaking-settings-desktop.png)

### Speaking — 768×1024 and 390×844

- [Speaking controller tablet](../../../test-results/reading-speaking-rfib-ui/speaking-controller-tablet.png)
- [Speaking settings tablet](../../../test-results/reading-speaking-rfib-ui/speaking-settings-tablet.png)
- [Speaking controller mobile](../../../test-results/reading-speaking-rfib-ui/speaking-controller-mobile.png)
- [Speaking picker mobile](../../../test-results/reading-speaking-rfib-ui/speaking-picker-mobile.png)
- [Speaking settings mobile](../../../test-results/reading-speaking-rfib-ui/speaking-settings-mobile.png)

Visual inspection of the generated images confirmed the settled settings/picker states, no controller-row horizontal overflow at 390px, no nested settings cards, and the intended Back/Next/Play/Check/Retry/support hierarchy. Normal guest-mode app chrome such as the privacy toast and Ask-me bubble remains visible in some captures.

## Browser-agent limitation

The local Playwright Chrome workflow was executed and its screenshots were inspected. The desktop tool context exposed Playwright MCP controls but did not expose a callable Antigravity/browser-agent session or its Chrome extension/allowlist state. Therefore the separate interactive browser-agent pass could not be run; this is recorded as an environment limitation, not a functional test failure.

## Working-tree and delivery notes

- The checkout contained unrelated user modifications before and during this work. No reset, checkout, stash, broad overwrite, or destructive cleanup was used.
- No files were staged and no commits were created, consistent with the approved dirty-checkout execution choice.
- No production deployment, hosting deployment, functions deployment, or remote push occurred.
