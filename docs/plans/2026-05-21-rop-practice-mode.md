# Re-order Paragraph (ROP) Practice Mode Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Implement a new "Re-order Paragraph" (ROP) reading practice mode in PTE Practice, featuring dynamic Excel parsing, dual-column drag-and-drop workspace UI (10-star UX), visual pair connector lines showing correct/incorrect connections upon submission, and AI-generated grammatical cohesion/coherence explanations with interactive text highlighting.

**Architecture:** Use Approach A: parse and load ROP.xlsx on-demand on the client using the XLSX library (lazy-loaded); support dynamic drag-and-drop and arrow/reordering button handlers; display interactive visual connectors between cards in the Target column (colored green/red after check); and load AI-enriched HTML explanations with matching background highlights for pronoun/keyword referents.

**Tech Stack:** Vanilla JS, CSS, HTML5, Playwright, openpyxl, Vertex AI REST API.

---

### Task 1: Database Enrichment Script
Create a Python script to iterate over rows in `ROP.xlsx`, parse the paragraph texts in `ANSWER`, call the model to enrich them with HTML span tags highlighting grammatical/lexical cohesion, generate detailed explanations, and write them back into new columns: `ENRICHED_ANSWER` (col 4) and `EXPLANATION` (col 5).

**Files:**
- Create: `public/database/ROP/enrich_rop.py`

**Step 1: Write the python script**
Write `public/database/ROP/enrich_rop.py` with code to parse columns, contact Gemini (Vertex AI model), and write in-place to `ROP.xlsx`.

