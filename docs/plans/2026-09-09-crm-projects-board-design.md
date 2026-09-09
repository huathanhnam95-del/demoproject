# CRM Projects approved board design implementation

User approved the rendered preview through coordinator on September 9, 2026. Implementation is authorized; production deployment is not.

## Architecture

Retain all domain controllers and API contracts. A small workspace presentation controller coordinates project navigation, contextual panels, dialog visibility/focus, search submission, and access onboarding. It receives selection/context snapshots from the existing access/board controllers; it owns no parallel project or authorization store. The board retains virtualization, drafts, revision checks, recursive task structure and mutation behavior.

## Exclusive ownership

- Shell worker: public/crm-admin.html and public/css/crm-projects.css only. Preserve all existing element IDs/forms/name attributes and non-Projects HTML. Add workspace rail and dialogs. New workspace.js script is loaded before crm-admin.js. Use 46px board rows to preserve current virtualization geometry. Match approved preview using readable inputs with quiet borders, status colors, aligned column grid, group accents and compact tools.
- Board worker: public/js/crm/projects/board.js and tests/crm/projects/board-presentation.test.js only. Preserve the completed canonical creation endpoint fix. Add safe group accents/collapse, status attributes and owner avatar presentation while retaining actual editable fields, typed custom columns, focus/draft updates and row virtualization. Integrate matching presentation attributes into updateExistingRow, not only fresh markup.
- Root: new workspace.js, crm-admin.js integration, workspace-presentation.test.js, durable plan, external Chrome/emulator harness/evidence. Root owns every browser/emulator/runtime process and final audit.

## Shared DOM contract

Shell: .crm-projects-workspace-shell wraps aside#projects-workspace-rail and main#projects-workspace-main. nav#projects-workspace-projects holds project buttons. button#projects-workspace-rail-toggle toggles narrow rail. Existing #projects-board-project-select remains hidden for compatibility; selection changes still delegate to access.selectProject. #projects-workspace-name/#projects-workspace-description display selected project. #projects-workspace-onboarding contains #projects-workspace-onboarding-title, #projects-workspace-onboarding-message, button#projects-workspace-manage-access. Existing empty/create controls retained.

Shell: #projects-workspace-settings is a native dialog with data-projects-dialog and hidden. Its buttons use data-projects-settings-tab values project, members, calendar, allowance; section panels use data-projects-settings-panel with matching values. Existing #projects-board-settings, #projects-member-access-section, #projects-calendar-section and #projects-allowance-section move inside corresponding panels, preserving IDs. A button[data-projects-open="projects-workspace-settings"] opens it. Every dialog has button[data-projects-close].

Existing task detail, project-create and column-create containers become native dialogs marked data-projects-dialog, preserving IDs/hidden behavior. Root observes hidden changes from existing controllers to showModal/close, preserves native focus trapping, and connects Escape to existing cancel/close buttons. Section form may stay compact as explicit inline group creation because it is already contextual and hidden until requested. Assistance/notifications/automation/recovery stay accessible via compact details or explicit contextual panels; they must not appear above the board as persistent form stacks.

Existing form#projects-view-filters remains one form with all named fields. Its title-search field is the visible compact search; all other fields and Apply/Clear live inside a Filter details popup. Root debounces search input into requestSubmit so existing views controller owns filter state. Existing view buttons and handlers remain unchanged. Keep all actual task columns, including accountable owner, additional assignees and date range; prototype simplification is not permission to remove fields.

## Acceptance

First project creation sends one canonical POST; changed actor and pending existing-task authority remain fenced. Authorized synthetic local identity creates persisted project, sections, root and nested task, custom column; title/status/column edits survive reload. Board, Kanban, Timeline, Calendar, Charts remain selectable. Real dialogs open/close via keyboard and restore focus. At desktop, primary board is visible above the fold; at 390px no page overflow and table horizontal scrolling is contained. Empty/access states preserve the same shell and offer actionable authorized next steps. No automatic grants, customer writes or paid calls. Root audits code, test assertions and actual screenshots; old functional smoke is not reused as design acceptance.

## Local acceptance result

Implemented and locally verified on September9,2026:27 focused tests and38 actual Chrome/emulator assertions pass. Source and evidence: `C:/Users/Admin/Documents/Codex/2026-09-08/crm-projects-recovery/work/projects-design-recovery/acceptance.md`. Independent modal-navigation and tab-accessibility findings fixed. The older phase3-board-contract extracted-function test fails identically on baseline9efe with missing captureScope; this limitation is documented separately. No deployment or push.
