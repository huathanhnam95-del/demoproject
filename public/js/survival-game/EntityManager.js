/**
 * EntityManager.js
 * Manages all game entities (player, enemies, particles).
 * Optimized with Quadtree and Object Pooling.
 */
import Quadtree from './Quadtree.js';
import { GameConfig, GameStates } from './GameConfig.js';

export default class EntityManager {
    constructor(game) {
        this.game = game;
        this.player = {
            x: 0,
            y: 0,
            health: GameConfig.PLAYER.START_HEALTH,
            maxHealth: GameConfig.PLAYER.START_HEALTH,
            size: GameConfig.PLAYER.SIZE,
            color: GameConfig.PLAYER.COLOR
        };
        this.enemies = [];
        this.particles = [];
        this.projectiles = [];
        this.beams = [];
        this.items = [];
        this.shockwaves = [];

        // Projectile Pool
        this.projectilePool = [];

        // Particle Pool
        this.particlePool = [];
        this.maxParticles = 300;

        // Beam Pool (short-lived laser connectors)
        this.beamPool = [];
        this.maxBeams = 60;

        // Item Pool
        this.itemPool = [];
        this.maxItems = 25;

        // Shockwave Pool (simple ring FX for AoE items)
        this.shockwavePool = [];
        this.maxShockwaves = 10;

        this.spawnSeq = 0;
    }

    random() {
        return typeof this.game?.random === 'function' ? this.game.random() : Math.random();
    }

    reset() {
        this.player.maxHealth = GameConfig.PLAYER.START_HEALTH;
        this.player.health = this.player.maxHealth;
        this.player.size = GameConfig.PLAYER.SIZE;
        this.player.color = GameConfig.PLAYER.COLOR;
        this.enemies = [];
        this.particles = [];
        this.projectiles = [];
        this.beams = [];
        this.items = [];
        this.shockwaves = [];
        this.spawnSeq = 0;

        this.player.x = this.game.width / 2;
        this.player.y = this.game.height / 2;
    }