```python
import os
import time
import re
import json
import openpyxl
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- API Configuration ---
API_KEY = "AQ.Ab8RN6IevtwiomI4-zHShe_gVo__PYPcY0HlDukIul9qHdxZig"
PROJECT_ID = "gen-lang-client-0677756745"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash"

EXCEL_PATH = r"C:\Cursor AI\public\database\ROP\ROP\ROP.xlsx"

def parse_paragraphs(text):
    if not text:
        return []
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    paragraphs = []
    for line in lines:
        match = re.match(r'^(\d+)[.)\s]\s*(.*)$', line)
        if match:
            paragraphs.append(match.group(2).strip())
        else:
            paragraphs.append(line)
    return paragraphs

def generate_enrichment(paragraphs):
    paras_input = "\n".join([f"{i+1}. {p}" for i, p in enumerate(paragraphs)])
    
    prompt = f"""
You are an expert English language tutor specializing in the PTE Academic reading section, specifically "Re-order Paragraphs".
Given the correct sequential order of paragraphs below:

{paras_input}

Task Instructions:
1. Identify 2-4 key cohesive links between the paragraphs. These include:
   - Grammatical cohesion: pronouns (he, she, it, they, these, this, that), demonstratives, substitution (one, the other, doing so), ellipsis.
   - Lexical cohesion: synonyms, keyword repetition, collocations, or transitional words/phrases (however, therefore, thus, in addition).
2. Rewrite the paragraphs by adding cohesive linking span tags. Wrap the cohesive markers (such as pronouns, repeating keywords, transitional words) and their referents in `<span class="cohesion-link" data-link="groupN" data-tooltip="Tooltip description">...</span>` tags where N is a number starting from 1 (e.g. group1, group2) representing each cohesive relationship.
   For example, in paragraph 1 you might wrap:
   "<span class="cohesion-link" data-link="group1" data-tooltip="Referenced by: This process">endothermic reaction</span>"
   And in paragraph 2:
   "<span class="cohesion-link" data-link="group1" data-tooltip="Reference to: endothermic reaction">This process</span>"
3. Do NOT modify the text inside the paragraphs besides wrapping elements in the `<span>` tags. Keep formatting intact.
4. Generate a detailed, educational explanation in HTML format that details the logical flow, focusing heavily on Grammatical Cohesion and Lexical Cohesion that link the paragraphs together (refer to the group link numbers).
5. Output the result strictly in this JSON format:
{{
  "enriched_paragraphs": [
     "Paragraph 1 text with spans...",
     "Paragraph 2 text with spans...",
     ...
  ],
  "explanation": "HTML explanation here..."
}}

Rules:
- Do NOT wrap in markdown backticks.
- Return raw JSON content only.
- Write explanation using standard HTML: <p>, <strong>, <ul>, <li>. Do NOT include <html> or <body> tags.
- Tone must be encouraging, supportive, and educational.
"""

    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL}:generateContent?key={API_KEY}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }
    
    try:
        response = requests.post(url, json=payload, timeout=45)
        if response.status_code == 200:
            res_json = response.json()
            content_text = res_json['candidates'][0]['content']['parts'][0]['text']
            # Parse JSON out of response
            data = json.loads(content_text.strip())
            return data
        else:
            print(f"API Error ({response.status_code}): {response.text}")
            return None
    except Exception as e:
        print(f"Exception during request: {e}")
        return None

def process_row(row_idx, q_id, title, answer_text):
    paras = parse_paragraphs(answer_text)
    if not paras:
        return row_idx, q_id, None, None
    
    result = generate_enrichment(paras)
    if not result:
        return row_idx, q_id, None, None
    
    # Reassemble enriched answers with index prefixes
    enriched_paras = result.get("enriched_paragraphs", [])
    enriched_text = ""
    if enriched_paras and len(enriched_paras) == len(paras):
        enriched_text = "\n".join([f"{i+1}. {p}" for i, p in enumerate(enriched_paras)])
    else:
        # Fallback if AI returned incorrect count
        enriched_text = "\n".join([f"{i+1}. {p}" for i, p in enumerate(paras)])
        
    explanation = result.get("explanation", "")
    return row_idx, q_id, enriched_text, explanation

def main():
    print(f"Loading workbook: {EXCEL_PATH}...")
    wb = openpyxl.load_workbook(EXCEL_PATH)
    sheet = wb.active
    
    # Check headers
    headers = [sheet.cell(row=1, column=c).value for c in range(1, 6)]
    if len(headers) < 4 or headers[3] != "ENRICHED_ANSWER":
        sheet.cell(row=1, column=4, value="ENRICHED_ANSWER")
        wb.save(EXCEL_PATH)
        print("Added Column D header 'ENRICHED_ANSWER'")
    if len(headers) < 5 or headers[4] != "EXPLANATION":
        sheet.cell(row=1, column=5, value="EXPLANATION")
        wb.save(EXCEL_PATH)
        print("Added Column E header 'EXPLANATION'")
        
    max_row = sheet.max_row
    tasks = []
    
    # Identify rows that need processing
    for row_idx in range(2, max_row + 1):
        q_id = sheet.cell(row=row_idx, column=1).value
        title = sheet.cell(row=row_idx, column=2).value
        answer_text = sheet.cell(row=row_idx, column=3).value
        existing_explanation = sheet.cell(row=row_idx, column=5).value
        
        if existing_explanation and len(str(existing_explanation).strip()) > 20:
            continue
            
        tasks.append((row_idx, q_id, title, answer_text))
        
    total_tasks = len(tasks)
    print(f"Pending tasks to enrich: {total_tasks}")
    if total_tasks == 0:
        print("No pending tasks. Enrichment complete.")
        return

    success_count = 0
    fail_count = 0
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_row = {
            executor.submit(process_row, row_idx, q_id, title, answer_text): (row_idx, q_id)
            for row_idx, q_id, title, answer_text in tasks
        }
        
        for future in as_completed(future_to_row):
            row_idx, q_id = future_to_row[future]
            try:
                row_idx, q_id, enriched_text, explanation = future.result()
                if explanation and enriched_text:
                    wb_write = openpyxl.load_workbook(EXCEL_PATH)
                    sheet_write = wb_write.active
                    sheet_write.cell(row=row_idx, column=4, value=enriched_text)
                    sheet_write.cell(row=row_idx, column=5, value=explanation)
                    wb_write.save(EXCEL_PATH)
                    success_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Enriched. ({success_count}/{total_tasks})")
                else:
                    fail_count += 1
                    print(f"Row {row_idx}/{max_row} (ID {q_id}): Failed to generate enrichment.")
            except Exception as exc:
                fail_count += 1
                print(f"Row {row_idx} (ID {q_id}) exception: {exc}")
                
    print(f"\nProcessing finished! Success: {success_count}, Failed: {fail_count}")

if __name__ == "__main__":
    main()
```

**Step 2: Run enrichment**
Run: `python public/database/ROP/enrich_rop.py` (We will run a subset or smoke check to verify it works).
Expected output: Success messages showing rows processed and saved to `ROP.xlsx`.

**Step 3: Commit**
```bash
git add public/database/ROP/enrich_rop.py
git commit -m "database: create ROP Excel enrichment script for cohesion tag generation"
```

---

### Task 2: Register ROP Practice Mode in Router
Register the new mode `rop` in `PRACTICE_LAUNCHER` and the scope configurations in `public/script.js`.

**Files:**
- Modify: `public/script.js`

**Step 1: Write code modifications**
1. In `public/script.js` under `PRACTICE_LAUNCHER.skills.reading.modeIds`, add `'rop'`.
2. Under `PRACTICE_LAUNCHER.modes`, add:
   ```javascript
   rop: {
     label: 'Re-order Paragraph',
     skill: 'reading',
     hasTutorial: false,
     isLive: true,
     launcherVisible: true
   }
   ```
