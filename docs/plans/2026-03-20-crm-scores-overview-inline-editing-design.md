# CRM Scores Overview Inline Editing Design

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Keep the existing shield-and-circles score design, but make every score editable inline and make the Overall Score `N/A` state explicit in the card itself.

**Architecture:** Preserve the current DOM shape and visual proportions so the UI still matches the attached reference images. Add a small amount of state synchronization in the CRM admin script to keep the Overall Score input, the `N/A` checkbox, and the displayed shield value in sync without changing the existing data contract.

**Tech Stack:** Static HTML/CSS/vanilla JS in `public/crm-admin.html`, `public/crm-admin.css`, and `public/crm-admin.js`; existing student payload helpers in `public/js/crm/students.js`.

---

### Task 1: Refine the Learning Profile Markup

**Files:**
- Modify: `public/crm-admin.html`

**Step 1: Keep the current score layout**

Retain the shield on the left and the four circles on the right so the module still matches the attached photos.

**Step 2: Add explicit Overall Score display support**

Add a dedicated value display for the Overall Score card so the shield can show `N/A` when the checkbox is on, while still using the same inline editing area when `N/A` is off.

### Task 2: Polish the Score Styling

**Files:**
- Modify: `public/crm-admin.css`

**Step 1: Preserve the photo-matched geometry**

Keep the shield silhouette, circle borders, and label placement.

**Step 2: Add state styling**

Introduce styles for:
- Overall Score normal edit mode
- Overall Score `N/A` display mode
- Subtle focus states for inline editing

**Step 3: Normalize the row rhythm**

Tighten spacing so the shield and circles feel like one designed system instead of separate widgets.

### Task 3: Synchronize the Overall Score State

**Files:**
- Modify: `public/crm-admin.js`

**Step 1: Keep the existing data contract**

Continue saving `null` for Overall Score when `N/A` is selected and a numeric value otherwise. No backend changes are needed.

**Step 2: Add UI sync for the checkbox**

When `N/A` is checked:
- clear the editable score field from view
- show `N/A` on the shield
- disable editing

When `N/A` is unchecked:
- hide `N/A`
- restore the inline input
- let the user edit the score again immediately

**Step 3: Preserve the last numeric value**

Store the last entered numeric Overall Score locally so toggling `N/A` off does not destroy the prior value unless the user overwrites it.

### Task 4: Verify the Result

**Files:**
- No new files

**Step 1: Browser-check the modal**

Open the student modal and verify:
- the circles are still editable inline
- the Overall Score card shows `N/A` when toggled
- the Overall Score input becomes editable again when `N/A` is cleared

**Step 2: Confirm the saved payload**

Verify the existing student save flow still sends `null` for `N/A` and a numeric score otherwise.

