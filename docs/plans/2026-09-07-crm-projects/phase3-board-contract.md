# Phase 3 primary board execution contract

Activated after root canonical Phase2 closure on commit 3742dd7f56a4fb6ddb9cb67b0a1fddf1fb4f143f. This refines the existing approved scope, without a new approval gate. Root owns design/architecture/audit; a fresh Luna owns implementation and tests.

## Product and integration

Build the actual Projects board in the existing CRM workspace. Keep the bright BEL palette, readable existing typography, blue primary actions, restrained section color accents and generous but efficient spacing. Use one flat table/tree surface with sticky headers and clear indentation, not nested cards or decorative gradients. Provide a project chooser/create action, section creation/rename/order, task/subtask creation and inline title/status/owner/assignees/date/custom-column editing. Owners manage schema; Editor edits tasks; Viewer reads. Project settings and existing People & Access controls remain discoverable and usable. Preserve Teacher Schedule, Staff unified accounts, feature-off behavior and all Phase1 access semantics.

Use focused vanilla modules under public/js/crm/projects, feature CSS and narrow crm-admin.html/js integration. Reuse apiFetchJson and the actual Phase2 routes. Do not create a client-only task database, parallel authorization service, or a second independent selection state that races the existing access controller. Use explicit integration callbacks where shared project selection is required. Escape untrusted text; portals/menus must remain outside clipping containers and obey focus dismissal.

The detail panel follows one stable task ID across inline edits, reparenting and refresh. Show current task fields and parent path; discussions/history arrive in Phase4, not fake completed functionality. Avoid placeholder tabs that pretend later phases are implemented.

## State and hierarchy

Keep canonical task state keyed by ID, expanded IDs, selection/focus and pending edits separate. Load root/child branches with the canonical parentScope filters and cursor continuation; never assume the first200 rows are complete. Flatten only currently expanded loaded branches for rendering. Virtualize visible logical rows with overscan and stable row identity, retaining controls/focus while scrolling. The list DOM must be bounded independently of loaded records.

Use Phase2 exact server ordering; do not invent approximate client persisted ranks. A move sends expected task and structure revisions. Inline edits send expected task revision; schema commands use current expected schema/record revisions. Preserve untouched values and archived values. Keep pending optimistic changes visible, reconcile authoritative responses, rollback known failures, and reuse the same operation ID for retry of an uncertain outcome. Surface conflicts with refresh/retry without silently overwriting newer edits.

Remote refresh must preserve current draft, focus, expanded branches and scroll, and ignore stale responses after project/branch changes. Use canonical snapshot/revision signals and bounded refresh; no whole-board replacement on every keystroke. Do not broaden Phase2 source unless a concrete missing API contract is returned to root.

## Interaction acceptance

Pointer drag supports sibling reorder, section moves and reparenting with indentation/insertion preview, edge auto-scroll and delayed expand-on-hover. Pointer movement is transient; one completed drop creates one logical operation. Cancelled/no-op gestures do not write. Children remain attached. Supply keyboard creation/selection, expand/collapse, move up/down, indent/outdent and focus restoration as actual alternatives. Provide accessible names/states and reduced-motion support.

Inline column controls support every approved type with clear null/clear behavior, eligible people choices and Owner-only Add Column/schema actions. Match the server's typed contract. Menu interactions at viewport and horizontal-scroll edges must receive pointer events and remain readable.

## Verification and ownership

Manifested entrypoints: tests/crm/projects/phase3-board-contract.test.js and tests/browser/crm-projects/phase3-board-browser-check.js. Reuse the existing managed Node22 Auth/Firestore harness and Phase1 real Chrome setup; extend runner emulator selection to Phase3. Only one managed suite at a time, even with alternate ports. Read C:\Cursor AI\.local\browser-test-credentials.md before login planning/execution; the approved isolated demo fixture identities override production login use here. Do not contact production or copy credentials into artifacts.

Prove actual Chrome creation, inline edits and persisted reload, root/child continuation, drag reorder/reparent/section movement, retained descendants, keyboard alternatives, selection/detail continuity, long horizontal/vertical scrolling, clipped-edge menu hit testing, Viewer restrictions, delayed/failed saves, rapid project switches and remote changes while editing. Assert actual API operation counts and persisted state, not only screenshots. Capture settled screenshots and console/network evidence. Inspect bounded DOM/listeners and focus behavior; Phase10 numerical performance targets remain separate gates.

Preserve Phase1 browser semantic assertions; a narrow navigation adaptation is allowed if the existing access panel gains an explicit Board/Access switch, without weakening the authorization/mutation/refresh tests. Root will inspect actual source and screenshots, then independently execute the committed Phase3 canonical package and relevant Phase1 regression before closure.

Owned paths: feature client modules/CSS; narrow crm-admin.html/js integration and matching asset token checks; Phase3 two tests and focused helpers; narrow Phase1 access navigation test adaptation if required; phase runner emulator selection. No unrelated work, root audit/progress docs, Git mutations, production deployment, paid calls or nested agents.
