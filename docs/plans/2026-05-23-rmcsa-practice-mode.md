# RMCSA Practice Mode Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Implement the Multiple Choice Single Answer (RMCSA) reading practice mode, which allows users to select exactly one option and scores 0/1 or 1/1, with HTML explanations generated via local GemmaAI.

**Architecture:** Create isolated files `public/rmcsa-mode.js` and `public/rmcsa-mode.css` matching RMCMA, integrate them in `index.html`, `script.js`, and `lazy-loader.js`, enrich `RMCSA.xlsx` explanations via a Python script contacting local Ollama, and verify with a Playwright browser check.

**Tech Stack:** Vanilla JS, CSS, Python (openpyxl, requests), Ollama (gemma4:latest), Playwright.

---

### Task 1: AI Explanation Enrichment Script

**Files:**
- Create: `public/database/RMCSA/enrich_rmcsa.py`
- Modify: `public/database/RMCSA/RMCSA/RMCSA.xlsx`

**Step 1: Write the enrichment script**

Write `public/database/RMCSA/enrich_rmcsa.py` to parse questions from `RMCSA.xlsx`, query the local Ollama instance running `gemma4:latest`, generate standard HTML explanations, and write them back into column D (`EXPLANATION`).

```python
import os
import time
import re
import openpyxl
import requests

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma4:latest")
EXCEL_PATH = r"C:\Cursor AI\public\database\RMCSA\RMCSA\RMCSA.xlsx"

def parse_rmcsa_content(text):
    if not text:
        return None
    parts = [p.strip() for p in re.split(r'\n\s*-+\s*\n|\n-+', text) if p.strip()]
    if len(parts) < 3:
        parts = [p.strip() for p in re.split(r'-{3,}', text) if p.strip()]
    if len(parts) < 3:
        return None
    passage = parts[0]
    question = parts[1]
    choices_str = parts[2]
    choices = []
    for line in choices_str.split('\n'):
        trimmed = line.strip()
        if trimmed.startswith('[]') or trimmed.startswith('[x]'):
            is_correct = trimmed.startswith('[x]')
            choice_text = trimmed[3:].strip()
            choices.append({
                'text': choice_text,
                'is_correct': is_correct
            })
    return {
        'passage': passage,
        'question': question,
        'choices': choices
    }

def generate_explanation(parsed_data):
    passage = parsed_data['passage']
    question = parsed_data['question']
    options_lines = []
    for c in parsed_data['choices']:
        label = "(Correct)" if c['is_correct'] else "(Incorrect)"
        options_lines.append(f"- {c['text']} {label}")
    options_text = "\n".join(options_lines)
    
    prompt = f"""
You are an expert PTE Academic tutor.
Analyze the following reading passage, question, and options, and provide a clear, detailed, and easy-to-understand explanation of the correct and incorrect answers.

PASSAGE:
{passage}

QUESTION:
{question}

OPTIONS:
{options_text}

Task Instructions:
1. Explain why the correct options are correct by citing relevant information or context from the passage.
2. Explain why each incorrect option is wrong, pointing out where the passage contradicts it or why it is not mentioned/relevant.
3. Write the response in clean HTML format. Use standard HTML tags:
   - Use <p> for paragraphs.
   - Use <strong> for emphasis.
   - Use <ul> and <li> for lists.
   - Do NOT include any outer markdown backticks (such as ```html) or outer wrapping tags like <html>, <body>. Start directly with the HTML content.
   - Make the tone supportive, encouraging, and highly instructional.
