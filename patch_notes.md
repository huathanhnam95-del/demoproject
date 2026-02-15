# Glyphica: Typing Survival - Patch Notes Compilation

## Early Access Update 0.5 (Build 16098230)

**Date:** 18 October 2024
**Build ID:** 16098230
**Author:** Wendy

![Header Image](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/1f3624604792536edc75d7bfcae4e1ad041017c2/header.jpg)

Update notes via Steam Community

Hello Survival Typists!

We're here with a small balancing and bugfixes update before the bigger update we promised at the end of the month.

### Differing Difficulties

We've been observing your concerns about the difficulty of the game, both those who are struggling with the game's current difficulty and those who think it is just too easy because we don't force you to type spaces and punctuation during the Boss fights.

We're working on longer term solutions but for now we've come up with a compromise. You can toggle spacing and punctuation on or off in the settings menu if you want additional difficulty.

In addition, to lower the difficulty for the first boss, we've removed it's power to "lock" words with a shield when you first meet him. But when he comes back the second time he will have regained this power.

You can find the rest of the bugfixes and balance changes below.

That's all for now, and we'll be back with another update at the end of the month!

#### Bugfixes

- Fixed Endless mode sometimes becoming inaccessible after beating Omen VI
- Fixed crash that happens in very late game when there is insufficient viable loot.
- Slight improve in performance from not generating cyphered strings when not in Trial II
- Prevent pickups (e.g. Shield and Re-roll) from spawning if total amount may exceed maximum allowable.
- Accept base alphabet as input for special characters. (e.g. "a" for "å")
- Added option to include uppercase characters, spaces and punctuation in boss fight.
- Moved level up, evolution and re-roll from Space to Ctrl in preparation of the above.
- Moved weapon details from F1 to Tab so that 60% or less keyboards can access them easily.

#### Balancing

- Stopped Trial 1 Boss (Poet) from locking words during boss fight (it will start locking words again when you meet him at Trial 3)

#### Features

- Steam overlay announcement system on game start-up.

---

## Glyphica : Typing Survival Early Access Update 2 (Build 16551973)

**Date:** 27 November 2024
**Build ID:** 16551973
**Author:** Wendy

![Header Image](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/1f3624604792536edc75d7bfcae4e1ad041017c2/header.jpg)

Update notes via Steam Community

