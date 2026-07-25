## [V1.8.29] - 2026-07-25

### Fixed & Enhanced
- **CRM Pronunciation Corpus Accented Stress Verification**:
  - Enhanced `getSampleVerification` for `accented` corpus samples: when rateable primary stress is detected, it now verifies and reports `Verified · accented stress detected (syllable X)` in green (`#166534`).
  - Bumped CRM admin asset version token to `v=20260725-v1.8.29`.

## [V1.8.28] - 2026-07-25

### Fixed & Added
- **CRM Pronunciation Corpus Sample Analysis & Deletion**:
  - Fixed syllable count parameter bug in `analyzeSavedSample`: now prioritizes `expectedObservedCount` (e.g. 3 for omission) over target syllable count, allowing target-aligned acoustic feedback to measure omission recordings correctly.
  - Resolved status banner mismatch in CRM sample verification display (decoupled overall audio rateability from stress rateability to prevent false "unrateable audio" banners).
  - Cleaned primary stress fallback display: renders `N/A` instead of `syllable 0` when stress is unassigned.
  - Added `DELETE /dev/corpus-samples/:sampleId` API route in backend (`pronunciation-corpus.js`) for deleting Firestore sample metadata and Cloud Storage audio WAV files.
  - Added red **Remove sample** button in CRM Admin UI (`crm-admin.js`) with modal confirmation and automatic list refresh.
  - Bumped shared CRM asset cache buster in `crm-admin.html` to `v=20260725-v1.8.28`.

## [V1.8.25] - 2026-07-23

### Added & Refactored
- **Unified Speaking Practice Controller Migration & Refactor**:
  - Completed Waves 1–6 migration across all 7 PTE Speaking practice modes (RTS, ASQ, Describe Image, Retell Lecture/Notes, SGD, Repeat Sentence/Speak, Read Aloud).
  - Executed 28-fix refactor across Phase 1 (critical bugs), Phase 2 (accessibility & performance), and Phase 3 (code cleanup & CSS design tokens).
  - Added ArrowUp/ArrowDown/Home/End keyboard navigation for picker sheet listbox, fixed focus trap for fixed-position elements, and enforced WCAG AA contrast ratios.
  - Performed edge-case audit & hardening: replaced fragile CSS attribute selectors, fixed ID type coercion in search/pill sync, extracted shared element visibility helpers, and secured body scroll locking with null sentinels.
  - Verified stability across 8 automated Playwright browser test suites (140+ assertions, 100% pass rate).

## [V1.8.23] - 2026-07-13

### Fixed
- **Pronunciation Analyzer UI Alignment & Bug Fixes**:
  - Resolved native speaker chart toggle bug: Pitch/Volume selection toggles active datasets and axes instantly before recording.
  - Hided the empty blue results summary container (`#pa-results-summary`) when empty to clean up the page.
  - Handled target-only syllable durations gracefully when there is no user recording yet: displays target durations with simplified labels and hides count mismatch warnings.
  - Eliminated "boxes inside boxes" styling, removing all gray/white borders, shadows, and paddings from intermediate layout containers.
  - Resolved Playwright E2E browser checks regression and updated test assertions for toggles.

## [V1.8.22] - 2026-07-13
- **Pronunciation Reference Audit Campaign Tools**:
  - Implemented deterministic pronunciation audit manifests with customizable cohort slicing.
  - Added support for resumable pronunciation cohort auditing and aggregated metrics reporting.
  - Added a Python-based CI verification script for reference audits.
  - Documented audit results for a 3000-word campaign under `test-results/`.

### Changed
- **Pronunciation Analyzer UI Redesign**:
  - Redesigned the Pronunciation Analyzer layout to be compact and streamlined.
  - Combined American IPA display and the native audio listen button into a single line to save vertical space.
  - Restructured the comparison graph cards: placed Prosody Comparison (Pitch/Volume toggle) and Syllable Duration Comparison into a clean side-by-side grid layout.
  - Shifted chart toggle logic to support toggling between Pitch and Volume/Intensity dynamically on the same canvas.
  - Adjusted the layout elements to align with the main container boundaries on the page without nested borders.

### Fixed
- **Read Aloud Check and Recorded State Transitions**:
  - Remediated state transition bugs for Read Aloud modes.
  - Rebuilt Read Aloud connected speech indices and updated database files.

## [V1.8.18] - 2026-07-03

### Changed

- **Practice Tabs Order Swapped**:
  - Swapped the visual position of "PTE Practice" and "English Practice" scope buttons on the dashboard. "PTE Practice" now appears first, followed by "English Practice", aligned with the default startup configuration.
  - Adjusted automated E2E keyboard navigation focus tests (`tests/browser/practice-phase789-check.js`) to follow the new PTE-first DOM sequence.

## [V1.8.17] - 2026-07-03

### Fixed

- **Root URL Router Scope Reset Bug**:
  - Modified `parseRoute` inside `script.js` to correctly return `isPractice: false` and `scope: null` when accessing the root URL path (`/`). This prevents the application from incorrectly treating the home dashboard as a practice route and resetting the user's practice scope default to English.

## [V1.8.16] - 2026-07-03

### Fixed

- **Practice scope E2E browser tests**:
  - Explicitly set practice scope to English on startup inside `tests/browser/practice-modes-browser-check.js` to align with the test's assertions and restore the build pipeline.
- **Service Worker Cache-Busting**:
  - Incremented `CACHE_VERSION` in `sw.js` and updated the `script.js` cache-busting token to force browsers to load the updated Javascript code featuring the PTE default scope.

### Changed

- **Browser Confirmations**:
  - Replaced native browser navigation confirmation alerts with custom in-web confirmation modals across essay, dictation, and scheduling workflows.

## [V1.8.15] - 2026-07-02

### Changed

- **Default Practice Scope to PTE Practice**:
  - Configured `PracticeScopeManager` to load PTE Practice (`pte`) as the default practice scope on initial visit when no saved preferences exist.
  - Set the PTE Practice tab button in `index.html` as active by default.
  - Updated all guest and logged-in browser E2E test suites to align with and verify the new default behavior.

## [V1.8.14] - 2026-07-01

