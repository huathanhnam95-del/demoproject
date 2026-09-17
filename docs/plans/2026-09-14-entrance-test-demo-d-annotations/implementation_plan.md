# Demo D evaluator: contextual annotations implementation plan

> For execution: use the approved plan task by task. This document authorizes no implementation, production writes, push, or deployment until the applicable user approval is given.

```yaml
ArtifactMetadata:
  RequestFeedback: true
  Status: Proposed - awaiting user approval
  TaskId: entrance-test-annotations-plan-20260914-01a09e1e
  Owner: Codex root
  LongTermFeatureOwner: unresolved
  Route: Light - direct execution, no subagents
  Model: Astra Medium
  Speed: Standard
```

**Goal:** Make Demo D the evaluator's sole visible design and let authenticated reviewers circle any rendered Demo D region, save contextual feedback, and find/edit/delete it later without losing ratings or disturbing the assessment demo.

**Architecture:** Keep the CRM host responsible for identity, Firestore access, the feedback list, and the comment dialog. Put selection, semantic anchors, and a disposable SVG overlay inside the Demo D iframe. Exchange small, validated messages through a versioned host/frame protocol. Store annotations separately from ratings and assessment drafts.

**Tech stack:** Existing vanilla JavaScript, classic CRM entrypoint with dynamically imported ESM feature modules, browser SVG/Pointer Events/DOM Range APIs, existing Firebase compat client and Firestore rules, Node tests, Firestore emulator, Python Playwright with installed Google Chrome. No annotation vendor, screenshot service, new backend endpoint, or drawing library is required.

## 1. Evidence, scope, and source baseline

This is a plan, not an implemented feature or a fresh functional certification of Demo D. Repository observations, current HTTP observations, and historical reports are distinguished below.

### Current source and Hosting observations

| Evidence | Verified observation | Consequence |
|---|---|---|
| Shared checkout `C:/Cursor AI` | HEAD `d188648e36ef0c505951fdb622536654051adb82`; extensive unrelated dirty/untracked work; root `implementation_plan.md` already modified. | Do not implement here or overwrite the root plan. This plan lives in its own folder. |
| Demo D candidate `C:/Users/Admin/.codex/worktrees/entrance-test-ui-demo-release-20260913/Cursor AI` | Clean when inspected; HEAD `42f829389216ed9214c7f373484269d3528130d0`, containing the Signal Noto visual redesign. | Confirmed implementation baseline: the originating task verifies this exact approved release was deployed, including authenticated Chrome and byte-for-byte asset hashes. Use this commit and worktree, not the older shared checkout. |
| Candidate host `public/js/crm/entrance-test-ui-lab.js` | Four skins; default B; 8 pages × 5 criteria × 4 skins; D iframe URL `/entrance-test-ui/?revisionId=academic-noto-v1`. | D-only work must update default, controls, help, progress, result calculations, and tests together. |
| Candidate host layout | `public/crm-admin.css`: 340px rating column; iframe height 760px, 620px at narrow breakpoint. The iframe owns its document scrolling. | A drawing surface outside the iframe would have to track two documents and clipping; put it inside. |
| Candidate child | `public/js/entrance-test-ui/app.js` renders header and app via `innerHTML`, preserves some transient/media nodes, emits page changes; host checks origin but not source window; child receives navigation/font messages without origin/source validation and emits with `*`. | Annotation dialog must survive app rerenders. Harden the touched bridge on both ends before passing feedback. |
| Revision contracts | Draft/bridge revision `academic-noto-v1`, content `entrance_test_36plus_v1`; shell visual revision `signal-noto-v2`. | Do not bump the draft revision merely to add annotations. Give annotation schema and visual compatibility their own versions. |
| Ratings | Direct Firestore `entranceTestUiRatings/{slugifiedName}`; fields `name`, `ratings`, `fonts`, `createdAt`, `updatedAt`; admin rules; local identity key `crm_et_ui_rater_v1`. | No learner API is involved. Keep this collection/schema and its historical keys. |
| Demo drafts/audio | IndexedDB `bel-entrance-test-ui-demo`, version 1; attempts/recordings/meta; active attempt local key `entrance_test_ui_demo_v1:activeAttemptId`; revision-aware save/recording recovery. | No schema migration, reset, recording upload, or annotation data in this database. |
| HTTP checks during planning, September 14 | Both `listening-tasks-3ae34.web.app` and `.firebaseapp.com`, including cache-busted requests, served a host script with no D. `/entrance-test-ui/` returned the general Dictation Practice HTML. D module/CSS paths on `.web.app` also returned HTML rather than their required content types. | Record a discrepancy in this task's HTTP probing. The originating task separately confirms the approved application routes and deployed hashes at 42f829389. These probes do not replace that baseline or establish that the deployed application was rolled back; recheck the exact served routes at release time. |
| Historical release evidence | `C:/Users/Admin/.codex/audits/entrance-test-ui-demo-release-20260913-01a09829/production-crm-demo-d.json` records authenticated CRM with four skins and a working same-origin D iframe. | The originating task also confirms the later approved 42f829389 release on both the authenticated CRM route and standalone D route. This plan did not repeat that browser verification; keep its direct HTTP observations separately labeled. |

The intended origin model is same-origin CRM and iframe on the chosen Hosting domain. Resolve iframe origin from its configured URL. Do not infer cross-origin support from the existence of both Firebase domain aliases, relax origin checking, or read a cross-origin DOM. If subsequent release verification reveals a deliberately separate iframe host, explicitly extend the origin allowlist and test that two-origin arrangement before release; the child-owned overlay/message architecture still applies.

Planning evidence directory: `C:/Users/Admin/.codex/audits/entrance-test-annotations-plan-20260914-01a09e1e/`. Retain `structure-contract.json`, `structure-before.json`, `live-route-check.json`, and the reviewed draft together. Restore source observations from the named commit and HTTP observations from the retained record. Long-term product ownership remains unresolved; the implementation root owns package delivery and evidence.

