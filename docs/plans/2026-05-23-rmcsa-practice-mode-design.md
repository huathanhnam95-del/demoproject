# Multiple Choice Single Answer (RMCSA) Mode Design

## Overview
Multiple Choice Single Answer (RMCSA) is a new reading practice mode for PTE Practice. It is functionally and visually identical to Multiple Choice Multiple Answers (RMCMA) with two key differences:
1. The user can only select exactly one option.
2. The score is binary (1 point for correct, 0 points for incorrect). There is no partial score.
3. An explanation of why the correct option is correct and why the others are incorrect is generated using local GemmaAI.

## Database Schema & Enrichment
- **Excel File**: `public/database/RMCSA/RMCSA/RMCSA.xlsx`
- **Columns**:
  - `ID`: Question ID (integer)
  - `TITLE`: Question Title (string)
  - `ANSWER`: Passage, Question prompt, and Choice options separated by `---` or hyphens. Correct choice marked with `[x]`, incorrect choice with `[]`.
  - `EXPLANATION`: HTML string containing the detailed explanation.
- **Enrichment Script**: `public/database/RMCSA/enrich_rmcsa.py` will read the excel database, call the local Ollama API running `gemma4:latest` at `http://localhost:11434`, generate explanations, and write them back into Column D.

## UI Integration
- **Dashboard Grid**: A static card added to `#panel-tutorials .tutorial-grid` inside `public/index.html` with:
  - `id="mode-btn-rmcsa"`
  - `data-practice-skill="reading"`
  - `onclick="window.switchToMode('rmcsa')"`
- **Tab Header**: `<button id="tab-rmcsa" class="tab-btn" type="button">RMCSA</button>`
- **Mode Panel**: Container `#mode-rmcsa` in `public/index.html` replicating `#mode-rmcma` markup but using `rmcsa` prefix.
- **Styles (`public/rmcsa-mode.css`)**:
  - Circle-shaped radio selectors (`border-radius: 50%`) with a circular filled dot (`width: 10px; height: 10px; border-radius: 50%; background: #fff`) for selected state.
  - Border and background colors for states: Selected, Correct-selected, Incorrect-selected, Missed-correct, Disabled.

## Logic Implementation (`public/rmcsa-mode.js`)
- **Single Selection**: `selectChoice(idx)` clears all previous selections from `state.selectedIndices` before adding the new selected index.
- **Binary Scoring**:
  - Score is 1 if the user selects the correct option, and 0 otherwise.
  - Banner shows "Correct!" if score is 1, and "Incorrect" if score is 0.
- **Lazy Loading**: `public/js/lazy-loader.js` loads `rmcsa-mode.js` and `rmcsa-mode.css` on demand.

## Verification
- Automated Playwright test `tests/browser/rmcsa-mode-browser-check.js` will simulate loading questions, navigating, answering correctly and incorrectly, and verifying visual and logic outcomes.
