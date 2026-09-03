# 3-Model Local LLM Consensus Quality Audit: Harmer (5th Edition) & Teaching Pronunciation with Confidence

## Book Profiles
1. **Book 1**: *The Practice of English Language Teaching (5th Edition)*
   - **Author**: Jeremy Harmer
   - **Book ID**: `FQavK9NnlrytB00F3WHy`
   - **Total Pages**: 459
   - **Source**: Prepress Digital InDesign PDF (Pearson Longman)
2. **Book 2**: *Teaching Pronunciation with Confidence*
   - **Authors**: Agata Guskaroska, Zoe Zawadzki, John M. Levis, Kate Challis, Maksim Prikazchikov
   - **Book ID**: `ZT25mJFlnHUYCOY2rmIG` (Active Text Revision: `rev-ocr-001`)
   - **Total Pages**: 315
   - **Source**: Linguistic/Pedagogical Academic Text with Unicode IPA transcriptions

- **Active Committee**:
  1. `deepseek-r1:14b` (DeepSeek Reasoning Model)
  2. `qwen3:14b` (Qwen 3 Language Model)
  3. `gemma4:12b` (Gemma 4 Language Model)
- **Evaluation Mechanism**: 2/3 Majority Consensus Voting Rule

---

## 1. Page-by-Page Heuristic Quality Screening (All 774 Pages)

| Metric | Harmer (5th Ed) | Teaching Pronunciation | Notes |
| :--- | :---: | :---: | :--- |
| **Total Pages Scanned** | 459 | 315 | Total: 774 pages |
| **Total Characters** | 1,353,212 | 293,566 | Harmer is a comprehensive 459p textbook |
| **Average Chars/Page** | 2,948 | 931 | Pronunciation has many charts and exercises |
| **Blank Pages** | 0 | 2 (Pages 1 & 2) | Flyleaf / inside cover pages |
| **InDesign Drop-Shadow Repeats** | 110 pages | 1 page | Prepress vector drop-shadows on chapter end notes |
| **Linguistic IPA Pages** | ~35 pages | 109 pages | Unicode IPA extensions (`\u0250-\u02AF`, `\u1D00-\u1D7F`, `\u0370-\u03FF`) |

---

## 2. Critical Diagnostic Findings & Root Cause Analysis

### Issue A: IPA Phonetic Notation False-Positive Suppression (Pronunciation Book)
- **Symptom**: 161 legitimate phonetic lesson lines across 109 pages were previously treated as scanner noise.
- **Root Cause**: `isScannerNoiseLine` used `/[a-zA-ZÀ-ɏ]/g` to count letters. Unicode IPA characters (`ə`, `ʃ`, `ʒ`, `θ`, `ð`, `ŋ`, `ʊ`, `ɪ`, `ʌ`, `æ`, `ɒ`, `ɾ`, `ʔ`) fall in IPA Extensions (`\u0250-\u02AF`) and Greek blocks (`\u0370-\u03FF`). When an isolated phoneme line like `[ə]` or `/ʊ/` was evaluated, `letterCount` was 0, triggering noise rejection.
- **Resolution**:
  1. Expanded letter regex to include full IPA phonetic blocks: `[a-zA-ZÀ-ɏ\u0250-\u02AF\u1D00-\u1D7F\u0370-\u03FF]`.
  2. Added explicit preservation rules for slashed `/.../` and bracketed `[...]` phonemes.

### Issue B: Video Timestamps, Ranges, Roman Numerals & Dialogue Suppression (Harmer)
- **Symptom**: Timestamps (`3:10`, `15:30`), word count ranges (`320–380`), Roman numeral folios (`v`, `x`), and dialogue lines (`B: Yes, please.`) were caught by symbol density checks.
- **Root Cause**: Digit-and-colon patterns (`3:10`) had 0 letters; short dialogue lines (`B: Yes, please.`) had 10 letters and 3 punctuation marks (`:`, `,`, `.`).
- **Resolution**:
  1. Added explicit whitelist rules for timestamps (`^\d{1,2}:\d{2}`), ranges (`^\d+[\s–—-]+\d+$`), and Roman numerals (`^[ivxlcdm]+$`).
  2. Preserved dialogue speaker patterns (`^(?:[A-Z]:|[A-Z][a-z]+:)\s+\S+`).
  3. Replaced over-aggressive comma check with high-precision smudge ratio check (`punctCount >= 4 && punctCount >= letterCount * 2`).

### Issue C: Prepress Drop-Shadow Heading Repetition (Harmer)
- **Symptom**: 110 chapter-end pages had headings repeated 6–15 times without spaces (e.g. `Chapter notes and further reading...`, `Pragmatics...`, `Business English...`).
- **Resolution**: Verified that `deduplicateRepeatedPhrases` automatically collapses these into single, clean `<h4>` headings.

---

## 3. 3-Model Committee Consensus Verdicts

| Book | Page | Section / Content | Consensus Text | Consensus Layout | Key Elements Identified |
| :--- | :---: | :--- | :---: | :---: | :--- |
| **Harmer** | **4** | Detailed Table of Contents | **PASS** | **PASS** | Section numbers and titles with commas preserved. |
| **Harmer** | **9** | Video & DVD Contents Table | **PASS** | **PASS** | Video duration timestamps (`15:54`, `3:10`) preserved. |
| **Harmer** | **24** | InDesign Heading Drop Shadows | **FAIL** | **FAIL** | Raw text has repeated layers (`Business English`, `ESP`). Collapsed cleanly by reader reflow. |
| **Harmer** | **47** | Conversational Dialogue | **PASS** | **PASS** | Dialogue markers (`A:`, `B:`) and natural spoken pauses preserved. |
| **Harmer** | **49** | Chapter 2 Notes Drop Shadows | **WARN** | **FAIL** | Raw text has repeated `Chapter notes and further reading`. Collapsed cleanly by reader reflow. |
| **Harmer** | **100** | Pedagogical Methodology Prose | **PASS** | **PASS** | High-fidelity clean body text reflow. |
| **Pron** | **12** | Consonant Contrast Pairs | **PASS** | **PASS** | Minimal pair contrasts (`/p/`, `/b/`) preserved. |
| **Pron** | **21** | IPA Phonetic Vowel Transcription | **PASS** | **PASS** | Vowel phonemes (`[tɛɹ]`, `[hɛd]`, `[tɪɹ]`) preserved. |
| **Pron** | **26** | Vowel Quadrant Chart | **PASS** | **PASS** | Vowel chart symbols (`/eɪ/`, `/3 r/`, `/ɑ/`, `/i/`, `/ʊ/`) preserved. |
| **Pron** | **42** | Spelling to Phoneme Mapping | **PASS** | **PASS** | Letter-to-sound mappings (`[əʊ]`, `[eɪ]`, `[æ]`) preserved. |
| **Pron** | **43** | Allophone Variations | **PASS** | **PASS** | Alveolar flap (`[ɾ]`) and glottal stop (`[ʔ]`) preserved. |
| **Pron** | **51** | Dialect Variations | **PASS** | **PASS** | Regional phonetic variants (`[ʊə]`, `[ʊr]`, `[ɛr]`) preserved. |
