# Previous Attempts History UI Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a "Previous Attempts" toggle next to "Start Writing" (or the main start buttons) in PTE Practice modes to list past attempts with dates, audios (for speaking), and responses (for other modes), along with a "Click for details" button to open the feedback modal.

**Architecture:** Update the backend list router to return `promptId` and a text `responseSummary`. Implement a shared client-side history viewer in [pte-attempt-archive.js](file:///c:/Cursor%20AI/public/js/pte-attempt-archive.js) that can dynamically inject a "Previous Attempts" toggle and list into any active practice mode's DOM. Wire the history viewer into Essay and SWT controllers, and document the migration plan for other modes.

**Tech Stack:** Vanilla JS, Firebase Firestore & Functions, CSS, Playwright.

---

### Task 1: Backend Router Enhancement
Modify the backend API list endpoint to return the `promptId` and a summarized `responseSummary` string in the attempt list response.

**Files:**
- Modify: `functions/src/routes/practice-attempts.js`

**Step 1: Write code modifications**
Modify `summarizeAttemptForList` in [practice-attempts.js](file:///c:/Cursor%20AI/functions/src/routes/practice-attempts.js#L871-L905) to include `promptId` and `responseSummary`:
```javascript
function summarizeAttemptForList(doc, data, signedUrl, mediaUrls = {}) {
    return {
        attemptId: doc.id,
        ownerUid: data.ownerUid || null,
        schemaVersion: data.schemaVersion || 1,
        practiceScope: data.practiceScope || null,
        practiceMode: data.practiceMode || null,
        canonicalMode: data.canonicalMode || null,
        modeLabel: data.modeLabel || null,
        skill: data.skill || null,
        crmStudentId: data.crmStudentId || null,
        status: data.status || null,
        createdAt: data.createdAt || null,
        submittedAt: data.submittedAt || null,
        retentionState: data.retentionState || null,
        deleteAfterAt: data.deleteAfterAt || null,
        bookmark: {
            active: !!data.bookmark?.active
        },
        constraints: isPlainObject(data.constraintSnapshot) ? {
            hardMaxSeconds: data.constraintSnapshot.hardMaxSeconds || null,
            uiMaxSeconds: data.constraintSnapshot.uiMaxSeconds || null,
            maxUploadBytes: data.constraintSnapshot.maxUploadBytes || null
        } : null,
        audio: {
            studentUrl: signedUrl || null,
            durationMs: data.audio?.durationMs || null
        },
        media: normalizeMediaSlotsForResponse(data.mediaSlots).map((slot) => ({
            ...slot,
            url: mediaUrls[slot.slotFile] || null
        })),
        score: data.resultSnapshot?.score ?? data.score ?? null,
        promptId: data.promptSnapshot?.promptId || data.promptSnapshot?.id || null,
        responseSummary: data.responseSnapshot?.text 
            || data.responseSnapshot?.userAnswer 
            || (Array.isArray(data.responseSnapshot?.selectedOptions) 
                ? data.responseSnapshot.selectedOptions.map(o => o.text || o).join(', ') 
                : null) 
            || (Array.isArray(data.responseSnapshot?.order) 
                ? data.responseSnapshot.order.join(' → ') 
                : null)
            || null
    };
}
```

**Step 2: Run router contract test to verify backend code**
Run: `node tests/practice-attempts-router-contract.test.js`
Expected: PASS

**Step 3: Commit**
```bash
git add functions/src/routes/practice-attempts.js
git commit -m "api: return promptId and responseSummary in practice attempts list"
```

---

### Task 2: Implement Shared UI and Styles in Attempt Archive
Implement the dynamic toggle/list loader and extend `injectModalStyles` to style the history view at the bottom of [pte-attempt-archive.js](file:///c:/Cursor%20AI/public/js/pte-attempt-archive.js).

**Files:**
- Modify: `public/js/pte-attempt-archive.js`

**Step 1: Write code modifications**
1. In `injectModalStyles` ([L558-L754](file:///c:/Cursor%20AI/public/js/pte-attempt-archive.js#L558-L754)), append the CSS classes for attempts list UI:
```css
      .history-attempts-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        text-align: left;
        width: 100%;
        max-width: 900px;
        margin-left: auto;
        margin-right: auto;
      }
      .history-attempts-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #374151;
        margin-bottom: 12px;
      }
      .history-attempt-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.6);
        border: 1px solid rgba(0, 0, 0, 0.05);
        border-radius: 8px;
        margin-bottom: 8px;
        transition: background-color 0.2s;
      }
      .history-attempt-item:hover {
        background: rgba(255, 255, 255, 0.9);
      }
      .history-attempt-meta {
        font-size: 0.85rem;
        color: #6b7280;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 130px;
      }
      .history-attempt-date {
        font-weight: 550;
        color: #374151;
      }
      .history-attempt-content {
        flex: 1;
        font-size: 0.85rem;
        color: #4b5563;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .history-attempt-audio {
        max-height: 28px;
        width: 180px;
      }
      .history-details-btn {
        font-size: 0.8rem;
        font-weight: 600;
        color: #4f46e5;
        background: rgba(99, 102, 241, 0.08);
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .history-details-btn:hover {
        background: rgba(99, 102, 241, 0.15);
      }
```
2. Near the end of `public/js/pte-attempt-archive.js` before exposing `window.PTEAttemptArchive`, implement the global controller `updateHistoryUI(mode, questionId)`:
```javascript
  let cachedAttempts = null;
  let fetchingAttemptsPromise = null;

  async function fetchUserAttemptsCached() {
    const user = getCurrentUser();
    if (!user) {
      cachedAttempts = null;
      return null;
    }
    if (fetchingAttemptsPromise) return fetchingAttemptsPromise;
    fetchingAttemptsPromise = (async () => {
      try {
        const data = await listAttempts({ scope: 'mine', practiceScope: 'pte' });
        cachedAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
        return cachedAttempts;
      } catch (err) {
        console.warn('[PTE Archive] Failed to load history attempts:', err);
        return [];
      } finally {
        fetchingAttemptsPromise = null;
      }
    })();
    return fetchingAttemptsPromise;
  }

  async function updateHistoryUI(mode, questionId) {
    const panels = {
      essay: { startBtnId: 'start-essay-btn', panelId: 'mode-essay', skill: 'writing' },
      swt: { startBtnId: 'start-swt-btn', panelId: 'mode-swt', skill: 'writing' }
    };
    const config = panels[mode];
    if (!config) return;

    injectModalStyles();

    const startBtn = document.getElementById(config.startBtnId);
    if (!startBtn) return;

    let toggleBtn = document.getElementById(`${mode}-history-toggle`);
    let historyContainer = document.getElementById(`${mode}-history-container`);

    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.id = `${mode}-history-toggle`;
      toggleBtn.type = 'button';
      toggleBtn.className = 'modern-btn modern-btn--history';
      toggleBtn.style.cssText = 'margin-left: 8px; vertical-align: middle;';
      toggleBtn.textContent = '🕒 Previous Attempts';
      startBtn.insertAdjacentElement('afterend', toggleBtn);

      historyContainer = document.createElement('div');
      historyContainer.id = `${mode}-history-container`;
      historyContainer.className = 'history-attempts-section';
      historyContainer.style.display = 'none';
      
      const parentControls = startBtn.closest('.controls') || startBtn.parentElement;
      parentControls.insertAdjacentElement('afterend', historyContainer);

      toggleBtn.addEventListener('click', async () => {
        const isCollapsed = historyContainer.style.display === 'none';
        if (isCollapsed) {
          historyContainer.style.display = 'block';
          await refreshHistoryList(mode, questionId, historyContainer);
        } else {
          historyContainer.style.display = 'none';
        }
      });
    }

    if (historyContainer.style.display !== 'none') {
      await refreshHistoryList(mode, questionId, historyContainer);
    }
  }

  async function refreshHistoryList(mode, questionId, historyContainer) {
    if (!historyContainer) return;
    historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">Loading history attempts...</div>';

    const user = getCurrentUser();
    if (!user) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#ef4444;">Please log in to view previous attempts.</div>';
      return;
    }

    const attempts = await fetchUserAttemptsCached();
    if (!attempts || attempts.length === 0) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">No previous attempts.</div>';
      return;
    }

    // Filter attempts by mode and prompt/question ID
    const modeAliases = {
      essay: ['essay', 'write_essay'],
      swt: ['swt', 'summarize_written_text']
    };
    const validModes = modeAliases[mode] || [mode];

    const filtered = attempts.filter(a => {
      const isModeMatch = validModes.includes(a.practiceMode) || validModes.includes(a.canonicalMode);
      const isQuestionMatch = String(a.promptId) === String(questionId);
      return isModeMatch && isQuestionMatch;
    });

    if (filtered.length === 0) {
      historyContainer.innerHTML = '<div style="font-size:0.85rem;color:#6b7280;">No previous attempts on this question.</div>';
      return;
    }

    historyContainer.innerHTML = '';
    const title = document.createElement('h5');
    title.className = 'history-attempts-title';
    title.textContent = 'Previous Attempts';
    historyContainer.appendChild(title);

    filtered.forEach(attempt => {
      const item = document.createElement('div');
      item.className = 'history-attempt-item';

      const meta = document.createElement('div');
      meta.className = 'history-attempt-meta';
      const date = formatAttemptDate(attempt.submittedAt || attempt.createdAt);
      meta.innerHTML = `<span class="history-attempt-date">${escapeHtml(date)}</span>`;
      if (attempt.score !== null) {
        meta.innerHTML += `<span style="font-weight:600;color:#4f46e5;">Score: ${attempt.score}</span>`;
      }

      const content = document.createElement('div');
      content.className = 'history-attempt-content';

      const isSpeaking = ['read_aloud', 'read-aloud', 'speak', 'describe_image', 'describe-image', 'notes', 'sgd', 'rts'].includes(attempt.practiceMode)
        || ['read_aloud', 'repeat_sentence', 'describe_image', 'retell_lecture', 'summarize_group_discussion', 'respond_to_situation'].includes(attempt.canonicalMode);

      if (isSpeaking && attempt.audio?.studentUrl) {
        const audio = document.createElement('audio');
        audio.src = attempt.audio.studentUrl;
        audio.controls = true;
        audio.className = 'history-attempt-audio';
        content.appendChild(audio);
      } else {
        content.textContent = attempt.responseSummary || 'No text response available.';
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-details-btn';
      btn.textContent = 'Click for details';
      btn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('pte-attempt-archive:open', { detail: { attemptId: attempt.attemptId } }));
      });

      item.append(meta, content, btn);
      historyContainer.appendChild(item);
    });
  }

  // Clear cache on auth change
  window.addEventListener('auth-state-changed', () => {
    cachedAttempts = null;
  });
```
3. Expose these functions in `window.PTEAttemptArchive`:
```javascript
  window.PTEAttemptArchive = {
    // Existing fields...
    updateHistoryUI,
    fetchUserAttemptsCached
  };
```

**Step 2: Commit**
```bash
git add public/js/pte-attempt-archive.js
git commit -m "archive: implement shared history list UI and updater"
```

---

### Task 3: Integrate inside Write Essay and SWT Controllers
Hook the history refresh helper into Essay and SWT controllers when questions are changed or reset.

**Files:**
- Modify: `public/write-essay-mode.js`
- Modify: `public/swt-mode.js`

**Step 1: Write code modifications**
1. In `public/write-essay-mode.js` inside `selectEntry` ([L224-L236](file:///c:/Cursor%20AI/public/write-essay-mode.js#L224-L236)), trigger the UI refresh:
```javascript
    function selectEntry(index, { updateRoute = true } = {}) {
        if (index < 0 || index >= filteredEntries.length) return;
        currentEntryIndex = index;
        currentEntry = filteredEntries[index];
        if (el.currentQuestionId) el.currentQuestionId.textContent = currentEntry.id;
        if (el.questionSelect) el.questionSelect.value = index;
        reset();

        // Update URL with current question ID (replaceState — no history entry per question)
        if (updateRoute && window.PracticeRouter && currentEntry.id) {
            window.PracticeRouter.replaceRoute('essay', currentEntry.id);
        }

        if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
            window.PTEAttemptArchive.updateHistoryUI('essay', currentEntry?.id);
        }
    }
```
2. In `public/write-essay-mode.js` inside `reset` ([L64-L90](file:///c:/Cursor%20AI/public/write-essay-mode.js#L64-L90)) and `init` ([L50-L62](file:///c:/Cursor%20AI/public/write-essay-mode.js#L50-L62)), also clean up the toggle UI or make sure it displays correctly.
3. In `public/swt-mode.js` inside `selectQuestion` ([L164-L170](file:///c:/Cursor%20AI/public/swt-mode.js#L164-L170)), call the UI updater:
```javascript
  function selectQuestion(index) {
    if (isWriting || index < 0 || index >= questions.length) return;
    currentIndex = index;
    renderPicker();
    renderSource();
    closePicker();

    if (window.PTEAttemptArchive && typeof window.PTEAttemptArchive.updateHistoryUI === 'function') {
      window.PTEAttemptArchive.updateHistoryUI('swt', questions[index]?.id);
    }
  }
```
4. Also inside `onEnter` and `resetAttempt` inside `public/swt-mode.js`, invoke the UI updater.

**Step 2: Commit**
```bash
git add public/write-essay-mode.js public/swt-mode.js
git commit -m "modes: connect essay and swt controllers to attempts history viewer"
```

---

### Task 4: Plan/Migration for All Other PTE Practice Modes
To expand the history UI feature to all other PTE practice modes in the future, follow this integration plan.

#### Dynamic Mapping Config for History UI:
Map each mode ID to its corresponding controls wrapper selector, target mount elements, and specific DOM ids. Extend `window.PTEAttemptArchive.updateHistoryUI` with these options:
- **Read Aloud (`read-aloud`)**:
  - `startBtnId`: `play-btn-read-aloud`
  - `panelId`: `mode-read-aloud`
  - `skill`: `speaking`
- **Repeat Sentence (`speak`)**:
  - `startBtnId`: `play-btn-speak`
  - `panelId`: `mode-speak`
  - `skill`: `speaking`
- **Describe Image (`describe-image`)**:
  - `startBtnId`: `play-di-btn`
  - `panelId`: `mode-describe-image`
  - `skill`: `speaking`
- **Retell Lecture (`notes`)**:
  - `startBtnId`: `play-notes-btn`
  - `panelId`: `mode-notes`
  - `skill`: `speaking`
- **Summarize Group Discussion (`sgd`)**:
  - `startBtnId`: `play-sgd-btn`
  - `panelId`: `mode-sgd`
  - `skill`: `speaking`
- **Respond to Situation (`rts`)**:
  - `startBtnId`: `play-rts-btn`
  - `panelId`: `mode-rts`
  - `skill`: `speaking`
- **Summarize Spoken Text (`sst`)**:
  - `startBtnId`: `play-sst-btn` (or its equivalent start controls)
  - `panelId`: `mode-sst`
  - `skill`: `listening`

#### Integration Points in Controllers:
Call `window.PTEAttemptArchive.updateHistoryUI(modeId, questionId)` in these location hooks:
1. `selectQuestion()` / `loadQuestion()` inside the respective controllers (e.g. `rop-mode.js`, `rfib-mode.js`, `hiw-mode.js`, `dd-mode.js`, `read-aloud-mode.js`, etc.) to automatically refresh history list when navigating.
2. `onEnter()` lifecycle hooks (to refresh when the user first switches to the mode).

---

### Task 5: Automated E2E Browser Testing
Create a browser test to verify that the attempts history toggle renders next to Start Writing, opens list when clicked, displays records correctly, and detail modal opens.

**Files:**
- Create: `tests/browser/practice-attempts-history-browser-check.js`

**Step 1: Write Playwright test**
Create `tests/browser/practice-attempts-history-browser-check.js` to log in using credentials from `C:\Cursor AI\.local\browser-test-credentials.md`, load the Write Essay route, verify that the toggle exists, click it, confirm attempts list has previous dates, verify signed audio urls are rendered or response text is truncated, and trigger details popup.

**Step 2: Run test**
Run: `node tests/browser/practice-attempts-history-browser-check.js`
Expected: PASS

**Step 3: Commit**
```bash
git add tests/browser/practice-attempts-history-browser-check.js
git commit -m "tests: add e2e browser test for attempts history toggle"
```
