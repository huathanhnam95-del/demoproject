# Practice Scope Test Remediation and Next Browser Pass

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix the current gaps in Practice Scope browser verification, remove false signoff conditions, and run a clean Chrome-only browser pass that matches the real requirements.

**Architecture:** Treat the current state as two linked problems: first repair the test design and evidence trail, then rerun a tighter automated + manual browser workflow. Keep Playwright as the primary gate, split guest and logged-in coverage so persistence is tested honestly, and use browser-agent only as a confirmation layer after the automated pass is green.

**Tech Stack:** Node.js, Playwright, local Express harness, Chrome manual testing, Markdown reports, local credential file at `C:\Cursor AI\.local\browser-test-credentials.md`.

---

## Current issues to fix

1. `tests/browser/practice-phase789-check.js` currently fails because it clears `practiceScope` via `page.addInitScript()` and then reloads, which wipes the state it later tries to verify.
2. The same script claims logged-in coverage but still enters through guest mode and never uses `C:\Cursor AI\.local\browser-test-credentials.md`.
3. The walkthrough report overclaims coverage and says all exit criteria passed even though the phase 7/8/9 script currently fails.
4. Recommendation modal coverage is incomplete: English-scope suggestions and the empty-result fallback are not fully verified.
5. Accessibility coverage is incomplete: `aria-pressed` is checked, but keyboard activation and focus retention are not.
6. Console/network smoke coverage is incomplete: `pageErrors` are collected but not asserted in `tests/browser/practice-phase789-check.js`, and failed network requests are not checked.

---

## Fixing Plan

### Task 1: Reproduce and lock down the failing coverage

**Files:**
- Verify: `tests/browser/practice-phase789-check.js`
- Reference: `C:\Users\Admin\.gemini\antigravity\brain\5026dea1-450c-4df5-8475-18f91df77506\walkthrough.md.resolved`

**Step 1: Reproduce the current failure**

Run:
`node tests/browser/practice-phase789-check.js`

Expected:
- FAIL with the persistence assertion where PTE should survive reload but does not.

**Step 2: Record the exact failure in the implementation notes**

Capture:
- terminal output
- assertion text
- the reason the test is invalid: `page.addInitScript()` runs on reload too

Artifact:
- a short note in the execution log or task notes before code changes begin

---

### Task 2: Repair the broken persistence test design

**Files:**
- Modify: `tests/browser/practice-phase789-check.js`

**Step 1: Remove or guard the reload-reset behavior**

Implementation target:
- do not clear `practiceScope` on every page load
- only clear persisted scope once at the beginning of the test run

Recommended approach:
- remove `localStorage.removeItem('practiceScope')` from `page.addInitScript()`
- clear state explicitly before the first `page.goto(...)`, or
- guard the reset with a one-time sentinel stored outside the page reload path

**Step 2: Make the persistence assertion honest**

After toggling to `PTE Practice` and reloading:
- assert `localStorage.getItem('practiceScope') === 'pte'`
- assert the `PTE Practice` button has `aria-pressed="true"`
- assert the launcher grouping still reflects PTE after reload

**Step 3: Re-run the repaired script**

Run:
`node tests/browser/practice-phase789-check.js`

Expected:
- PASS on the persistence portion

---

### Task 3: Split guest coverage from real logged-in coverage

**Files:**
- Modify or narrow: `tests/browser/practice-phase789-check.js`
- Create: `tests/browser/practice-scope-logged-in-browser-check.js`

**Step 1: Make `practice-phase789-check.js` guest-only unless it truly logs in**

Guest-only responsibilities:
- scope toggle semantics
- keyboard accessibility
- console/page error smoke
- network failure smoke
- non-auth persistence if the app supports it in guest mode

**Step 2: Add a dedicated logged-in browser check**

New script responsibilities:
- read the admin credentials from `C:\Cursor AI\.local\browser-test-credentials.md`
- sign in through the real UI
- confirm authenticated layout is loaded
- toggle to `PTE Practice`
- reload
- verify `practiceScope` still restores correctly while logged in

**Step 3: Do not label guest coverage as logged-in coverage**

Success criteria for the new logged-in test:
- it must not click the guest-mode button
- it must verify authenticated state explicitly before scope assertions

**Step 4: Run both scripts**

