# Practice Scope Browser Testing Plan

**Goal:** Verify the new `English Practice` / `PTE Practice` launcher behavior in Chrome without regressing the current Practice UI, mode entry flow, or future scope-specific extensibility points.

**Scope:** Chrome-only. Run Playwright checks first, then do a manual Chrome pass, and use the Antigravity browser-agent flow only as an optional second confirmation step when richer evidence is needed.

**Primary Areas Under Test:**
- Scope toggle UI and persistence
- Scope-aware card grouping, labels, and visibility
- Active mode behavior during scope remaps
- Hidden-mode fallback behavior
- Recommendation modal filtering
- Guest-mode and logged-in entry flows
- Accessibility and console-error smoke coverage

---

## Preconditions

1. Open the repo at `C:\Cursor AI`.
2. Confirm dependencies are installed:
   - Run `npm install` if `node_modules` is missing.
3. For any login-required browser pass, read `C:\Cursor AI\.local\browser-test-credentials.md` first and use the admin account documented there.
4. Use Chrome only for manual browser testing.
5. Keep DevTools available during manual testing so console errors and localStorage state can be checked quickly.

---

## Test Assets and Entry Points

**Automated browser checks**
- `tests/browser/practice-launcher-clickpath-browser-check.js`
- `tests/browser/practice-scope-toggle-browser-check.js`

**Relevant implementation files**
- `public/index.html`
- `public/style.css`
- `public/script.js`
- `public/take-notes-mode.js`

**Manual app entry**
- Start the app with `npm start`
- Open the URL printed by the server:
  - usually `https://localhost:8443`, or
  - `http://localhost:8443` if the app falls back to HTTP

---

## Phase 1: Automated Chrome Harness Pass

### Step 1: Run the baseline launcher smoke check
- Command: `node tests/browser/practice-launcher-clickpath-browser-check.js`
- Expected result:
  - exits with code `0`
  - prints `Practice launcher click-path browser verification complete.`

### Step 2: Run the scope toggle regression check
- Command: `node tests/browser/practice-scope-toggle-browser-check.js`
- Expected result:
  - exits with code `0`
  - prints `Practice scope toggle browser verification complete.`

### Step 3: Stop and debug immediately if either automated check fails
- Capture:
  - terminal output
  - first failing assertion
  - any page error or console error shown by the script
- Do not continue to manual signoff until both scripts pass.

---

## Phase 2: Manual Chrome Smoke Pass in Guest Mode

### Step 1: Start the local app
- Command: `npm start`
- Wait for the server log that shows the local URL.

### Step 2: Open the app in Chrome
- Use a fresh Chrome window or Incognito so old localStorage does not hide state issues.

### Step 3: Clear persisted scope state before the first run
- In DevTools Console, run:
  - `localStorage.removeItem('practiceScope')`
  - `location.reload()`

### Step 4: Dismiss entry blockers and continue as guest
- If the preloader appears, dismiss it.
- If the guest button appears, enter through guest mode.
- Confirm the main layout is visible before continuing.

### Step 5: Verify the default launcher state
- Expected:
  - `English Practice` toggle is active
  - `PTE Practice` toggle is inactive
  - Learning Center opens without blank panels
  - no blocking console errors appear

### Step 6: Verify the default skill selection
- Expected:
  - `Listening` is the selected launcher skill
  - the listening cards shown are the current English set
  - labels match existing English naming

---

## Phase 3: English Practice Manual Verification

### Step 1: Verify English Speaking cards
- Click the `Speaking` skill filter.
- Confirm the visible cards are:
  - `Read Aloud`
  - `Repeat`
  - `Pronounce`

### Step 2: Verify English Listening cards
- Click the `Listening` skill filter.
- Confirm the visible cards are:
  - `Dictate`
  - `Collo-dictate`
  - `Fill In the Blanks`
  - `Watch`
  - `Take Notes`

### Step 3: Verify English Reading cards
- Click the `Reading` skill filter.
- Confirm the visible card is:
  - `Dropdown`

### Step 4: Verify English Writing state
- Click the `Writing` skill filter.
- Confirm the current empty or unchanged writing state still matches the existing design.

### Step 5: Verify one mode launch from each visible English skill
- Launch:
  - `Read Aloud`
  - `Take Notes`
  - `Dropdown`
- For each launch, confirm:
  - the correct mode panel becomes visible
  - the current mode indicator updates
  - the rest of the layout remains stable

---

## Phase 4: PTE Practice Manual Verification

### Step 1: Toggle to PTE Practice
- Click the `PTE Practice` toggle.
- Expected:
  - toggle active state changes immediately
  - no full-page refresh happens
  - the launcher updates in place

### Step 2: Verify PTE Speaking grouping
- Click the `Speaking` skill filter.
- Confirm the visible cards are exactly:
  - `Read Aloud`
  - `Repeat Sentence`
  - `Retell Lecture`

### Step 3: Verify PTE Listening grouping
- Click the `Listening` skill filter.
- Confirm the visible cards are exactly:
  - `Fill In the Blanks`
  - `Write from Dictation`

### Step 4: Verify PTE Reading and Writing remain unchanged
- Click `Reading` and confirm `Dropdown` is still present.
- Click `Writing` and confirm the current design remains unchanged.

### Step 5: Verify renamed cards launch existing underlying modes
- Launch:
  - `Repeat Sentence`
  - `Retell Lecture`
  - `Write from Dictation`
