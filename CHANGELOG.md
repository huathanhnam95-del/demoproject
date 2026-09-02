## [V1.8.87] - 2026-09-02

### Added & Enhanced
- **CRM Teaching Sessions & Visual Mermaid Mindmap System**:
  - Integrated audio lesson analysis pipeline with Gemini 3.7 Flash API (Free Tier) generating executive pedagogical Pre-Class Briefing Cards and interactive Mermaid visual diagrams.
  - Implemented single-pass unified generator (`MERMAID_UNIFIED_PROMPT`) returning structured JSON with both `mindmap` and `flowchart`, eliminating 503 rate limit spikes.
  - Built pure-Python fallback diagram generator (`generate_mermaid_fallback`) ensuring zero data loss during offline runs or API quota limits.
  - Created Firestore backend service (`functions/src/crm/teaching-session-service.js`) and REST endpoints (`functions/src/routes/admin/teaching-sessions.js`) supporting session creation, status lifecycle, retrieval, updates, and audit logging.
  - Added "Teaching Sessions" tab to CRM Student Modal (`public/crm-admin.html` and `public/js/crm/teaching-sessions.js`) with an audio upload composer, live upload progress indicator, session history list, and full-screen multi-view modal (Visual Mindmap, Teaching Flowchart, Briefing Card, Audio Player, Raw JSON).
  - Added full test suites across Python (`tests/test_audio_teaching_logger.py`) and Node (`tests/crm/teaching-session-service.test.js`, `tests/crm/teaching-sessions-frontend-contract.test.js`).

## [V1.8.76] - 2026-08-19

### Fixed & Enhanced
- **CRM Admin Cloud Functions & Account Manager Deployment**:
  - Deployed backend Cloud Functions `api` (`us-central1`) and scheduled runners to production, activating the `/api/admin/accounts` and `/api/admin/accounts/:uid/role` endpoints.
  - Verified live endpoint access returns `200 OK` for authenticated administrators on both `betterenglishlearning.com` and `listening-tasks-3ae34.web.app`.
  - Added ESLint disable directives for clean compilation and linting across Cloud Functions.
- **CRM Admin Header Nav Overflow & Responsive Menu**:
  - Consolidated auxiliary navigation items (Settings, Chatbots, Dev Tools, Pronunciation Samples) into a streamlined **More ▾** dropdown menu to eliminate horizontal header overflow.
  - Polished Pronunciation Verification responsive page header, layout borders, and action button alignment across desktop and mobile viewports.

## [V1.8.75] - 2026-08-19

### Added & Enhanced
- **CRM Pronunciation Verification Sub-Tab Architecture**:
  - Reorganized the Pronunciation Samples tool inside CRM Admin (`public/crm-admin.html` and `public/crm-admin.css`) into a responsive 4-sub-tab workflow:
    - **Record**: Real-time attempt capture, rapid-stream hands-free VAD, Oxford 5000 word selection, and deidentified audio logging.
    - **Queue**: Reference audio variant review queue for missing, conflicting, or unrateable dictionary audio replacements.
    - **Samples**: Cloud-stored deidentified recordings list with audio playback and V3 re-analysis triggers.
    - **Study**: Interactive segmentation study workspace with multi-version alignment and WaveSurfer timeline inspection.
  - Added standalone client-side sub-tab switcher (`initPvSubTabs`) with ARIA accessibility roles and persistence.
- **CRM Admin UI Polish & Design System Alignment**:
  - Added missing `.crm-btn-sm` button sizing utility across CRM styles.
  - Improved layout flow, spacing, action bar positioning, and responsive container constraints.

### Fixed & Hardened
- **ESLint & Code Hygiene**:
  - Resolved `no-empty` lint errors in `public/js/crm/books-workspace.js` storage and bookmark handlers.
- **Automated Verification Suites**:
  - Updated E2E browser tests (`tests/browser/crm-pronunciation-samples-browser-check.js` and `tests/browser/crm-segmentation-study-browser-check.js`) to support sub-tab navigation.
  - Verified 100% test pass across `npm run verify:crm` and all logic suites.

## [V1.8.74] - 2026-08-19

