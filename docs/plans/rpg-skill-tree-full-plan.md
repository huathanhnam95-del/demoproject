# Implementation Plan: Comprehensive RPG Skill Tree

Based on the review spec (`docs/specs/rpg-skill-tree-full-review.md`), this plan details the technical steps to implement the remaining viable skills.

## Phase 1: Core Framework (Passives & API)

Before adding more frontend active buttons, the backend must support buying skills and calculating arbitrary passive discounts.

1. **Catalog Sync**: Create `public/js/skill-catalog.js` and `functions/src/skillCatalog.js` mirroring the prices and `calibMult` stats.
2. **`purchaseSkill` Cloud Function**:
   - Validate coin balance and level requirements.
   - Set `db.collection('users').doc(uid).update({ ['unlockedSkills.' + skillId]: true })` and deduct coins.
3. **Passive Discount Engine**:
   - Inside `useActiveSkill` (server) and `updatePopoverCosts` (client), implement the scaling math for frugal ranks (10%/20%/30%), mode licenses (-15%), and token/coupon checks.

## Phase 2: Action Toolbars & Reading Skills

Integrate text-based manipulatives for Reading, Writing, and Listening.

1. **`transcript_glimpse` (Watch/Listen)**:
   - *UI*: Add a "Flash Transcript" eye icon to the action popover.
   - *Logic*: On click, invoke `useActiveSkill`. If success, temporarily inject the current active subtitle/sentence into the DOM for 2000ms, then remove it and apply a CSS blur.
2. **`dict_peek` (Extended/Watch)**:
   - *UI*: Bind to the `selectionchange` event. If a user highlights a word, pop up a floating "📖 Define (X coins)" button.
   - *Logic*: `useActiveSkill` -> fetch Free Dictionary API `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` -> render definition payload.
3. **`chunking` (Type/Notes)**:
   - *UI*: A "Segment Text" toggle.
   - *Logic*: Re-process the `window.currentSentence` audio blob to pause automatically at punctuation marks.

## Phase 3: Writing & Gamification Skills

1. **`typo_shield` (Type/Notes)**:
   - *UI*: A shield toggle next to the submit button.
   - *Logic*: Modifies `hasErrors` in `script.js`. If `diffWords(user, canonical).missing === 1 && diffWords(user, canonical).extra === 1` and shield is active -> overwrite to `hasErrors = false`.
2. **`punct_ghost` (Merged into `word_ghost_tier2`)**:
   - *UI*: If the user owns the `punct_ghost` upgrade, the `word_ghost` base skill renders `, . ? !` inherently alongside the `_ _ _` blanks. If not owned, strip punctuation from the ghost string.

## Phase 4: Speaking Mode Expansion

The Speak mode relies on heavy audio processing.

1. **`pron_rune`**:
   - Before recording, if selected, query standard phonetic dictionary arrays to display IPA and highlight the stressed syllable of the core metric word.
2. **`second_take`**:
   - If the user scores < 100 on a Speak attempt, present a "Retry for X coins" overlay. This bypasses the chronological list advancement and allows a direct localized re-record.

## Exclusions

- **`time_freeze`**: Omitted due to lack of a hard failing timer in the current architecture.
- **`evidence_highlight` / `summary_scroll`**: Omitted from Stage 1 implementation pending GenAI API cost-approval and latency tests.
