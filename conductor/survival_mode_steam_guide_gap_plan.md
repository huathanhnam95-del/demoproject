# Survival Mode: Steam Guide Gap Plan
Last updated: 2026-02-09

Source reference: `C:\Users\Admin\.gemini\antigravity\brain\0956a344-362c-4ce4-b4bb-a53b4d652c7c\steam_guide_scrape.md.resolved`

## What The Guide Describes (High Level)
1. Primary weapon + secondary weapons.
2. Level-ups offer upgrades and secondary weapons.
3. Enemies drop timed items: Loot, Shield, Freeze, Double Damage, Reroll, Health.
4. Loot opens a separate "Loot Upgrades" page with category upgrades (Heat, D.O.T, drop rates).
5. Weapons have classifications (ex: Kinetic/Main vs Heat/Turret) and upgrades target those classifications.
6. Weapon evolutions exist (example: Heat Ray reflective beam).
7. Strategy differences between stationary defenses (mines/sentries) and mobile defenses (drones).
8. Runs aim for 30 minutes, with late-game relying on Freeze and scaling systems.

## What We Already Have In Our Build
1. Primary weapon (`Repeater`) and unlockable secondary weapons (beam/blast/projectile types).
2. Level-ups with a modal selection UI.
3. Item drops with a timer bar and typing-to-collect.
4. Shield charges, Freeze, Double Damage, Health, and Reroll counters exist.
5. Enemy variety via types + traits (tank/rusher/turret, plus armor/stealth/shield/buffer).

## Missing Or Incomplete (Compared To The Guide)
1. Loot behavior: currently treated as "bonus XP" instead of opening a Loot Upgrades screen.
2. Rerolls UX: reroll currency exists, but there is no UI/button to reroll upgrade options.
3. Weapon classifications and targeted upgrade pools: upgrades are global and not aware of weapon categories.
4. Evolutions: no evolution-tier upgrades (ex: Heat Ray reflect/bounce path).
5. Mobile defenses ("drones") and their upgrade hooks.
6. Clear "30 minute run" structure and end condition (optional, but the guide assumes it).

## Step-By-Step Implementation Plan (Phased)

### Phase 1: Weapon Metadata + Targeted Upgrades (Foundation)
1. Add weapon metadata fields in `public/js/survival-game/WeaponSystem.js`:
   - `class`: `main` | `secondary`
   - `tags`: array like `['kinetic']`, `['heat', 'dot']`, `['turret']`, `['mine']`, `['drone']`
2. Replace the single upgrade pool with rule-driven pools in `public/js/survival-game/UpgradeManager.js`:
   - `generalAugments` (always eligible)
   - `weaponAugments` (eligible only if player owns a matching weapon tag)
   - `evolutionAugments` (eligible only if weapon meets prerequisites)
3. Make the upgrade cards show "Affected weapons" (small footer string), computed from tags.
4. Add simple anti-feels-bad rules:
   - Filter out upgrades that would not change any owned weapon.
   - Avoid offering 2 unlocks in the same roll unless the pool is tiny.

### Phase 2: Reroll UX (Low Risk, High Value)
1. Add `reroll` button UI to the level-up modal in `public/index.html`.
2. Style it in `public/style.css` near the survival modal styles.
3. Implement `UpgradeManager.rerollOptions()`:
   - Consume `this.rerolls` if `> 0`
   - Replace the current 3 options with a fresh roll (same eligibility rules)
4. Show reroll count on the button and disable at `0`.

### Phase 3: Loot Upgrades Screen (Core Guide Feature)
1. Add a new modal container in `public/index.html`:
   - `#survival-loot-modal`
   - Similar structure to level-up modal, but labeled "LOOT CACHE" (or similar).
2. Add a `LootUpgradeManager` (or extend `UpgradeManager`) to manage:
   - `lootAugments` pool (category upgrades)
   - Persistent loot upgrade state for the current run
3. Change `loot` pickup behavior in `public/js/survival-game/SurvivalGame.js`:
   - Pause the game
   - Open the loot modal instead of granting XP
4. Implement 8-12 starter loot upgrades (all should be visible in gameplay):
   - `+Heat Damage` (affects weapons tagged `heat`)
   - `+D.O.T` (affects weapons tagged `dot`)
   - `+Item lifetime` (items stay longer)
   - `+Freeze drop chance`
   - `+Shield drop chance`
   - `+Reroll drop chance`
5. Display affected weapons list below each loot upgrade (matches guide UX).

### Phase 4: Evolutions (Heat Ray Reflect, Cold Path)
1. Add per-weapon "level" and XP tracking (if not already explicit per weapon).
2. Define evolution prerequisites:
   - Example: `heat_ray.level >= 5` unlocks "Reflective Beam" as an upgrade option.
3. Implement Heat Ray reflect in `public/js/survival-game/EntityManager.js`:
   - Option A: extend beam rendering + damage to support multiple segments (bounce points).
   - Option B: spawn short-lived chained beams that bounce.
4. Implement a cold/freeze-on-hit path for the main weapon:
   - Add `slowTimer` to enemies and a movement multiplier while slow is active.

### Phase 5: Drones + More Weapons (Strategy Variety)
1. Add a drone-type weapon (example: `spectre`) in `public/js/survival-game/WeaponSystem.js`:
   - Has its own position (or orbit) and targets nearest enemies.
2. Add renderer support in `public/js/survival-game/Renderer.js` for drone visuals.
3. Add 2-3 drone upgrades:
   - `+drone count`, `+drone speed`, `+drone damage`
4. Add 1 additional stationary defense weapon (example: `tesla_mines`) distinct from `minefield`.

### Phase 6: Run Structure (Optional But Aligns With Guide)
1. Add an explicit run timer target of 30:00.
2. On reaching 30:00:
   - Option A: end the run with a "SURVIVED" modal.
   - Option B: transition to an endless "overtime" difficulty mode.
3. Add late-game scaling adjustments that keep the run challenging without feeling unfair:
   - Spawn rate caps
   - Max enemies caps
   - Elite spawns that telegraph danger (better than pure speed inflation)

