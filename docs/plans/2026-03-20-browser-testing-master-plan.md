# Browser Testing Master Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Establish a repo-wide browser testing strategy that covers the public product, CRM admin flows, classroom/student flows, entrance test flows, regression-prone UI contracts, and manual evidence-based audits.

**Architecture:** Use a layered browser-testing model instead of one oversized end-to-end suite. Keep fast deterministic browser checks in `tests/browser`, preserve CRM/server smoke checks in `scripts/crm`, and run evidence-heavy manual audits for flows that depend on auth state, external operations, or incomplete product surfaces.

**Tech Stack:** Node.js, Playwright, existing `tests/browser/*.js` scripts, existing `scripts/crm/*.js` smoke scripts, local app server via `npm start`, manual DevTools inspection, screenshots under `tmp/` or `docs/audits/.../artifacts/`.

---

## 1. Scope

This plan covers the shipped browser surfaces currently present in `C:\Cursor AI\public`:

- `index.html`
- `classroom.html`
- `crm-admin.html`
- `entrance-test.html`
- `crm-entrance-test-result.html`
- `about/index.html`
- `funding/index.html`
- `landing/en/index.html`
- `offline.html`

It also covers the existing browser checks and CRM review material already in the repo:

- `tests/browser/preloader-browser-check.js`
- `tests/browser/practice-modes-browser-check.js`
- `tests/browser/reading-journey-quiz-browser-check.js`
- `tests/browser/site-header-about-check.js`
- `docs/testing/2026-03-10-crm-browser-validation-plan.md`
- `docs/audits/2026-03-16-crm-full-workflow/workflow-review-runbook.md`
- `scripts/crm/run-workflow-review-baseline.js`

## 2. Test Layers

Use five layers. Do not collapse them into one suite.

### Layer A: Static and UI-contract browser checks

Purpose:
- catch DOM regressions
- catch layout overflow
- catch console errors on first load
- validate stable UX contracts on public pages

Targets:
- site header
- preloader
- practice modes
- reading journey quiz
- basic mobile layout checks

Execution:
- run in headless Playwright
- no external services unless stubbed
- finish in minutes

### Layer B: Feature-smoke browser checks

Purpose:
- confirm a single page or flow is usable after a change
- validate visible behavior, not only DOM existence

Targets:
- entrance test load and submit path
- classroom student page load and class switcher
- CRM modal open/save/reopen flows

Execution:
- use local server
- use seeded local data
- attach screenshot on success

### Layer C: Full workflow browser review

Purpose:
- validate real operational journeys across multiple pages and roles

Targets:
- Facebook lead to student conversion
- student profile through classroom membership
- assignment creation through submission and grading
- finance and attendance cross-surface integrity

Execution:
- manual or semi-manual
- evidence required per stage
- use existing runbook + screenshots + network evidence

### Layer D: Negative and permission testing

Purpose:
- verify blocked paths remain blocked
- verify validation surfaces appear in browser, not just in API tests

Targets:
- non-admin access to CRM
- empty required fields
- duplicate enrollment
- invalid finance actions
- missing enrollment context

### Layer E: Non-functional browser checks

Purpose:
- catch user-facing problems that functional tests miss

Targets:
- console errors
- viewport overflow
- reduced motion
- offline fallback
- loading-state stability
- basic performance thresholds

## 3. Environments

Use three environments, in this order:

1. Local isolated browser checks
   - for `tests/browser/*.js`
   - deterministic and fastest

2. Local integrated app
   - start with:
   ```bash
   npm start
   ```
   - default target should be `https://localhost:8443` unless a script requires another port

3. Manual review environment with seeded accounts
   - admin user
   - non-admin user
   - teacher user
   - at least 2 student users

## 4. Device Matrix

Run the following minimum matrix:

- Desktop large: `1440x1024`
- Desktop narrow: `1280x800`
- Mobile: `390x844`
- Optional stress case: slow network / reduced motion

For every major flow, define whether it is:
- desktop-only
- mobile-supported
- mobile-critical

Current minimum mobile-critical flows:
- landing page
- main practice page
- entrance test start and submit
- student classroom access

Current desktop-critical flows:
- CRM admin
- review board
- finance
- classroom administration

## 5. Evidence Standard

Every browser run must produce enough evidence to be auditable.

Required for automated runs:
- pass/fail result
- URL visited
- one screenshot on success or failure
- captured `console` errors

Required for manual runs:
- one screenshot per stage
- one key network request per stage
- one persisted-record check per stage
- one note describing owner or operational dependency

Do not mark a flow complete with only “it worked on my screen”.

## 6. Data Fixtures

Prepare these records before integrated CRM/classroom testing:

- 2 leads
- 3 students
- 2 courses
- 2 classrooms
- 1 duplicate student pair
- 1 real enrollment without attendance yet
- 1 at-risk student
- 1 student with multiple enrollments
- 1 unpaid invoice
- 2 assignments
- 1 classroom schedule with at least 2 slots

Keep a reusable fixture sheet in a separate test-data doc or seed script. The browser plan depends on deterministic data.

## 7. Command Baseline

Run these before any manual browser audit:

```bash
npm install
npm start
node scripts/crm/run-workflow-review-baseline.js
node scripts/crm/verify-crm-suite.js
```

