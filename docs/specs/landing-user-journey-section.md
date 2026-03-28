# Landing Page: "Your Journey" Section — Spec

**Status**: Draft
**Owner**: Admin
**Last updated**: 2026-02-18

## 1. Overview

Add a "Your Journey" section to the landing page (`public/landing/index.html`) that visually communicates the new-user workflow as a sleek, modernized roadmap. The goal is to give prospective users a clear, exciting vision of what to expect.

## 2. Goals

- Show the 3-phase user journey (Day 0 → Days 1-3 → Week 1+) in a visually compelling way.
- Match the existing landing page aesthetic (Outfit font, blue/purple gradient, card-based, subtle dark backgrounds, smooth animations).
- Be scannable in under 10 seconds.

## 3. Design Pattern

**3-column phase layout** with a connecting progress line, each phase containing a numbered badge, phase title, timeframe label, and 3-4 bullet milestones.

- Phase 1 — Day 0: "Build Your Pipeline" (choose level → first practice → vocab auto-unlocks → first SRS)
- Phase 2 — Days 1–3: "Lock In the Loop" (daily practice → save words → SRS review → roadmap unlocks)
- Phase 3 — Week 1+: "Expand Your Stack" (add Speak, Fill, Watch, Survival modes)

## 4. Placement

Insert between the existing `#how-it-works` section and the `#features` section.

## 5. Micro-animations

- Phase cards animate in with a staggered fade-up on scroll (IntersectionObserver).
- The connecting line between phases draws in left-to-right on scroll entry.
- Milestone bullets appear with a subtle check-mark pop animation.
- Phase card hover: slight lift + border glow.

## 6. Acceptance Criteria

- [ ] Section renders correctly on desktop (3 columns) and mobile (stacked).
- [ ] Matches existing landing page color tokens and typography.
- [ ] No console errors.
- [ ] Nav link "Journey" added to navbar.
