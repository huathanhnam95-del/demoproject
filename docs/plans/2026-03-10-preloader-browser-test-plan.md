# Preloader Browser Test Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Build a repeatable browser-based verification workflow for the BEL preloader that captures standard, reduced-motion, and lower-capability rendering behavior with screenshots and browser logs.

**Architecture:** Use Playwright as the browser driver and `http-server` as the local static host for `public/`. Keep the browser test code separate from the pure unit tests so the workflow can verify rendered DOM state, preloader visibility timing, CSS classes, console errors, and screenshot artifacts without coupling to the Three.js scene internals.

**Tech Stack:** Node.js, Playwright, `http-server`, existing preloader modules in `public/js/`

---

### Task 1: Create a reusable browser test script for the standard preloader path

**Files:**
- Create: `tests/browser/preloader-browser-check.js`
- Verify: `public/index.html`
- Verify: `public/js/preloader-3d.js`

**Step 1: Write the failing test**

Create `tests/browser/preloader-browser-check.js` that:
- launches Chromium with Playwright
- opens `http://127.0.0.1:4173/index.html`
- captures console/page errors
- waits long enough to inspect the live preloader before dismissal
- asserts the preloader is rendered and saves a screenshot to `tmp/preloader-browser-standard.png`

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  const errors = [];

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://127.0.0.1:4173/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const display = await page.locator('#app-preloader').evaluate((el) => getComputedStyle(el).display);
  if (display !== 'block') {
    throw new Error(`Expected preloader display=block, got ${display}`);
  }
  if (errors.length) {
    throw new Error(`Browser errors: ${errors.join(' | ')}`);
  }

  await page.screenshot({ path: 'tmp/preloader-browser-standard.png' });
  await browser.close();
})();
```

**Step 2: Run test to verify it fails**

Run: `node tests/browser/preloader-browser-check.js`
Expected: FAIL with `ERR_CONNECTION_REFUSED` because no local server is running yet.

**Step 3: Write minimal implementation**

Keep the Playwright script minimal and focused on:
- loading the page
- capturing errors
- asserting live preloader visibility
- saving a screenshot artifact

**Step 4: Run test to verify it passes**

Run: `.\node_modules\.bin\http-server.cmd public -p 4173`

Then in a separate shell:

Run: `node tests/browser/preloader-browser-check.js`
Expected: PASS and create `tmp/preloader-browser-standard.png`

**Step 5: Commit**

```bash
git add tests/browser/preloader-browser-check.js tmp/preloader-browser-standard.png
git commit -m "test: add standard browser preloader check"
```

### Task 2: Add reduced-motion browser coverage

**Files:**
- Modify: `tests/browser/preloader-browser-check.js`
- Verify: `public/style.css`
- Verify: `public/js/preloader-3d.js`

**Step 1: Write the failing test**

Extend the browser script to support a `--reduced-motion` flag that:
- calls `page.emulateMedia({ reducedMotion: 'reduce' })`
- asserts `#app-preloader` includes the `reduced-motion` class
- saves `tmp/preloader-browser-reduced-motion.png`

```javascript
const reducedMotion = process.argv.includes('--reduced-motion');
if (reducedMotion) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

const hasReducedMotionClass = await page.locator('#app-preloader')
  .evaluate((el) => el.classList.contains('reduced-motion'));

if (reducedMotion && !hasReducedMotionClass) {
  throw new Error('Expected reduced-motion class on preloader');
}
```

**Step 2: Run test to verify it fails**

Run: `node tests/browser/preloader-browser-check.js --reduced-motion`
Expected: FAIL before the new flag handling is implemented.

**Step 3: Write minimal implementation**

Add reduced-motion flag support, a screenshot path switch, and one assertion for the `reduced-motion` CSS class.

**Step 4: Run test to verify it passes**

Run: `node tests/browser/preloader-browser-check.js --reduced-motion`
Expected: PASS and create `tmp/preloader-browser-reduced-motion.png`

