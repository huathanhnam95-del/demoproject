# Multiple Choice Multiple Answers (RMCMA) Practice Mode Design

## Overview
Implement "Multiple Choice Multiple Answers" (RMCMA) as a reading practice mode within the PTE practice application. This mode parses question databases from a local Excel spreadsheet, displays them in a modern v7-styled interface, provides interactive validation, and includes AI-generated explanations for correct/incorrect answers.

## Architecture & Data Flow

### 1. Database & Enrichment
* **Source Path**: `public/database/RMCMA/RMCMA/RMCMA.xlsx`
* **Structure**:
  * `ID`: Unique identifier for each question.
  * `TITLE`: Question title.
  * `ANSWER`: Multi-line text string with format:
    `[Passage] \n ---\n [Question] \n ---\n [Choices starting with [] or [x]]`
  * `EXPLANATION` (New Column): AI-generated explanation in HTML format detailing why correct options are correct and incorrect ones are incorrect.
* **Generation**: Run an offline Python script using Vertex AI / Gemini API to enrich all 67 rows in the spreadsheet with explanations.

### 2. UI Layout (v7 Style)
* **Main Container**: Split viewport screen layout.
  * **Left Panel**: Scrollable passage container.
  * **Right Panel**: Question prompt followed by choices list.
* **Choices List**: Cards representing choices that can be clicked to toggle selection. Choices are shuffled randomly every time a question is loaded or retried.
* **Actions Panel**:
  * **Submit**: Validates user selection, renders feedback, reveals explanation control.
  * **Show Explanation**: Accordion toggler to display/hide the HTML explanation post-submission.
  * **Retry**: Clears input selection, reshuffles, resets UI to active state.

### 3. Submission Feedback Colors
* Checked & Correct: **Green background/border** with check mark.
* Checked & Incorrect: **Red background/border** with cross mark.
* Unchecked & Correct (Missed): **Dashed green border** showing it should have been selected.
* Unchecked & Incorrect: **Neutral** styling.

### 4. Code Integration
* **Lazy Loader**: Modify `public/js/lazy-loader.js` to register `rmcma-mode.js` and load dependencies (`xlsx`).
* **Router**: Register `rmcma` in `PRACTICE_LAUNCHER` within `public/script.js` and support dynamic routing under `pte-practice/reading/rmcma` and `practice/reading/rmcma`.
