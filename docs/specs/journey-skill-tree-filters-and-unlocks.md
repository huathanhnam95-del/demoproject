# Journey: Skill Tree Filters + Auto-Unlocks (Remove Shop Tab) — Spec

**Status**: Draft **Owner**: Admin

## 1. Overview

Replace the “Shop” surface inside **Your Journey** with a **Skill Tree–only** experience, and re-home (or remove) the remaining shop-gated features:

- **Length Filter** and **Difficulty Filter** become **Skill Tree passive nodes**.
- **Vocab Book** is no longer purchased/unlocked; it **auto-unlocks** the first time a user misses **keywords** in **Type** or **Speak**, and plays a tutorial when the **vocab choosing panel** appears.
- **Survival Mode** is available **by default** (no unlock).
- The **Shop tab** is removed from the Journey modal (and any “Shopping” entry points are renamed to Skill Tree/Journey).

This is primarily a UX coherence change: progression lives in the Skill Tree, while “necessary” features unlock contextually.

## 2. Goals (The “Why”)

- Reduce confusion: remove a mostly-empty Shop tab and consolidate progression in the Skill Tree.
- Make practice controls feel like progression: Length/Difficulty filters are earned as QoL passives.
- Remove friction: Vocab Book appears naturally when it’s first needed (missed keywords), with guidance.
- Ensure Survival Mode is discoverable and not accidentally gated.

## 3. Requirements (The “What”)

### 3.1 Journey Modal (Remove Shop Tab)

- [ ] Remove the **Shop** tab from the Journey modal UI.
- [ ] The modal opens directly to the **Skill Tree** content.
- [ ] Any entry point labeled “SHOPPING” is renamed to **Skill Tree** (or **Journey**) and opens the Skill Tree modal.
- [ ] No UI should reference buying/unlocking “shop items” for the features in this spec.

### 3.2 Length Filter + Difficulty Filter → Skill Tree

#### New passive skills

- [ ] Add passive Skill Tree nodes (Listening branch):
  - [ ] `length_filter` — unlocks sentence length filtering in **Type + Speak** (Listening level 1, 80 coins)
  - [ ] `difficulty_filter` — unlocks difficulty filtering in **Type + Speak + Fill** (Listening level 1, 120 coins; requires `length_filter`)
- [ ] Each node has:
  - [ ] a branch (`tree`) placement in the existing 4-branch Skill Tree (Listening)
  - [ ] a level requirement and coin cost
  - [ ] an icon and description

#### Gating behavior

- [ ] If the user has not unlocked the node:
  - [ ] the corresponding filter UI is hidden until unlocked.
- [ ] If the user unlocks the node:
  - [ ] the filter UI becomes available immediately (no refresh required).
  - [ ] existing per-user selection persistence continues to work (localStorage keys may remain).

#### Back-compat / migration

- [ ] Users who previously purchased `unlockedModes: ['lengthFilter', 'difficultyFilter']` must retain access:
  - [ ] they are treated as having `length_filter` / `difficulty_filter` unlocked.
  - [ ] no additional coin spend is required to keep access.

### 3.3 Vocab Book Auto-Unlock + Tutorial (Vocab Choosing Panel)

#### Auto-unlock trigger

- [ ] Remove the “Vocab Book” purchase/unlock requirement.
- [ ] Auto-unlock occurs the first time the user:
  - [ ] is practicing in **Type** or **Speak**, and
  - [ ] misses **keywords** (use the existing “missed content words” signal), and
  - [ ] the app is about to show the **vocab choosing panel** (the “Add to Vocabulary” modal).
- [ ] On auto-unlock:
  - [ ] show the vocab choosing panel as normal.
  - [ ] reveal the Vocab Book UI entry point (panel toggle) for future use.
  - [ ] persist unlocked state for logged-in users.

#### Tutorial

- [ ] When the vocab choosing panel is shown for the first time (unlock moment), a tutorial runs:
  - [ ] explains selecting words and saving them
  - [ ] explains where to find the saved words afterward (Vocab panel)
  - [ ] is dismissible and does not block the modal’s controls
  - [ ] runs once by default; replay can be forced via tutorial controls (existing pattern)

