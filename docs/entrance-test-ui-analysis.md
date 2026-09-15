# Entrance Test UI Evaluation & User Feedback Synthesis: Comprehensive Analysis & Architecture Specification

- **Date**: Saturday, September 12, 2026
- **Status**: Complete & Audited
- **Scope**: Candidate Skins Evaluation (Skins A / B / C), Live Firestore Quantitative Audit, User Feedback Deck Synthesis, and Final Production Architecture Specification
- **Primary Data Sources**:
  1. Live Firestore Collection `entranceTestUiRatings` (4 rater profiles, 410 star rating values across 8 pages and 5 criteria, 14 font selections).
  2. Evaluator Feedback Deck: `Entrance Test.pdf` (15 slides authored by evaluator Phạm Bích Như Quỳnh, with comparative benchmarks against Computer-Delivered IELTS and Pearson PTE).
  3. Interactive Prototype Lab: `public/entrance-test-ui-lab.html`, `public/js/crm/entrance-test-ui-lab.js`, and `public/js/entrance-test-ui-fonts.js`.
  4. Production Baseline: `public/entrance-test.html`, `public/entrance-test.js`, and `functions/src/entrance-test/test36plus.js`.

---

## 1. Executive Summary

During the internal review of the redesigned student Entrance Test interface, staff members evaluated three candidate skins:
- **Skin A (Editorial)**: Warm paper aesthetic (`#fbfaf7`), classical serif typography, delicate hairline dividers.
- **Skin B (Instrument)**: Dark chrome theme (`#0a0b0d`), high-contrast modular grid, monospace numerals and metrics.
- **Skin C (Signal)**: Neo-Brutalist design, bold flat color blocking, 2px solid dark borders, sand-colored canvas (`#f2efe6`).

Evaluations were conducted across **8 screens** (`intro`, `miccheck`, `speaking`, `vocab`, `grammar`, `listening`, `review`, `done`) across **5 criteria** (`visual`, `readability`, `usability`, `clarity`, `trust`), totaling 120 criteria per complete rater, plus typographic voting for Vietnamese UI and English reading passages.

A rigorous audit combining the live database metrics with qualitative user feedback revealed a pivotal finding: **No single skin should be adopted wholesale**. Instead, the optimal student experience emerges from an **"Academic Standard" Hybrid Architecture** that combines:
1. **Skin C's containerized card structure and clear information chunking** (stripping the Neo-Brutalist borders and beige colors).
2. **Skin A's typographic elegance and low reading fatigue** (adopting academic white `#ffffff` with neutral borders).
3. **Skin B's task-screen clarity, high-contrast buttons, and precise timers** (discarding its dark onboarding screens).
4. **Pearson PTE's inline cloze dropdowns** directly inside reading passages (retiring the prototype's right-rail split view).
5. **Computer-Delivered IELTS's persistent bottom navigation bar** with numbered question pills (retiring the hidden hamburger drawer).

---

## 2. Quantitative Ratings Analysis & Sampling Bias Audit

### 2.1 Evaluator Profiles & Sampling Discrepancy

Querying the Firestore collection `entranceTestUiRatings` yielded 4 evaluator documents:

| Evaluator Name | Document ID | Completed Criteria | Completion % | Average Rating | Font Picks (VN / EN) | Last Updated (VN Time) |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **Banana** | `banana` | 120 / 120 | 100% | **4.51 ★** | VN: Be Vietnam Pro, Inter<br>EN: Lora, Source Serif 4 | Wed, Sep 9, 12:32 PM |
| **Lan A** | `lan-a` | 120 / 120 | 100% | **4.27 ★** | VN: Be Vietnam Pro, Plus Jakarta Sans<br>EN: Newsreader, Source Serif 4 | Fri, Sep 11, 03:26 PM |
| **Nam** | `nam` | 120 / 120 | 100% | **3.55 ★** | VN: Lexend, Be Vietnam Pro<br>EN: Literata, Archivo | Wed, Sep 9, 05:11 PM |
| **Phạm Bích Như Quỳnh** | `pham-bich-nhu-quynh` | 50 / 120 | 41.7% | **3.16 ★** | VN: Be Vietnam Pro<br>EN: Literata | Thu, Sep 10, 03:14 PM |

