# Plan: Landing Page Updates (Feb 2026)

**Goal**: Align landing page with current application state.

## 1. Content Updates (HTML)

- **File**: `public/landing/index.html`
- **Actions**:
  - Update `<!-- Vertical Timeline -->` comment to `<!-- Interactive Roadmap -->`.
  - Verify feature descriptions align with current functionality.

## 2. Visual Updates (Assets)

- **Goal**: Replace potential outdated screenshots in `public/landing/assets/`.
- **Actions**:
  - Capture `screen-dashboard.png`: Screenshot of `public/index.html` (main view with new Roadmap).
  - Capture `screen-pronounce.png`: Screenshot of Pronunciation Feedback UI.
  - Capture `screen-srs.png`: Screenshot of SRS Review UI.
  - Capture `screen-type.png`: Screenshot of Typing/Dictation UI.
  - Use `browser_subagent` to capture these and save directly to `public/landing/assets/`.

## 3. Verification

- **Action**: Browse `public/landing/index.html` locally.
- **Check**:
  - Do screenshots look crisp and current?
  - Is text branding consistent ("BEL")?
  - Are there broken links? (e.g., `../index.html?demo=1`)