Run:
- `node tests/browser/practice-phase789-check.js`
- `node tests/browser/practice-scope-logged-in-browser-check.js`

Expected:
- both pass

---

### Task 4: Complete the recommendation modal coverage

**Files:**
- Create: `tests/browser/practice-scope-recommendation-browser-check.js`
- If needed for testability, modify: `public/script.js`

**Step 1: Add English-scope recommendation assertions**

Verify:
- English scope returns English-visible modes
- English naming is used
- hidden PTE-only naming does not leak into English

**Step 2: Add PTE-scope recommendation assertions**

Verify:
- hidden English-only modes are filtered out
- renamed PTE labels appear in the suggestions

**Step 3: Add empty-result fallback coverage**

If the current UI cannot deterministically trigger a zero-suggestion path:
- add a minimal test hook in `public/script.js`
- expose a read-only helper that resolves suggestions for a supplied goal set
- use it only for deterministic verification of the fallback path

**Step 4: Run the new recommendation test**

Run:
`node tests/browser/practice-scope-recommendation-browser-check.js`

Expected:
- PASS with English, PTE, and fallback coverage

---

### Task 5: Complete accessibility coverage

**Files:**
- Modify: `tests/browser/practice-phase789-check.js`

**Step 1: Keep the existing `aria-pressed` assertions**

Verify:
- English starts active
- PTE becomes active after toggle

**Step 2: Add keyboard activation checks**

Use Playwright keyboard flow:
- `Tab` to the scope toggle
- `Enter` to switch once
- `Space` to switch back

Verify:
- the scope changes correctly
- the newly active button remains focused or focus stays within the control

**Step 3: Add accessible label smoke assertions**

After switching scopes:
- inspect one renamed card
- assert its visible label and `aria-label` both match the active scope wording

**Step 4: Re-run the accessibility script**

Run:
`node tests/browser/practice-phase789-check.js`

Expected:
- PASS with keyboard and focus coverage included

---

### Task 6: Complete console and network smoke coverage

**Files:**
- Modify: `tests/browser/practice-phase789-check.js`

**Step 1: Assert `pageErrors` explicitly**

Current gap:
- `pageErrors` are collected but never asserted

Add:
- `assert.deepStrictEqual(pageErrors, [], ...)`

**Step 2: Track failed requests**

Capture:
- `page.on('requestfailed', ...)`
- optionally same-origin `response.status() >= 400` if the harness allows it

Assert:
- no scope-toggle action introduces failed requests for the app shell or practice assets

**Step 3: Filter only clearly irrelevant noise**

Allowed filtering should be narrow:
- known favicon noise if truly unavoidable
- nothing broader

**Step 4: Re-run the smoke script**

Run:
`node tests/browser/practice-phase789-check.js`

Expected:
- PASS with page error and network failure assertions active

---

### Task 7: Correct the evidence and signoff report

**Files:**
- Modify: `C:\Users\Admin\.gemini\antigravity\brain\5026dea1-450c-4df5-8475-18f91df77506\walkthrough.md.resolved`
- Optionally create a repo-local copy: `docs/plans/2026-04-07-practice-scope-browser-testing-report.md`

**Step 1: Remove unsupported claims**

Specifically remove or rewrite:
- “all exit criteria have been fully satisfied” until the full suite is green
- any “logged-in” claim that was actually executed in guest mode

**Step 2: Correct the evidence inventory**

Mark each item clearly as one of:
- automated Playwright
- manual Chrome
- browser-agent confirmation

**Step 3: Fix formatting quality**

Clean up:
- mojibake characters
- `file:///` links if the destination format does not support them
- incomplete English listening inventory if `Watch` was part of the verified scope

**Step 4: Publish the corrected report only after reruns pass**

Artifact:
- a corrected report that only claims what was actually verified

---

## Next Browser Testing Plan

### Phase 1: Automated rerun after fixes

Run the following in order:

1. `node tests/browser/practice-launcher-clickpath-browser-check.js`
2. `node tests/browser/practice-scope-toggle-browser-check.js`
3. `node tests/browser/practice-phase789-check.js`
4. `node tests/browser/practice-scope-logged-in-browser-check.js`
5. `node tests/browser/practice-scope-recommendation-browser-check.js`

