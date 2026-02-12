# Shop Expansion: Feature Recommendations

This document outlines proposed features for the Shop expansion, mapped to **current app modes**. It details the unlock progression, technical implementation hints, and the best fit for each feature.

## Legend

- **P** = Primary Fit (Highest learning value)
- **S** = Secondary Fit (Useful add-on)
- **O** = Optional (Consider for later)
- **—** = Not Recommended

---

## 🏗️ 1. Scaffolding

*Tools to help learners bridge gaps in knowledge or ability.*

### **Word Ghost** (Stage 1)

- **Unlock Key**: `wordGhost`
- **Recommended Fit**:
  - **P**: Fill/Extended
  - **S**: Type
- **Implementation Note**: Display `_ _ _` placeholders derived from the `data-correct` length. Best implemented in `Fill` or `Extended` modes.

### **First-Letter Peek** (Stage 1)

- **Unlock Key**: `firstLetterPeek`
- **Recommended Fit**:
  - **P**: Fill/Extended
  - **S**: Type
- **Implementation Note**: Distinct from existing "Hints". This should be a **timed peek** (e.g., reveals letter for 800ms) rather than a persistent reveal.

### **Audio Slow-Mo** (Stage 1)

- **Unlock Key**: `audioSlowMo`
- **Recommended Fit**:
  - **P**: Type, Speak
  - **S**: Watch, Notes
- **Implementation Note**: Unlock playback speed controls (< 1.0x). High value for transcription (`Type`) and shadowing (`Speak`).

### **Phonetic Hint (IPA)** (Stage 2)

- **Unlock Key**: `phoneticHint`
- **Recommended Fit**:
  - **P**: SRS, Vocab, Global
  - **S**: Type, Fill/Extended
- **Implementation Note**: Show IPA for **missed words** or focused terms. Takes existing `Phonetics.getIPA` logic but exposes it contextually.

### **Skeleton Mode** (Stage 2)

- **Unlock Key**: `skeletonMode`
- **Recommended Fit**:
  - **P**: Fill/Extended
  - **S**: Watch, Notes
- **Implementation Note**: Remove content words but keep function words visible. A powerful variant for `Fill` or `Extended` modes.

---

## 🧠 2. Metacognition

*Tools for self-reflection and analyzing learning patterns.*

### **Error Heatmap** (Stage 3)

- **Unlock Key**: `errorHeatmap`
- **Recommended Fit**:
  - **P**: Type
  - **S**: Fill/Extended
- **Implementation Note**: Visualizes spelling differences. Requires per-attempt error logging, not just "missed word" counts.

### **Weak Word Focus** (Stage 2)

- **Unlock Key**: `weakWordFocus`
- **Recommended Fit**:
  - **P**: Type, Speak, Global
  - **S**: Fill/Extended, Vocab
- **Implementation Note**: Generates a deliberate practice queue. Upgrades the existing "Related Questions" logic into a dedicated session.

### **Mastery Timeline** (Stage 3)

- **Unlock Key**: `masteryTimeline`
- **Recommended Fit**:
  - **P**: Vocab, Global
  - **S**: -
- **Implementation Note**: Shows history of a word's status. Needs event logging (date/quality) for reviews, not just current state snapshots.

### **Reflection Hub** (Stage 3)

- **Unlock Key**: `reflectionHub`
- **Recommended Fit**:
  - **P**: Type, Fill/Extended
  - **S**: Speak, Notes
- **Implementation Note**: "Post-game" analysis. Classify mistakes (e.g., Typo vs. Grammar) and suggest immediate actions (Review, Practice).

---

## 🌍 3. Context & Content

*Features that add richness, depth, or specific topical focus.*

### **Thematic Packs** (Stage 2)

- **Unlock Key**: `pack:<id>` (e.g., `pack:business`)
- **Recommended Fit**:
  - **P**: Type, Speak, Fill/Extended
- **Implementation Note**: Storage model: `unlockedPacks{}`. Requires tagging content in your database by topic (Business, Travel, etc.).

### **Collocation Master** (Stage 3)

- **Unlock Key**: `collocationMaster`
- **Recommended Fit**:
  - **P**: Vocab, Global
  - **S**: Type, Fill/Extended
- **Implementation Note**: Highlights common word pairings. Leverage existing `collocations.json` data structure.

### **Cultural Context** (Stage 2)

- **Unlock Key**: `culturalContext`
- **Recommended Fit**:
  - **P**: Watch
- **Implementation Note**: Pop-up explanations for idioms or cultural references. Needs a dedicated snippet dataset to be viable.

---

## 🎮 4. Engagement & Social

*Gamification elements to boost motivation and habit formation.*

### **Streak Freeze** (Stage 1)

- **Unlock Key**: `streakFreeze`
- **Recommended Fit**:
  - **P**: Vocab (Global context)
- **Implementation Note**: **Consumable**. Use `inventory{}` count in storage. Decrement on use to save a streak.

### **Avatar Mastery** (Stage 2)

- **Unlock Key**: `avatarMastery`
- **Recommended Fit**:
  - **P**: Global
- **Implementation Note**: Cosmectic unlock based on `Mastered` counts. Ties visual progress to actual learning stats.

### **Ghost Race** (Stage 3)

- **Unlock Key**: `ghostRace`
- **Recommended Fit**:
  - **P**: Type
  - **S**: Fill/Extended
- **Implementation Note**: Challenge your best time or a "ghost" speed. High value for typing fluency (WPM).

### **Global Leaderboard** (Stage 2)

- **Unlock Key**: `globalLeaderboard`
- **Recommended Fit**:
  - **P**: Global
- **Implementation Note**: Server-side feature. Requires robust anti-cheat and normalization logic. Group by weekly cohorts.

### **Turbo Review** (Stage 3)

- **Unlock Key**: `turboReview`
- **Recommended Fit**:
  - **P**: Vocab
- **Implementation Note**: A specialized review mode: keyboard-first, low friction, potential auto-advance.

---

## 📝 Implementation Notes

### 1. Consistent “Unlock Keys”

- Use **feature keys** (e.g., `shopModule.isModeUnlocked('wordGhost')`) consistent with how you check mode unlocks today.
- Only attach them to specific tabs if they are actual modes (like *Turbo Review*). Otherwise, they modify existing modes.

### 2. Storage Data Structures

- **Standard Features**: Store in `unlockedModes[]`.
- **Consumables**: Store in `inventory{}` (e.g., `{ streakFreeze: 3 }`).
- **Content Packs**: Store in `unlockedPacks{}`.

### 3. Analytics Requirements

- **Heatmaps & Timelines**: These require a new, append-only **event log**. You cannot build these effectively from just the current snapshot of user progress.

### 4. “Peek” vs. Hints

- clearly distinguish **Paid Features** from **Free Helpers**.
- *Example*: Free implementation uses simple formatting hints (length). Paid unlock adds a timed, specific "flash" of the answer (Peek).
