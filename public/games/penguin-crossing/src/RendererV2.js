import {
    GameState,
    IcebergState,
    COLORS,
    WORD_FONT,
    HUD_FONT,
    HUD_LARGE_FONT,
    DANGER_ZONE_X,
    RIVER_BANK_TOP_Y,
    RIVER_BANK_BOTTOM_Y,
    WATER_TOP_Y,
    WATER_BOTTOM_Y,
    SCALE_FAR,
    SCALE_NEAR,
    CAMERA_DRIFT_X,
    CAMERA_DRIFT_Y,
    PENGUIN_CLIPS
} from './GameConfig.js';

const ASSET_BASE = '/games/penguin-crossing/assets';
const ASSET_PATHS = {
    bgSky: `${ASSET_BASE}/bg_sky.png`,
    bgMountains: `${ASSET_BASE}/bg_mountains.png`,
    bgShore: `${ASSET_BASE}/bg_shore.png`,
    waterBase: `${ASSET_BASE}/bg_water_base.png`,
    waterShimmer: `${ASSET_BASE}/bg_water_shimmer.png`,
    fgSnow: `${ASSET_BASE}/fg_snowbank.png`,

    iceberg: `${ASSET_BASE}/floe_01.png`,

    penguinIdle: `${ASSET_BASE}/penguin_idle_sheet.png`,
    penguinJump: `${ASSET_BASE}/penguin_jump_sheet.png`,
    penguinFail: `${ASSET_BASE}/penguin_fail_sheet.png`,

    fxSnowPuff: `${ASSET_BASE}/fx_snow_puff_sheet.png`,
    fxRipple: `${ASSET_BASE}/fx_ripple_ring.png`,
};

export class Renderer {
    constructor(ctx, width, height) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
        this.images = {};
        this._assetsLoaded = false;

