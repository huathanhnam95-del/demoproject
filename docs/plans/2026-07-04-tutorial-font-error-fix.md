# Tutorial Font and Emojis Encoding Fix Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix corrupted emoji characters (mojibake) displayed in the Read Aloud and Vocabulary Book tutorials.

**Architecture:** Replace the corrupted ISO-8859-1 strings in the tutorial configurations with their correct UTF-8 emoji and character literals.

**Tech Stack:** JavaScript, UTF-8

---

### Task 1: Fix Read Aloud Tutorial Mojibake

**Files:**
- Modify: `public/tutorial.js:1049`

**Step 1: Write the minimal implementation**
Replace the corrupted string `'ðŸ”—'` with the link emoji `'🔗'`.

**Step 2: Run verification**
Inspect the changed line to ensure it is encoded in UTF-8.

---

### Task 2: Fix Vocabulary Book Tutorial Mojibake

**Files:**
- Modify: `public/vocab-tutorial.js:98-126`

**Step 1: Write the minimal implementation**
Replace the corrupted strings in `public/vocab-tutorial.js` with their correct UTF-8 equivalents:
- Line 98: `'ðŸ“–'` -> `'📖'`
- Line 102: `'Next â†’'` -> `'Next →'`
- Line 107: `'icon: 'âœ…'` -> `'icon: '✅'`
- Line 111: `'Next â†’'` -> `'Next →'`
- Line 117: `'icon: 'ðŸ’¾'` -> `'icon: '💾'`
- Line 121: `'Next â†’'` -> `'Next →'`
- Line 126: `'icon: 'ðŸ“š'` -> `'icon: '📚'`

**Step 2: Run verification**
Inspect the changed lines to ensure they are encoded in UTF-8.

---

### Task 3: Execute Regression Tests

**Files:**
- Test: `tests/read-aloud-mode-regression.test.js`

**Step 1: Run regression test**
Run the Read Aloud browser regression test to ensure that the tutorial flow is still fully functional.
Run: `npm run test:read-aloud:browser`
Expected: PASS

**Step 2: Run all practice mode browser tests**
Run general practice modes checks.
Run: `node tests/browser/practice-modes-browser-check.js`
Expected: PASS
