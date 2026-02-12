/**
 * TypingSystem.js
 * Handles keyboard input and word matching for the survival game.
 */

import { GameConfig } from './GameConfig.js';

export default class TypingSystem {
    constructor(entityManager) {
        this.entityManager = entityManager;
        this.lockTarget = null;
        this.mistakePenalty = 0;
        this.lockTimer = 0;
        this.idleTimer = 0;
        this.pendingPrefix = '';
        this.pendingTargets = new Set();
        this.combo = 0;
        this.bestCombo = 0;
    }

    reset() {
        this.lockTarget = null;
        this.mistakePenalty = 0;
        this.lockTimer = 0;
        this.idleTimer = 0;
        this.pendingPrefix = '';
        this.pendingTargets.clear();
        this.combo = 0;
        this.bestCombo = 0;
    }

    getExpectedChar(enemy) {
        if (!enemy || !enemy.word || enemy.word.length === 0) return "";
        if (enemy.isItem) {
            if (enemy.typedIndex === undefined || enemy.typedIndex >= enemy.word.length) {
                enemy.typedIndex = 0;
            }
            return enemy.word[enemy.typedIndex];
        }
        if (enemy.isShielded && !enemy.shieldOpen) return "";
        if (enemy.isShieldLinked && enemy.linkedShield && !enemy.linkedShield.shieldOpen) return "";
        if (enemy.typedIndex === undefined || enemy.typedIndex >= enemy.word.length) {
            enemy.typedIndex = 0;
        }
        if (enemy.isStealth && enemy.typedIndex >= enemy.revealIndex) return "";
        return enemy.word[enemy.typedIndex];
    }

    isTargetable(enemy) {
        if (!enemy || !enemy.word) return false;
        if (enemy.isItem) return true;
        if (enemy.isShielded && !enemy.shieldOpen) return false;
        if (enemy.isShieldLinked && enemy.linkedShield && !enemy.linkedShield.shieldOpen) return false;
        if (enemy.isStealth && enemy.revealIndex <= 0) return false;
        return true;
    }

    matchesPrefix(enemy, prefix) {
        if (!this.isTargetable(enemy)) return false;
        if (!prefix) return false;
        if (enemy.isStealth && prefix.length > enemy.revealIndex) return false;
        return enemy.word.toLowerCase().startsWith(prefix.toLowerCase());
    }

    findCandidates(prefix) {
        const matches = [];
        const enemyList = this.entityManager.enemies || [];
        const itemList = this.entityManager.items || [];
        for (const enemy of enemyList) {
            if (this.matchesPrefix(enemy, prefix)) matches.push(enemy);
        }
        for (const item of itemList) {
            if (this.matchesPrefix(item, prefix)) matches.push(item);
        }
        return matches;
    }

    isPending(enemy) {
        return this.pendingTargets.has(enemy);
    }

    getDisplayTypedIndex(enemy) {
        if (this.lockTarget === enemy) {
            return enemy.typedIndex || 0;
        }
        if (this.isPending(enemy)) {
            const maxIndex = enemy.isStealth ? enemy.revealIndex : enemy.word.length;
            return Math.min(this.pendingPrefix.length, maxIndex);
        }
        return enemy.typedIndex || 0;
    }

    getTargetScore(enemy, player) {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const distSq = (dx * dx) + (dy * dy);
        let threatFactor = 1;
        if (enemy.type === 'rusher') threatFactor = 1.35;
        if (enemy.type === 'tank') threatFactor = 0.85;
        return distSq / (threatFactor * threatFactor);
    }

    completeTarget(target) {
        if (!target) return;
        if (target.isItem) {
            this.entityManager.collectItem(target);
        } else {
            this.entityManager.game.weaponSystem.trigger(target, target.word);
        }
    }

