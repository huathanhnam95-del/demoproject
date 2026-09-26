# Projects tab audit: handoff plan

Written: Saturday, September 26, 2026, about 07:00 AM (Vietnam Time), for the next session.
Scope: the CRM **Projects** tab, **desktop only** (the user said to skip phone layout and phone-only features).
Branch/checkout: `C:\Cursor AI`, branch `feat/projects-subtasks-people`, **nothing committed**.

**Independent audit added September 26, 2026:** read [desktop-interaction-audit.md](desktop-interaction-audit.md) alongside this handoff. It adds 37 prioritized findings/checks, a complete desktop interaction inventory, fresh Chrome evidence, performance targets and a lean verification plan. The checkout audited was HEAD `640c879f6398523814c5316b8c61f0e83f5fceee` plus the existing dirty files; the original “nothing committed” note describes the earlier Projects edits, not the repository's later history.

**User directions:** no mobile development or mobile checks; avoid unnecessary unit tests; do the fuller real-site acceptance after an authorized deployment. **Calendar tasks must appear as bars spanning their working period**, selected by the user during this audit. The initial audit updated these plans only. The user subsequently authorized another review and implementation by subagents in this session. The authorized local fixes are implemented and verified with focused checks and synthetic desktop Chrome. No deployment is authorized or performed.

**Revised order:** first retained work, duplicate submission, task movement, truthful counts and notification navigation; then drawer/date/keyboard polish and measured read/redraw improvements; then remaining settings/tools and the separate lazy-loader. Audit findings D01–D05, D14, D22 and D29 take precedence over cosmetic work. See the companion report for exact source references, acceptance and limitations.

---

## Authorized implementation follow-up

Second review added three bounded speed improvements: defer search until Vietnamese text composition finishes; treat unchanged normalized filters as a no-op; and coalesce pointer resize redraws to one per animation frame. Keep explicit refresh behavior, actor/project boundaries and final width persistence. See D34–D36 in the companion report.

Root owns integration, stylesheet and desktop Chrome checks. Disjoint writers own board/detail, views/calendar, automations and settings/search; secondary tools follow after ownership handoff. Existing source/index changes were preserved in narrow external backups and structure snapshots before edits. No package installation, new broad test suite, mobile work, Git publication or production data changes belong to this package. The subsequently authorized speed follow-up includes D21 after a focused HTML ownership handoff. The allowance inheritance API (D33) remains separate.

## Current implementation handoff — September 26, 2026

The authorized desktop package is implemented in the current checkout. The companion audit's completion section records the exact evidence and limits. The original issue descriptions below are historical context, not claims that those defects are still present.

- Board/detail: correct subtask Move default and retry, safe project-create retry, one Save dates action with required warning review, retained date display and overdue state, date-picker focus, accessible section headers, shared column order and one redraw per frame during resize. Drawer now has a wrapping editable title and compact properties.
- Views: spanning Calendar bars with continuation and accessible overflow; Vietnam Today; separate Table/Calendar totals; no redundant initial Table summary read; unchanged filters do no work; bounded cache with fixed expiry; linked records load directly when opened.
- Tools/settings: retained automation and discussion drafts; truthful loaded-notification count and Updates navigation; lazy/coalesced recovery refresh preserving later-page selections; settings load on demand, fresh member lists and named confirmations; voice shuts down on route departure; Vietnamese composition-safe search.
- Chrome caught one additional blocker: column width number fields used a step incompatible with default pixel values, silently preventing the search form from submitting. Pixel widths now accept every valid integer (D37).
- Independent review corrections are included: fixed cache expiry renewal, initial Table linked-record loading, recovery later-page selections, notification cursor retention, and stale settings Save after a failed read.

