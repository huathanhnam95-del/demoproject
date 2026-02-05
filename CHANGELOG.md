# Changelog

## [V1.0.0] - 2026-02-06

### Added

- **Automated Deployment**: Replaced GitHub Pages workflow with Firebase Hosting automated deployment via GitHub Actions.
- **Service Account**: Integrated Firebase Service Account for secure CI/CD operations.
- **Version Indicator**: Added visual "V1.0.0" label to the bottom right corner of the application.
- **Documentation**: Updated `GEMINI.md` with strict Semantic Versioning and Changelog rules.

### Fixed

- **Type Mode "Check" Button**: Resolved `ReferenceError: totalWords is not defined` by calculating word count dynamically from the correct answer.
- **Vocab Book Access**: Added missing event listener to the "View full list" button in the Vocabulary Book side panel.
- **SRS Performance**: Optimized `DictionaryService` to reduce lag during review session initiation and added timeouts for external API calls.
- **Wiktionary API**: Disabled unreliable `vi.wiktionary.org` REST endpoint and improved filtering of "obscure" definitions (e.g., ISO codes) to prevent irrelevant prompts.
- **Missing Prompts**: Implemented robust fallback logic to ensure SRS prompts always display, even when API calls fail or return empty results.

### Changed

- **Config**: Removed legacy GitHub Pages configuration artifacts (e.g., database stripping).