3. Under `PRACTICE_SCOPE_CONFIG[SCOPE_ENGLISH].visibleModes`, add `'rop'`.
4. Under `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].visibleModes`, add `'rop'`.
5. Under `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].modeOverrides`, add:
   ```javascript
   rop: { label: 'Re-order Paragraph' }
   ```
6. In `ensureModeAssets`, add `'rop'` to the assets array check:
   `if (!['watch', 'notes', 'rfib', 'rmcma', 'rop'].includes(mode)) return true;`
7. In `window.switchToMode`, add an onExit trigger for `leavingMode === 'rop'`:
   ```javascript
   if (leavingMode === 'rop' && mode !== 'rop') {
     window.ROPMode?.onExit?.();
   }
   ```
8. In `window.switchToMode`, add the activation hook:
   ```javascript
   } else if (mode === 'rop' && window.ROPMode && typeof window.ROPMode.activate === 'function') {
     await window.ROPMode.activate();
   }
   ```

**Step 2: Run linter to check script.js**
Run: `npx eslint public/script.js`
Expected output: No syntax errors or lint problems.

**Step 3: Commit**
```bash
git add public/script.js
git commit -m "router: register rop reading mode and lifecycle hooks in script.js"
```

---

### Task 3: Setup Lazy Loader
Update `public/js/lazy-loader.js` to ensure the `rop-mode.js` controller script is lazy-loaded along with its `xlsx` dependency.

**Files:**
- Modify: `public/js/lazy-loader.js`

**Step 1: Write code modifications**
1. Add `ensureRopModeLoaded()` to load the ROP script and libraries:
   ```javascript
   async function ensureRopModeLoaded() {
     if (loadedModes.has('rop') || window.ROPMode) {
       loadedModes.add('rop');
       return;
     }
     await ensureXlsxLoaded();
     await loadScript('rop-mode.js');
     loadedModes.add('rop');
   }
   ```
2. In `ensureModeScripts(mode)`, add a switch/if condition:
   ```javascript
   if (mode === 'rop') {
     await ensureRopModeLoaded();
     return true;
   }
   ```
3. Add `ensureRopModeLoaded` to the exported properties of `window.BELLazyLoader`.

**Step 2: Run linter**
Run: `npx eslint public/js/lazy-loader.js`
Expected output: PASS with no errors.

**Step 3: Commit**
```bash
git add public/js/lazy-loader.js
git commit -m "loader: add lazy loading support for rop practice mode controller"
```

---

### Task 4: Add HTML Templates for ROP Pane
Add the ROP CSS link to the head and the section template to `public/index.html`.

**Files:**
- Modify: `public/index.html`

**Step 1: Write HTML markup**
1. Near other practice mode stylesheet links, add:
   `<link rel="stylesheet" href="rop-mode.css">`
2. Add the `<div id="mode-rop" class="mode-panel" style="display: none;">` content block. Ensure it includes:
   - Question selector picker (`rop-v7-picker-bar` containing prev/next buttons and the question title pill).
   - Split Workspace Layout (`rop-split-layout`):
     - Left Column (`rop-source-column`): containing `rop-source-list` (container for shuffling paragraphs).
     - Gutter Column (`rop-gutter-controls`): containing `→` (`rop-move-to-target-btn`) and `←` (`rop-move-to-source-btn`) buttons.
     - Right Column (`rop-target-column`): containing `rop-target-list` (container for ordering paragraphs).
     - Sidebar Column (`rop-sidebar-controls`): containing `↑` (`rop-move-up-btn`) and `↓` (`rop-move-down-btn`) buttons.
   - Action Footer:
     - Buttons row containing Submit (`rop-submit-btn`), Retry (`rop-retry-btn`), Show Explanation (`rop-explanation-toggle`).
     - Result box (`rop-result-box`).
     - Explanation panel (`rop-explanation-panel` containing the accordion card).

**Step 2: Verify HTML syntax**
Run: Start the server and confirm the landing page compiles and loads in the browser.

**Step 3: Commit**
```bash
git add public/index.html
git commit -m "templates: add layout and v7 question picker elements for rop in index.html"
```

---

### Task 5: Implement ROP Mode Stylesheet
Create the stylesheet defining layouts, hover states, card selections, drag placeholders, visual connectors, correction indicators, and cohesion highlighting styles.

**Files:**
- Create: `public/rop-mode.css`

**Step 1: Write CSS classes**
Write CSS rules:
- Mode panel container styling matching the warm paper theme.
- Responsive grid split container:
  ```css
  .rop-split-layout {
    display: grid;
    grid-template-columns: 1fr 60px 1fr 50px;
    gap: 16px;
    margin-bottom: 20px;
    align-items: stretch;
  }
  ```