[YouTube Video](https://youtube.com/watch?v=SlQqm2b-rUM)

Hello Survival Typists!

We’re back sooner than expected, with a much smaller update this time around.

### Balancing and Late Game Adjustments

![Balancing GIF](https://clan.fastly.steamstatic.com/images//44862715/9cab14b870c4fff25fd27ab82ebb0befa3b7153f.gif)
We are honestly are shocked at how many of you are getting so far into the game, reaching level 1000+ in some cases. This was never our intention, so we’ve made some balancing changes to the game like stronger enemies that should make the late game more challenging.

### Word Rush Bonus

![Word Rush GIF](https://clan.fastly.steamstatic.com/images//44862715/fdcca7c4951fc1a4d9104243df907cd5679aea0d.gif)
We wanted to reward fast typers, so we added a word rush bonus so that they can take advantage of their fast typing skills.

We also added a fix for when fast typers type an enemy word that has been killed by another weapon. We now delay the disappearance of that enemy to allow you to continue typing seamlessly.

### New Enemy : Splitter

![Splitter GIF](https://clan.fastly.steamstatic.com/images//44862715/fc239ff131a80b633ffc643992639e8a13ea6b42.gif)
This update brings a new enemy to torment you! The splitter acts like a regular drone, but the secret is once you destroy it, it splits into…more drones! Make sure you deal with a Splitter before it gets too close because you might suddenly have more enemies than you can deal with.

### New Augments

We plan to add new Augments to the game on a regular basis, and this update is no different. This set of Augments brings improvements to D.O.T. and Remote weapons, amongst others.

### Even More Relaxed

The relaxed difficulty of the game is now even more relaxed, to give new players a chance to get used to the game mechanics before moving on to more difficult challenges.

### Wiki

We now have an external wiki that you can read to understand the core concepts of the game and plan your runs better. The wiki corresponds to your chosen language, but note that not all of the wiki has been localized at this point.

### Licence to Kill

Keen eyed speakers of the Queen’s English will note how we spelled license, which means we’re excited to share that we’ve added a version of the wordlist with British spellings of words. We’re updating this over time with suggestions from the community, but till then, the subjects of the King can get cosy in their pyjamas, have a cuppa, and type to survive!

### Future Plans

Our solo dev XM is taking a long needed vacation before slowly getting back into building a much bigger update for you in January. Until then, we will still be doing maintenance and bugfixing for the game.

### Changelog

#### Balancing

- Higher level version of existing enemies added for late game.
- Added 'Word Rush' bonus to the game.
- Added button to access official wiki from main menu.
- Damage taken from Omen V no longer destroys Shields.
- Adjusted difficulty scaling over time.
- Adjusted enemy health and damage.
- Reduced Warder range.
- Added additional levels to existing enemies to smooth out the difficulty curve.
- Removed end game ramp of fast enemy chance.
- Nerfed end game ramp of large enemy chance.
- Nerfed difficulty for Omen VI.
- Lowered difficulty further.
- Pushed introduction of high-level enemies to later.
- Nerfed difficulty more by spacing out the introduction of high-level enemies.
- Make games start with 3 re-rolls.
- Cap some uncommon items from spawning too often.
- Added .25 second grace period after enemy dies before removing word.

#### Bugfixes

- Fixed "Max Ammo!" effect on Barrage Resupply pickups not using localized fonts.
- Fixed Hunter and Tesla Mine SFX still playing at main menu.
- Fixed "invisible wall" bug caused by Warder protection hitboxes not destroyed properly.
- Fixed untypable character in Indonesian Poet passage.
- Fixed Level up prompt showing wrong count when using Eager augment at game start.
- Fixed dash character not skipped when spaces and punctuation turned off.
- Fixed Cipher not updating words when enemies enter range.
- Fixed crash when collision detected with armor that is no longer valid.
- Show boss intro only if boss has not been defeated before.
- Fixed Cipher boss words not generated for Japanese language.
- Fixed enemies and pickups affected by Cipher boss not displaying their words correctly.
- Fixed boss intro description too hard to read in dark mode.
- Fixed Warder not clearing protections when it dies if its word is partially completed.
- Fixed Omen selection page counter display inconsistent when max.
- Fixed "ghosts" of previous round's enemies lingering in new games.
- Fixed consecutive games having significantly more enemies.
- Fixed Poet boss passage can be progressed while in menu.
- Fixed certain variants in Japanese Poet passages cannot be completed.
- Fixed crash due to Cipher's interaction with new Splitter enemy.
- Fixed turret locked text bleeding out of UI in east asian languages.
- Fixed Close Combat Augment crashing game.
- Fixed Splitter word appearing faint because it's detecting overlapt with its own children.
- Fixed Poet double word curse not working properly with Splitters.
- Fixed Drones not targeting Stalkers and Warders properly.
- Fixed Level Up prompt still showing after level up sometimes.
- Fixed health added by Vampirism is not a whole number.
- Fixed powerups overflowing the bottom of the screen.
- Fixed Tenacity does not increase when equipping two copies of it.
- Fixed additional letters taken for Tesla/Blade Trap/Minefield changing when load game.
- Fixed possible crash related to the above additional letter issue.
- Fixed Infector not increasing when taking additional copies of it.
- Added additional halo around Augment buttons in focus because it looks the same as equipped Augments.

#### Features

- Added Caustic Ammo Augment.
- Added Conviction Augment.
- Updated official wiki.
- Lamprey augment now functional.
- Added D.O.T. Augments (Lamprey and Conviction not working yet)
- Added Remote Augments (Caustic Ammo not working yet)
- Added Splitter Enemy.
- Added boss intro splash screen.

---

## Glyphica : Typing Survival Early Access Update 2.5 (Build 16787504)

**Date:** 18 December 2024
**Build ID:** 16787504
**Author:** Wendy

![Header Image](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/1f3624604792536edc75d7bfcae4e1ad041017c2/header.jpg)

Update notes via Steam Community

Hello Survival Typists!

The holidays are here, and so is our latest update to Glyphica: Typing Survival!

### Independent Wordlists

![Independent Wordlists GIF](https://clan.fastly.steamstatic.com/images//44862715/0cb9d7f02d733e387ae9f5d3fd65840d866a84ed.gif)
We've heard your feedback! You can now choose your typing language independently from your UI language. This means you can keep the menu and interface in your native language while practicing your typing in a different language.

### Holiday Wordlist

![Holiday Wordlist GIF](https://clan.fastly.steamstatic.com/images//44862715/4a1c0d508e75e533c3ed6f4961db6d5da66f076b.gif)
To celebrate the season, we've added a special Holiday Wordlist! It's filled with terms from various winter traditions, and you'll even see some festive effects in the main menu.

### Difficulty Balancing

We've made some adjustments to the English wordlist to provide a smoother mental load, especially for longer words. We've also tweaked enemy behavior - specifically their speed and spawning cooldowns - to prevent those massive, overwhelming hordes from forming too quickly.

### Changelog

#### Balancing

- Improved English wordlist for better mental load consistency.
- Lowered the base speed of fast-type enemies.
- Increased the minimum spawning cooldown for all enemy types.
- Fixed an issue where too many enemies would spawn simultaneously at high levels.

#### Features

- Added Holiday-themed main menu effects.
- Added special Holiday Wordlist.
- Implemented independent language selection for UI and Typing.

---

## Glyphica: Typing Survival - Early Access Update 3 (Build 17198630)

**Date:** 31 January 2025
**Build ID:** 17198630

Hello Survival Typists!

This update does bring long term improvements and additions to the game that improve the experience for both old and new players alike. Statistics and Leaderboards were one of our roadmap promises, and they are the focus of our update this time!

### Stat Tracking

![Stat Tracking Gif](https://clan.fastly.steamstatic.com/images//44862715/2690c52a845bf9f53ef023e8477e10edba0f2fff.gif)
We know that a lot of you like keeping track of your stats in the game and seeing how you are improving over time. For each main weapon, if you do an endless run, we will track your latest 10 playthroughs and track your WPM and accuracy. This is our first iteration of statistics in the game. So if you guys have more things that you would like to track, please do let us know in the comments!

### Friend Leaderboards

While the game is not built for competitive play, we know that a lot of you wanted to see how you stack up against your friends. In the leaderboard we take different stats like the time survived and difficulty level to give you a score, which is then used to rank you.

Each leaderboard is unique to a main weapon, which gives you a chance to beat your friends depending on which weapon is your main. In future updates we plan to add global leaderboards as well.

### Run Information

![Run Information Gif](https://clan.fastly.steamstatic.com/images//44862715/ec29d0959bc6fc32b665c158ffbf4d6846b254e6.gif)
Previously during a run we only showed you weapon information. Due to popular demand, we have added more information for you to better strategize your present and future runs.

You can now select between different tabs in the Run Information screen to show which loot you’ve picked up and which augments you have selected for this Run. If there is any other information you want here, please let us know and we’ll work on adding them!

### Performance Improvements

We've improved the UI updating loop to be much more efficient, which yielded overall performance gains throughout the game. Now that has been fixed and we’re expecting you to have a much smoother game experience overall!

### Loot Rework

Our loot has been neglected for a long time and we did a major rebalancing of the items pickups to better fit the current game meta. Some loot has been nerfed, and some have had more gradations added to them to fill in some gaps.

### Options Menu Organization

Another relatively small but meaningful update is a reorganizing of our options menu into different tabs. Why is this meaningful? Because it’s an important and necessary step for adding things like custom color themes and fonts into the game!

### Wiki Localization

We added an official wiki in one of our recent updates, and have now updated it with more localized content!

### Future Plans

And that’s all for Update 3. We hope you enjoy these updates! In the meantime, we’ll get back to work and bring you another update at the end of next month.

### CHANGELOG

#### BUGFIXES

- Fixed rarity icon not scaling based on resolution.
- Fixed Barrage explosion radius not scaling based on resolution.
- Fixed French Poet passage that gets stuck at last character (there was a rogue newline that was removed)
- Filter Cypher scrambled words against a blacklist.
- Added "ss" as a fallback for "ß"
- Stop spawning enemies behind Poet UI.
- Made Meteor pickups spawn at more reasonable positions.
- Fixed garbled screen for Steam Deck during bootup.
- Fixed sometimes letters are detected as mistypes even if they are not.
- Fixed overflowing modifiers text / blank pages in Weapon Details screen.
- Fixed mistype crash fix from previous patch crashing the game.
- Fixed crash due to looking for non-existent weapon in modifiers.
- Fixed leaderboard saving localized name of weapon instead of class name (leaderboard wiped due to fix)
- Fixed augment select button in omen screen not clearing outline when changing augment category.
- Fixed word complete effect crashing game when bad position data is passed to it.
- Fixed current augments display crashing game when a negative range is passed to it (didn't fix the cause, just the symptom).
- Fixed erroneous detection of a newly added weapon in DPS calculations.
- Localized difficulty text on Leaderboards.
- Removed untypable newline character from Spanish and Indonesian Poet passages.
- Fixed Augment description box not full width in Weapon Details.
- Fixed onWordComplete trigger triggering on removing box on Double Words.
- Make accented variants of character also trigger weapons (e.g. 'á' counts as 'a' for triggering Spectre)
- Fixed missing percentage on Juryrigged loot item description.
- Fixed triple damage showing wrong effect string on pickup.
- Fixed Devotion Augment not triggered on game start.
- Changed "Current Weapons" to "Run Information"
- Fixed current weapons header not localized in run information.
- Fixed having coins exactly equal to main weapon cost does not allow player to unlock it.

#### BALANCING

- Main turret are now bought with coins. Turrets will remain unlocked for players who have unlocked them before.
- Endless record changed to score-based. Score is time in milliseconds multiplied by additional 20% for each omen level.
- Fixed keyboard (Q/W) and controller (LB/RB) navigation of leaderboard tabs.
- Added localized font for leaderboard headers.
- Added localized font for "insufficient_funds" effect when trying to buy a main turret with not enough coins.
- Fixed overlap of button hotspots allowed buttons to be activated at the same time when clicking between them.
- Made enemy health bars respect resolution and standardized spacing between health bars among enemies.
- Juryrigged loot item has downside removed and now gives 35% chance for additional drone whenever a drone is spawned.
- Gambler loot item now adds a reroll on top of increasing max reroll.
- Protector loot item now adds a shield on top of increasing max shields.
- Last Stand loot item now gives a 100% chance of triggering Double Damage on Shield destroyed.
- Initiation loot item changed to Harmonizer, which gives 1 evolution level to all existing weapons.
- Enlightenment loot item now gives +1 kills to ALL existing weapons on destroying enemy with crit.
- Triple Damage loot item now triggers Triple Damage instead whenever Double Damage would be triggered.
- Affliction loot item renamed to Erosion due to similarities with Afflictor Augment.
- Regeneration loot item has downside removed and now heals 5% of max health whenever you activate relevant pickups.
- Afflictor loot item now gives +4% D.O.T. damage instead of +3%.
- Cryotechnics loot item now gives +2% chance to drop Freeze pickup instead of +3%.
- Warlike loot item now gives +4% chance to drop Double Damage pickup instead of +3%.
- Pinata loot item now gives +4% chance to drop Loot pickup instead of +2%.
- Common Loot Items targeting a single weapon type: Effectiveness reduced from 20% to 15%
- Common Loot Items targeting all weapon types: Effectiveness reduced from 10% to 5%
- Common Loot Items increasing drop rates of double damage and freeze: Effectiveness reduced from 2% to 1%
- For each reduced effectiveness of the above Common Loot Item, there was added a corresponding Uncommon Loot Item:
-- For singular weapon type the bonus is 25%
-- For all weapon types the bonus is 12.5%
-- For freeze and double damage drop rate it is 2%
- 4 new Uncommon Loot Items that increase the chance for status effects for Kinetic, Heat, Cold and Electric weapons by 4%

#### FEATURES

- Added Leaderboard categorized by Main Weapon.
- Added Current Loot and Current Augments tabs to Weapon Details screen.
- WPM History graph.
- Major optimizations to UI updating script, which yielded better overall gameplay performance.
- Added 36 uncommon loot items that are +25% versions of common ones.
- Added categorized options screen.
- Added graph legend to WPM history graph.
- Added localization for content added in this update.

---

## Glyphica: Typing Survival - Update 9: Steam Workshop! (Build 17915669)

**Date:** 5 February 2025
**Build ID:** 17915669

Hello Survival Typists! We’re back with another update to Glyphica. Our big addition to this update is Steam puts the power in the hands of our players.

### Steam Workshop

With Steam Workshop you can now create custom wordlists that you can share with the world. You can use wordlists to do whatever you want, either making lists as a learning tool or adding your own poetry to the poet boss! The process for uploading a mod to Steam is a little bit complex, so we’ve prepared some [documentation for you](https://docs.google.com/document/d/1yN_KzR6DnyOQ0O-l9B4S1C9Ynxm7F_O0S79A2XoP8-I/edit?usp=sharing).

The big addition that Workshop brings is something we call multi-level wordlists. What this means is you can have a word that you are typing, and a reference word above it. For example, you can do wordlists with translations in other languages.

![Steam Workshop Menu](https://clan.fastly.steamstatic.com/images//44862715/0ce1a7a7a5a8f46e5b4c6e8e8e8e8e8e8e8e8e8e.jpg)
*Caption: Players can now manage Steam Workshop and Local Mods.*

![Spanish Translation Example](https://clan.fastly.steamstatic.com/images//44862715/1ce1a7a7a5a8f46e5b4c6e8e8e8e8e8e8e8e8e8e.jpg)
*Caption: Example of multi-level wordlists using Spanish translations.*

### Global Weapons Evolutions

We’ve also added global evolutions to the game. Global weapons offer the player a choice of reinforcing one weapon or choosing an evolution that improves a weapon tag that affects many weapons. For example, a player might have a Minefield build with a focus on Explosive, but also has Spectre and Hunter as their other weapons. On the next Minefield evolution, they may be given an option to lean into the Explosive Build, or pick up a Global Drone Evolution.

![Global Evolutions](https://clan.fastly.steamstatic.com/images//44862715/2ce1a7a7a5a8f46e5b4c6e8e8e8e8e8e8e8e8e8e.jpg)
*Caption: New evolution choices like Stalking Algorithms and Self Destruct II.*

That’s all for now, Survival Typists! We have some big plans coming up for the next update. But for now, we look forward to seeing all the cool mods you come up with!

---

## Glyphica: Typing Survival - Update 5: Update 5 Brings new weapon, boss, consumable loot and more! (Build 18635240)

**Date:** 28 May 2025
**Build ID:** 18635240

Hello Survival Typists!

We’re back with our regular updates, creating more content for you to enjoy, as well as some cosmetic experiments. Let’s get right to it!

### New Weapon: Guardian

The Guardian is a defensive-oriented weapon that provides a shield and orbital strikes to keep enemies at bay. It excels in high-density waves where positioning is key.

### New Boss: The Cypher

A new late-game boss that challenges your typing speed with complex, shifting patterns. Defeating The Cypher grants a unique augmentation.

### Consumable Loot

We've added a variety of consumable items that can be found during runs:
- **Speed Boost:** Briefly increases typing multiplier.
- **Shield Overload:** Instantly clears nearby small enemies.
- **Time Warp:** Slows down enemy movement for 5 seconds.

### Other Changes and Fixes

* Fixed an issue where certain achievements weren't triggering correctly in Endless Mode.
- Optimized performance for Mac users during late-game waves.
- Adjusted the health of the "Repeater" enemy type to improve early-game balance.
- Updated localizations for Simplified Chinese and Japanese.

---

## Glyphica: Typing Survival - Update 6: New Achievements, Weapon, and Boss! (Build 19408101)

**Date:** 31 July 2025
**Build ID:** 19408101

![Header Image](https://shared.fastly.steamstatic.com/community_assets/images/apps/2400160/12cbca40738a1a3a57ab91ba6b41b46d502adde4.jpg)

**Hello Survival Typists!**
We’re back with another update packed with content, balance tweaks, and quality-of-life improvements. Let’s jump right into it!

### New Weapon: Orbiter

![Orbiter GIF](https://clan.fastly.steamstatic.com/images//44862715/2408213a03f42da41abd44494be99ad011eed0e0.gif)
The Orbiter brings a fresh twist to the battlefield. When you type words starting with specific letters, it spawns orbs that rotate around your main weapon, dealing chemical damage to everything they pass through. Evolve it to deal electric damage, send out twin orbs in opposite directions, or form a damaging tether between the main weapon and the orb for some truly chaotic typing action.

### New Boss: Gemini

The Gemini isn’t a single boss. It’s two. Damaging only one won’t get you far, because they constantly heal each other to the highest health between them. You’ll need to split your focus and keep your damage even. And when they unleash their Tendril attack? Get ready to mash your keys or buttons fast!

### New Achievements

We heard your feedback. More achievements, please! This update adds a fresh batch, including simpler ones for new players and tough-as-nails challenges for our veteran typists. There’s something for everyone.

### New Evolutions for Chopper

Chopper gets two new ways to shred:

- Saw Launcher turns the Chopper into a barrage of smaller saw-blades.
- Bloodbath adds bonus damage to bleeding enemies and raises their double damage drop chance.

### Less Grind, More Game

Let’s be honest. We let the economy get a bit out of hand. So we’re fixing that. Coin drops have been doubled across the board, and all main weapons now cost a flat 1000 coins to unlock. No more grind. Just more typing, more fun.

### 2 New Augment Codices

Electric and Heat Augment Codices are now available. These unlock even more creative and dangerous build possibilities. Perfect for chasing those new achievements and wreaking havoc with elemental synergies.

### New Audio Themes

You can now groove to two new music sets:

- **Sunset** is a laid-back, beachy lounge track for mellow vibes.
- **Midnight** is a lo-fi, head-nodding beat for focused destruction.
Both pair beautifully with their visual theme counterparts, and you can swap them in the settings anytime.

That’s it for this update, folks! We hope you enjoy the new weapons, bosses, tunes, and quality-of-life changes. As always, we’ll be back again in 2 months with even more content and features to keep your fingers flying.

### CHANGELOG

#### Bugfixes

- Added auto-correct when Capslock is on for Korean input.
- Fixed Guardian chases Jormungander endlessly.
- Changed "Loot Weapons" in localization to "Loot Effects" to be in line with nomenclature.
- Updated affected weapons section in loot screen for more accuracy.
- Fixed Scapegoat not using correct SFX (now you can hear our bleats!)
- Fixed loot items affecting chances (drop chance, crit chance, etc) not showing up.
- Reverted to old way of generating Cypher strings because the new way was causing crashes.
- Fixed null reference crash in enemy Armor script.
- Fixed some unusable loot items generated due to missing stat in requirements.
- Fixed reroll and shield chance bonuses missing from Run Information breakdown.
- Fixed crash due to variable misnaming in loot screen.
- Fixed when loading game with missing or renamed upgrade.
- Fixed wrong number printed in loot description for Release.

#### Balancing

- Added new lane management so reduced word overlapping (not entirely eliminated though).
- Caltrops: Increased base Bleed Chance + Bleed Chance scale with Caltrops damage.
- Reduced consumable item loot weight.
- Changed Warhead tag from "Loot" to "Consumable".
- Added Duration stat level-up upgrades for Guardian.
- Added "Augment" tag for Augment Effects.
- Increased Guardian fuel pickup from 50% to 60% refill.
- Increased SplatterShot Puddle Damage over time by 25%.
- Made all Main Weapons cost 1000 coins and doubled coin drop rate.
- Made at least one choice during level up an upgrade by default. No longer requires Devotion Augment.

#### Features

- New Electric Augment Codex.
- New Heat Augment Codex.
- Added Sunset audio theme.
- Added Midnight audio theme.
- Added new level-up weapon Orbiter.
- Added new Trial 1 boss: Gemini.
- Added "Bloodbath" and "Saw Launcher" evolutions for Chopper.
- New Achievements added.
- Added Chemical, Loot and Augment related loot items.

#### Miscellaneous

- Updated Seismic Munition II's description for more clarity.
- Renamed Juryrigged to Makeshift due to it sounding similar to Jerry-rigged.
- "Double Damage Chance" changed to "Double Damage Drop Chance" for more clarity.

---

## Glyphica: Typing Survival - Update 7: Overmind and Browser Demo (Build 20459170)

**Date:** 23 October 2025
**Build ID:** 20459170

### New Feature: The Overmind

The Overmind is a new meta-progression system that allows you to customize your run even further. By spending Overmind Points (earned by playing), you can unlock permanent upgrades and unique starting conditions.
![Overmind UI](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/ss_4e5b5c6d7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e.1920x1080.jpg)

### New Weapon: Overmind Beam

A powerful beam that scales with your current WPM. The higher your typing speed, the more intense the beam becomes, melting through enemy hordes.

### Browser Demo

We are excited to announce that a playable demo of Glyphica is now available directly in your web browser! You can now share the link with friends to let them try the game without any downloads.

### Bugfixes & Improvements

* **Balance:** Adjusted the health of the Poet boss in later rounds.
- **UI:** Improved the visibility of the "Critical Hit" indicators.
- **Localization:** Fixed several typos in the German and Japanese translations.
- **Performance:** Optimized the particle effects for the "Splattershot" evolution to prevent frame drops on lower-end hardware.

![New Boss Preview](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/ss_8f7e6d5c4b3a2a1b0c9d8e7f6a5b4c3d2e1f0a9b.1920x1080.jpg)

---

## Glyphica: Typing Survival - Update 9: Steam Workshop! (Build 21138772)

**Date:** 5 February 2026
**Build ID:** 21138772

Hello Survival Typists! We're back with another update to Glyphica. Our big addition to this update is Steam puts the power in the hands of our players. That's right, we're finally adding Steam Workshop!

### Steam Workshop

![Steam Workshop Interface](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/ss_e1e19d7796d88c0a37e54f9a5602058f84405a30.1920x1080.jpg)
With Steam Workshop, you can now easily download and play with custom wordlists created by the community. You can find everything from new languages to themed dictionaries.

### Create Your Own Mods

If you're interested in creating your own wordlists, we've provided a comprehensive guide and tools to get you started. You can find the documentation here: [Link to Documentation]

### Official Wordlists

![Simplified Chinese Wordlist Example](https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2400160/ss_60215717679361a6b0c6dfa3a5f80b180d19f802.1920x1080.jpg)
We've uploaded some official wordlists for you to play with, including:

- DELE A2 Vocabulario
- 一起学习英文! (Let's Learn English!)
- Let's Learn French!

### Language Learning

Glyphica was not designed as a language learning tool so this will not be added in the main game. However, we're excited to give you this tool to play with on your own.

### Bug Fixes & Improvements

- Fixed missing comma in Simplified Chinese Poet passage.
- Fixed chance for Cypher boss to become invulnerable when it moves close to a Warder.
- Specified "Zhuyin" input for Traditional Chinese because there are other typing styles.
- Fixed Flaming Blades Evolution for Chopper has stats reversed in description.
- Fixed inverted comma in Ukrainian keyboard wrongly mapped.
- Replaced arrow brackets in Catalan Poet passage with double inverted commas.
- Removed "jude" from German wordlist.

---
