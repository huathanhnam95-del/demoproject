# Home and About Page Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix the current Home and About Us page regressions so Home routes users into the practice demo, all intended media loads correctly, and browser verification reflects the intended shared-header contract.

**Architecture:** Keep the fix surface small and local to the static marketing pages and their browser smoke coverage. Repair broken relative paths first, then make the Home page explicitly consistent with the shared site-header system or adjust the smoke test to the final agreed contract, and finish with browser verification against the hosted static pages.

**Tech Stack:** Static HTML/CSS/JS, Playwright browser smoke tests, Node/npm scripts

---

**Path Convention**

- Marketing pages live under `public/landing/en/`, `public/landing/vi/`, and `public/about/`.
- Shared product header assets live in `public/js/site-header.js` and `public/site-header.css`.
- Browser smoke coverage for these pages lives in `tests/browser/`.

### Task 1: Lock the intended header contract

**Files:**
- Modify: `public/landing/en/index.html`
- Modify: `public/landing/vi/index.html`
- Reference: `public/about/index.html`
- Reference: `public/js/site-header.js`
- Reference: `public/site-header.css`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Write the failing/targeted browser expectation**

Update `tests/browser/site-header-about-check.js` so it clearly documents the intended contract for Home:
- If Home is supposed to use the shared injected header, keep the current `assertProductHeader(page, 'Home')`.
- If Home is intentionally using a custom marketing nav, replace the shared-header assertion with an explicit check for that custom nav and remove the metric-equality assumption.

Artifact: updated browser test file.

**Step 2: Run browser verification to confirm current failure mode**

Run: `npm run test:site-header:browser`

Expected now: FAIL on Home page header assertion or header metric mismatch, confirming the contract drift before implementation.

Artifact: failing test run output.

**Step 3: Implement the chosen Home header behavior**

Modify `public/landing/en/index.html` and `public/landing/vi/index.html` to match the contract from Step 1:
- Preferred option: include `/site-header.css` and `/js/site-header.js`, keep `data-site-section="home"`, and remove duplicated marketing-nav responsibilities that conflict with the shared header.
- If preserving the custom nav, make sure the browser test no longer expects the shared header on Home.

Artifact: updated Home page HTML files.

**Step 4: Run browser verification again**

Run: `npm run test:site-header:browser`

Expected: PASS with `Site header and About page verification complete.`

Artifact: passing test run output.

**Step 5: Commit**

Run:
```bash
git add public/landing/en/index.html public/landing/vi/index.html tests/browser/site-header-about-check.js
git commit -m "fix: align landing page header contract"
```

Artifact: commit.

### Task 2: Fix Home page CTA routing and broken image paths

**Files:**
- Modify: `public/landing/en/index.html`
- Modify: `public/landing/vi/index.html`
- Reference: `public/landing/index.html`
- Reference: `public/landing/assets/`

**Step 1: Write a focused regression check**

Extend `tests/browser/site-header-about-check.js` or create a new browser check at `tests/browser/landing-page-links-and-assets-check.js` that verifies:
- main Home CTAs navigate to `/index.html?demo=1`
- critical hero/demo images return non-broken `naturalWidth > 0`

Artifact: updated or new browser test file.

**Step 2: Run the new check to capture current failures**

Run either:
```bash
npm run test:site-header:browser
```
or, if a new script is added to `package.json`:
```bash
node tests/browser/landing-page-links-and-assets-check.js
```

Expected now: FAIL because `../index.html?demo=1` routes back through `/landing/index.html`, and images using `../../assets/...` do not exist.

Artifact: failing test run output.

**Step 3: Repair CTA hrefs**

In `public/landing/en/index.html` and `public/landing/vi/index.html`, change all demo CTAs to the same resolved path used by the working nav CTA:
- use `../../index.html?demo=1` from language landing pages

Artifact: updated landing page HTML files with corrected CTA links.

**Step 4: Repair asset references**

In `public/landing/en/index.html` and `public/landing/vi/index.html`, replace bad image paths that currently point outside `public/landing/assets/`:
- change `../../assets/...` references to `../assets/...` when the file exists in `public/landing/assets/`
- if an image name does not exist in `public/landing/assets/`, replace it with the closest existing asset or remove the reference cleanly

Artifact: updated landing page HTML files with valid asset paths.

**Step 5: Run browser verification again**

Run the same browser check from Step 2.

Expected: PASS, and the targeted CTAs open the practice demo while critical landing images render without fallback placeholders.

Artifact: passing test run output.

**Step 6: Commit**

Run:
```bash
git add public/landing/en/index.html public/landing/vi/index.html tests/browser/site-header-about-check.js tests/browser/landing-page-links-and-assets-check.js package.json
git commit -m "fix: repair landing page ctas and assets"
```

If no new test file or script entry was needed, omit those paths from `git add`.

Artifact: commit.

### Task 3: Fix social metadata and About/Home consistency details

**Files:**
- Modify: `public/landing/en/index.html`
- Modify: `public/landing/vi/index.html`
- Modify: `public/about/index.html`
- Reference: `public/landing/assets/`

**Step 1: Add or update a static assertion**

Create or extend a lightweight static test, for example `tests/preloader-static-content.test.mjs` replacement is not ideal; prefer a new file such as `tests/landing-meta-paths.test.mjs`, to assert:
- `og:image` points to a file that exists under `public/`
- About page primary links still resolve to `/index.html`, `/landing/en/`, and `/funding/`

Artifact: new or updated static test file.

**Step 2: Run the static test to confirm current failure**

Run:
```bash
node tests/landing-meta-paths.test.mjs
```

Expected now: FAIL because `public/landing/assets/og-image.png` does not exist while Home references it.

Artifact: failing test run output.

**Step 3: Fix metadata and any remaining inconsistent copy/path details**

Modify:
- `public/landing/en/index.html`
- `public/landing/vi/index.html`

Changes:
- point `og:image` to an existing asset such as `/landing/assets/screenshot-dashboard.png` or another real preview image
- add matching `twitter:image` if desired, using the same real asset
- preserve About page links unless execution finds a real broken target

Artifact: updated page HTML files.

**Step 4: Run the static test again**

Run:
```bash
node tests/landing-meta-paths.test.mjs
```

Expected: PASS.

Artifact: passing test run output.

**Step 5: Run final combined verification**

Run:
```bash
npm run test:site-header:browser
node tests/landing-meta-paths.test.mjs
```

Expected:
- browser smoke passes
- metadata/path test passes

Artifact: final verification output.

**Step 6: Commit**

Run:
```bash
git add public/landing/en/index.html public/landing/vi/index.html public/about/index.html tests/landing-meta-paths.test.mjs
git commit -m "fix: restore landing page metadata and verification"
```

Artifact: commit.

### Task 4: Final review and handoff

**Files:**
- Reference: `docs/plans/2026-03-16-home-about-page-fixes.md`
- Reference: `tmp/site-header-about-check.png`

**Step 1: Re-read the changed files for accidental regressions**

Review final diffs for:
- duplicate navs on Home
- broken relative paths
- test assumptions that no longer match product intent

Artifact: reviewed diff state.

**Step 2: Capture final evidence**

Preserve:
- browser screenshot from `tmp/site-header-about-check.png`
- final passing command outputs

Artifact: verification evidence set.

**Step 3: Commit final cleanup if needed**

Run:
```bash
git add -A
git commit -m "chore: finalize home and about page fixes"
```

Only do this if there is meaningful uncommitted cleanup after the prior commits.

Artifact: optional final commit.