**Updated speed evidence:** the follow-up fixture now honors 200-task API pages across 1,000 tasks. The saved baseline had 56–63 ms first-entry Kanban long tasks. After reducing the initial column batch and avoiding repeated formatting/layout work, three runs had no >50 ms tasks on first entry, next page or warm return. The final combined run measured first Kanban at 163 ms including the synthetic 80 ms response delay; first/warm Gantt at 86/82 ms with zero new requests; scroll frame p95 19.2 ms with 30 mounted table rows. These are local synthetic Chrome measurements, not production guarantees or database-cost measurements.

**Speed follow-up complete:** 24 Projects modules execute once on the first Projects visit, in dependency order, with visible loading/retry and route/account guards. Desktop menu hover or keyboard focus preloads their files without executing modules or reading project data. Repeated intent and opening after preload add no duplicate downloads. Staff access controls remain available before visiting Projects. About 862 KiB raw JavaScript (199 KiB gzip estimate) is deferred until Projects intent or entry. Warm visits add no script downloads. Full-shell Chrome with synthetic authentication/API responses verified direct project/task/Updates routes, F5 restoration, Staff grants, download retry and leaving during loading. Real authentication and persistence remain for the authorized production walkthrough.

**Gantt redesign complete:** the user's screenshot prompted a desktop redesign with a fixed task-name column, scrollable timeline, readable Days/Weeks/Months axes, duration bars, visible dependency connectors, Today, retained scroll/focus and compact Needs dates rows. Set dates opens the existing guarded date editor. The chart labels its current-page scope, bounds rendering and distinguishes parent-derived spans and incomplete/invalid dates. It does not invent dates or working-day counts. Desktop Chrome covered 1366 px at 150% app text, 1920 px at 125% in dark mode, paging/batching, all-undated data and navigation during a delayed editor read. Existing Git history contains the original Gantt renderer; no lost renderer was found. Drag rescheduling was not part of the recovered implementation and is not claimed here.

**Still separate:** D33 restoring allowance inheritance requires a server contract. Real authenticated F5/route restoration, production-scale timing, persistent backend effects, actual downloads and paid voice transport remain in the post-deployment walkthrough. The Projects V2 activation/release dependency still belongs to the coordinated release batch. No mobile implementation, new test files or broad new unit suite were added. The final focused selection passed 92 checks.

Evidence and narrow recovery copies are under `C:\Users\Admin\.codex\task-evidence\01a0db13-02d2-7ef2-be7f-d57bc85ea945`: `implementation`, `speed-followup`, `gantt-redesign`, `access-verification` and the final combined handoff. The earlier unrelated `firebase-debug.log` change was preserved and included unchanged in fresh follow-up snapshots; both speed and Gantt structure checks passed. The package includes an additive automation `activeTrigger` API response, so the reviewed client and Functions change must ship together. Preserve the existing staged/index state and unrelated HTML work; release ownership/base reconciliation and publication remain separate.

**Four-item speed follow-up:** hover/focus was initially omitted and is now implemented, with evidence in `hover-followup/intent.json` and 9/9 existing loader checks. The 56 ms observation was one main-thread pause, not overall load time; the paged baseline and optimized samples separate those measurements. Production measurement remains pending an authorized release: compare small/large projects across first opening, repeat opening, project switching and saves, separating request/network timing, server duration when available, and browser rendering. Keep complete pages and authoritative totals. The unrelated debug log remains byte-identical to the preserved 41,203-byte baseline; Windows sharing prevented one PowerShell hash read, while a shared Node read verified it. Historical task ownership is unresolved and must not be invented or used to authorize cleanup.

**Latest state:** the workspace bookkeeping blocker is resolved. Full before/after Chrome timeline traces supplement the CPU profiles and confirm no >50 ms pause in the optimized first/next-page/warm sample. Google Drive's own logs confirmed that the changing root `.tmp.driveupload/` directory was its temporary upload area. The user approved an exact root-directory exclusion from local file scans and an anchored Git ignore. The checker still rejects indexed/committed cache files and source/output declarations there; nested same-name folders, root files/links and ordinary source changes remain checked. Older snapshots remain compatible. All 48 structure checks passed without skips, the independent Astra review found no defects, and the full workspace check passed with zero blockers. The cache, sync process and debug log are preserved. Exact implementation and verification receipts are retained under `cache-boundary/`. No deployment has occurred.