### Fixed

- **Attempts Detail Modal basic feedback**:
  - Fixed details modal popup to display Word Count, Form score, and Spelling & Grammar check issue counts when AI scores are missing.
- **Write Essay exit confirmation**:
  - Integrated draft loss navigation warnings when leaving or switching questions in Write Essay, Summarize Written Text, and other active session areas.

## [V1.8.13] - 2026-07-01

### Added

- **PTE Practice Attempts History Toggle & Details Review Modal**:
  - Implemented collapsible attempts history panel under a toggle button for Write Essay and Summarize Written Text (SWT) modes.
  - Centralized state management and rendering logic into `pte-attempt-archive.js` supporting dynamic updates across active question IDs.
  - Implemented high-fidelity detailed attempts review modal displaying user response snapshots, prompt snapshots, overall scores, and rubric score breakdowns.
  - Integrated automated E2E browser verification testing using Playwright.

## [V1.8.12] - 2026-07-01

### Added

- **Production Speaking Assessment Integration**:
  - Integrated and verified production speaking assessment routes for Read Aloud mode.

## [V1.8.11] - 2026-06-26

### Removed

- **Figma MCP Server**:
  - Removed the `figma-mcp-server` directory and its code, uninstalling Figma from the workspace.
  - Removed `start-figma-mcp.bat` batch script.
  - Removed `mcp_config.json` configuration file.

## [V1.8.10] - 2026-06-01


### Added

- **E2E & Integration Tests**:
  - Added new integration tests: `tests/crm/agent-course-rates-route-behavior.test.js`, `tests/crm/agent-source-route-behavior.test.js`, `tests/crm/agent-source-workspace.test.js`, and `tests/crm/finance-route-behavior.test.js`.
  - Added Playwright E2E browser tests for Agent Source management and verified focus-visible highlights.
  - Added Playwright network mocking for local Ollama instance requests (port 11434).

### Improved

- **Testing Infrastructure**:
  - Extracted shared fake database and route execution mocks to `tests/crm/route-test-helpers.js` to eliminate code duplication across route test files.
- **Task Tracking & Version Management**:
  - Automated version synchronization across `GEMINI.md`, `package.json`, and browser files.

## [V1.8.9] - 2026-05-30

### Added

- **Custom Agent Course Commission Rates**:
  - Added customizable course commission rates (in basis points) for agent sources.
  - Developed commission reporting system calculating tuition agent commissions with correct override hierarchy: explicit commission overrides -> default course rates -> fallback defaults.
  - Added validation logic throwing error for rate out of bounds or invalid course/agent keys.

### Improved

- **Agent Management UI**:
  - Enhanced workspace cards with modern interactive states, focus rings, and hover outlines.
  - Wired full keyboard event listeners (`Enter` and `Space`) to cards for accessibility compliance.
- **Classroom Scheduler**:
  - Simplified the seed generation flow to use stored default schedule configurations rather than modal inputs, preventing state mismatches.

## [V1.8.8] - 2026-05-28

### Added

- **Highlight Correct Summary (HCS) Listening Practice Mode**:
  - Full client-side integration with v7 question picker, shuffled choices container, speed controls (0.75x to 1.5x), and Kokoro TTS multi-voice support (60 voice variants).
  - Shuffled option rendering with option-level independent explanations generated via local GemmaAI.
  - Interactive retry/reset behavior and retractable explanation disclosure panels.
  - Visual glassmorphic design and E2E Playwright test suite passing.

- **Multiple Choice Single Answer (RMCSA) Reading Practice Mode**:
  - Implemented client-side UI, circular radio selector interaction, and binary scoring logic.
  - Option-level explanations generated and sanitized.
  - Added robust parsing fallback for multi-line and multi-paragraph answers.

- **Highlight Incorrect Words (HIW) Listening Practice Mode**:
  - Cleaned up transcript comparison logic by adding automatic Column D generation.
  - Passed all data guardrails and Playwright browser check test suites.

- **Select Missing Word (SMW) Listening Practice Mode**:
  - Integrated interactive volume slider and speaker icon toggle (persistent in localStorage).
  - Reduced beep volume by an additional 50% (processed all 267 audio files).
  - Added keyboard navigation, radio group attributes, and modal focus management.

### Fixed

- **General Fixes & Improvements**:
  - Center-aligned Vocab Book modals and unified header button rendering.
  - Fixed teacher advice fallback parsing (`teacherAdvice` vs `teacherAdviceChat`) in `swt-mode.js` and `write-essay-mode.js`.

## [V1.8.7] - 2026-05-27

### Fixed

- **SST Expected Main Points Quality Refinements**:
  - Successfully updated all 585 questions in the database (`public/database/SST/SST/SST.xlsx`) with high-fidelity expected main points, correcting 291 flagged questions.
  - Fine-tuned 4 specific edge cases (Q457, Q535, Q552, Q658) with tailored, highly accurate points to resolve remaining semantic mismatches.
  - Re-audited the database using local Gemma AI to achieve a 100% quality pass rate (585/585 questions).
  - Validated database structure, count constraints, and E2E browser behavior via automated test suites.

## [V1.8.6] - 2026-05-26


### Added

- **Select Missing Word (SMW) Audio Volume Slider**:
  - Integrated a premium, interactive volume slider into the settings panel of the SMW audio player.
  - Saved volume preferences persistently in `localStorage` under `smw-volume`.
  - Added click-to-mute/unmute interactive toggle functionality directly on the volume speaker icon.
  - Dynamically set the `<audio>` element volume to matches current state on load, playback, and voice change.
  - Styled volume controls with custom glassmorphic and range track rules in `public/smw-mode.css`.

### Improved

- **Select Missing Word (SMW) Beep Volume Reduction**:
  - Reduced the volume of the SMW beep sound by a further 50% (resulting in 35% of the original volume).
  - Reprocessed all 267 audio files in `public/database/SMW/audio` with the new quieter beep.

## [V1.8.5] - 2026-05-26

### Improved