### Added & Enhanced
- **CRM Account Manager System (Staff Workspace)**:
  - Added full administrative user management directory inside the CRM Staff panel (`public/crm-admin.html` and `public/js/crm/staff-workspace.js`).
  - Added admin-only `GET /api/admin/accounts` endpoint querying all users from Firestore with alphabetical sorting and role detection (`admin`, `teacher`, `user`).
  - Added admin-only `PATCH /api/admin/accounts/:uid/role` endpoint enabling secure promotion and demotion of admin privileges.
  - Implemented automatic Firebase Auth custom user claims synchronization (`auth.setCustomUserClaims`) upon role modification so security rules and authentication tokens remain tightly coupled.
  - Implemented bootstrap admin account protection refusing demotion attempts against hardcoded bootstrap admin addresses (`huathanhnam95@gmail.com` and `ADMIN_EMAIL`).
  - Implemented self-demotion prevention guard blocking administrators from accidentally removing their own admin access.
  - Added comprehensive audit logging (`account.promote` and `account.demote`) recorded to `crmAuditLogs`.
  - Added responsive UI table with color-coded role badges (**Admin**, **Teacher**, **User**), confirmation modals, toast alerts, double-click debouncing, and XSS/quote-safe attribute handling.
- **Automated Verification & Unit Testing**:
  - Added comprehensive backend unit test suite (`tests/crm/accounts-role-management.test.js`) verifying listing, sorting, promotion, demotion, custom claims sync, self-demotion rejection, bootstrap protection, and 400/404 error responses.
  - Updated CRM router contract test (`tests/crm/admin-router-contract.test.js`) to assert `/accounts` and `/accounts/:uid/role`.
  - Updated E2E Playwright browser testing suite (`tests/browser/crm-staff-browser-check.js`) verifying live account table rendering and interactive promote/demote button flows.

## [V1.8.73] - 2026-08-16

### Added & Enhanced
- **CRM Books Fullscreen Reader Font Scale Persistence**:
  - Saved reader font scale level to `localStorage` (`crm_books_bv_font_scale`) so zoom preferences persist across sessions and page reloads.
- **CRM Books BGM Firestore Fallback**:
  - Added seamless direct Firestore fallback querying `crmBooks/{bookId}/audio` when API endpoints are unreachable in local or mock environments.
- **Firebase Storage BGM Security Rules**:
  - Configured strict admin-only write/delete permissions on `/crm-books/{bookId}/bgm/{audioFile}` with a 50MB maximum size limit and audio MIME type validation.
- **Automated Live Browser Testing & Evidence Suite**:
  - Added comprehensive 5-step Playwright test script (`tests/browser/crm-books-bgm-live-evidence.js`) verifying admin login, BGM upload modal, and Fullscreen Book Reader audio playback controls.

### Fixed
- **CRM Admin Stylesheet Cleanup**:
  - Removed duplicate `.crm-bv-spread` selector definition in `public/crm-admin.css` to eliminate redundant style shadowing.

## [V1.8.72] - 2026-08-15

### Added & Enhanced
- **CRM Books Fullscreen Reader 9 Atmospheric Background Themes**:
  - Replaced simple light/dark toggle with a CSS custom property theme engine supporting 9 distinct aesthetic atmospheres: Classic, Ink, Campfire, Ocean, Forest, Lavender, Sunset, Midnight, and Potter.
  - Implemented vertical theme switcher panel with color-coded circular swatches on the left margin with frosted glass backdrop and active indicator rings.
  - Added subtle animated atmospheric effects (`::before` glow/shimmer) for Campfire (flickering warm amber), Ocean (caustic underwater light shimmer), and Potter (Hogwarts candlelight library glow with gold accents and aged parchment).
  - Stored theme preferences persistently in `localStorage` (`crm_books_reader_theme`) with backward compatibility for existing dark mode settings.
  - Implemented responsive collapsing for mobile viewports (≤740px), rendering a centered floating bottom strip.
- **CRM Books Realistic 3D Dual-Sided Page Flip Animation**:
  - Implemented dynamic 3D leaf rotation (`rotateY(-180deg)` on next, `rotateY(180deg)` on prev) with backface-visibility and gradient fold shadows for genuine paper-turning aesthetics.
- **CRM Books BGM & In-Reader Audio Player**:
  - Added custom MP3 background music upload modal with progress tracking, storage management, and live audio player with track selection, volume slider, animated wave bars, and auto-advance.

### Fixed
- **Word Segmentation Over-Splitting & Text Glitch Resolution**:
  - Upgraded English dictionary corpus from 43k to 257,000+ words with accurate Zipf frequency log-costs, preventing false splitting of valid vocabulary (e.g. `andragogical`, `readiness`, `Skinner`, `Differential`, `readable`, `known`).
  - Fixed regex escape strings in client-side text preprocessor to prevent accidental character stripping across camelCase, number, and punctuation boundaries.
  - Implemented automatic hyphenation repair across line breaks (`child-\nlearning` → `child learning`, `differen-\ntiated` → `differentiated`).
  - Added OCR bigram normalization (e.g. `area good deal` → `are a good deal`).

