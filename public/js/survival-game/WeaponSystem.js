/**
 * WeaponSystem.js
 * Manages player weapons, cooldowns, and firing logic.
 */

import { GameConfig } from './GameConfig.js';

export default class WeaponSystem {
    constructor(game) {
        this.game = game;
        this.weapons = this.createBaseWeapons();
        this.activeWeaponIndex = 0;
        this.maxPendingShots = 30;
    }

    createBaseWeapons() {
        return [
            {
                id: 'compiler',
                name: 'Repeater',
                type: 'projectile',
                weaponClass: 'main',
                tags: ['kinetic', 'main', 'projectile'],
                damage: 10,
                cooldown: 0,
                baseCooldown: 0.2,
                speed: 800,
                color: '#b24c4c',
                level: 1,
                xp: 0,
                nextLevelXp: 14,
                projectiles: 1,
                spread: 0,
                pierce: 0,
                coldOnHit: false,
                coldDuration: 0,
                coldSpeedMult: 1,
                evolutions: [],
                queue: [],
                trigger: null
            }
        ];
    }

    reset() {
        this.weapons = this.createBaseWeapons();
        this.activeWeaponIndex = 0;
    }

    grantWeaponXp(weapon, amount = 1) {
        if (!weapon || !Number.isFinite(amount) || amount <= 0) return;
        if (!Number.isFinite(weapon.xp)) weapon.xp = 0;
        if (!Number.isFinite(weapon.nextLevelXp) || weapon.nextLevelXp <= 0) weapon.nextLevelXp = 14;

        weapon.xp += amount;
        let leveled = false;
        while (weapon.xp >= weapon.nextLevelXp) {
            weapon.xp -= weapon.nextLevelXp;
            weapon.level = (weapon.level || 1) + 1;
            weapon.nextLevelXp = Math.ceil(weapon.nextLevelXp * 1.25);
            leveled = true;
        }

        if (leveled && this.game && typeof this.game.setPickupToast === 'function') {
            this.game.setPickupToast(`${weapon.name} Lv ${weapon.level}`, weapon.color || '#2f2f2f');
        }
    }

    update(deltaTime) {
        // Update cooldowns
        this.weapons.forEach(w => {
            if (w.cooldown > 0) {
                w.cooldown = Math.max(0, w.cooldown - deltaTime);
            }
        });

        for (const weapon of this.weapons) {
            if (weapon.type === 'drone') {
                this.updateDroneWeapon(weapon, deltaTime);
                continue;
            }
            if (weapon.type === 'mine_trap') {
                this.updateMineWeapon(weapon, deltaTime);
                continue;
            }

            if (weapon.cooldown > 0 || weapon.queue.length === 0) continue;
            while (weapon.queue.length > 0) {
                const shot = weapon.queue.shift();
                if (!shot) continue;
                const fired = this.executeWeapon(weapon, shot.target, shot.word);
                if (!fired) continue;
                weapon.cooldown = weapon.baseCooldown;
                break;
            }
        }
    }

    trigger(target, word) {
        for (const weapon of this.weapons) {
            if (weapon.type === 'drone' || weapon.type === 'mine_trap') continue;
            if (!this.shouldTriggerWeapon(weapon, word)) continue;

            if (weapon.cooldown > 0) {
                if (weapon.queue.length < this.maxPendingShots) {
                    weapon.queue.push({ target, word });
                }
                continue;
            }

            const fired = this.executeWeapon(weapon, target, word);
            if (!fired) continue;
            weapon.cooldown = weapon.baseCooldown;
        }
    }

    executeWeapon(weapon, primaryTarget, word) {
        if (!weapon) return false;

        if (weapon.type === 'blast') {
            if (!primaryTarget || primaryTarget.isDead) return false;
            this.fireBlast(weapon, primaryTarget);
            this.grantWeaponXp(weapon, 1);
            this.game.audioManager.playShoot();
            return true;
        }

        const target = this.resolveTarget(weapon, primaryTarget);
        if (!target || target.isDead) return false;

        if (weapon.type === 'beam') {
            this.fireBeam(weapon, target);
            this.grantWeaponXp(weapon, 1);
            this.game.audioManager.playShoot();
            return true;
        }

        if (weapon.type === 'projectile') {
            this.fireProjectile(weapon, target);
            this.grantWeaponXp(weapon, 1);
            this.game.audioManager.playShoot();
            return true;
        }

        return false;
    }