- **Select Missing Word (SMW) Beep Volume Adjustment**:
  - Reduced the volume of the source `beep.mp3` sound by 30% using ffmpeg (volume factor 0.7).
  - Automatically processed and rebuilt all 267 pre-generated audio files in `public/database/SMW/audio` by trimming the old beep at the end (last 0.8s) and appending the quieter version.

## [V1.8.4] - 2026-05-26

### Fixed

- **Select Missing Word (SMW) Playback Race & Event Listener Leak**:
  - Implemented dynamic event listener cleanup in `changeVoice()` using a saved state reference `state.activeLoadedMetadataListener`.
  - Cleared any pending loadedmetadata listener during question changes in `loadQuestion()` and component exit in `onExit()` to prevent playback state corruption.
- **Transcript Highlight Parsing**:
  - Simplified the trailing `[BEEP]` check and text extraction in `submitAnswers()` using a case-insensitive regular expression `/\[BEEP\]\s*$/i`.
  - Cleaned up dead `else if` conditional paths that were redundant.
- **Passage Text UI Reset**:
  - Updated `resetFeedbackUI()` to clear the transcript text container `#smw-passage-text` when resetting question state.

## [V1.8.3] - 2026-05-23

### Added

- **Multiple Choice Single Answer (RMCSA) Reading Practice Mode**:
  - Implemented client-side UI, circular radio selector interaction, and binary scoring logic (1 point for correct, 0 points for incorrect).
  - Added custom styles `public/rmcsa-mode.css`, runtime logic `public/rmcsa-mode.js`, and E2E browser check tests `tests/browser/rmcsa-mode-browser-check.js`.
  - Configured launcher card in the PTE dashboard, tab headers in `public/index.html`, script router launcher (`public/script.js`), and lazy loader (`public/js/lazy-loader.js`).
- **AI Explanation & Enrichment**:
  - Seeded sample explanations in `public/database/RMCSA/RMCSA/RMCSA.xlsx` and added `public/database/RMCSA/enrich_rmcsa.py` for full option-level explanation enrichment via local GemmaAI/Ollama.

### Improved

- **Offline Cache Handling**:
  - Updated service worker fetch handling in `public/sw.js` to bypass offline cache for all database `/database/` resources.
- **Deep-Link Practice Routing**:
  - Integrated full deep-link question selection routing and event listeners across ROP, RMCMA, D&D, and RMCSA modes.

## [V1.8.2] - 2026-05-22

### Added

- **Drag & Drop (D&D) Reading Practice Mode**:
  - Implemented client-side UI, interactive drag-and-drop interaction, and automatic dataset parsing.
  - Added dedicated styles `public/dd-mode.css`, runtime script `public/dd-mode.js`, and verification tests `tests/browser/dd-mode-browser-check.js`.
  - Configured and launched D&D practice mode card in the PTE dashboard.

### Improved

- **Layout Decluttering**:
  - Standardized card structures by removing nested card borders and shadows ("boxes in boxes") across ROP, RMCMA, and D&D modes.
  - Streamlined container background flow to align intermediate layout card elements naturally.

### Fixed

- **CI/CD Build Pipeline**:
  - Fixed exit code 128 failure on GitHub Actions by removing ghost submodule entry `tmp_skills_repo` from the git index.
  - Configured `.gitignore` to exclude local `scratch/` workspace folders.

## [V1.8.1] - 2026-05-21


### Added

- **Re-order Paragraphs (ROP) Adjacent Pair-Wise Cohesion Feedback**:
  - Automatically enriched all 755 ROP database rows with transition cohesion reason metadata as JSON mappings in Column G (`COHESION_REASONS`).
  - Added pairwise cohesion feedback cards for incorrect adjacent user transitions (escaped and capped at a maximum of 4 cards) in `public/rop-mode.js`.
  - Added optional "Explain my exact order" button, spinner, and integration with `POST /api/rop/explain-order` mapping correct and user sequences.
  - Implemented the `/api/rop/explain-order` endpoint in `src/server/app.js` utilizing the local Ollama instance with rate limiting.
  - Integrated ROP difficulty filter dropdown and dynamic jump search views.
  - Added two new E2E Playwright tests (`tests/browser/rop-mode-browser-check.js` and `tests/browser/rop-difficulty-browser-check.js`) to verify full practice flows, correctness, critique APIs, error handling, and difficulty filters.

## [V1.8.0] - 2026-05-20

### Added

- **Multiple Choice Multiple Answers (RMCMA) Mode**: Implemented the new reading practice mode under PTE Practice -> Reading.
  - Parsed and unzipped the Excel question database containing passages, question stems, shuffled options, and correct answers marked with `[x]`.
  - Enriched the Excel sheet with Gemini API to automatically generate detailed explanations for the correct answers.
  - Implemented high-fidelity V7-themed reading UI featuring a responsive passage view, shuffled multiple-choice cards, and custom CSS selection states.
  - Created color-coded correction feedback (green borders for correctly chosen options, red text with icons, and grayed-out/disabled state for unselected incorrect options).
  - Built a retractable, toggleable explanation panel under a "Show explanation" button that reveals Gemini-generated insights.
  - Added full test coverage via a Playwright browser test suite that verifies route initialization, card interactions, scoring rules, explanation triggers, and retry/reset flows.

## [V1.7.9] - 2026-05-20

### Added

- **Question-Level Audio Subdirectories**: Reorganized and grouped all 30,000+ Read Aloud voice assets into separate subfolders named after their respective question ID (`public/database/RA/Voice/audio/{id}/`).
- **Dynamic Subdirectory Path Resolution**: Updated `public/read-aloud-mode.js` path builders to dynamically resolve the new question folder structure when loading files.
- **Subdirectory Audio Batching & Scanning**: Updated `scripts/kokoro/kokoro_batch_all_voices.js` and `scripts/kokoro/kokoro_manifest_builder.js` to batch write audios to question-specific folders and perform recursive scans to assemble the manifest.

### Fixed

- **Guest Mode Firestore Permission Denied**: Corrected a bug in `database-service.js`'s `currentUser` detection where the Firebase Auth instance was treated as a valid authenticated user object (due to a fallback check). Checking `auth.uid` first and falling back to `auth.currentUser` prevents unauthorized Firestore write attempts in guest/unauthenticated mode.
- **Browser Testing Audit**: Verified the complete Read Aloud playability and UI/UX flow in the browser, passing all Playwright integration tests.