Run these existing browser checks as a public-surface gate:

```bash
npm run test:preloader:browser
npm run test:preloader:browser:reduced
npm run test:preloader:browser:mobile
node tests/browser/practice-modes-browser-check.js
npm run test:reading-journey:quiz:browser
npm run test:site-header:browser
```

Expected outcome:
- exit code `0`
- no uncaught browser console errors
- screenshots written under `tmp/`

## 8. Browser Test Suites To Maintain

Maintain the following suites as separate concerns:

### Suite 1: Public shell and content

Coverage:
- site header
- landing page
- about page
- funding page
- preloader
- offline page

Assertions:
- critical headings visible
- navigation current-state correct
- no viewport overflow
- no fatal console errors

### Suite 2: Practice and learning modes

Coverage:
- mode switching
- question navigation
- filter presence/absence contracts
- corrupted text regression
- mobile layout sanity

Assertions:
- correct mode panel visible
- buttons and selectors exist
- no corrupted text markers
- no major warnings in console

### Suite 3: Entrance test flow

Coverage:
- load entrance test
- complete required fields
- submit
- open admin result page

Assertions:
- form validation works
- submission reaches persisted/admin-visible state
- result page renders submitted data without fatal errors

### Suite 4: Classroom student flow

Coverage:
- classroom page load
- visible class switcher
- stream/classwork/todo visibility
- assignment submission

Assertions:
- enrolled student sees classroom list
- non-member does not see unauthorized content
- submissions appear in review surfaces

### Suite 5: CRM shell and student modal flow

Coverage:
- admin access gate
- dashboard load
- lead creation/edit
- student modal open/save/reopen
- learning profile save/reload
- finance tab behavior by enrollment context

Assertions:
- admin-only shell remains protected
- persisted values survive hard refresh
- validation and blocked actions are visible in UI

### Suite 6: CRM full workflow review

Coverage:
- lead intake
- qualification
- entrance test
- conversion
- student profile
- course/classroom
- schedule
- attendance
- classwork
- submission
- grading
- finance

Source of truth:
- `docs/audits/2026-03-16-crm-full-workflow/workflow-review-runbook.md`
- `docs/testing/2026-03-10-crm-browser-validation-plan.md`

## 9. Test Case Shape

Every browser test case should explicitly define:

- starting URL
- role or auth state
- fixture data required
- action steps
- expected visible UI state
- expected network request
- expected persisted state
- expected console condition
- screenshot filename

Template:

```markdown
Case ID: CRM-LP-001
Surface: CRM student modal
Role: admin
Fixture: existing student with saved learning profile
Start URL: https://localhost:8443/crm-admin.html
Actions:
- open student profile
- switch to Learning Profile tab
- change Listening score to 88
- save
- reopen modal
Expected UI:
- Listening circle shows 88
- no validation or error toast
Expected Network:
- PATCH /api/admin/students/{id}
Expected Persistence:
- stored learningProfile.listening = 88
Evidence:
- screenshot
- console clean
```

## 10. Negative Browser Coverage

Keep a dedicated negative checklist. Minimum cases:

- non-admin blocked from `crm-admin.html`
- save student with no required info fields
- create lead with no contact fields
- duplicate enrollment attempt
- finance payment without selected invoice
- invoice creation without enrollment selection where required
- invalid classroom access as student
- assignment submission without proper enrollment context

Expected result:
- action blocked in UI
- clear user-facing message
- no silent failure
- no server-side success on invalid action

## 11. Non-Functional Coverage

Add browser checks for:

- console error budget: zero uncaught errors
- mobile overflow: no primary nav/header overflow
- reduced-motion behavior for animated surfaces
- offline fallback for `offline.html` / service-worker entry paths
- loading states: no stuck spinner or modal dead-end
- performance smoke:
  - landing page first render reasonable on desktop
  - no extreme navigation delays on local integrated runs

Use screenshots and timing logs. For performance, treat regressions as warnings unless they exceed an agreed threshold.

## 12. Ownership and Frequency

Run frequency:

- on every UI-affecting change:
  - affected `tests/browser` script
  - affected CRM smoke script

- before merge to main for significant frontend work:
  - all public browser checks
  - CRM verify suite

- before releases or milestone closes:
  - full CRM workflow baseline
  - manual browser audit runbook

Ownership:

- fast browser checks: engineer making the change
- CRM workflow audit: feature owner or reviewer
- artifact retention: audit owner

## 13. Gaps To Close Next

Highest-value additions after this plan:

1. Add a dedicated browser check for `classroom.html` with seeded member and non-member states.
2. Add a dedicated browser check for `entrance-test.html` plus `crm-entrance-test-result.html`.
3. Add a targeted CRM modal browser check for the Learning Profile and finance enrollment-context rules.
4. Standardize screenshot output paths and naming under `tmp/` or `docs/audits/<date>/artifacts/`.
5. Add a shared browser helper for local server startup because the skill-referenced `scripts/with_server.py` is not present in this repo.

## 14. Exit Criteria

The browser testing plan is considered operational when:

- existing public browser checks run cleanly
- CRM baseline runs cleanly
- manual workflow audits produce evidence, not only notes
- each critical surface has a documented owner and minimum frequency
- classroom, entrance test, and CRM modal gaps have dedicated browser scripts