## [V1.8.71] - 2026-08-15

### Fixed & Enhanced
- **CRM Books Fullscreen Reader Dynamic Virtual Page Flow**:
  - Eliminated all scrollbars from book pages (`overflow: hidden` on page spread and body).
  - Implemented dynamic virtual pagination (`buildBookViewPages` + `splitBlocksIntoReaderPages`) that automatically decomposes extracted PDF pages into clean, book-sized spreads without overflowing the viewport.
  - Multi-part pages are cleanly labeled (e.g., `Page 4 (1/2)` & `Page 4 (2/2)`) and advance seamlessly with page flips.
- **Fixed Font Size Slider Scaling**:
  - Corrected CSS variable parsing for `--crm-bv-font-scale` to pass unitless numeric scale values, fixing broken CSS `calc()` operations.
  - Live slider updates now dynamically reflow content into more or fewer virtual pages in real time.

## [V1.8.70] - 2026-08-15

### Fixed & Enhanced
- **CRM Books Dynamic Programming Word Segmenter**:
  - Implemented high-performance client-side Viterbi DP English word segmentation (`books-word-segmenter.js`) with an extensive 43,800+ vocabulary corpus (Oxford 5000 + common words + inflections).
  - Automatically reconstructs missing spaces between glued words in PDF text extraction across both Pages tab and Fullscreen Book reader.
  - Separates stuck punctuation, numbers, and camelCase boundaries seamlessly without corrupting correctly-spaced text.
- **CRM Books Fullscreen Reader Viewport Enlargement**:
  - Expanded book spread max-width to 1360px and dynamic viewport height to fill desktop screens comfortably.
  - Optimized page padding and readability proportions.

## [V1.8.69] - 2026-08-15

