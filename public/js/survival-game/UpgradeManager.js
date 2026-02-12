/**
 * UpgradeManager.js
 * Manages XP, Leveling, and Augment Selection.
 */

import { GameStates } from './GameConfig.js';

export default class UpgradeManager {
    constructor(game) {
        this.game = game;
        this.xp = 0;
        this.level = 1;
        this.nextLevelXp = 100;
        this.pendingLevelUps = 0;
        this.modal = document.getElementById('survival-levelup-modal');
        this.list = document.getElementById('survival-upgrade-choices');
        this.lootModal = document.getElementById('survival-loot-modal');
        this.lootList = document.getElementById('survival-loot-choices');
        this.rerollBtn = document.getElementById('survival-reroll-btn');
        this.rerollCount = document.getElementById('survival-reroll-count');

        this.rerolls = 0;
        this.currentLevelOptions = [];
        this.currentLootOptions = [];

        this.availableAugments = this.buildLevelAugments();
        this.availableLootAugments = this.buildLootAugments();

        if (this.rerollBtn) {
            this.rerollBtn.addEventListener('click', () => {
                this.rerollOptions();
            });
        }
    }

    buildLevelAugments() {
        return [
            {
                id: 'dmg_boost',
                name: 'Overclock',
                desc: '+20% Damage',
                type: 'weapon_stat',
                stat: 'damage',
                val: 2,
                repeatable: true
            },
            {
                id: 'fire_rate',
                name: 'Rapid Fire',
                desc: 'Secondary weapons: -10% cooldown',
                type: 'weapon_stat',
                stat: 'baseCooldown',
                mult: 0.9,
                targetClasses: ['secondary'],
                repeatable: true
            },
            {
                id: 'multishot',
                name: 'Split Stream',
                desc: '+1 Projectile',
                type: 'weapon_mod',
                mod: 'projectiles',
                val: 1,
                targetTypes: ['projectile'],
                repeatable: true
            },
            {
                id: 'pierce',
                name: 'Quantum Tunneling',
                desc: '+1 Pierce',
                type: 'weapon_mod',
                mod: 'pierce',
                val: 1,
                targetTypes: ['projectile'],
                repeatable: true
            },
            {
                id: 'speed',
                name: 'Lightweight',
                desc: '+10% Proj Speed',
                type: 'weapon_stat',
                stat: 'speed',
                val: 50,
                targetTypes: ['projectile'],
                repeatable: true
            },
            {
                id: 'drone_count',
                name: 'Drone Swarm',
                desc: '+1 Drone',
                type: 'weapon_mod',
                mod: 'droneCount',
                val: 1,
                targetTags: ['drone'],
                repeatable: true
            },
            {
                id: 'drone_orbit',
                name: 'Orbital Uplink',
                desc: 'Drones: +15% orbit speed',
                type: 'weapon_stat',
                stat: 'orbitSpeed',
                mult: 1.15,
                targetTags: ['drone'],
                repeatable: true
            },
            {
                id: 'drone_damage',
                name: 'Hunter Payload',
                desc: 'Drones: +2 damage',
                type: 'weapon_stat',
                stat: 'damage',
                val: 2,
                targetTags: ['drone'],
                repeatable: true
            },
            {
                id: 'mine_capacity',
                name: 'Mine Rack',
                desc: 'Mines: +1 max active',
                type: 'weapon_mod',
                mod: 'maxMines',
                val: 1,
                targetTags: ['mine'],
                repeatable: true
            },
            {
                id: 'mine_damage',
                name: 'Arc Charge',
                desc: 'Mines: +4 blast damage',
                type: 'weapon_stat',
                stat: 'damage',
                val: 4,
                targetTags: ['mine'],
                repeatable: true
            },
            {
                id: 'mine_trigger',
                name: 'Proximity Lattice',
                desc: 'Mines: +8 trigger radius',
                type: 'weapon_stat',
                stat: 'triggerRadius',
                val: 8,
                targetTags: ['mine'],
                repeatable: true
            },
            {
                id: 'broadcaster',
                name: 'The Broadcaster',
                desc: 'Unlock Spread Shot (I/O/U words)',
                type: 'new_weapon',
                weaponId: 'broadcaster'
            },
            {
                id: 'heat_ray',
                name: 'Heat Ray',
                desc: 'Unlock Beam Weapon (D.O.T)',
                type: 'new_weapon',
                weaponId: 'heat_ray'
            },
            {
                id: 'minefield',
                name: 'Minefield',
                desc: 'Unlock Minefield (M/N trigger)',
                type: 'new_weapon',
                weaponId: 'minefield'
            },
            {
                id: 'sentry',
                name: 'Sentry',
                desc: 'Unlock Auto-Turret (targets nearest)',
                type: 'new_weapon',
                weaponId: 'sentry'
            },
            {
                id: 'spectre',
                name: 'Spectre Drones',
                desc: 'Unlock mobile support drones',
                type: 'new_weapon',
                weaponId: 'spectre'
            },
            {
                id: 'tesla_mines',
                name: 'Tesla Mines',
                desc: 'Unlock autonomous mine traps',
                type: 'new_weapon',
                weaponId: 'tesla_mines'
            },
            {
                id: 'repeater_cryo',
                name: 'Cryo Repeater',
                desc: 'Evolution: Repeater shots slow enemies',
                type: 'evolution',
                requiresWeaponId: 'compiler',
                requiresWeaponLevel: 6,
                set: {
                    coldOnHit: true,
                    coldDuration: 1.35,
                    coldSpeedMult: 0.45
                },
                addTags: ['cold', 'evolved']
            },
            {
                id: 'heat_ray_reflector',
                name: 'Reflective Heat Ray',
                desc: 'Evolution: Heat Ray bounces off walls',
                type: 'evolution',
                requiresWeaponId: 'heat_ray',
                requiresWeaponLevel: 5,
                set: {
                    beamBounces: 1,
                    beamBounceDamageMult: 0.65,
                    maxExtraBeamTargets: 6
                },
                addTags: ['reflective', 'evolved']
            }
        ];
    }