"""
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": 8192,
            "num_predict": 2048
        }
    }
    try:
        response = requests.post(url, json=payload, timeout=90)
        if response.status_code == 200:
            return response.json().get("response", "").strip()
    except Exception as e:
        print(f"Request exception: {e}")
    return None

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active
    header_val = sheet.cell(row=1, column=4).value
    if header_val != "EXPLANATION":
        sheet.cell(row=1, column=4, value="EXPLANATION")
    max_row = sheet.max_row
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        content = sheet.cell(row=row_idx, column=3).value
        existing_explanation = sheet.cell(row=row_idx, column=4).value
        if existing_explanation and len(str(existing_explanation).strip()) > 20:
            continue
        parsed = parse_rmcsa_content(content)
        if not parsed:
            continue
        print(f"Generating explanation for Row {row_idx} (ID {q_id})...")
        explanation = generate_explanation(parsed)
        if explanation:
            sheet.cell(row=row_idx, column=4, value=explanation)
            wb.save(EXCEL_PATH)
            time.sleep(0.5)
    wb.save(EXCEL_PATH)
    print("Enrichment complete.")

if __name__ == "__main__":
    main()
```

**Step 2: Run the script to verify it populates explanations**

Run: `.venv\Scripts\python.exe public/database/RMCSA/enrich_rmcsa.py`
Expected: Cell D2 is populated with valid HTML content.

**Step 3: Commit**

```bash
git add public/database/RMCSA/enrich_rmcsa.py public/database/RMCSA/RMCSA/RMCSA.xlsx
git commit -m "feat: add RMCSA enrichment script and generate explanations"
```

---

### Task 2: Stylesheet Implementation

**Files:**
- Create: `public/rmcsa-mode.css`

**Step 1: Write rmcsa-mode.css**

Copy `rmcma-mode.css` to `rmcsa-mode.css` and search-and-replace all `.rmcma-` prefixes with `.rmcsa-`. Then, customize the checkbox styles into radio buttons:

```css
#mode-rmcsa {
  --rmcsa-paper: #fffaf2;
  --rmcsa-ink: #2c2418;
  --rmcsa-muted: #6f5f4e;
  --rmcsa-border: rgba(110, 84, 54, 0.18);
  --rmcsa-accent: #b86d2d;
  --rmcsa-accent-soft: rgba(184, 109, 45, 0.14);
  --rmcsa-success: #1f7a4d;
  --rmcsa-success-bg: rgba(31, 122, 77, 0.06);
  --rmcsa-success-border: rgba(31, 122, 77, 0.5);
  --rmcsa-danger: #9b2f3a;
  --rmcsa-danger-bg: rgba(155, 47, 58, 0.06);
  --rmcsa-danger-border: rgba(155, 47, 58, 0.5);
  
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(184, 109, 45, 0.12), transparent 30%),
    radial-gradient(circle at left bottom, rgba(90, 130, 168, 0.1), transparent 28%),
    linear-gradient(180deg, #fff 0%, #fffdf8 100%);
  padding: 8px 2px 18px;
}

.rmcsa-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
}

.rmcsa-split-layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 20px;
  margin-bottom: 20px;
  align-items: stretch;
}

.rmcsa-passage-card,
.rmcsa-question-card,
.rmcsa-explanation-card {
  border: none;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
}

.rmcsa-result-box {
  border: 1px solid var(--rmcsa-border);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.rmcsa-card-header {
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(110, 84, 54, 0.08);
  padding-bottom: 12px;
}

.rmcsa-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--rmcsa-accent);
  font-weight: 700;
}

.rmcsa-passage-text {
  font-family: 'Lora', serif;
  color: var(--rmcsa-ink);
  font-size: 1.08rem;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-y: auto;
  max-height: 500px;
  padding-right: 8px;
}

.rmcsa-passage-text::-webkit-scrollbar {
  width: 6px;
}
.rmcsa-passage-text::-webkit-scrollbar-track {
  background: transparent;
}
.rmcsa-passage-text::-webkit-scrollbar-thumb {
  background: rgba(184, 109, 45, 0.2);
  border-radius: 99px;
}

.rmcsa-question-prompt {
  font-family: 'Outfit', sans-serif;
  color: var(--rmcsa-ink);
  font-weight: 600;
  font-size: 1.15rem;
  line-height: 1.5;
  margin: 0 0 16px 0;
}

.rmcsa-subtitle {
  font-size: 0.86rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--rmcsa-muted);
  font-weight: 700;
  margin-bottom: 12px;
}

.rmcsa-choices-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rmcsa-choice-card {
  appearance: none;
  position: relative;
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 16px;
  border: 1px solid rgba(110, 84, 54, 0.14);
  background: #ffffff;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

.rmcsa-choice-card:not(:disabled):hover {
  transform: translateY(-2px);
  border-color: var(--rmcsa-accent);
  box-shadow: 0 6px 16px rgba(184, 109, 45, 0.08);
}

.rmcsa-choice-card:focus-visible {
  outline: 3px solid rgba(90, 130, 168, 0.32);
  outline-offset: 2px;
}

.rmcsa-choice-card:disabled {
  cursor: default;
}

/* Radio Button selectors */
.rmcsa-choice-radio {
  position: relative;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(110, 84, 54, 0.3);
  background: #fff;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  margin-top: 2px;
}

.rmcsa-choice-radio::after {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  opacity: 0;
  transition: all 0.15s ease;
}

.rmcsa-choice-text {
  font-family: 'Outfit', sans-serif;
  color: var(--rmcsa-ink);
  font-size: 0.98rem;
  line-height: 1.45;
}

.rmcsa-choice-card.is-selected {
  border-color: var(--rmcsa-accent);
  background: var(--rmcsa-accent-soft);
}

.rmcsa-choice-card.is-selected .rmcsa-choice-radio {
  background: var(--rmcsa-accent);
  border-color: var(--rmcsa-accent);
}

.rmcsa-choice-card.is-selected .rmcsa-choice-radio::after {
  opacity: 1;
}

.rmcsa-choice-card.is-correct-selected {
  border-color: var(--rmcsa-success);
  background: var(--rmcsa-success-bg);
  pointer-events: none;
}
.rmcsa-choice-card.is-correct-selected .rmcsa-choice-radio {
  background: var(--rmcsa-success);
  border-color: var(--rmcsa-success);
}
.rmcsa-choice-card.is-correct-selected .rmcsa-choice-radio::after {
  opacity: 1;
}

.rmcsa-choice-card.is-incorrect-selected {
  border-color: var(--rmcsa-danger);
  background: var(--rmcsa-danger-bg);
  pointer-events: none;
}
.rmcsa-choice-card.is-incorrect-selected .rmcsa-choice-radio {
  background: var(--rmcsa-danger);
  border-color: var(--rmcsa-danger);
}
.rmcsa-choice-card.is-incorrect-selected .rmcsa-choice-radio::after {
  opacity: 1;
}

.rmcsa-choice-card.is-missed-correct {
  border: 2px dashed var(--rmcsa-success);
  background: rgba(31, 122, 77, 0.04);
  pointer-events: none;
}
.rmcsa-choice-card.is-missed-correct .rmcsa-choice-radio {
  border-color: var(--rmcsa-success);
  border-style: dashed;
}

.rmcsa-choice-card.is-disabled {
  opacity: 0.65;
  pointer-events: none;
}

.rmcsa-footer-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 10px;
}

.rmcsa-buttons-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.rmcsa-result-box {
  padding: 16px 20px;
  border-radius: 18px;
}

.rmcsa-result-header {
  font-weight: 800;
  font-size: 1.1rem;
  margin-bottom: 4px;
}

.rmcsa-result-header.is-correct {
  color: var(--rmcsa-success);
}

.rmcsa-result-header.is-incorrect {
  color: var(--rmcsa-danger);
}

.rmcsa-result-desc {
  font-size: 0.92rem;
  color: var(--rmcsa-muted);
}

.rmcsa-explanation-panel {
  margin-top: 6px;
}

.rmcsa-explanation-card {
  padding: 20px;
  background: linear-gradient(180deg, #fdfbfa, #f9f5f0);
  border: 1px solid rgba(184, 109, 45, 0.16);
}

.rmcsa-explanation-header {
  font-weight: 700;
  color: var(--rmcsa-accent);
  font-size: 0.96rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
  border-bottom: 1px dashed rgba(184, 109, 45, 0.2);
  padding-bottom: 6px;
}

.rmcsa-explanation-content {
  font-size: 0.96rem;
  color: var(--rmcsa-ink);
  line-height: 1.6;
}

.rmcsa-explanation-content p {
  margin: 0 0 10px 0;
}

.rmcsa-explanation-content strong {
  color: var(--rmcsa-accent);
}

@media (max-width: 900px) {
  .rmcsa-split-layout {
    grid-template-columns: 1fr;
  }
  .rmcsa-passage-text {
    max-height: 300px;
  }
}

@media (max-width: 640px) {
  #mode-rmcsa {
    padding-inline: 0;
  }
  .rmcsa-passage-card,
  .rmcsa-question-card,
  .rmcsa-explanation-card {
    padding: 16px 0;
  }
  .rmcsa-result-box {
    border-radius: 20px;
    padding: 16px;
  }
}
```

**Step 2: Commit**

```bash
git add public/rmcsa-mode.css
git commit -m "style: add RMCSA stylesheet with radio button visual elements"
```

---

### Task 3: Logic Implementation

**Files:**
- Create: `public/rmcsa-mode.js`

**Step 1: Write rmcsa-mode.js**

Copy `rmcma-mode.js` to `rmcsa-mode.js` and search-and-replace all `RMCMA` with `RMCSA` (case-sensitive) and `rmcma` with `rmcsa` (case-sensitive).

Update `EXCEL_PATH` to `/database/RMCSA/RMCSA/RMCSA.xlsx`.

Modify `selectChoice` to clear other selections for single-choice behavior:

```javascript
  function selectChoice(idx) {
    if (state.submitted) return;

    // Single-choice logic: clear set and add new selection
    state.selectedIndices.clear();
    state.selectedIndices.add(idx);

    // Update option card active classes
    if (elements.choicesContainer) {
      const cards = elements.choicesContainer.querySelectorAll('.rmcsa-choice-card');
      cards.forEach((card, i) => {
        const isSelected = state.selectedIndices.has(i);
        card.classList.toggle('is-selected', isSelected);
        card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });
    }

    // Update submit button disabled status
    if (elements.submitBtn) {
      elements.submitBtn.disabled = state.selectedIndices.size === 0;
    }
  }
```

Modify `submitAnswers` to calculate binary score and update elements:

```javascript
  /* Submit flow */
  function submitAnswers() {
    if (state.submitted || state.selectedIndices.size === 0) return;
    state.submitted = true;

    // Disable choices interaction
    const cards = elements.choicesContainer.querySelectorAll('.rmcsa-choice-card');
    cards.forEach((card) => {
      card.disabled = true;
    });

    let correctCount = 0;
    let selectedCorrect = false;

    state.shuffledChoices.forEach((choice, idx) => {
      const isSelected = state.selectedIndices.has(idx);
      const card = cards[idx];
      if (choice.isCorrect && isSelected) {
        correctCount = 1;
        selectedCorrect = true;
        card.classList.remove('is-selected');
        card.classList.add('is-correct-selected'); // Solid green border & soft green bg
      } else if (!choice.isCorrect && isSelected) {
        card.classList.remove('is-selected');
        card.classList.add('is-incorrect-selected'); // Solid red border & soft red bg
      } else if (choice.isCorrect && !isSelected) {
        card.classList.add('is-missed-correct'); // Dashed green border
      } else {
        card.classList.add('is-disabled'); // Faded out
      }
    });

    // Show score banner
    if (elements.resultBox) {
      elements.resultBox.style.display = 'block';
      let titleClass = 'is-incorrect';
      let titleText = 'Incorrect';
      if (selectedCorrect) {
        titleClass = 'is-correct';
        titleText = 'Correct!';
      }

      elements.resultBox.innerHTML = `
        <div class="rmcsa-result-header ${titleClass}">${titleText}</div>
        <div class="rmcsa-result-desc">You scored <strong>${correctCount}</strong> out of <strong>1</strong> maximum possible points.</div>
      `;
    }

    // Toggle button visibilities
    if (elements.submitBtn) {
      elements.submitBtn.style.display = 'none';
    }
    if (elements.retryBtn) {
      elements.retryBtn.style.display = 'block';
    }

    // Show explanation toggle if explanation is present
    if (elements.explanationToggle && state.currentQuestion.explanation) {
      elements.explanationToggle.style.display = 'block';
      if (elements.explanationContent) {
        elements.explanationContent.innerHTML = parseMarkdownInHtml(sanitizeExplanationHtml(state.currentQuestion.explanation));
      }
    }
  }
```

Ensure `.rmcsa-choice-checkbox` references in HTML strings inside rendering/choices are changed to `.rmcsa-choice-radio`.

**Step 2: Commit**

```bash
git add public/rmcsa-mode.js
git commit -m "feat: implement RMCSA single-choice selection and binary scoring logic"
```

---

### Task 4: Main UI and Router Integration

**Files:**
- Modify: `public/index.html`
- Modify: `public/script.js`
- Modify: `public/js/lazy-loader.js`

**Step 1: Update index.html**

Add stylesheet:
```html
<link rel="stylesheet" href="rmcsa-mode.css">
```

Add launcher button in `#panel-tutorials .tutorial-grid`:
```html
          <!-- Multiple Choice Single Answer -->
          <div id="mode-btn-rmcsa" class="modern-card transition-card mode-switch-btn" data-practice-skill="reading"
            onclick="window.switchToMode('rmcsa')" tabindex="0" role="button" aria-label="Multiple Choice Single Answer mode">
            <div class="card-gradient card-gradient--reading"></div>
            <div class="card-body">
              <span class="card-tag">PTE Reading</span>
              <h3>Multiple Choice Single Answer</h3>
              <p>Read the passage and choose the single correct option.</p>
              <div class="card-footer-meta">
                <span class="card-badge card-badge--premium">Reading</span>
                <a href="#" class="card-link" onclick="event.stopPropagation(); window.startTutorial('rmcsa', true);">What's this?</a>
              </div>
            </div>
            <div class="card-hover-overlay"></div>
          </div>
```

Add tab button in headers:
```html
<button id="tab-rmcsa" class="tab-btn" type="button">RMCSA</button>
```

Add Mode Panel container duplicating RMCMA mode panel but using `rmcsa` prefix. Replace subtitle `Select one or more options:` with `Select one option:` inside panel.

**Step 2: Update script.js**

Add `rmcsa` in `PRACTICE_LAUNCHER.skills.reading.modeIds`:
```javascript
      reading: {
        label: 'Reading',
        kind: 'live-skill',
        modeIds: ['rfib', 'dd', 'rmcsa', 'rmcma', 'rop']
      },
```

Add `rmcsa` config in `PRACTICE_LAUNCHER.modes`:
```javascript
      rmcsa: {
        label: 'Multiple Choice Single Answer',
        skill: 'reading',
        hasTutorial: false,
        isLive: true,
        launcherVisible: true
      },
```

Add `rmcsa` to `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].visibleModes`:
```javascript
    [SCOPE_PTE]: {
      visibleModes: new Set([
        'read-aloud', 'speak', 'describe-image', 'notes', 'asq', 'sgd', 'essay', 'swt', 'type', 'rfib', 'dd', 'rmcsa', 'rmcma', 'rop', 'extended', 'rts'
      ]),
```

In `window.switchToMode`, add `rmcsa` cleanup hook:
```javascript
    if (leavingMode === 'rmcsa' && mode !== 'rmcsa') {
      window.RMCSAMode?.onExit?.();
    }
```
And add `rmcsa` script check inclusion:
```javascript
    if (mode === 'watch' || mode === 'notes' || mode === 'rfib' || mode === 'rmcma' || mode === 'rmcsa' || mode === 'rop' || mode === 'dd') {
      const assetsReady = await ensureModeAssets(mode);
      if (!assetsReady) return;
    }
```
And add `rmcsa` activation callback:
```javascript
      } else if (mode === 'rmcsa' && window.RMCSAMode && typeof window.RMCSAMode.activate === 'function') {
        await window.RMCSAMode.activate();
```

**Step 3: Update lazy-loader.js**

Add registration:
```javascript
  async function ensureRmcsaModeLoaded() {
    if (loadedModes.has('rmcsa') || window.RMCSAMode) {
      loadedModes.add('rmcsa');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('rmcsa-mode.js');
    loadedModes.add('rmcsa');
  }
```

In `ensureModeScripts`:
```javascript
    if (mode === 'rmcsa') {
      await ensureRmcsaModeLoaded();
      return true;
    }
```

In `window.BELLazyLoader` export:
```javascript
  window.BELLazyLoader = {
    ensureModeScripts,
    ensureWatchModeLoaded,
    ensureNotesModeLoaded,
    ensureRfibModeLoaded,
    ensureDdModeLoaded,
    ensureRmcmaModeLoaded,
    ensureRmcsaModeLoaded,
    ensureRopModeLoaded,
    ensureCompromiseLoaded
  };
```

**Step 4: Commit**

```bash
git add public/index.html public/script.js public/js/lazy-loader.js
git commit -m "feat: integrate RMCSA UI launcher cards, tab headers, and routing mechanisms"
```

---

### Task 5: Automated E2E Browser Test

**Files:**
- Create: `tests/browser/rmcsa-mode-browser-check.js`

**Step 1: Write E2E Playwright test**

Duplicate `rmcma-mode-browser-check.js` to `rmcsa-mode-browser-check.js`. Clean and adapt it:
- Replace `rmcma` with `rmcsa` (case-sensitive) and `RMCMA` with `RMCSA` (case-sensitive) throughout the file.
- Update the choice selector search: `#rmcsa-choices-container .rmcsa-choice-card`
- Assert choice classes look for `is-correct-selected`, `is-incorrect-selected`, `is-missed-correct`, `is-disabled`.
- Assert scoring:
```javascript
async function assertScore(page, expectedScore, expectedHeader) {
  const resultBox = page.locator('#rmcsa-result-box');
  await page.waitForFunction(() => {
    const box = document.getElementById('rmcsa-result-box');
    return !!box && getComputedStyle(box).display !== 'none';
  }, { timeout: 5000 });

  const scoreText = await resultBox.textContent();
  assert(
    scoreText.includes(`You scored ${expectedScore} out of 1`),
    `Expected score "${expectedScore} out of 1", found: ${scoreText}`
  );
  assert(scoreText.includes(expectedHeader), `Expected result header "${expectedHeader}", found: ${scoreText}`);
}
```
- Simplify navigation verification path to test clicking single choices.
  - Verify that only one card is marked `is-selected` at a time.
  - Submit correct answer -> Verify score is 1 out of 1, check correct card state.
  - Retry.
  - Submit incorrect answer -> Verify score is 0 out of 1, check red incorrect card state and missed correct answer state.

**Step 2: Run the test to verify it passes**

Run: `node tests/browser/rmcsa-mode-browser-check.js`
Expected: Test runs and outputs "RMCSA browser check passed successfully."

**Step 3: Commit**

```bash
git add tests/browser/rmcsa-mode-browser-check.js
git commit -m "test: add automated Playwright test for RMCSA practice mode"
```