### 2.2 Statistical Sampling Bias Insight

An aggregate calculation across all raw documents gives:
- Skin A: 4.20 ★ (120 ratings)
- Skin B: 4.02 ★ (130 ratings)
- Skin C: 3.81 ★ (160 ratings)

However, this raw average contains a severe **selection bias**:
1. Evaluator Quỳnh is the **strictest evaluator** (giving an average rating of 3.16 ★).
2. Quỳnh completed **all 40 criteria for Skin C** (avg 3.25 ★), heavily depressing Skin C's aggregate score.
3. Quỳnh evaluated Skin B **only on `intro` and `miccheck`** (avg 2.80 ★) where dark mode was universally disliked, without rating Skin B's top-performing task screens.
4. Quỳnh rated **0 criteria for Skin A**. Consequently, Skin A was evaluated solely by the three most generous raters.

### 2.3 Balanced 3-Rater Comparison (Banana, Lan A, Nam)

When controlling for sampling bias by evaluating only the 3 raters who completed all 120 criteria under identical test conditions:

```
┌───────────────────────────────────────┬───────────────────┬───────────────────┬───────────────────┐
│ Evaluation Metric                     │ Skin A · Editorial│ Skin B ·Instrument│ Skin C · Signal   │
├───────────────────────────────────────┼───────────────────┼───────────────────┼───────────────────┤
│ Overall Average Score                 │ 4.20 ★            │ 4.13 ★            │ 4.00 ★            │
│ 1. Visual Aesthetics (Thẩm mỹ)        │ 4.25 ★ (1st)      │ 3.67 ★ (3rd)      │ 3.83 ★ (2nd)      │
│ 2. Readability (Dễ đọc)               │ 4.25 ★ (1st)      │ 4.04 ★ (3rd)      │ 4.13 ★ (2nd)      │
│ 3. Usability / Ergonomics (Dễ thao tác│ 4.13 ★ (3rd)      │ 4.29 ★ (Tie 1st)  │ 4.29 ★ (Tie 1st)  │
│ 4. Clarity / Pacing (Rõ ràng)         │ 4.42 ★ (2nd)      │ 4.46 ★ (1st)      │ 4.33 ★ (3rd)      │
│ 5. Institutional Trust (Chuyên nghiệp)│ 3.96 ★ (2nd)      │ 4.17 ★ (1st)      │ 3.42 ★ (3rd)      │
└───────────────────────────────────────┴───────────────────┴───────────────────┴───────────────────┘
```

**Key Takeaway**: Skin A and Skin B are in a **statistical dead heat (+0.07 ★ difference)**. Skin A dominates aesthetics and passive reading comfort, while Skin B dominates interactive usability, operational clarity, and institutional trustworthiness during active tasks.

### 2.4 Screen-by-Screen Rating Matrix

Examining all Firestore rating entries `[skin]:[page]:[criterion]` reveals exact behavioral friction points:

