/**
 * Renderer.js
 * Canvas renderer for the survival typing game.
 * Focus: "Subtle Cool" minimalism (light canvas, wireframes, text-first), while keeping per-frame work low.
 */

import { LEVELUP_PROMPT_ICON_PATH, POWERUP_ICON_PATHS } from './SurvivalIcons.js';

const RGB_CACHE = new Map();

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function easeOutCubic(t) {
    const x = clamp(t, 0, 1);
    return 1 - Math.pow(1 - x, 3);
}

function easeOutBack(t) {
    const x = clamp(t, 0, 1);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function hexToRgb(hex) {
    const key = String(hex || '').trim();
    if (RGB_CACHE.has(key)) return RGB_CACHE.get(key);

    let h = key.replace('#', '');
    if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
    const intVal = Number.parseInt(h, 16);
    const rgb = {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255
    };
    RGB_CACHE.set(key, rgb);
    return rgb;
}

function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default class Renderer {
    constructor(canvas, ctx, game) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.game = game;
        this.hud = {
            time: document.getElementById('survival-time'),
            weapon: document.getElementById('survival-weapon'),
            wordRush: document.getElementById('survival-wordrush'),
            xpFill: document.getElementById('survival-xp-fill'),
            level: document.getElementById('survival-level-display')
        };

        this._hudState = {
            time: null,
            weapon: null,
            wordRushText: null,
            wordRushVisible: null,
            xpPct: null,
            levelText: null
        };

        this.width = 0;
        this.height = 0;
        this.dpr = 1;

        this._monoCharWidth = 10;
        this._textFont = '700 18px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        this._textPadX = 8;
        this._textPadY = 6;

        this._bgCanvas = document.createElement('canvas');
        this._bgCtx = this._bgCanvas.getContext('2d', { alpha: false });

        this._noisePattern = null;
        this._scanlinePattern = null;
        this._stars = [];
        this._powerupIcons = this._createIconMap(POWERUP_ICON_PATHS);
        this._levelupPromptIcon = this._loadIcon(LEVELUP_PROMPT_ICON_PATH);
    }

    random() {
        return typeof this.game?.random === 'function' ? this.game.random() : Math.random();
    }

    resize(width, height, dpr = 1) {
        this.width = width;
        this.height = height;
        this.dpr = dpr;

        const pxW = Math.max(1, Math.floor(width * dpr));
        const pxH = Math.max(1, Math.floor(height * dpr));
        if (this._bgCanvas.width !== pxW) this._bgCanvas.width = pxW;
        if (this._bgCanvas.height !== pxH) this._bgCanvas.height = pxH;
        this._bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this._buildPatterns();
        this._redrawStaticBackground();

        // Cache a single character width to avoid per-enemy measureText in the hot path.
        this.ctx.save();
        this.ctx.font = this._textFont;
        this._monoCharWidth = this.ctx.measureText('M').width || 10;
        this.ctx.restore();
    }

    _buildPatterns() {
        if (!this._noisePattern) {
            const noise = document.createElement('canvas');
            noise.width = 128;
            noise.height = 128;
            const nctx = noise.getContext('2d');
            const img = nctx.createImageData(noise.width, noise.height);
            for (let i = 0; i < img.data.length; i += 4) {
                const v = (this.random() * 255) | 0;
                img.data[i] = v;
                img.data[i + 1] = v;
                img.data[i + 2] = v;
                img.data[i + 3] = (this.random() * 40) | 0;
            }
            nctx.putImageData(img, 0, 0);
            this._noisePattern = this.ctx.createPattern(noise, 'repeat');
        }

        if (!this._scanlinePattern) {
            const scan = document.createElement('canvas');
            scan.width = 4;
            scan.height = 6;
            const sctx = scan.getContext('2d');
            sctx.fillStyle = 'rgba(255,255,255,0.07)';
            sctx.fillRect(0, 0, scan.width, 1);
            sctx.fillStyle = 'rgba(0,0,0,0.12)';
            sctx.fillRect(0, 2, scan.width, 1);
            sctx.fillStyle = 'rgba(0,0,0,0.10)';
            sctx.fillRect(0, 4, scan.width, 1);
            this._scanlinePattern = this.ctx.createPattern(scan, 'repeat');
        }
    }

    _buildStarfield() {
        const w = Math.max(1, this.width);
        const h = Math.max(1, this.height);
        const count = Math.floor(clamp((w * h) / 9000, 120, 360));
        this._stars = [];
        for (let i = 0; i < count; i++) {
            this._stars.push({
                x: this.random() * w,
                y: this.random() * h * 0.62,
                r: this.random() * 1.2 + 0.3,
                layer: this.random() * 0.9 + 0.1,
                tw: this.random() * Math.PI * 2
            });
        }
    }

    _redrawStaticBackground() {
        const ctx = this._bgCtx;
        const w = this.width;
        const h = this.height;
        if (!w || !h) return;

        // Light matte baseline inspired by reference.
        const cx = w * 0.5;
        const cy = h * 0.5;
        const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.9);
        base.addColorStop(0, '#f1ede4');
        base.addColorStop(1, '#d7d1c6');
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, w, h);

        // Soft vignette to focus center.
        const vign = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.95);
        vign.addColorStop(0, 'rgba(0,0,0,0)');
        vign.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = vign;
        ctx.fillRect(0, 0, w, h);
    }

    draw(entityManager) {
        const ctx = this.ctx;
        const width = this.game.width;
        const height = this.game.height;
        const t = this.game.runTime || (this.game.now() / 1000);

        const shake = this.game.cameraShake || 0;
        ctx.save();
        if (shake > 0.001) {
            const mag = 7 * shake;
            const dx = (Math.sin(t * 22.1) + Math.sin(t * 31.7)) * 0.5 * mag;
            const dy = (Math.cos(t * 25.4) + Math.sin(t * 18.9)) * 0.5 * mag;
            ctx.translate(dx, dy);
        }

        // Background (cached static layer + cheap animated overlays).
        if (this._bgCanvas.width && this._bgCanvas.height) {
            ctx.drawImage(this._bgCanvas, 0, 0, width, height);
        } else {
            ctx.fillStyle = '#ede8df';
            ctx.fillRect(0, 0, width, height);
        }
        this._drawBackgroundFx(ctx, width, height, t);
        this._drawShockwaves(ctx, entityManager, t);

        // Shattering shards (kept below text to avoid clutter).
        ctx.globalCompositeOperation = 'source-over';
        for (const p of entityManager.particles) {
            const a = clamp(p.life, 0, 1);
            if (a <= 0.001) continue;
            ctx.globalAlpha = a;
            ctx.strokeStyle = p.color;

            if (p.shape === 'line') {
                const vx = p.vx || 0;
                const vy = p.vy || 0;
                const d = Math.sqrt((vx * vx) + (vy * vy)) || 1;
                const ux = vx / d;
                const uy = vy / d;
                const len = p.len || 10;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(p.x - ux * len * 0.5, p.y - uy * len * 0.5);
                ctx.lineTo(p.x + ux * len * 0.5, p.y + uy * len * 0.5);
                ctx.stroke();
            } else {
                const s = (p.size || 2) * 2.4;
                const rot = p.rot || 0;
                const cos = Math.cos(rot);
                const sin = Math.sin(rot);
                const ux = cos;
                const uy = sin;
                const px = -sin;
                const py = cos;
                const tipx = p.x + ux * s * 1.2;
                const tipy = p.y + uy * s * 1.2;
                const bx = p.x - ux * s * 0.8;
                const by = p.y - uy * s * 0.8;
                const lx = bx + px * s * 0.6;
                const ly = by + py * s * 0.6;
                const rx = bx - px * s * 0.6;
                const ry = by - py * s * 0.6;
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                ctx.moveTo(tipx, tipy);
                ctx.lineTo(lx, ly);
                ctx.lineTo(rx, ry);
                ctx.closePath();
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Subtle targeting guide line.
        this._drawTargetLine(ctx, entityManager, t);

        // Items sit below enemies.
        for (const item of entityManager.items || []) this.drawItem(item, t);

        // Enemies and projectiles.
        for (const enemy of entityManager.enemies) this.drawEnemyShape(enemy, t);

        ctx.globalCompositeOperation = 'source-over';
        for (const p of entityManager.projectiles) this.drawProjectile(p, t);
        this._drawBeams(ctx, entityManager);

        // Player above the floor.
        this.drawPlayer(entityManager.player, t);
        this._drawSupportUnits(t);

        this._drawCombo(entityManager.player, t);
        this._drawPowerupStatus(entityManager.player, t);

        // Text on top.
        for (const enemy of entityManager.enemies) this.drawEnemyText(enemy, t);
        for (const item of entityManager.items || []) this.drawItemText(item, t);

        this._drawScreenFx(ctx, width, height);

        ctx.restore();

        this.updateHUD(entityManager);
    }

    _drawBackgroundFx(ctx, w, h, t) {
        // Gentle pulse to keep the scene alive without adding clutter.
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const cg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
        cg.addColorStop(0, `rgba(0, 0, 0, ${0.01 + pulse * 0.01})`);
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // Light grain only.
        if (this._noisePattern) {
            ctx.save();
            ctx.globalAlpha = 0.02;
            ctx.fillStyle = this._noisePattern;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
    }

    _drawShockwaves(ctx, entityManager, t) {
        const waves = entityManager && Array.isArray(entityManager.shockwaves) ? entityManager.shockwaves : [];
        if (!waves || waves.length === 0) return;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const sw of waves) {
            if (!sw) continue;
            const maxLife = Number.isFinite(sw.maxLife) && sw.maxLife > 0 ? sw.maxLife : 0.55;
            const life = Number.isFinite(sw.life) ? sw.life : 0;
            const p = 1 - clamp(life / maxLife, 0, 1);
            const eased = easeOutCubic(p);
            const radius = Math.max(10, (sw.radius || 0) * eased);
            const fade = 1 - p;
            const color = sw.color || '#e0a800';

            ctx.globalAlpha = 0.55 * fade;
            ctx.strokeStyle = rgba(color, 0.22);
            ctx.lineWidth = 5.5;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.globalAlpha = 0.75 * fade;
            ctx.strokeStyle = rgba(color, 0.35);
            ctx.lineWidth = 1.8;
            ctx.setLineDash([10, 10]);
            ctx.lineDashOffset = -t * 40;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    _drawTargetLine(ctx, entityManager, t) {
        const target = this.game.typingSystem ? this.game.typingSystem.lockTarget : null;
        if (!target) return;
        if (!target.word || target.isDead) return;

        const p = entityManager.player;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 10]);
        ctx.lineDashOffset = -t * 45;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.restore();
    }

    _drawBeams(ctx, entityManager) {
        if (!entityManager.beams || entityManager.beams.length === 0) return;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        for (const beam of entityManager.beams) {
            const a = clamp(beam.life, 0, 1);
            if (a <= 0.001) continue;
            ctx.globalAlpha = a;
            ctx.strokeStyle = beam.color || '#444444';
            ctx.lineWidth = beam.width || 2;
            if (Array.isArray(beam.segments) && beam.segments.length > 0) {
                for (const segment of beam.segments) {
                    if (!segment) continue;
                    ctx.beginPath();
                    ctx.moveTo(segment.x0, segment.y0);
                    ctx.lineTo(segment.x1, segment.y1);
                    ctx.stroke();
                }
            } else {
                ctx.beginPath();
                ctx.moveTo(beam.x0, beam.y0);
                ctx.lineTo(beam.x1, beam.y1);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    _drawCombo(player, t) {
        const combo = this.game.typingSystem ? this.game.typingSystem.combo : 0;
        if (!combo || combo <= 0) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = '700 14px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pulse = 0.5 + 0.5 * Math.sin(t * 5.0);
        ctx.fillStyle = `rgba(0, 0, 0, ${0.45 + pulse * 0.20})`;
        ctx.fillText('Perfect Input', player.x, player.y + player.size + 30);
        ctx.fillText(String(combo), player.x, player.y + player.size + 46);
        ctx.restore();
    }

    _drawShadows(ctx, entityManager, t) {
        // Flat style: shadows intentionally omitted.
    }

    _drawScreenFx(ctx, w, h) {
        const flash = this.game.screenFlash || 0;
        if (flash <= 0.001) return;

        const kind = this.game.screenFlashKind || 'mistype';
        let r = 77, g = 171, b = 247; // cyan (default)
        if (kind === 'damage') { r = 255; g = 107; b = 107; }
        if (kind === 'mistype') { r = 255; g = 212; b = 59; }
        if (kind === 'block') { r = 77; g = 171; b = 247; }
        if (kind === 'beat') { r = 180; g = 140; b = 255; } // warm purple pulse

        const a0 = clamp(flash * 0.22, 0, 0.22);
        const a1 = clamp(flash * 0.08, 0, 0.08);
        const cx = w * 0.5;
        const cy = h * 0.56;
        const rad = Math.max(w, h) * 0.75;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        cg.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a0})`);
        cg.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${a1})`);
        cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    }

    drawProjectile(p, t) {
        const ctx = this.ctx;
        const x0 = Number.isFinite(p.prevX) ? p.prevX : p.x;
        const y0 = Number.isFinite(p.prevY) ? p.prevY : p.y;
        const x1 = p.x;
        const y1 = p.y;

        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len;
        const ny = dy / len;

        // Streak + head (2.5D "speed" cue).
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1.6, p.size * 1.5);
        ctx.strokeStyle = rgba(p.color, 0.8);
        ctx.beginPath();
        ctx.moveTo(x0 - nx * 8, y0 - ny * 8);
        ctx.lineTo(x1 + nx * 4, y1 + ny * 4);
        ctx.stroke();

        ctx.fillStyle = rgba(p.color, 0.95);
        ctx.beginPath();
        ctx.arc(x1, y1, Math.max(1.2, p.size), 0, Math.PI * 2);
        ctx.fill();
    }

    _drawSupportUnits(t) {
        const weaponSystem = this.game.weaponSystem;
        if (!weaponSystem) return;
        const drones = typeof weaponSystem.getDroneInstances === 'function' ? weaponSystem.getDroneInstances() : [];
        const mines = typeof weaponSystem.getMineInstances === 'function' ? weaponSystem.getMineInstances() : [];
        if ((!drones || drones.length === 0) && (!mines || mines.length === 0)) return;

        const ctx = this.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (const mine of mines) {
            const mineSize = mine.size || 8;
            const armFrac = clamp(1 - ((mine.armTime || 0) / 0.35), 0, 1);
            ctx.strokeStyle = `rgba(77, 171, 247, ${0.4 + armFrac * 0.4})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(mine.x, mine.y, mineSize, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(77, 171, 247, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mine.x - mineSize * 0.6, mine.y);
            ctx.lineTo(mine.x + mineSize * 0.6, mine.y);
            ctx.moveTo(mine.x, mine.y - mineSize * 0.6);
            ctx.lineTo(mine.x, mine.y + mineSize * 0.6);
            ctx.stroke();
        }

        for (const drone of drones) {
            const size = drone.size || 9;
            const pulse = 0.55 + 0.45 * Math.sin(t * 5.2 + drone.x * 0.01 + drone.y * 0.01);
            ctx.strokeStyle = `rgba(47, 47, 47, ${0.35 + pulse * 0.35})`;
            ctx.lineWidth = 3.4;
            ctx.beginPath();
            ctx.moveTo(drone.x, drone.y - size);
            ctx.lineTo(drone.x + size * 0.78, drone.y);
            ctx.lineTo(drone.x, drone.y + size);
            ctx.lineTo(drone.x - size * 0.78, drone.y);
            ctx.closePath();
            ctx.stroke();

            ctx.strokeStyle = `rgba(47, 47, 47, ${0.85})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(drone.x, drone.y - size);
            ctx.lineTo(drone.x + size * 0.78, drone.y);
            ctx.lineTo(drone.x, drone.y + size);
            ctx.lineTo(drone.x - size * 0.78, drone.y);
            ctx.closePath();
            ctx.stroke();
        }

        ctx.restore();
    }

    drawPlayer(player, t) {
        const ctx = this.ctx;
        const r = player.size;
        const hpPct = clamp(player.health / player.maxHealth, 0, 1);

        // Base health arc (diegetic, minimal).
        const arcR = r + 18;
        const arcStart = -Math.PI * 0.85;
        const arcEnd = Math.PI * 0.85;
        const arcLen = arcEnd - arcStart;
        const arcFill = arcStart + arcLen * hpPct;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
        ctx.beginPath();
        ctx.arc(player.x, player.y, arcR, arcStart, arcEnd);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.arc(player.x, player.y, arcR, arcStart, arcFill);
        ctx.stroke();
        ctx.restore();

        const droneRange = this.game.weaponSystem && typeof this.game.weaponSystem.getDroneRange === 'function'
            ? this.game.weaponSystem.getDroneRange()
            : 0;
        if (droneRange > 0) {
            const pulse = 0.45 + 0.55 * Math.sin(t * 1.7);
            // Intentionally subtle, but still visible on the matte background.
            const fillAlpha = 0.02 + pulse * 0.01;
            const ringAlpha = 0.12 + pulse * 0.06;

            ctx.save();
            ctx.fillStyle = `rgba(47, 47, 47, ${fillAlpha})`;
            ctx.beginPath();
            ctx.arc(player.x, player.y, droneRange, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = `rgba(47, 47, 47, ${ringAlpha})`;
            ctx.lineWidth = 1.4;
            ctx.setLineDash([7, 12]);
            ctx.lineDashOffset = -t * 14;
            ctx.beginPath();
            ctx.arc(player.x, player.y, droneRange, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        const sentryRange = this.game.weaponSystem && typeof this.game.weaponSystem.getSentryRange === 'function'
            ? this.game.weaponSystem.getSentryRange()
            : 0;
        if (sentryRange > 0) {
            const pulse = 0.45 + 0.55 * Math.sin(t * 2.6);
            ctx.save();
            const fillAlpha = 0.065 + pulse * 0.03;
            const ringAlphaOuter = 0.26 + pulse * 0.16;
            const ringAlphaCore = 0.58 + pulse * 0.22;

            ctx.fillStyle = `rgba(92, 124, 250, ${fillAlpha})`;
            ctx.beginPath();
            ctx.arc(player.x, player.y, sentryRange, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = `rgba(92, 124, 250, ${ringAlphaOuter})`;
            ctx.lineWidth = 4.6;
            ctx.beginPath();
            ctx.arc(player.x, player.y, sentryRange, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = `rgba(92, 124, 250, ${ringAlphaCore})`;
            ctx.lineWidth = 1.9;
            ctx.setLineDash([10, 8]);
            ctx.lineDashOffset = -t * 30;
            ctx.beginPath();
            ctx.arc(player.x, player.y, sentryRange, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = '700 10px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(92, 124, 250, 0.78)';
            ctx.fillText('SENTRY AOE', player.x, player.y - sentryRange - 12);
            ctx.restore();
        }

        // Central turret: thin wireframe triangle that points at the current target.
        const target = this.game.typingSystem ? this.game.typingSystem.lockTarget : null;
        const aim = target ? Math.atan2(target.y - player.y, target.x - player.x) : -Math.PI / 2;
        const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);

        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(aim + Math.PI / 2);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.strokeStyle = `rgba(0, 0, 0, ${0.18 + pulse * 0.12})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.95);
        ctx.lineTo(r * 0.72, r * 0.85);
        ctx.lineTo(-r * 0.72, r * 0.85);
        ctx.closePath();
        ctx.stroke();

        ctx.strokeStyle = `rgba(0, 0, 0, ${0.78 + pulse * 0.08})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.95);
        ctx.lineTo(r * 0.72, r * 0.85);
        ctx.lineTo(-r * 0.72, r * 0.85);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.arc(0, 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.font = '600 11px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillText(`${Math.round(player.health)} / ${Math.round(player.maxHealth)}`, player.x, player.y - r - 12);
        ctx.restore();
    }

    drawEnemyShape(enemy, t) {
        const ctx = this.ctx;

        const spawnAge = enemy.spawnTime != null ? (this.game.runTime - enemy.spawnTime) : 999;
        const spawnT = easeOutBack(clamp(spawnAge / 0.22, 0, 1));
        const scale = 0.75 + 0.25 * spawnT;

        const hitAge = enemy.lastHitTime != null ? (this.game.runTime - enemy.lastHitTime) : 999;
        const hitPulse = hitAge < 0.12 ? (1 - hitAge / 0.12) : 0;
        const deadFade = (() => {
            if (!enemy.isDead) return 1;
            const max = Number.isFinite(enemy.deathTimerMax) && enemy.deathTimerMax > 0 ? enemy.deathTimerMax : 0.25;
            const left = Number.isFinite(enemy.deathTimer) ? enemy.deathTimer : 0;
            return 0.05 + 0.95 * clamp(left / max, 0, 1);
        })();

        ctx.save();
        ctx.globalAlpha = deadFade;
        ctx.translate(enemy.x, enemy.y);
        ctx.scale(scale * (1 + hitPulse * 0.06), scale * (1 + hitPulse * 0.06));
        ctx.translate(-enemy.x, -enemy.y);

        // Glyphica-style: clean wireframe shapes with additive glow strokes.
        const color = enemy.color || '#4dabf7';
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const drawCircle = (radius) => {
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, radius, 0, Math.PI * 2);
        };

        const drawDiamond = (radius) => {
            ctx.beginPath();
            ctx.moveTo(enemy.x, enemy.y - radius);
            ctx.lineTo(enemy.x + radius, enemy.y);
            ctx.lineTo(enemy.x, enemy.y + radius);
            ctx.lineTo(enemy.x - radius, enemy.y);
            ctx.closePath();
        };

        const drawPolygon = (radius, sides, rotation) => {
            const step = (Math.PI * 2) / sides;
            ctx.beginPath();
            for (let i = 0; i < sides; i++) {
                const a = rotation + i * step;
                const x = enemy.x + Math.cos(a) * radius;
                const y = enemy.y + Math.sin(a) * radius;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
        };

        const glowA = 0.14 + hitPulse * 0.16;
        const coreA = 0.75 + hitPulse * 0.10;

        if (enemy.type === 'shot') {
            ctx.strokeStyle = rgba(color, coreA);
            ctx.lineWidth = 1.5;
            drawCircle(enemy.size);
            ctx.stroke();

            ctx.fillStyle = rgba(color, 0.35);
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, Math.max(1.5, enemy.size * 0.55), 0, Math.PI * 2);
            ctx.fill();
        } else if (enemy.type === 'tank') {
            const layers = 3;
            const frac = enemy.maxHealth > 0 ? clamp(enemy.health / enemy.maxHealth, 0, 1) : 0;
            const rot = (enemy.spawnOrder || 0) * 0.08 + t * 0.12;
            for (let i = 0; i < layers; i++) {
                const threshold = (layers - 1 - i) / layers;
                const a = clamp((frac - threshold) * layers, 0, 1);
                if (a <= 0.001) continue;
                const radius = enemy.size * (1.05 - i * 0.18);

                ctx.strokeStyle = rgba(color, glowA * a);
                ctx.lineWidth = 5 - i * 1.0;
                drawPolygon(radius, 5, rot);
                ctx.stroke();

                ctx.strokeStyle = rgba(color, coreA * a);
                ctx.lineWidth = 1.5;
                drawPolygon(radius, 5, rot);
                ctx.stroke();
            }
        } else if (enemy.type === 'turret') {
            const aim = Math.atan2(this.game.entityManager.player.y - enemy.y, this.game.entityManager.player.x - enemy.x);
            const s = enemy.size * 1.15;

            const drawChevron = (offset, scale) => {
                const sx = s * scale;
                ctx.beginPath();
                ctx.moveTo(enemy.x - sx * 0.85 + offset, enemy.y - sx * 0.55);
                ctx.lineTo(enemy.x + sx * 1.05 + offset, enemy.y);
                ctx.lineTo(enemy.x - sx * 0.85 + offset, enemy.y + sx * 0.55);
                ctx.stroke();
            };

            ctx.save();
            ctx.translate(enemy.x, enemy.y);
            ctx.rotate(aim);
            ctx.translate(-enemy.x, -enemy.y);

            ctx.strokeStyle = rgba(color, glowA);
            ctx.lineWidth = 4;
            drawChevron(0, 1);
            if (enemy.turretRank >= 2) drawChevron(s * 0.45, 0.85);

            ctx.strokeStyle = rgba(color, coreA);
            ctx.lineWidth = 1.5;
            drawChevron(0, 1);
            if (enemy.turretRank >= 2) drawChevron(s * 0.45, 0.85);

            ctx.restore();
        } else if (enemy.type === 'rusher') {
            const rot = t * 1.2 + (enemy.spawnOrder || 0) * 0.3;
            ctx.save();
            ctx.translate(enemy.x, enemy.y);
            ctx.rotate(rot);
            ctx.translate(-enemy.x, -enemy.y);

            ctx.strokeStyle = rgba(color, glowA);
            ctx.lineWidth = 4;
            drawDiamond(enemy.size * 1.05);
            ctx.stroke();

            ctx.strokeStyle = rgba(color, coreA);
            ctx.lineWidth = 1.5;
            drawDiamond(enemy.size * 1.05);
            ctx.stroke();
            ctx.restore();
        } else {
            ctx.strokeStyle = rgba(color, glowA);
            ctx.lineWidth = 4;
            drawCircle(enemy.size);
            ctx.stroke();

            ctx.strokeStyle = rgba(color, coreA);
            ctx.lineWidth = 1.5;
            drawCircle(enemy.size);
            ctx.stroke();

            if (enemy.ringCount && enemy.ringCount > 0) {
                for (let i = 0; i < enemy.ringCount; i++) {
                    const ringR = enemy.size + 4 + i * 4;
                    ctx.strokeStyle = rgba(color, 0.22);
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, ringR, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }

        if (enemy.isBoss) {
            const pulse = 0.45 + 0.55 * Math.sin(t * 2.4 + (enemy.spawnOrder || 0) * 0.15);
            const ringRadius = enemy.size + 14;
            const ringAlpha = 0.2 + pulse * 0.2;

            ctx.strokeStyle = `rgba(178, 76, 76, ${ringAlpha})`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, ringRadius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(178, 76, 76, 0.82)';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([10, 8]);
            ctx.lineDashOffset = -t * 36;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Hidden/Stealth: "beaded circle" marker.
        if (enemy.isStealth) {
            const beadCount = 10;
            const ringR = enemy.size + 5;
            const beadR = Math.max(1.5, enemy.size * 0.13);
            const rot = t * 0.9 + (enemy.spawnOrder || 0) * 0.6;
            ctx.strokeStyle = rgba(color, 0.35);
            ctx.lineWidth = 2;
            drawCircle(ringR);
            ctx.stroke();

            ctx.fillStyle = rgba(color, 0.55);
            for (let i = 0; i < beadCount; i++) {
                const a = rot + (i / beadCount) * Math.PI * 2;
                const bx = enemy.x + Math.cos(a) * ringR;
                const by = enemy.y + Math.sin(a) * ringR;
                ctx.beginPath();
                ctx.arc(bx, by, beadR, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Trait rings/aura.
        if (enemy.isBuffer) {
            const pulse = 0.6 + 0.4 * Math.sin(t * 2.1 + (enemy.spawnOrder || 0));
            ctx.strokeStyle = `rgba(130, 201, 30, ${0.20 + pulse * 0.15})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 10]);
            ctx.lineDashOffset = -t * 40;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.bufferRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (enemy.isShielded) {
            const gap = Math.PI * 0.62;
            const start = (enemy.shieldPhase || 0) * Math.PI * 2;
            const blockedFlashAge = enemy.lastBlockTime != null ? (this.game.runTime - enemy.lastBlockTime) : 999;
            const flash = blockedFlashAge < 0.16 ? (1 - blockedFlashAge / 0.16) : 0;
            const a = enemy.shieldOpen ? 0.80 : (0.34 + flash * 0.35);
            ctx.strokeStyle = `rgba(77, 171, 247, ${a * 0.35})`;
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size + 12, start + gap, start + (Math.PI * 2) - gap);
            ctx.stroke();

            ctx.strokeStyle = `rgba(77, 171, 247, ${a})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size + 12, start + gap, start + (Math.PI * 2) - gap);
            ctx.stroke();
        }

        if (enemy.isShieldLinked && enemy.linkedShield) {
            ctx.strokeStyle = 'rgba(77, 171, 247, 0.18)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(enemy.x, enemy.y);
            ctx.lineTo(enemy.linkedShield.x, enemy.linkedShield.y);
            ctx.stroke();
        }

        if (enemy.isBuffed) {
            ctx.strokeStyle = 'rgba(130, 201, 30, 0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size + 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (enemy.armor && enemy.armor > 0) {
            ctx.strokeStyle = 'rgba(148, 216, 45, 0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size + 7, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (enemy.slowTimer && enemy.slowTimer > 0) {
            const slowPulse = 0.45 + 0.55 * Math.sin(t * 4.2 + (enemy.spawnOrder || 0) * 0.4);
            ctx.strokeStyle = `rgba(77, 171, 247, ${0.25 + slowPulse * 0.35})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size + 10, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (enemy.maxHealth && enemy.maxHealth > 0) {
            const hpPct = clamp(enemy.health / enemy.maxHealth, 0, 1);
            const barW = Math.max(18, enemy.size * 2.2);
            const barH = 3;
            const barX = enemy.x - barW / 2;
            const barY = enemy.y + enemy.size + 6;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = rgba(color, 0.85);
            ctx.fillRect(barX, barY, barW * hpPct, barH);
        }

        ctx.restore();
    }

    drawItem(item, t) {
        const ctx = this.ctx;
        const color = item.color || '#7d6c8d';
        const size = item.size || 12;
        const bob = Math.sin((item.bob || 0) * 2.4) * 2.2;
        const y = item.y + bob;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba(color, 0.65);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(item.x - size, y - size, size * 2, size * 2);
        ctx.stroke();

        ctx.strokeStyle = rgba(color, 0.25);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.rect(item.x - size, y - size, size * 2, size * 2);
        ctx.stroke();

        const icon = this.getPowerupIcon(item.type);
        if (icon) {
            const iconSize = Math.max(12, size * 1.24);
            const half = iconSize * 0.5;
            ctx.globalAlpha = 0.95;
            ctx.drawImage(icon, item.x - half, y - half, iconSize, iconSize);
            ctx.globalAlpha = 1;
        } else {
            const glyphs = {
                loot: 'L',
                shield: 'S',
                freeze: 'F',
                double_damage: 'D',
                reroll: 'R',
                health: 'H'
            };
            const glyph = glyphs[item.type] || 'I';
            ctx.font = '700 10px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(glyph, item.x, y);
        }

        const pct = clamp(item.life / item.maxLife, 0, 1);
        const barW = 28;
        const barH = 3;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        ctx.fillRect(item.x - barW / 2, y + size + 6, barW, barH);
        ctx.fillStyle = rgba(color, 0.8);
        ctx.fillRect(item.x - barW / 2, y + size + 6, barW * pct, barH);

        ctx.restore();
    }

    drawItemText(item, t) {
        const ctx = this.ctx;
        const typingSystem = this.game.typingSystem;
        const fullWord = item.word || '';
        if (!fullWord) return;

        const typedIndex = typingSystem ? typingSystem.getDisplayTypedIndex(item) : 0;
        const typed = fullWord.substring(0, typedIndex);
        const remaining = fullWord.substring(typedIndex);
        const charW = this._monoCharWidth * 0.78;
        const totalWidth = fullWord.length * charW;
        const typedWidth = typed.length * charW;

        const bob = Math.sin((item.bob || 0) * 2.4) * 2.2;
        const textY = item.y + bob - (item.size || 12) - 16;
        const leftX = item.x - totalWidth / 2;
        const padX = 6;
        const padY = 4;
        const boxX = leftX - padX;
        const boxY = textY - 10 - padY;
        const boxW = totalWidth + padX * 2;
        const boxH = 20 + padY * 2;

        ctx.save();
        ctx.font = '700 14px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const locked = typingSystem && typingSystem.lockTarget === item;
        const pending = typingSystem && typingSystem.isPending(item);
        if (locked) {
            ctx.strokeStyle = 'rgba(178, 76, 76, 0.75)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(boxX, boxY + boxH);
            ctx.lineTo(boxX + boxW, boxY + boxH);
            ctx.stroke();
        } else if (pending) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(boxX, boxY + boxH);
            ctx.lineTo(boxX + boxW, boxY + boxH);
            ctx.stroke();
        }

        if (typed.length > 0) {
            ctx.fillStyle = '#444444';
            ctx.fillText(typed, leftX, textY);
        }

        ctx.fillStyle = locked ? 'rgba(178, 76, 76, 0.95)' : 'rgba(0, 0, 0, 0.8)';
        ctx.fillText(remaining, leftX + typedWidth, textY);
        ctx.restore();
    }

    drawEnemyText(enemy, t) {
        const ctx = this.ctx;
        const typingSystem = this.game.typingSystem;

        const fullWord = String(enemy.word || '');
        const revealIndex = enemy.isStealth ? enemy.revealIndex : fullWord.length;
        const visibleWord = fullWord.substring(0, revealIndex);
        const typedIndex = Math.min(typingSystem.getDisplayTypedIndex(enemy), revealIndex);
        const typed = visibleWord.substring(0, typedIndex);
        const remaining = visibleWord.substring(typedIndex);

        const totalWidth = fullWord.length * this._monoCharWidth;
        const visibleWidth = visibleWord.length * this._monoCharWidth;
        const typedWidth = typed.length * this._monoCharWidth;

        const stackOffset = this.getEnemyTextStackOffset(enemy);
        const textY = enemy.y - enemy.size - 18 - stackOffset;
        const leftX = enemy.x - totalWidth / 2;
        const boxX = leftX - this._textPadX;
        const boxY = textY - 12 - this._textPadY;
        const boxW = totalWidth + this._textPadX * 2;
        const boxH = 24 + this._textPadY * 2;

        ctx.save();
        if (enemy.isDead) {
            const max = Number.isFinite(enemy.deathTimerMax) && enemy.deathTimerMax > 0 ? enemy.deathTimerMax : 0.25;
            const left = Number.isFinite(enemy.deathTimer) ? enemy.deathTimer : 0;
            ctx.globalAlpha = 0.08 + 0.92 * clamp(left / max, 0, 1);
        }
        ctx.font = this._textFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // No backing plate (clean text-only style).
        const locked = this.game.typingSystem.lockTarget === enemy;
        const pending = typingSystem.isPending(enemy);
        if (locked) {
            this.drawTargetReticle(enemy, t);
        }

        // Typed portion.
        if (typed.length > 0) {
            ctx.fillStyle = '#444444';
            ctx.fillText(typed, leftX, textY);
        }

        // Remaining portion.
        const shieldBlocked = (enemy.isShielded && !enemy.shieldOpen)
            || (enemy.isShieldLinked && enemy.linkedShield && !enemy.linkedShield.shieldOpen);
        ctx.fillStyle = shieldBlocked ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.82)';
        if (locked) {
            ctx.fillStyle = 'rgba(178, 76, 76, 0.95)';
            ctx.shadowBlur = 0;
        } else if (pending) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        }
        ctx.fillText(remaining, leftX + typedWidth, textY);

        if (enemy.isBoss) {
            const bossLabel = String(enemy.bossName || 'BOSS').toUpperCase();
            ctx.save();
            ctx.font = '700 11px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(178, 76, 76, 0.9)';
            ctx.fillText(bossLabel, enemy.x, textY - 18);
            ctx.restore();
        }

        if (enemy.isStealth && visibleWidth < totalWidth) {
            const hiddenWidth = totalWidth - visibleWidth;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.fillRect(leftX + visibleWidth, textY - 9, hiddenWidth, 18);
        }
        ctx.restore();
    }

    getEnemyTextStackOffset(enemy) {
        if (enemy && enemy.isBoss) return 10;
        const enemies = this.game?.entityManager?.enemies || [];
        const originOrder = enemy.spawnOrder || 0;
        const wordWidth = String(enemy?.word || '').length * this._monoCharWidth;
        let stackDepth = 0;
        for (const other of enemies) {
            if (!other || other === enemy || other.isDead || other.isProjectileEnemy) continue;
            if ((other.spawnOrder || 0) >= originOrder) continue;
            const otherWidth = String(other.word || '').length * this._monoCharWidth;
            const minDx = (wordWidth + otherWidth) * 0.5 + 12;
            if (Math.abs(other.x - enemy.x) > minDx) continue;
            const minDy = Math.max(26, Math.min(54, ((enemy.size || 12) + (other.size || 12)) * 0.55));
            if (Math.abs(other.y - enemy.y) > minDy) continue;
            stackDepth++;
        }
        return Math.min(26, stackDepth * 12);
    }

    drawTargetReticle(enemy, t) {
        const ctx = this.ctx;
        const pulse = 0.5 + 0.5 * Math.sin(t * 6.5);
        const radius = enemy.size + 14 + pulse * 5;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(178, 76, 76, 0.9)';
        ctx.lineWidth = 2;

        // Outer ring segments.
        const rot = t * 1.6;
        for (let i = 0; i < 3; i++) {
            const start = rot + i * (Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, radius, start, start + Math.PI * 0.55);
            ctx.stroke();
        }

        // Brackets.
        const b = radius + 6;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(enemy.x - b, enemy.y - 6);
        ctx.lineTo(enemy.x - b, enemy.y + 6);
        ctx.moveTo(enemy.x + b, enemy.y - 6);
        ctx.lineTo(enemy.x + b, enemy.y + 6);
        ctx.moveTo(enemy.x - 6, enemy.y - b);
        ctx.lineTo(enemy.x + 6, enemy.y - b);
        ctx.moveTo(enemy.x - 6, enemy.y + b);
        ctx.lineTo(enemy.x + 6, enemy.y + b);
        ctx.stroke();

        ctx.restore();
    }

    _drawPowerupStatus(player, t) {
        if (!player) return;
        const ctx = this.ctx;
        const statusScale = 1.3;
        const textMainPx = 12 * statusScale;
        const textSubPx = 11 * statusScale;
        const keyPx = 10 * statusScale;
        const lineGap = 14 * statusScale;
        const toastGap = 16 * statusScale;
        const iconSize = 12 * statusScale;
        const iconGap = 6 * statusScale;

        const statusLines = [];
        if (this.game.freezeTimer > 0) {
            statusLines.push({ key: 'freeze', label: 'Freeze', time: this.game.freezeTimer, color: '#5d7ea6' });
        }
        if (this.game.doubleDamageTimer > 0) {
            statusLines.push({ key: 'double_damage', label: 'Double DMG', time: this.game.doubleDamageTimer, color: '#b24c4c' });
        }
        if (this.game.speedBoostTimer > 0) {
            statusLines.push({ key: 'speed_boost', label: 'Speed Boost', time: this.game.speedBoostTimer, color: '#00d084' });
        }
        const toast = this.game.pickupToast;
        const pendingLevelUp = this.game.upgradeManager && this.game.upgradeManager.pendingLevelUps > 0;
        const showPrompt = pendingLevelUp && this.game.state === 'PLAYING';
        if (!toast && statusLines.length === 0 && !showPrompt) return;

        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        let y = player.y + player.size + 64;
        if (toast) {
            ctx.font = `700 ${textMainPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            const text = toast.text || '';
            const measured = ctx.measureText(text).width;
            const startX = player.x - measured / 2;
            const alpha = clamp(toast.time / 0.6, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = toast.color || '#2f2f2f';
            ctx.fillText(text, startX, y);
            ctx.globalAlpha = 1;
            y += toastGap;
        }

        ctx.font = `600 ${textSubPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
        for (const line of statusLines) {
            const text = `${line.label} ${line.time.toFixed(1)}s`;
            const icon = this.getPowerupIcon(line.key);
            const textWidth = ctx.measureText(text).width;
            const blockW = textWidth + (icon ? (iconSize + iconGap) : 0);
            let x = player.x - blockW / 2;
            if (icon) {
                ctx.globalAlpha = 0.95;
                ctx.drawImage(icon, x, y - iconSize * 0.5, iconSize, iconSize);
                ctx.globalAlpha = 1;
                x += iconSize + iconGap;
            }
            ctx.fillStyle = line.color;
            ctx.fillText(text, x, y);
            y += lineGap;
        }

        if (showPrompt) {
            const label = 'Press';
            const tail = 'to level up';
            const keyText = 'CTRL';

            const pulse = 0.6 + 0.4 * Math.sin(t * 5.5);
            ctx.globalAlpha = pulse;
            ctx.font = `600 ${textSubPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            ctx.textAlign = 'left';

            const labelW = ctx.measureText(label).width;
            const tailW = ctx.measureText(tail).width;

            ctx.font = `700 ${keyPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            const keyTextW = ctx.measureText(keyText).width;
            const keyPadX = 8 * statusScale;
            const keyPadY = 5 * statusScale;
            const keyW = Math.max(36 * statusScale, keyTextW + keyPadX * 2);
            const keyH = 18 * statusScale;
            const levelUpIcon = this._getLoadedIcon(this._levelupPromptIcon);
            const promptIconW = levelUpIcon ? (iconSize + iconGap) : 0;

            const totalW = promptIconW + labelW + 8 + keyW + 8 + tailW;
            const startX = player.x - totalW / 2;
            const baselineY = y + 2;
            let cursorX = startX;

            if (levelUpIcon) {
                ctx.globalAlpha = pulse * 0.95;
                ctx.drawImage(levelUpIcon, cursorX, baselineY - iconSize * 0.5, iconSize, iconSize);
                ctx.globalAlpha = pulse;
                cursorX += promptIconW;
            }

            ctx.font = `600 ${textSubPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillText(label, cursorX, baselineY);

            const keyX = cursorX + labelW + 8;
            const keyY = baselineY - keyH / 2;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.lineWidth = 1;
            this._drawRoundedRect(ctx, keyX, keyY, keyW, keyH, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${keyPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            ctx.fillText(keyText, keyX + keyW / 2, baselineY);

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.font = `600 ${textSubPx}px "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillText(tail, keyX + keyW + 8, baselineY);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    _drawRoundedRect(ctx, x, y, w, h, r) {
        const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    _createIconMap(paths) {
        const map = {};
        const source = paths || {};
        Object.keys(source).forEach(key => {
            map[key] = this._loadIcon(source[key]);
        });
        return map;
    }

    _loadIcon(src) {
        if (!src) return null;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        return img;
    }

    _getLoadedIcon(img) {
        if (!img) return null;
        if (!img.complete) return null;
        if (!Number.isFinite(img.naturalWidth) || img.naturalWidth <= 0) return null;
        return img;
    }

    getPowerupIcon(type) {
        if (!type) return null;
        const img = this._powerupIcons ? this._powerupIcons[type] : null;
        return this._getLoadedIcon(img);
    }

    formatTime(totalSeconds) {
        const total = Math.max(0, totalSeconds);
        const minutes = Math.floor(total / 60);
        const seconds = Math.floor(total % 60);
        const centis = Math.floor((total * 100) % 100);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(centis).padStart(2, '0')}`;
    }

    updateHUD(entityManager) {
        const timeText = this.formatTime(this.game.runTime || 0);
        if (this.hud.time && this._hudState.time !== timeText) {
            this.hud.time.textContent = timeText;
            this._hudState.time = timeText;
        }

        const weapon = this.game.weaponSystem && this.game.weaponSystem.weapons
            ? this.game.weaponSystem.weapons[this.game.weaponSystem.activeWeaponIndex] : null;
        const weaponName = weapon ? weapon.name : 'Repeater';
        const level = this.game.upgradeManager ? this.game.upgradeManager.level : 1;
        const suffix = this.game && typeof this.game.getHudStatusSuffix === 'function'
            ? this.game.getHudStatusSuffix()
            : '';
        const weaponText = suffix
            ? `Level ${level} ${weaponName} | ${suffix}`
            : `Level ${level} ${weaponName}`;
        if (this.hud.weapon && this._hudState.weapon !== weaponText) {
            this.hud.weapon.textContent = weaponText;
            this._hudState.weapon = weaponText;
        }

        if (this.hud.wordRush) {
            const rushText = this.game && typeof this.game.getWordRushHudText === 'function'
                ? this.game.getWordRushHudText()
                : '';
            const visible = !!rushText;
            if (this._hudState.wordRushText !== rushText) {
                this.hud.wordRush.textContent = rushText;
                this._hudState.wordRushText = rushText;
            }
            if (this._hudState.wordRushVisible !== visible) {
                this.hud.wordRush.style.display = visible ? 'block' : 'none';
                this._hudState.wordRushVisible = visible;
            }
            this.hud.wordRush.classList.toggle('is-active', visible);
        }

        if (this.game.upgradeManager && this.hud.xpFill && this.hud.level) {
            const xpPct = clamp((this.game.upgradeManager.xp / this.game.upgradeManager.nextLevelXp) * 100, 0, 100);
            const xpRounded = Math.round(xpPct * 10) / 10;
            if (this._hudState.xpPct !== xpRounded) {
                this.hud.xpFill.style.width = `${xpRounded}%`;
                this._hudState.xpPct = xpRounded;
            }

            const levelText = `Lvl ${this.game.upgradeManager.level}`;
            if (this._hudState.levelText !== levelText) {
                this.hud.level.textContent = levelText;
                this._hudState.levelText = levelText;
            }
        }
    }
}