## [V1.7.8] - 2026-05-20

### Added

- **Automated Version Synchronization**: Created an automation script (`scripts/sync-version.js`) and integrated it into the deployment workflow (`deploy.yml`) and `package.json` scripts to automatically sync the HTML version indicator, cache-busting tokens, static assertion tests, and conductor metadata with `package.json` version bumps.

## [V1.7.7] - 2026-05-20


### Fixed

- **Visual Version Indicator Mismatch**: Corrected the visual version indicator at the bottom-right of the landing/practice pages to correctly match the active release. Updated hardcoded occurrences in `public/index.html` and cache-busting version strings in `public/crm-admin.html` to `V1.7.7`.

## [V1.7.6] - 2026-05-20


### Added

- **Audio Playback & UI/UX Test Suite**: Created a Playwright integration test at `tests/browser/read-aloud-audio-matching-check.js` to verify voice playability matching transcripts, speeds, and genders across local and production environments, alongside UI/UX assertions for speed/gender active states, connected speech guides, and the V7 question picker drawer.
- **Headed Browser Mode**: Enabled `--headed` execution in the Playwright test suite to launch a fully visible browser with interactive slow-motion delays.

### Improved

- **Kokoro Audio Pipeline Concurrency**: Integrated concurrency control and rename retries in `kokoro_batch_all_voices.js` to accelerate audio asset generation and prevent file locks.

## [V1.7.5] - 2026-05-19

### Fixed

- **GitHub Actions Deployment Workflow**: Completely resolved deployment failures under `workflow_run`. Removed the restricted `ref` argument, defined `contents: read` permissions, and eliminated `"pinTag": true` from the `/api/**` rewrite in `firebase.json` to prevent hosting-only deployments from failing due to restricted Cloud Functions API listing lookups.
- **UI Hardening and Robustness**: Implemented safe property navigation for global `VocabularyBook` calls and unified header button rendering to prevent duplicate DOM node injections.
- **Summarize Written Text (SWT) Scoring Initialization**: Resolved a critical initialization crash on load in `swt-mode.js` by refactoring the Firestore check. Instead of directly querying the `window.__FIREBASE_INTERNAL__` object which is initially undefined or incomplete during early loading, it now delegates to `FirebaseService.checkScoringCapability()` with a listener-backed fallback. This ensures the UI is correctly constructed and populated without throwing `TypeError` or stalling.

## [V1.7.4] - 2026-05-19

### Added

- **UI Refactoring Playwright Test Suite**: Updated `tests/browser/ui-refactor-check.js` to assert click behaviors, popup state animations, and modal visibility of the new centered Vocab Book list modal `#vocab-list-modal`.

### Improved

- **Vocab Book Card Modal Navigation**: Replaced the deprecated floating sidebar trigger on the `.srs-card-modern` card click with a direct call to `VocabularyBook.showListModal()`, providing a cleaner and more focused user experience.
- **Vocabulary Book Global Methods**: Exposed `showListModal` and `hideListModal` in the global `VocabularyBook` namespace in `public/vocab-book.js` for clean external invocation.

## [V1.7.3] - 2026-05-18

### Fixed

- **GitHub Actions Deployment Workflow**: Fixed checkout step in `deploy.yml` by using `ref: ${{ github.event.workflow_run.head_branch }}` instead of `head_sha` to prevent exit code 128 (arbitrary SHA fetching restriction).

## [V1.7.2] - 2026-05-18

### Staged

- **Read Aloud voice assets optimization**: Excluded ongoing generating Read Aloud audio assets from source control using `.gitignore` and updated assets manifest tracking.

## [V1.7.1] - 2026-05-18


### Added

- **Kokoro Multi-Voice TTS system**: Integrated high-quality local Kokoro-FastAPI engine for Read Aloud mode with gender-aware randomized voice picker UI, accent-labeled dropdown support (15 voices), slow/normal speed options, and automatic generation of voice-keyed audio assets + manifest tracking.
- **Summarize Written Text (SWT) Mode**: Full client-side integration with v7 question picker, precise timing via `requestAnimationFrame`, double-submission guards, and server-side Firebase AI scoring using Gemini.
- **Respond To a Situation (RTS) Mode**: Completed Speaking practice mode with full client-side state machine (IDLE, PREP, RECORDING, RESULTS) and UI timers, integrated automated scoring pipeline, and detailed browser test plan.

### Improved

- **BEL Assistant Chat UI**: Refactored chat drawer using a flexbox container layout to resolve scroll/clipping issues, and implemented Enter key submission for the chat textarea.
- **Test Suite Integrity**: Hardened Express router registration against concurrent injection gaps, resolving mounting crashes across Route and Scalability test suites.

### Fixed

- **Express Startup Crashes**: Mocked missing routes inside test environment specifications to allow clean server startup and testing.

## [V1.7.0] - 2026-05-12

### Added

- **Write Essay Testing**: Finalized comprehensive browser test suite for essay feedback and AI scoring.
- **CRM Staff Management**: Re-enabled and finalized the CRM Staff management interface in the admin panel.

### Improved

- **PTE CRM Mappings**: Updated the CRM Student Modal English target level score mappings to accurately reflect official PTE visa point requirements, explicitly displaying "N/A" for non-applicable sections.
- **Lead Conversion Logic**: Improved state handling and API triggers to ensure seamless conversion of leads into active student records within the management system.
- **Header Navigation**: Cleaned up practice environment navigation by removing redundant "About Us" and "Home" links, and redirected the primary logo to the default practice page.
- **AI Score Visibility**: Implemented user-specific visibility rules for AI scoring buttons based on authentication state.

### Fixed

- **assessWriting Function**: Resolved 500 errors in the `assessWriting` cloud function to restore stable AI essay scoring.

## [V1.6.9] - 2026-05-07

### Improved