    resolveTarget(weapon, primaryTarget) {
        if (!weapon || !weapon.targetMode || weapon.targetMode === 'primary') return primaryTarget;
        if (weapon.targetMode === 'nearest') return this.findNearestEnemy();
        if (weapon.targetMode === 'random') return this.findRandomEnemy();
        return primaryTarget;
    }

    findNearestEnemy(originX = null, originY = null, maxDistance = Infinity) {
        const enemies = this.game.entityManager ? this.game.entityManager.enemies : null;
        if (!enemies || enemies.length === 0) return null;
        const player = this.game.entityManager.player;
        const px = Number.isFinite(originX) ? originX : player.x;
        const py = Number.isFinite(originY) ? originY : player.y;
        const maxDistSq = Number.isFinite(maxDistance) ? (maxDistance * maxDistance) : Infinity;
        let best = null;
        let bestDistSq = Infinity;
        for (const e of enemies) {
            if (!e || e.isDead) continue;
            const dx = e.x - px;
            const dy = e.y - py;
            const d2 = (dx * dx) + (dy * dy);
            if (d2 > maxDistSq) continue;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                best = e;
            }
        }
        return best;
    }

    findRandomEnemy() {
        const enemies = this.game.entityManager ? this.game.entityManager.enemies : null;
        if (!enemies || enemies.length === 0) return null;
        const alive = enemies.filter(e => e && !e.isDead);
        if (alive.length === 0) return null;
        return alive[Math.floor(Math.random() * alive.length)];
    }

    updateDroneWeapon(weapon, deltaTime) {
        if (!weapon || !this.game || !this.game.entityManager || !this.game.entityManager.player) return;
        const player = this.game.entityManager.player;
        const droneCount = Math.max(1, Number.parseInt(weapon.droneCount || 1, 10) || 1);
        if (!Array.isArray(weapon.drones)) weapon.drones = [];

        while (weapon.drones.length < droneCount) {
            const idx = weapon.drones.length;
            weapon.drones.push({
                angle: (Math.PI * 2 * idx) / Math.max(1, droneCount),
                cooldown: Math.random() * Math.max(0.08, weapon.baseCooldown || 0.5),
                x: player.x,
                y: player.y
            });
        }
        if (weapon.drones.length > droneCount) {
            weapon.drones.length = droneCount;
        }

        for (let i = 0; i < weapon.drones.length; i++) {
            const drone = weapon.drones[i];
            const orbitRadius = Number.isFinite(weapon.orbitRadius) ? weapon.orbitRadius : 84;
            const orbitSpeed = Number.isFinite(weapon.orbitSpeed) ? weapon.orbitSpeed : 2.1;
            drone.angle += orbitSpeed * deltaTime;
            const phase = drone.angle + (i / Math.max(1, weapon.drones.length)) * Math.PI * 2;
            drone.x = player.x + Math.cos(phase) * orbitRadius;
            drone.y = player.y + Math.sin(phase) * orbitRadius;
            drone.cooldown = Math.max(0, (drone.cooldown || 0) - deltaTime);

            if (drone.cooldown > 0) continue;

            const target = this.findNearestEnemy(drone.x, drone.y, weapon.range || 520);
            if (!target || target.isDead) {
                drone.cooldown = Math.max(0.14, (weapon.baseCooldown || 0.5) * 0.45);
                continue;
            }

            const dx = target.x - drone.x;
            const dy = target.y - drone.y;
            const angle = Math.atan2(dy, dx);
            const damage = (weapon.damage || 5) * (this.game.damageMult || 1);
            const speed = weapon.speed || 780;

            this.game.entityManager.spawnBeam({
                x0: drone.x,
                y0: drone.y,
                x1: target.x,
                y1: target.y,
                color: weapon.color || '#6c7bf2',
                width: 1.8,
                duration: 0.09
            });

            this.game.entityManager.spawnProjectile({
                x: drone.x,
                y: drone.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                damage,
                color: weapon.color || '#6c7bf2',
                size: 3.2 + (weapon.level || 1) * 0.35,
                pierce: weapon.pierce || 0
            });

            this.grantWeaponXp(weapon, 0.7);
            if (this.game.audioManager) this.game.audioManager.playShoot();
            drone.cooldown = Math.max(0.08, weapon.baseCooldown || 0.5);
        }
    }

    updateMineWeapon(weapon, deltaTime) {
        if (!weapon || !this.game || !this.game.entityManager || !this.game.entityManager.player) return;
        const player = this.game.entityManager.player;
        if (!Array.isArray(weapon.mines)) weapon.mines = [];

        const maxMines = Math.max(1, Number.parseInt(weapon.maxMines || 3, 10) || 3);
        if (weapon.cooldown <= 0 && weapon.mines.length < maxMines) {
            this.deployMine(weapon, player);
            weapon.cooldown = Math.max(0.2, weapon.baseCooldown || 1.1);
            if (this.game.audioManager) this.game.audioManager.playShoot();
        }

        for (let i = weapon.mines.length - 1; i >= 0; i--) {
            const mine = weapon.mines[i];
            mine.life = Math.max(0, (mine.life || 0) - deltaTime);
            mine.armTime = Math.max(0, (mine.armTime || 0) - deltaTime);
            if (mine.life <= 0) {
                weapon.mines.splice(i, 1);
                continue;
            }
            if (mine.armTime > 0) continue;

            const triggerRadius = mine.triggerRadius || 62;
            const enemies = this.game.entityManager.enemies || [];
            let shouldExplode = false;
            for (const enemy of enemies) {
                if (!enemy || enemy.isDead) continue;
                const dx = enemy.x - mine.x;
                const dy = enemy.y - mine.y;
                if ((dx * dx) + (dy * dy) <= triggerRadius * triggerRadius) {
                    shouldExplode = true;
                    break;
                }
            }

            if (!shouldExplode) continue;
            this.explodeMine(weapon, i, mine);
        }
    }

    deployMine(weapon, player) {
        const spread = Math.min(this.game.width, this.game.height) * 0.16;
        const angle = Math.random() * Math.PI * 2;
        const radius = 42 + Math.random() * spread;
        const x = Math.max(24, Math.min(this.game.width - 24, player.x + Math.cos(angle) * radius));
        const y = Math.max(24, Math.min(this.game.height - 24, player.y + Math.sin(angle) * radius));
        weapon.mines.push({
            x,
            y,
            life: Number.isFinite(weapon.mineLife) ? weapon.mineLife : 10,
            armTime: Number.isFinite(weapon.mineArmTime) ? weapon.mineArmTime : 0.35,
            triggerRadius: Number.isFinite(weapon.triggerRadius) ? weapon.triggerRadius : 62
        });
    }

    explodeMine(weapon, mineIndex, mine) {
        if (!mine) return;
        const entityManager = this.game.entityManager;
        const radius = Number.isFinite(weapon.radius) ? weapon.radius : 150;
        const damage = (weapon.damage || 12) * (this.game.damageMult || 1);

        entityManager.spawnExplosion(mine.x, mine.y, weapon.color || '#4dabf7');
        const enemies = [...(entityManager.enemies || [])];
        for (const enemy of enemies) {
            if (!enemy || enemy.isDead) continue;
            const dx = enemy.x - mine.x;
            const dy = enemy.y - mine.y;
            if ((dx * dx) + (dy * dy) > radius * radius) continue;
            if (entityManager.isEnemyShieldBlocked(enemy)) continue;
            entityManager.applyEnemyDamage(enemy, damage, {
                sourceColor: weapon.color || '#4dabf7',
                refreshWord: true,
                playHit: false,
                spawnFx: true,
                fxKind: 'spark'
            });
        }

        weapon.mines.splice(mineIndex, 1);
        this.grantWeaponXp(weapon, 1.2);
    }

    getDroneInstances() {
        const instances = [];
        for (const weapon of this.weapons) {
            if (!weapon || weapon.type !== 'drone' || !Array.isArray(weapon.drones)) continue;
            for (const drone of weapon.drones) {
                instances.push({
                    x: drone.x,
                    y: drone.y,
                    color: weapon.color || '#6c7bf2',
                    size: Number.isFinite(weapon.droneSize) ? weapon.droneSize : 9
                });
            }
        }
        return instances;
    }

    getMineInstances() {
        const instances = [];
        for (const weapon of this.weapons) {
            if (!weapon || weapon.type !== 'mine_trap' || !Array.isArray(weapon.mines)) continue;
            for (const mine of weapon.mines) {
                instances.push({
                    x: mine.x,
                    y: mine.y,
                    color: weapon.color || '#4dabf7',
                    size: Number.isFinite(weapon.mineSize) ? weapon.mineSize : 8,
                    armTime: mine.armTime || 0
                });
            }
        }
        return instances;
    }

    shouldTriggerWeapon(weapon, word) {
        if (!weapon.trigger) return true;
        const input = (word || '').toLowerCase();
        if (!input) return false;

        if (weapon.trigger.type === 'containsAny') {
            return weapon.trigger.letters.some(letter => input.includes(letter));
        }
        if (weapon.trigger.type === 'containsAll') {
            return weapon.trigger.letters.every(letter => input.includes(letter));
        }
        if (weapon.trigger.type === 'startsWith') {
            return input.startsWith(weapon.trigger.value);
        }
        return true;
    }

    fireProjectile(weapon, target) {
        // Calculate angle to target
        const dx = target.x - this.game.entityManager.player.x;
        const dy = target.y - this.game.entityManager.player.y;
        const angle = Math.atan2(dy, dx);

        const combo = this.game.typingSystem ? this.game.typingSystem.combo : 0;
        const critChance = Math.min(GameConfig.COMBO.CRIT_MAX, combo * GameConfig.COMBO.CRIT_PER_HIT);
        const isCrit = Math.random() < critChance;
        const damage = weapon.damage * this.game.damageMult * (isCrit ? 2 : 1);

        // Snappy "laser connector" (Glyphica-style): draws and fades quickly.
        this.game.entityManager.spawnBeam({
            x0: this.game.entityManager.player.x,
            y0: this.game.entityManager.player.y,
            x1: target.x,
            y1: target.y,
            color: '#b24c4c',
            width: 2.5,
            duration: 0.12
        });

        const player = this.game.entityManager.player;
        const projectileCount = Math.max(1, Number.parseInt(weapon.projectiles || 1, 10) || 1);
        const rawSpread = Number.isFinite(weapon.spread) ? weapon.spread : 0;
        const hasSpread = Math.abs(rawSpread) >= 0.001;
        // If you add projectiles but have 0 spread, shots overlap and look like nothing changed.
        // Offset muzzle positions so the extra projectile is visible *and* still hits the target.
        const separation = projectileCount > 1 && !hasSpread ? 18 : 0;
        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);

        // Spawn projectiles based on weapon stats
        for (let i = 0; i < projectileCount; i++) {
            const offset = (i - (projectileCount - 1) / 2) * separation;
            const originX = player.x + perpX * offset;
            const originY = player.y + perpY * offset;
            const aimAngle = Math.atan2(target.y - originY, target.x - originX);
            const spreadAngle = hasSpread
                ? (i - (projectileCount - 1) / 2) * (rawSpread * (Math.PI / 180))
                : 0;
            const finalAngle = aimAngle + spreadAngle;

            this.game.entityManager.spawnProjectile({
                x: originX,
                y: originY,
                vx: Math.cos(finalAngle) * weapon.speed,
                vy: Math.sin(finalAngle) * weapon.speed,
                damage,
                color: isCrit ? '#2f2f2f' : weapon.color,
                size: 4 + (weapon.level * 1) + (isCrit ? 2 : 0),
                pierce: weapon.pierce || 0,
                coldDuration: weapon.coldOnHit ? (weapon.coldDuration || 0.8) : 0,
                coldSpeedMult: weapon.coldOnHit ? (weapon.coldSpeedMult || 0.55) : 1
            });
        }
    }

    fireBeam(weapon, target) {
        const player = this.game.entityManager.player;
        const dps = (weapon.dps || 10) * (weapon.level || 1) * 0.85;
        this.game.entityManager.spawnBeam({
            x0: player.x,
            y0: player.y,
            x1: target.x,
            y1: target.y,
            color: weapon.color || '#ff922b',
            width: weapon.width || 3.5,
            duration: weapon.duration || 0.75,
            dps,
            target,
            followTarget: true,
            refreshWordOnStart: true,
            bounceCount: Number.isFinite(weapon.beamBounces) ? weapon.beamBounces : 0,
            bounceDamageMult: Number.isFinite(weapon.beamBounceDamageMult) ? weapon.beamBounceDamageMult : 0.5,
            maxExtraTargets: Number.isFinite(weapon.maxExtraBeamTargets) ? weapon.maxExtraBeamTargets : 4
        });
    }

    fireBlast(weapon, target) {
        const entityManager = this.game.entityManager;
        const radius = weapon.radius || 140;
        const damage = (weapon.damage || 10) * (this.game.damageMult || 1);

        entityManager.spawnExplosion(target.x, target.y, weapon.color || '#4dabf7');
        const enemies = [...(entityManager.enemies || [])];
        for (const enemy of enemies) {
            if (!enemy || enemy.isDead) continue;
            const dx = enemy.x - target.x;
            const dy = enemy.y - target.y;
            if ((dx * dx) + (dy * dy) > radius * radius) continue;
            if (entityManager.isEnemyShieldBlocked(enemy)) continue;
            entityManager.applyEnemyDamage(enemy, damage, {
                sourceColor: weapon.color || '#4dabf7',
                refreshWord: true,
                playHit: false,
                spawnFx: true,
                fxKind: 'spark'
            });
        }
    }

    addWeapon(id) {
        // Logic to add new weapons (spread, chain, etc.)
        if (this.weapons.some(w => w.id === id)) return;
        if (id === 'broadcaster') {
            this.weapons.push({
                id: 'broadcaster',
                name: 'The Broadcaster',
                type: 'projectile',
                weaponClass: 'secondary',
                tags: ['kinetic', 'spread', 'projectile'],
                damage: 5,
                cooldown: 0,
                baseCooldown: 0.4,
                speed: 600,
                color: '#8a5353',
                level: 1,
                xp: 0,
                nextLevelXp: 16,
                projectiles: 3,
                spread: 15,
                pierce: 0,
                evolutions: [],
                queue: [],
                trigger: {
                    type: 'containsAny',
                    letters: ['i', 'o', 'u']
                }
            });
        } else if (id === 'heat_ray') {
            this.weapons.push({
                id: 'heat_ray',
                name: 'Heat Ray',
                type: 'beam',
                weaponClass: 'secondary',
                tags: ['heat', 'dot', 'beam'],
                dps: 18,
                cooldown: 0,
                baseCooldown: 0.35,
                duration: 0.8,
                width: 3.6,
                color: '#ff922b',
                level: 1,
                xp: 0,
                nextLevelXp: 16,
                beamBounces: 0,
                beamBounceDamageMult: 0.55,
                maxExtraBeamTargets: 4,
                evolutions: [],
                queue: [],
                targetMode: 'primary',
                trigger: null
            });
        } else if (id === 'minefield') {
            this.weapons.push({
                id: 'minefield',
                name: 'Minefield',
                type: 'blast',
                weaponClass: 'secondary',
                tags: ['kinetic', 'mine', 'blast'],
                damage: 14,
                cooldown: 0,
                baseCooldown: 1.1,
                radius: 150,
                color: '#4dabf7',
                level: 1,
                xp: 0,
                nextLevelXp: 16,
                evolutions: [],
                queue: [],
                targetMode: 'primary',
                trigger: {
                    type: 'containsAny',
                    letters: ['m', 'n']
                }
            });
        } else if (id === 'sentry') {
            this.weapons.push({
                id: 'sentry',
                name: 'Sentry',
                type: 'projectile',
                weaponClass: 'secondary',
                tags: ['heat', 'turret', 'projectile'],
                damage: 6,
                cooldown: 0,
                baseCooldown: 0.7,
                speed: 760,
                color: '#5c7cfa',
                level: 1,
                xp: 0,
                nextLevelXp: 16,
                projectiles: 1,
                spread: 0,
                pierce: 0,
                evolutions: [],
                queue: [],
                targetMode: 'nearest',
                trigger: null
            });
        } else if (id === 'spectre') {
            this.weapons.push({
                id: 'spectre',
                name: 'Spectre Drones',
                type: 'drone',
                weaponClass: 'secondary',
                tags: ['drone', 'kinetic', 'projectile'],
                damage: 5,
                cooldown: 0,
                baseCooldown: 0.52,
                speed: 780,
                color: '#2f2f2f',
                level: 1,
                xp: 0,
                nextLevelXp: 18,
                droneCount: 1,
                droneSize: 8,
                orbitRadius: 84,
                orbitSpeed: 2.2,
                range: 560,
                pierce: 0,
                evolutions: [],
                drones: [],
                queue: [],
                trigger: null
            });
        } else if (id === 'tesla_mines') {
            this.weapons.push({
                id: 'tesla_mines',
                name: 'Tesla Mines',
                type: 'mine_trap',
                weaponClass: 'secondary',
                tags: ['mine', 'kinetic', 'blast'],
                damage: 12,
                cooldown: 0,
                baseCooldown: 1.45,
                radius: 150,
                triggerRadius: 64,
                mineSize: 8,
                maxMines: 3,
                mineLife: 10,
                mineArmTime: 0.35,
                color: '#4dabf7',
                level: 1,
                xp: 0,
                nextLevelXp: 18,
                evolutions: [],
                mines: [],
                queue: [],
                trigger: null
            });
        }
    }

    upgradeWeapon(id, stat, amount) {
        const weapon = this.weapons.find(w => w.id === id);
        if (weapon) {
            if (weapon[stat] !== undefined) {
                weapon[stat] += amount;
                weapon.level++;
            }
        }
    }
}