        this._now = 0;
        this._now = 0;
        this.camera = { x: 0, y: 0 };
        this.trauma = 0; // 0 to 1, used for screen shake
    }

    addTrauma(amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    }

    loadAssets() {
        const entries = Object.entries(ASSET_PATHS);
        let loadedCount = 0;

        const promises = entries.map(([key, src]) =>
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    this.images[key] = img;
                    loadedCount++;
                    resolve();
                };
                img.onerror = () => {
                    console.warn(`Failed to load: ${src}`);
                    resolve(); // Continue anyway
                };
                img.src = src;
            })
        );

        return Promise.all(promises).then(() => {
            console.log(`Assets loaded: ${loadedCount}/${entries.length}`);
            this._assetsLoaded = true;
        });
    }

    clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    draw(entityManager, gameState, score, particleSystem, nowMs = performance.now()) {
        this._now = nowMs;

        // 1. Clear Screen
        this.clear();

        // 1b. Screen Shake
        let shakeX = 0;
        let shakeY = 0;
        if (this.trauma > 0) {
            const shake = this.trauma * this.trauma; // Quadratic falloff
            shakeX = (Math.random() - 0.5) * 20 * shake;
            shakeY = (Math.random() - 0.5) * 20 * shake;
            this.trauma = Math.max(0, this.trauma - 2 * (16 / 1000)); // Decay approx dt

            this.ctx.save();
            this.ctx.translate(shakeX, shakeY);
        }

        // 2. Update Clean Camera Drift
        const px = entityManager.penguin?.x ?? this.width * 0.7;
        const progress01 = Math.max(0, Math.min(1, 1 - (px / this.width)));
        this.camera.x = (progress01 - 0.5) * CAMERA_DRIFT_X;
        this.camera.y = Math.sin(nowMs * 0.0002) * CAMERA_DRIFT_Y;

        // 3. Draw Background Layers (Parallax)
        this._drawEnvironmentLayers();

        // 4. Draw Danger Zone (Under entities)
        this._drawDangerZone();

        // 5. Build Render List & Y-Sort
        const drawables = [];

        for (const ib of entityManager.icebergs) {
            // Project center point for sorting
            const proj = this._project(ib.x + ib.width / 2, ib.y + ib.height / 2);
            drawables.push({ type: 'iceberg', ref: ib, sortY: proj.y });
        }

        if (entityManager.penguin) {
            const p = entityManager.penguin;
            // Project penguin position
            const proj = this._project(p.x, p.y);
            drawables.push({ type: 'penguin', ref: p, sortY: proj.y });
        }

        // Sort: Painter's Algorithm (Far -> Near)
        drawables.sort((a, b) => a.sortY - b.sortY);

        // 6. Draw Sorted Entities
        for (const d of drawables) {
            if (d.type === 'iceberg') this._drawIcebergProjected(d.ref);
            else this._drawPenguinProjected(d.ref);
        }

        // 7. Overlays
        if (particleSystem) this._drawParticles(particleSystem);
        this._drawWaterShimmer();
        this._drawForeground();

        // 8. HUD & UI
        if (gameState === GameState.PLAYING) this._drawHUD(score);
        if (gameState === GameState.GAME_OVER) this._drawGameOver(score);

        // 9. Vignette & Atmosphere
        const isDanger = (entityManager.penguin?.x ?? 0) < this.width * 0.2;
        const isHeat = (score.heat ?? 0) > 80;
        this._drawVignette(isDanger, isHeat);

        // 10. HUD
        this._drawHUD(score);

        if (shakeX !== 0 || shakeY !== 0) {
            this.ctx.restore(); // Restore shake
        }
    }

    drawLoading() {
        const { ctx, width, height } = this;
        ctx.fillStyle = COLORS.water;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'white';
        ctx.font = HUD_FONT;
        ctx.textAlign = 'center';
        ctx.fillText('Loading 2.5D Arctic Assets...', width / 2, height / 2);
    }

    /* ==== PROJECTION & UTILS ==== */

    _project(worldX, worldY) {
        // Normalize depth within the river band (0.0 = Far/Top, 1.0 = Near/Bottom)
        const t = (worldY - WATER_TOP_Y) / (WATER_BOTTOM_Y - WATER_TOP_Y);
        const depth01 = Math.max(0, Math.min(1, t));

        // Lerp scale
        const scale = SCALE_FAR + (SCALE_NEAR - SCALE_FAR) * depth01;

        // Apply camera drift
        const x = worldX - this.camera.x;
        const y = worldY - this.camera.y;

        return { x, y, scale, depth01 };
    }

    /* ==== ENVIRONMENT ==== */

    _drawEnvironmentLayers() {
        const { ctx, width, height } = this;

        // Debug Log (Once per second approx)
        if (Math.random() < 0.01) {
            console.log('RendererV2: Drawing Environment. AssetsLoaded:', this._assetsLoaded);
            if (this.images.bgSky) console.log('RendererV2: bgSky dimensions:', this.images.bgSky.width, this.images.bgSky.height);
        }

        // 0. Base Sky Fill (Prevents checkerboard)
        ctx.fillStyle = '#1e293b'; // Arctic night sky
        ctx.fillRect(0, 0, width, height);

        if (!this._assetsLoaded) return;

        // DEBUG: Draw bgSky WITHOUT clip to verify it exists
        this._drawLayerWithFallback('bgSky', 0.05, '#1e293b');

        // Remove hard clipping for mountains and shore to allow natural overlap
        this._drawLayerWithFallback('bgMountains', 0.12, '#334155');

        // Shore (Far Bank) - Should be BEHIND water
        this._drawLayerWithFallback('bgShore', 0.14, '#475569');

        this._drawLayerWithFallback('waterBase', 0.15, '#0c4a6e', WATER_TOP_Y, WATER_BOTTOM_Y - WATER_TOP_Y);
    }

    _drawLayerWithFallback(key, parallax, fallbackColor, clipY, clipH) {
        const { ctx, width, height } = this;

        if (clipY !== undefined) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, clipY, width, clipH);
            ctx.clip();
        }

        const img = this.images[key];

        if (img && img.width > 0) {
            const ox = -this.camera.x * parallax;
            const oy = -this.camera.y * parallax;
            ctx.drawImage(img, ox, oy, width, height);
        } else if (fallbackColor) {
            ctx.fillStyle = fallbackColor;
            ctx.fillRect(0, clipY ?? 0, width, clipH ?? height);
        }

        if (clipY !== undefined) ctx.restore();
    }

    _drawWaterShimmer() {
        if (!this._assetsLoaded || !this.images.waterShimmer) return;

        const { ctx, width, height } = this;

        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(this.images.waterShimmer, 0, 0, width, height);
        ctx.restore();
    }

    _drawForeground() {
        if (!this._assetsLoaded || !this.images.fgSnow) return;

        const { ctx, width, height } = this;
        ctx.drawImage(this.images.fgSnow, 0, 0, width, height);
    }

    _drawVignette(isDanger, isHeat) {
        const { ctx, width, height } = this;
        const gradient = ctx.createRadialGradient(
            width / 2, height / 2, height * 0.3,
            width / 2, height / 2, height * 0.8
        );

        let outerColor = 'rgba(15, 23, 42, 0.6)'; // Default dark blue
        if (isDanger) outerColor = 'rgba(185, 28, 28, 0.4)'; // Red danger
        if (isHeat) outerColor = 'rgba(234, 88, 12, 0.3)'; // Orange heat

        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, outerColor);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
    }

    _drawDangerZone() {
        const { ctx } = this;
        // Simple indicator on the left bank
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, RIVER_BANK_TOP_Y, DANGER_ZONE_X, RIVER_BANK_BOTTOM_Y - RIVER_BANK_TOP_Y);
        ctx.restore();
    }

    /* ==== PARTICLES ==== */

    _drawParticles(system) {
        const { ctx } = this;
        for (const p of system.particles) {
            const { x, y, scale } = this._project(p.x, p.y);

            ctx.save();
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.min(1, p.life * 2); // Fade out

            const size = p.size * scale;

            if (p.type === 'text') {
                ctx.font = `bold ${20 * scale}px "Outfit", sans-serif`;
                ctx.textAlign = 'center';
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.strokeText(p.text, x, y);
                ctx.fillText(p.text, x, y);
            } else {
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    /* ==== ENTITIES ==== */

    _drawIcebergProjected(ib) {
        const { ctx } = this;

        // Calculate projected position and scale
        const cx = ib.x + ib.width / 2;
        const cy = ib.y + ib.height / 2;
        const { x, y, scale } = this._project(cx, cy);

        // DEBUG: Check bounds

        const alpha = ib.state === IcebergState.SINKING ? Math.max(0, 1 - ib.sinkProgress) : 1;
        const w = ib.width * scale;
        const h = ib.height * scale;
        const drawX = x - w / 2;
        const drawY = y - h / 2;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.beginPath();
        ctx.ellipse(x, y + h * 0.35, w * 0.35, h * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();

        // Glow
        if (ib.state === IcebergState.CURRENT) {
            ctx.shadowColor = COLORS.currentGlow;
            ctx.shadowBlur = 18;
        }

        const img = this.images.iceberg;
        if (this._assetsLoaded && img) {
            ctx.drawImage(img, drawX, drawY, w, h);
        } else {
            // Fallback
            ctx.fillStyle = COLORS.iceberg;
            ctx.fillRect(drawX, drawY, w, h);
        }

        ctx.shadowBlur = 0;

        // Word Rendering (Gold Serif + Bevel)
        if (ib.word) {
            const textY = drawY + h * 0.25;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Auto-fit font size
            const maxW = w * 0.8;
            let fontSize = Math.floor(40 * scale); // Increased font size
            ctx.font = `900 ${fontSize}px "Outfit", sans-serif`;

            // Draw text
            const typed = ib.processedText || '';
            const rem = ib.remainingText || '';
            const fullW = ctx.measureText(ib.word).width;

            let cursorX = x - fullW / 2;

            // Text Shadow (Thicker)
            ctx.lineWidth = 4 * scale;
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.strokeText(ib.word, x, textY);

            // Text Bevel
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillText(ib.word, x - 1, textY - 1);

            // Main Text
            ctx.textAlign = 'left';
            ctx.fillStyle = COLORS.charTyped;
            ctx.fillText(typed, cursorX, textY);

            cursorX += ctx.measureText(typed).width;
            ctx.fillStyle = COLORS.charRemaining;
            ctx.fillText(rem, cursorX, textY);
        }
        ctx.restore();
    }

    _drawPenguinProjected(p) {
        const { ctx } = this;
        // Penguin y is "feet position", so standard project works
        const { x, y, scale } = this._project(p.x, p.y);

        // DEBUG: Check bounds

        // Determine Clip
        let clipName = 'idle';
        if (p.isJumping) clipName = 'jump';
        // if (p.isFailing) clipName = 'fail'; // Future

        const clip = PENGUIN_CLIPS[clipName];
        const img = this.images[clip?.key];

        const spriteScale = 0.35 * scale; // Adjust base sprite size
        const spriteW = clip.frameW * spriteScale;
        const spriteH = clip.frameH * spriteScale;

        ctx.save();

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + 5 * scale, 20 * scale, 8 * scale, 0, 0, Math.PI * 2);
        ctx.fill();

        if (this._assetsLoaded && clip && img) {
            // Animation Frame Logic
            if (p.animStart == null) p.animStart = this._now * 0.001; // Init timestamp

            const t = this._now * 0.001 - p.animStart;
            let frame = Math.floor(t * clip.fps);

            if (clip.loop) {
                frame = frame % clip.frames;
            } else {
                frame = Math.min(frame, clip.frames - 1);
            }

            const sx = frame * clip.frameW;
            const sy = 0;

            // Anchor: Feet at center bottom
            ctx.drawImage(img,
                sx, sy, clip.frameW, clip.frameH,
                x - spriteW / 2, y - spriteH * 0.85, spriteW, spriteH);
            // 0.85 offset to ground feet
        } else {
            // Fallback
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.ellipse(x, y - 10, 15 * scale, 25 * scale, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    /* ==== HUD ==== */

    _drawHUD(stats) {
        const { ctx, width } = this;
        const { wordsCompleted, wpm, accuracy, score, combo, heat, multiplier } = stats;

        ctx.save();

        // 1. Stats Panel (Top Left)
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        ctx.font = 'bold 24px "Outfit", sans-serif';

        const padding = 20;
        let y = 40;

        const drawText = (text, color = '#f8fafc') => {
            ctx.strokeText(text, padding, y);
            ctx.fillStyle = color;
            ctx.fillText(text, padding, y);
            y += 30;
        };

        drawText(`SCORE: ${score || 0}`, '#fbbf24');
        drawText(`WPM: ${wpm || 0}`);

        if (combo > 1) {
            y += 10;
            ctx.font = 'bold 28px "Outfit", sans-serif';
            drawText(`${combo} COMBO!`, '#38bdf8');
            drawText(`x${multiplier} MULTIPLIER`, '#f472b6');
        }

        // 2. Heat Gauge (Right Side)
        if (heat > 0) {
            const barW = 20;
            const barH = 200;
            const barX = width - 40;
            const barY = 100;

            // Background
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, barY, barW, barH);

            // Fill
            const fillH = (heat / 100) * barH;
            const heatColor = heat > 80 ? '#ef4444' : (heat > 50 ? '#fbbf24' : '#38bdf8');

            ctx.fillStyle = heatColor;
            ctx.fillRect(barX, barY + (barH - fillH), barW, fillH);

            // Frame
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(barX, barY, barW, barH);

            if (heat >= 100) {
                // Glow effect
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 20;
                ctx.strokeRect(barX, barY, barW, barH);
                ctx.shadowBlur = 0;
            }
        }
        ctx.restore();
    }

    _drawGameOver(score) {
        const { ctx, width, height } = this;
        ctx.save();
        ctx.fillStyle = 'rgba(0, 10, 30, 0.85)';
        ctx.fillRect(0, 0, width, height);

        ctx.shadowColor = '#000';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#fff';
        ctx.font = HUD_LARGE_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GAME OVER', width / 2, height / 2 - 40);

        ctx.font = '24px "Outfit"';
        ctx.fillStyle = '#ccc';
        ctx.fillText('Press ENTER to retry', width / 2, height / 2 + 30);
        ctx.restore();
    }
}
