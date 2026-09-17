# BEL "Working as Equals" — Claude 3D asset pack, Batch 3 (`batch-3-v1`)

**What this is:** the final asset batch. It adds the three rooms that were still missing — **Home, the Street and Reception** — the **greeting**, **holding hands** and the **two rides**, and the reference layouts for the rooms that were only waiting on existing parts (**B2, B3, studios A, C and E**).

With this pack **all fourteen reference rooms assemble** and **the animation set is complete**: nothing is left on the asset side.

Everything from the approved `batch-2-v1` is unchanged and still passes. Delivered as a Three.js module pack (`THREE_MODULE`). No Blender, no GLB.

**What this is not:** it is not the game and not an approval. Gemini's intake, application integration (ART-09, ART-10) and your visual approval are still outstanding. Actual results are in [`evidence/asset-audit.md`](evidence/asset-audit.md).

## The complete animation set (14 clips)

| Clip | Duration | Notes |
|---|---|---|
| `Idle` | 3.2 s | grounded breathing loop |
| `Walk` | 0.4 s | in place, 0.864 u per cycle at the unchanged 108 px/s |
| `CarryIdle` / `CarryWalk` | 3.2 s / 0.4 s | carrying is never slower than walking |
| `SeatedIdle` | 3.6 s | hips on the 0.36 cushion, feet flat on the floor |
| **`Wave`** | **2.2 s** | **plays once** — the same 2200 ms the host's `waveUntil` allows. Starts and ends on the exact Idle frame, so it blends away without a pop. |
| **`HandholdIdle_L` / `_R`** | 3.2 s | the held hand sits on a join point half way to the partner |
| **`HandholdWalk_L` / `_R`** | 0.4 s | **same travel per cycle as Walk** — holding hands is never slower |
| **`ScooterIdle` / `ScooterRide`** | 3.0 s / 0.9 s | coasting and moving, both hands on the handlebar |
| **`SkateboardIdle` / `SkateboardRide`** | 3.0 s / 0.9 s | coasting and moving, arms counterbalancing |

- **`Wave` is the first clip with `loop: false`.** Read `CLIP_INFO[name].loop` instead of assuming `LoopRepeat`. That is the only interface note for this batch.
- **Holding hands is a pair of clips, not one.** The host re-anchors a pair 32 logical px apart, so the partner stands 0.64 to the character-**left**: give the leader `_L` and the follower `_R`. Measured in Chrome: the two joined hands end up **39 mm apart** standing and 66 mm walking.
- **Riding does not fake a stride.** The 2D renderer changes the arms and the lean when you ride, never the legs, because the object rolls. The clips do the same and say so in `CLIP_INFO[name].contact`; no clip claims a planted foot it does not have.
- Measured: the rider's soles sit exactly on the 0.12 deck, both hands stay within **9 cm** of the handlebar line, and no clip moves the root.

## New assets (15 ids)

| Asset | Source | Notes |
|---|---|---|
| `prop.scooter`, `prop.skateboard` | `sprites.mjs ride()` | The deck (56 px), the axle spacing (±23 px) and the stem height (49 px) are its own rectangles × 0.02; every colour is one of its constants. `socket_rider` and `socket_grip` are exposed. `{ stand: true }` adds the painted timber stand a parked ride rests on. |
| `prop.wardrobe`, `prop.bookcase`, `prop.side-table` | `scenes.mjs home.solids` | Book spines are plain colour blocks in the sampled spine colours — no title, letter or number. |
| `prop.reception-counter`, `prop.waiting-bench` | `scenes.mjs reception.solids` | Working surfaces only; no leaflet, notice or lettering. |
| `prop.sign-board` | the two painted boards | **Blank by design.** `socket_legend` marks the face the host may draw its own wording on, exactly as slide text stays off the studio monitor. |
| `street.building`, `street.road`, `street.crossing` | `street.floor`, `carsAt()`, the `bel` door target | The carriageway is derived from the traffic itself — sized to contain both `carsAt()` lanes — and the crossing is centred on the existing door target, not on a guessed spot. |
| `prop.car` × 2 | `simulation.mjs carsAt()` | The two bodies only. **x is a function of the clock and belongs to the host**; the placement records the lane. The lamps are painted, never emissive. |
| `prop.house`, `prop.street-bench`, `prop.hedge` | `street.solids`, the painted frontage planting | |

## All fourteen rooms assemble