| Screen | Skin A (Editorial) | Skin B (Instrument) | Skin C (Signal) | Critical Observations |
| :--- | :---: | :---: | :---: | :--- |
| `intro` | **4.40 ★** | 3.65 ★ | **4.45 ★** | Skin B dark theme rejected on onboarding (Vis: 3.25, Read: 3.25). |
| `miccheck` | **4.53 ★** | 3.75 ★ | 3.95 ★ | Skin A paper tone feels calm; Skin B feels heavy and aggressive. |
| `speaking` | 4.27 ★ | **4.67 ★** | 4.10 ★ | **Skin B wins decisively** with a perfect **5.00 Clarity** rating. |
| `vocab` | 4.33 ★ | **4.40 ★** | 4.00 ★ | Skin A Readability reached 5.00, but Usability fell to 3.33 due to right rail. |
| `grammar` | 4.33 ★ | **4.47 ★** | 3.70 ★ | Skin B's clear inputs lead; Skin C's thick borders feel distracting. |
| `listening` | **4.47 ★** | **4.47 ★** | 3.75 ★ | High score on A & B; Skin C penalized for visual noise. |
| `review` | **3.60 ★** | 3.40 ★ | 3.20 ★ | **Lowest rated screen across all skins**; severe layout and legibility issues. |
| `done` | **3.67 ★** | 3.60 ★ | 3.35 ★ | Skin C Trust cratered to **2.50 ★** (lowest individual metric in dataset). |

### 2.5 Typographic Voting Distribution

- **Vietnamese UI Typography**:
  - **Be Vietnam Pro**: **4 / 4 votes (100% unanimous consensus)**. Zero diacritic clipping, natural tone balance, perfect Vietnamese rendering.
  - *Runners-up*: Inter (1), Plus Jakarta Sans (1), Lexend (1).
- **English Passage Typography**:
  - **Literata**: **2 / 4 votes (50%)** (Supported by qualitative feedback deck as the most legible passage face).
  - **Source Serif 4**: **2 / 4 votes (50%)** (Sharper digital rendering favored by Banana and Lan A).
  - *Runners-up*: Lora (1), Newsreader (1), Archivo (1).

---

## 3. Best and Worst Features by Skin

### 3.1 Skin A · Editorial
- **Best Features**:
  - **Warm Paper Atmosphere**: `#fbfaf7` canvas reduces eye fatigue over prolonged reading sessions.
  - **High Passive Readability**: 4.25 ★ Readability with balanced serif proportions.
  - **Minimal Header Footprint**: Non-distracting top navigation that lets the student focus on text.
- **Worst Features**:
  - **Cloze Usability Failure**: Usability crashed to 3.33 ★ on Vocabulary because the right-rail answers were completely disconnected from the reading passage.
  - **Underwhelming Review & Completion**: 3.60 - 3.67 ★ scores on final screens.
  - **Informal Academic Tone**: Cream tint feels slightly casual/literary rather than like a standardized exam platform.

### 3.2 Skin B · Instrument
- **Best Features**:
  - **Exceptional Active Task Performance**: 4.40 - 4.67 ★ across Speaking, Vocab, Grammar, and Listening.
  - **Perfect Clarity on Speaking (5.00 ★)**: Crisp countdown timer, high-visibility recording status, unambiguous start/stop affordances.
  - **Highest Institutional Trust (4.17 ★)**: Crisp borders and clear button states inspire confidence in test rigor.
- **Worst Features**:
  - **Oppressive Dark Onboarding**: `#0a0b0d` background on `intro` and `miccheck` rated poorly (3.25 ★ Visual/Readability).
  - **Noisy Waveform Bar**: 120-bar pseudo-waveform audio progress display creates visual vibration.
  - **Polarizing Aesthetic**: Evaluators Nam (3.08 ★) and Quỳnh (2.80 ★) rejected full-screen dark mode.

### 3.3 Skin C · Signal
- **Best Features**:
  - **Superior Container Architecture**: Card modularity, distinct visual chunks, and structured sections (explicitly chosen by evaluator Quỳnh as her preferred layout base).
  - **High Action Button Affordance**: Usability tied for 1st place (4.29 ★); Intro Usability reached a perfect 5.00 ★.
- **Worst Features**:
  - **Neo-Brutalist Trust Crash**: 2px solid black borders and sand-beige `#f2efe6` canvas felt playful/gamified, collapsing Trust to **2.50 ★** on `done`.
  - **Severe Right-Rail Fatigue**: Vertical scrolling fatigue when matching cloze blanks.

---

## 4. Synthesis of User Feedback Deck (`Entrance Test.pdf`)

