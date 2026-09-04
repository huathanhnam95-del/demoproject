# Echo Forge — Route, Acts & Stages Handoff

**Status as of 2026-09-04:** branching route and map screen shipped and green. Stage environments and movement are specified but not built.

Verification gate: `npm run verify:echo-forge` → **172 unit tests + 3 browser checks, all passing.**

---

## 1. What this work changed

Echo Forge used to be three Warden fights in a straight line. `wardenIndex` counted 0 → 1 → 2 and the player never chose anything about where they went.

It is now **three acts**. Each act is a stage with its own ordinary enemies, a small branching map the player routes through, and a **Warden as its boss**. Wardens stopped being the whole run and became the thing at the end of each act.

```
        ACT I · The Resonant Hall          ACT II · The Cinder Forge      ACT III · The Void Beneath
                                                                       
 entry ──┬── fight ──┬── fight ── BOSS      entry ──┬── … ── BOSS        entry ──┬── … ── BOSS
  fight  ├── rest  ──┤   cache               fight  │  Cinder Weaver      fight  │  Void Singer
         └── cache ──┴── rest                       └── …                        └── …
                       Echo Sentinel
```

| | Before | Now |
|---|---|---|
| Structure | 3 fights, fixed order | 3 acts × 4 floors, branching |
| Player agency | none | picks a node per floor |
| Enemies | 3 Wardens only | act minions + act bosses |
| Between fights | a reward card | reward, then a map |
| Non-combat | none | `rest` and `cache` nodes |

---

## 2. Where things stand

### Done

| Phase | What | Where |
|---|---|---|
| **1 — Route** | Pure route generation, act progression, `SELECT_NODE`, rest/cache, storage, resume | `core/route.js`, `core/run-reducer.js`, `core/run-contract.js`, `core/rewards.js`, `echo-forge-run-storage.js`, `echo-forge-bridge.js` |
| **2 — Map screen** | One act per screen, floors bottom-up, connectors, act header, node states | `visual/route-map.js`, `#map-select` in the shell, `.ef-map-*` CSS |

### Not done

| Phase | What | Notes |
|---|---|---|
| **3 — Stages** | Per-act environments: sky/ground/parallax layers, ambient drift, act title card | **All the data hooks already exist** — see §6 |
| **4 — Movement** | Combat spacing, camera push/pull | Needs a third transform channel — see §7 |

---

## 3. Architecture

```
public/js/echo-forge/
  core/route.js          NEW  route generation, act table, node vocabulary   (415 lines)
  core/run-reducer.js    route replaces linear wardenIndex                   (629 lines)
  core/run-contract.js   +6 run event types, map_pending, route validation   (88 lines)
  core/rewards.js        + applyRestEffect, deriveCacheOffer
  visual/route-map.js    NEW  renders one act's branches                     (194 lines)
  sandbox-entry.js       map screen wiring, node selection, encounter identity

public/js/                            (OUTSIDE the guarded tree)
  echo-forge-run-storage.js   persists route position, never the graph
  echo-forge-bridge.js        saves on run.node.entered / run.map.offered

public/css/echo-forge-sandbox.css     .ef-map-* block before the Responsive section
public/echo-forge-sandbox.html        <section id="map-select">
```

### Key entry points

| Function | File:line | Role |
|---|---|---|
| `generateRoute(seed, {floorsPerAct})` | [route.js:283](../../public/js/echo-forge/core/route.js) | The whole graph, pure from the seed |
| `nodeCombatProfile(node)` | [route.js:360](../../public/js/echo-forge/core/route.js) | **The single place fight difficulty is decided** |
| `getSuccessorIds(route, nodeId)` | [route.js:341](../../public/js/echo-forge/core/route.js) | What the map offers; what `SELECT_NODE` validates against |
| `SELECT_NODE` | [run-reducer.js:400](../../public/js/echo-forge/core/run-reducer.js) | Enters a chosen node |
| `CLAIM_REWARD` | [run-reducer.js:368](../../public/js/echo-forge/core/run-reducer.js) | Now opens the map instead of spawning a fight |
| `createResumedRunState(saved)` | [run-reducer.js:574](../../public/js/echo-forge/core/run-reducer.js) | Rebuilds the graph from the seed on resume |
| `renderRouteMap({...})` | [route-map.js](../../public/js/echo-forge/visual/route-map.js) | Pure DOM, holds no state |

