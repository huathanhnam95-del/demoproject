---
title: User Profile Modal Spec
date: 2026-04-05
---

# Feature Specification: User Profile Modal

## 1. What

The "View Profile" button in the right-side account panel (currently showing the email and a chart icon) has no dedicated functionality. Currently, it is being hijacked by the Adaptive Engine UI script. The goal is to bind this button to a comprehensive User Profile Modal (using the existing, but disconnected `#account-details-modal` structure in `index.html`) that cleanly presents the student's learning journey.

## 2. Why

Users need a centralized hub to review their high-level progress, understand their proficiency, and access administrative functions like joining classes. Displaying an actionable "View Profile" button but wiring it to the complex Adaptive Engine (or leaving it functionless) creates confusion. A dedicated profile modal builds engagement by showing tangible progress.

## 3. Requirements & What Could Be Shown

Since the user asked to "think of things that could be shown here", the modal should aggregate and display:

1. **Proficiency Dashboard**:
   - Overall CEFR Level (e.g., A1, B2).
   - Component skill breakdown indicating progress in: Writing (Dictation), Speaking, Reading, etc.
   - XP / Points earned per skill.
2. **Engagement Metrics (Stability & Consistency)**:
   - Current Day Streak.
   - Stability Rating (how consistent their scores are).
3. **Recent Activity**:
   - A timeline or list of recently completed modules.
4. **Account Information**:
   - Email, Registration Date, Last Login, Total Active Time.
5. **Classroom Integration**:
   - "Join a Class" input field for students to enter a 6-digit teacher code.
6. **Adaptive Engine Link**:
   - A button inside the profile modal to open the "Adaptive Settings" (transferring the current binding).
7. **Action Links**:
   - Change Password, Logout.

## 4. Constraints & "Taste" Invariants

- **Zero-Friction UI**: The modal should pop up instantly over the current view with a blurred backdrop, allowing easy dismissal via clicking outside or hitting ESC.
- **Reuse Existing Code**: Enhance the existing disconnected `#account-details-modal` in `index.html` rather than reinventing a new component.
- **Mobile Responsive**: Must scroll vertically on small screens and use proportional font sizing.
- **No Data Loss**: If a user is a Guest, show them an empty state with a call-to-action to Login/Register.