**Release compatibility correction:** the next review found that the preserved dirty HTML still contained an older localhost-only V2 switch, even though committed HEAD enables V2 for all hosts. Earlier synthetic shell checks forced V2 on, so they did not prove the actual activation setting. Restored HEAD's all-host default with exact `projectsV2=0` fallback and its existing 70-case host/query matrix; all 9 entry checks passed. Desktop Chrome now uses the actual inline configuration on a non-local fixture origin: the redesigned Gantt renders 12 bars by default before/after F5, while the explicit fallback stays legacy. These checks still use synthetic auth/data. No new test file was added.

The cross-task review found that many older ready records describe already integrated/deployed contributions. Do not replay their commits or publish whole dirty files. This audit's patch is incremental over the original Projects work listed below; the observer/controller pause-and-resume changes are a required pair. Preserve current release HTML's Entrance D and scheduler work and reconcile the active Calendar task separately. Exact findings and native-host coverage limits are in external `release-review/compatibility-review.md`. The current patch remains a locally verified contribution for coordinated assembly, not a frozen production artifact. Client/Functions pairing and live preservation checks remain required for publication.

## 1. Where things stand

Two rounds of work are sitting uncommitted in the checkout:

1. **The user's original list**: hover states, monday-style section blocks, adding tasks, subtasks and sections inside the table, the Columns menu, F5 keeping you on Projects, remembered projects for instant switching, and lighter redraws.
2. **Full audit fixes**: the Filter popup closes; Gantt no longer duplicates the filters; brief "Saved" labels; readable dates; quiet empty priority; clean menus; plain wording on Kanban, Gantt, Calendar and Charts; "Show more" batching; background checking paused off the Projects page; one-call status changes from other views; linked records loaded on demand.

The previous session reported automated and offline Chrome checks for its work. That is historical evidence, not verification of every current interaction. The independent audit found additional defects and coverage gaps:
- **F5 in the real app was never checked.** The local server won't start because `@google/genai` isn't installed in this checkout.
- **Speed on real production data hasn't been measured.** Fresh synthetic scrolling was smooth at 300 and 1,000 tasks per project, but does not measure real network or database cost.
- **Several interactions need correction:** Calendar totals carried into Table, subtask Move defaulting to Root, date and Show more focus loss, lost automation drafts, and other findings in the companion audit.

The task tracker row **1299** in `TASK_TRACKER.csv` is still "In Progress". Mark it Done only after section 4 is complete.

### Files changed by the earlier work (historical ownership list; do not stage from this audit)
- `public/js/crm/projects/board.js`: most of the table work
- `public/js/crm/projects/views.js`: Kanban, Gantt, Calendar and Charts; the filter popup; linked records
- `public/js/crm/projects/remote-observer.js`: pause background checking when Projects isn't shown
- `public/js/crm/projects/presentation/table-layout.js`: column resizing from each section's header
- `public/js/crm/projects/presentation/shell.js`: renamed "Refresh project list"
- `public/css/crm-projects-v2.css`: new styles appended at the end in three blocks, plus one fix at about line 327 closing the `@container` block
- `public/crm-admin.js`: F5 route restore, remembered Projects access, polling pause hook
- `scripts/crm/verify-crm-suite.js`, `scripts/crm/verify-projects-v2.cjs`: registered the new tests
- **Tests (updated):**
  - `tests/crm/projects/v2-columns.test.js`
  - `v2-mobile-accessibility.test.js`
  - `v2-quick-create.test.js`
  - `v2-row-editors.test.js`
  - `v2-views-navigation.test.js`
  - `views-overhaul-ux.test.js`
  - `phase5-views-client.test.js`