### Reports and PDF feedback

Read inputs: `C:/Cursor AI/docs/entrance-test-ui-analysis.md`, `docs/audits/entrance-test/2026-09-13-ui-claims-audit.md`, `docs/audits/entrance-test/2026-09-13-demo-d-visual-reaudit.md`, and the September 13 demo handoff/visual redesign plans. The claims audit qualifies several original report conclusions: A/B/C share an engine, historical ratings lack visual-revision/viewport context, and preference scores do not prove task performance.

Original `C:/Users/Admin/Downloads/Entrance Test.pdf`: 15 pages, SHA-256 `d17f00c4f8ce966b7b6e6b6f148570f184810b7cc27264cb9aa3ffdea6b4bcc1`, rechecked during planning. Text read from all pages; existing page 6 and 9 renders visually inspected. Page 6 marks redundant recording-duration copy directly on a screenshot. Page 9 places a contextual comment beside the vocabulary region about scrolling and dropdowns. This is the workflow to replace, rather than a requirement to export another PDF.

| PDF locations | Context that browser feedback must be able to address |
|---|---|
| 2–3 | Whole layout, typography, welcome heading, redundant text. |
| 4–6 | Mic visualization, playback, speaking instructions/passage, recording controls/caption. |
| 9–12 | A specific blank, a passage fragment, selected-answer state, listening transport. |
| 13–15 | Review summary, numeric typography, section/group navigation and answered states. |

Keep the original PDF and reports. Do not infer positions from old screenshots and import them as new D comments; the layouts and provenance differ. This package adds the feedback mechanism, not another visual redesign or automatic implementation of each old suggestion. Existing learner-result PDF generation remains protected.

## 2. Product decisions specified by this plan

1. Demo D is the only visible design across the evaluator's initial state, navigation, help, progress, and results. No A/B/C buttons, comparison cards, or hidden keyboard-accessible version controls remain. Keep their standalone lab assets/routes and stored ratings for compatibility and rollback.
2. D retains its ordinary five-star controls and exact `d:<page>:<criterion>` keys. Visible score completion is 40/40. Results remain gated on D completion and at least one font vote per language, preserving the existing font requirement and maximum of two picks. Legacy font selections still satisfy that requirement; do not force new votes or silently vote Noto.
3. Existing A/B/C ratings are retained but excluded from D progress/averages. Previously complete 160-score reviewers appear complete for D; reviewers with only 120 historical A/B/C scores still need D's 40 scores. Invalid/missing values do not count. Font results are labeled historical, cross-design votes so they are not misrepresented as D-only measurements.
4. Comments are shared among authenticated admins, available without completing ratings, default filtered to the current D view/question. This follows the current shared review model. There is no separate approval workflow, threaded replies, notifications, or scoring impact.
5. Preserve current CRM authentication and typed reviewer entry. The login UID proves the authenticated account; the typed reviewer name is attribution supplied by the reviewer. With a shared account it cannot prove a distinct person. All admins may edit/delete shared feedback, with last-editor attribution. Do not add a cosmetic “owner-only” rule that the shared account cannot enforce.
6. New feedback uses explicit Save. Unsaved text stays visible through retry/conflict. No durable offline comment queue in version 1; cross-reload persistence is guaranteed only after server acknowledgment. Before leaving a dirty comment, offer Keep editing or Discard. Provide Copy text for recovery. Do not put comments into the assessment draft store.
7. Region capture covers the rendered iframe content, including header, footer, controls, text, whitespace, and open in-page disclosures. The pen belongs to the evaluator host. Native OS browser popups, browser chrome, and off-document regions cannot be annotated; their underlying control can. Multiple strokes/pages per comment and screenshot uploads are outside this first version.

These are proposed defaults for plan approval, not additional unanswered questionnaires. The existing project continues under Astra Medium, Light route, Standard speed; no subagents or model change is implied. Difficult unresolved planning should be surfaced with an Astra High/X High recommendation, not a claimed silent setting change.

## 3. Reviewer interaction and states

Place a labeled pen button “Annotate” and “Feedback (N)” beside the iframe caption. Use a compact toolbar on the existing surface, no nested card stack. At narrow widths use a single-row toolbar and a host-level feedback drawer; it must not shrink the iframe each time it opens. Keep ratings usable.

| State | Behavior and transitions |
|---|---|
| Loading/unavailable | Disabled pen with reason until authenticated identity, D bridge, and annotation read capability are ready. A failed comments query is an error, not “0 comments.” Retry is available; the demo still works. |
| Browse | Default. Overlay and all graphics have `pointer-events:none`; no invisible hit area covers answers/audio/navigation. View comments through the host list. Show/hide marks is independent of entering draw mode. |
| Armed | Pen has `aria-pressed=true`; pointer becomes crosshair inside the frame; short hint explains circle, Escape, and keyboard alternative. Drawing layer takes pointer input. Wheel/trackpad scrolling remains available between strokes; a “Browse” toggle restores touch scrolling and normal interaction. |
| Drawing | Primary pointer only; capture pointer in iframe. Show a live stroke and capture its bounds in CSS pixels. Ignore second pointers. Cancel on Escape, pointercancel/lost capture, iframe navigation, resize, or scroll during the stroke. Do not allow underlying clicks. A tiny click/gesture below 8 CSS pixels is not a valid region. |
| New comment | On pointerup, turn the circular gesture into a clean ellipse around its selected bounds and resolve anchors; immediately open host modal with target label, reviewer name, current screen/question, textarea, Save, Cancel. The draft mark is visible. Save is disabled for blank/whitespace-only or over-2,000-character text. IME composition must not trigger Save. |
| Saving | Disable duplicate Save; show Saving. Freeze submitted ID/payload; no second document on repeat click. Do not display Saved until the server confirms. |
| Saved | Add/update list item, announce success, close modal, restore focus, return to Browse. Show selected mark briefly; persistent outlines follow show-marks preference. |
| Editing | List Open highlights target and opens read view; Edit retains same annotation ID and expected version. Region stays immutable; an explicit Re-anchor action selects a new region and saves a versioned update. |
| Deleting | Confirmation names the comment/region; cancel is default focus. Delete is a versioned soft deletion so it can be undone and audited. Remove it from ordinary results only after acknowledgment. Offer Undo using a new transaction. |
| Offline/error/conflict | Preserve text and mark; show specific retry/re-auth/conflict action. No automatic overwrite or automatic retries after identity changes. |
| Target unavailable | Keep the comment in the list with screen/question/revision and reason. Do not draw it on another node. Allow Edit text, Re-anchor, or Delete. |

