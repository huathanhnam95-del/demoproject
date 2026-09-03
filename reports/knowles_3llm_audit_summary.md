# 3-Model Local LLM Consensus Quality Audit: Knowles (1973)

## Book Details
- **Title**: *(Knowles, 1973) The Adult Learner, A Neglected Species*
- **Book ID**: `if1GtQHgGoU7uolTPVXC`
- **Total Pages**: 211
- **Source Type**: Archival 1973 Microfiche Paper Scan (ERIC Clearinghouse)
- **Active Models**:
  1. `deepseek-r1:14b` (DeepSeek Reasoning Model)
  2. `qwen3:14b` (Qwen 3 Language Model)
  3. `gemma4:12b` (Gemma 4 Language Model)
- **Evaluation Mechanism**: 2/3 Majority Consensus Voting Rule

---

## 1. Full-Book Heuristic Quality Scan Baseline (All 211 Pages)
The heuristic analyzer (`scripts/crm/scan_knowles_quality.py`) screened all 211 pages:
- **Total Pages**: 211
- **Clean Body Pages**: ~140 pages (high dictionary fidelity, regular paragraph flow)
- **Front Matter**: Pages 1–15 (cataloging sheets, title, copyright, table of contents, foreword, preface)
- **Identified Anomaly Categories**:
  1. **Photocopy / Gutter Creases**: Pure noise lines containing punctuation, semicolons, brackets (e.g. Page 5: `6.1,,E1K,44[;14i01..rogfiwoal;`).
  2. **Microfiche Archival Stamps**: Catalog accession lines stamped on early pages (e.g. `ED 084 368`, `CE 000 509`, `MF-$0.65`).
  3. **Retro 1970s Font Distortions**: Decorative typeface on dust jackets causing OCR misread (e.g. `izSpeiecs`, `KNOVII6`).
  4. **Faded Typewriter Dropouts**: Faded ribbon characters creating broken words (e.g. `th- Ty.` for `theory.`, `educatioual` for `educational`, `exaTiples` for `examples`).
  5. **Academic Citations**: Legitimate author citations in brackets (e.g. `[Bruner, 1966]`, `[Kidd, 1959]`) that must be preserved.

---

## 2. 3-Model Consensus Findings by Page

| Page | Content / Section | Consensus Text Verdict | Consensus Layout Verdict | Key Issues Identified by Committee | Models Consensus |
| :---: | :--- | :---: | :---: | :--- | :---: |
| **1** | Microfiche Cover | **WARN** | **PASS** | Microfilm accession stamps (`ED 084 368`, `CE 000 509`); OCR `Lased -> Based`, `applicab?e -> applicable`. | Qwen, Gemma, DeepSeek |
| **2** | Document Resume | **FAIL** | **WARN** | High noise archival reproduction text (`AliNC,`, `INST,TUTE`, `EMLF6`, `6pecie8 -> Species`). | Unanimous |
| **3** | Book Jacket Flap | **WARN** | **PASS** | Retro font OCR corruptions: `izSpeiecs -> Species`, `KNOVII6 -> Knowles`, `MAIMM -> Malcolm`. Body blurb text is readable. | Qwen, DeepSeek, Gemma |
| **5** | Binding Crease | **FAIL** | **FAIL** | Complete photocopy margin artifact smudge (`6.1,,E1K,44[;14i01..rogfiwoal;`). | Unanimous 3/3 |
| **10** | Table of Contents | **WARN** | **PASS** | Isolated symbol noise (`%`, `.,`); short page layout correctly requires full sheet proportions. | Qwen, Gemma, DeepSeek |
| **13** | Preface | **WARN** | **PASS** | Faded print dropouts: `educatioual -> educational`, `th- Ty -> theory`; stray symbol `=`. | Qwen, Gemma, DeepSeek |
| **16** | Chapter 1 Opener | **WARN** | **WARN** | OCR typo: `Kidl -> Kidd`. Citations `[Hilgard and Bower, 1966]`, `[Kidd, 1959]` protected. | Qwen, Gemma, DeepSeek |
| **17** | Citations Page | **WARN** | **PASS** | OCR ribbon glitch: `exaTiples -> examples`. In-text citations `[Bruner, 1966]`, `[Thompson, 1970]` protected. | Qwen, DeepSeek, Gemma |
| **45** | Theory & Models | **PASS** | **PASS** | High-fidelity clean body text. Citations `[Maslow, 1972]`, `[Rogers, 1951]` intact. | Unanimous 3/3 |
| **195** | Appendix / Biblio | **WARN** | **WARN** | Typo corruptions: `Govenment -> Government`, `Leqrning -> Learning`. | Gemma, DeepSeek |

---

## 3. Implemented Remediations & Protection Rules

Based on the 3-model local committee audit, we incorporated automated cleaning and protection logic into `public/js/crm/books-workspace.js`:

1. **`repairArchivalOcrText(text)` Engine**:
   - Seamlessly repairs historical OCR dropouts in real-time during reader reflow:
     - `th- Ty.` &rarr; `theory.`
     - `educatioual` / `educatioul` &rarr; `educational`
     - `exaTiples` &rarr; `examples`
     - `izSpeiecs` &rarr; `Species`
     - `Leqrning` &rarr; `Learning`
     - `Govenment` &rarr; `Government`
     - `Kidl, 1959` &rarr; `Kidd, 1959`
     - `Lased on` &rarr; `Based on`
     - `applicab?e` &rarr; `applicable`

2. **In-Text Citation Protection Rule in `isScannerNoiseLine`**:
   - Added regex protection to ensure legitimate bracketed academic citations (e.g. `[Bruner, 1966, pp. 4-5]`, `[Kidd, 1959]`, `[Ibid., p. 12]`) appearing on their own line are **NEVER** discarded as noise.

3. **Archival Stamp & Microfiche Noise Filtering**:
   - Added automated rejection rules for ERIC accession stamps (`ED \d{6}`, `CE \d{6}`), microfiche price stamps (`MF-$...`), and isolated single characters (`N`, `1,`).

4. **Full-Page Sheet Height**:
   - `.crm-books-page-paper` minimum height is enforced at `840px`, ensuring short pages (such as Page 10 Table of Contents) maintain authentic book proportions.
