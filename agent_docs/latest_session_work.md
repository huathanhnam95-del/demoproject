# Latest Session Work

## Completed Package: CRM Projects V2 Visual Inline Creation & Streamlined Drawer (Tasks 1243 & 1244)

- **Status**: Completed & Empirically Verified on branch `feat/projects-subtasks-people`.
- **Context & Objectives**: Execute visual inline creation and drawer streamlining per `GEMINI_IMPLEMENTATION_PLAN.md` (Task 1243) and perform exhaustive multi-agent `/boost` audit, debugging, and refactoring (Task 1244) with zero regressions against baseline tests.
- **Key Deliverables**:
  1. **Keyboard Hint Neutralization (`public/css/crm-projects.css`, `public/crm-admin.html`)**:
     - Removed board hint element and disabled focus-within expansion to eliminate all table/header layout shifts.
  2. **Authoritative Placement Backend (`functions/src/crm/projects/domain/ordering.js`, `command-service.js`, `phase2-domain-api.test.js`)**:
     - Implemented `computePlacementRank` with rational fraction interpolation (`start`, `end`, `before`, `after`) and bounded rebalancing window.
     - Updated `createSection` and `createTaskCommand` with anchor lifecycle and parent ownership validation, mutual exclusivity with legacy `index`, and rational rank transactional assignment.
  3. **Contextual Inline Creation & Draft Continuity (`public/js/crm/projects/presentation/row-layout.js`, `contextual-create.js`, `board.js`)**:
     - Created layout adapter and contextual composer controllers.
     - Added `computeOptimisticRank` with exact GCD fraction arithmetic.
     - Added 6-element draft key migration (`[..., anchorId, placementKind]`) ensuring seamless draft preservation across optimistic section and parent ID settlement.
  4. **Streamlined Detail Drawer (`public/css/crm-projects-v2.css`, `detail-surface.js`, `views.js`, `board.js`)**:
     - Fixed drawer header and tabs with dedicated scroll container (`[data-detail-panel]`), preserving scroll offset across resize.
     - Scoped `.crm-field-feedback` to in-flow display preventing control overlap.
     - Added native `<details class="crm-detail-disclosure">` components with live summary badges for Schedule, Dependencies, CRM Links, and Task Info.
     - Unlocked desktop subtask list parity and enabled in-drawer subtask creation with `{ kind: 'end' }`.
  5. **Post-Implementation `/boost` Audit & Refactor Pass (Task 1244)**:
     - Fixed 8 defects: fraction arithmetic in `computeOptimisticRank`, exported `createSection` placement forwarding, section settlement draft rekeying, subtask click row unfolding, section placement popover menus, "Copy ID" state freezing, `TypeError` in `contextual-create.js`, and placement sanitization/array guards.
- **Empirical Verification**:
  - `v2-quick-create.test.js`: 65/65 PASS
  - `v2-task-detail.test.js`: 42/42 PASS
  - `v2-performance-reconciliation.test.js`: 38/38 PASS
  - `v2-mobile-accessibility.test.js`: 40/40 PASS
  - `phase2-domain-api.test.js`: PASS
  - `npm run lint:crm` (`verify-crm-suite.js --lint`): PASS
  - `git diff --check`: 0 errors across all 13 owned files.
- **Files Modified/Created**: `functions/src/crm/projects/domain/command-service.js`, `functions/src/crm/projects/domain/ordering.js`, `public/crm-admin.html`, `public/css/crm-projects.css`, `public/css/crm-projects-v2.css`, `public/js/crm/projects/board.js`, `public/js/crm/projects/presentation/contextual-create.js`, `public/js/crm/projects/presentation/detail-surface.js`, `public/js/crm/projects/presentation/row-layout.js`, `public/js/crm/projects/views.js`, `tests/crm/projects/phase2-domain-api.test.js`, `tests/crm/projects/v2-quick-create.test.js`, `tests/crm/projects/v2-task-detail.test.js`, `TASK_TRACKER.csv`.

## Completed Package: Cross-Mode Data Quality & Controller Remediations (Phases 1–3) (Task 1071)