    update(deltaTime) {
        this.player.x = this.game.width / 2;
        this.player.y = this.game.height / 2;
        const freezeActive = this.game.freezeTimer > 0;
        const globalSpeedMult = freezeActive ? 0 : this.game.enemySpeedMult;

        // Build Quadtree for enemies
        const boundary = { x: 0, y: 0, width: this.game.width, height: this.game.height };
        let qtree = null;
        if (this.enemies.length > 0) {
            qtree = new Quadtree(boundary);
            for (let enemy of this.enemies) {
                if (!enemy || enemy.isDead) continue;
                qtree.insert(enemy);
            }
        }

        // Trait updates and buff prep
        for (const enemy of this.enemies) {
            if (!enemy || enemy.isDead) continue;
            enemy.speedMult = 1;
            enemy.damageMult = 1;
            enemy.isBuffed = false;
            enemy.isShieldLinked = false;
            enemy.linkedShield = null;

            if (enemy.isStealth && !freezeActive) {
                enemy.revealTimer += deltaTime;
                const baseIndex = Math.floor(enemy.revealTimer * enemy.revealRate);
                const minReveal = Math.min(2, enemy.word.length);
                enemy.revealIndex = Math.min(
                    enemy.word.length,
                    Math.max(enemy.revealIndex, Math.max(minReveal, baseIndex))
                );
            }

            if (enemy.isShielded && !freezeActive) {
                const cycle = enemy.shieldCycle;
                const phase = ((this.game.runTime + enemy.shieldOffset) % cycle) / cycle;
                enemy.shieldPhase = phase;
                enemy.shieldOpen = phase < enemy.shieldOpenFraction;
            }
        }

        // Apply buffer buffs
        if (qtree) {
            for (const bufferEnemy of this.enemies) {
                if (!bufferEnemy || bufferEnemy.isDead) continue;
                if (!bufferEnemy.isBuffer) continue;
                const r = bufferEnemy.bufferRadius;
                const range = {
                    x: bufferEnemy.x - r,
                    y: bufferEnemy.y - r,
                    width: r * 2,
                    height: r * 2
                };
                const neighbors = qtree.query(range);
                for (const neighbor of neighbors) {
                    if (neighbor === bufferEnemy) continue;
                    if (!neighbor || neighbor.isDead || neighbor.isProjectileEnemy) continue;
                    neighbor.speedMult = Math.max(neighbor.speedMult, bufferEnemy.bufferSpeedMult);
                    neighbor.damageMult = Math.max(neighbor.damageMult, bufferEnemy.bufferDamageMult);
                    neighbor.isBuffed = true;
                }
            }
        }

        // Shield links to nearby enemies (support shielding).
        if (qtree) {
            const linkRadius = GameConfig.ENEMIES.SHIELD_LINK.RADIUS;
            for (const shieldEnemy of this.enemies) {
                if (!shieldEnemy || shieldEnemy.isDead) continue;
                if (!shieldEnemy.isShielded) continue;
                const range = {
                    x: shieldEnemy.x - linkRadius,
                    y: shieldEnemy.y - linkRadius,
                    width: linkRadius * 2,
                    height: linkRadius * 2
                };
                const neighbors = qtree.query(range);
                for (const neighbor of neighbors) {
                    if (neighbor === shieldEnemy) continue;
                    if (!neighbor || neighbor.isDead || neighbor.isProjectileEnemy) continue;
                    neighbor.isShieldLinked = true;
                    neighbor.linkedShield = shieldEnemy;
                }
            }
        }

        // Update Projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.prevX = p.x;
            p.prevY = p.y;
            p.x += p.vx * deltaTime;
            p.y += p.vy * deltaTime;

            if (p.x < -100 || p.x > this.game.width + 100 || p.y < -100 || p.y > this.game.height + 100) {
                this.releaseProjectile(i);
                continue;
            }

            // Quadtree Query for collisions
            const range = {
                x: p.x - p.size - 20,
                y: p.y - p.size - 20,
                width: (p.size + 20) * 2,
                height: (p.size + 20) * 2
            };
            const candidates = qtree ? qtree.query(range) : [];

            for (let enemy of candidates) {
                if (enemy.isDead) continue;
                const dx = p.x - enemy.x;
                const dy = p.y - enemy.y;
                const hitRange = enemy.size + p.size;
                const distSq = (dx * dx) + (dy * dy);

                if (distSq < hitRange * hitRange) {
                    // Hit!
                    this.applyEnemyDamage(enemy, p.damage, {
                        sourceColor: p.color,
                        refreshWord: true,
                        playHit: true,
                        spawnFx: true,
                        fxKind: 'explosion'
                    });
                    if (Number.isFinite(p.coldDuration) && p.coldDuration > 0) {
                        this.applyEnemySlow(enemy, p.coldDuration, p.coldSpeedMult);
                    }

                    if (!p.pierce || p.pierce <= 0) {
                        this.releaseProjectile(i);
                        break;
                    } else {
                        p.pierce--;
                    }
                }
            }
        }

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy) {
                this.enemies.splice(i, 1);
                continue;
            }

            // Brief linger window after death (for fast typers).
            if (enemy.isDead) {
                const timer = Number.isFinite(enemy.deathTimer) ? enemy.deathTimer : 0;
                enemy.deathTimer = timer - deltaTime;
                if (enemy.deathTimer <= 0) {
                    this.enemies.splice(i, 1);
                    if (this.game.typingSystem.lockTarget === enemy) this.game.typingSystem.clearLock();
                }
                continue;
            }
            const dx = this.player.x - enemy.x;
            const dy = this.player.y - enemy.y;
            const distSq = (dx * dx) + (dy * dy);

            if (enemy.isProjectileEnemy) {
                if (!freezeActive) {
                    const shotMult = globalSpeedMult > 0 ? globalSpeedMult : 1;
                    enemy.x += enemy.vx * deltaTime * shotMult;
                    enemy.y += enemy.vy * deltaTime * shotMult;
                }

                const pdx = this.player.x - enemy.x;
                const pdy = this.player.y - enemy.y;
                const reach = (this.player.size + enemy.size) * (this.player.size + enemy.size);
                if ((pdx * pdx + pdy * pdy) <= reach && !freezeActive) {
                    this.applyPlayerHit(enemy.baseDamage * enemy.damageMult);
                    enemy.isDead = true;
                    this.enemies.splice(i, 1);
                    if (this.game.typingSystem.lockTarget === enemy) this.game.typingSystem.clearLock();
                    if (this.player.health <= 0) {
                        this.game.state = GameStates.GAME_OVER;
                        this.game.audioManager.playGameOver();
                    }
                } else if (
                    enemy.x < -120 || enemy.x > this.game.width + 120 ||
                    enemy.y < -120 || enemy.y > this.game.height + 120
                ) {
                    enemy.isDead = true;
                    this.enemies.splice(i, 1);
                    if (this.game.typingSystem.lockTarget === enemy) this.game.typingSystem.clearLock();
                }
                continue;
            }

            if (distSq > 25) {
                const distance = Math.sqrt(distSq);
                if (enemy.slowTimer && enemy.slowTimer > 0) {
                    enemy.slowTimer = Math.max(0, enemy.slowTimer - deltaTime);
                }
                const slowMult = enemy.slowTimer > 0 ? (enemy.slowMult || 1) : 1;
                const speed = enemy.baseSpeed * enemy.speedMult * globalSpeedMult * slowMult;

                if (enemy.type === 'turret') {
                    const stopDistance = enemy.stopDistance || GameConfig.ENEMIES.TURRET.STOP_DISTANCE;
                    if (distance > stopDistance) {
                        enemy.x += (dx / distance) * speed * deltaTime;
                        enemy.y += (dy / distance) * speed * deltaTime;
                    } else {
                        enemy.turretStopped = true;
                        if (!freezeActive) {
                            enemy.turretTimer += deltaTime;
                            if (enemy.turretTimer >= enemy.turretCooldown) {
                                this.spawnEnemyShot(enemy);
                                enemy.turretTimer = 0;
                            }
                        }
                    }
                } else {
                    enemy.x += (dx / distance) * speed * deltaTime;
                    enemy.y += (dy / distance) * speed * deltaTime;
                }
            } else {
                if (freezeActive) continue;
                this.applyPlayerHit(enemy.baseDamage * enemy.damageMult);
                enemy.isDead = true;
                this.enemies.splice(i, 1);
                if (this.game.typingSystem.lockTarget === enemy) this.game.typingSystem.clearLock();
                if (this.player.health <= 0) {
                    this.game.state = GameStates.GAME_OVER;
                    this.game.audioManager.playGameOver();
                }
                continue;
            }
        }

        if (!freezeActive) {
            this.resolveEnemyOverlaps(deltaTime);
        }

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(deltaTime);
            if (this.particles[i].life <= 0) this.releaseParticle(i);
        }

        // Update shockwaves (visual-only)
        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const sw = this.shockwaves[i];
            if (!sw) {
                this.shockwaves.splice(i, 1);
                continue;
            }
            sw.life = (sw.life || 0) - deltaTime;
            if (sw.life <= 0) {
                const expired = this.shockwaves.splice(i, 1)[0];
                if (expired) this.shockwavePool.push(expired);
            }
        }

        // Update items (timed pickups)
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!freezeActive) {
                item.life -= deltaTime;
                item.bob = (item.bob || 0) + deltaTime;
            }
            if (item.life <= 0) {
                const expired = this.items.splice(i, 1)[0];
                if (expired) this.itemPool.push(expired);
                if (this.game.typingSystem.lockTarget === item) this.game.typingSystem.clearLock();
            }
        }

        // Update beams
        for (let i = this.beams.length - 1; i >= 0; i--) {
            const beam = this.beams[i];
            this.updateBeam(beam, deltaTime);
            beam.life -= deltaTime / beam.duration;
            if (beam.life <= 0) this.releaseBeam(i);
        }
    }

    resolveEnemyOverlaps(deltaTime) {
        const enemies = this.enemies || [];
        if (enemies.length < 2) return;
        const padding = GameConfig.BALANCE?.ENEMY_OVERLAP_PADDING || 10;
        const maxPushPerStep = (GameConfig.BALANCE?.ENEMY_OVERLAP_PUSH || 70) * deltaTime;
        const minX = 8;
        const minY = 8;
        const maxX = Math.max(minX, this.game.width - 8);
        const maxY = Math.max(minY, this.game.height - 8);

        for (let i = 0; i < enemies.length - 1; i++) {
            const a = enemies[i];
            if (!a || a.isDead || a.isProjectileEnemy) continue;

            for (let j = i + 1; j < enemies.length; j++) {
                const b = enemies[j];
                if (!b || b.isDead || b.isProjectileEnemy) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const distSq = (dx * dx) + (dy * dy);
                const minDist = (a.size || 10) + (b.size || 10) + padding;
                const minDistSq = minDist * minDist;
                if (distSq >= minDistSq) continue;

                const dist = Math.sqrt(Math.max(0.0001, distSq));
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;
                const push = Math.min(overlap * 0.5, maxPushPerStep);

                a.x = Math.max(minX, Math.min(maxX, a.x - nx * push));
                a.y = Math.max(minY, Math.min(maxY, a.y - ny * push));
                b.x = Math.max(minX, Math.min(maxX, b.x + nx * push));
                b.y = Math.max(minY, Math.min(maxY, b.y + ny * push));
            }
        }
    }

    isEnemyShieldBlocked(enemy) {
        if (!enemy) return false;
        const shieldSource = enemy.isShielded ? enemy : (enemy.isShieldLinked ? enemy.linkedShield : null);
        return !!(shieldSource && shieldSource.isShielded && !shieldSource.shieldOpen);
    }

    applyEnemySlow(enemy, duration, speedMult = 0.6) {
        if (!enemy || enemy.isDead) return;
        const slowTime = Number.isFinite(duration) ? duration : 0;
        if (slowTime <= 0) return;
        const cappedSpeedMult = Number.isFinite(speedMult) ? Math.max(0.2, Math.min(1, speedMult)) : 0.6;
        enemy.slowTimer = Math.max(enemy.slowTimer || 0, slowTime);
        enemy.slowMult = Math.min(enemy.slowMult || 1, cappedSpeedMult);
    }

    applyEnemyDamage(enemy, amount, opts = {}) {
        if (!enemy || enemy.isDead) return { hit: false, killed: false };
        const {
            sourceColor = enemy.color,
            refreshWord = true,
            playHit = true,
            playKillSound = true,
            spawnFx = true,
            fxKind = 'explosion',
            skipItemDrop = false,
            suppressOnDeathEffects = false,
            deathGraceSeconds = null
        } = opts;

        let remaining = Math.max(0, amount || 0);
        let absorbed = 0;
        if (remaining > 0 && enemy.armor && enemy.armor > 0) {
            absorbed = Math.min(enemy.armor, remaining);
            enemy.armor -= absorbed;
            remaining -= absorbed;
        }

        const hit = absorbed > 0 || remaining > 0;
        if (!hit) return { hit: false, killed: false };

        if (remaining > 0) {
            enemy.health -= remaining;
        }
        enemy.lastHitTime = this.game.runTime;

        if (playHit) {
            this.game.audioManager.playHit();
        }
        if (spawnFx) {
            if (fxKind === 'spark') this.spawnHitSpark(enemy.x, enemy.y, sourceColor);
            else this.spawnExplosion(enemy.x, enemy.y, sourceColor);
        }

        if (enemy.health <= 0) {
            enemy.isDead = true;
            const grace = Number.isFinite(deathGraceSeconds)
                ? Math.max(0, deathGraceSeconds)
                : (GameConfig.TYPING?.DEATH_GRACE_SECONDS || 0.25);
            enemy.deathTimer = grace;
            enemy.deathTimerMax = grace;

            if (playKillSound) {
                this.game.audioManager.playExplosion();
            }

            const baseReward = 10 * (enemy.maxHealth / 10);
            const rushMult = (this.game && typeof this.game.getWordRushMultiplier === 'function')
                ? this.game.getWordRushMultiplier()
                : 1;
            const safeMult = Number.isFinite(rushMult) ? Math.max(1, rushMult) : 1;
            const reward = Number.isFinite(baseReward) ? Math.max(0, baseReward * safeMult) : 0;
            if (reward > 0) {
                this.game.score += reward;
                if (this.game.upgradeManager) {
                    this.game.upgradeManager.addXp(reward);
                }
            }
            if (!skipItemDrop) {
                this.maybeSpawnItem(enemy);
            }

            // Splitter Logic: Spawn mini-drones on death.
            if (!suppressOnDeathEffects && String(enemy.type || '').toLowerCase() === 'splitter') {
                const cfg = GameConfig.SPLITTER || {};
                const minCount = Number.isFinite(cfg.MINI_COUNT_MIN) ? cfg.MINI_COUNT_MIN : 2;
                const maxCount = Number.isFinite(cfg.MINI_COUNT_MAX) ? cfg.MINI_COUNT_MAX : 3;
                const minWord = Number.isFinite(cfg.MINI_WORD_MIN) ? cfg.MINI_WORD_MIN : 2;
                const maxWord = Number.isFinite(cfg.MINI_WORD_MAX) ? cfg.MINI_WORD_MAX : 4;
                const scatter = Number.isFinite(cfg.MINI_SCATTER) ? cfg.MINI_SCATTER : 34;

                let miniCount = Math.max(0, minCount + Math.floor(this.random() * (Math.max(minCount, maxCount) - minCount + 1)));

                // Keep splits from blowing past the player's WPM difficulty cap too aggressively.
                let activeLimit = Math.max(1, GameConfig.ENEMIES.MAX_ACTIVE || 80);
                if (this.game && typeof this.game.getSpawnLoadState === 'function') {
                    const load = this.game.getSpawnLoadState(maxWord);
                    const soft = Number.isFinite(load?.maxAllowed) ? (load.maxAllowed + 4) : activeLimit;
                    activeLimit = Math.min(activeLimit, soft);
                }
                const activeAlive = (this.enemies || []).reduce((count, e) => {
                    if (!e || e.isDead || e.isProjectileEnemy) return count;
                    return count + 1;
                }, 0);
                const room = Math.max(0, activeLimit - activeAlive);
                miniCount = Math.min(miniCount, room);

                const usedWords = new Set();
                for (let k = 0; k < miniCount; k++) {
                    const angle = this.random() * Math.PI * 2;
                    const dist = scatter * (0.4 + this.random() * 0.9);
                    const mx = enemy.x + Math.cos(angle) * dist;
                    const my = enemy.y + Math.sin(angle) * dist;

                    let miniWord = this.game.getShortWord(minWord, maxWord, enemy.word);
                    let safety = 0;
                    while (usedWords.has(miniWord) && safety < 8) {
                        miniWord = this.game.getShortWord(minWord, maxWord, miniWord);
                        safety++;
                    }
                    usedWords.add(miniWord);

                    const miniEnemy = this.spawnEnemy(miniWord, 'mini_drone', {}, { x: mx, y: my });
                    if (miniEnemy) {
                        miniEnemy.noItemDrop = true;
                        miniEnemy.splitParentId = enemy.id;
                    }
                }
            }

            return { hit: true, killed: true };
        }

        if (refreshWord && remaining > 0) {
            this.refreshEnemyWord(enemy);
        }
        return { hit: true, killed: false };
    }

    updateBeam(beam, deltaTime) {
        if (!beam) return;
        if (beam.followTarget && beam.target && !beam.target.isDead) {
            beam.x0 = this.player.x;
            beam.y0 = this.player.y;
            beam.x1 = beam.target.x;
            beam.y1 = beam.target.y;
        }

        const bounceCount = Number.isFinite(beam.bounceCount) ? Math.max(0, Math.floor(beam.bounceCount)) : 0;
        if (bounceCount > 0) {
            const dx = beam.x1 - beam.x0;
            const dy = beam.y1 - beam.y0;
            const len = Math.hypot(dx, dy) || 1;
            const reflectLength = Number.isFinite(beam.reflectLength)
                ? beam.reflectLength
                : Math.max(this.game.width, this.game.height) * 1.25;
            beam.segments = this.computeReflectedBeamSegments(beam.x0, beam.y0, dx / len, dy / len, reflectLength, bounceCount);
        } else {
            beam.segments = [{ x0: beam.x0, y0: beam.y0, x1: beam.x1, y1: beam.y1 }];
        }

        if (beam.dps && beam.target && !beam.target.isDead) {
            if (this.isEnemyShieldBlocked(beam.target)) return;

            if (beam.refreshWordOnStart && !beam._didRefreshWord) {
                this.refreshEnemyWord(beam.target);
                beam._didRefreshWord = true;
            }

            const dmg = beam.dps * deltaTime * (this.game.damageMult || 1);
            this.applyEnemyDamage(beam.target, dmg, {
                sourceColor: beam.color || beam.target.color,
                refreshWord: false,
                playHit: false,
                spawnFx: false
            });

            if (bounceCount > 0 && Number.isFinite(beam.bounceDamageMult) && beam.bounceDamageMult > 0) {
                const extraDamage = dmg * beam.bounceDamageMult;
                const maxExtraTargets = Number.isFinite(beam.maxExtraTargets) ? Math.max(1, Math.floor(beam.maxExtraTargets)) : 4;
                let hitCount = 0;

                for (const enemy of this.enemies) {
                    if (!enemy || enemy.isDead || enemy === beam.target) continue;
                    if (this.isEnemyShieldBlocked(enemy)) continue;
                    const hitRadius = (enemy.size || 10) + (beam.width || 2) + 3;
                    if (!this.isPointNearBeamSegments(enemy.x, enemy.y, hitRadius, beam.segments)) continue;
                    this.applyEnemyDamage(enemy, extraDamage, {
                        sourceColor: beam.color || enemy.color,
                        refreshWord: false,
                        playHit: false,
                        spawnFx: false
                    });
                    hitCount++;
                    if (hitCount >= maxExtraTargets) break;
                }
            }

            beam._fxTimer = (beam._fxTimer || 0) - deltaTime;
            if (beam._fxTimer <= 0) {
                this.spawnHitSpark(beam.target.x, beam.target.y, beam.color || beam.target.color);
                beam._fxTimer = 0.12;
            }
        }
    }

    computeReflectedBeamSegments(x0, y0, dirX, dirY, totalLength, bounceCount) {
        const segments = [];
        const maxLength = Math.max(0, totalLength || 0);
        if (maxLength <= 0) return segments;

        let remaining = maxLength;
        let sx = x0;
        let sy = y0;
        let dx = dirX;
        let dy = dirY;
        const eps = 0.0001;
        const maxBounces = Math.max(0, bounceCount);

        for (let bounce = 0; bounce <= maxBounces && remaining > 0.001; bounce++) {
            const hit = this.getRayBoundsHit(sx, sy, dx, dy, remaining);
            if (!hit) {
                segments.push({
                    x0: sx,
                    y0: sy,
                    x1: sx + dx * remaining,
                    y1: sy + dy * remaining
                });
                break;
            }

            segments.push({ x0: sx, y0: sy, x1: hit.x, y1: hit.y });
            remaining -= hit.distance;
            if (remaining <= 0.001) break;
            if (bounce === maxBounces) break;

            if (hit.hitVertical) dx = -dx;
            if (hit.hitHorizontal) dy = -dy;
            sx = hit.x + dx * eps;
            sy = hit.y + dy * eps;
        }

        return segments;
    }

    getRayBoundsHit(startX, startY, dirX, dirY, maxDistance) {
        const minX = 0;
        const minY = 0;
        const maxX = this.game.width;
        const maxY = this.game.height;
        let tx = Infinity;
        let ty = Infinity;

        if (Math.abs(dirX) > 0.000001) {
            tx = dirX > 0 ? (maxX - startX) / dirX : (minX - startX) / dirX;
        }
        if (Math.abs(dirY) > 0.000001) {
            ty = dirY > 0 ? (maxY - startY) / dirY : (minY - startY) / dirY;
        }

        const candidates = [tx, ty].filter(t => Number.isFinite(t) && t > 0.000001);
        if (candidates.length === 0) return null;

        const distance = Math.min(...candidates);
        if (distance > maxDistance) return null;

        const x = startX + dirX * distance;
        const y = startY + dirY * distance;
        const hitVertical = Math.abs(distance - tx) < 0.0001;
        const hitHorizontal = Math.abs(distance - ty) < 0.0001;
        return { x, y, distance, hitVertical, hitHorizontal };
    }

    distancePointToSegmentSq(px, py, x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const lenSq = (dx * dx) + (dy * dy);
        if (lenSq <= 0.000001) {
            const qx = px - x0;
            const qy = py - y0;
            return (qx * qx) + (qy * qy);
        }

        let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = x0 + t * dx;
        const projY = y0 + t * dy;
        const ex = px - projX;
        const ey = py - projY;
        return (ex * ex) + (ey * ey);
    }

    isPointNearBeamSegments(px, py, radius, segments) {
        if (!Array.isArray(segments) || segments.length === 0) return false;
        const radiusSq = radius * radius;
        for (const segment of segments) {
            if (!segment) continue;
            const distSq = this.distancePointToSegmentSq(px, py, segment.x0, segment.y0, segment.x1, segment.y1);
            if (distSq <= radiusSq) return true;
        }
        return false;
    }

    spawnProjectile(data) {
        let p = this.projectilePool.pop();
        if (p) {
            Object.assign(p, data);
        } else {
            p = { ...data };
        }
        p.prevX = p.x;
        p.prevY = p.y;
        this.projectiles.push(p);
    }

    releaseProjectile(index) {
        const p = this.projectiles.splice(index, 1)[0];
        if (p) this.projectilePool.push(p);
    }

    releaseParticle(index) {
        const p = this.particles.splice(index, 1)[0];
        if (p) this.particlePool.push(p);
    }

    spawnBeam(data) {
        if (this.beams.length >= this.maxBeams) return;
        let beam = this.beamPool.pop();
        if (beam) {
            Object.assign(beam, data);
        } else {
            beam = { ...data };
        }
        beam.life = 1.0;
        if (!beam.duration || beam.duration <= 0) beam.duration = 0.09;
        // Beams are pooled; explicitly reset optional fields to avoid leaks between beam types.
        beam.dps = Number.isFinite(data.dps) ? data.dps : 0;
        beam.target = data.target || null;
        beam.followTarget = !!data.followTarget;
        beam.refreshWordOnStart = !!data.refreshWordOnStart;
        beam.bounceCount = Number.isFinite(data.bounceCount) ? Math.max(0, Math.floor(data.bounceCount)) : 0;
        beam.bounceDamageMult = Number.isFinite(data.bounceDamageMult) ? Math.max(0, data.bounceDamageMult) : 0;
        beam.maxExtraTargets = Number.isFinite(data.maxExtraTargets) ? Math.max(1, Math.floor(data.maxExtraTargets)) : 4;
        beam.reflectLength = Number.isFinite(data.reflectLength) ? Math.max(40, data.reflectLength) : 0;
        beam.segments = Array.isArray(data.segments) ? data.segments : [];
        beam._didRefreshWord = false;
        beam._fxTimer = 0;
        this.beams.push(beam);
    }

    releaseBeam(index) {
        const beam = this.beams.splice(index, 1)[0];
        if (beam) this.beamPool.push(beam);
    }

    applyPlayerHit(amount) {
        const player = this.player;
        if (player.shieldCharges && player.shieldCharges > 0) {
            player.shieldCharges -= 1;
            this.game.screenFlash = Math.min(1, (this.game.screenFlash || 0) + 0.25);
            this.game.screenFlashKind = 'block';
            return;
        }
        player.health -= amount;
        player.lastHitTime = this.game.runTime;
        this.game.cameraShake = Math.min(1, (this.game.cameraShake || 0) + 0.65);
        this.game.screenFlash = Math.min(1, (this.game.screenFlash || 0) + 0.75);
        this.game.screenFlashKind = 'damage';
    }

    spawnEnemyShot(originEnemy) {
        const typeConfig = GameConfig.ENEMIES.TYPES.SHOT;
        const word = this.game.getProjectileWord();
        const angle = Math.atan2(this.player.y - originEnemy.y, this.player.x - originEnemy.x);
        const speed = GameConfig.ENEMIES.TURRET.SHOT_SPEED
            * (GameConfig.BALANCE?.ENEMY_SPEED_MULT || 1)
            * this.game.omenConfig.speedMult;

        const enemy = {
            id: 's_' + this.random().toString(36).substr(2, 9),
            x: originEnemy.x,
            y: originEnemy.y,
            word,
            typedIndex: 0,
            spawnTime: this.game.runTime,
            lastHitTime: -999,
            lastBlockTime: -999,
            baseSpeed: speed,
            baseDamage: GameConfig.ENEMIES.BASE_DAMAGE * (typeConfig.dmgMult || 1),
            size: typeConfig.size || 9,
            color: typeConfig.color || '#8a5353',
            type: 'shot',
            health: GameConfig.ENEMIES.BASE_HEALTH * (typeConfig.hpMult || 1),
            maxHealth: GameConfig.ENEMIES.BASE_HEALTH * (typeConfig.hpMult || 1),
            isDead: false,
            spawnOrder: this.spawnSeq++,
            armor: 0,
            isStealth: false,
            revealIndex: word.length,
            revealTimer: 0,
            revealRate: GameConfig.ENEMIES.TRAITS.STEALTH.REVEAL_RATE,
            isShielded: false,
            shieldCycle: 0,
            shieldOpenFraction: 0,
            shieldOffset: 0,
            shieldOpen: true,
            shieldPhase: 0,
            isBuffer: false,
            bufferRadius: 0,
            bufferSpeedMult: 1,
            bufferDamageMult: 1,
            speedMult: 1,
            damageMult: 1,
            isBuffed: false,
            slowTimer: 0,
            slowMult: 1,
            isProjectileEnemy: true,
            ringCount: 0,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed
        };

        this.enemies.push(enemy);
        if (this.game && typeof this.game.onEnemySpawned === 'function') {
            this.game.onEnemySpawned(enemy);
        }
        return enemy;
    }

    spawnItem(typeKey, x, y) {
        if (this.items.length >= this.maxItems) return;
        const cfg = Object.values(GameConfig.ITEMS.TYPES).find(entry => entry.key === typeKey);
        const color = cfg ? cfg.color : '#7d6c8d';
        const lifeMult = Number.isFinite(this.game.itemLifetimeMult) ? this.game.itemLifetimeMult : 1;
        const itemLife = Math.max(0.5, GameConfig.ITEMS.LIFETIME * lifeMult);
        let item = this.itemPool.pop();
        if (!item) item = {};
        Object.assign(item, {
            id: 'i_' + this.random().toString(36).substr(2, 9),
            x,
            y,
            word: this.game.getItemWord(),
            typedIndex: 0,
            type: typeKey,
            isItem: true,
            spawnTime: this.game.runTime,
            life: itemLife,
            maxLife: itemLife,
            color,
            size: 12,
            bob: 0
        });
        this.items.push(item);
        return item;
    }

    collectItem(item) {
        if (!item) return;
        this.game.applyItemPickup(item);
        const idx = this.items.indexOf(item);
        if (idx !== -1) this.items.splice(idx, 1);
        if (this.game.typingSystem.lockTarget === item) this.game.typingSystem.clearLock();
        this.itemPool.push(item);
    }

    maybeSpawnItem(enemy) {
        if (!enemy || enemy.isProjectileEnemy || enemy.noItemDrop) return;
        if (this.random() > GameConfig.ITEMS.DROP_CHANCE) return;

        const weights = { ...GameConfig.ITEMS.WEIGHTS };
        const bonus = this.game.itemWeightBonus || {};
        Object.keys(weights).forEach(key => {
            if (!Number.isFinite(bonus[key])) return;
            weights[key] = Math.max(0, weights[key] * bonus[key]);
        });
        const player = this.player;
        if (player.health / player.maxHealth > GameConfig.ITEMS.HEALTH_DROP_THRESHOLD) {
            delete weights.health;
        }

        const pool = Object.entries(weights);
        const total = pool.reduce((sum, [, w]) => sum + w, 0);
        if (total <= 0) return;
        let roll = this.random() * total;
        let picked = pool[0][0];
        for (const [key, weight] of pool) {
            roll -= weight;
            if (roll <= 0) {
                picked = key;
                break;
            }
        }
        this.spawnItem(picked, enemy.x, enemy.y);
    }

    spawnBossEnemy(spec = {}) {
        const safeSpec = spec && typeof spec === 'object' ? spec : {};
        const rawId = String(safeSpec.id || safeSpec.bossId || 'boss').trim().toLowerCase();
        const bossId = rawId || 'boss';
        const bossName = String(safeSpec.name || bossId).trim() || bossId;
        const bossType = String(safeSpec.type || 'tank').toLowerCase();
        const bossTraits = (safeSpec.traits && typeof safeSpec.traits === 'object') ? safeSpec.traits : {};
        const bossWord = this.game.getBossWord ? this.game.getBossWord(safeSpec) : this.game.getWordForDifficulty();

        const enemy = this.spawnEnemy(bossWord, bossType, bossTraits);
        if (!enemy) return null;

        const healthOverride = Number.isFinite(safeSpec.health) ? safeSpec.health : null;
        const speedMult = Number.isFinite(safeSpec.speedMult) ? safeSpec.speedMult : 1;
        const damageMult = Number.isFinite(safeSpec.damageMult) ? safeSpec.damageMult : 1;
        const sizeOverride = Number.isFinite(safeSpec.size)
            ? Math.max(20, Math.min(120, safeSpec.size))
            : null;
        const ringCountOverride = Number.isFinite(safeSpec.ringCount)
            ? Math.max(1, Math.floor(safeSpec.ringCount))
            : null;

        if (sizeOverride) enemy.size = sizeOverride;
        if (safeSpec.color) enemy.color = safeSpec.color;

        if (healthOverride && healthOverride > 0) {
            enemy.health = healthOverride;
            enemy.maxHealth = healthOverride;
        } else {
            const boostedHealth = Math.max(enemy.maxHealth * 3.5, enemy.maxHealth + 220);
            enemy.health = boostedHealth;
            enemy.maxHealth = boostedHealth;
        }

        enemy.baseSpeed = Math.max(18, enemy.baseSpeed * speedMult);
        enemy.baseDamage = Math.max(6, enemy.baseDamage * damageMult);
        enemy.ringCount = ringCountOverride || Math.max(enemy.ringCount || 0, 3);
        enemy.turretRank = Math.max(enemy.turretRank || 0, 2);

        enemy.isBoss = true;
        enemy.bossId = bossId;
        enemy.bossName = bossName;
        enemy.noItemDrop = safeSpec.noItemDrop === true;
        return enemy;
    }

    spawnEnemy(word, type = 'drone', traits = {}, spawnPosOverride = null) {
        const safeWord = String(word || 'target');

        const w = this.game.width;
        const h = this.game.height;
        const safeType = String(type || 'drone').trim().toLowerCase() || 'drone';
        const typeKey = safeType.toUpperCase();
        const typeConfig = GameConfig.ENEMIES.TYPES[typeKey] || GameConfig.ENEMIES.TYPES.DRONE;
        const size = typeConfig.size || 15;
        const spawnInset = (() => {
            const minDim = Math.min(w || 0, h || 0);
            return Math.max(22, Math.min(70, minDim * 0.04));
        })();

        const spawnPos = (spawnPosOverride && Number.isFinite(spawnPosOverride.x) && Number.isFinite(spawnPosOverride.y))
            ? { x: spawnPosOverride.x, y: spawnPosOverride.y }
            : this.findNonOverlappingSpawnPosition(size, spawnInset, w, h);

        const minX = 8;
        const minY = 8;
        const maxX = Math.max(minX, w - 8);
        const maxY = Math.max(minY, h - 8);
        const x = Math.max(minX, Math.min(maxX, spawnPos.x));
        const y = Math.max(minY, Math.min(maxY, spawnPos.y));
        const speedBase = GameConfig.ENEMIES.BASE_SPEED + (this.game.difficulty * 5);
        const baseDamage = GameConfig.ENEMIES.BASE_DAMAGE * (typeConfig.dmgMult || 1);
        const color = typeConfig.color || '#ff6b6b';
        const lengthBonus = Math.max(0, safeWord.length - 4) * GameConfig.ENEMIES.HEALTH_PER_CHAR;
        const health = (GameConfig.ENEMIES.BASE_HEALTH * (typeConfig.hpMult || 1)) + lengthBonus;

        // Balance movement for wide screens: spawns from top/bottom travel a shorter distance, so slow them down.
        const spawnDist = Math.hypot(this.player.x - x, this.player.y - y);
        const refDist = Math.max(1, (Math.max(w || 0, h || 0) / 2));
        const distRatio = refDist > 0 ? Math.min(1, spawnDist / refDist) : 1;
        const approachScale = Math.max(0.55, Math.pow(distRatio, 0.8));

        // Higher HP enemies should move slower (harder to kill).
        const hpRatio = GameConfig.ENEMIES.BASE_HEALTH > 0 ? (health / GameConfig.ENEMIES.BASE_HEALTH) : 1;
        const hpScale = Math.max(0.55, Math.min(1, 1 / Math.pow(Math.max(1, hpRatio), 0.25)));

        const baseSpeed = speedBase
            * (GameConfig.BALANCE?.ENEMY_SPEED_MULT || 1)
            * (typeConfig.speedMult || 1)
            * this.game.omenConfig.speedMult
            * approachScale
            * hpScale;
        let ringCount = 0;
        if (safeType === 'drone') {
            ringCount = Math.min(3, Math.max(0, Math.floor((health / GameConfig.ENEMIES.BASE_HEALTH) - 1)));
        }
        let turretRank = 0;
        if (safeType === 'turret') {
            turretRank = (this.game.wave >= 8 || health > GameConfig.ENEMIES.BASE_HEALTH * 2) ? 2 : 1;
        }

        const enemy = {
            id: 'e_' + this.random().toString(36).substr(2, 9),
            x, y, word: safeWord, typedIndex: 0,
            spawnTime: this.game.runTime,
            lastHitTime: -999,
            lastBlockTime: -999,
            baseSpeed,
            baseDamage,
            size,
            color,
            type: safeType,
            health,
            maxHealth: health,
            isDead: false,
            spawnOrder: this.spawnSeq++,
            armor: 0,
            isStealth: false,
            revealIndex: safeWord.length,
            revealTimer: 0,
            revealRate: GameConfig.ENEMIES.TRAITS.STEALTH.REVEAL_RATE,
            isShielded: false,
            shieldCycle: GameConfig.ENEMIES.TRAITS.SHIELD.CYCLE_TIME,
            shieldOpenFraction: GameConfig.ENEMIES.TRAITS.SHIELD.OPEN_FRACTION,
            shieldOffset: this.random() * GameConfig.ENEMIES.TRAITS.SHIELD.CYCLE_TIME,
            shieldOpen: true,
            shieldPhase: 0,
            isBuffer: false,
            bufferRadius: GameConfig.ENEMIES.TRAITS.BUFFER.RADIUS,
            bufferSpeedMult: GameConfig.ENEMIES.TRAITS.BUFFER.SPEED_MULT,
            bufferDamageMult: GameConfig.ENEMIES.TRAITS.BUFFER.DAMAGE_MULT,
            speedMult: 1,
            damageMult: 1,
            isBuffed: false,
            slowTimer: 0,
            slowMult: 1,
            isProjectileEnemy: false,
            ringCount,
            turretStopped: false,
            turretTimer: 0,
            turretCooldown: GameConfig.ENEMIES.TURRET.SHOT_COOLDOWN,
            stopDistance: GameConfig.ENEMIES.TURRET.STOP_DISTANCE,
            turretRank
        };

        if (traits.armor) {
            enemy.armor = GameConfig.ENEMIES.TRAITS.ARMOR.ARMOR_BASE
                + (this.game.wave * GameConfig.ENEMIES.TRAITS.ARMOR.ARMOR_PER_WAVE);
        }
        if (traits.stealth) {
            enemy.isStealth = true;
            enemy.revealIndex = Math.min(2, safeWord.length);
            enemy.revealTimer = 0;
            enemy.revealRate = GameConfig.ENEMIES.TRAITS.STEALTH.REVEAL_RATE + (this.game.wave * 0.05);
        }
        if (traits.shield) {
            enemy.isShielded = true;
            enemy.shieldCycle = GameConfig.ENEMIES.TRAITS.SHIELD.CYCLE_TIME;
            enemy.shieldOpenFraction = GameConfig.ENEMIES.TRAITS.SHIELD.OPEN_FRACTION;
            enemy.shieldOffset = this.random() * enemy.shieldCycle;
            enemy.shieldOpen = false;
            enemy.shieldPhase = 0;
        }
        if (traits.buffer) {
            enemy.isBuffer = true;
            enemy.bufferRadius = GameConfig.ENEMIES.TRAITS.BUFFER.RADIUS;
            enemy.bufferSpeedMult = GameConfig.ENEMIES.TRAITS.BUFFER.SPEED_MULT;
            enemy.bufferDamageMult = GameConfig.ENEMIES.TRAITS.BUFFER.DAMAGE_MULT;
        }

        if (enemy.type === 'turret') {
            enemy.turretTimer = this.random() * enemy.turretCooldown;
        }

        this.enemies.push(enemy);
        if (this.game && typeof this.game.onEnemySpawned === 'function') {
            this.game.onEnemySpawned(enemy);
        }
        return enemy;
    }

    pickEdgeSpawnPoint(spawnInset, w, h) {
        let x = this.player.x;
        let y = this.player.y;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            return { x, y };
        }

        const rangeX = Math.max(0, w - spawnInset * 2);
        const rangeY = Math.max(0, h - spawnInset * 2);
        const side = this.random();
        if (side < 0.25) {
            x = spawnInset;
            y = spawnInset + this.random() * rangeY;
        } else if (side < 0.5) {
            x = w - spawnInset;
            y = spawnInset + this.random() * rangeY;
        } else if (side < 0.75) {
            x = spawnInset + this.random() * rangeX;
            y = spawnInset;
        } else {
            x = spawnInset + this.random() * rangeX;
            y = h - spawnInset;
        }
        return { x, y };
    }

    hasSpawnClearance(x, y, size) {
        const padding = GameConfig.BALANCE?.ENEMY_OVERLAP_PADDING || 10;
        for (const enemy of this.enemies) {
            if (!enemy || enemy.isDead || enemy.isProjectileEnemy) continue;
            const minDist = (enemy.size || 10) + (size || 10) + padding;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            if ((dx * dx) + (dy * dy) < minDist * minDist) return false;
        }
        return true;
    }

    findNonOverlappingSpawnPosition(size, spawnInset, w, h) {
        let candidate = this.pickEdgeSpawnPoint(spawnInset, w, h);
        if (this.hasSpawnClearance(candidate.x, candidate.y, size)) return candidate;

        for (let attempt = 0; attempt < 20; attempt++) {
            candidate = this.pickEdgeSpawnPoint(spawnInset, w, h);
            if (this.hasSpawnClearance(candidate.x, candidate.y, size)) return candidate;
        }
        return candidate;
    }

    spawnParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            if (this.particles.length >= this.maxParticles) break;
            let p = this.particlePool.pop();
            if (p) {
                p.reset(x, y, color);
            } else {
                p = new Particle(x, y, color, this.random.bind(this));
            }
            this.particles.push(p);
        }
    }

    spawnExplosion(x, y, color) {
        this.spawnParticles(x, y, color, 8);
    }

    spawnHitSpark(x, y, color) {
        this.spawnParticles(x, y, color, 4);
    }

    spawnShockwave(x, y, radius, color = '#e0a800', duration = 0.55) {
        if (this.shockwaves.length >= this.maxShockwaves) return null;
        const r = Number.isFinite(radius) ? Math.max(60, radius) : 360;
        const life = Number.isFinite(duration) ? Math.max(0.15, duration) : 0.55;
        let sw = this.shockwavePool.pop();
        if (!sw) sw = {};
        Object.assign(sw, {
            x,
            y,
            radius: r,
            color,
            life,
            maxLife: life
        });
        this.shockwaves.push(sw);
        return sw;
    }

    refreshEnemyWord(enemy) {
        const now = this.game.runTime || 0;
        if (enemy.lastRefreshTime != null && (now - enemy.lastRefreshTime) < 0.08) return;
        enemy.lastRefreshTime = now;

        const newWord = this.game.getWordForDifficulty(enemy.word);
        enemy.word = newWord;
        enemy.typedIndex = 0;
        enemy.textWidth = null;
        if (enemy.isStealth) {
            enemy.revealIndex = Math.min(2, newWord.length);
            enemy.revealTimer = 0;
        } else {
            enemy.revealIndex = newWord.length;
        }
    }

    getAllEntities() {
        return [
            ...(this.player ? [this.player] : []),
            ...this.enemies,
            ...this.projectiles,
            ...this.items
        ];
    }
}

class Particle {
    constructor(x, y, color, random = Math.random) {
        this.random = random;
        this.reset(x, y, color);
    }

    reset(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        const random = this.random || Math.random;
        const angle = random() * Math.PI * 2;
        const speed = random() * 120 + 60;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1.0;
        this.size = random() * 2 + 1;
        this.rot = random() * Math.PI * 2;
        this.vr = (random() - 0.5) * 14;
        this.shape = random() < 0.55 ? 'line' : 'tri';
        this.len = random() * 10 + 6;
    }

    update(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.life -= deltaTime * 3.4;
        this.rot += this.vr * deltaTime;
    }
}
