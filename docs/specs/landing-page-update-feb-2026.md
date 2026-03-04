# User Story: Update Landing Page Content & Visuals

**Context**: The application has evolved significantly (new roadmap, enhanced features), but the landing page (`public/landing/index.html`) still references older visuals and potentially outdated text descriptions.

## Goals

1. **Visual Consistency**: Ensure screenshots on the landing page reflect the current state of the application.
2. **Content Accuracy**: Verify all feature descriptions match actual functionality.
3. **Code Hygiene**: Update misleading code comments (e.g., "Vertical Timeline" vs SVG Roadmap).

## Scope

- **Files**: `public/landing/index.html`, `public/landing/assets/*`
- **Features to Verify**:
  - Dashboard (New roadmap integration?)
  - Pronunciation Feedback (Current UI)
  - SRS Review (Current UI)
  - Dictation/Typing Mode (Current UI)

## "Taste" Invariants

- **Screenshots**: Must be high-quality, clean (no debug overlays), and representative of a "new user" experience or a "power user" flow depending on context.
- **Text**: Keep it concise and benefit-driven. "BEL" branding is confirmed (no "CircleAI").
