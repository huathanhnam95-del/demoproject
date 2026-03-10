# Preloader Visual Upgrade Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Replace the brittle BEL cinematic preloader with a production-safe, higher-quality 3D intro that remains visible, exits cleanly, and degrades gracefully.

**Architecture:** Split deterministic timing and camera-phase logic into a small pure module that can be unit tested without DOM or WebGL. Keep the browser-facing Three.js module responsible for scene creation, animation, and teardown, but remove the runtime font dependency by building the BEL mark from procedural geometry and pairing it with a CSS fallback overlay.

**Tech Stack:** Vanilla JS modules, Three.js via import map, Node-based test scripts, CSS animations

---

### Task 1: Add failing tests for preloader motion and completion logic

**Files:**
- Create: `tests/preloader-3d-core.test.mjs`
- Create: `public/js/preloader-3d-core.js`

**Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import {
  PRELOADER_DURATION_MS,
  getAnimationPhase,
  getCameraPose,
  shouldFinishPreloader
} from '../public/js/preloader-3d-core.js';

assert.equal(PRELOADER_DURATION_MS, 4200);
assert.equal(getAnimationPhase(0.1), 'approach');
assert.equal(getAnimationPhase(0.5), 'hero');
assert.equal(getAnimationPhase(0.95), 'resolve');

const pose = getCameraPose(0.5);
assert.equal(typeof pose.position.x, 'number');
assert.equal(typeof pose.lookAt.z, 'number');

assert.equal(shouldFinishPreloader({ progress: 1, appReady: true, logoReady: true }), true);
assert.equal(shouldFinishPreloader({ progress: 1, appReady: true, logoReady: false }), false);
```

**Step 2: Run test to verify it fails**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: FAIL with module or export errors because `public/js/preloader-3d-core.js` does not exist yet.

**Step 3: Write minimal implementation**

Create `public/js/preloader-3d-core.js` with exported constants/functions for phase selection, camera pose calculation, and finish gating.

**Step 4: Run test to verify it passes**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: PASS with a short success message.

**Step 5: Commit**

```bash
git add tests/preloader-3d-core.test.mjs public/js/preloader-3d-core.js
git commit -m "test: cover preloader timing logic"
```

### Task 2: Replace fragile text loading with procedural 3D logo rendering

**Files:**
- Modify: `public/js/preloader-3d.js`
- Modify: `public/index.html`

**Step 1: Write the failing test**

Extend `tests/preloader-3d-core.test.mjs` with assertions that hero-phase camera movement stays within expected bounds and that finish gating waits for both app readiness and logo readiness.

**Step 2: Run test to verify it fails**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: FAIL due to missing bounds/phase behavior in the core helper implementation.

**Step 3: Write minimal implementation**

Refactor `public/js/preloader-3d.js` to:
- import the pure helpers from `public/js/preloader-3d-core.js`
- build a BEL mark from grouped box geometries instead of loading a remote font
- add stronger lighting, glow layers, and smoother camera movement
- expose a safe fallback path when WebGL setup fails

Update `public/index.html` so the preloader includes a semantic fallback BEL wordmark and a subtitle/status container that still looks intentional if the canvas path fails.

**Step 4: Run test to verify it passes**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/preloader-3d.js public/index.html tests/preloader-3d-core.test.mjs public/js/preloader-3d-core.js
git commit -m "feat: rebuild cinematic preloader scene"
```

### Task 3: Fix preloader layering and presentation styling

**Files:**
- Modify: `public/style.css`

**Step 1: Write the failing test**

Add a focused assertion block in `tests/preloader-3d-core.test.mjs` covering the expected phase ordering that the CSS/DOM presentation depends on.

**Step 2: Run test to verify it fails**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: FAIL if the phase thresholds or finish timing drift from the intended visual sequence.

**Step 3: Write minimal implementation**

Update `public/style.css` to:
- place `.three-container` above the preloader background
- style the overlay as a cinematic HUD rather than plain app text
- add gradient/vignette/background glow layers
- ensure fallback wordmark and status text remain legible on black

**Step 4: Run test to verify it passes**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add public/style.css tests/preloader-3d-core.test.mjs
git commit -m "style: polish cinematic preloader presentation"
```

### Task 4: Verify integration and teardown behavior

**Files:**
- Modify: `public/js/preloader-3d.js` (if cleanup gaps remain)
- Verify: `public/script.js`

**Step 1: Write the failing test**

Add assertions proving the finish gate requires `progress >= 1`, `appReady`, and `logoReady`.

**Step 2: Run test to verify it fails**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: FAIL if finish logic is overly eager.

**Step 3: Write minimal implementation**

Tighten the finish logic in `public/js/preloader-3d.js` so the loader only exits after the cinematic sequence has completed and scene assets are ready, while still falling back to the existing non-Three.js dismissal path when necessary.

**Step 4: Run test to verify it passes**

Run: `node tests/preloader-3d-core.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add public/js/preloader-3d.js tests/preloader-3d-core.test.mjs
git commit -m "fix: harden preloader completion gating"
```