- **Tests (new):**
  - `tests/crm/projects/v2-inline-create.test.js`
  - `v2-project-switch-cache.test.js`
  - `crm-admin-projects-reload-route.test.js`
- **Chrome checks (updated):**
  - `tests/browser/crm-projects/v2-quick-create-browser-check.py`
  - `v2-row-editors-browser-check.py`
  - `phase5-views-calendar-links-browser-check.js`
  - `role-view-browser-check.js`

**Protected prior work; never stage whole files based on this list:**
- `public/crm-admin.html` and `tests/crm/projects/v2-entry.test.js` had earlier uncommitted edits. The later authorized loader changes own only their narrow, externally backed-up delta; all prior content remains protected. `tests/browser/crm-projects/phase3-board-browser-check.js` remains untouched by this task.
- Everything else in `git status`.

---

## 2. Issues still to fix (priority order)

### A. Task details panel is sparse and awkwardly laid out
Screenshot: `screens/detail-panel-current.png`
- **What's wrong:**
  - "SELECTED TASK" label above the title.
  - The Owner and Collaborators rows float with large gaps.
  - Dates are centred, with "Working days not confirmed" under them.
  - Every field has a heavy boxed input, so it looks like a form rather than a task page.
- **Where:**
  - `renderOverview(task)` in `board.js` (about line 4442).
  - `presentation/detail-surface.js` (167 lines).
  - Detail styles in `crm-projects-v2.css`: search for `#projects-board-detail`.
- **Target (monday item panel style):**
  - Title as an editable heading.
  - A tidy two-column property list: Status, Owner, Collaborators, Dates, Priority and custom fields. Each value looks like the table cell and becomes editable on click.
  - Subtasks section with the same "+ Add subtask" row as the table.
  - Updates tab unchanged.
  - Remove "Working days not confirmed" from the panel.
- **Keep:** all existing `data-*` hooks and aria labels, which `v2-task-detail.test.js`, `task-detail-modal-ux.test.js` and `v2-task-detail-browser-check.py` rely on. Re-run those three.
- **Additional acceptance:** D06–D13 and D22: focus/caret, text sizing, long titles, custom fields, retained date drafts, overdue state, dependencies/history and notification entry into Updates. Reuse the affected checks; a styling-only change does not justify a new unit-test suite.

### B. Dates editor needs two steps and uses confusing wording
Screenshot: `screens/dates-editor-current.png`
- **What's wrong:**
  - Saving new dates means "Preview dates", then "Apply dates".
  - Extra buttons "Review saved dates" and "Close".
  - "Working days not confirmed" wording.
- **Where:** `board.js`, dates row editor, about lines 2800–2880: `[data-preview-dates]`, `[data-apply-dates]`, `[data-review-dates]`, `[data-rebase-dates]`, `[data-discard-dates]`.
- **Target:**
  - One "Save" action that obtains the server preview internally and applies only when its rules permit it; show material warnings/configuration/conflicts without silently bypassing them.
  - Show the working-day count after saving, when the server provides it.
  - Only show the conflict flow ("these dates changed on the server: keep mine / use theirs") when the server answers with a conflict.
  - Plain wording.
- **Corrected server contract:** `functions/src/crm/projects/view-calendar-service.js:117–143` preserves the submitted dates. Preview checks working-day configuration, dependency warnings, revision and snapshot consistency; it does not shift the dates. Keep its token, expiry, `canApply` gate and exact retry behavior. Decide how advisory warnings should be acknowledged before implementation; do not remove the server preview.
- **Tests to update:**
  - `v2-row-editors.test.js`: "date range preview/apply is atomic…" (about line 263).
  - `v2-row-editors-browser-check.py`: the dates section (about line 150).