    processKey(key) {
        if (key === 'Backspace' || key.length === 1) {
            this.idleTimer = 0;
        }
        if (key === 'Backspace') {
            if (this.lockTarget) {
                this.clearLock();
            } else if (this.pendingPrefix.length > 0) {
                this.pendingPrefix = this.pendingPrefix.slice(0, -1);
                if (this.pendingPrefix.length === 0) {
                    this.pendingTargets.clear();
                } else {
                    const candidates = this.findCandidates(this.pendingPrefix);
                    this.pendingTargets = new Set(candidates);
                }
            }
            return;
        }
        if (this.mistakePenalty > 0) return; // Prevent input during penalty
        if (key.length !== 1) return; // Ignore control keys

        const char = key.toLowerCase();

        if (this.lockTarget) {
            this.lockTimer = 0;
            // Check if char matches next char in target word
            const expected = this.getExpectedChar(this.lockTarget);
            if (!expected) {
                const switched = this.tryRetargetOnMismatch(char);
                if (!switched) {
                    this.mistakePenalty = 0.3;
                    this.combo = 0;
                    this.entityManager.game.cameraShake = Math.min(1, (this.entityManager.game.cameraShake || 0) + 0.12);
                    this.entityManager.game.screenFlash = Math.min(1, (this.entityManager.game.screenFlash || 0) + 0.35);
                    this.entityManager.game.screenFlashKind = 'mistype';
                    this.entityManager.game.audioManager.playTone(150, 'sawtooth', 0.1, 0.2);
                }
                return;
            }
            if (expected && expected.toLowerCase() === char) {
                this.lockTarget.typedIndex = Math.min(this.lockTarget.typedIndex + 1, this.lockTarget.word.length);
                if (this.lockTarget.isStealth && this.lockTarget.typedIndex >= 2) {
                    this.lockTarget.revealIndex = this.lockTarget.word.length;
                }
                this.combo++;
                this.bestCombo = Math.max(this.bestCombo, this.combo);

                // Visual feedback for hit
                this.entityManager.spawnHitSpark(this.lockTarget.x, this.lockTarget.y, '#fff');

                if (this.lockTarget.typedIndex >= this.lockTarget.word.length) {
                    // Word completed -> fire weapon
                    this.entityManager.spawnHitSpark(this.lockTarget.x, this.lockTarget.y, '#fff');
                    this.completeTarget(this.lockTarget);
                    this.clearLock();
                } else {
                    this.pendingPrefix = '';
                    this.pendingTargets.clear();
                }
            } else {
                // If mismatch, try to switch targets using this key as a fresh start.
                const switched = this.tryRetargetOnMismatch(char);
                if (!switched) {
                    // Mis-type penalty
                    this.mistakePenalty = 0.3; // 300ms lock-out
                    this.combo = 0;
                    this.entityManager.game.cameraShake = Math.min(1, (this.entityManager.game.cameraShake || 0) + 0.12);
                    this.entityManager.game.screenFlash = Math.min(1, (this.entityManager.game.screenFlash || 0) + 0.35);
                    this.entityManager.game.screenFlashKind = 'mistype';
                    this.entityManager.game.audioManager.playTone(150, 'sawtooth', 0.1, 0.2); // Low buzz
                }
            }
        } else {
            const nextPrefix = this.pendingPrefix ? this.pendingPrefix + char : char;
            const candidates = this.findCandidates(nextPrefix);

            if (candidates.length === 0) {
                this.pendingPrefix = '';
                this.pendingTargets.clear();
                this.mistakePenalty = 0.3;
                this.combo = 0;
                this.entityManager.game.cameraShake = Math.min(1, (this.entityManager.game.cameraShake || 0) + 0.12);
                this.entityManager.game.screenFlash = Math.min(1, (this.entityManager.game.screenFlash || 0) + 0.35);
                this.entityManager.game.screenFlashKind = 'mistype';
                this.entityManager.game.audioManager.playTone(150, 'sawtooth', 0.1, 0.2);
                return;
            }

            this.combo++;
            this.bestCombo = Math.max(this.bestCombo, this.combo);

            if (candidates.length === 1) {
                const target = candidates[0];
                this.lockTarget = target;
                this.lockTimer = 0;
                this.pendingPrefix = '';
                this.pendingTargets.clear();
                this.lockTarget.typedIndex = Math.min(nextPrefix.length, this.lockTarget.word.length);
                if (this.lockTarget.isStealth && this.lockTarget.typedIndex >= 2) {
                    this.lockTarget.revealIndex = this.lockTarget.word.length;
                }
                this.entityManager.spawnHitSpark(this.lockTarget.x, this.lockTarget.y, '#fff');
                if (this.lockTarget.typedIndex >= this.lockTarget.word.length) {
                    this.entityManager.spawnHitSpark(this.lockTarget.x, this.lockTarget.y, '#fff');
                    this.completeTarget(this.lockTarget);
                    this.clearLock();
                } else {
                    this.pendingPrefix = '';
                    this.pendingTargets.clear();
                }
            } else {
                this.pendingPrefix = nextPrefix;
                this.pendingTargets = new Set(candidates);
                this.entityManager.spawnHitSpark(this.entityManager.player.x, this.entityManager.player.y, '#ffd43b');
            }
        }
    }