The 15-slide deck authored by evaluator **Phạm Bích Như Quỳnh** references international exam platforms (**Computer-Delivered IELTS** and **Pearson PTE**):

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FEEDBACK DECK AUDIT SUMMARY (`Entrance Test.pdf`)                │
├───────┬───────────────────────────┬──────────────────────────────────────────────────────────────┤
│ Slide │ Target Area               │ Evaluator Finding & Practical Guidance                       │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 2     │ Overall Aesthetic         │ Rejects Neo-Brutalism: Prefers pure white `#ffffff`, dark    │
│       │                           │ slate text `#111827`, and minimal functional accents.        │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 3     │ Screen 1: Intro           │ Remove superfluous subtitle `SẴN SÀNG BẮT ĐẦU`. Use 100%     │
│       │                           │ English interface text for authentic exam immersion.         │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 4     │ Screen 2: Mic Check       │ Remove header `BƯỚC CHUẨN BỊ`. Replace static bars with      │
│       │                           │ dynamic flat-line oscilloscope. MUST add Audio Playback Loop │
│       │                           │ so students can hear and verify their recorded voice.        │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 5     │ Screen 3: Speaking        │ Invert visual hierarchy: Instructions must be bold and       │
│       │                           │ prominent (16px bold), prompt text sized for normal reading. │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 6     │ Speaking Audio Control    │ Remove redundant playback duration caption (`Bản thu dài...`)│
│       │                           │ as the player scrubber already shows `0:03 / 0:05`.          │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 7 & 8 │ International Benchmarks  │ Compares Computer-Delivered IELTS and Pearson PTE layouts    │
│       │                           │ showing clean containers, prominent countdowns, zero fluff.  │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 9-11  │ Screens 4 & 5: Cloze      │ CRITICAL: Right-rail causes severe scrolling fatigue.        │
│       │                           │ Green checkmark (✓) on selected answers misleads students    │
│       │                           │ into thinking the system confirmed correctness during test!  │
│       │                           │ Recommends Pearson PTE inline dropdown chips embedded in text│
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 12    │ Screen 6: Listening       │ Replace 120-bar pseudo-waveform with clean native scrubber.  │
│       │                           │ Ensure filled blanks visually contrast with empty blanks.    │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 13    │ Screen 7: Review          │ Remove redundant bottom warning callout. Standardize question│
│       │                           │ numbers from `Roboto Mono` to primary UI font.               │
├───────┼───────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 14-15 │ Navigation System         │ Slide-out hamburger drawer hides test progress. Recommends   │
│       │                           │ Computer-Delivered IELTS persistent bottom footer with Part  │
│       │                           │ tabs and numbered pills (Green = answered, Grey = empty).    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Core UX & Cognitive Tensions Identified

### Tension 1: Evaluation vs. Selection State (The Green Checkmark Illusion)
In the prototype (`entrance-test-ui-lab.html:1417`), selected answers display a green checkmark (`ICON.check + esc(value)`). In exam psychology, green checkmarks denote **server-validated correctness**. Showing green ticks during an active test either creates unwarranted overconfidence or causes severe distress when students doubt their choice. **Selection must strictly use neutral visual affordances (filled background or blue outline), never an evaluative mark.**

### Tension 2: Cloze Cognitive Fragmentation
The prototype isolated passage text on the left and placed answer blanks in a 400px right rail. Cloze comprehension depends on **local syntactic collocation** (reading the 3 words before and after the blank). Forcing the eye to travel 400px right, scroll down to match the blank index, select an option, and travel 400px back completely breaks short-term working memory. **The existing production codebase (`public/entrance-test.js:38-40`) already uses inline `<select>` elements; the prototype's right rail was an experimental regression.**

### Tension 3: Environmental Exam Psychology
Dark backgrounds cause halation and visual fatigue during dense reading, while Neo-Brutalist borders and beige tints feel informal. Global testing platforms (IELTS, PTE, Cambridge) universally employ a **clinical academic white canvas** (`#ffffff`), deep slate typography (`#0f172a`), and disciplined blue/green status colors.

