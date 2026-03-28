# Journey: Progress Roadmap Filters + Auto-Unlocks

**Status**: Draft **Owner**: Admin

## 1. Overview

Replace the old shop-driven Journey flow with a progression roadmap experience. Core filters and assist features unlock automatically as the user practices and earns XP:

- `length_filter` and `difficulty_filter` unlock from Listening progression.
- `Vocab Book` auto-unlocks the first time a user misses keywords in Type or Speak, and shows the vocab choosing panel tutorial when that panel appears.
- `Survival Mode` is available by default.
- The Journey modal opens on the roadmap, not a purchase surface.

This is a UX coherence change: progression lives in the roadmap, while important practice helpers unlock contextually through practice XP.

## 2. Goals

- Reduce confusion by removing shop language from Journey.
- Make practice controls feel like progression rather than purchases.
- Remove friction by showing Vocab Book when it is first needed.
- Ensure Survival Mode is discoverable and not accidentally gated.

## 3. Requirements

### 3.1 Journey Modal

- [ ] Remove all purchase/shop language from the Journey modal.
- [ ] The modal opens directly to the progress roadmap content.
- [ ] Any old shopping entry point is renamed to Journey or Progress Roadmap.
- [ ] No UI should reference buying features for the items in this spec.

### 3.2 Length Filter + Difficulty Filter

#### Unlock behavior

- [ ] Add automatic progression unlocks for the Listening branch:
  - [ ] `length_filter`
  - [ ] `difficulty_filter`
- [ ] Each node has:
  - [ ] a branch placement in the roadmap
  - [ ] an XP threshold
  - [ ] an icon and description

#### Gating behavior

- [ ] If the user has not unlocked the node:
  - [ ] the corresponding filter UI is hidden or disabled until unlocked.
- [ ] If the user unlocks the node:
  - [ ] the filter UI becomes available immediately.
  - [ ] existing per-user selection persistence continues to work.

#### Back-compat / migration

- [ ] Users who previously had `lengthFilter` / `difficultyFilter` access must retain access:
  - [ ] they are treated as having `length_filter` / `difficulty_filter` unlocked.
  - [ ] no manual purchase flow is required to keep access.

### 3.3 Vocab Book Auto-Unlock + Tutorial

#### Auto-unlock trigger

- [ ] Remove any Vocab Book purchase requirement.
- [ ] Auto-unlock occurs the first time the user:
  - [ ] is practicing in Type or Speak, and
  - [ ] misses keywords, and
  - [ ] the app is about to show the vocab choosing panel.
- [ ] On auto-unlock:
  - [ ] show the vocab choosing panel as normal.
  - [ ] reveal the Vocab Book entry point for future use.
  - [ ] persist unlocked state for logged-in users.

#### Tutorial

- [ ] When the vocab choosing panel is shown for the first time, a tutorial runs:
  - [ ] explains selecting words and saving them
  - [ ] explains where to find saved words afterward
  - [ ] is dismissible and does not block the panel controls
  - [ ] runs once by default; replay can be forced via tutorial controls

#### Guest behavior

- [ ] Guests do not get Vocab Book behaviors:
  - [ ] do not show the vocab choosing panel
  - [ ] do not track missed/correct words
  - [ ] show a login nudge at most once per session when the panel would otherwise appear

### 3.4 Survival Mode Available by Default

- [ ] Survival Mode is not unlock-gated anywhere in the UI.
- [ ] Any legacy unlock data for Survival is ignored for access decisions.

### 3.5 Deprecations / Cleanup

- [ ] Remove any remaining roadmap inventory surface for old purchase items.
- [ ] Keep legacy fields and arrays only as long as required for back-compat, but ensure they no longer drive the primary UX.

### 3.6 Roadmap Mobile Navigation

- [ ] Roadmap supports viewport controls with explicit limits:
  - [ ] zoom out / zoom in / reset controls are visible in the tree UI
  - [ ] zoom is clamped to 50% to 150%
- [ ] Touch and pointer navigation are supported:
  - [ ] drag/pan on empty roadmap space
  - [ ] panning has momentum/inertia decay after release
  - [ ] two-finger pinch to zoom on touch devices
  - [ ] mouse wheel zoom remains supported on desktop
- [ ] Mobile-first layout quality:
  - [ ] branch tabs remain horizontally scrollable and tappable
  - [ ] zoom controls are finger-friendly
  - [ ] tree viewport starts in a fitted, readable position
  - [ ] users can reset to fitted view at any time

## 4. Interface / Data Contract

### 4.1 New passive skill ids

```ts
type PassiveSkillId = "length_filter" | "difficulty_filter";
```

### 4.2 Legacy to new mapping

```ts
const LEGACY_UNLOCKED_MODE_TO_PASSIVE_SKILL: Record<string, PassiveSkillId> = {
  lengthFilter: "length_filter",
  difficultyFilter: "difficulty_filter"
};
```

### 4.3 Vocab Book unlocked state

Persist a boolean or timestamp to the user document:

```ts
interface UserProfile {
  vocabularyBookUnlocked?: boolean;
  vocabBookAutoUnlocked?: boolean;
  vocabBookUnlockedAt?: string;
}
```

The implementation should choose one canonical field and migrate or alias as needed.

## 5. Taste Invariants

- Do not leave dead shop code paths wired to UI elements that no longer exist.
- Keep the roadmap as the single progression surface.
- Favor explicit, centralized `isFeatureUnlocked` checks rather than scattered ad hoc gating.
- Backward compatible: previously unlocked filters continue to work.
- Tutorials must not trap the user in a non-dismissible state.

## 6. Decisions

- `length_filter` and `difficulty_filter` are passive nodes in the Listening roadmap.
- Both filters are early QoL unlocks.
- Locked filters are hidden until unlocked, then appear immediately.
- Guests do not get Vocabulary Book behaviors; the app shows a one-time login nudge when missed keywords would trigger the panel.

## 7. Acceptance Criteria

- [ ] Journey modal has no shop tab; it opens directly to the roadmap.
- [ ] Length Filter and Difficulty Filter unlock through progression and gate UI correctly.
- [ ] Existing users with legacy filter access retain it without manual repurchasing.
- [ ] Vocab Book unlock is automatic on first Type/Speak missed keywords; vocab choosing panel appears and plays tutorial once.
- [ ] Survival Mode is accessible by default.
- [ ] Roadmap supports zoom, drag, and pinch with usable mobile controls.
- [ ] No console errors in the above flows for guest and logged-in users.
