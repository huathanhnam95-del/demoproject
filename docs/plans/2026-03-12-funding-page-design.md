# Funding Page Design

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a sponsor-agnostic Funding page linked from About that gives startup programs and grant reviewers a clearer picture of BEL's product, team, current progress, and why support would materially help.

**Architecture:** Keep the main public nav unchanged. Add one dedicated page at `/funding/` and expose it from the About page only. Reuse the existing public-page shell pattern and shared site header so the Funding page feels like part of the same site while staying reviewer-focused.

**Tech Stack:** Static HTML/CSS/vanilla JS, shared header assets in `public/`, browser verification in `tests/browser/`.

---

## Approved Direction

- Route: `/funding/`
- Visible page title: `Funding & Support for BEL`
- Navigation exposure: linked from the About page, not added to the main header nav
- Tone: natural, human, sponsor-agnostic, credible, and specific

## Audience

- Startup program reviewers
- Grant reviewers
- Cloud or infrastructure partners
- General supporters who need a clearer product/support overview than the About page provides

## Content Structure

1. Hero
   - Explain that BEL is a live English learning product seeking support to scale product systems, AI-assisted features, and delivery.
2. Snapshot
   - Short bullets summarizing what BEL is, who it serves, and where it is today.
3. Problem
   - Explain why passive learning is insufficient and why guided output practice is hard to scale manually.
4. Product Today
   - Summarize the current product surface in plain language.
5. Why Support Matters Now
   - Explain why this stage of the company/product is a strong point for support.
6. Planned Use of Support
   - Concrete, non-hype bullets for AI services, data and analytics, backend reliability, content workflows, and scalable delivery.
7. Why BEL Fits Startup Programs
   - Explain why BEL is a credible candidate without naming any one sponsor.
8. Team and Execution
   - Educator-led, live product, ongoing development, tutor network.

## Constraints

- Do not explicitly mention Google Cloud or any single sponsor.
- Do not invent traction metrics.
- Do not use investor-heavy or startup-cliche language.
- Keep the copy human and readable rather than sounding like a grant form.