### Flow

```
victory ─▶ reward_pending ─▶ CLAIM_REWARD ─▶ map_pending (availableNodeIds set)
                                              └─▶ SELECT_NODE
                                                   ├ fight/boss ─▶ spawn combat, 'active'
                                                   ├ rest       ─▶ heal, advance, back to map
                                                   └ cache      ─▶ 3-card offer, 'reward_pending'
```

Beating a `boss` advances the act (`run.act.completed` + `run.act.entered`). Beating the last act's boss ends the run in `victory`.

---

## 4. Invariants — break these and things fail in confusing ways

### The pinned spine

Node index `0` exists on every floor, is pinned by position (entry and middle floors open with a `fight`, boss floors hold the act Warden), and the edge `f{n}n0 → f{n+1}n0` is always emitted.

**Consequence: "always take the first node" is always a legal, fully deterministic path.** Both multi-fight browser checks walk exactly that path. If you change generation such that the spine breaks, those checks fail in ways that look unrelated to your change.

Asserted over 200 seeds in `tests/echo-forge/route.test.mjs`.

### No dead ends, structurally

Edge building runs two *unconditional* coverage passes — every source gets an out-edge, every target gets an in-edge — before any seeded variation. Dead ends are therefore impossible by construction, not merely untested. Keep both passes unconditional.

### Uniform difficulty is load-bearing right now

Every fight and boss shares `{ maxHp: 120, baseDamage: 20 }`. This is a deliberate deferral, **and it is what keeps `echo-forge-sandbox-browser-check.js:186` (`enemy.hp === 90` after one 100-score Precision Strike) passing regardless of which node is first.**

When you start tuning, that check is the first thing to re-examine.

### Purity and replay

Route generation hashes the seed inline — the same murmur idiom as `deriveRewardOffer` and `selectWardenMove`. **Never store an RNG object.** Run state must stay JSON-serializable and `replayRun` must reproduce final state exactly. There is a JSON round-trip assertion guarding this.

### The route is never persisted

Storage saves only *where the player stands* (`act`, `floor`, `nodeId`, `visitedNodeIds`, `floorsPerAct`). The graph is regenerated from the seed on resume, so a hand-edited `localStorage` blob cannot inject its own map. `run-storage-route.test.mjs` asserts an injected `route` is stripped both going in and coming out.

`floorsPerAct` is mirrored at the top level of run state precisely so a shortened route survives a reload — it lives in `route.floorsPerAct`, which storage never sees.

---

## 5. Constraints that will bite you

All verified against the tests. These are the ones that cost time when discovered late.

| Constraint | Where | Why it matters |
|---|---|---|
| `mastery` and `currency` are **bare-word bans** anywhere under `public/js/echo-forge/` | `integration-guardrails.test.mjs:19` | Catches comments and flavour text, not just imports. This is why the treasure node is called `cache` and its reward text says *"a sealed cache of resonance"*. |
| No `localStorage` / `sessionStorage` in that tree | `integration-guardrails.test.mjs:20` | All persistence lives in `public/js/echo-forge-run-storage.js`, one level out. |
| `@keyframes` / `requestAnimationFrame` banned **in the HTML shell only** | `integration-guardrails.test.mjs:36` | The CSS file is unconstrained. All animation goes there. |
| `presenter.js` must not match `/combat\s*=\|state\s*=\|dispatch\s*\(/i` | `visual-assets.test.mjs:120` | Substring, case-insensitive — even `const heroState =` fails. No scene or movement state may live in that file. |
| Combat event types frozen at **exactly 21** | `visual-contract.schema.json` (`minItems`/`maxItems`), `event-map.js` throws at module load | The run channel (`RUN_EVENT_TYPES`) has **no count pin** — that is where all six new events went, and where any future ones should go. |
| Asset ids are a closed set of 4 / 9 frames, cross-pinned in 6+ files | `asset-loader.js:3`, `build-visual-assets.mjs`, `visual-assets.test.mjs` | This work added **zero** image assets. Adding one is a multi-file change. |
| Enemy sprite `filter` is asserted per act theme | `pixel-sprites-browser-check.js:148/223-224/256-257` | Never add a `filter` to `.fighter.enemy .fighter-mark img` — it replaces the whole property. Atmospheric depth goes on scene layers or a wrapper. |
| Browser checks run at **360×800 with `reducedMotion:'reduce'`** | all three checks | Assert zero console errors, `scrollWidth <= innerWidth`, and every visible `button,select` ≥44px in **both** dimensions. |
| `.echo-visual-layer` is owned exclusively by `presenter.js` | `presenter.js:21`, its `::after` content is asserted | Do not repurpose it as a backdrop. |
| The sandbox page loads **only** `/css/echo-forge-sandbox.css` | shell `<head>` | The app's `.rpg-tree-*` map CSS in `style.css` is unreachable. Reuse techniques, not stylesheets. |