- **Status**: Completed & Empirically Verified.
- **Context & Objectives**: Execute Phases 1–3 of the cross-mode remediation roadmap across PTE Practice modules, eliminating translationese, stray Chinese numerals/phrases, conversational LLM persona boilerplate across database workbooks, controller fallback bugs, and empty sample models.
- **Phase 1 Deliverables (Zero-Risk Quick Fixes & Data Sanitization)**:
  1. **HIW Explanations (`public/hiw-mode.js` & `public/hiw-mode.css`)**:
     - Rendered `state.currentQuestion.explanation` below the comparison table via `safeRenderHtml` into a clean card (`.hiw-explanation-text-card`).
     - Ensured `elements.explanationToggle` displays whenever either mismatched tokens exist or a substantive explanation is present.
  2. **ASQ Workbooks Chinese Numeral Clean (`public/database/quiz/ASQ/ASQ.xlsx`, `public/database/question_bank_data.xlsm`, `public/database/quiz/ASQ/ASQ_backup_20260729_110356.xlsx`)**:
     - Replaced stray Chinese numeral `一` (U+4E00) misused as an em-dash with standard em-dash `—` (U+2014) in Rows 198, 208, and 233 across all 3 workbooks.
  3. **RFIB Metadata Chinese Phrases Clean (`public/database/RFIB/review-metadata.json`)**:
     - Naturalized all 14 Chinese fragments (`不惜一切代价`, `未经测试的`, `休眠`, `休眠状态`, `否定`, `撤销`, `形容词`, `倾覆`, `询问者`, `减轻`, `自豪`, `疑问`, `轻盈地`) into clear, accurate English pedagogical explanations.
  4. **UTF-8 BOM Removal (`public/collocations.json`)**:
     - Re-saved `public/collocations.json` in standard UTF-8 without byte order mark (`0xEF 0xBB 0xBF`), ensuring universal parser compatibility.
  5. **Pruning Legacy Zip Archives (`public/database/`)**:
     - Pruned 26 redundant/empty `.zip` archives (including empty 22-byte archives `EMAIL.zip` and `RTS CORE.zip`, and misfiled `DD/DI.zip`), saving 4.3 MB.
  6. **Write Essay Master Sheet Chinese Title Fix (`public/database/Write Essay/ESSAY/Essay.xlsx`)**:
     - Replaced `#370 WE 论点翻译 2` with standard title `The Role of Examinations in Education` at Row 369 Col 2.

- **Phase 2 Deliverables (Scrub AI Persona Boilerplate Across Database Explanations - 1,055 Rows)**:
  - Created and executed `scripts/clean_explanation_personas.py` with automatic backups in `.local/backups/`.
  - Scrubbed conversational LLM introductions (`<p>Hello! As your PTE Academic tutor...`, `<p>Hello there!...`, `Hello! As a premium PTE teacher...`, marketing headers `<h3>Understanding Cohesive Links...</h3>\n<p>Mastering 'Re-order Paragraphs'...`) across 7 workbooks:
    * `ROP` (`public/database/ROP/ROP/ROP.xlsx`): 743 rows scrubbed
    * `HIW` (`public/database/Highlight Incorrect Words/HIW/HIW.xlsx`): 82 rows scrubbed
    * `LMCMA` (`public/database/LMCMA/LMCMA/LMCMA.xlsx`): 68 rows scrubbed
    * `SMW` (`public/database/SMW/SMW/SMW.xlsx`): 56 rows scrubbed
    * `LMCSA` (`public/database/LMCSA/LMCSA/LMCSA.xlsx`): 55 rows scrubbed
    * `RMCMA` (`public/database/RMCMA/RMCMA/RMCMA.xlsx`): 47 rows scrubbed
    * `RMCSA` (`public/database/RMCSA/RMCSA/RMCSA.xlsx`): 4 rows scrubbed
  - Total rows cleaned: 1,055 rows. Verified 0 conversational greetings remain while retaining 100% of substantive pedagogical explanations, options analysis, and cohesive link breakdowns.

- **Phase 3 Deliverables (Controller Fallback & Data Quality Remediation)**:
  1. **Describe Image Key Points (`public/database/Describe Image/describe-image-questions.json` & `public/describe-image-mode.js`)**:
     - Extracted 3–4 concise bulleted `keyPoints` from `sampleAnswer.full` across all 1,170 questions.
     - Updated `public/describe-image-mode.js` (line 732) to supply authentic keyPoints to Dialogflow evaluation payloads instead of `Key Points to cover: N/A`.
  2. **RTS Reference Models (`public/database/RTS/rts_questions.json` & `public/rts-mode.js`)**:
     - Populated authentic `sampleResponse: { full, simplified }` across all 146 RTS questions matching speech acts and registers.
     - Updated `public/rts-mode.js` (line 929) to fall back to `currentEntry?.sampleResponse` when `data.sampleResponse` is not returned by the evaluation API.
  3. **Write Essay Collocation Tips (`public/write-essay-mode.js`)**:
     - In `getColloEssayTip`, prioritized `item.contextTip` and `item.viGloss || item.vi` before falling back to generic boilerplate.