- **Classroom Modal Performance**: Eliminated 3s delay when opening classroom modal by rendering the modal immediately and deferring all data fetching (courses, modules, classwork, live sessions) to parallel background requests via `Promise.all`.
- **Course Catalog Caching**: Added 60-second in-memory cache to `CrmCourses.fetchCourses()` preventing redundant `/api/admin/courses` API calls across modal resets and re-opens.
- **Teacher Searchable Dropdown**: Replaced the raw UID text input for Primary Teacher with a searchable dropdown that queries Firestore users with autocomplete, keyboard navigation, and display name resolution.
- **Weekday Multi-Select**: Replaced plain text "mon,wed,fri" inputs with interactive toggle-button weekday selectors for both seed and regeneration scheduling forms.
- **CRM Label Clarity**: Renamed "Seed Start Date/Time/Weekdays" labels to "Default Start Date/Time/Weekdays" for better admin comprehension.
- **Global Box-Sizing**: Applied `box-sizing: border-box` reset to all CRM elements to prevent layout overflow issues.
- **BEL Assistant Init**: Wired `CrmBelAssistant` module initialization into the CRM admin controller with route-change notification support.
- **Cache Busting**: Updated all CRM script and stylesheet references to `v=20260507-v1.6.9`.

### Fixed

- **Init Function Scope**: Fixed a premature function closure in `crm-admin.js` that orphaned the AI summary button handler outside its parent scope.
- **Redundant Course Fetch**: Removed duplicate `populateClassroomCourseOptions()` call from `resetClassroomModal()` that was triggering unnecessary network traffic on every modal open.

### Removed

- **Legacy Meeting Fields**: Removed deprecated "Meeting Days" and "Meeting Hours" form fields and their associated `syncMeetingFieldsFromSeed` logic from `classrooms.js`, replaced by the weekday selector component.

## [V1.6.7] - 2026-05-05

### Added

- **Write Essay Mode Remediation**: Finalized AI grammar scoring integration and hardened UI state management.

### Improved

- **PTE Write Essay Optimization**: Finalized the massive generation pipeline, achieving **99.7% dataset coverage** (2,531 of 2,538 variants populated).
- **Gemma4 Quality Audit**: Conducted an official scoring verification on the full dataset, achieving a **93.5% pass rate** on previously failing "hard" cases.
- **Practice Dashboard SPA Routing**: Reconfigured Express catch-all routing to distinguish SPA navigation from static assets, added base href, and finalized History API integration across all practice modes.
- **CRM Automation**: Resolved visa listener early return bug to ensure visa-to-English-level auto-filling works in the student modal.

### Fixed

- **formatDateTime Reference**: Resolved ReferenceError in CRM admin and workspace scripts.
- **Deep-Link Rendering**: Fixed 404-driven dependency gaps for styles and scripts on practice mode pages.

## [V1.6.6] - 2026-04-22

### Added

- **Write Essay Mode**: Implemented PTE Writing Essay practice mode with local Ollama-based vocabulary generation (CEFR A2-C2 topic-specific vocabulary for 453 prompts).
- **Dialogflow Integration**: Integrated Dialogflow Messenger chatbot UI as an AI tutor evaluating essays against a 7-point PTE rubric.
- **SGD Mode Implementation**: Implemented Summarize Group Discussion (SGD) practice mode for PTE Speaking.
- **SGD Audio Integration**: Wired SGD audio folder to questions.

### Improved

- **SGD UI/UX**: Refactored SGD note-taking with vertical stack layout, topic input fields, and non-blocking recording feedback.
- **Chatbot Customization**: Updated chatbot avatar with custom design #10 and refined widget scale/positioning.
- **Auto Accept Script**: Refactored for performance and Shadow DOM support.

### Fixed

- **Authentication & Permissions**: Resolved 400 Bad Request on startup and Firestore permission denied errors.
- **CRM Bug Fixes**: Fixed production CRM console errors (PATCH crmId response correction + 404 schedule endpoint requests).

## [V1.6.5] - 2026-04-12

### Added

- **Speaking Attempt API Overhaul**: Full transactional rewrite of practice-attempts routes with idempotent `prepare` (supports `attemptId` reuse), WAV metadata validation (`parseWavMetadata`), per-mode constraint snapshots, and structured audit trail via `speakingAttemptEvents` collection.
- **Rate Limiting Middleware**: New `practice-attempts-rate-limiter.js` with per-UID and global rate limiters for speaking attempt and shared attempt endpoints.
- **Attempt Constraints Module**: Centralized `attempt-constraints.js` defining per-mode hard/UI max durations, upload byte limits, and signed URL TTLs.
- **WAV Audio Parser**: New `wav-audio.js` module for server-side WAV header parsing and duration extraction.
- **Share Link Rotation & Revocation**: Added `DELETE /:attemptId/share` and `rotate` flag on `POST /:attemptId/share` for share lifecycle management.
- **Feedback List & Edit Routes**: New `GET /:attemptId/feedback` and `PATCH /:attemptId/feedback/:feedbackId` endpoints with audio validation and concurrency-limited signed URL generation.
- **Admin Teacher Role Management**: New `POST /identity/users/:uid/role` endpoint for granting/revoking teacher custom claims and Firestore profile sync.
- **Firestore Rules**: Added server-owned collection rules for `speakingAttempts`, `speakingAttemptShares`, `speakingAttemptCounters`, `speakingAttemptEvents`, `practiceAccessByUid`, and `practiceAccessJobs` (all `read, write: if false`).
- **Auth Middleware Module**: Extracted `auth-user.js` middleware for reusable Firebase Auth token verification.
- **Browser Test Scripts**: New `asq-mode-browser-check.js` and `practice-attempts-api-browser-check.js` Playwright test scripts.
- **Contract Tests**: Added 6 new contract test files covering practice-attempts auth/limiter, constraints, router, sharing, privacy, and storage rules.
- **Testing Plans**: Added `2026-04-10-asq-mode-browser-testing-plan.md` and `2026-04-11-practice-attempts-speaking-upgrade-browser-testing-plan.md`.

### Improved

