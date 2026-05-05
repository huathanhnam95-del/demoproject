## [V1.6.7] - 2026-05-05

### Added

- **Write Essay Mode Remediation**: Finalized AI grammar scoring integration and hardened UI state management.

### Improved

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
