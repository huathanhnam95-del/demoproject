# Implementation Plan: User Profile Modal

## Phase 1: HTML Structure Adjustments (`public/index.html`)

1. Re-verify the `#account-details-modal` structure.
2. Ensure there's a dedicated button for the "Adaptive Engine" somewhere (either inside the Profile modal, or in the account panel beside View Profile).
3. E.g., add `<button id="profile-adaptive-engine-btn" class="account-btn">⚙️ Adaptive Settings</button>` to the Account Actions inside the modal.

## Phase 2: JavaScript Wiring (`public/js/auth-ui.js` or `public/js/modals.js`)

1. **Unbind Adaptive Engine**: In `adaptive-engine-ui.js`, change the binding from `panel-view-profile-btn` to the new dedicated button (or keep it as a fallback but we prefer unbinding it to prevent dual-modals).
2. **Bind Profile Modal**: In `auth-ui.js` (or similar UI script), add click listeners:
   - `panel-view-profile-btn` -> Open `#account-details-modal`.
   - `#close-details-btn` / Esc / backdrop -> Close `#account-details-modal`.
3. **Data Population**:
   - **Account Info**: Fetch from Firebase Auth / custom claims.
   - **Proficiency / Skills**: Fetch from the `AdaptiveEngine` / `DifficultyManager` or `points` system.
   - **Join a Class**: Wire the existing `#btn-join-class` to the Classroom API endpoint.

## Phase 3: CSS Formatting (`public/style.css`)

1. Review styling for `#account-details-modal`. Ensure the Skill Dashboard uses a sleek grid layout.
2. Style the "CEFR Badge" and skill progress bars to use brand colors (e.g., standard green for completion, sleek dark mode aesthetics).

## Verification Steps

1. **Browser Test**: Open `localhost:8443`.
2. Login as a user.
3. Open the side menu and click **"📊 View Profile"**.
4. **Assert**: The Profile Modal appears containing the Proficiency, Account Info, and Action sections.
5. **Assert**: Clicking outside the modal or pressing "Esc" closes it.
6. **Assert**: The Adaptive Engine Modal no longer opens simultaneously when clicking "View Profile".