- **Auto Accept Script**: Hardened visibility detection (opacity threshold, `pointerEvents` check), added `isDisabledLike` helper for ARIA/native disabled states, removed "Expand" button auto-clicking, added `allowDangerous`/`skipCookiePrompts`/`requireTopmost` config toggles with HUD checkboxes, cached DOM references for scan-loop performance.
- **ASQ Quiz Mode**: Refactored `asq-mode.js` with DOM caching via Map lookups, XSS-safe rendering using `textContent`, improved redo flow, and audio playback with hidden question text before submission.
- **Job Runners**: Added structured `logJobEvent` logging, paginated feedback cascade deletion, stale job lock reclamation (30min TTL), pre-deletion access recheck with promotion path, and `appendAttemptEvent` audit writes.
- **Practice Access Reconciliation**: Enhanced promotion jobs with counter document updates and event logging.
- **Reviewer Access**: Replaced simple `isReviewer` check with `resolveReviewerAccess` combining claims and profile lookup.
- **Bookmark Logic**: Transactional bookmark toggle with atomic counter updates via `speakingAttemptCounters`, 24-hour grace period on unbookmark.
- **Signed URL Management**: Constraint-aware expiration minutes replacing hardcoded 15-minute TTL.
- **Speaking Attempt Retention Plan**: Updated plan doc with execution changelog, flattened override field names, detailed `accessSnapshot`/`promotion` schemas, and fixed grace period to 24 hours.

### Fixed

- **Firebase Init**: Updated `firebase-init.js` for emulator connectivity fixes.
- **Server App**: Cleaned up route registration in `src/server/app.js`, removed deleted `src/routes/asq.js`.
- **Emulator Seed Script**: Updated `scripts/seed-emulator-admin.js` for reliable admin account provisioning.

### Removed

- **Deleted Files**: Removed stale `src/routes/asq.js`, Excel temp files (`~$question_bank_data.xlsx`, `~$ASQ.xlsx`).

## [V1.6.4] - 2026-04-10

### Added

- **Teacher Scheduler Duplication**: Implemented session duplication logic in the CRM Teacher Scheduler UI.
- **Contracted Target Validations**: Added server-side and client-side logic to derive and validate contract count states for class scheduling.
- **Live Browser Check**: New Playwright-based live verification for Teacher Scheduler workflows.

### Improved

- **CRM Admin Safeguards**: Implemented `maxDocsPerCollection` limits to prevent accidental bulk operations on large production datasets.
- **Scheduling Service**: Refined session normalization and added robust string cleaning for session IDs.
- **Conductor Protocols**: Updated `GEMINI.md` with enhanced council and engineering protocols.

### Fixed

- **Council Analytics**: Resolved stability issues in `summon_council.js` regarding context injection and telemetry output.
- **UI State Persistence**: Fixed minor reactive state bugs in the Teacher Scheduler workspace during session updates.

## [V1.6.3] - 2026-04-02

### Added

- **Teacher Scheduler Validations**: Browser test validation for CRM class scheduling workflow.
- **RFIB Audio Pipeline**: Initial generation of male ElevenLabs RFIB prompt voices.
- **Speech Coach Annotations**: Refined inline phonetic annotations to provide clear Read Aloud feedback metrics.

### Improved

- **Read Aloud Mode UX**: Upgraded sound change hints from floating popups to intuitive inline phonetics and added persistent visibility toggle.
- **Practice Mode Defaults**: Speaking tab is now strictly the default landing tab, favoring Read Aloud.
- **CRM Student Deep Linking**: Refined modal hash propagation enabling permanent URLs for student CRM entries.

### Fixed

- **Speech Coach Stability**: Decomposed the monolithic `renderConnectedSpeechResults` method and removed dead legacy tracking code.
- **Student Profile Navigation**: Fixed the state persistence bug resetting student panels to the first tab upon routing.
- **UI Labeling Consistency**: Renamed outdated "Listening practice" terminology to the unified "English Practice" label.

## [V1.6.2] - 2026-03-30

### Improved

- **Entrance Test Results**: Upgraded the result screen with a visual word-level transcript diff (green/red/strikethrough) and compact table layouts.
- **Result Feedback**: Implemented color-coded answer pills (green for correct, red for incorrect) for better visual comparison in listening and vocabulary sections.

## [V1.6.1] - 2026-03-30

### Added

- **CRM Extensions**: Added administrative recycle bin, bulk delete functionality, and entrance test link recovery endpoints.
- **Audio Pipeline**: Integrated generation of Beginner Mode (Speed 80) MP3s for the RFIB dataset.

### Improved

- **Speech Coach UX**: Modernized Read Aloud mode feedback UI with a two-column compact layout, robust token-based annotations, and accessible accordions.
- **CRM Admin UI**: Resolved header overflow issues for a robust, responsive layout on smaller viewports.

### Fixed

- **Entrance Tests**: Corrected backend scoring logic and executed rescoring.
- **PDF Export**: Addressed layout clipping and blurry rendering by configuring proper width constraints and lossless PNG capture in `jsPDF`/`html2pdf`.
- **System Stability**: Fixed High Council scripting and accessibility issues for agentic assistance.

## [V1.5.9] - 2026-03-25

### Added

- **Read Aloud Mode**: Implemented new practice mode with Azure Pronunciation Assessment integration and sample audio filtering.
- **Audio Generation**: Gemini API integration for generating test audio for RFIB Excel entries via pipeline.
- **Content**: Added `BaiTapTongHopSo5` Excel.

### Improved

- **Reading Journey UX**: UI refinements, modern sidebar buttons, and profile alignment.
- **Landing Pages**: Rewrote About Us and Home pages with concise text and HD generated images, aligning heroes.
- **Testing**: Executed CRM full workflow browser tests and Read Aloud chunking QA.
- **Assessment UX**: Fixed pronunciation assessment text overflow and linking sound symbols positioning.

### Fixed

- **Analytics Display**: Fixed Bar Chart to include Doanh Thu and Doanh So.
- **Scripting**: Extended auto-accept script for testing tools (always run, retry, expand).
- **Skill Tree**: Temporarily hid the Skill Tree button.

## [V1.5.8] - 2026-03-14

### Added