    buildLootAugments() {
        return [
            {
                id: 'loot_heat_damage',
                name: 'Thermal Resin',
                desc: 'Heat weapons: +20% damage',
                type: 'weapon_stat',
                stat: 'dps',
                mult: 1.2,
                targetTags: ['heat'],
                repeatable: true
            },
            {
                id: 'loot_dot_damage',
                name: 'Combustion Matrix',
                desc: 'D.O.T weapons: +25% damage',
                type: 'weapon_stat',
                stat: 'dps',
                mult: 1.25,
                targetTags: ['dot'],
                repeatable: true
            },
            {
                id: 'loot_turret_clock',
                name: 'Turret Clock',
                desc: 'Turrets: -15% cooldown',
                type: 'weapon_stat',
                stat: 'baseCooldown',
                mult: 0.85,
                targetTags: ['turret'],
                repeatable: true
            },
            {
                id: 'loot_freeze_weight',
                name: 'Cryo Cache',
                desc: '+25% Freeze drop rate',
                type: 'drop_weight',
                itemType: 'freeze',
                mult: 1.25,
                repeatable: true
            },
            {
                id: 'loot_shield_weight',
                name: 'Safeguard Cache',
                desc: '+25% Shield drop rate',
                type: 'drop_weight',
                itemType: 'shield',
                mult: 1.25,
                repeatable: true
            },
            {
                id: 'loot_reroll_weight',
                name: 'Reforge Cache',
                desc: '+30% Reroll drop rate',
                type: 'drop_weight',
                itemType: 'reroll',
                mult: 1.3,
                repeatable: true
            },
            {
                id: 'loot_item_life',
                name: 'Stasis Wrapping',
                desc: '+20% item lifetime',
                type: 'item_lifetime',
                mult: 1.2,
                repeatable: true
            }
        ];
    }

    hasSecondaryWeapons() {
        return this.getOwnedWeapons().some(weapon => weapon.weaponClass !== 'main');
    }

    getOwnedWeapons() {
        const weapons = this.game && this.game.weaponSystem ? this.game.weaponSystem.weapons : null;
        if (!Array.isArray(weapons)) return [];
        return weapons.filter(Boolean);
    }

    hasWeapon(weaponId) {
        if (!weaponId) return false;
        return this.getOwnedWeapons().some(weapon => weapon.id === weaponId);
    }

    getWeaponById(weaponId) {
        if (!weaponId) return null;
        return this.getOwnedWeapons().find(weapon => weapon.id === weaponId) || null;
    }

    weaponMatchesTarget(weapon, augment) {
        if (!weapon || !augment) return false;
        if (augment.targetWeaponIds && !augment.targetWeaponIds.includes(weapon.id)) return false;
        if (augment.targetClasses && !augment.targetClasses.includes(weapon.weaponClass)) return false;
        if (augment.targetTypes && !augment.targetTypes.includes(weapon.type)) return false;
        if (augment.excludeWeaponIds && augment.excludeWeaponIds.includes(weapon.id)) return false;

        if (augment.targetTags && augment.targetTags.length > 0) {
            const tags = Array.isArray(weapon.tags) ? weapon.tags : [];
            if (!augment.targetTags.some(tag => tags.includes(tag))) return false;
        }
        return true;
    }

