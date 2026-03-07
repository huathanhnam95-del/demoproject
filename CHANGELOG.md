# Changelog

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