- **Pronunciation Analyzer AI Summary**: AI Teacher's Note with Gemini-powered pronunciation feedback and syllable breakdown.
- **Collo-dictate Search UX**: Accessibility improvements (ARIA attributes), clear button, constrained width, and context-aware "no results" message.
- **GStack Workflows**: Integrated `/ceo-review`, `/diff-qa`, and `/ship` workflows into GSD system with auto-trigger rules.
- **Landing Page Images**: Added hero lifestyle, screenshot assets (pitch analyzer, speak mode, type mode, dashboard, daily review), and AI-generated concept art.
- **About Page Updates**: Refreshed About Us page styling and content.

### Improved

- **Note Difficulty Reclassification**: Multi-factor algorithm replacing Flesch-Kincaid for more balanced difficulty distribution across levels.
- **Fill Mode Extended Profiles**: Enabled progression beyond Level 1 with extended difficulty profiles.
- **Landing Page Round 2**: Implemented feedback-driven refinements to landing page layout and content.
- **Pronounce Mode**: Mobile compatibility, Praat Cloud Run backend integration, and corrected pronunciation practice panel.
- **Loader Slogan**: Refined font size and animation timing for dual-phrase slogan.

### Fixed

- **Difficulty Manager**: Fixed extended profiles and synced updated classifications to Firestore.

## [V1.5.7] - 2026-03-13

### Added

- **Whisk Thumbnails**: AI-generated thumbnails for all practice modes via Google Whisk integration.
- **Dual API Layer**: Google AI Studio (free) as primary with Vertex AI (paid) fallback for story generation.
- **Service Worker**: Background caching and offline resilience via service worker registration.
- **Background AI Workers**: Offloaded AI processing to web workers for non-blocking UI.
- **Service Abstraction Layer**: Unified service interfaces for swappable backend implementations.
- **Pearson-inspired Landing Page Mockup**: Modern landing page design with glassmorphism and 3D depth effects.

### Fixed

- **Practice Mode UI**: Restored all practice modes after 3-island layout broke critical DOM IDs; reverted to stable HTML.
- **Speak Mode Invisible Panel**: Fixed CSS aliases, HTML nesting, and JS temporal dead zone issues.
- **Landing Page Header**: Removed duplicate site-header and fixed nav element overlap.
- **Note Mode Difficulty**: Corrected difficulty categorization for Note/Take Notes practice mode.

### Improved

- **Loading Page Slogan**: Added animated dual-phrase slogan ("Not the best." / "Just better.") with smooth fade transitions.
- **Practice Mode Thumbnails**: Replaced SVG placeholders with generated AI thumbnails for visual polish.

## [V1.5.6] - 2026-03-10

### Added

- **CRM Standardization**: Merged CRM standardization branch into main with unified admin interfaces.
- **Entrance Test Routes**: Added entrance-test routes to Cloud Functions apiApp for production CRM.

### Fixed

- **Rate Limiter**: Fixed ERR_ERL_UNEXPECTED_X_FORWARDED_FOR in Cloud Functions.
- **Story Generation Pipeline**: Ported full Gemini prompts from src/ to functions/, aligned frontend renderBeat with Gemini response fields, normalized beat responses, switched to gemini-2.0-flash model.
- **Service Worker Cache**: Bumped cache versions (v4) and JS version tags to bust stale caches.
- **Reading Journey advanceBeat**: Added missing outlineId/path/level to payload.

## [V1.5.5] - 2026-03-11

### Added

- **Hyper-Minimal Branded UI**: Redesigned all practice modes with a clean, branded aesthetic.
- **Story Quality Rating System**: 8-criterion rubric with auto-assessment for reading journey stories.
- **Scalability Quick Wins**: Compression, caching headers, and resilience improvements for production performance.

### Improved

- **Production Performance**: Investigated and optimized page load times and asset delivery.

## [V1.5.4] - 2026-03-10

### Added

- **Reading Journey (UI Modernization)**: Complete 16-element UI redesign featuring "Calm Immersion" aesthetic with glassmorphism, Outfit typography, and immersive layout.
- **Story Library (Pagination)**: Implemented client-side pagination (10 stories per page) with interactive navigation controls.
- **Topic Filtering**: Added clickable topic chips above the library grid to filter stories by genre/tags.

### Fixed

- **Reading Journey API**: Resolved `startStory` payload mismatch (interests string vs keywords array) and added robust response validation.
- **Initialization Fix**: Corrected route-based initialization in `script.js` for reliable Reading Journey loading.
- **Story Start Bug**: Prevented TypeError crash on story start by ensuring `data.beat` exists before rendering.
- **Entrance Test PDF Export**: Corrected CSS selector mismatch and width constraints that caused content clipping and malformed layouts.
- **Auto-Retry HUD**: Resolved multiple bugs including crash on null elements, global event handler pollution, and incorrect iframe scanning logic.

### Improved

- **Reading Journey UX**: Unified interaction states for buttons (primary gradient vs outline), styled select dropdowns, and refined input fields.
- **Preloader Logic**: Refined 2D/3D preloader transition and dismissal logic for smoother app entry (V1.5.4 refinement).
- **Code Quality**: Performed comprehensive refactoring of `crm-entrance-test-result.js` and `auto_retry_v2.js`, extracting utility functions and breaking down monolithic rendering logic for better maintainability.
- **PDF Generation**: Optimized PDF capture settings with better margins and high-quality scaling.

## [V1.5.3] - 2026-03-07

### Fixed

- **CRM Admin UI**: Restored basic CRM routing to `apiApp.js` for Student and Course profile creation/retrieval, resolving `404 Not Found` errors in the admin dashboard.

## [V1.5.2] - 2026-03-07

### Fixed

- **Classroom API**: Restored missing management routes (`create`, `modules`, `classwork`, `grade`) in `apiApp.js` that caused 404 errors in CRM Admin.
- **XLSX Reference Error**: Added XLSX library CDN to `index.html` head to prevent `XLSX is not defined` crash during sentence database loading.

## [V1.5.1] - 2026-03-07

### Fixed

- **Security Hardening**: Enforced `isStudent` claim requirement for `crmSubmissions`, `crmClassrooms`, and Storage uploads to prevent authenticated-but-unlinked users from accessing or spamming student-specific services.