    update(deltaTime) {
        if (this.mistakePenalty > 0) {
            this.mistakePenalty = Math.max(0, this.mistakePenalty - deltaTime);
        }

        if (this.lockTarget) {
            const inputBlocked = this.getExpectedChar(this.lockTarget) === "";
            if (!inputBlocked) {
                this.lockTimer += deltaTime;
                if (this.lockTimer > GameConfig.TYPING.LOCK_GRACE) {
                    this.clearLock();
                }
            } else {
                this.lockTimer = 0;
            }
        } else {
            this.lockTimer = 0;
        }

        if (this.lockTarget || this.pendingPrefix.length > 0) {
            this.idleTimer += deltaTime;
            if (this.idleTimer >= GameConfig.TYPING.AUTO_CLEAR_SECONDS) {
                this.clearLock();
            }
        } else {
            this.idleTimer = 0;
        }
    }

    clearLock() {
        if (this.lockTarget) {
            this.lockTarget.typedIndex = 0;
        }
        this.lockTarget = null;
        this.lockTimer = 0;
        this.idleTimer = 0;
        this.pendingPrefix = '';
        this.pendingTargets.clear();
    }

    tryRetargetOnMismatch(char) {
        const current = this.lockTarget;
        const typedPrefix = current && current.word ? current.word.substring(0, current.typedIndex || 0).toLowerCase() : '';
        const buffer = (typedPrefix + char).toLowerCase();

        const prefixCandidates = [];
        prefixCandidates.push(buffer);
        // Allow one "auto-correction" by deleting a previous char (but keep the latest key).
        for (let i = 0; i < buffer.length - 1; i++) {
            prefixCandidates.push(buffer.slice(0, i) + buffer.slice(i + 1));
        }
        prefixCandidates.push(char);

        let bestPrefix = null;
        let bestMatches = null;
        for (const prefix of prefixCandidates) {
            const matches = this.findCandidates(prefix);
            if (matches.length === 0) continue;
            if (!bestPrefix || prefix.length > bestPrefix.length) {
                bestPrefix = prefix;
                bestMatches = matches;
            }
        }

        if (!bestPrefix || !bestMatches || bestMatches.length === 0) return false;

        this.clearLock();
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);

        if (bestMatches.length === 1) {
            const target = bestMatches[0];
            this.lockTarget = target;
            this.lockTimer = 0;
            this.pendingPrefix = '';
            this.pendingTargets.clear();
            target.typedIndex = Math.min(bestPrefix.length, target.word.length);
            if (target.isStealth && target.typedIndex >= 2) {
                target.revealIndex = target.word.length;
            }
            this.entityManager.spawnHitSpark(target.x, target.y, '#fff');

            if (target.typedIndex >= target.word.length) {
                this.entityManager.spawnHitSpark(target.x, target.y, '#fff');
                this.completeTarget(target);
                this.clearLock();
            }
        } else {
            this.pendingPrefix = bestPrefix;
            this.pendingTargets = new Set(bestMatches);
            this.entityManager.spawnHitSpark(this.entityManager.player.x, this.entityManager.player.y, '#ffd43b');
        }
        return true;
    }
}