The feedback list has Current screen / All Demo D / Mine filters, count, concise comment text, reviewer, creation and edit times, target label, and Open/Edit/Delete actions. Sort newest first; initially fetch 50 and support cursor-based Load more. No unbounded collection read on every render. Subscribe to the loaded page while open and dispose subscriptions when closed or leaving CRM. A specific annotation can still be opened by ID.

Open navigates by the stored view **and exact questionId**, waits for frame context acknowledgment and final layout, then scrolls the target into view and highlights it. Do not navigate to the first vocabulary question when the annotation belongs to `vocab_q4`. Existing page buttons can keep their section-first behavior. Returning to a context must not restore answers, overwrite the current draft, replay a recording, or fake a completed state. Disclosures can be revealed explicitly; annotations on unavailable dynamic states say so.

Canceling a new comment removes only its draft mark. Canceling Edit retains the saved version. A dirty modal intercepts host rater/results/panel changes; Keep editing preserves it, Discard releases it. Handle browser unload with the browser's native dirty-page prompt where supported; explain that forced close cannot guarantee recovery. Sign-out removes rendered feedback and subscriptions immediately and cancels pending writes; keep recoverable unsaved text only in the active dialog/memory with no further submission until authentication is re-established and attribution reconfirmed.

Do not auto-stop or restart recording/audio for annotation mode. While an annotation dialog blocks the frame, expose a safe Stop recording control if capture is active; send it through a narrowly validated existing audio action adapter. Do not add a second recording pipeline. Listening playback may continue, and its current time/media identity must survive modal activity. Choosing Browse returns access to the normal controls.

## 4. Overlay, region identity, and coordinate strategy

### Alternatives considered

- **Recommended: semantic anchors plus local geometry inside the iframe.** Tracks content when responsive layout rearranges it, permits rerender recovery, and leaves the host independent of child DOM details.
- Whole-document normalized coordinates: easy but positions drift when text wraps, footers move, or heights change; unsuitable as the source of truth.
- Screenshots plus annotations: preserves a frozen picture but recreates the PDF problem, adds storage/privacy/deployment surface, and does not follow live interaction. Do not add it here.

### Stable target registry

Add nonvisual `data-et-annotation-id` attributes to the existing rendered markup, never selectors based on `nth-child`, random IDs, text of an answer, or transient array positions. Examples:

```text
shell/header, shell/tools, shell/footer
intro/title, intro/body, miccheck/instructions, miccheck/recorder
question/speaking_q1/instructions, question/speaking_q1/passage, question/speaking_q1/recorder
question/vocab_q1/passage, question/vocab_q1/blank/vocab_q1__b1
question/listen_write_q1/player
review/summary, review/group/<actual-questionId>, done/receipt
nav/section/<actual-sectionId>, nav/question/<actual-questionId>
```

Use IDs actually present in normalized data, not assumed examples, and assert registry uniqueness in every rendered view. Also register stable layout regions for page background, header gaps, and the space around a component. Keep the registry/data lookup in the child feature module and structural attributes in view/index markup. No new wrappers solely to carry an anchor.

Context key: skin D + contentVersion + annotation visual revision + `view` + exact `questionId` when applicable + relevant disclosure/component state. Locale, chosen fonts, text scale, viewport dimensions, and capture layout signature are metadata. Anchor versions are distinct from draft schema/revision.

### Capture and replay algorithm

1. Use a fixed-position SVG root in the iframe with a CSS-pixel viewBox matching its visual viewport. It is a sibling outside `#et-app` and `#et-header-tools`, which Demo D replaces on render. Preserve overlay state in its controller, not those nodes.
2. During a stroke, store child `clientX/clientY` points temporarily; ignore `devicePixelRatio` for CSS coordinate math. Normalize a completed mark to an ellipse and discard the raw point stream. Record original bounding rect, frame viewport, visual viewport offset/scale, and scroll positions for diagnostics, never as the authoritative replay target.
3. Hit-test underlying registered elements with the drawing layer temporarily excluded. Select the smallest stable component(s) intersected by the mark. Whole-component selection stores its ID plus local fractional rect. For part of text, resolve a DOM Range using stable text-run IDs/character offsets and a bounded quote/fingerprint for validation. Reflow uses `Range.getClientRects()` rather than the old paragraph bounding box.
4. A comment can contain up to eight anchor fragments. Prefer a stable enclosing component for larger selections; for many text/control intersections within one passage use its stable text-run ranges. Do not silently drop ninth-and-later targets. If a selection needs more fragments, preserve it as an explicitly labeled layout-region anchor within the stable common container and apply the stricter layout-match rule below.
5. For an element fragment whose current rect is `(left,top,width,height)`, reconstruct each local edge using `x = left + u*width`, `y = top + v*height`, where stored local fractions describe the selected part. Re-resolve elements after every render. Text ranges supply current line fragments. Combine resolved selected fragments into the highlighted semantic region. Use a clean ellipse for one contiguous region; for responsive disjoint regions use connected outlines with one comment number, so intervening unrelated content is not falsely selected.
6. Content anchors retain their target across desktop/mobile, font load, text size, and ordinary viewport/iframe scrolling. The annotation describes the same UI content; its outline adapts as that content reflows. At the capture layout, replay matches the original region within the acceptance tolerance below.
7. Blank-space/layout-only marks have no immutable content meaning when a responsive layout removes that space. Anchor them to stable neighboring/container IDs and relative edges; replay only while that geometric relationship remains valid. On a topology change, show “Layout changed; re-anchor” and keep the comment discoverable. Do not promise exact coordinates for a region that no longer exists or silently snap it to the viewport.
8. If an ID disappears, is duplicated, a text fingerprint mismatches, the content/anchor schema is unsupported, or the recorded dynamic state is absent, mark it unresolved. Keep original anchor/context for recovery. No fuzzy text match across different question groups. Re-anchoring is an explicit versioned edit with audit metadata.
9. Clip overlay paths to iframe viewport and relevant scroll container clips; do not paint on host controls or outside the frame. Fixed/sticky header/footer targets are resolved from their current DOM rectangles; they do not receive document scroll offsets twice.