---

## 6. Phase 3 — Stages (next up)

Give each act its own environment. **Every data hook this needs is already being set**, at [sandbox-entry.js:297-301](../../public/js/echo-forge/sandbox-entry.js):

```js
root.dataset.warden   = act.colorToken;   // sentinel | cinder | void
root.dataset.act      = String(run.act);  // 0 | 1 | 2
root.dataset.stage    = act.stageId;      // resonant_hall | cinder_forge | void_beneath
root.dataset.nodeType = node.type;        // fight | rest | cache | boss
document.body.dataset.stage = act.stageId;
```

`data-warden` now names the **act theme** rather than a specific enemy, which is exactly why the per-Warden sprite-filter assertions still pass while ordinary minions share their act's look.

### The plan

1. **Layer scaffold** — one `.ef-scene` container as the first child of `.battle-stage`, holding six absolutely-positioned layers (`sky`, `far`, `mid`, `ground`, `motes`, `fore`). `z-index` 0 and below are unoccupied inside the stage (the stack is visual-layer 1 → fighter 2 → challenge 3 → damage 10), and `.echo-visual-layer` already proves `position:absolute; inset:0` works on a child of that grid without disturbing its three in-flow children.

2. **Depth, image-free** — stacked `radial-gradient` skies; hard-stop `linear-gradient`/`conic-gradient` silhouettes; the tiled dot-grid ground idiom proven at `style.css:16092`; a low-opacity foreground occluder, which is the strongest single depth cue.

3. **Parallax** — `transform: translate3d(calc(var(--ef-par-x,0) * <f>), …)` with factors `sky .05 / far .2 / mid .5 / ground .8 / motes 1.1 / fore 1.6`. Write `--ef-par-x` once on `.battle-stage`; custom properties inherit. Use a **transition, not an animation**, so the reduced-motion kill switch at `echo-forge-sandbox.css` snaps it correctly for free.

4. **Three stage themes**, keyed off `[data-stage]`, with `[data-node-type]` modulating rather than replacing them so rest and cache sites feel like quiet corners *of that act*.

5. **Act title card** on `run.act.entered` — the cheapest possible signal that the player crossed into a new part of the world.

6. **`visual/scene.js`** — a third listener alongside `presenter.js` and `juice.js`, binding both `echo-forge:event` and `echo-forge:run`. The run channel's detail already carries the full `runState`, so it needs no state of its own.

### Trap already hit and solved

`body::before` is the page-wide ambient wash and the right place to tint the whole screen per act. But it is a pseudo-element of `body`, while `data-warden` sits on `main#echo-forge-root` — a **child**. `#echo-forge-root[data-stage=…] body::before` cannot work, because a descendant's attribute cannot select an ancestor.

That is why `scene.js` must also set `document.body.dataset.stage` (already wired), with rules written `body[data-stage="cinder_forge"]::before { … }`.

### Also worth fixing while in there

`--bg-panel` and `--emerald` are referenced at `echo-forge-sandbox.css` lines 411/434/436/441/450/456 but **never defined**, so those declarations are dead today.

---

## 7. Phase 4 — Movement

**There are already two transform channels and they are deliberately separate:**

- `.fighter` carries `.ef-windup`/`.ef-lunge` (direct `transform` + transition) **and** `.ef-recoil` (a keyframe animation)
- `.fighter-mark` carries the infinite float loop