### Added
- **CRM Books Fullscreen Book Reader**:
  - Two-page spread overlay with central spine, page fold shadows, and serif typography for a print-book reading experience.
  - Page flip animation: right page rotates forward (rotateY, 0.6s ease), left page rotates backward on previous.
  - Light mode (warm parchment #faf6ef on #e8e0d4) and dark mode (cool charcoal #28282e on #1a1a1e) toggle.
  - Keyboard controls: A/← for previous spread, D/→ for next spread, Esc to exit.
  - Font size scaling with A−/slider/A+ controls (80%–180% range).
  - Responsive layout stacking pages vertically on screens ≤740px.
  - `prefers-reduced-motion` support disabling flip animations.

### Enhanced
- **Color Theme Optimization**:
  - Consolidated design tokens across `design-tokens.css`, `style.css`, `site-header.css`, and `crm-admin.css` for white, green, yellow, and blue color themes.
  - Improved color balance, brightness, and accessibility across all UI surfaces.

## [V1.8.68] - 2026-08-15

### Fixed & Enhanced
- **CRM Books Page Reader PDF Formatting & Paragraph Reflow**:
  - Implemented heuristic paragraph break inference (`inferParagraphBreaks`, `looksLikeParagraphEnd`) for PDF text extraction without losing natural line and paragraph structure.
  - Added support for inline and multi-level numbered lists (`splitInlineNumberedListLine`, `pageListItemStart`) and heading detection in reader page formatting.
  - Refined quote and citation text highlighting across rendered paragraphs.
- **CRM Books Mind Map Custom Connections**:
  - Added interactive anchor-point dragging to draw custom bezier links between mind map nodes.
  - Added custom connection context menu for editing and deleting links with bidirectional synchronization.
- **Pronunciation Analyzer Cloud AI Feedback**:
  - Integrated Vertex AI Gemini 3 Flash proxy route for pronunciation summary and teacher advice generation.

## [V1.8.67] - 2026-08-14

### Added & Enhanced
- **CRM Books Mind Map UI Redesign & Source Notes**:
  - Refined bezier connector line curvatures, opacity, and stroke widths for cleaner visual clarity.
  - Upgraded source notes in Inspector drawer with expandable inline preview/full-text toggles (`📖 Title ▸`), robust note ID resolution (supporting raw, firestore, and prefixed IDs), and informative empty state indicators.
  - Enhanced Dark Mode palette with modern glassmorphism (`--mm-glass`, `--mm-accent-soft`), subtle border contrasts, and unified surface depths.
- **Write Essay Mode Local AI Result Polling**:
  - Added real-time polling on `essay_ai_queue` documents when queuing local AI scoring.
  - Automatically updates the UI status, renders the complete score breakdown in the results card, posts teacher advice directly to chat, and refreshes the previous attempts history list.
- **PTE Attempt Archive & History UI**:
  - Added secondary "🕒 Previous Attempts" action toggle to Essay results view.
- **Notification Center Reliability**:
  - Added unindexed Firestore query fallback for user notifications when composite indexes are pending or unavailable.

## [V1.8.66] - 2026-08-13

### Fixed
- **CRM Books Study Module Modal Visibility**: Fixed malformed CSS comment syntax right above `.crm-books-modal-overlay` in `public/crm-admin.css` that caused the browser to invalidate `.crm-books-modal-overlay` rules, falling back to `position: static` (rendering 952px below the screen). Restored `position: fixed; inset: 0; z-index: 10000;` fullscreen modal overlay placement.

## [V1.8.65] - 2026-08-13

### Added & Enhanced
- **CRM Books Mind Map Optimization & Enhancements**:
  - **Outline View (Phase 6)**: Added a toggleable outline side panel with a collapsible hierarchy tree, node highlight/zoom-to-node navigation, and bidirectional synchronization with canvas edits.
  - **Minimap Navigator (Phase 4)**: Integrated a bottom-left minimap navigator with real-time node rendering, draggable viewport frame, and smooth 400ms ease-out `zoomToNode` animations.
  - **Touch & Mobile Support (Phase 4)**: Implemented single-finger canvas panning, pinch-to-zoom (0.3x-2.5x), single-finger node dragging with threshold dead-zone, and tap-to-inspect gestures.
  - **Multi-Map Management (Phase 7)**: Implemented multiple mind map creation and switching per book via map selector header dropdown with localStorage persistence.

### Fixed
- **CRM Books Mind Map Runtime & UI Fixes**:
  - Resolved `window.loadBookNotes` scope crash by converting to closure-scoped synchronous calls.
  - Corrected `extractNoteTitle` object return handling (`{ title, body }`).
  - Fixed `updateSaveStatus` signature for custom status messages.
  - Replaced non-existent `saveMindMap` call with `saveMindMapEdits`.
  - Fixed modal dark mode inheritance by applying self-selector `.crm-books-mindmap-modal.books-dark` and syncing class state on modal open.

## [V1.8.63] - 2026-08-12

### Added & Enhanced
- **CRM Books Mind Map UI**: Enhanced radial graph node placement (480px category radius, 350px subtopic radius), implemented dynamic content bounding box auto-fitting for zoom & pan initialization, and synchronized SVG bezier curve connector transforms.

## [V1.8.62] - 2026-08-12


### Fixed
- **CRM Books Mind Map Modal Scoping**: Fixed element lookup scope in `books-workspace.js` by using `document.querySelector` (`docQs`) for document-body level `#crm-books-mindmap-modal` elements so clicking "🧠 Create Mind Map" reliably launches the fullscreen mind map modal.

## [V1.8.61] - 2026-08-11


### Added & Enhanced
- **CRM Books Mind Map**: Added an interactive "Create Mind Map" feature to the CRM Books Notes section. Synthesizes saved user notes into a coherent concept hierarchy using AI (Gemini), rendered inside a glassmorphic fullscreen SVG modal with zoom, pan, expand/collapse, and full note inspector drawer.

## [V1.8.60] - 2026-08-11


### Added & Enhanced
- **RFIB Practice Mode**: Added explicit missing answer indicators when blanks are unchosen, enhanced answer visibility styling and feedback card rendering, and locked RFIB audio behind the Check button with a blurred overlay until submitted.
- **MCMA & MCSA Explanation Cards**: Redesigned explanation panels into floating, resizable cards with font size controls matching the DD/RFIB design system.
- **SWT Practice Layout**: Converted Summarize Written Text layout from side-by-side split view to an ergonomic stacked layout with the source text on top and response composition area below.
- **CRM Books Study Module**: Resolved 5 audit items (chunk fallback, list rendering, action button state, regeneration flow, Firestore persistence) and added chapter summary mode alongside whole-book outlines.
- **Pronunciation Analyzer Cloud Debug**: Added Cloud debug save feature to production for rapid troubleshooting and improved V3 CTC syllable boundary vowel alignment.

### Fixed
- **Practice Mode URL Routing**: Synchronized `?question=N` query parameters across all practice modes (ASQ, RS, DI, DD, RFIB, SWT, Essay, etc.) with pushState and popState navigation.
- **Repeat Sentence Step Indicator**: Fixed 3-step indicator status reset when navigating to Next/Prev questions.

## [V1.8.59] - 2026-08-10

### Added & Enhanced
- **Speech Coach Recorded-Word Playback**: Returned precise Azure word timestamps from Firebase and aligned connected-speech events with Azure insertions and merged tokens so recognized words and recorded segments stay synchronized.
- **Local Read Aloud Stack**: The Windows emulator launcher now starts the local Praat backend alongside Firebase and the HTTPS app server.

### Changed
- **CRM Enquiry Intake**: Removed the unused Templates and Automations panels, moved Source below Zalo, made it an explicit required choice, and added `Zalo + Personal` handling across the active controller and browser contracts.
- **Read Aloud Navigation Bar**: Uses an opaque white sticky background so practice content does not show through the header.

### Fixed
- **Speech Coach Result Filters**: Re-renders saved result feedback immediately when connected-speech modes are toggled after scoring.
- **Entrance Test History Links**: Retains the delivery token after public submission so authenticated CRM history can reconstruct the original single-use link while submitted links remain blocked from reuse.
- **Production Timing Parity**: Preserves fractional Azure milliseconds and explicit null timing values in the deployed Firebase route instead of rounding or omitting them.

## [V1.8.55] - 2026-08-08

### Fixed
- **Pronunciation Cross-Gap Octave Tracking**: Normalized the speaker pitch baseline across octave-equivalent clusters so a tracker that resumes one octave high after an unvoiced gap is corrected without drawing through the silence.

## [V1.8.54] - 2026-08-08

### Fixed
- **Pronunciation Prosody Smoothing**: Applied octave-aware contour cleanup to the native-only lookup chart as well as learner comparisons, preserved raw-Hz diagnostics, and stopped pitch/intensity lines from bridging unvoiced gaps.

## [V1.8.53] - 2026-08-08

### Added & Enhanced
- **Pronunciation Prosody Review**: Smoothed relative-pitch contours within contiguous voiced runs to suppress octave spikes and frame noise while preserving raw-Hz tooltips, short contours, and unvoiced gaps.
- **Pronunciation Comparison UI**: Replaced the admin review rail with selectable V2/V3 columns and a sticky bottom judgment bar.
- **Heteronym Learner IPA**: Selects the learner-facing IPA alternative whose primary-stress position matches the active reference variant.
- **CRM Books Reader**: Added whole-book and chapter summary views, page shortcuts, source download links, structured extracted-text formatting, readable-page navigation, animated page turns with reduced-motion handling, persistent text sizing, complete saved notes, and legacy citation-fragment recovery.

### Fixed
- **CRM Books Usage Tracking**: Reads Gemini token usage from both the Vertex response envelope and the legacy direct metadata shape.
- **Release Verification**: Added API, unit, browser, accessibility, and cold Playwright-load regression coverage for the V1.8.53 bundle.

## [V1.8.52] - 2026-08-07

### Fixed & Enhanced
- **Corpus Filter Auto-Selection Sync**: Added `syncActiveWordWithFilter()` to automatically align the target word, category, and instruction banner with the first word in the filtered list whenever the **Show tests:** dropdown or search input changes.

## [V1.8.51] - 2026-08-07

### Fixed & Enhanced
- **CRM Pronunciation Verification V2 Adapter**: Fixed `PraatAPI.ensureVerification()` to properly map V2 response fields (`observed.syllableCount`, `quality.rateable`) into the `verification` contract object, resolving false "Unrateable Audio" status banners.
- **Corpus Filter Version Locking**: Fixed `bindWordButtons()` in `crm-admin.js` to preserve the active filter category when selecting a word in the sidebar list instead of resetting to Version 1 (Clean).

## [V1.8.50] - 2026-08-06

### Fixed & Enhanced
- **CRM Books Service & Contract Unit Tests**: Added `crmBookUsage` mock collection handling to `tests/crm/book-chat-service.test.js` to ensure 100% test contract compliance with cost tracking budget checks.

## [V1.8.49] - 2026-08-06

### Added & Enhanced
- **CRM Books Note Saving**: Updated chat Save button handler to automatically locate and prepend the corresponding user question (`Q: [question]\n\nA: [answer]`) when saving notes, and enhanced note card styling with `white-space: pre-wrap` for clean Q&A formatting.

## [V1.8.48] - 2026-08-06

### Fixed
- **CRM Books Pages Tab**: Fixed response unwrapping bug in `loadPagesMetadata()` (`pagesData = res?.data || res`), resolving issue where page text and total pages indicator were blank on the Pages tab.

## [V1.8.47] - 2026-08-06

### Added & Enhanced
- **CRM Books UI Overhaul & AI Cost Tracking**:
  - NotebookLM-inspired UI overhaul with Lora serif typography for comfortable long-form reading, dark mode design tokens, dynamic reader panels, and integrated page viewer.
  - Backend cost tracking instrumentation in `book-usage-tracker.js` ($10/month configurable budget limit, token estimation for embeddings, token usage tracking across chat, summary, and embedding stages).
  - Admin approval flow (`POST /api/admin/books/usage/approve`) to reset/approve overage when monthly AI budget is exceeded.
  - Budget guard (`checkBudget`) in `book-chat-service.js` blocking chat with `resource-exhausted` error when budget is exceeded until admin approval.
  - Route ordering optimization in `functions/src/routes/admin/books.js` putting usage endpoints before `:bookId` wildcard.

## [V1.8.46] - 2026-08-06

### Added
- **CRM Books Feature (Phases 1-5 + Code Review Fixes)**:
  - NotebookLM-style PDF library upload with unpdf text extraction.
  - Overlapping character chunking (1500-char window, 200-char overlap).
  - Vertex AI `text-embedding-004` vector embedding pipeline with L2 vector normalization.
  - Map-Reduce book summarization service utilizing `gemini-2.0-flash`.
  - Grounded Q&A chat with citations (`[1]`, `[2]`), daily quota enforcement (100 msgs/day), and multi-thread conversation support.
  - Code review fixes: attribute XSS escaping, race condition guards on book selection, input send detached DOM element fix, page-0 null safety, upload debouncing, and CSS flex truncation.

### Fixed & Enhanced
- **PTE Practice UI Repairs & Design System Parity**:
  - Read Aloud practice UI repairs: nav order toggle, live stepper across speaking modes, composable guide modes, settings sheet cleanup.
  - Restored Speech Coach results linking overlay (regressed in V1.8.28 family gate).
  - Six practice UI repairs: RFIB easy-reading after check, D&D hint popover explanations, D&D random toggle, speaking random toggle, stepper reaching results on failed scoring, composable guide-layer styling.
  - Applied Reading modes UI/UX design system and v7 navigation parity to Writing modes (SWT + Write Essay).

## [V1.8.45] - 2026-07-31

### Changed
- **Syllabic consonants in Oxford IPA**: word-final `/ən/` and `/əl/` now render as the syllabic `/n/` and `/l/` Oxford uses — `button` `/ˈbʌtn/`, `listen` `/ˈlɪsn/`, `little` `/ˈlɪtl/`, `table` `/ˈteɪbl/`, `occupation` `/ˌɑːkjuˈpeɪʃn/` (~8,280 corpus entries). The rule is context-gated: it fires only after coronal obstruents and `/f v/` for `/n/`, and after obstruents and nasals (never `/r/` or a glide) for `/l/`, so `open` `/ˈoʊpən/`, `bacon` `/ˈbeɪkən/`, and `barrel` `/ˈbærəl/` keep their schwa. A monosyllable's schwa is its nucleus and is never swallowed (`cull` stays `/kʌl/`). Applied last in `Phonetics.normalizeIPA()`, after stress placement. Deliberately word-final only; medial clusters like `student` `/ˈstuːdənt/` are left for a later pass.

### Fixed
- **Emulator launcher on Windows**: `scripts/emulators-start.js` used `spawn('npx.cmd', …)` without a shell, which Node ≥18.20 rejects with `spawn EINVAL` (CVE-2024-27980 hardening). Now spawns with a shell on Windows and quotes space-bearing args, so `npm run emulators` — and the browser suites that depend on it — start again.
- **Stale Read Aloud browser check**: `tests/browser/read-aloud-check.js` waited for the prompt-guides group in the default Basic view, but the Speaking Practice Controller now gates it behind Advanced. The check switches to Advanced before asserting.

## [V1.8.44] - 2026-07-31

### Changed
- **True Oxford American IPA notation**: learner-facing IPA now matches the American entries published by Oxford Learner's Dictionaries. Long vowels carry the length mark (`/ˈwɔːtər/`, `/kəmˈpjuːtər/`, `/ˈliːtər/`), DRESS is `/e/` instead of `/ɛ/`, and a stressed r-coloured vowel renders as NURSE `/ɜːr/` (`/nɜːrs/`, `/wɜːrk/`) while an unstressed one stays `/ər/`. Oxford's weak `/i/` and `/u/` are preserved (`/ˈhæpi/`, `/ˌɑːkjuˈpeɪʃən/`). Applied in `Phonetics.normalizeIPA()` (`public/phonetics.js`), the single point where notation is decided — the corpus files are unchanged.

### Fixed
- **Quarantine bypass**: `deneuve` had been removed from `ipa-dict.json` without being quarantined, so the CMU fallback repopulated it as `/dɪˈnʌv/`. Added to the quarantine list, with a regression test covering every reviewed removal (`tests/oxford-american-ipa-data.test.mjs`).
- **hurry/furry class**: a stressed schwa before `/r/` is NURSE, not STRUT, so the `/ʌ/` repair no longer claims it. `curry` `/ˈkʌri/` → `/ˈkɜːri/`, `burroughs` `/ˈbʌroʊz/` → `/ˈbɜːroʊz/`, consistent with `hurry` and `hurricane`.
- **Reduced forms shown as citation forms**: the CMU-backed citation preference applies to all corpus entries instead of contractions only. `going` `/ˈɡoʊɪn/` → `/ˈɡoʊɪŋ/`, `next` `/nɛks/` → `/nekst/`, `mostly` `/ˈmoʊsli/` → `/ˈmoʊstli/`, `fifths` `/fɪfs/` → `/fɪfθs/`, `sandwich`, `restaurant`, `because`.
- **API disagreement**: `getIPA()` and `getPronunciations()` returned different IPA for `her` (`/hər/` vs `/hɝ/`) and `was` (`/wɑz/` vs `/wʌz/`). A function word looked up on its own now returns its citation form from both.
- **Form profiles bypassed normalization**: `FUNCTION_WORD_FORMS` and the overlay's `formProfiles` are rendered through the shared transform, closing the last surface that could emit pre-Oxford notation.
- **Offline CMU fallback**: `cmudict.json` was missing from the service-worker shell cache, so offline lookups outside `ipa-dict` returned nothing. Added; cache version bumped to `bel-offline-v20`.
- **CRM corpus recording target**: `public/crm-admin.js` called `normalizeIPA()` without the word, so the schwa repair could not fire and admins recorded against `/əˈbəv/` while learners saw `/əˈbʌv/`. Now renders the learner-facing transcription.
- **Read Aloud linking**: the vowel-initial test did not recognise `/ɜ/`, which would misclassify `earth` and `early`; fixed in both the client and Cloud Functions copies, along with their duplicated strong-form table.
- **Malformed corpus entry**: `anticorruption` carried two stress marks with the `/r/` in the wrong syllable (`/ˌæntiˌkərˈʌpʃən/` → `/ˌæntikəˈrʌpʃn/`).

## [V1.8.43] - 2026-07-30

### Added & Standardized
- **Tiktok - Personal Source & Label Standardization**:
  - Added `Tiktok - Personal` option to the `Source` acquisition dropdown (`#lead-source`).
  - Standardized field label from `FB Personal Account` to `Personal Social Media Account`.
  - Updated visibility behavior (`updateLeadSourceVisibility()` & `updateStudentSourceVisibility()`) to display `Personal Social Media Account` for both `Facebook - Personal` and `Tiktok - Personal` sources.
  - Updated automated test suites (`crm-lead-source-browser-check.js`, `crm-student-source-browser-check.js`, `crm-enquiry-check.js`, `crm-admin-workflow-browser-check.js`).

## [V1.8.42] - 2026-07-28

### Added & Enhanced
- **Agent Source & Conditional Agent Selection**:
  - Added `Agent` choice to the `Source` dropdown (`#lead-source`).
  - Added dynamic visibility for the **Agent Source** dropdown (`#lead-agent-source-group`), showing it only when `Agent` source is selected.
  - Added **Mr** / **Ms** title tick selector next to **Full Name** field with full form binding and payload persistence.
- **Phonetics & Oxford IPA Normalization**:
  - Applied universal stressed-schwa to caret vowel (`/ʌ/`) normalization rule covering 6,500+ words including 113 core Oxford 5000 words.
  - Generated Read Aloud /i:/, /ɪ/, and happy-vowel /i/ word frequency analysis and reference guide (`docs/read_aloud_top_20_i_vowels.md`).
- **UI Design System & Accessibility Refinements**:
  - Remediated UI slop anti-patterns and WCAG contrast rules across practice modes and CRM administration pages.

## [V1.8.40] - 2026-07-27

### Added & Verified
- **Student Management FB Link & Personal Owner Dropdown**:
  - Added **Student's FB link** (`#student-facebook-profile-url`) and **FB Personal Account** (`#student-facebook-personal-owner` with options `Nam`, `Thành`, `Quỳnh`) to the Student Profile Modal (`#crm-student-modal`) under the Info tab.
  - Implemented dynamic visibility behavior (`updateStudentSourceVisibility()`): `Facebook - Personal` shows both fields, `Facebook - Page` shows FB link, `Zalo - Page` hides both fields.
  - Updated frontend payload builder (`public/js/crm/students.js`) and backend normalization (`functions/src/crm/student-service.js`) to persist both fields.
  - Added automated browser test `crm-student-source-browser-check.js` (PASSED).

## [V1.8.39] - 2026-07-27

### Added & Standardized
- **CRM Lead Source & Student Acquisition Source Standardization**:
  - Converted Lead Creation `Source` (`#lead-source`) from plain text input to a standardized dropdown (`Facebook - Personal`, `Facebook - Page`, `Zalo - Page`).
  - Added dynamic **Student's FB link** (`#lead-facebook-profile-url`) field visible for Facebook sources (`Facebook - Personal` & `Facebook - Page`).
  - Added dynamic **FB Personal Account** (`#lead-facebook-personal-owner`) dropdown with options `Nam`, `Thành`, `Quỳnh` visible specifically for `Facebook - Personal` source.
  - Standardized Student Profile Modal `Acquisition Source` (`#student-acquisition-source`) to match the same 3 source choices.
  - Updated backend lead normalization (`functions/src/crm/lead-service.js`) and lead builder (`public/js/crm/leads.js`) to persist `facebookPersonalOwner` in Firestore lead records.
  - Updated and passed all 3 automated browser test suites (`crm-lead-source-browser-check.js`, `crm-enquiry-check.js`, `crm-admin-workflow-browser-check.js`).

## [V1.8.38] - 2026-07-27

### Changed & Normalized
- **Oxford/Cambridge Standard IPA Normalization**:
  - Normalized all IPA transcriptions and stress mark placement rules across the application and phonetics pipeline (`public/phonetics.js` and `public/arpabet-ipa-map.js`).
  - Standardized rhotic vowels (`ɝ`, `ɚ`) to explicit schwa + r (`ər`) and turned-r (`ɹ`) to (`r`), producing standard Oxford/Cambridge transcriptions like `/'ækjərətli/` for *accurately*, `/ˈwɔtər/` for *water*, and `/kəmˈpjutər/` for *computer*.
  - Standardized stress mark placement to evaluate preceding onset consonant clusters (e.g. `/əˈkjuz/` for *accuse*).
  - Updated CRM Admin attempt metadata panel (`public/crm-admin.js`) to format target IPA via `Phonetics.normalizeIPA()`.
  - Updated test suites (`test-ipa-dict-integration.js` and `tests/browser/ipa-dict-dataset-browser-check.js`) with 100% pass rate.

## [V1.8.34] - 2026-07-26

### Added & Verified
- **Multi-Model Essay Analysis & CRM Admin Infrastructure**:
  - Implemented asynchronous local AI queue architecture for learner essay scoring (`submitEssayDeepAi` callable contract).
  - Integrated CRM Admin Dashboard Essay AI scoring card (`#btn-essay-ai-preview`, `#btn-essay-ai-trigger`, `#essay-ai-admin-status`).
  - Implemented preview lifecycle and manual batch trigger pipeline for unscored PTE Write Essay attempts.
  - Executed full Playwright E2E browser testing suite against local HTTPS server and emulators with zero console errors.
- **3-Model RFIB Explanation Revision Pipeline**:
  - Implemented multi-model LLM revision pipeline and test suite for cohesive RFIB student explanations.
- **CRM Admin UI Fixes & Polish**:
  - Fixed Next Word navigation button disabling, search filter matching, and index lookup edge cases.
  - Resolved duplicate corpus badge accumulation and layout spilling in CRM Admin.

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