### C. Reuse responses across safe query transitions
- **Fresh observation (300 synthetic tasks):** Table → Kanban → Charts → Gantt made no new requests once settled. Entering Calendar made two; Calendar → Table made none; subsequent Kanban made one. The earlier “every switch” diagnosis was too broad.
- **Where:** `views.js`, `setView()` (about line 170) and `resetViewPage()`/`refresh()`. Calendar boundaries, stale state and missing responses matter.
- **Target:**
  - First fix D03: returning from Calendar currently relabels month-scoped totals as full-project totals.
  - Reuse a valid `/views` response only with the complete account/project/query/page/authority key and invalidation rules in D18. Filters and month alone are insufficient. Preserve existing in-flight deduplication, revision reconciliation and access clearing.
  - Refetch only when stale.
- **Tests to respect:** `v2-views-navigation.test.js` ("settled mutations invalidate active projections only and hidden views refresh on activation"). Read it first; it pins exactly when a refetch must happen.

### D. The Table summary triggers an additional expensive project read
- **What's wrong:** Table startup requests `GET /api/projects/:id/views?pageSize=200…` alongside the board load for "N matching tasks · X% complete". The response is paginated; the server still reads and processes the canonical project snapshot before slicing it. See D17 for the verified service path. A small response is not a cheap-query guarantee.
- **Target:** use authoritative full-query counts and leaf completion totals, or delay the summary read until idle/non-table activation and show an honest pending/partial state. Loaded board rows can be paged or include context ancestors; neither matching counts nor completion is safely inferred from that array alone.
- **Where:** `views.js`, `onBoardContext` / `settleListProject` → `refresh()`.

### E. Calendar: implement the user's selected spanning bars
- **Change made:** a task now appears once, on its due date (or its start date if it has no due date). Before, it was repeated on every day it spans. See `screens/calendar-after.png`.
- **Corrected behavior:** the server fetches overlapping intervals, while the grid places each task on its due date/start fallback. A spanning task can therefore count toward the month but be absent from its grid.
- **User decision, September 26:** show a bar spanning the task's working period. Render start-to-due spans across week rows, with continuation at week/month boundaries and readable single-date markers. Shade organization-level non-working days; show authoritative task/owner-specific availability separately so the background does not imply everyone has identical working days. Do not shorten the date span or confuse it with the working-day count.
- Make overflow clickable and keyboard-accessible; qualify current-page lists and ensure access to all matches, including more than 200. Do not impose the earlier three-bar cap without a complete overflow design. Fix local/business-timezone Today behavior. See D14–D16. Code: `renderCalendar()` in `views.js`.

### F. Small text and layout clean-ups
- **Tagline:** the generic line "Keep tasks, updates and your team together." shows under every project without a description (`workspace.js`, line 46). Show nothing, or a muted "Add a description" for Owners.
- **Kanban dates:** cards still show "2026-10-01"-style dates in some places. `kanbanDateChip` now uses `shortDate`, but check the card footers and the Gantt axis labels (`dateLabel` in `ganttMarkup`), which still show ISO dates.
- **Rail item:** the "Project views" item in the left rail is a boxed card; per the UI rule "no boxes in boxes", flatten it (`shell.js`, about line 64, and rail CSS).

### G. Load the Projects code only when the tab opens (completed in the authorized follow-up)
- **Scale:** about 840 KB of Projects JavaScript (about 177 KB compressed) loads on every CRM page.
- **Work involved:** a loader in `crm-admin.js` that injects the `projects/*.js` scripts the first time the Projects route renders.
- **Ownership resolved for this follow-up:** the earlier writers released ownership; root backed up both the dirty HTML and its staged version, then changed only the Projects loading tags and related cache keys. The current result and measurements above supersede this original estimate.

---

## 3. How to verify

**Updated verification policy:** use the companion audit's sections 4–6. No broad new unit-test suite. Reuse the smallest existing checks for changed contracts, a short synthetic desktop smoke before release, then the fuller desktop production walkthrough after explicit deployment authorization. Never run phone scenarios from the earlier scripts. The following earlier notes are retained as diagnostic context, not a blanket command to execute or a pass criterion.