---

## Handoff Plan: Phase 4 — Cross-Mode Pedagogical Deconstruction & Scaffolding

### 1. Objective & Scope
Phase 4 builds on the data quality and controller remediations of Phases 1–3 by introducing high-impact pedagogical scaffolding ("hiểu đề bài") across four foundational PTE task types. This bridges the comprehension gap for A2/B1 learners before they attempt speaking, writing, or reading production.

### 2. Task-by-Task Implementation Architecture

#### A. Summarize Written Text (SWT - 404 Questions)
- **Problem**: Students struggle to isolate primary argumentative clauses from illustrative or supporting clauses, leading to run-on sentences or missing key content points.
- **Deliverable**:
  1. **Clause Deconstruction Pipeline ("Hiểu Đề Bài")**:
     - Parse each reading passage in `public/database/Summarize Written Text/SWT/SWT.xlsx` and `public/database/Summarize Written Text/swt-questions.json`.
     - Annotate the primary independent clause (`[Mệnh đề chính]`) vs subordinate supporting clauses (`[Dẫn chứng / Mở rộng]`).
  2. **1-Sentence Synthesis Formula Templates**:
     - Provide 2–3 structured templates per question (Compound-Complex, Participial Phrase, Subordinating Conjunction) adhering strictly to PTE's 5–75 word limit.
  3. **Bilingual Key Concept Chips**:
     - Extract 3–5 key academic terms with Vietnamese glosses (`viGloss`) and collocation partners.
- **UI Integration**: In `public/swt-mode.js` (or SWT viewer), render a collapsible `"🔍 Phân tích đề & Cấu trúc câu"` accordion under the passage.

#### B. Summarize Spoken Text (SST - 585 Questions)
- **Problem**: Students miss transitional signposts in fast academic lectures, resulting in disoriented note-taking and fragmented summaries.
- **Deliverable**:
  1. **Audio Signpost & Landmark Annotations**:
     - Annotate lecture transcripts with chronological milestone markers:
       * `[Mở đầu - Đặt vấn đề]` (Introductory context)
       * `[Luận điểm chính 1 & 2]` (Core arguments / Mechanisms)
       * `[Nghiên cứu / Thí nghiệm]` (Empirical evidence)
       * `[Kết luận / Ý nghĩa thực tiễn]` (Conclusion / Implications)
  2. **Structured Note-Taking Frame**:
     - Provide a pre-structured note template (Problem $\rightarrow$ Mechanism $\rightarrow$ Result) directly matching lecture milestones.
  3. **50–70 Word Standard Summary Models**:
     - Add dual-tier reference summaries (`full`: C1 academic, `simplified`: B1 clear syntax) to `public/database/SST/SST/SST.xlsx`.
- **UI Integration**: In `public/sst-mode.js`, render milestone badges alongside audio playback and provide a `"📋 Khung ghi chú mẫu"` in the results drawer.

#### C. Reading FIB (DD 1,036 Questions & RFIB 1,128 Questions)
- **Problem**: Blank explanations often display `"No explanation available for this blank"` or offer no insight into why distractors fail.
- **Deliverable**:
  1. **Bilingual Distractor Vocabulary Popovers**:
     - For every distractor option across blanks in `public/database/DD/` and `public/database/RFIB/`, ensure:
       * Part of speech (`POS`)
       * Vietnamese meaning (`viGloss`)
       * Collocation partner (`collocation`)
       * Distractor verdict reason (`why_wrong`: semantic mismatch, wrong preposition, or tense conflict).
  2. **Zero Missing Blank Explanations**:
     - Audit and eliminate 100% of `"No explanation available for this blank"` placeholders.
- **UI Integration**: In `public/dd-mode.js` and `public/rfib-mode.js`, render interactive token popovers when hovering or tapping blanks in the review state.

