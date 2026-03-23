# Read Aloud Browser Testing Plan

This document is a handoff-ready browser testing plan for the Read Aloud mode stabilization work.

## Purpose

Use this plan to verify that Read Aloud is safe to ship as a browser-only web mode, and to make it clear exactly **where** to test:

- Primary feature validation: `feature/reading-journey-thumbnails`
- Baseline comparison: `origin/main`
- Final release validation: the exact merge commit or staging build that will be deployed

## Branches And Environments

### 1. Primary Test Branch

Test the full Read Aloud feature on:

```text
feature/reading-journey-thumbnails
```

Reason:

- This is the current working branch containing the Read Aloud changes.
- This is the only branch where the feature should be expected to exist during pre-merge testing.

### 2. Baseline Comparison Branch

Use this branch only for comparison of shared pages and general UI behavior:

```text
origin/main
```

Important:

- Use `origin/main`, not local `main`, because local `main` is currently behind `origin/main` in this repository state.
- Do **not** expect Read Aloud to exist here.
- Use this branch only to compare shared homepage/about behavior and confirm that any regressions are feature-branch-specific.

### 3. Final Release Candidate

After merge, repeat the most important checks on:

- the exact merge commit on `main`, or
- the staging deployment generated from that exact commit

If no staging environment exists, create a clean worktree from the final commit and test there.

## Browser Matrix

Run this matrix on `feature/reading-journey-thumbnails`:

### Supported-Browser Matrix

- Chrome latest stable, desktop
- Edge latest stable, desktop

These two browsers are the primary supported-browser validation targets for the full mic-based Read Aloud flow.

### Unsupported / Partial-Support Matrix

- Firefox latest stable, desktop

Use Firefox to verify the unsupported-browser behavior:

- Read Aloud stays visible
- Prompt loads
- Unsupported-browser guidance appears
- Record button stays disabled

### Responsive Layout Matrix

- Chrome DevTools mobile emulation

Use mobile emulation for layout and interaction checks only. Do not treat emulated mic behavior as production evidence.

Optional, if available:

- Safari latest desktop on macOS

Treat Safari as an additional partial-support or unsupported-browser check depending on observed behavior.

## Local Test Setup

Run the app from the branch under test with the repo server:

```powershell
node server.js
```

Use the resulting local URL, for example:

```text
http://127.0.0.1:<PORT>/
```

If you need a clean comparison run, create a separate worktree for `origin/main` and run the same server flow there.

## Automated Preflight Checks

Run these commands on `feature/reading-journey-thumbnails` before manual browser QA:

```powershell
node tests/read-aloud-mode-regression.test.js
node tests/browser/site-header-about-check.js
npx eslint public/read-aloud-mode.js public/script.js public/tutorial.js --quiet
```

Expected result:

- all commands exit `0`
- no browser regression failures
- no lint errors in the touched frontend files

## Manual Test Plan On `feature/reading-journey-thumbnails`

### A. Chrome Desktop Full Flow

- [ ] Hard refresh the homepage.
- [ ] Confirm `database/RA/RA.xlsx` is **not** requested before entering Read Aloud.
- [ ] Click the Read Aloud card.
- [ ] Confirm the Read Aloud tab becomes active.
- [ ] Confirm the Read Aloud panel is visible.
- [ ] Confirm the first prompt loads on first entry.
- [ ] Let prep time run naturally once.
- [ ] Use `Skip Prep` once.
- [ ] Grant microphone access if prompted.
- [ ] Read the prompt aloud.
- [ ] Confirm the status text updates live with `Hearing: ...` while speaking.
- [ ] Finish recording.
- [ ] Confirm accuracy renders.
- [ ] Confirm transcript feedback renders.
- [ ] Click `Next Prompt`.
- [ ] Confirm the mode resets cleanly without duplicate actions or double-advance behavior.
- [ ] Switch to another mode mid-session and back.
- [ ] Confirm timers and recording do not leak across mode changes.
- [ ] Click `What's this?`
- [ ] Confirm the Read Aloud tutorial opens and does not fall back to the Type tutorial.

### B. Edge Desktop Full Flow

Repeat the Chrome full flow in Edge.

Pass condition:

- behavior matches Chrome closely
- no mode-entry failure
- mic flow works
- results and next-prompt reset work

### C. Firefox Unsupported-Browser Flow

- [ ] Open the feature branch build in Firefox.
- [ ] Enter Read Aloud mode.
- [ ] Confirm the prompt still loads.
- [ ] Confirm the unsupported-browser message is shown.
- [ ] Confirm the record button is disabled.
- [ ] Confirm the mode does not silently start a recording flow.

### D. Mobile Layout Pass

Use Chrome DevTools mobile emulation.

- [ ] Confirm the Read Aloud card is visible on the homepage.
- [ ] Confirm the card is tappable.
- [ ] Confirm the Read Aloud tab is visible and usable.
- [ ] Confirm the panel content fits the viewport.
- [ ] Confirm timer boxes do not overlap.
- [ ] Confirm the result area remains readable.
- [ ] Confirm the tutorial overlay remains usable in a narrow viewport.

## Baseline Comparison On `origin/main`

Run a lighter comparison pass here.

### Shared Page Comparison Only

- [ ] Open the homepage.
- [ ] Open the About page.
- [ ] Confirm shared navigation and major sections render correctly.
- [ ] Compare against the feature branch for any unrelated regressions in shared homepage/about behavior.

Important:

- Do **not** fail baseline because Read Aloud is absent on `origin/main`.
- The purpose of baseline is to isolate shared-page regressions, not to verify the new feature.

## Final Release Candidate Validation

Once the feature is merged, repeat this minimum set on the exact commit being shipped:

- [ ] Chrome desktop full flow
- [ ] Firefox unsupported-browser flow
- [ ] Mobile layout pass
- [ ] Homepage/About browser smoke

If using staging:

- run the same checks on staging URLs, not just localhost

## Pass / Fail Criteria

The feature is ready for sign-off only if all are true:

- Read Aloud is reachable from both the homepage card and the tab
- `RA.xlsx` is not fetched before mode entry
- Chrome full flow passes
- Edge full flow passes
- Firefox unsupported-browser behavior passes
- Mobile layout checks pass
- Homepage/About smoke passes
- Post-merge candidate reproduces the expected behavior

## Notes For The Testing Agent

- Treat `feature/reading-journey-thumbnails` as the source of truth for the feature.
- Treat `origin/main` as a comparison control only.
- If a failure is found, capture:
  - browser name and version
  - branch under test
  - exact URL
  - screenshot
  - console errors, if any
  - whether the issue reproduces on both Chrome and Edge or only one browser