### Existing focused checks
The earlier tests used jsdom from an external runtime. Check that runtime still exists and select only relevant files; do not run the wildcard suite by default:
```bash
cd "/c/Cursor AI" && NODE_PATH="C:/Users/Admin/.codex/external-evidence/projects-v2-wave1-382b/runtime/node_modules" node --test --test-reporter=dot tests/crm/projects/v2-row-editors.test.js
```
- **Historical failure list, not accepted exceptions:** the previous session reported 24 failures. Several involve focus, access and Calendar behavior directly affected by this plan. Compare only relevant failures to an identified baseline or cover them with focused browser evidence; do not declare readiness because the same number fails:
  - The API suites: `phase4-discussions-recovery-api`, `phase5-views-calendar-links-api`, `phase6-engine-notifications`, `phase7-automation-designer-api`, `phase8-data-input-consumer`, `phase9-gemini-context-api`, `phase10-integration-regression`, and "shared accounting rules deny direct clients…".
  - Board scroll/focus tests: "only the passive scroll listener…", "viewport-only scrolling keeps mounted 35-column cells…", "focused editor, drag source and hover rows stay pinned…", "focused checkbox stays attached…", "preserved refresh restores checkbox focus…", "public selectTask refreshes…", "subsequent default render refreshes…", "same-task role downgrade…".
  - Views access tests: "authorized read-only links…", "disjoint calendar month…", "month and Calendar boundary changes…", "new date input invalidates…", "transient view failure…", and "view 401/403/404 clears access…".
- Emulator/persistence suites are separate and should run only when their relevant data/service setup is owned and needed. Do not silently call skipped coverage passed.

### Chrome checks
These run offline with fake data:
```bash
cd "/c/Cursor AI" && python tests/browser/crm-projects/v2-quick-create-browser-check.py --out "<scratch>/qc"
```
- Reuse affected flows from `v2-row-editors-browser-check.py`, `v2-views-navigation-browser-check.py` and `v2-task-detail-browser-check.py`; inspect their scenarios first and select desktop-only coverage. Do not automatically run all scripts for every edit.
- `v2-geometry-browser-check.py` fails the same way on the committed code (Tab order); that isn't caused by this work.

### Offline visual audit (reusable)
The earlier scripts are in `audit-tools/`. They use fake data in headless Chrome, with no server needed. **Do not run `audit.cjs` unmodified: it also runs phone scenarios, which are outside scope.** The independent audit reused only its setup in external desktop-only probes. Its fixture ignores server pagination, has simplified aggregates and treats `n: 0` as five tasks; it cannot prove production speed, totals, paging or an empty project.
- `node audit-tools/audit.cjs <outDir> 300`: screenshots of every view, the menus and the details panel, plus timings (load, edit, scroll, view switches, screen freezes, page element counts).
- `node audit-tools/audit-views.cjs <outDir>`: normal-size screenshots of the views plus a Filter-popup close check.
  - Note: its "popVisible" reading is unreliable; check the `open` flag or a screenshot instead.
- `node audit-tools/harness.cjs <outDir> <label>`: table screenshots plus project-switch timings. `interact.cjs` covers add task, subtask, section and Columns; `switch.cjs` measures switching.
- Run these from the folder that contains them (they load `audit-fixture.js` next to themselves). They use Playwright from `C:/Cursor AI/node_modules`.

### Real app (still outstanding)
1. `@google/genai` remains unresolved in this checkout (fresh read-only check). No dependency installation was needed for this audit. Before later full-app testing, coordinate dependency ownership or use an already compatible isolated runtime; do not alter another session's package/lockfile work merely to run a smoke check.
2. Once running, verify the actual local authentication setup first. The earlier session described automatic emulator-admin sign-in, but this audit did not verify that behavior. Read `C:\Cursor AI\.local\browser-test-credentials.md` before login-dependent checks. Then:
   - Open `https://localhost:8443/crm-admin#projects`, pick a project and press F5: it should stay on the same project.
   - Switch between two projects: the second visit should appear instantly.
   - Go to another CRM page: no new scheduled `/changes` calls should start, and checking resumes on return. An already-started request may finish but must not revive hidden/stale UI. Separately verify that Projects voice activity stops on route departure with a stubbed transport first.