#### D. Write From Dictation (WFD - 3,183 Sentences) & Repeat Sentence (RS - 2,837 Sentences)
- **Problem**: WFD and RS test takers lose points to predictable spelling traps (homophones, silent letters, double consonants) and chunking breakdowns during fast speech.
- **Deliverable**:
  1. **Spelling Trap Alerts (WFD)**:
     - Annotate sentences with high-risk spelling traps (e.g. *accommodate*, *occurrence*, *conscientious*, *affect vs effect*, *principal vs principle*).
  2. **Prosodic Chunking Brackets (RS & WFD)**:
     - Group sentences into 2–3 acoustic thought groups using brackets:
       `[The university library] [will remain open] [throughout the exam period].`
     - Provide millisecond boundary cues or visual breathing pauses for acoustic rehearsal.
- **UI Integration**: In `public/wfd-mode.js` and `public/rs-mode.js`, render chunked token preview and highlight spelling traps in yellow badge chips during review.

### 3. Verification & Acceptance Criteria for Phase 4
- `python scripts/audit_phase4_scaffolding.py`: Verify 100% coverage of clause deconstructions across SWT and audio milestones across SST.
- 0 blanks in DD or RFIB display fallback placeholder text.
- E2E browser tests verify interactive popovers render cleanly on mobile (375px) and desktop (1440px).

---

## Completed Package: Dev Server Resilience & Loopback Emulator Auto-Detection (Task 1061)

- **Status**: Completed & Empirically Verified.
- **Context & Problem**: When the local HTTPS dev server (`https://localhost:8443`) stopped while Firebase emulators remained active, attempting to restart `server.js` via `node server.js`, `npm start`, or `check-server.bat` triggered a fatal exit because emulator host variables were missing from the shell environment. This trapped development agents in a catch-22 (unable to start without emulators, forbidden from pointing to production via `ALLOW_PROD_FIREBASE=1`, and unable to run `start-emulators.bat` because emulators were already running).
- **Core Deliverables**:
  1. **Dual-Stack Loopback TCP Probe (`server.js`)**:
     - Synchronous socket probe (`probeLocalFirebaseEmulatorsSync`) checking IPv4 (`127.0.0.1`) and IPv6 (`::1`) on default emulator ports (`8080`, `9099`).
     - In non-production environments (`NODE_ENV !== 'production'`), if emulator variables are missing or whitespace-only and active emulators are detected, auto-binds standard emulator endpoints and logs `[INFO] Detected active Firebase emulators on localhost. Auto-bound emulator environment variables.` instead of crashing.
     - Enhanced fatal error diagnostic when emulators are offline to clearly suggest `npm run dev:server` or launching the emulator suite.
  2. **Dedicated Dev Server Runner (`scripts/start-dev-server.cjs` & `package.json`)**:
     - Added `npm run dev:server` script targeting `scripts/start-dev-server.cjs`.
     - Automatically normalizes and pre-sets all 4 emulator environment variables before launching `server.js`, with signal forwarding protected against Windows `ENOSYS` exceptions.
  3. **Launcher Ingestion (`check-server.bat`)**:
     - Updated batch script to set default emulator environment variables when undefined before invoking `node server.js`.
  4. **Governance Compliance (`scripts/structure/policy.json`)**:
     - Registered `dev:server` and `scripts/start-dev-server.cjs` under repository structure policy.
- **Empirical Verification**:
  - `node --test tests/server/emulator-isolation-guard.test.js tests/server/boot-verification.test.js tests/server/local-admin-bootstrap.test.js tests/server/static-cache-contract.test.js`: 12/12 passed (802ms).
  - `npm run test:structure`: 45/45 passed.
  - `npx eslint server.js scripts/start-dev-server.cjs tests/server/emulator-isolation-guard.test.js tests/server/boot-verification.test.js`: 0 errors, 0 warnings.
  - Live HTTPS endpoint probe (`curl.exe -k https://localhost:8443/api/health`): HTTP 200, `firestore: connected`.
- **Files Modified/Added**: `server.js`, `package.json`, `check-server.bat`, `scripts/start-dev-server.cjs`, `scripts/structure/policy.json`, `tests/server/emulator-isolation-guard.test.js`, `tests/server/boot-verification.test.js`, `TASK_TRACKER.csv`.

## Active Package: CRM Projects Board Enhancements & Subtasks (Branch `feat/projects-subtasks-people`)

- **Status**: Visual inline creation and drawer streamlining packages completed and verified (Tasks 1243 & 1244).
- **Completed Components**: Keyboard hints strip layout shift elimination, authoritative rational placement backend (`start`, `end`, `before`, `after`), contextual inline row creation, draft continuity across optimistic parent ID resolution, streamlined task detail drawer with dedicated scroll container and collapsible disclosure cards, desktop subtask parity, and comprehensive 8-defect `/boost` refactoring.
- **Remaining / Adjacent Scope**: Interactive people picker with avatar/name popover search, batch dock filter chips, custom date picker adjustments.