    getApplicableWeapons(augment) {
        return this.getOwnedWeapons().filter(weapon => this.weaponMatchesTarget(weapon, augment));
    }

    canApplyWeaponStat(weapon, augment) {
        if (!weapon || !augment || !augment.stat) return false;
        if (weapon[augment.stat] === undefined || !Number.isFinite(weapon[augment.stat])) return false;
        if (Number.isFinite(augment.mult) && augment.mult !== 1) return true;
        if (Number.isFinite(augment.val) && augment.val !== 0) return true;
        return false;
    }

    meetsWeaponRequirement(augment) {
        if (!augment) return false;
        if (!augment.requiresWeaponId && !augment.requiresWeaponTag) return true;

        let requiredWeapon = null;
        if (augment.requiresWeaponId) {
            requiredWeapon = this.getWeaponById(augment.requiresWeaponId);
            if (!requiredWeapon) return false;
        }

        if (augment.requiresWeaponTag) {
            const taggedWeapon = this.getOwnedWeapons().find(weapon => {
                const tags = Array.isArray(weapon.tags) ? weapon.tags : [];
                return tags.includes(augment.requiresWeaponTag);
            });
            if (!taggedWeapon) return false;
            if (!requiredWeapon) requiredWeapon = taggedWeapon;
        }

        if (augment.requiresWeaponLevel && requiredWeapon) {
            return (requiredWeapon.level || 1) >= augment.requiresWeaponLevel;
        }
        return true;
    }

    isAugmentEligible(augment) {
        if (!augment) return false;
        if (!this.meetsWeaponRequirement(augment)) return false;

        if (augment.type === 'new_weapon') {
            return !this.hasWeapon(augment.weaponId);
        }
        if (augment.type === 'evolution') {
            const weapon = this.getWeaponById(augment.requiresWeaponId);
            if (!weapon) return false;
            const evolutions = Array.isArray(weapon.evolutions) ? weapon.evolutions : [];
            return !evolutions.includes(augment.id);
        }
        if (augment.type === 'weapon_stat') {
            return this.getApplicableWeapons(augment).some(weapon => this.canApplyWeaponStat(weapon, augment));
        }
        if (augment.type === 'weapon_mod') {
            return this.getApplicableWeapons(augment).some(weapon => weapon[augment.mod] !== undefined && Number.isFinite(augment.val));
        }
        if (augment.type === 'drop_weight') return true;
        if (augment.type === 'item_lifetime') return true;
        return false;
    }

    reset() {
        this.xp = 0;
        this.level = 1;
        this.nextLevelXp = 100;
        this.pendingLevelUps = 0;
        this.rerolls = 0;
        this.currentLevelOptions = [];
        this.currentLootOptions = [];
        this.availableAugments = this.buildLevelAugments();
        this.availableLootAugments = this.buildLootAugments();
        if (this.modal) this.modal.style.display = 'none';
        if (this.lootModal) this.lootModal.style.display = 'none';
        this.updateRerollUi();
    }

    addXp(amount) {
        this.xp += amount;
        let leveled = 0;
        while (this.xp >= this.nextLevelXp) {
            this.level++;
            this.xp -= this.nextLevelXp;
            this.nextLevelXp = Math.floor(this.nextLevelXp * 1.5);
            this.pendingLevelUps++;
            leveled++;
        }
        if (leveled > 0) {
            this.game.audioManager.playLevelUp();
        }
    }

    getOptions(kind = 'level', excludedIds = []) {
        const source = kind === 'loot' ? this.availableLootAugments : this.availableAugments;
        const excluded = new Set(excludedIds || []);
        const options = [];
        const pool = source.filter(augment => !excluded.has(augment.id) && this.isAugmentEligible(augment));
        const remaining = [...pool];

        while (options.length < 3 && remaining.length > 0) {
            const hasUnlock = options.some(option => option.type === 'new_weapon');
            let candidates = remaining;
            if (hasUnlock) {
                const nonUnlock = remaining.filter(option => option.type !== 'new_weapon');
                if (nonUnlock.length > 0) candidates = nonUnlock;
            }

            const idx = Math.floor(Math.random() * candidates.length);
            const pick = candidates[idx];
            options.push(pick);
            const removeIdx = remaining.indexOf(pick);
            if (removeIdx !== -1) remaining.splice(removeIdx, 1);
        }

        return options;
    }

