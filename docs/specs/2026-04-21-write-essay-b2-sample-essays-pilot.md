# Write Essay (PTE) B2 Sample Essays - Pilot

Date: 2026-04-21

## Problem

Learners in Write Essay mode currently get scoring feedback, but they do not have consistent, level-appropriate model essays to study. Existing sample responses (external) are often C1-C2 and do not match B2 learning goals.

## Goal

Provide B2-and-below model essays for Write Essay prompts that:

- Have a strict word count between **200 and 300 words** (PTE Form score band 2).
- Follow a consistent structure that is easy to imitate:
  - Introduction (exactly 3 sentences)
  - Body paragraph 1 (PEEL)
  - Body paragraph 2 (PEEL)
  - Conclusion (restates stance + both main points)
- Include an analysis block for study:
  - Point 1 summary
  - Point 2 summary
  - Vocabulary list with English and Vietnamese glosses
- Are visible in the learner web app after the learner submits their own essay.
- Can be exported into a single `.docx` document for offline use.

## Users

- Primary: B2-level English learners preparing for PTE Academic.
- Secondary: teachers/admins who want printable samples.

## Scope (Pilot)

- Generate and ship sample responses for 20 prompts:
  - `1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 22, 23, 53, 66`
- Store samples in the existing runtime dataset for Write Essay.
- Add UI rendering in Write Essay Results step.
- Export one `.docx` file containing the pilot set.

## Non-Goals

- Generating samples for all 453 prompts (after pilot only).
- Changing existing scoring logic or AI Tutor chat workflow.
- Perfect Vietnamese translation quality; pilot requires vocabulary glosses to be present and reasonable, with a manual review path for failures later.

## Success Criteria

- For each of the 20 pilot prompts, at least one sample variant is available and meets:
  - 200-300 word count (strict)
  - 4-paragraph structure with intro=3 sentences
  - B2 lexical constraints (no C1/C2 tokens from the Oxford 5000 list; avoid prompt-specific C1/C2 target vocabulary terms)
- The web app:
  - Loads without errors
  - Shows a collapsible "Sample Essays" panel in Results for pilot prompts
  - Does not show the panel for non-pilot prompts
- A `.docx` export is generated and opens correctly in Word/LibreOffice.

## Data

Inputs:

- `public/database/Write Essay/ESSAY/Essay.xlsx` (prompt source)
- `public/database/Write Essay/essay-questions-with-vocab.json` (runtime dataset)
- `public/database/knowledge-base/Write Essay Score Guide.txt` (rubric)
- `The_Oxford_5000.csv` (CEFR word-level guardrail)

Outputs:

- Updated `public/database/Write Essay/essay-questions-with-vocab.json` with `sampleResponses` for pilot prompts
- `public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx`

## UX

- Sample essays appear only in the Results step, after submission, to avoid learners copying before practicing.
- If multiple variants exist, learners can select between them.
- All content is rendered safely (HTML-escaped).

## Risks

- B2 lexical enforcement can be too strict and cause many regeneration loops; the pilot is designed to tune prompts and validation heuristics before scaling.
- Storing all samples inline for 453 prompts would bloat the JSON; after pilot, samples should be separated and lazy-loaded.