## Completed Package: Release V1.8.122 (Task 958, Task 959, Task 960, Task 961, Task 962, Task 963)

- **Status**: Completed & Empirically Verified. Ready for Production Deployment.
- **Core Deliverables**:
  1. **Step 1 Whiteboard & Pre-Start Studio Overhaul (Task 958, Task 960, Task 961)**:
     - **Dynamic POS & PEEL 4-Paragraph Outline**: Real-time paragraph blueprint generated directly from active stance and chosen idea chips (Đoạn 1 POS Intro, Đoạn 2 & 3 PEEL Body 1 & 2, Đoạn 4 Synthesis Conclusion).
     - **Mutually Exclusive Stance Selection**: Highlighted active stance (`.is-active-stance` with `✓ Phe đang chọn` badge) and greyed out opposite stance (`.is-greyed-out` with 52% opacity, dashed border) with 1-click stance switching.
     - **Recited Question Prompt**: Prominent `.essay-wb-prompt-recap-box` at the top of Step 1 Part 2 so students never lose sight of the prompt while planning.
     - **Focused Pre-Start Single-Card Detail**: Mode cards renamed to natural Vietnamese (`Sơ đồ tư duy`, `Học từng phần`, `Lướt nhanh 20s`, `Đọc truyền thống`) with single-card focused preview (`#essay-prestart-active-detail`) showing *"Bạn muốn..."* and *"Hợp với bạn khi..."*. Secondary button expands the full 4-row comparison table on demand. Default support language set to Vietnamese (`vi`).
     - **Clamped Layout Sizing**: Constrained `.essay-guided-interactive-quiz` and `.essay-guided-gapfill-box` to `max-width: 920px` (sentences to `820px`), eliminating awkward horizontal stretching on 1440px+ screens.
     - **Native Vietnamese Natural Language Filter**: 2-tier deterministic regex and Qwen 3 translation filter deployed to ensure 0 calque violations across all 25 essay packs (q0001–q0025).
  2. **Teaching Session Viewer Round 2 Quality & Sizing Fixes (Task 959, Task 962)**:
     - **Bidirectional Schema Harmonization**: Harmonized schema aliases between `lesson_summary` ↔ `summary`, `student_error` ↔ `student_error_quote`, `concept_or_rule` ↔ `concept`, and `homework_items` ↔ `homework_list`.
     - **Mermaid Diagram Auto-Fit & Pan/Zoom**: Resolved SVG replaced-element 300px × 124px miniature collapse bug by explicitly resolving viewBox dimensions and applying scale floor ≥ 90%.
     - **Docked Audio Bar & Interactive Jumps**: Persistent docked audio player with responsive timestamps (`▸ ~MM:SS`) seeking with 3-second context lead-in.
- **Empirical Verification**:
  - `node tests/browser/verify-and-screenshot-final-result.js`: 100% passed (Briefing, Mindmap auto-fit, Flowchart auto-fit, Fullscreen mode).
  - `node tests/browser/write-essay-guided-support-browser-check.js`: 100% passed.
  - `node tests/browser/write-essay-samples-browser-check.js`: 100% passed.
  - `python tests/write_essay_support_pipeline.test.py`: 6/6 passed.
  - `python tests/write_essay_support_contract.test.py`: 9/9 passed.
  - `node tests/write-essay-support-runtime.test.mjs`: 3/3 passed.
  - `npm run verify:crm`: 100% passed.
- **Release Version**: `V1.8.122` (Asset cache buster: `20260905-v1.8.122`).

## Completed Package: Guided Write Essay Steps 3–5 Visual Overhaul (Task 955)

