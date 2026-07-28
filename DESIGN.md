# Design System & Token Specification

This document defines the authoritative design tokens for the PTE & English Practice Web Application.

## 1. Color Palette

### Base Surfaces
- `bg-dark`: `#0f172a` (Slate 900)
- `surface-dark`: `#1e293b` (Slate 800)
- `surface-card-dark`: `#334155` (Slate 700)
- `bg-light`: `#f8fafc` (Slate 50)
- `surface-light`: `#ffffff` (White)

### Primary Accents & Brand
- `accent-primary`: `#1a73e8` (Google Blue / Brand Primary)
- `accent-hover`: `#1557b0` (Darker Primary)
- `accent-subtle`: `#e8f0fe` (Light Blue Tint)
- `accent-blue-vivid`: `#2563eb` (Blue 600)

### State & Feedback Colors (WCAG AA Compliant $\ge 4.5:1$)
- `state-success`: `#059669` (Emerald 600 - text/icon) / `#d1fae5` (Emerald 100 - bg)
- `state-error`: `#dc2626` (Red 600 - text/icon) / `#fee2e2` (Red 100 - bg)
- `state-warning`: `#b45309` (Amber 700 - text/icon) / `#fef3c7` (Amber 100 - bg)
- `state-info`: `#1d4ed8` (Blue 700 - text/icon) / `#dbeafe` (Blue 100 - bg)

## 2. Typography

### Font Family
- **Primary Body & Headings**: `Outfit`, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- **Monospace / IPA / Audio Code**: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, monospace

### Type Scale (1.25 Modular Scale)
- `text-xs`: 12px / line-height 16px
- `text-sm`: 14px / line-height 20px
- `text-base`: 16px / line-height 24px
- `text-lg`: 20px / line-height 28px
- `text-xl`: 24px / line-height 32px
- `text-2xl`: 32px / line-height 40px

## 3. Shape & Corner Radii

- `radius-sm`: 6px (Small inputs, inline buttons, action controls)
- `radius-md`: 12px (Practice cards, modal dialogs, section panels)
- `radius-full`: 9999px (Pill tags, active badges, status indicators)

## 4. Spacing & Inset Padding

- `space-xs`: 4px
- `space-sm`: 8px
- `space-md`: 16px
- `space-lg`: 24px
- `space-xl`: 32px

**Inset Rule**: Containers with visible borders or non-transparent backgrounds MUST have at least 12px (`space-md`) internal inset padding. Children must never land flush against container boundaries.

## 5. Prohibited Anti-Patterns ("AI Slop")

1. **Side-Tab Accent Borders**: NO `border-left: 4px/6px solid [color]` on rounded cards. Use subtle full border tinting or pill badges instead.
2. **Hairline Border + Diffuse Blur Shadow**: NO combining 1px border with >20px shadow blur. Commit to clean edges OR neutral soft elevation.
3. **Low Contrast Text**: ALL text combinations must satisfy WCAG AA contrast ratio ($\ge 4.5:1$ for normal body text, $\ge 3.0:1$ for large headings/badges).
4. **Broken Image Tags**: No empty `src=""` on `<img>` tags.