- Drag card elements: smooth border, shadows, grab cursor, `.is-dragging` state (opacity 0.4), and `.is-selected` state (glowing outline).
- Drag placeholder class `.rop-drag-placeholder` (dashed border, soft background) for layout preview.
- Visual Pair Connectors (`.rop-card-connector`): vertical lines between target cards. Neutral dotted/solid styling pre-submit.
- Correct/Incorrect connector states:
  - Correct (`.is-correct`): Solid green line, circular green check badge.
  - Incorrect (`.is-incorrect`): Solid red line, circular red cross badge.
- Cohesion highlight span styles (`.cohesion-link`): dotted border-bottom.
- Cohesion hover glow (`.cohesion-link.highlight-active`): colored background-color glow with transitions.

**Step 2: Commit**
```bash
git add public/rop-mode.css
git commit -m "styles: create custom stylesheet for rop practice mode"
```

---

### Task 6: Implement ROP Mode Controller Logic
Create the core JS controller that loads the Excel file, parses question data, shuffles options, handles drag-and-drop events, manages button-based movements and reordering, scores based on correct adjacent pairs, and toggles explanations.

**Files:**
- Create: `public/rop-mode.js`

**Step 1: Write the javascript controller**
Define the `ROPMode` module globally, containing:
- State variables: `questions`, `currentIndex`, `selectedSourceIndex`, `selectedTargetIndex`, `targetOrder` (array of original paragraph indices, e.g., `[3, 1, 2]`), `submitted`.
- Excel Loader: Fetch and parse `public/database/ROP/ROP/ROP.xlsx` using `XLSX.read`.
- Paragraph Parsers:
  - Read `ENRICHED_ANSWER` (if exists) or `ANSWER`.
  - Extract paragraph lines and strip standard numbers (`1. `, `2. ` etc.).
  - Return array of objects: `{ originalIndex, text }`.
- Drag and Drop Handlers:
  - Add `draggable="true"` to cards.
  - Implement `dragstart`, `dragend` on cards.
  - Implement `dragover`, `dragleave`, `drop` on lists and cards to support dragging cards between columns and dragging to insert/reorder cards in Target.
- Button-based Gutter & Sidebar Controls:
  - Allow selecting a card by clicking on it.
  - `→` moves selected Source card to the bottom of Target.
  - `←` moves selected Target card back to Source.
  - `↑` moves active Target card up one position.
  - `↓` moves active Target card down one position.
- Connector Renderer:
  - Loop through Target list and dynamically append `.rop-card-connector` elements between cards.
  - Evaluate pairs upon submit and add `.is-correct` or `.is-incorrect` classes.
- Scoring Engine:
  - Count correct adjacent pairs. If correct order is `1, 2, 3`, correct pairs are `(1, 2)` and `(2, 3)`. Compare adjacent cards in target: if they match correct adjacent pairs, award 1 point.
- Interactive Cohesion Hover:
  - Find all `.cohesion-link` nodes. Add event listeners: on hover, get `data-link` attribute and toggle class `.highlight-active` on all nodes sharing the same `data-link` in the paragraphs and explanation cards.
- UILifecycle: `activate()`, `onExit()`, `loadQuestion()`.

**Step 2: Run linter on new js file**
Run: `npx eslint public/rop-mode.js`
Expected output: No errors.

**Step 3: Commit**
```bash
git add public/rop-mode.js
git commit -m "logic: implement rop practice mode controller with drag-drop, scoring, and hover highlighting"
```

---

### Task 7: Playwright Integration Test
Write and execute a Playwright browser check for ROP practice mode verification.

**Files:**
- Create: `tests/browser/rop-mode-browser-check.js`

**Step 1: Write Playwright check**
Create `tests/browser/rop-mode-browser-check.js` modeling `rmcma-mode-browser-check.js` to start the server, load ROP practice mode, check question title, click cards to move them to target, click up/down to reorder, submit, verify score count and connector class names, expand explanation, verify cohesion highlights hover behavior, and click retry to reset states.

**Step 2: Run the test**
Run: `node tests/browser/rop-mode-browser-check.js`
Expected output: Success message confirming all assertions pass.

**Step 3: Commit**
```bash
git add tests/browser/rop-mode-browser-check.js
git commit -m "tests: add automated playwright verification test for rop practice mode"
```

---

### Task 8: Update Task Status and Verify Build
Verify everything builds and runs correctly. Update `TASK_TRACKER.csv` to mark Task 284 as complete.

**Files:**
- Modify: `C:\Cursor AI\TASK_TRACKER.csv`

**Step 1: Verify the build**
Run: `npm run build` or verification checks.

**Step 2: Update TASK_TRACKER.csv**
Modify row 278: change status to "Done" and add DoneDate.

**Step 3: Commit**
```bash
git add TASK_TRACKER.csv
git commit -m "release: V1.8.0 complete, ROP practice mode implementation is verified"
```