Schedule layout reads and SVG writes through one `requestAnimationFrame` update per frame. Trigger from a capturing scroll listener (including nested scroll containers), resize/visualViewport events, a bounded ResizeObserver, `document.fonts.ready`/loading completion, and an explicit child-render notification. Use a narrowly scoped mutation fallback for disclosure/content changes; do not observe the overlay itself or run a full-tree mutation loop. No permanent polling or persistence writes on scroll.

Destroy listeners, observers, pending animation frames, pointer capture, and bridge generation on iframe unload/replace, CRM panel exit, rater switch, and sign-out. Re-initialize idempotently on return. Overlay operations must not call assessment `dispatch()` or `enqueueDraft()` unless the user explicitly uses navigation or the existing Stop control.

## 5. Host/frame protocol and lifecycle

Create protocol `etui:annotations:v1` with a random host-session nonce, monotonic frame generation, request ID, fixed type/action allowlist, D skin, content/visual revisions, and bounded payload validation. Nonce is correlation, not authentication; Firestore rules remain the security boundary.

- Host sends only to `new URL(frame.src, location.href).origin`; receives only from that origin **and** the current `frame.contentWindow`.
- Child accepts only the configured same-origin parent and `event.source === window.parent`; sends to that exact origin, never `*`. Top-level standalone mode has no annotation parent and no annotation controls/data.
- Host init follows iframe load/ready. Child acknowledges capabilities, context and generation. Reject stale messages from old frame/window/nonce and unsupported versions. D-only host cannot navigate into legacy skins via messages.
- Actions: init, set-mode, render-annotations, navigate-target, cancel-selection, stop-active-recording; events: ready/context, region-selected, mode-changed, layout-unavailable, target-opened/error. Host owns read/write/comment actions. Do not expose arbitrary selector, script, HTML, or arbitrary URL commands.
- Extend context to exact question ID and view; rate attribution still maps to the existing eight page IDs. Header/footer anchors include the current screen context unless explicitly marked global. Invalid/unknown question IDs cannot mutate the demo.
- Modal/list updates do not call the host's full `render()` and recreate the iframe. Host annotation mount lives outside replaceable rate-column markup. Async results are scoped to captured reviewer/auth/frame generation and ignored after a switch.
- Harden existing `etui:goto`, `etui:fonts`, `etui:page`, and ready messages at the touched boundary. Maintain draft revision `academic-noto-v1`. Normalize the observed host `vn`/child `vi` mismatch at the bridge adapter; resolve only valid font catalog IDs to the intended family and load them. Reset restores Noto and changes no vote. Do not refactor the shared font catalog or unrelated language rendering.

## 6. Data schema, persistence, security, and conflicts

### Collection and document

Use a new sibling namespace:

```text
entranceTestUiAnnotations/demo-d/items/{annotationId}
```

Generate the annotation ID once with `crypto.randomUUID()` when a draft region is created; retain it for retries. Root namespace document need not be writable. No document lives under a rater slug or learner attempt.

```text
schemaVersion: 1
skin: 'd'
contentVersion: 'entrance_test_36plus_v1'
visualRevision: 'signal-noto-v2'
anchorSchemaVersion: 1
context: { page, view, questionId|null, componentState }
anchor: {
  kind: 'content'|'layout',
  fragments: { f0: Fragment, ... f7?: Fragment },
  layoutSignature, label
}
Fragment: {
  kind: 'element'|'text'|'layout', targetId,
  rect: { x0, y0, x1, y1 },
  text: { runId, start, end, fingerprint, quote } | null
}
capture: { frameWidth, frameHeight, scrollX, scrollY,
           visualOffsetX, visualOffsetY, visualScale,
           locale, textScale, fontEn, fontVi, buildId }
body: plain-text string
author: { uid, raterId, name }
lastEditor: { uid, raterId, name }
createdAt: server timestamp
updatedAt: server timestamp
version: integer >= 1
lastMutationId: UUID
deleted: false
deletedAt: null
deletedBy: null
```

`rect` is local fractions in `[0,1]`, ordered with positive extent; layout padding must be represented against its encompassing registered region rather than unbounded fractions. Text offsets refer to immutable normalized demo text runs, excluding user-entered answers. Quote is at most 160 characters and optional for nontext anchors. No HTML, screenshots, raw DOM, audio, answer values, auth tokens, or full page URL/query strings are stored. `buildId` identifies the served candidate, not an invented commit from client input. On update retain creation context and author; changing region updates anchor/context/capture and last editor only.

### Rules and validation

Extend `firestore.rules` at the specific new path; preserve existing ratings and all learner rules. Reuse the existing `isAdmin()` check (`users/{uid}.isAdmin`), not a typed name, localStorage flag, or client-supplied role. Signed-out and non-admin users cannot read/list/create/update/delete. No public annotation reads even though the demo HTML is public.