### Tension 4: Navigation Blindness vs. Bottom Pacing
Hiding navigation inside a hamburger drawer forces test-takers to repeatedly interrupt their flow to check how many questions remain. An IELTS-style persistent bottom footer provides ambient situational awareness without encroaching on reading measure.

---

## 6. Proposed Solution: "The Academic Standard" Hybrid Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        "THE ACADEMIC STANDARD" ARCHITECTURE                            │
├───────────────────┬────────────────────────────────────────────────────────────────────┤
│ Visual Canvas     │ Clinical Academic White (`#ffffff`), subtle container borders      │
│                   │ (`#e2e8f0`), neutral card fills (`#f8fafc`), deep slate text.     │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ Typography System │ Interface & Numbers: Be Vietnam Pro (100% consensus winner).       │
│                   │ Reading Passages: Literata (400 regular, 17px / 1.7 line-height).  │
│                   │ Retire Roboto Mono from review cards to maintain consistency.      │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ Cloze Interaction │ Inline dropdown chips embedded directly in the text (Pearson PTE). │
│                   │ Completely retire the split-view right rail.                       │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ State Affordances │ Selected answers get a neutral soft-blue pill (`#eff6ff`, border   │
│                   │ `#3b82f6`). STRICTLY NO green checkmarks during active testing.    │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ Audio & Mic Check │ Dynamic oscilloscope flat line with speech peak detection.         │
│                   │ Add mandatory "Record & Play Back" loop before entering test.      │
│                   │ Replace 120-bar pseudo-waveform with clean, smooth scrubber track. │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ Navigation System │ Persistent bottom footer (IELTS on Computer style):                │
│                   │ [Part 1: Speaking (3/3)] [Part 2: Vocab (4/4)] [Part 3...]         │
│                   │ Question number pills: Green = answered, Grey = unanswered.        │
├───────────────────┼────────────────────────────────────────────────────────────────────┤
│ Language Policy   │ English-first UI for genuine immersion, with an optional compact   │
│                   │ `VI | EN` toggle in the top header for lower-level candidates.     │
└───────────────────┴────────────────────────────────────────────────────────────────────┘
```

---

## 7. Screen-by-Screen Redesign Specification

### 7.1 Màn hình chào (Intro Screen)
- **Modifications**:
  - Remove redundant eyebrow banner `SẴN SÀNG BẮT ĐẦU`.
  - Main Title: `English Entrance Assessment`.
  - Subtitle: `4 Sections · 13 Questions · Untimed · Auto-saved`.
  - Structured Section Cards:
    1. `Speaking`: 3 audio prompts (Read Aloud & Free Response).
    2. `Vocabulary`: 4 cloze passages with contextual vocabulary.
    3. `Grammar`: 4 cloze passages testing grammar and structure.
    4. `Listening`: 2 audio tracks with fill-in-the-blank questions.
  - Primary Action: Prominent `Start Assessment` button in Royal Blue (`#2563eb`).

### 7.2 Kiểm tra micro (Mic Check Screen)
- **Modifications**:
  - Remove eyebrow `BƯỚC CHUẨN BỊ`.
  - Replace static vertical bars with a dynamic 1px oscilloscope baseline that pulses only upon voice detection.
  - **Mandatory New Feature (Audio Playback Loop)**:
    - Button: `Record 3s Test Sample`.
    - Auto-stop after 3 seconds, revealing a `Play Back Recording` audio button.
    - Confirms both input sensitivity and audio playback clarity prior to test initiation.
  - Primary Action: `Microphone Works — Continue`.

