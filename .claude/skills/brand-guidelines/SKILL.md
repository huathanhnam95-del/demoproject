---
name: brand-guidelines
description: Applies the BEL web app official brand colors, typography, and design system. Use it when designing the BEL web app, implementing CSS, creating React components, or applying visual formatting to the BEL project.
---

# BEL Web App Brand Styling

## Overview

To access BEL's official brand identity and style resources for web application development, use this skill.

**Keywords**: branding, corporate identity, visual identity, UI/UX, styling, brand colors, typography, BEL brand, visual formatting, visual design, web design, CSS, frontend

## Brand Guidelines

### Colors

**Main Colors:**

- Dark (Background/Text): `#121826` - Primary text and dark backgrounds
- Light (Background): `#F8FAFC` - Light backgrounds and text on dark
- Mid Gray (Secondary): `#94A3B8` - Secondary elements, borders
- Light Gray (Surface): `#F1F5F9` - Subtle backgrounds, cards

**Accent Colors:**

- Primary (Brand): `#3B82F6` - Primary interactions, buttons, active states, links
- Secondary: `#8B5CF6` - Highlights, special features
- Success Green: `#10B981` - Success states, confirmations
- Warning/Destructive: `#EF4444` - Errors, destructive actions

### Typography

- **Headings**: `Inter`, `SF Pro Display` (with sans-serif fallback)
- **Body Text**: `Inter`, `SF Pro Text` (with sans-serif fallback)
- **Code/Monospace**: `JetBrains Mono`, `Fira Code` (with monospace fallback)

## Application in Web Dev

### CSS/Tailwind Tokens

When setting up the frontend framework (Vanilla CSS or Tailwind):

- Map the primary colors to CSS variables `--color-primary`, `--color-background`, etc.
- Always use the defined accent colors for call-to-actions.
- Maintain a minimum contrast ratio of 4.5:1 for normal text.

### Visual Effects

- Use subtle drop shadows for floating elements or surfaces to create depth (`box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1)`).
- Use smooth transitions (`transition: all 0.2s ease-in-out`) for interactive elements like hovers.
- Combine glassmorphism (semi-transparent backgrounds with backdrop blur) sparingly for modern overlays or sticky headers.

### Layout and Spacing

- Utilize an 8-point baseline grid system (`8px`, `16px`, `24px`, `32px`, `48px`, `64px`).
- Use `8px` (`0.5rem`) default border radius for buttons and cards (`12px` or `16px` for larger containers) to ensure premium feel.