Define strict keys/types at every map level. Validate page/view enums and combinations, D-only namespace, bounded IDs/strings, body length 1–2,000 with at least one non-whitespace character, author/editor UID equal to `request.auth.uid` for the operation, name 2–80 characters, raterId at most 60, integer versions, finite bounded coordinate values and positive rectangles, at most eight fragments, offsets within explicit bounds, capture dimension/scale limits, and known schema version. Use fixed fragment keys f0–f7 and call a fragment-validation helper for each present entry; do not rely on an unsupported rules loop. Unknown fields/types/revisions fail closed. Rules tests must include NaN/nonfinite and deeply malformed nested payloads, not just top-level keys.

Create requires version 1, identical author/lastEditor, `createdAt == updatedAt == request.time`, deleted false/null metadata. Update requires old immutable author/createdAt/schema identity retained, `version == old.version + 1`, and `updatedAt == request.time`. Last editor must match the authenticated UID; body-only updates cannot silently change immutable identity. Content/revision moves require explicit re-anchor operation within supported values. Hard delete is denied in normal client use. Soft-delete/restore must maintain a consistent flag/metadata pair and use versioned transactions. The shared-login limitation remains documented.

Read/query: order items by createdAt descending and document ID as tie-breaker; limit 50 with cursor pagination. Filter current screen/reviewer/deleted state locally within loaded pages, showing “loaded N”/Load more accurately; no claim of a global filtered count without traversing all pages. Include deleted records in the bounded backend query so undo/version conflict remains available. This avoids a composite-index requirement; verify the exact query in emulator/staging. Do not alter indexes preemptively.

### Transactions and failure semantics

- Create transaction reads the chosen ID. If absent, writes version 1 with server timestamps. If present with the same mutation ID/payload, treats it as the already-committed result; otherwise shows conflict. A request timeout followed by retry must never duplicate the comment.
- Edit/delete/restore/re-anchor transaction reads the latest document and compares the captured expected version. Mismatch returns a conflict with current remote text/version. Do not let Firestore's automatic retry turn a version mismatch into last-writer-wins. Offer Review latest, Copy mine, and explicit Save against the newly reviewed version. A deleted record cannot be silently resurrected by a stale editor.
- Keep UI changes outside transaction callbacks, which can run again. Apply Saved state only after commit/readback acknowledgment. Firestore transactions fail offline; keep the draft unsaved with Retry when connected, not a false synced status.
- Auth expiry/permission denial closes subscriptions, explains re-authentication, and keeps text available for copying. Permission failure does not fall back to another collection or local persisted store. Capture UID/rater before each request; a rater switch cannot attribute a delayed save to the new person.
- Snapshot updates refresh clean dialogs/list entries; dirty editors show Remote changes available and retain their text. Handle listener failures visibly and detach cleanly. Avoid optimistic deletion that hides an error.

Use the existing Firebase initialization in the CRM. Annotation modules receive a store/auth adapter for tests; the child frame never initializes Firebase or receives credentials.

### Rating compatibility corrections within scope

Before allowing rating/font edits, finish the current reviewer load or show a retryable error. Do not save an empty partially loaded map over a prior record. Capture reviewer identity/generation for scheduled writes and cancel/flush deliberately before switching.

Use field-specific writes/transactions for the explicitly edited D rating or font language, merging against fresh stored data. Clearing a star must actually remove that D field remotely. Preserve all unrelated `a:*`, `b:*`, `c:*`, other D fields, raw legacy font values unless that language was explicitly edited, name identity contract, and original `createdAt` where it exists; set it only for a newly created document. Continue `updatedAt` on an actual rating/font mutation. No annotation operation calls the ratings save scheduler. Assert map equality before/after, not merely key counts. Do not backfill historical creation timestamps or add annotation fields to the rating document.

## 7. Accessibility and keyboard contract

- Pen is a real button with label, pressed state, visible focus, and explanatory status. Feedback list and comments are usable with keyboard and screen reader regardless of whether marks are visible. Marks have number/shape and text labels; color alone is insufficient.
- Provide “Select region with keyboard” beside draw instructions. It opens a semantic target picker for the current view; arrows move among targets, Enter selects. A rectangle adjustment mode moves edges with arrow keys (Shift for larger steps), Enter accepts and opens the same dialog, Escape cancels. Provide labeled numeric edge controls as an alternative to dragging for arbitrary portions/whitespace. Target selection and edge editing need no pointer.
- Host modal uses a native dialog or complete APG modal behavior: accessible name/description, focus initially in textarea, Tab/Shift+Tab contained, Escape routed through dirty-state handling, close button, and focus restoration to invoking button/list item. Make the iframe and background inert while modal. Destroying an anchor must not lose the host dialog or caret/IME composition.
- Keyboard entry from within the frame has an explicit Back to review controls command; no global single-letter hotkeys while typing. Shortcuts must not consume select/text/audio keyboard events in Browse.
- Mirror save/error announcements in polite live status; errors requiring action use a concise alert. Vietnamese comments, combining marks, pasted text and screen-reader labels remain plain text and legible. Render timestamps with full accessible localized date/time, Vietnam Time for the reviewer-facing default; storage remains server timestamps. Distinguish Created and Edited.
- Proposed minimum touch target is 44 CSS pixels for new annotation controls. Verify focus/contrast, 200% browser zoom, 320px width reflow, and reduced motion. Prefer instant highlight/scroll for reduced motion. This verification is not a claim of full accessibility certification.

## 8. File-level ownership and protected contracts

All paths below are relative to the **new isolated implementation checkout**, whose absolute path and source SHA must be recorded before coding. The implementation root is the single writer/test owner on the Light route; no subagents. Do not modify any currently in-flight checkout or root plan.

