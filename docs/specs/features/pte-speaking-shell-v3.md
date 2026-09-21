# PTE Speaking Shell v3 Specification

**Status**: Implemented (Phase 0–9 Complete; Full 7-mode practice lifecycle & scoring)  
**Owners**: Admin, Engineering  
**Related Specs & Plans**:
- [Master Plan: PTE Speaking Redesign](../../plans/2026-09-19-pte-speaking-redesign/gemini-takeover-handoff-plan.md)
- [Feature Index](README.md)
- [Speak Mode Spec](speak-mode.md)
- [Notes Mode Spec](notes-mode.md)
- [Project Architecture](../../specs/product.md)

---

## 1. Overview & Architecture

PTE Speaking Shell v3 delivers a unified, modern, high-clarity interface and standardized execution lifecycle across all 7 speaking practice modes in PTE Academic and PTE Core:

1. **Read Aloud** (`read-aloud`)
2. **Repeat Sentence** (`speak`)
3. **Describe Image** (`describe-image`)
4. **Retell Lecture** (`notes`)
5. **Answer Short Question** (`asq`)
6. **Respond to a Situation** (`rts`)
7. **Summarize Group Discussion** (`sgd`)

### 1.1 Structural Foundations
Under v3, the mode container adopts a cohesive design system that eliminates scattered buttons, fragmented controls, and inconsistent countdown timers:
- **Mode Bar (`.pte-modebar`)**: Persistent top header hosting back navigation, category/skill title badges (`Speaking`), question picker navigation (`spc-picker-nav`), filter drawer triggers, and contextual `More` options.
- **Card Container (`.pte-card`)**: Responsive container housing the step indicator, main practice stage, and action dock. Expandable to wide layout (`.pte-card--wide`) during feedback review.
- **Step Progress Indicator (`.pte-progress`)**: Standardized 3-step pipeline (`Prepare` $\rightarrow$ `Record` $\rightarrow$ `Feedback`), providing explicit visual progression (`is-now`, `is-done`, `aria-current="step"`).
- **Control Dock (`.pte-dock`)**: Unified bottom toolbar displaying accessible status announcements (`.pte-dock__status[aria-live="polite"]`) and phase-aware actions (`.pte-dock__actions`).
- **Attempt History Drawer (`.pte-attempts`)**: Persistent section positioned directly below the card stage for local review of previous attempts and scoring breakdowns.

---

## 2. Opt-in Flags & Legacy Fallback

To support safe rollout, zero regressions for unmigrated users, and strict backward compatibility, v3 operates behind explicit feature flags:

### 2.1 Flag Evaluation Precedence
1. **URL Query Parameter**:
   - `?pteShell=v3` forces v3 shell activation.
   - `?pteShell=legacy` forces legacy shell fallback.
2. **LocalStorage Override**:
   - `localStorage.getItem('pte_speaking_shell_v3') === 'true'` (or `'false'`).
3. **Release Default (`PteShellConfig.RELEASE_DEFAULT`)**:
   - Configured in `public/js/speaking-practice-controller.js`.
   - Hardcoded to `false` during pre-release testing to ensure untouched legacy user experience.

### 2.2 Reversible DOM Restoration Contract
When unmounting or switching to legacy mode:
- All adopted buttons, original container nodes, event listeners, and attribute states are restored exactly to their original DOM parent positions via `rememberV3` tracking records.
- Mode panels are restored without requiring full page reloads or leaving orphaned event listeners.

---

## 3. Per-Mode Flow, Timers & State Machine

The shell enforces a consistent 6-phase state machine across all modes:
`loading` $\rightarrow$ `listen` (audio modes) $\rightarrow$ `prep` $\rightarrow$ `recording` $\rightarrow$ `complete` $\rightarrow$ `feedback`

