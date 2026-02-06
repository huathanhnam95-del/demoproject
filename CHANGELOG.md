# Changelog

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
