# Browser Test Plan: Home and About Pages (Conciseness and HD Images Rewrite)

**Objective**: Ensure the recently rewritten Home (`/landing/en/index.html`) and About Us (`/about/index.html`) pages deliver a high-performance, accessible, and flawless user experience across our target audience's primary environments.

---

## 1. Top 5-7 Browser/Device Testing Matrix
Based on target audience analytics, the following testing targets cover >90% of our real-world usage:

1. **Chrome (Latest) on Windows 10/11** - Desktop (1920x1080)
2. **Safari (Latest) on macOS** - Desktop (1440x900)
3. **Chrome (Latest) on Android Mobile** - Viewport (360x800)
4. **Safari (Latest) on iOS Mobile** - Viewport (390x844)
5. **Edge (Latest) on Windows 10/11** - Desktop (1920x1080)
6. *Optional*: Safari (Latest) on iPadOS Tablet - Portrait (810x1080)

---

## 2. Fundamental Performance Baselines
Test the Home and About pages locally (and eventually in production) using Lighthouse or WebPageTest against these strict metrics:

- **[ ] Largest Contentful Paint (LCP)**: < 2.5 seconds
- **[ ] First Input Delay (FID)**: < 100 milliseconds
- **[ ] Cumulative Layout Shift (CLS)**: < 0.1
- **[ ] Total Blocking Time (TBT)**: < 200 milliseconds

---

## 3. UI, Functional, and Accessibility Scenarios

### 3.1 Home Page / Landing Page (`/landing/en/index.html`)
- **[ ] UI/Responsiveness:** Verify the Hero section, Personalization grid, and "How It Works" steps (Listen, Speak, Review) snap perfectly to matrix viewports without horizontal scrolling or text overlap.
- **[ ] Assets:** Verify `hero_lifestyle_hd.png`, `step_listen_hd.png`, `step_speak_hd.png`, and `step_review_hd.png` load without 404s and don't appear pixelated/stretched.
- **[ ] A11y (Keyboard):** Use only the `Tab` key to navigate through all interactive elements (CTAs, Navigation). Confirm visible focus indicators.
- **[ ] A11y (Screen Reader):** Ensure all HD images have meaningful `alt` text (e.g., "Student learning English with BEL").
- **[ ] A11y (Contrast):** Verify WCAG AA contrast ratios for CTA buttons and section text against their backgrounds.

### 3.2 About Us Page (`/about/index.html`)
- **[ ] UI/Responsiveness:** Verify the Problem, Product, Audience, and Impact sections scale properly, and bullet items stack sensibly on mobile matrix dimensions.
- **[ ] Assets:** Verify `concept_personalized_hd.png` and `hero_lifestyle_hd.png` load successfully alongside untouched screenshots (`screenshot-dashboard.png`, etc.).
- **[ ] A11y (Keyboard):** Verify logical tab order through the header elements and page footprint.
- **[ ] Logic/Link Verification:** Confirm no broken internal/external links out of the About page structure.

---

## 4. Issue Reporting Template
If any tests fail during execution, submit bugs using this standardized format to ensure fast resolution:

*   **Browser/OS/Device:** (e.g., Safari iOS 16, iPhone 14)
*   **Target Page:** (e.g., Home Page)
*   **Issue Type:** [Visual / Functional / Accessibility / Performance]
*   **Severity:** [Critical, High, Medium, Low]
*   **Steps to Reproduce:**
    1. 
    2. 
*   **Actual vs. Expected Result:**
*   **Screenshot/Video:** [Link or Inline]
*   **UX Impact:** (Why this matters for the user)