    formatAugmentTargets(augment) {
        if (!augment) return '';
        if (augment.type === 'new_weapon') return 'Unlocks a new secondary weapon';
        if (augment.type === 'evolution') {
            const weapon = this.getWeaponById(augment.requiresWeaponId);
            const weaponName = weapon ? weapon.name : augment.requiresWeaponId;
            const reqLevel = augment.requiresWeaponLevel || 1;
            return `Evolution for ${weaponName} (Lv ${reqLevel}+)`;
        }
        if (augment.type === 'drop_weight') return `Affects drops: ${augment.itemType}`;
        if (augment.type === 'item_lifetime') return 'Affects all item drops';

        const names = this.getApplicableWeapons(augment)
            .filter(weapon => {
                if (augment.type === 'weapon_stat') return this.canApplyWeaponStat(weapon, augment);
                if (augment.type === 'weapon_mod') return weapon[augment.mod] !== undefined;
                return false;
            })
            .map(weapon => weapon.name);

        if (names.length === 0) return 'No current weapon affected';
        if (names.length <= 2) return `Affects: ${names.join(', ')}`;
        return `Affects: ${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
    }

    createUpgradeCard(opt, onPick) {
        const btn = document.createElement('div');
        btn.className = 'upgrade-card';

        const title = document.createElement('h3');
        title.textContent = opt.name;
        btn.appendChild(title);

        const desc = document.createElement('p');
        desc.textContent = opt.desc;
        btn.appendChild(desc);

        const target = document.createElement('p');
        target.className = 'upgrade-target';
        target.textContent = this.formatAugmentTargets(opt);
        btn.appendChild(target);

        btn.onclick = () => onPick(opt);
        return btn;
    }

    updateRerollUi() {
        if (!this.rerollBtn) return;
        const usable = this.rerolls > 0 && this.pendingLevelUps > 0 && this.modal && this.modal.style.display === 'block';
        this.rerollBtn.disabled = !usable;
        this.rerollBtn.classList.toggle('is-disabled', !usable);
        if (this.rerollCount) this.rerollCount.textContent = `${this.rerolls}`;
    }

    showUpgradeMenu(forcedOptions = null) {
        const options = forcedOptions || this.getOptions('level');
        const container = this.modal;
        const list = this.list;
        if (!container || !list) return false;
        if (options.length === 0) return false;

        this.currentLevelOptions = options;
        list.innerHTML = '';

        options.forEach(opt => {
            const btn = this.createUpgradeCard(opt, picked => this.selectUpgrade(picked));
            list.appendChild(btn);
        });

        if (this.lootModal) this.lootModal.style.display = 'none';
        container.style.display = 'block';
        this.updateRerollUi();
        return true;
    }

    showLootMenu() {
        const options = this.getOptions('loot');
        const container = this.lootModal;
        const list = this.lootList;
        if (!container || !list) return false;
        if (options.length === 0) return false;

        this.currentLootOptions = options;
        list.innerHTML = '';
        options.forEach(opt => {
            const btn = this.createUpgradeCard(opt, picked => this.selectLootUpgrade(picked));
            list.appendChild(btn);
        });

        if (this.modal) this.modal.style.display = 'none';
        container.style.display = 'block';
        this.updateRerollUi();
        return true;
    }

    tryOpenLevelUpMenu() {
        if (this.pendingLevelUps <= 0) return false;
        this.game.pause(GameStates.LEVEL_UP);
        const shown = this.showUpgradeMenu();
        if (!shown) {
            this.pendingLevelUps = 0;
            this.game.resume();
            return false;
        }
        return true;
    }

    openLootMenu() {
        const shown = this.showLootMenu();
        if (!shown) return false;
        this.game.pause(GameStates.LEVEL_UP);
        return true;
    }

    rerollOptions() {
        if (this.pendingLevelUps <= 0) return false;
        if (!this.modal || this.modal.style.display !== 'block') return false;
        if (this.rerolls <= 0) return false;

        this.rerolls -= 1;
        const excluded = this.currentLevelOptions.map(option => option.id);
        const options = this.getOptions('level', excluded);
        if (options.length > 0) {
            this.showUpgradeMenu(options);
        } else {
            this.showUpgradeMenu();
        }
        this.updateRerollUi();
        return true;
    }

    applyWeaponStat(opt) {
        const targets = this.getApplicableWeapons(opt);
        targets.forEach(weapon => {
            if (!this.canApplyWeaponStat(weapon, opt)) return;
            if (Number.isFinite(opt.mult)) {
                if (opt.stat === 'baseCooldown') {
                    weapon.baseCooldown = Math.max(0.05, weapon.baseCooldown * opt.mult);
                } else {
                    weapon[opt.stat] *= opt.mult;
                }
                return;
            }
            if (Number.isFinite(opt.val)) {
                if (opt.stat === 'baseCooldown') {
                    weapon.baseCooldown = Math.max(0.05, weapon.baseCooldown + opt.val);
                } else {
                    weapon[opt.stat] += opt.val;
                }
            }
        });
    }

    applyWeaponMod(opt) {
        const targets = this.getApplicableWeapons(opt);
        targets.forEach(weapon => {
            if (weapon[opt.mod] !== undefined && Number.isFinite(opt.val)) {
                weapon[opt.mod] += opt.val;
            }
        });
    }

    applyDropWeight(opt) {
        if (!opt.itemType) return;
        if (!this.game.itemWeightBonus) this.game.itemWeightBonus = {};
        const current = Number.isFinite(this.game.itemWeightBonus[opt.itemType]) ? this.game.itemWeightBonus[opt.itemType] : 1;
        if (Number.isFinite(opt.mult)) {
            this.game.itemWeightBonus[opt.itemType] = Math.max(0, current * opt.mult);
            return;
        }
        if (Number.isFinite(opt.val)) {
            this.game.itemWeightBonus[opt.itemType] = Math.max(0, current + opt.val);
        }
    }

    applyItemLifetime(opt) {
        const current = Number.isFinite(this.game.itemLifetimeMult) ? this.game.itemLifetimeMult : 1;
        if (Number.isFinite(opt.mult)) {
            this.game.itemLifetimeMult = Math.max(0.1, current * opt.mult);
            return;
        }
        if (Number.isFinite(opt.val)) {
            this.game.itemLifetimeMult = Math.max(0.1, current + opt.val);
        }
    }

    applyEvolution(opt) {
        const weapon = this.getWeaponById(opt.requiresWeaponId);
        if (!weapon) return;

        if (opt.set && typeof opt.set === 'object') {
            Object.keys(opt.set).forEach(key => {
                weapon[key] = opt.set[key];
            });
        }

        if (opt.add && typeof opt.add === 'object') {
            Object.keys(opt.add).forEach(key => {
                if (!Number.isFinite(weapon[key])) weapon[key] = 0;
                if (Number.isFinite(opt.add[key])) weapon[key] += opt.add[key];
            });
        }

        if (Array.isArray(opt.addTags)) {
            if (!Array.isArray(weapon.tags)) weapon.tags = [];
            opt.addTags.forEach(tag => {
                if (!weapon.tags.includes(tag)) weapon.tags.push(tag);
            });
        }

        if (!Array.isArray(weapon.evolutions)) weapon.evolutions = [];
        if (!weapon.evolutions.includes(opt.id)) weapon.evolutions.push(opt.id);
    }

    applyAugment(opt) {
        if (!opt) return;
        if (opt.type === 'weapon_stat') {
            this.applyWeaponStat(opt);
            return;
        }
        if (opt.type === 'weapon_mod') {
            this.applyWeaponMod(opt);
            return;
        }
        if (opt.type === 'new_weapon') {
            this.game.weaponSystem.addWeapon(opt.weaponId);
            this.availableAugments = this.availableAugments.filter(a => a.id !== opt.id);
            return;
        }
        if (opt.type === 'drop_weight') {
            this.applyDropWeight(opt);
            return;
        }
        if (opt.type === 'item_lifetime') {
            this.applyItemLifetime(opt);
            return;
        }
        if (opt.type === 'evolution') {
            this.applyEvolution(opt);
        }
    }

    selectUpgrade(opt) {
        this.applyAugment(opt);
        if (opt && opt.repeatable !== true) {
            this.availableAugments = this.availableAugments.filter(a => a.id !== opt.id);
        }
        this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
        this.updateRerollUi();

        if (this.pendingLevelUps > 0) {
            const shown = this.showUpgradeMenu();
            if (!shown) {
                this.pendingLevelUps = 0;
                if (this.modal) this.modal.style.display = 'none';
                this.game.resume();
            }
            return;
        }

        if (this.modal) this.modal.style.display = 'none';
        this.currentLevelOptions = [];
        this.updateRerollUi();
        this.game.resume();
    }

    selectLootUpgrade(opt) {
        this.applyAugment(opt);
        if (!opt.repeatable) {
            this.availableLootAugments = this.availableLootAugments.filter(a => a.id !== opt.id);
        }
        if (this.lootModal) this.lootModal.style.display = 'none';
        this.currentLootOptions = [];
        if (this.game && typeof this.game.setPickupToast === 'function') {
            this.game.setPickupToast(opt.name, '#9c7b5c');
        }
        this.game.resume();
    }
}
