import {
    IcebergState,
    ICEBERG_WIDTH,
    ICEBERG_HEIGHT,
    ICEBERG_SINK_SPEED,
    PENGUIN_RADIUS,
    JUMP_DURATION,
    JUMP_ARC_HEIGHT,
} from './GameConfig.js';

/* ------------------------------------------------------------------ */
/*  EntityManager                                                      */
/* ------------------------------------------------------------------ */
export class EntityManager {
    constructor() {
        this.icebergs = [];
        this.penguin = null;
    }

    addIceberg(iceberg) {
        this.icebergs.push(iceberg);
    }

    cleanup() {
        this.icebergs = this.icebergs.filter(ib => {
            if (ib.state === IcebergState.SINKING && ib.sinkProgress >= 1) return false;
            if (ib.x < -400) return false;
            return true;
        });
    }

    update(dt) {
        for (const ib of this.icebergs) ib.update(dt);
        if (this.penguin) this.penguin.update(dt);
    }

    reset() {
        this.icebergs = [];
        this.penguin = null;
    }
}

/* ------------------------------------------------------------------ */
/*  Iceberg                                                            */
/* ------------------------------------------------------------------ */
export class Iceberg {
    constructor(x, y, word, pathIndex = 0) {
        this.x = x;
        this.y = y;
        this.word = word;
        this.pathIndex = pathIndex;
        this.processedText = '';
        this.remainingText = word;
        // Text scaling: ~26px per char
        this.width = Math.max(ICEBERG_WIDTH, word.length * 26 + 60);
        this.height = ICEBERG_HEIGHT;
        this.velocity = 0;
        this.sinkProgress = 0;
        this.errorFlash = 0;
        this.state = IcebergState.ACTIVE;
    }

    update(dt) {
        if (this.state === IcebergState.SINKING) {
            this.sinkProgress += dt / ICEBERG_SINK_SPEED;
        }

        this.x -= this.velocity * dt;

        if (this.errorFlash > 0) this.errorFlash = Math.max(0, this.errorFlash - dt);
    }

    complete() {
        this.state = IcebergState.COMPLETED;
    }

    startSinking() {
        this.state = IcebergState.SINKING;
    }
}

/* ------------------------------------------------------------------ */
/*  Penguin                                                            */
/* ------------------------------------------------------------------ */
export class Penguin {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.currentIceberg = null;
        this.isJumping = false;
        this.jumpTarget = null;
        this.jumpProgress = 0;
        this.frameIndex = 0;
        this._jumpStartX = 0;
        this._jumpStartY = 0;
    }

    update(dt) {
        if (this.isJumping && this.jumpTarget) {
            this.jumpProgress += dt / JUMP_DURATION;

            // map jumpProgress to 4 animation frames (0, 1, 2, 3)
            this.frameIndex = Math.min(3, Math.floor(this.jumpProgress * 4));

            if (this.jumpProgress >= 1) {
                this.jumpProgress = 1;
                this.isJumping = false;
                this.frameIndex = 0; // Return to idle/standing

                if (this.currentIceberg &&
                    this.currentIceberg !== this.jumpTarget &&
                    this.currentIceberg.state !== IcebergState.SINKING) {
                    this.currentIceberg.startSinking();
                }

                this.currentIceberg = this.jumpTarget;
                this.jumpTarget = null;
                this._snapToIceberg();
            } else {
                const t = this.jumpProgress;

                const targetX = this.jumpTarget.x + this.jumpTarget.width / 2;
                const targetY = this.jumpTarget.y + 15; // Feet level correctly on top slope

                const lx = this._jumpStartX + (targetX - this._jumpStartX) * t;
                const ly = this._jumpStartY + (targetY - this._jumpStartY) * t;

                const arcOffset = -4 * JUMP_ARC_HEIGHT * t * (t - 1);

                this.x = lx;
                this.y = ly - arcOffset;
            }
        } else if (this.currentIceberg) {
            this.frameIndex = 0;
            this._snapToIceberg();
        }
    }

    _snapToIceberg() {
        this.x = this.currentIceberg.x + this.currentIceberg.width / 2;
        // Adjusted to touch surface (iceberg.y is the top edge, but 3D has some depth)
        // Offset +15px to look like feet are ON the snow
        this.y = this.currentIceberg.y + 15;
    }

    jumpTo(iceberg) {
        this._jumpStartX = this.x;
        this._jumpStartY = this.y;
        this.isJumping = true;
        this.jumpTarget = iceberg;
        this.jumpProgress = 0;
        this.frameIndex = 0;
    }
}