### 7.3 Đọc & Nói (Speaking / Read Aloud)
- **Modifications**:
  - **Prominent Instruction Header**: Styled in 16px Bold Deep Slate (`Speaking · Prompt 1 of 3`), referencing Pearson PTE Read Aloud.
  - Reading prompt styled in `Literata` 18px / 1.7 line height for optimal cadence.
  - Retain Skin B's clean countdown and active recording box.
  - Strip redundant caption text (`Bản thu dài 0:05...`) under the audio player.

### 7.4 Từ vựng & Ngữ pháp (Vocab & Grammar Cloze)
- **Modifications**:
  - **Retire Right Rail**: Remove the detached right-side column entirely.
  - **Pearson PTE Inline Dropdown Chips**:
    - *Unfilled State*: `[ Select answer ▾ ]` with dashed border (`#cbd5e1`) and hover transition.
    - *Filled State*: `[ reptiles ▾ ]` with soft blue container (`background: #eff6ff; border: 1px solid #3b82f6; color: #1d4ed8; font-weight: 500;`).
    - *Interaction*: Clicking the chip renders a compact floating popover containing the 4 options directly underneath the blank.
  - **Eliminate `ICON.check`**: Never render a green checkmark next to a selected option during the test.

### 7.5 Nghe & Viết (Listening & Fill-in-the-Blank)
- **Modifications**:
  - Replace the 120-bar pseudo-waveform player with a clean, native audio component: Play/Pause button, draggable scrubber track, elapsed/total time (`0:24 / 1:12`), and playback speed chip (`1.0x`).
  - Text input blanks: Empty blanks maintain a clean outline (`#cbd5e1`); filled blanks automatically receive a subtle background fill (`#f0fdf4`, border `#86efac`) so unanswered blanks remain obvious.

### 7.6 Persistent Bottom Navigation Bar (Replacing Drawer Sidebar)
- **Modifications**:
  - Remove the slide-out hamburger drawer entirely.
  - Implement a fixed 60px bottom footer anchored to the viewport base (Computer-Delivered IELTS pattern):
    - **Left**: Section Part tabs: `Part 1: Speaking (3/3)` · `Part 2: Vocab (4/4)` · `Part 3: Grammar (2/4)` · `Part 4: Listening (0/2)`.
    - **Center**: Question pills for the active section: `[ 1 ] [ 2 ] [ 3 ] [ 4 ]`.
      - *Answered*: Solid fill with green bottom indicator (`#16a34a`).
      - *Unanswered*: Clean neutral grey outline (`#e2e8f0`).
      - *Flagged for Review*: Amber corner marker.
    - **Right**: `Review & Submit` action button.

### 7.7 Xem lại bài làm (Review & Submit Screen)
- **Modifications**:
  - Standardize question number typography to `Be Vietnam Pro SemiBold` (retire `Roboto Mono` to prevent typographic mismatch).
  - Remove redundant bottom warning box (`entrance-test-ui-lab.html:1629-1631`). Consolidate into a clear sub-header note: *"Please review your answers before final submission. Unanswered blanks will be scored as 0."*
  - Section summary cards use structured status chips: Green outline for `Complete`, Amber outline for `1 blank missing`, Grey outline for `Not attempted`.

---

## 8. Strategic Decisions & Open Questions for Academic Leadership

1. **Language Immersion Policy**:
   - Evaluator Quỳnh strongly recommends a 100% English interface for diagnostic authenticity.
   - *Recommendation*: Implement an English-first default interface with a discrete `VI | EN` toggle in the top-right header for lower-level candidates who require Vietnamese guidance.
2. **Speaking Retake Constraints**:
   - The current prototype allows unlimited re-recordings (`Không giới hạn số lần thu lại`).
   - *Recommendation*: Limit speaking retakes to a maximum of **3 attempts per prompt** to reflect real-world testing conditions while mitigating severe test anxiety.
3. **Mobile & Tablet Touch Adaptability**:
   - While desktop users benefit from floating popovers for cloze options, mobile screens require touch-accessible selection.
   - *Recommendation*: On viewports below 768px, tapping an inline cloze chip triggers a native bottom sheet picker.