#### Guest behavior

- [ ] Guests do not get Vocab Book behaviors:
  - [ ] do not show the vocab choosing panel
  - [ ] do not track missed/correct words
  - [ ] show a login nudge (at most once per session) when the panel would otherwise appear

### 3.4 Survival Mode Available by Default

- [ ] Survival Mode is not unlock-gated anywhere in the UI.
- [ ] Any legacy shop data (`unlockedModes.includes('survival')`) is ignored for access decisions.

### 3.5 Deprecations / Cleanup

- [ ] Remove Shop inventory surface for: `lengthFilter`, `difficultyFilter`, `vocabBook`, `survival`.
- [ ] Keep legacy fields/arrays only as long as required for back-compat, but ensure they no longer drive the primary UX.

### 3.6 Skill Tree Mobile Navigation (Zoom + Pan)

- [ ] Skill Tree supports viewport controls with explicit limits:
  - [ ] zoom out / zoom in / reset controls are visible in the tree UI
  - [ ] zoom is clamped to **50% â†’ 150%**
- [ ] Touch and pointer navigation are supported:
  - [ ] drag/pan on empty tree space
  - [ ] panning has momentum/inertia decay after release for map-like movement
  - [ ] two-finger pinch to zoom on touch devices
  - [ ] mouse wheel zoom remains supported on desktop
- [ ] Mobile-first layout quality:
  - [ ] branch tabs remain horizontally scrollable and tappable
  - [ ] zoom controls are finger-friendly (minimum tap target sizing)
  - [ ] tree viewport starts in a fitted, readable position (root node not clipped)
  - [ ] users can reset to fitted view at any time

## 4. Interface / Data Contract (The “Contract”)

### 4.1 New passive skill IDs

```ts
type PassiveSkillId = 'length_filter' | 'difficulty_filter';
```

### 4.2 Legacy → new mapping (back-compat)

```ts
const LEGACY_UNLOCKED_MODE_TO_PASSIVE_SKILL: Record<string, PassiveSkillId> = {
  lengthFilter: 'length_filter',
  difficultyFilter: 'difficulty_filter'
};
```

### 4.3 Vocab Book unlocked state (logged-in users)

Persist a boolean (or timestamp) to the user document (name TBD):

```ts
interface UserProfile {
  vocabularyBookUnlocked?: boolean; // legacy name exists in codebase
  vocabBookAutoUnlocked?: boolean;  // optional new canonical field
  vocabBookUnlockedAt?: string;     // optional ISO timestamp
}
```

The implementation should choose one canonical field and migrate/alias as needed.

## 5. Taste Invariants (The “How”)

- No “AI slop”: don’t leave dead Shop code paths wired to UI elements that no longer exist.
- Keep the Skill Tree as the single progression surface (Journey == Skill Tree).
- Favor explicit, centralized “isFeatureUnlocked” checks rather than scattered ad-hoc gating.
- Backward compatible: purchased filters continue to work with no surprises.
- Tutorials must not trap the user in a non-dismissible state.

## 6. Decisions (Resolved)

- `length_filter` and `difficulty_filter` are **passive** nodes in the **Listening** skill tree, ordered `length_filter` → `difficulty_filter`.
- Both filters are **early QoL unlocks** (Listening level 1) with low coin costs (80 / 120).
- Locked filters are **hidden** until unlocked, then appear immediately.
- Guests do not get Vocabulary Book behaviors; the app shows a one-time login nudge when missed keywords would trigger the panel.

## 7. Acceptance Criteria (Definition of Done)

- [ ] Journey modal has no Shop tab; opens directly to Skill Tree.
- [ ] Length Filter + Difficulty Filter unlock via Skill Tree passives and gate UI correctly.
- [ ] Existing users with legacy purchased filters retain access without repurchasing.
- [ ] Vocab Book unlock is automatic on first Type/Speak missed keywords; vocab choosing panel appears and plays tutorial once.
- [ ] Survival Mode is accessible by default.
- [ ] Skill Tree supports zoom + drag + pinch (plus inertia pan) with 50â€“150% bounds and usable mobile controls.
- [ ] No console errors in the above flows (guest + logged-in).