Expected:
- all exit with code `0`
- no uncaught page errors
- no unexpected console errors

---

### Phase 2: Manual Chrome guest-mode pass

**Step 1: Start the app**

Run:
`npm start`

Open Chrome to the local URL shown by the server.

**Step 2: Start from a clean guest state**

In DevTools Console:
- `localStorage.removeItem('practiceScope')`
- `location.reload()`

**Step 3: Verify English baseline**

Confirm:
- `English Practice` active
- `Listening` selected
- English listening cards include `Dictate`, `Collo-dictate`, `Fill In the Blanks`, `Watch`, `Take Notes`
- English speaking cards include `Read Aloud`, `Repeat`, `Pronounce`

**Step 4: Verify PTE grouping**

Toggle to `PTE Practice` and confirm:
- Speaking: `Read Aloud`, `Repeat Sentence`, `Retell Lecture`
- Listening: `Fill In the Blanks`, `Write from Dictation`
- Reading and Writing remain unchanged

**Step 5: Verify edge-case transitions**

Confirm:
- `Take Notes` in English becomes `Retell Lecture` in PTE without losing the active panel
- toggling back to English restores `Take Notes`
- `Pronounce` falls back to `Read Aloud` when switching to PTE

---

### Phase 3: Manual Chrome logged-in pass

**Step 1: Read credentials**

Use:
`C:\Cursor AI\.local\browser-test-credentials.md`

**Step 2: Sign in with the admin account**

Confirm:
- authenticated UI loads fully
- no guest-mode shortcut is used

**Step 3: Repeat a focused practice-scope pass**

Verify:
- scope toggle still works
- PTE persists across reload
- `Read Aloud`, `Retell Lecture`, and `Write from Dictation` still launch correctly

**Step 4: Confirm no auth collision**

Reload once more and verify:
- selected scope remains correct
- no auth modal, redirect, or overlay breaks the launcher

---

### Phase 4: Manual accessibility spot-check in Chrome

Verify:
- scope buttons show the correct active state
- `Tab`, `Enter`, and `Space` work on the scope control
- focus does not disappear after the UI re-renders
- a renamed PTE card exposes the correct visible label and accessible label

---

### Phase 5: Manual console and network spot-check

In Chrome DevTools:

**Console**
- verify no syntax errors
- verify no uncaught runtime errors during scope changes

**Network**
- filter to failed requests
- toggle English ↔ PTE multiple times
- verify no new failures are introduced by scope switching

---

### Phase 6: Optional browser-agent confirmation

Run only after Playwright and manual Chrome passes are green.

Use browser-agent to capture:
- one English launcher screenshot
- one PTE launcher screenshot
- one notes-remap screenshot or recording
- one recommendation-modal screenshot if the modal coverage is visually important to signoff

---

## Exit criteria for the next pass

Do not mark the work done until all of the following are true:

1. The repaired `tests/browser/practice-phase789-check.js` passes.
2. Real logged-in persistence is covered by a dedicated authenticated browser test.
3. Recommendation modal coverage includes English, PTE, and empty-result fallback.
4. Accessibility coverage includes keyboard activation and focus retention.
5. Console smoke coverage asserts both `pageErrors` and filtered `consoleErrors`.
6. Network smoke coverage checks failed requests.
7. The walkthrough/report only contains claims backed by passing test output or captured manual evidence.

---

## Recommended output files after execution

- Updated: `tests/browser/practice-phase789-check.js`
- New: `tests/browser/practice-scope-logged-in-browser-check.js`
- New: `tests/browser/practice-scope-recommendation-browser-check.js`
- Updated: `C:\Users\Admin\.gemini\antigravity\brain\5026dea1-450c-4df5-8475-18f91df77506\walkthrough.md.resolved`
- Optional repo copy: `docs/plans/2026-04-07-practice-scope-browser-testing-report.md`

---

## Execution order summary

1. Reproduce the current phase 7/8/9 failure
2. Fix the broken persistence test design
3. Split guest vs logged-in coverage
4. Add missing recommendation coverage
5. Add keyboard, page error, and network coverage
6. Re-run the full automated set
7. Run the Chrome manual guest pass
8. Run the Chrome manual logged-in pass
9. Capture browser-agent confirmation artifacts
10. Publish the corrected walkthrough/report
