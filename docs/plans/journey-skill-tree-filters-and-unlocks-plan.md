# Journey: Skill Tree Filters + Auto-Unlocks (Remove Shop Tab) — Execution Plan

Links:
- Spec: `docs/specs/journey-skill-tree-filters-and-unlocks.md`

## 0) Decisions (final)

- Skill Tree placement:
  - Put `length_filter` + `difficulty_filter` in the **Listening** branch as early QoL passives (ordered `length_filter` → `difficulty_filter`).
- Costs/requirements:
  - `length_filter`: Listening level 1, 80 coins
  - `difficulty_filter`: Listening level 1, 120 coins
- Guest Vocab Book:
  - Guest does **not** get vocab behaviors; on missed keywords show a **login nudge** (no add modal).
- Locked filter UX:
  - Filters are **hidden until unlocked**, then appear immediately.

## 1) Remove Shop tab (Journey == Skill Tree)

**Files**
- `public/index.html`
- `public/shop-module.js`
- `public/auth-ui.js`

**Steps**
- Update `#shop-modal` markup:
  - Remove the tab bar (`.shop-tabs`) and the `#shop-items-container` section.
  - Keep only the `#skill-tree-container` content (and ensure coin display remains somewhere in the Skill Tree header).
- Rename “SHOPPING” entry point in the account panel UI to “SKILL TREE” (or “JOURNEY”).
- Update `public/auth-ui.js` shopping card click handler to open the Skill Tree modal directly.
- In `public/shop-module.js`:
  - Make `openShop()` open the modal in Skill Tree view (or rename to `openJourney()` while keeping a back-compat alias).
  - Remove calls to `renderShop()` and any tab init logic that assumes Shop exists.

**Verify**
- Open account panel → click the card → modal opens to Skill Tree (no Shop tab visible).
- No console errors related to missing `#shop-grid`, tab buttons, or Shop DOM.

## 2) Add Length/Difficulty Filter as passive Skill Tree nodes

**Files**
- `public/js/skill-catalog.js`
- `functions/src/skillCatalog.js`
- `public/js/modules/level-system.js`

**Steps**
- Add passive skill definitions:
  - `length_filter` and `difficulty_filter` with title/desc/tree/level/cost.
- Add icons + layout wiring:
  - Add entries in `SKILL_ICONS`.
  - Add nodes to `BRANCH_LAYOUT` for the chosen branch.
  - Add coordinates in `TREE_LAYOUT_MOCK`.
  - Add edges in `TREE_EDGES_MOCK` as a side branch off `root_listening`.
- Back-compat for existing purchasers:
  - Extend `LevelSystem.hasUnlockedSkill()` to treat legacy `userProfile.unlockedModes.includes('lengthFilter'|'difficultyFilter')` as unlocked for the new passive IDs.

**Verify**
- Logged-in user sees the new nodes in the Skill Tree.
- A user with legacy `unlockedModes` for filters shows these nodes as unlocked (no repurchase).

## 3) Rewire filter gating to the Skill Tree passives

**Files**
- `public/script.js` (Length filter + lock visuals)
- `public/difficulty-filter.js`
- `public/shop-module.js` (skill purchase flow → UI refresh hooks)

**Steps**
- Replace `shopModule.isModeUnlocked('lengthFilter')` checks with a single helper:
  - `isLengthFilterUnlocked()` → checks Skill Tree passive (`length_filter`) using the current user profile snapshot (and legacy mapping).
- Replace `shopModule.isModeUnlocked('difficultyFilter')` checks similarly.
- Update “unlock” nudges:
  - Where the code currently calls `openShop()` for a locked feature, redirect to opening the Skill Tree modal and (if feasible) focusing the relevant node.
- Make filter UI react immediately after purchase:
  - Emit a `CustomEvent` on successful skill unlock (e.g., `skill-unlock` with `{ skillId }`).
  - Update filter modules to listen for that event and call `refreshLengthFilterLocks()` / `DifficultyFilter.updateFilterVisibility()`.

**Verify**
- Before unlock: filter UI is hidden per decision.
- After unlock: filter UI becomes usable without a hard reload.

## 4) Remove Vocab Book purchase unlock; auto-unlock on first missed keywords + tutorial

**Files**
- `public/vocab-book.js`
- `public/vocab-tutorial.js`
- (optional) `public/script.js` (only if the “missed keywords” signal needs to be narrowed to Type/Speak)

**Steps**
- Define canonical unlock state:
  - Keep using `vocabularyBookUnlocked` (already referenced) or introduce a new canonical flag, but ensure reads are consistent.
- Implement auto-unlock at the vocab choosing panel entry:
  - In `VocabularyBook.showAddModal(missedWords, questionId, mode, sentence)`:
    - Only for `mode ∈ { type, speak }` and `missedWords.length > 0`
    - If logged in and not yet unlocked, set unlock flag in Firestore (best-effort; proceed even if write fails).
    - Show the modal and ensure Vocab panel toggle is revealed for future.
  - Remove (or refactor) the hard “return early if not unlocked” gating in `showAddModal`.
- Update Vocab panel toggle behavior:
  - Replace “open Shop to unlock” behavior with:
    - if still locked: show a small info modal/toast describing the auto-unlock rule, and/or open Skill Tree if you decide to add a Vocab-related node later.
- Add tutorial:
  - Create a new tutorial id (e.g., `vocabAddModalIntro`) in `public/vocab-tutorial.js`.
  - Tutorial targets:
    - `#vocab-add-modal` (intro)
    - word checkbox list items in `#vocab-add-words`
    - `#vocab-add-btn` (“Add selected”)
    - `#vocab-panel-toggle` (where to review later)
  - Trigger it the first time the modal appears during the unlock moment.

**Verify**
- Logged-in: miss keywords in Type/Speak → modal opens → tutorial plays once → subsequent misses do not replay (unless forced).
- Guest: on missed keywords, see the agreed UX (login nudge or local-only behavior).

## 5) Survival Mode always available; remove unlock surface

**Files**
- `public/shop-module.js`
- (search-driven) any file checking `isModeUnlocked('survival')`

**Steps**
- Remove the Survival item from any Shop inventory surface (since Shop UI is removed).
- Ensure any survival access checks (if any exist) default to “available”.

**Verify**
- Survival mode card launches the game on desktop regardless of unlock state.

## 6) Documentation updates

**Files**
- `docs/specs/new-user-workflow.md` (remove references to shop unlocking Vocab Book / Survival / filters)
- Any other docs that describe “Shop tab” as a user flow entry point

**Steps**
- Update diagrams/text to reflect:
  - Journey modal is Skill Tree only
  - Vocab Book unlock is contextual (first missed keywords in Type/Speak)
  - Survival Mode is default
  - Filters unlock via Skill Tree nodes

**Verify**
- Manual doc scan: no “unlock in Shop” references for the moved/removed items.

## 7) Final verification (manual + lint)

**Manual checklist**
- Fresh logged-in user:
  - Journey opens to Skill Tree only
  - Filters locked → unlock via Skill Tree → filters usable
  - First missed keywords in Type/Speak triggers Vocab modal + tutorial
  - Survival mode accessible
- Legacy user (has `unlockedModes` for filters):
  - Filters work without repurchasing
  - Skill Tree nodes render as unlocked

**Commands**
- `npm run lint`