| Mode ID | Mode Name | Input Media | Listen Timer | Prep Timer | Rec Timer | Key Controls & Features |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `read-aloud` | Read Aloud | Text Passage | N/A | 35s / 40s | 40s | Pronunciation Coach drawer, sample voice audio, IPA popovers, connected speech filters |
| `speak` | Repeat Sentence | Audio Clip | Native Audio | 3s | 15s | Audio replay counter, shadow mode helper (5c), playback listen-back toggle |
| `describe-image` | Describe Image | Image Asset | N/A | 25s | 40s | Image zoom modal, strategy/template drawer, 40s auto-stop |
| `notes` | Retell Lecture | Audio / Video | Native Audio | 10s | 40s | Lecture notes editor, 40s spoken recording with AudioDspPipeline, content-coverage scoring against key points, listen-back, dual-tab feedback (Notes Match / Lecture Transcript) |
| `asq` | Answer Short Question | Audio Clip | Native Audio | N/A | 10s | Rapid auto-start recorder, instant canonical answer comparison, transcript reveal |
| `rts` | Respond to a Situation | Audio Prompt | Native Audio | 20s | 40s | Situation prompt player, 20s prep countdown, 40s recorder, dual-column feedback |
| `sgd` | Summarize Group Discussion | Multi-speaker Audio | Native Audio | 10s | 120s (2m) | Discussion player, 3-speaker dialogue, 120s timer, 3-point summary checklist |

---

## 4. Audio DSP Enhancement & Assessment Boundaries

All client-side audio recording strictly adheres to the workspace Audio DSP standards:
- **AudioDspPipeline**:
  - Automatically processes recorded blobs before playback or scoring:
    - 80Hz high-pass filter (rumble and plosive suppression).
    - 16kHz sinc-resampling for standardized speech recognition compatibility.
    - -3dBFS peak normalization for consistent playback amplitude.
    - Intelligent silence trimming at onset and offset.
- **Assessment Decoupling**:
  - Client recording UI handles capture, duration bounds, and client-side visualization.
  - Scoring requests route securely to backend endpoints (`functions/src/submitAttempt.js` and Azure Speech Services).
  - Decouples communicative intelligibility (`accuracyScore: 0-100`) from acoustic syllable-level precision.

---

## 5. Attempt History & Local Persistence

- **Local Storage Archive**:
  - Scoped key: `pte_attempt_archive_v3`.
  - Partitioned per `practiceMode` and `questionId`.
  - Captures timestamps, blob URLs, score breakdowns (Pronunciation, Fluency, Content/Vocabulary), and detailed word-level accuracy.
- **Resilience**:
  - Attempt records persist even if cloud score submission encounters temporary network interruptions.
  - "Record again" and "Next question" flows cleanly isolate previous attempts from active state.

---

## 6. Accessibility (A11y) & UX Contracts

- **Keyboard Navigation & ARIA**:
  - Explicit `type="button"` on all mode bar, navigation, and dock buttons.
  - Dialog modals (`#pte-dialog-cannot-skip`, `#pte-dialog-confirm-next`) use `role="dialog"` or `role="alertdialog"` with keyboard focus trapping and `Escape` key support.
  - Dynamic status messages use `aria-live="polite"` to alert screen reader users without interrupting active speech.
- **Reduced Motion Support**:
  - Full support for `@media (prefers-reduced-motion: reduce)` disabling pulsing ring animations, pulse scales, and countdown transition effects.
- **Responsive Layout Dimensions**:
  - Validated against desktop viewports (1440x900) and mobile viewports (390x844).
  - Feedback card heights strictly capped to $\le 740\text{px}$ on desktop viewports to prevent awkward below-the-fold vertical scrolling.

---

## 7. Retell Lecture Spoken Recording & Content Scoring (Phase 8B)

- **40-Second Spoken Recording & Content Scoring**:
  - Following explicit authorization, Retell Lecture (`notes`) incorporates a 10-second preparation countdown followed by a 40-second spoken response recording step powered by `AudioDspPipeline.createRecorder()`.
  - Content coverage is scored against lecture key points using the established comparison and speech-recognition lifecycle.
  - Per the approved specification, scoring evaluates content coverage only without unscripted acoustic fluency/pronunciation grading.
  - Listen-back audio preview and dual-tab feedback (Notes Match & Lecture Transcript) enable comprehensive learner review.