3. After an authorized release, sign in with the admin documented in `C:\Cursor AI\.local\browser-test-credentials.md`. Measure real data reads and performance; use a designated audit project with synthetic tasks for mutations. Follow the companion interaction inventory and record passed/failed/not exercised against the exact deployed release.

---

## 4. Definition of done for this whole piece of work
- **This audit:** completed evidence review and plan extension only. No feature readiness/completion marker or tracker change is implied.
- **Implementation:** A–F plus relevant prioritized audit findings fixed, with explicitly deferred items recorded. Calendar spanning bars are selected; G stays a separate package. File scope must be declared afresh because the expanded findings go beyond the earlier ownership list.
- **Before release:** proportionate checks for changed contracts and a desktop smoke pass; relevant critical baseline failures explained rather than blanket-waived. Preserve drafts, revision/access safeguards and the existing dirty work.
- **After authorized deployment:** complete the desktop production walkthrough and realistic performance observations, including settings and secondary tools. Record unexercised or failing cases honestly.
- Only the owning implementation/release task updates tracker row 1299 and readiness according to `.agent/rules/session_tagging.md`. Do not mark `(D)` before the intended live surfaces pass. Commit/stage only that task's verified owned changes. **No push or deploy** is authorized by this audit. Coordinate HTML ownership and release asset versioning before publication.

## 5. Things that will trip you up
- **Files briefly locked:** something on this machine (other agent sessions are running) holds files open for a moment after they change. Writes can fail with "Permission denied" or `Errno 22`. Retry after a second, or use the Edit tool.
- **Line endings:** `crm-admin.js`, `views.js` and the CSS use CRLF; `board.js` is LF. Keep each file's style (a Python edit in text mode will silently convert it).
- **jsdom test stand-ins:** the fake DOMs used by tests lack `closest`, `querySelector`, `addEventListener` and `clearTimeout` on some objects. Use optional calls (`?.()`) for any new DOM or timer calls in `views.js`.
- **Test-reporter noise:** timers or promises that run after a test's fake window closes fail the whole test file ("generated asynchronous activity after the test ended"). Guard with `node.ownerDocument?.defaultView` or check the scope is still current after every `await`.
- **Same row, new ID:** the table redraws rows by row ID. A newly created section or task changes ID when the server confirms it, so focus has to be put back (see `createSectionInPlace` and the composer focus restore in `renderVirtualRows`).
- **Section blocks:** `groupBlocks()` is true for the desktop table grouped by section. Status/owner grouping retains the other desktop header/form behavior. This audit and its future work exclude phone layouts and phone tests.
- **Kanban edits:** `setTaskField` skips the pre-read when the board's copy matches the command's revision. Don't reintroduce the pre-read; the server's revision check keeps this safe, and the updated `v2-views-navigation.test.js` pins the behaviour.
- **Shared ownership:** before editing, re-read `.agent/rules/parallel-work-safety.md`. The Codex Projects branch `codex/projects-v2-wave1` is already merged here and idle, but check `.git/agent-release/tasks/` for any new active Projects task first.


**Final workspace check:** syntax checks passed for all 27 modified JavaScript source/test files, and the owned diff has no whitespace errors. The structure check reported only `firebase-debug.log`: it changed outside this task after the before snapshot and is not an owned/declared output. Its two findings are an undeclared change and an unregistered root file. The log was preserved; no checker exception or source cleanup was added to hide it. This task is not marked release-ready until that unrelated workspace change is reconciled. The implementation is locally verified, uncommitted and not deployed.
