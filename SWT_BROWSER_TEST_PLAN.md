# SWT Mode Browser Test Plan

**Mode:** Summarize Written Text (SWT)
**Credentials:** See `C:\Cursor AI\.local\browser-test-credentials.md` (admin account needed for AI scoring)

This test plan covers the complete user workflow for the SWT mode, including question selection, the timer-based writing phase, client-side validation, and the AI scoring and feedback pipeline.

## Prerequisites

1. Ensure the local development server and Firebase emulators are running.
2. Ensure you have the `browser-agent` extension installed and `localhost` in your allowlist.
3. Start the test unauthenticated, then log in during the flow to test the authentication gating for AI scoring.

---

## Phase 1: Navigation and Question Picker

1. **Navigate to SWT Mode:**
   - Go to `http://localhost:8880/` (or your local port) and navigate to the PTE practice dashboard.
   - Click on the **Summarize Written Text** mode to open the interface.

2. **Verify Initialization:**
   - Verify the question pill (`#swt-v7-question-pill`) is populated (e.g., `#1 — [Title]`).
   - Verify the "Start" button (`#start-swt-btn`) is visible.
   - Verify the source text is displayed in `#swt-source-display`.

3. **Test Question Navigation:**
   - Click the "Next" button (`#swt-v7-next-btn`) and verify the question pill and source text update.
   - Click the "Previous" button (`#swt-v7-prev-btn`) and verify it goes back.
   - Click the question pill to open the picker sheet (`#swt-v7-sheet`).
   - Use the search bar (`#swt-v7-jump-search`) to filter questions.
   - Select a different question and verify the sheet closes and the source text updates.

---

## Phase 2: Practice Execution and Client-Side Validation

1. **Start Practice:**
   - Click the "Start" button.
   - **Expected:** The textarea (`#swt-input`) becomes enabled and gains focus. The start button disappears. The submit button (`#swt-submit-btn`) appears and is enabled.
   - **Expected:** The timer (`#swt-timer`) starts counting down from 10:00 (600s).

2. **Test Word Count and Copy/Paste Restrictions:**
   - Try to paste text into the textarea.
     - **Expected:** An alert should pop up saying "Pasting is not allowed".
   - Type a few words (e.g., "This is a").
     - **Expected:** The word count (`#swt-word-count`) updates dynamically. It should show a warning style (red/bad) because it's under 5 words.

3. **Test Client-Side Form Validation (Failure Case):**
   - Type exactly: `this is a summary without a capital letter or full stop`
   - Click the "Submit" button.
   - **Expected:** The practice area hides and the results step (`#swt-step-results`) appears.
   - **Expected:** The Form score shows `0/1` and the detail says "Sentence should begin with an uppercase letter."
   - **Expected:** The AI Score button (`#swt-ai-score-btn`) is **hidden**.
   - **Expected:** The AI Score hint (`#swt-ai-score-hint`) says "Summary does not meet basic form requirements. AI scoring disabled."

4. **Retry the Attempt:**
   - Click the "Retry" button (`#swt-retry-btn`).
   - **Expected:** The interface resets. The textarea is cleared (or the user can start again). Click "Start" to begin a new attempt.

---

## Phase 3: AI Scoring and Authentication Gating

1. **Submit a Valid Form Structure (Unauthenticated):**
   - Ensure you are *not* logged in.
   - Type a valid sentence between 5 and 75 words. E.g.: `The source text discusses the impact of climate change on modern agricultural practices.`
   - Click "Submit".
   - **Expected:** Form score shows `1/1` (Written as one complete sentence within the required word range).
   - **Expected:** The AI Score button is **disabled**.
   - **Expected:** The AI Score hint shows "AI scoring requires login" with a "Log in" button (`#swt-ai-score-login-btn`).

2. **Log In:**
   - Click the "Log in" button in the hint (or use the main navigation to log in using the credentials from `browser-test-credentials.md`).
   - **Expected:** Once authenticated, the AI Score button should automatically become **enabled** and say "Submit to AI scoring". The login hint should disappear.

3. **Execute AI Scoring:**
   - Click "Submit to AI scoring".
   - **Expected:** The button becomes disabled and says "Scoring...". The hint says "AI is analyzing your summary...".
   - Wait for the Firebase function (`scoreSWT`) to return.

4. **Verify AI Scoring Results:**
   - **Overall Score:** Verify the total score circle is visible (out of 9) and the percentage is calculated.
   - **Breakdown:** Verify scores for:
     - Content (0-4)
     - Form (0-1)
     - Grammar (0-2)
     - Vocabulary (0-2)
   - **Main Points Analysis:** Verify the "Main Points Analysis" section appears, showing "Captured" points, "Missed" points, and "Paraphrasing".
   - **Teacher Advice:** Verify the "Teacher advice" block appears with a detailed qualitative review.

---

## Phase 4: BEL Chat Integration

1. **Verify Chat Assistant Handoff:**
   - When the AI scoring results load, observe the bottom-right of the screen.
   - **Expected:** The BEL Chat assistant (Dialogflow widget) should automatically open (if closed).
   - **Expected:** A custom message starting with "SWT Teacher's Advice:" should be rendered in the chat window, containing the exact teacher advice from the scoring results.

---

## Phase 5: Timer Auto-Submit (Optional / Edge Case)

1. **Test Timer Expiry:**
   - Click "Retry", then "Start".
   - Wait for 10 minutes (or modify `MAX_SWT_SECONDS` locally to 5 seconds for a quick test).
   - **Expected:** When the timer reaches 00:00, the form should automatically submit whatever is currently in the textarea and transition to the results screen.
