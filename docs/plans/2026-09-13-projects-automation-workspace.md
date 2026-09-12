# CRM Projects automation workspace redesign

## Scope and guardrails

This plan implements the frontend-only CRM Projects utility and automation workspace redesign requested by the coordinator task `01a097a1-b651-7a01-a935-b4acbdfafafd`. It applies to the isolated candidate worktree only. It does not add server routes, change Functions or workflow execution, add integrations/schedulers, send notifications, mutate production data, push, or deploy.

The candidate begins at `c6544a840987f47645600646baae4e1d52d00047`, which combines verified commit `d188648e36ef0c505951fdb622536654051adb82` with released predecessor cleanup `0f2819aa2c955f812371d760fc7e079050cae8d3`. The predecessor’s board presentation cleanup and the newer typography/UI-scale/board behavior are protected inputs.

## Existing contracts to preserve

- Projects HTML loads classic browser scripts. Preserve global registrations and script order; do not convert the CRM bundle to ESM.
- `CrmProjectsWorkspace` owns shell navigation, account/project scope reset, utility selection, dialog lifecycle, and focus restoration. `CrmAutomations` owns automation draft, list/detail, preview, mutation, history, and stale-response fencing. Keep these responsibilities explicit and avoid duplicate roots, controllers, IDs, observers, or render loops.
- `CrmAutomationDefinitionEditor` remains the schema authority: schema version 1, existing trigger/action types, node IDs, definition ordering, references, conditions, nested `if` branches, typed values, validation, and immutable edit helpers remain intact. Complex saved definitions must round-trip through the existing detailed editor without flattening.
- `CrmAutomationsRenderer` remains the shared output contract for labels, typed controls, read-only definitions, and safe preview output. Add presentation helpers only when they consume the existing definition/context contract.
- Preserve existing mutation semantics: explicit save/create, preview, and activation remain separate; readiness, owner access, revision, generation, preview-token, conflict, pending acknowledgement, and stale actor/project guards remain effective.
- Preserve the newer local Noto Sans Medium/font-synthesis behavior, 70–150% UI scale with 5% steps and 125% default/local persistence, draft/selection stability, theme synchronization, and unscaled `.crm-projects-portal-host`. Modal and picker geometry must cooperate with that portal and never apply a second scale.
- Preserve predecessor board cleanup: visible column dividers, centered data headings with Task left, single-cell section rows without root badges, no decorative status chevron/title progress ring/always-visible keyboard hints, and the newer 44px row-height/date/people/task-creation behavior.
- Keep `projects-project-links` as one actual container with the existing listener/controller ownership and authorization/loading behavior; only relocate its presentation.

## Implementation design

### 1. Full-screen utility shell

Use the existing utility rail as a compact launcher and add one accessible full-screen workspace dialog around the existing utility panes. The dialog has one title/close control, a clear active utility heading, and one intended scroll region. The utility buttons remain keyboard-operable tabs and retain a single selected pane. Opening Automate and selecting the Automations launcher use the same shell path. Escape closes the nested picker first, then the workspace; close returns focus to the launcher or originating control and restores the board state.

The workspace controller will own open/close and selected utility state. It will close stale dialogs and clear selection on account/project/lifecycle/permission reset, while preserving an in-progress automation draft during ordinary tab/back/close/reopen navigation. Existing assistant, notifications, and recovery content receives the larger surface only; their behavior is not redesigned. The View options popover remains on its existing unscaled portal path.

### 2. Linked records relocation

Move the existing `details`/`projects-project-links` container from the board content into a `linked-records` launcher pane. Do not clone or rename the ID. Keep the existing `views.js` renderer, event delegation, loading and access gates, student/lead/class links, and reset clearing behavior. Assert one occurrence of the ID and no old board-content occurrence.

### 3. Automation gallery and manage surface

Refactor the existing automation renderer/controller output into a spacious top-bar workspace with project name, Create/Manage tabs, close, search, and status. Create defaults to a gallery containing only `CrmAutomationDefinitionEditor.RECIPES`: status move, subitem rollup, due-date alert, and auto-assign. Include a visible Create from scratch card. Manage retains list search/folder/enabled filters, pagination, empty/loading/error status, duplicate/edit/enable/disable/history/run actions, and existing safety messages. Remove the slogan and redundant instructional paragraphs without removing labels, errors, draft status, or advanced safety controls.

### 4. Simple builder and picker

Add a lightweight recipe presentation backed by the same `draft.definition`. A new from-scratch draft is explicitly unselected: it has no silently accepted default trigger/action. The builder shows a readable clickable When phrase and Then phrase connected vertically, a primary Create automation/Save action, and an Advanced route into the existing detailed editor for conditions, branches, multiple steps, and secondary metadata.

The trigger/action picker is a single searchable, keyboard-operable popup with supported choices derived from the editor’s authoritative arrays. It supports empty-search feedback, Escape/arrow/Enter behavior, focus restoration, and the existing theme/scale/portal geometry. Trigger configuration exposes only relevant fields: status from/to, due-date time/offset, and no irrelevant controls. Action configuration maps into existing typed payloads for set field, assign, move section, create task, notify, delay, or if as applicable. Selection changes remain local draft changes; required target/field/value fields are visible and validated before save. Template selection creates a local draft through the existing recipe factory and opens the same builder.

Draft edits must preserve title/folder/run-as actor values and complex definitions. Keep title/folder/run-as-owner behind a compact details control when not needed, but surface their validation errors and never change run-as implicitly. Keep preview, activation, recovery, and history in appropriate Advanced/Manage contexts.

### 5. Testing and evidence

Extend focused non-browser tests before and during implementation. Cover blank-builder validation, picker-to-definition mapping, supported recipe gallery/no network mutation, complex branch identity/order preservation, tab/back/picker/modal draft retention, account/project reset, activation guards, single relocated links container/controller ownership, and UI-scale/portal non-regression when touched. Keep tests against actual controller/editor/renderer contracts; do not build a fake UI-only test harness that bypasses them.

Run only targeted Node tests, `node --check` for changed classic scripts, targeted CRM ESLint/structure checks, and `git diff --check`. Per explicit user override, skip Playwright, browser-agent, screenshots/visual regression, emulator/backend integration, live browser validation, and broad CRM verification that would run excluded suites. Report browser/visual behavior as intentionally unverified. The separately captured current-main date-picker patch is intentionally not imported because this redesign adds no new date-picker surface requiring that exact coordinate correction.

## Acceptance checklist

- [ ] Contract and before snapshot are retained externally; final delta is compared with the allowlist.
- [ ] Utility icons remain compact launchers; each selected utility opens one accessible full-screen workspace with no clipped buttons or duplicate IDs.
- [ ] Linked CRM records has one relocated container and existing data/controller semantics.
- [ ] Create gallery and Manage list use existing supported recipes/actions only.
- [ ] From-scratch builder starts unselected, requires valid trigger and action, supports searchable keyboard picker, and maps typed values into schema v1.
- [ ] Templates and existing edit/rule entry points open the correct simple/advanced surface without auto-save/activation/network mutation.
- [ ] Complex definitions retain branches, ordering, node IDs, references, conditions, and compatible values.
- [ ] Account/project/lifecycle/permission resets fence stale UI and drafts correctly; ordinary close/back/tab navigation retains draft state.
- [ ] Noto Sans/UI scale/theme/portal and predecessor board cleanup contracts remain intact.
- [ ] Focused tests and static checks pass; browser/UI/emulator checks are explicitly skipped.
- [ ] No push or deployment occurs.
