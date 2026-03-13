# Public Site Header and About Us Page Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a shared public-site header with `Home`, `Practice`, and `About Us` navigation, and launch a grant-facing `About Us` page that explains BEL clearly to startup program reviewers.

**Architecture:** BEL is already a static multi-page frontend under `public/`, so the least fragile approach is a shared header injected by one small client-side script and styled by one shared stylesheet. The landing pages keep their existing section navigation for in-page scrolling, while the new product-level header sits above it; the practice shell and About page reuse the same shared header with page-specific active states.

**Tech Stack:** Static HTML/CSS/vanilla JS in `public/`, Playwright browser checks in `tests/browser/`, `http-server` for local static verification.

---

## Path Convention

- Shared cross-page assets live in `public/`.
- Landing-specific assets stay in `public/landing/`.
- New public marketing pages use folder routes like `public/about/index.html`.
- Browser checks for static pages live in `tests/browser/`.

### Task 1: Add a Failing Browser Check for Global Navigation

**Files:**
- Create: `tests/browser/site-header-about-check.js`
- Modify: `package.json`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Write the failing test**

Create `tests/browser/site-header-about-check.js` to verify all of the following:

- `http://127.0.0.1:4173/landing/en/index.html` renders a product header with `Home`, `Practice`, and `About Us`
- `http://127.0.0.1:4173/index.html` renders the same header and marks `Practice` as active
- `http://127.0.0.1:4173/about/index.html` exists, renders the same header, marks `About Us` as active, and includes grant-facing sections:
  - `Mission`
  - `Problem`
  - `What BEL Builds`
  - `Who We Serve`
  - `Why BEL Matters`
  - `Team and Execution`
- Mobile viewport does not clip or overlap the header on landing and About

Use the existing Playwright style from `tests/browser/preloader-browser-check.js`: launch Chromium, collect `pageerror` and console errors, visit each route, assert visible text and active link state, then save one screenshot to `tmp/site-header-about-check.png`.

**Step 2: Run test to verify it fails**

Run in terminal 1:

```bash
npx http-server public -p 4173 -c-1
```

Expected: server starts and prints an `Available on:` URL for `127.0.0.1:4173`.

Run in terminal 2:

```bash
node tests/browser/site-header-about-check.js
```

Expected: FAIL because `/about/index.html` does not exist yet and the shared header is missing from the practice shell.

**Step 3: Add a package script for the browser check**

Add a script entry to `package.json`:

```json
"test:site-header:browser": "node tests/browser/site-header-about-check.js"
```

**Step 4: Run the packaged test command**

Run:

```bash
npm run test:site-header:browser
```

Expected: FAIL with the same missing-header / missing-page assertions.

**Step 5: Commit**

```bash
git add package.json tests/browser/site-header-about-check.js
git commit -m "test: add public navigation browser check"
```

### Task 2: Build Shared Product Header Infrastructure

**Files:**
- Create: `public/site-header.css`
- Create: `public/js/site-header.js`
- Modify: `public/index.html`
- Modify: `public/landing/en/index.html`
- Modify: `public/landing/vi/index.html`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Write the shared header stylesheet**

Create `public/site-header.css` with:

- CSS variables for shared header height, surface, border, and active-link treatment
- A responsive `.site-header` layout with:
  - BEL brand/logo area
  - `Home`, `Practice`, `About Us` links
  - active-state styling using `[aria-current="page"]`
- Mobile behavior:
  - allow wrapping or horizontal compression without clipping
  - keep touch targets at least `44px`
- Landing-specific support classes so the existing `.nav` can remain visually distinct below the new header

**Step 2: Write the shared header injector**

Create `public/js/site-header.js` that:

- reads `document.body.dataset.siteSection` (`home`, `practice`, `about`)
- reads `document.body.dataset.siteLocale` (`en`, `vi`, default `en`)
- injects a header at the top of `<body>`
- uses fixed canonical links:
  - `Home` -> `/landing/en/`
  - `Practice` -> `/index.html`
  - `About Us` -> `/about/`
- sets `aria-current="page"` on the active link
- adds a body class like `has-site-header`

Use English labels for the first release. On the Vietnamese landing page, `About Us` should still point to the English About page because the grant-facing page is English-first in v1.

**Step 3: Mount the header on the practice shell**

Modify `public/index.html` to:

- add `data-site-section="practice"` to `<body>`
- include `site-header.css`
- load `js/site-header.js` early enough that layout shift stays minimal

Do not remove or rename any existing practice-mode controls.

**Step 4: Mount the header on both landing pages**

Modify `public/landing/en/index.html` and `public/landing/vi/index.html` to:

- add `data-site-section="home"`
- add `data-site-locale="en"` / `data-site-locale="vi"`
- include `/site-header.css`
- load `/js/site-header.js`

Keep the current landing page section nav (`.nav`) in place under the new product header.

**Step 5: Run the browser test**

Run:

```bash
npm run test:site-header:browser
```

Expected: still FAIL because the About page content has not been created yet, but landing and practice header assertions should now pass.

**Step 6: Commit**

```bash
git add public/site-header.css public/js/site-header.js public/index.html public/landing/en/index.html public/landing/vi/index.html
git commit -m "feat: add shared public site header"
```