- **Status**: Completed & Empirically Verified (100% Passing E2E Browser Tests).
- **Core Objective**: Visually overhaul Guided Write Essay Steps 3–5 to eliminate walls of text and box-in-box nesting, ground all copy in natural, friendly Vietnamese strategies (no robotic AI phrasing), and synthesize council insights from 3 local LLMs (`deepseek-r1:14b`, `qwen3:14b`, `gemma4:12b`).
- **Deliverables**:
  1. **Council Consensus (`council_steps3_5_design.md` & `.json`)**: Architectural specifications for Toolbelt UI, 4-Stage Flowchart Timeline, Sentence Studio, and Vietnamese strategy copy.
  2. **Step 3 (Language Kit)**:
     - Target Commit Meter bar (`0/3` or `3/6` targets).
     - Toolbelt category nav pills (`[Tất cả]`, `[🎯 Từ vựng cốt lõi]`, `[✨ Cụm từ ghi điểm]`, `[📐 Mẫu câu chuẩn]`, `[🔗 Từ nối 4 chặng]`).
     - Flattened single-layer cards (`.essay-guided-toolbelt-card`) with zero box-in-box nesting.
     - Automated bilingual term highlighting in both English and Vietnamese example sentences (`.essay-term-hl`).
     - Actionable `<?>` writing strategy tips with practical paragraph-level guidance.
     - Grammar formula token chips (`[Mệnh đề nhượng bộ X]` + `[Lập trường Y]` + `[Lý do Z]`).
     - 4-stage cohesion roadmap stepper.
  3. **Step 4 (Make a Plan)**:
     - Interactive 4-milestone flowchart timeline (`1. Mở bài` ➔ `2. Thân bài 1` ➔ `3. Thân bài 2` ➔ `4. Kết bài`) with arrow connectors and expandable `"💡 Bí kíp viết"` tips.
  4. **Step 5 (Sentence Builder)**:
     - Sentence Construction Studio with 3 hint depth tiers (`1 · Purpose`, `2 · Fillable Frame`, `3 · Full Model`).
     - One-click `"📝 Đưa câu vào bài"` action inserting sentences directly into `#essay-input` with live word count update and success state feedback.
- **Empirical Proof**: Playwright E2E suite (`scratch/verify_steps3_4_5_visual.js`) passed with 0 page errors and captured 3 verified visual artifacts (`verify_step3_toolbelt.png`, `verify_step4_timeline.png`, `verify_step5_studio.png`).
- **Files Modified**: `public/write-essay-mode.js`, `public/write-essay-mode.css`, `TASK_TRACKER.csv`.

## Completed Package: Release V1.8.121 (Task 953, Task 955, Task 956, Task 957)

- **Status**: Completed & Deployed to Production (`https://listening-tasks-3ae34.web.app` / `https://betterenglishlearning.com`).
- **Core Deliverables**:
  1. **CRM Teaching Session Analysis Viewer UI/UX Optimization (Task 953)**:
     - Structured Briefing as default view (`data-view="report"`): Direct rendering from structured `session.report` JSON in chronological pedagogical order with graceful markdown fallback.
     - Scannable Knowledge Taught definition list with skill category chips (`TÍNH LIÊN KẾT`, `TÍNH MẠCH LẠC`, `TỪ VỰNG`), bold headers, and syntax-styled code examples.
     - Categorized Errors & Solutions with colored severity dots and outcome chips (`Đã Nắm Vững`, `Tiến Bộ Một Phần`, `Cần Luyện Thêm`).
     - De-emojified chrome and flat single-surface layout (`--crm-surface`), eliminating nested boxes-in-boxes.
     - Fullscreen presentation mode (`#btn-teaching-session-fullscreen`, `.is-fullscreen`) with breadcrumbs and 2-stage Escape navigation.
     - Interactive diagram stage (`.crm-diagram-stage`) with floating toolbar (Zoom In/Out/Reset, SVG download, pointer-capture pan).
  2. **Guided Write Essay Steps 3–5 Visual Overhaul & Council Synthesis (Task 955 & Task 956)**:
     - Step 3 (Language Kit): Target commit meter bar, category filter pills, flat cards, bilingual term highlighting, and 4-stage cohesion roadmap.
     - Step 4 (Make a Plan): 4-milestone flowchart timeline with expandable writing tips.
     - Step 5 (Sentence Builder): 3-tier Sentence Construction Studio with live insertion into `#essay-input`.
- **Empirical Verification**:
  - Live Playwright E2E browser test against production Firestore data (`tests/browser/verify-and-screenshot-final-result.js`): 100% passed with 5 verified screenshot artifacts.
  - Unit and contract tests: 3/3 passed (`teaching-sessions-frontend-contract.test.js`, `teaching-session-service.test.js`, `crm-shell-static.test.js`).
  - Write Essay runtime and admin contract tests: 11/11 passed.
- **Production Deployment**:
  - Version: `V1.8.121`
  - Targets deployed: `hosting`, `functions:api` (Node.js 22 Gen 2).
  - Cache-busting asset token: `20260905-v1.8.121`.