| Room | Components | Room | Components |
|---|---|---|---|
| Home | 14 | Studio A | 23 |
| Street | 12 | Studio C | 21 |
| Reception | 16 | Studio E | 21 |
| Route B1 / B2 / B3 | 20 each | Room F | 23 |
| Gallery D | 19 | Studio G | 21 |
| Room I | 17 | Room J | 21 |

`tools/build-assembly.mjs` generates all fourteen from the baseline rectangles, and every entry records its `source` rect or says it is an `authored` visual choice. **A / C / E / G now share one code path** (they come from the same `studio()` factory in the source) and **B1 / B2 / B3 share another**, so the reference rooms cannot drift apart from each other. Gemini still owns real placement, collision and state.

One honest caveat: a tall object's logical rectangle folds its painted height into its depth in the 2D projection, so a wardrobe's `depth` and `height` are authored and the assembly entry says so on every such placement. Only its width and x come from the source.

## Look at it

Double-click **`open-preview.bat`**, or run `node tests/static-server.mjs 8766` and open `http://127.0.0.1:8766/preview/`.

All fourteen rooms are on the room bar; each is built the first time you open it. **Home** parks the scooter and the skateboard and puts two people on them; **Street** shows a rider, a hand-holding pair, the crossing and the traffic; **Reception** shows the greeting and a hand-holding pair walking. The **Cast**, **Faces** and **Carry + seated** cameras now follow whoever is on stage in the room you are looking at.

## Checks

| Gate | Result |
|---|---|
| Source fidelity | **83/83** |
| Contract + art-direction tests | **46/46** |
| Negative controls (injected defects caught) | **29/29** |
| Headed Chrome, root + nested paths | **22/22** |
| Integrated game acceptance | **BLOCKED** — Gemini's |
| Your visual approval | **NOT_RUN** |

The negative controls now cover **Gate A as well as Gate B**: five injected drifts (a moved ride target, a shortened greeting, a widened pair gap, a drifted car colour, a resized deck) each make the named source-fidelity check fail, so the 83 fidelity checks are demonstrably not decorative.

## Reproduce

```bash
node tools/run-evidence.mjs "<path to a worktree containing commit 249a8fc86>"
```

## Two things you spotted, and what changed

**The plank was clipping.** A placed plank was being laid 88 mm *below* the floor so its top sat flush. Six planks at the source pitch run 1.92 deep across a 1.60 channel, so the two end planks have to overlap the banks — and sunk, they were buried in them. `F-complete.png` paints all six whole and lying on top, which is also what a plank across a trench actually does. The plank pivot is its underside, so the rest height is simply **y = 0**; the assembly now states that as `planks.restY` with the reasoning, a test asserts the run covers the channel with no hole and that an end plank overlaps a bank by more than 0.1, and a negative control proves that sinking one fails the suite.

**The Room I statements stay on screen.** They must: it is a five-second timed reading task that the player has to move during, so the wording has to stay legible at any camera angle and must never sit on the floor or over the two regions. The right shape is the one the 2D game already uses — a fixed card near the top of the frame, **not** a modal (a modal would block the view and the movement it is timing) and **not** projected onto a wall or the monitor (unreadable at the game camera, and this pack ships no text). So `assembly/room-i.mjs` now carries a `hud` block with the existing rectangles: the statement card at logical `384,39,191,77` (38.4 % / 8.1 % of the viewport, wrap width 182, line height 14), the reveal highlight at `125|571,185,305,186`, and a note that the per-player feedback line stays in the existing `#prompt` element. Three fidelity checks re-read those numbers from `activity-renderer.mjs`, and one asserts the assembly records *where* the statement goes and never *what it says*.

## Open items

1. **Your visual approval** of the three rooms and the four new pose families.
2. Gemini still has not confirmed the pin, interface, scale or the v2 socket moves.
3. Licence for the new assets is still unresolved.

There is no item 4: the asset backlog is empty.

## Provenance and licence

Written as code by Claude (Anthropic). No third-party art, textures, fonts or models; no Vesper pixels or assets. **The pack contains no photograph, no slide text, no activity wording, no sign legend and no answer key** — colours, marks, shapes and boundaries only. Colours are medians of documented rects in the baseline art, or constants read straight out of `world/sprites.mjs`; identities and placements come from the baseline code. **Licence unresolved** — the project owner assigns it. `preview/vendor/three-0.186.0/` is three.js (MIT), preview and tests only.
