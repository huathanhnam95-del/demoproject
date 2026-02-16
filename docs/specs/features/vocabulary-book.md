# Vocabulary Book Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> The Vocabulary Book is the user's personal word list: they can **bookmark words**, track **frequently missed** words, and push words into the **SRS** so weak vocabulary becomes durable.

## 2. Goals (The "Why")

- Let users "capture" new vocabulary at the moment of need.
- Turn mistakes into a structured backlog (missed -> review -> mastered).
- Keep vocab management fast and accessible from any mode.

## 3. Requirements (The "What")

### Functional

- Bookmark words from practice modes and from "missed word" harvests.
- Maintain two key lists:
  - Bookmarks (user-curated)
  - Frequently missed (system-curated from errors)
- Integrate with SRS:
  - adding a word initializes SRS tracking for that lemma
  - SRS completion can promote a word to "mastered"
- Provide list management UI:
  - view/search/sort
  - remove from bookmarks

### Non-Functional

- Data must persist for authenticated users (Firestore).
- UI must remain usable even when offline (cached view; writes may queue).

## 4. Data & Contracts (The "Contract")

- UI/module: `public/vocab-book.js`
- Persistence:
  - Firestore-backed for logged-in users.
  - Local caches to support fast rendering and offline tolerance.
- SRS integration:
  - Calls into the SRS module to initialize cards for new words.

## 5. Rewards & Progression

- Vocab mastery can award points (e.g., mastering frequently missed words).
- Vocab actions should be low-friction and never interrupt a practice loop with heavy modals.

## 6. Verification

- Manual:
  - Bookmark a word -> confirm it appears in the bookmarks list.
  - Miss the same word multiple times -> confirm it becomes "frequently missed".
  - Start SRS review -> confirm bookmarked words are included.