**Step 5: Commit**

```bash
git add tests/browser/preloader-browser-check.js tmp/preloader-browser-reduced-motion.png
git commit -m "test: add reduced-motion browser coverage"
```

### Task 3: Add low-capability browser coverage for adaptive quality

**Files:**
- Modify: `tests/browser/preloader-browser-check.js`
- Verify: `public/js/preloader-3d-core.js`
- Verify: `public/js/preloader-3d.js`

**Step 1: Write the failing test**

Extend the browser script with a `--mobile-low` mode that:
- uses a narrow viewport such as `390x844`
- asserts the preloader still renders without browser errors
- saves `tmp/preloader-browser-mobile-low.png`

```javascript
const mobileLow = process.argv.includes('--mobile-low');
const viewport = mobileLow
  ? { width: 390, height: 844 }
  : { width: 1440, height: 1024 };
```

**Step 2: Run test to verify it fails**

Run: `node tests/browser/preloader-browser-check.js --mobile-low`
Expected: FAIL before the viewport/profile switching logic is implemented.

**Step 3: Write minimal implementation**

Add:
- alternate viewport selection
- a screenshot path for the low-capability case
- the same browser-error guard as the standard path

**Step 4: Run test to verify it passes**

Run: `node tests/browser/preloader-browser-check.js --mobile-low`
Expected: PASS and create `tmp/preloader-browser-mobile-low.png`

**Step 5: Commit**

```bash
git add tests/browser/preloader-browser-check.js tmp/preloader-browser-mobile-low.png
git commit -m "test: add adaptive-quality browser coverage"
```

### Task 4: Add a single command wrapper for the browser verification workflow

**Files:**
- Modify: `package.json`
- Verify: `tests/browser/preloader-browser-check.js`

**Step 1: Write the failing test**

Add a script target to `package.json` for browser verification, then verify it does not work yet because the browser test script is not fully in place.

```json
{
  "scripts": {
    "test:preloader:browser": "node tests/browser/preloader-browser-check.js"
  }
}
```

**Step 2: Run test to verify it fails**

Run: `npm run test:preloader:browser`
Expected: FAIL until the browser test script exists and the local server is running.

**Step 3: Write minimal implementation**

Update `package.json` with:
- `test:preloader:browser`
- optional variants like `test:preloader:browser:reduced-motion`
- optional variant like `test:preloader:browser:mobile-low`

**Step 4: Run test to verify it passes**

Run: `npm run test:preloader:browser`
Expected: PASS when the local server is already running on port `4173`

**Step 5: Commit**

```bash
git add package.json tests/browser/preloader-browser-check.js
git commit -m "chore: add browser test commands for preloader"
```

### Task 5: Document the manual browser QA checklist

**Files:**
- Create: `docs/testing/preloader-browser-qa.md`
- Verify: `tmp/preloader-browser-standard.png`
- Verify: `tmp/preloader-browser-reduced-motion.png`
- Verify: `tmp/preloader-browser-mobile-low.png`

**Step 1: Write the failing test**

Write the checklist document with missing sections for:
- environment setup
- how to start the local server
- how to run each Playwright command
- what to visually inspect in a real browser session

**Step 2: Run test to verify it fails**

Run: `Test-Path docs\\testing\\preloader-browser-qa.md`
Expected: `False`

**Step 3: Write minimal implementation**

Create `docs/testing/preloader-browser-qa.md` with:
- standard path checklist
- reduced-motion checklist
- low-capability/mobile checklist
- expected screenshot artifacts
- pass/fail criteria for console errors, preloader visibility, dismissal timing, and fallback behavior

**Step 4: Run test to verify it passes**

Run: `Test-Path docs\\testing\\preloader-browser-qa.md`
Expected: `True`

**Step 5: Commit**

```bash
git add docs/testing/preloader-browser-qa.md
git commit -m "docs: add preloader browser qa checklist"
```