- Confirm:
  - they open the same underlying mode engines as before
  - the mode indicator uses the PTE label, not the English label
  - no blank panel or incorrect tab state appears

---

## Phase 5: Scope Transition Edge Cases

### Step 1: Verify remapped active mode stays active when still valid
- In `English Practice`, open `Take Notes`.
- Toggle to `PTE Practice`.
- Expected:
  - `Speaking` becomes the selected skill
  - the notes panel stays active
  - the current mode indicator changes from `Take Notes` to `Retell Lecture`

### Step 2: Verify remapped active mode returns cleanly to English
- With the same notes panel still active, toggle back to `English Practice`.
- Expected:
  - `Listening` becomes the selected skill
  - the notes panel stays active
  - the current mode indicator changes back to `Take Notes`

### Step 3: Verify hidden-mode fallback on scope switch
- In `English Practice`, open `Pronounce`.
- Toggle to `PTE Practice`.
- Expected:
  - the app automatically redirects to `Read Aloud`
  - the current mode indicator stays visible
  - no hidden active mode remains selected behind the launcher

### Step 4: Verify scope persistence across reload
- While `PTE Practice` is active, reload the page.
- Expected:
  - `PTE Practice` stays selected after reload
  - the launcher card grouping still matches PTE

### Step 5: Verify scope reset behavior when localStorage is cleared
- Run `localStorage.removeItem('practiceScope')`, then reload.
- Expected:
  - the app returns to `English Practice`
  - default launcher behavior is restored

---

## Phase 6: Recommendation Modal Coverage

### Step 1: Open the recommendation flow in English scope
- Use the “Help me choose a mode” entry point.
- Submit a few representative goals.
- Confirm the suggested modes only include English-visible modes.

### Step 2: Repeat in PTE scope
- Switch to `PTE Practice`.
- Submit the same representative goals.
- Confirm:
  - hidden English-only modes are not suggested
  - suggestions use PTE labels when applicable

### Step 3: Verify empty-result fallback
- Try a goal that would normally bias toward a hidden English-only mode.
- Expected:
  - the modal still returns a usable fallback recommendation
  - the modal does not render empty or break layout

---

## Phase 7: Logged-In Regression Pass

### Step 1: Read the local credential file
- Use `C:\Cursor AI\.local\browser-test-credentials.md`
- Use the admin account documented there unless a different account is explicitly required.

### Step 2: Sign in through Chrome
- Confirm login succeeds and the authenticated layout finishes loading.

### Step 3: Repeat a focused scope pass while signed in
- Verify:
  - toggle switches normally
  - launcher grouping still changes correctly
  - opening `Take Notes` and `Read Aloud` still works
  - no auth-related overlay or redirect interferes with scope changes

### Step 4: Verify no obvious persistence collisions
- Reload once while signed in.
- Confirm the selected practice scope still restores correctly.

---

## Phase 8: Accessibility and Keyboard Checks

### Step 1: Verify toggle semantics
- Inspect the two scope buttons in DevTools.
- Confirm:
  - each has `data-practice-scope`
  - active state uses `aria-pressed="true"`
  - inactive state uses `aria-pressed="false"`

### Step 2: Verify keyboard activation
- Use `Tab` to focus the scope toggle.
- Use `Enter` and `Space` to activate each option.
- Confirm:
  - focus ring is visible
  - the toggle changes scope correctly
  - focus is not lost after re-render

### Step 3: Verify card and indicator accessibility smoke behavior
- After switching scopes, inspect a renamed card.
- Confirm its label text and accessible label match the current scope wording.

---

## Phase 9: Console and Network Smoke Checks

### Step 1: Watch the DevTools Console during all scope changes
- Expected:
  - no syntax errors
  - no uncaught exceptions
  - no repeated warnings tied to scope switching

### Step 2: Watch for failed static asset requests
- Open DevTools Network tab and filter to failed requests.
- Toggle between English and PTE several times.
- Expected:
  - no new failed requests are introduced by the scope feature

### Step 3: Confirm `practiceScope` persistence explicitly
- In DevTools Console, run `localStorage.getItem('practiceScope')`.
- Expected:
  - returns `english` or `pte` matching the current toggle

---

## Phase 10: Optional Antigravity Browser-Agent Confirmation

Use this only after the Playwright pass is green and the manual Chrome pass is mostly complete.

### Step 1: Start from the same local app URL in the browser-agent flow
- Reproduce the main guest-mode scope checks.

### Step 2: Capture richer evidence if needed
- Use it for:
  - screenshots of English vs PTE launcher states
  - console capture
  - interactive repro of any flaky transition issue

### Step 3: Use it as confirmation, not as the primary gate
- Final signoff should still depend on the Playwright pass plus the manual Chrome walkthrough.

---

## Exit Criteria

The feature is ready for signoff only if all of the following are true:

1. `node tests/browser/practice-launcher-clickpath-browser-check.js` passes.
2. `node tests/browser/practice-scope-toggle-browser-check.js` passes.
3. Manual Chrome guest-mode verification passes.
4. Manual Chrome logged-in verification passes for the focused scope flows.
5. No console syntax errors or uncaught runtime errors appear during scope changes.
6. Scope persistence, remap behavior, and hidden-mode fallback all behave exactly as expected.

---

## Evidence to Capture

- Terminal output from the two Playwright checks
- One screenshot of English scope launcher state
- One screenshot of PTE scope launcher state
- One screenshot of the `Take Notes` → `Retell Lecture` remap case
- Any console error text if a step fails