| Files | Operation and exclusive responsibility |
|---|---|
| `public/js/crm/entrance-test-ui-lab.js` | Modify: D-only host/progress/results, precise D rating writes, annotation module boot/disposal, validated existing bridge adapter. |
| `public/crm-admin.html` | Modify: evaluator copy and annotation stylesheet registration only. |
| `public/crm-admin.js` | Modify: exact evaluator enter/leave hook only if needed to invoke disposal; no other CRM dispatch changes. |
| `public/css/entrance-test-ui-annotations.css` | Create: scoped host toolbar/list/modal and child overlay states, no global reset. |
| `public/js/crm/entrance-test-ui/annotations-controller.js` | Create: host list/modal/state machine, identity generation and bridge integration. |
| `public/js/crm/entrance-test-ui/annotations-store.js` | Create: injected Firestore adapter, transactions, list subscription, idempotency/conflict handling. |
| `public/js/entrance-test-ui/annotation-model.js` | Create: shared pure schema, revisions, context and message validation; no Firebase or DOM. |
| `public/js/entrance-test-ui/annotation-anchors.js` | Create: registry, selection/text ranges, coordinate conversion and resolution. |
| `public/js/entrance-test-ui/annotation-overlay.js` | Create: disposable child SVG/pointer/keyboard controller and layout scheduling. |
| `public/js/entrance-test-ui/app.js` | Modify: validated parent bridge, exact-question navigation, context/render hooks, bounded Stop recording adapter, annotation lifetime; retain demo engine. |
| `public/js/entrance-test-ui/view.js`, `public/entrance-test-ui/index.html` | Modify: stable nonvisual anchor attributes, annotation style hookup; no aesthetic restructuring. |
| `firestore.rules` | Modify: strict new annotation namespace only; ratings rules remain behavior-compatible. |
| `tests/entrance-test-ui/host.test.mjs` | Modify: replace obsolete four-skin assertions with D-only/data-retention behavior. |
| `tests/entrance-test-ui/view.test.mjs` | Modify: stable anchor coverage/uniqueness without weakening existing visual assertions. |
| `tests/entrance-test-ui/annotation-model.test.mjs`, `annotation-anchors.test.mjs`, `annotation-store.test.mjs`, `annotation-host.test.mjs` | Create: meaningful pure/DOM/fake-store and state tests. |
| `tests/firestore/entrance-test-ui-annotations-rules.test.cjs` | Create: real emulator allow/deny, query and transaction checks. |
| `tests/fixtures/entrance-test-ui/evaluator-host.html` | Modify: injected fake adapter/hooks; no production data or secrets. |
| `tests/browser/entrance-test-ui-demo-check.py` | Modify: D-only host expectations; retain existing candidate/audio suite. |
| `tests/browser/entrance-test-ui-annotations-check.py` | Create: focused Chrome annotation/geometry/keyboard/persistence suite. |
| `package.json` | Modify exact test script fields only; include every new unit file and explicit browser/rules commands. Preserve concurrent edits. |
| `docs/audits/entrance-test/2026-09-14-demo-d-annotations-execution.md` | Create on implementation completion: compact provenance, outcomes, limitations and release status. |

No delete/rename paths are proposed. No planned modifications to `functions/`, `src/`, `firebase.json`, `.firebaserc`, `firestore.indexes.json`, font binaries/catalog, Demo D state/persistence/audio engine, learner `entrance-test.*`, result PDF generator, practice modes, Projects, or historical lab files. If a dependency or additional file is required, amend the exact external task contract before touching it and explain the bounded need. Do not add a broad wildcard declaration or change global module type.

Protect specifically: all existing assessment questions/answers/IDs, DSP path, mic lifecycle and recovered recordings, flags/drafts, intentional QA/prefill, native inline answer controls, listening transport, review/receipt flow, Noto defaults, locale/text sizing, CRM auth, rating/font stores, learner scoring/upload/submission APIs, historical reports and unrelated dirty files.

## 9. Ordered execution package

### Task 0 — Establish an isolated, source-bound candidate

After plan approval, create a new isolated `codex/entrance-test-demo-d-annotations` worktree from the explicitly confirmed baseline `42f829389216ed9214c7f373484269d3528130d0`, branch `codex/release-entrance-test-ui-demo-d-20260913`, available at `C:/Users/Admin/.codex/worktrees/entrance-test-ui-demo-release-20260913/Cursor AI`. Do not substitute the older shared checkout because an asset probe returned fallback HTML. Record source hashes and the originating task's approved deployment evidence. Keep this task's HTTP discrepancy in the evidence record and resolve the exact route/content-type behavior during release verification. A future production package must preserve intervening unrelated deployed work rather than overwrite the site with a stale complete tree.

Write external task contract with all create/modify paths above, no deletions, output destinations/classes, root ownership, protected contracts and checks. Snapshot before coding. Record any inherited failures separately and the current saved data fixtures without private learner information. Use sanitized rating fixtures with A/B/C/D maps, legacy string/array fonts and timestamps. No live rating dump is needed for routine development.

### Task 1 — D-only evaluator and rating preservation

Write failing host behavioral tests for default D, no visible/reachable legacy controls, 40-score completion, font gating, D-only averages, no auto writes, star clearing, delayed loads, rater switch, field-specific updates and preserved historical maps. Run those tests and observe the missing behavior. Implement host changes and copy. Run the focused tests, then retain a checkpoint diff. Do not remove the old lab routes to make tests pass.

### Task 2 — Anchor/model contract and bridge

Write tests for unique stable IDs on eight screens/13 question groups, valid/invalid message sources/generations, exact-question context, element/text/layout fragment roundtrips, view/revision mismatch and unresolved anchors. Implement the pure model, registry and structural attributes first; then the child render hooks and hardened host/frame handshake. Resolve coordinate behavior before connecting Firestore or the modal. Verify standalone D without the host remains fully usable and emits no annotation writes.

### Task 3 — New persistence namespace and security