## [V1.5.0] - 2026-03-07

### Added

- **Student Account (LMS)**: New comprehensive Learning Management System integrated into the CRM for students.
- **Identity Merging Protocol**: Secure "Decoupled Identity" system with Magic Link and 6-char Class Code claim flow.
- **Safety Handshake**: Admin-facilitated manual user linking with visual identity verification.
- **Classroom Feature**: Full implementation of Stream, Modules, and Classwork management for Admins and Students.

### Improved

- **Phase**: Release V1.5.1
- **Backend Reliability**: Refactored student identity logic with Firestore atomic `arrayUnion` and unique code collision checks.
- **UX Refresh**: Centralized custom claim handling in `updateAccountPanelState` for instantaneous UI updates without page reloads.
- **Security**: Hardened Firestore rules for user-linked document isolation in `crmStudents`.
- **Next Version**: `V1.5.2` (Bug fixes/refinement)

## [V1.4.0] - 2026-03-05

### Added

- **Reading Journey**: Integrated Gemini-backed interactive story generation with Firestore caching, accessible at `/readingjourney`.
- **Collo-dictate Mode**: New immersive dictation experience with dedicated UI and utility logic.

### Improved

- **UX Refinements**: Unified Vocabulary Practice UI and fixed progress bar logic for 100% completion states.
- **Production Rollout**: Comprehensive deployment of all pending features and fixes.

## [V1.3.4] - 2026-03-04

### Added

- **Production Rollout**: Committing all pending changes/10k+ files and deploying to Firebase Production.

## [V1.3.3] - 2026-03-04

### Improved

- **Vocabulary Practice UI**: Unified the UI design of the "Other questions with the same vocabulary" section to match the standard Vocabulary Practice components.
- **Progress Tracking**: Fixed progress bar logic for Type and Note modes after achieving 100% completion.
- **Vocabulary Modal**: Resolved text obstruction issue in the "Add to Vocabulary Book" modal at 100% display scale.

## [V1.3.1] - 2026-03-03

### Added

- **Landing Page Localization**: Added a dedicated Vietnamese landing page (`/landing/vi`) with natural, engaging translation tailored for A2 learners.
- **Language Switcher**: Implemented a seamless language toggle (EN | VI) across all landing pages.

### Improved

- **Landing Page Routing**: Configured `/landing` to automatically redirect to the English version (`/landing/en`) as the default fallback.

## [V1.3.0] - 2026-03-03

### Added

- **Penguin Crossing 2.5D Overhaul**: Complete high-fidelity 2.5D renderer upgrade with parallax backgrounds, dynamic layers (Water, Shore, Floes), and high-quality sprite assets.
- **CRM & Student Management**: Initial launch of the teacher/admin CRM for managing entrance tests, student profiles, and progress tracking.
- **Shop Expansion**: Added specialized skill unlocks and items for the RPG progression layer.
- **AI-Powered Services**: Integrated Gemini-based AI checks for writing and streaming feedback for enhanced pedagogy.

### Improved

- **Adaptive Engine V2**: Refined Smart Difficulty with responsive calibration, word-level accuracy scoring, and specialized hint ladders.
- **Product Specifications**: Comprehensive documentation update covering all major features, guidelines, and user workflows in `docs/specs/`.
- **System Architecture**: Hardened server-authoritative scoring and economy logic in Firebase Cloud Functions.

## [V1.1.1] - 2026-02-11

### Added

- **RPG Skill Tree UI**: Implemented a dense, 2-panel Skill Tree redesign with a focus on immersive fantasy aesthetics.
- **Orb-in-Slot Nodes**: New skill node design with rank badges, status indicators (Locked, Available, Acquired), and color-coded rims for Active vs. Passive skills.
- **SVG Connector Links**: Dynamic cubic Bezier links that represent skill dependencies and adapt to layout changes.
- **Adaptive Icon System**: Vector icon support with automatic SVG/PNG fallback and rune-based text for missing assets.
- **SP Tracker**: Integrated Skill Point (SP) calculation and tracking based on core proficiency levels (A1-C2).

### Improved

- **Modal Expansion**: Increased Skill Tree modal width to 1400px to accommodate the new 2-panel graph architecture.
- **UI Performance**: Implemented `ResizeObserver` for robust SVG link re-rendering.

## [V1.1.0] - 2026-02-06

### Added

- **Server-Authoritative Scoring**: Fully refactored scoring to happen on the server. The client now only sends raw answers, preventing accuracy spoofing.
- **LCS Alignment**: Implemented Longest Common Subsequence (LCS) algorithm for Type and Speak modes to ensure fair word alignment and prevent cascade penalties.
- **Anti-Farm Award Ledger**: Added per-user content tracking with diminishing returns (XP/Rating scaling) for repeated daily attempts to discourage farming.
- **Sum-Preserving XP Distribution**: Integrated a remainder-fix algorithm to ensure skill-based XP breakdowns perfectly match the total awarded points.
- **Secure Watch Data**: Split sensitive answer keys into a private sibling collection (`questionKeys`), hiding correct answers from indices and network inspectors.
- **Automated Deployment**: Replaced GitHub Pages workflow with Firebase Hosting automated deployment via GitHub Actions.
- **Service Account**: Integrated Firebase Service Account for secure CI/CD operations.
- **Version Indicator**: Added visual "V1.0.0" label to the bottom right corner of the application.
- **Documentation**: Updated `GEMINI.md` with strict Semantic Versioning and Changelog rules.

### Fixed

- **Watch Admin Security**: Hardened the admin dashboard to manage private keys across dual collections securely.
- **Extended Mode Normalization**: Now normalizes user gap-fill answers (lowercase/trim) to prevent formatting friction.
- **Type Mode "Check" Button**: Resolved `ReferenceError: totalWords is not defined` by calculating word count dynamically from the correct answer.
- **Vocab Book Access**: Added missing event listener to the "View full list" button in the Vocabulary Book side panel.
- **SRS Performance**: Optimized `DictionaryService` to reduce lag during review session initiation.
- **Wiktionary API**: Disabled unreliable endpoints and improved filtering of "obscure" definitions.
