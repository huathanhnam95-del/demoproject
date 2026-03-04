# Watch Mode Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Watch Mode provides video-based comprehension practice: users watch a clip and answer questions that are time-aligned with the content.

## 2. Goals (The "Why")

- Train real-world listening with authentic pacing.
- Make comprehension verifiable (evidence-based scoring).

## 3. Requirements (The "What")

### Functional

- Embed/play video content (YouTube).
- Present questions tied to timestamps/segments.
- Score answers server-side and award calibrated rewards.
- Provide admin tooling for curating watch content and questions.

### Non-Functional

- The mode must be usable on typical networks; handle transcript/metadata failures gracefully.
- If YouTube API/video loading fails (offline, blocked domain, timeout), the UI must show a recoverable error state with `Retry` and a clear return path to other modes.
- Watch-mode failures must not break global app navigation, panel toggles, or the current user session.

## 4. Data & Contracts (The "Contract")

- Watch mode UI: `public/watch-mode.js`, `public/youtube-player.js`
- YouTube dependency: `public/youtube-player.js` loads `https://www.youtube.com/iframe_api` at runtime.
- Fallback contract: player init/load errors are surfaced as non-blocking mode errors; app shell remains interactive.
- Content items: Firestore `contentItems/{watch_<id>}` (and related watch collections as needed).
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'watch'`).
- Admin pages:
  - `public/watch-admin.html`
  - `public/watch-admin.js`

## 5. Verification

- Manual:
  - Load a watch item -> verify video plays and questions render.
  - Submit an answer -> verify scoring and rewards.
  - Simulate unavailable YouTube/offline -> open Watch Mode -> verify recoverable error state and successful exit to another mode without reload.
  - Restore network and retry -> verify player can recover.