Write fake-adapter tests for create/retry/update/delete/undo, timeout with committed result, transaction version conflict, stale identity, failed read and offline state. Write real emulator rules tests before adding rules. Implement the adapter and strict rules. Tests must exercise permitted admin list/create/edit and denied non-admin/unauthenticated/malformed writes, forged authors/times, immutable-field changes, hard delete, stale version and invalid geometry. Do not point cleanup helpers at the production project.

### Task 4 — Drawing, dialog and feedback list

Implement the disposable child SVG controller and keyboard region picker; then the host dialog/list. Connect protocol and adapter using injected boundaries. Add modal and feedback styles in the scoped stylesheet. Verify no full iframe re-creation on Save, list updates or rating changes. Ensure the comment modal survives child rerender while audio/draft persistence continues. Preserve raw unsaved comment text through local error/conflict. Check that gesture cancellation has zero persisted effect.

### Task 5 — Chrome acceptance and regressions

Run the existing Demo D candidate/audio/host Chrome suite after updating only obsolete version expectations. Run the focused annotation suite below. Use local Playwright first, Chrome only. If richer live confirmation is needed afterward, use the browser-agent workflow as a second step, with one browser owner and the same candidate identity. No browser execution is part of this planning turn.

For authentication plans/execution, first read `C:/Cursor AI/.local/browser-test-credentials.md` and use its documented admin account unless the user says otherwise. Never inline its contents into tests, plans, tracked files, screenshots or evidence. Local synthetic tests use injected auth or emulator accounts, not production credentials. Include an authenticated integrated CRM check against the candidate with explicit emulator routing; a fake-store host fixture alone does not prove authentication/rules/persisted behavior.

### Task 6 — Final audit, scope reconciliation and handoff

Review actual code and test assertions against this plan; verify the worktree/index delta against the external declaration; run required settled-candidate checks once. Do not repeat successful broad suites without a new change/failure. Write the compact execution record with candidate SHA, relevant file hashes, commands/exit codes, browser artifacts and known limitations. Stop for separate production authorization when local acceptance passes. Implementation approval does not authorize production writes/deployment.

## 10. Acceptance and Chrome verification matrix

| ID | Observable pass condition |
|---|---|
| A01 | Fresh and returning evaluator loads show D only; no A/B/C controls/help/comparison output or stale skin state. Existing legacy URLs still load their existing lab independently. |
| A02 | 40 valid D ratings + existing font minimum unlock results; A/B/C cannot advance D progress. One D rating changes only its exact field; clearing persists after reload. Annotation create/edit/delete changes zero ratings/font fields. |
| A03 | Historical A/B/C maps and untouched font values compare deep-equal before/after; all D keys, original timestamps and local draft/recording references remain unless explicitly edited through their own workflow. |
| A04 | Circle title, a partial passage line, a blank, audio controls, review row, fixed header/footer, and whitespace; each valid completion opens one correctly associated modal. Cancel/tiny stroke/pointercancel creates nothing. |
| A05 | Save, close/reload/reopen and second authenticated browser context retrieve the same annotation ID/text/anchor/server times. Edit/delete/undo persist and are visible to the second context; emulator tests prove rules and transactions. |
| A06 | Geometry at capture layout: maximum edge/center drift <=3 CSS pixels after iframe scroll, outer page scroll, and nested scrolling. Measure DOM/Range geometry against reconstructed selection; screenshots alone do not pass. |
| A07 | Same content remains selected after width changes 1440→1024→768→390→320 and back, iframe height changes, browser zoom 100/200%, text scale, font load and supported locale switch. Text-range fragments intersect the intended characters and never another question's text. Missing/changed locale text or layout-only region follows explicit unresolved handling. |
| A08 | Multi-target selection remains associated with the same elements after responsive stacking; no big outline falsely implies unrelated content between them. No out-of-frame rendering/clipped comment actions. |
| A09 | Open comment on `vocab_q4`/later listening group navigates to that exact group, waits for render and highlights it without overwriting current answers. Absent dynamic state/revision reports unavailable; explicit re-anchor repairs it. |
| A10 | In Browse, answers/selects/text input (including Vietnamese IME), mic record/stop/play/replace, listening seek/rate/play, navigation/flags, QA helpers, save/reload, review and local receipt work. Opening/closing feedback does not write demo answers or recreate media unexpectedly. |
| A11 | Keyboard-only target selection/rectangle adjustment, comment save/edit/delete and focus return work. Escape follows dirty-state contract. Screen-reader labels/live states and zoom/reflow are checked manually in Chrome; no keyboard trap across iframe. |
| A12 | Wrong-origin, same-origin wrong-window, old-generation, wrong-revision, malformed/oversized/unknown-question messages cannot navigate, draw, save or stop audio. Top-level D has no persistence access to comments. |
| A13 | Two editors race: second save shows conflict, first is not overwritten; edit racing delete cannot resurrect; retry after ambiguous successful create produces exactly one item. Re-auth and rater switch preserve correct attribution. |
| A14 | Offline, permission denied, missing Firebase client, quota/query error and failed listener show truthful states; retry retains text; no “Saved” without acknowledgment, no false empty list, no fallback writes. |
| A15 | Repeated open/close, panel leave/re-enter and iframe reload attach only one listener/subscription/controller; no stale marks or growing active observers/RAF loops. Scroll/resize does not cause Firestore writes or assessment state dispatch. |

Run geometry cases at device scale factors 1 and 2 in Chrome (CSS coordinates remain correct). Include both independent host and iframe scrolling, collapsed/expanded disclosures, a slow font load, and a target removed/reinserted by render. Use deterministic settled-layout waits; do not mask drift by increasing tolerances. Retain measured expected/actual rects with screenshots and context metadata.

### Commands and expected outcomes

Run from the recorded isolated checkout. Commands below are execution steps, not claims that this feature already passes.

