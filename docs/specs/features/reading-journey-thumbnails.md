# Reading Journey Thumbnails Spec

## Overview
Initial scope is **one thumbnail per story library card**, not per branch path.

## Thumbnail Selection Policy
- Target the highest-salience moment that represents the core of the story.
- Respect spoiler conditions: library safety vs detail page safety.

## JSON Contracts
Defined in `src/services/reading-journey/thumbnail-contracts.js`:
- `ThumbnailSceneSummary`
- `ThumbnailPromptSpec`
- `ThumbnailAuditSpec`
- `ThumbnailGenerationRecord`

## Environment Variables
- `READING_JOURNEY_THUMBNAILS_ENABLED`
- `READING_JOURNEY_THUMBNAIL_MODEL`
- `READING_JOURNEY_THUMBNAIL_AUDIT_MODEL`
- `READING_JOURNEY_THUMBNAIL_MAX_ATTEMPTS`
- `READING_JOURNEY_THUMBNAIL_OUTPUT_ROOT`

## Route Surface
- `POST /api/reading-journey/thumbnails/generate`
- `POST /api/reading-journey/thumbnails/regenerate`
- `GET /api/reading-journey/thumbnails/:storyId`

## Audit Pass/Fail Policy
- Universal Criteria ensure safety, legibility, and lack of text artifacts.
- Story Criteria check specific character and setting alignment to the summary.
- The generation succeeds if there are no blocking failures; failures trigger the multimodal repair loop.