Adding spacing to either clobbers existing juice. Insert a `.fighter-slot` wrapper between them, wrapping only `.fighter-mark` so the name `<strong>` does not slide:

```css
.fighter-slot {
  transform: translateX(var(--ef-stance-x, 0)) scale(var(--ef-cam-scale, 1));
  transition: transform 320ms cubic-bezier(.2,.7,.3,1);
}
```

Three independent channels: `.fighter` (juice) → `.fighter-slot` (stance + camera) → `.fighter-mark` (float). Transition-based, so reduced motion snaps it.

**The enemy has never moved.** It is the clearest remaining "this is a diagram, not a fight" tell.

**Camera:** `--ef-cam-scale` on `.battle-stage`, consumed by `.ef-scene` and `.fighter-slot`. Shake must stay where it is — `.battle-stage.ef-shake` animates `transform` on the stage itself, so camera scale has to live one level in or it clobbers the shake.

**Reduced-motion trap:** under the kill switch, `animationend` never fires. Every cleanup path needs a `setTimeout` backstop plus an `isConnected` check, or orphaned nodes accumulate and trip the zero-console-errors assertion.

---

## 8. Bugs found and fixed in passing

Recorded because each was masked and could easily be reintroduced.

1. **`deriveRewardOffer` was never imported.** Called at `sandbox-entry.js:960`, but line 16 imported only `getRewardById` — a latent `ReferenceError` masked by a `savedRun.rewardOffer ||` short-circuit. It would have fired when a `reward_pending` save resumed without a stored offer.

2. **The abandon button was inert on non-combat screens.** It early-returned on `!combat`, so on the map screen it was visible and did nothing. It now dispatches `ABANDON_RUN`.

3. **The resume gate ignored map positions.** It accepted only `active` and `reward_pending`, so a save written while standing on the map was silently dropped and the resume button never appeared.

4. **`floorsPerAct` lived only inside `route`.** Storage reads it top-level, so a shortened route would not have survived a reload. It is now mirrored on run state.

---

## 9. Verifying

```bash
npm run verify:echo-forge
```

172 unit tests + 3 browser checks. Individually:

```bash
node --test tests/echo-forge/route.test.mjs
```

| Suite | Covers |
|---|---|
| `route.test.mjs` | Generation purity, the spine invariant over 200 seeds, the no-dead-ends proof, one boss per act, id positionality |
| `run-route.test.mjs` | `SELECT_NODE` guards, rest/cache behaviour, act advance, full three-act victory, replay exactness, resume, tampered-save rejection |
| `run-storage-route.test.mjs` | Position round-trip, graph never persisted, legacy migration, hostile input clamping |
| `echo-forge-run-browser-check.js` | Full three-act walk, map interaction, reload-on-map resume, touch targets, 360px overflow |
| `echo-forge-pixel-sprites-browser-check.js` | Per-act sprite treatment across all three acts |
| `echo-forge-sandbox-browser-check.js` | **Unchanged** — the first-fight baseline |

Both multi-fight browser checks shorten the route with `__ECHO_FORGE_TEST_HOOKS__.floorsPerAct = 2`, giving six encounters instead of nine or more. They walk the pinned spine by always clicking the first enabled node.

There is a local preview server for eyeballing changes:

```bash
node scripts/echo-forge/serve-sandbox.mjs
```

---

## 10. Open questions for whoever continues

1. **Run length.** At `FLOORS_PER_ACT = 4` ([route.js:42](../../public/js/echo-forge/core/route.js)) a full run is ~9 encounters. In a game where every turn involves speaking aloud, that may be too long. It is a single constant. This has not been playtested.

2. **Difficulty.** All fights are identical by decision. `nodeCombatProfile` is the seam. When it changes, re-check the `enemy.hp === 90` baseline.

3. **Elites.** Deliberately omitted. If added: keep `#enemy-name` to the existing Warden names and surface elite status through a separate badge, or the pixel-sprites name assertions break.

4. **Branch width.** Middle floors carry 2–3 nodes and adjacent floors are richly connected. Sparser edges would make routing a harder decision — but the two coverage passes must stay unconditional.

5. **Cache vs. fight rewards.** A cache drafts 3, a fight drafts 2, on different hash salts. Whether that is the right incentive gap is untested.
