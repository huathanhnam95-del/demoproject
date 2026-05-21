# Declutter Nested UI Boxes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Clean up the practice mode UIs by removing nested card borders, background fills, and shadows, allowing the elements to flow naturally within the parent container.

**Architecture:** Refactor CSS rules in `public/dd-mode.css`, `public/rop-mode.css`, and `public/rmcma-mode.css` to remove background, border, shadow, and backdrop-filter styling from inner layout cards while preserving chips, list items, and alert/summary banners.

**Tech Stack:** Vanilla CSS

---

## User Review Required

> [!NOTE]
> Result/score summary boxes (e.g., `.dd-result-summary-box`, `.rop-result-box`, `.rmcma-result-box`) will remain styled as callout banners to ensure they clearly denote success/error states, but their heavy shadows will be removed to maintain a flat aesthetic.

## Open Questions

None. The design requirements are clear: strip nested box borders/backgrounds and keep elements clean.

## Proposed Changes

### Styling Improvements

#### [MODIFY] [dd-mode.css](file:///c:/Cursor%20AI/public/dd-mode.css)

- Hide the `#mode-dd::before` border.
- Split `.dd-result-summary-box` out from the layout card group selector (`.dd-header-card, .dd-passage-card, .dd-word-bank-card, .dd-results-container`).
- Set `border: none; background: transparent; box-shadow: none; backdrop-filter: none;` on `.dd-header-card`, `.dd-passage-card`, `.dd-word-bank-card`, and `.dd-results-container`.
- Set horizontal padding to `0` on `.dd-header-card`, `.dd-passage-card`, `.dd-word-bank-card`, and `.dd-results-container` to align them nicely.
- Style `.dd-result-summary-box` as a standalone banner.

#### [MODIFY] [rop-mode.css](file:///c:/Cursor%20AI/public/rop-mode.css)

- Hide the `#mode-rop::before` border.
- Set `border: none; background: transparent; box-shadow: none; backdrop-filter: none;` on `.rop-workspace-card` and `.rop-explanation-card`.
- Set horizontal padding to `0` on `.rop-workspace-card` and `.rop-explanation-card`.
- Remove `box-shadow` from `.rop-result-box` and `.rop-critique-card`.

#### [MODIFY] [rmcma-mode.css](file:///c:/Cursor%20AI/public/rmcma-mode.css)

- Hide the `#mode-rmcma::before` border.
- Split `.rmcma-result-box` out from the layout card group selector (`.rmcma-passage-card, .rmcma-question-card, .rmcma-explanation-card`).
- Set `border: none; background: transparent; box-shadow: none; backdrop-filter: none;` on `.rmcma-passage-card`, `.rmcma-question-card`, and `.rmcma-explanation-card`.
- Set horizontal padding to `0` on `.rmcma-passage-card`, `.rmcma-question-card`, and `.rmcma-explanation-card`.
- Style `.rmcma-result-box` as a standalone banner.

---

## Verification Plan

### Automated Tests

Verify that visual elements are still rendered, functional, and layout structure matches the DOM expectations by running the following E2E Playwright tests:
- `node tests/browser/dd-mode-browser-check.js`
- `node tests/browser/rop-mode-browser-check.js`
- `node tests/browser/rmcma-mode-browser-check.js`
- `node tests/browser/practice-modes-browser-check.js`

Expected results: Tests pass, showing that the refactored elements remain correctly positioned and interactable.