### Task 3: Preserve Landing Navigation Behavior Under the New Header

**Files:**
- Modify: `public/landing/landing.js`
- Modify: `public/landing/landing.css`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Update smooth-scroll offset logic**

Modify `public/landing/landing.js` so anchor navigation subtracts the combined visible height of:

- the new product header (`.site-header`)
- the existing landing section nav (`#nav`)

Do not keep the old single-nav assumption:

```js
const navHeight = document.querySelector('.nav')?.offsetHeight || 0;
```

Replace it with a helper that sums both elements when present.

**Step 2: Update landing layout spacing**

Modify `public/landing/landing.css` to ensure:

- hero content does not sit under the new shared header
- the existing landing nav still feels native, not cramped
- mobile spacing remains stable with two stacked navigation layers

Prefer a CSS custom property for total top offset so layout and JS use the same mental model.

**Step 3: Verify landing interactions**

Run:

```bash
npm run test:site-header:browser
```

Expected: landing page nav and mobile header assertions pass; only About page assertions should still be pending if content is not done yet.

**Step 4: Commit**

```bash
git add public/landing/landing.js public/landing/landing.css
git commit -m "fix: preserve landing anchor navigation with shared header"
```

### Task 4: Create the Grant-Facing About Us Page

**Files:**
- Create: `public/about/index.html`
- Create: `public/about/about.css`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Write the failing content outline into the page shell**

Create `public/about/index.html` with:

- standard meta tags
- page title like `About BEL | Better English Learning`
- `body data-site-section="about"`
- links to `/site-header.css`, `about.css`, and `/js/site-header.js`
- semantic sections with stable IDs:
  - `#about-hero`
  - `#mission`
  - `#problem`
  - `#product`
  - `#audience`
  - `#impact`
  - `#team`

Before final copy polish, make the headings exist so the browser test can lock onto them.

**Step 2: Write the page copy**

Fill the About page with grant-ready content grounded in `docs/grants/2026-03-elevenlabs-startup-grant-fact-sheet.md` and `docs/specs/product.md`.

Use this content structure:

```text
Hero:
BEL is an AI-assisted English learning platform built to move learners from passive study to active language production.

Mission:
Help learners practice English in a way that is structured, adaptive, and motivating enough to sustain daily use.

Problem:
Most learners consume English passively. They do not get enough speaking, typing, recall, and pronunciation feedback, and teachers cannot scale high-quality guided practice manually.

What BEL Builds:
BEL combines practice modes (Type, Speak, Fill, Watch, Notes, Pronounce, Writing, Survival), pronunciation feedback, adaptive difficulty, vocabulary review, and spaced repetition in one product.

Who We Serve:
Primary wedge: output-focused English learners, especially test-driven learners such as PTE users.
Expansion path: tutors, teachers, and classroom operations.

Why BEL Matters:
BEL is not generic AI content generation; it is a live product focused on retention, production, and feedback loops. The voice/content layer can expand into narration, read-along lessons, podcast-style learning, and richer listening experiences.

Team and Execution:
Educator-led, execution-oriented team; live product; rapid release cadence; tutor network already around the product.
```

Content rules:

- do not invent traction metrics
- keep tone credible, direct, and partner-friendly
- use concrete product proof instead of startup hype
- mention the live product and active development, but avoid unsupported revenue / user-count claims

**Step 3: Style the About page**

Create `public/about/about.css` to give the page a polished public-facing layout:

- clear hero and section rhythm
- readable long-form copy blocks
- proof cards or stat blocks for:
  - live product
  - learner-first design
  - adaptive feedback
  - educator-led execution
- responsive layout matching BEL’s existing design language without copying the landing page 1:1

**Step 4: Run the browser check**

Run:

```bash
npm run test:site-header:browser
```

Expected: PASS, with one screenshot written to `tmp/site-header-about-check.png` and no browser console errors.

**Step 5: Commit**

```bash
git add public/about/index.html public/about/about.css
git commit -m "feat: add grant-facing about page"
```

### Task 5: Final Verification and Manual Smoke Check

**Files:**
- Modify: `package.json`
- Test: `tests/browser/site-header-about-check.js`

**Step 1: Run final automated verification**

With the static server running, execute:

```bash
npm run test:site-header:browser
```

Expected: PASS.

**Step 2: Run manual smoke verification**

Check these routes in a browser:

- `/landing/en/`
- `/landing/vi/`
- `/index.html`
- `/about/`

Confirm:

- shared header appears on all four routes
- `Home`, `Practice`, and `About Us` navigate correctly
- landing section links still scroll to the right section
- mobile layout does not overlap the hero or first section
- About page reads like a credible startup-program overview, not generic marketing filler

**Step 3: Optional package script cleanup**

If needed, add a second helper script for serving static files locally:

```json
"serve:public": "http-server public -p 4173 -c-1"
```

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add site header verification commands"
```

## Notes for the Implementer

- There are unrelated local changes in the repo already; do not revert them.
- Keep the new header isolated from practice-mode internals. The practice app is large and should only receive minimal shell-level changes.
- Do not route `Practice` to `?demo=1`; the request is for the current main practice page, so use `/index.html`.
- Keep the first About page English-first because the stated audience is grant reviewers. Vietnamese localization can be a follow-up task after this launch.