```powershell
npm run test:entrance-test-ui
# Existing candidate tests plus all four new annotation unit suites pass; no skipped replacement for old coverage.
npm run lint:crm
# Exit 0 for touched CRM scope; explicitly syntax-check/import the new ESM modules as well.
npm run verify:crm
# Required CRM aggregate exits 0; report inherited failures separately without weakening assertions.
python -X utf8 tests/browser/entrance-test-ui-demo-check.py --case all --output <external-task-dir>/demo-browser
# Chrome candidate/audio/D-only host suite passes, manifest retained.
python -X utf8 tests/browser/entrance-test-ui-annotations-check.py --output <external-task-dir>/annotations-browser
# New Chrome matrix passes; script must expose --help and --output, use channel='chrome', and own/close its fixture server.
npm run test:structure
# Offline structure fixtures exit 0.
node scripts/structure/check.cjs check --base <resolved-base-sha> --contract <external-task-dir>/structure-contract.json --snapshot <external-task-dir>/structure-before.json --json
# No new scope violations; inherited notices/findings explicitly classified.
git diff --check
# Exit 0.
```

New rules command: `node --test tests/firestore/entrance-test-ui-annotations-rules.test.cjs`, against an owned Firestore emulator only. The harness must require an explicit loopback `FIRESTORE_EMULATOR_HOST` and a `demo-` project ID; abort before any DB call if absent/nonlocal. Use the installed Firebase emulator CLI to run it with project `demo-entrance-test-annotations` and only Firestore, using an external emulator config and unused port. Retain that config as evidence. Verify the rules-test package is available in the selected checkout before running; if absent, declare an exact dev-dependency/lockfile addition before installing. Do not copy an existing helper that defaults to `listening-tasks-3ae34` and calls `clearFirestore()`.

Register `test:entrance-test-ui:annotations` and `test:entrance-test-ui:rules` in `package.json` with exact scripts and documented emulator effects; extend existing `test:entrance-test-ui` to include all new unit tests. Browser/rules tests remain explicit effectful commands, not silently folded into offline lint. Review whether the actual CRM runner needs an explicit entrance-test invocation; otherwise report the separate commands alongside its result.

## 11. Deployment scope and rollback

There is no deployment or live mutation in this plan. After implementation acceptance, prepare a concrete release for explicit user authorization. The feature needs **Hosting plus the narrow Firestore rules change**. It does not need Functions, learner APIs, Cloud Run, Storage rules/media, or an index migration with the proposed query.

1. Reconcile current production Hosting manifest before release and resolve the discrepancy between this task's HTTP probes and the originating task's verified D application routes. Freeze exact candidate SHA/file hashes and generated/public artifact manifest. Preserve all unrelated currently deployed assets, including recent practice-mode work. Do not deploy the entire older release worktree just because D lives there.
2. Diff the actual current Firestore rules against the candidate. Apply only the new annotation match/helpers atop the current rules; do not publish an old complete rules file over newer policies. Back up exact previous rules and Hosting release identifiers with restore commands.
3. Existing `scripts/release/firebase-release.cjs` offers `hosting`, `functions`, and `full`; its `full` profile includes `functions:api`. **Do not select full to deploy this feature.** Prepare the supported Hosting package and a separate rules-only invocation under the release process. Resolve any guard/tooling exception explicitly in the release package; do not bypass guards or add a Functions deployment to satisfy them.
4. Prefer additive rules deployment first, verify access in staging/emulator and release evidence, then publish the matching Hosting bundle. Old host code ignores the new collection. If rules fail, keep the new annotation controls unavailable and do not present false save capability. Stage auth and rules together before production verification.
5. After authorized deployment, verify CRM authentication, actual iframe URL/origin, expected HTML/JS/CSS MIME types (not catch-all HTTP 200), all new module imports, source hashes and supported bridge revisions. Do a live Chrome D-only read/navigation check. A real production create/edit/delete smoke test requires explicit production-write authorization and uses one clearly labeled test annotation, never a learner or existing reviewer's data. Without that authorization, report live read verification and emulator write proof separately.
6. Only after verified approved deployment, apply `(D) ` to the correct task via supported title API after checking its identity/title. No remote Git push unless explicitly authorized.

Rollback: restore the recorded pre-release Hosting version/bundle while preserving the newer unrelated production assets captured at the release boundary. This removes annotation controls and can restore the old evaluator interface. New annotations remain stored; never delete feedback or ratings as rollback. Additive strict rules can remain while old clients ignore the collection; if a security defect requires rules rollback, restore the exact recorded previous rules separately and report that annotations become temporarily inaccessible. Do not reset Demo D IndexedDB/localStorage, rename rating keys, reassign comments to a different visual revision, or rewrite the PDF/history. Re-enable with a compatible host/frame bundle and supported annotation schema after correction.

## 12. Approval and planning verification status

Approval requested: this D-only/shared-admin annotation design and its execution package. No other product decision is required to start implementation. A requirement for verified individual ownership/private comments would change authentication and security scope; it is deliberately not inferred from the existing shared-login workflow.

This document was prepared from source inspection, original PDF text plus targeted visual inspection, prior audit/release evidence and current read-only HTTP checks. Current live ratings were not queried or changed. No product implementation, Chrome test execution, emulator run or deployment was performed in the planning turn.

The external task declaration is prepared and the before-snapshot command was started to protect the dirty shared checkout; confirm its completed output before execution. Offline structure fixtures were started, but their result was not collected before the final approval handoff. Neither is reported as a pass here. Because `AGENTS.md` requires the `implementation_plan.md` write to be the final tool call and immediate approval handoff, the post-write structure/delta check must run at the start of the next authorized turn. This is a pending documentation verification item, not a claimed pass or a reason to implement before approval. Product tests do not apply to this documentation-only turn.

Technical references used for the design: [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) for retries/atomic writes/offline behavior; [MDN postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) for exact origin and sender validation; [WAI modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) for focus and modal semantics. These support mechanisms, not evidence of this feature's completion.
