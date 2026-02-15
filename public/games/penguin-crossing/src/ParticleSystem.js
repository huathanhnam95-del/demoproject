export class Particle {
    constructor(x, y, vx, vy, life, color, size, type) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.life = life;
        this.maxLife = life;
        this.color = color;
        this.size = size;
        this.type = type; // 'snow', 'water', 'sparkle', 'text'
        this.text = ''; // For floating text
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;

        // Gravity
        if (this.type === 'snow' || this.type === 'water') {
            this.vy += 500 * dt;
        } else if (this.type === 'sparkle') {
            this.vy -= 50 * dt; // Float up
        } else if (this.type === 'text') {
            this.vy -= 30 * dt; // Slowly float up
        }
    }
}

export class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    emit(type, x, y, options = {}) {
        const count = options.count || 1;
        const color = options.color || '#fff';
        const speed = options.speed || 100;

        for (let i = 0; i < count; i++) {
            const angle = (Math.random() * Math.PI * 2);
            let vx = Math.cos(angle) * speed * (0.5 + Math.random());
            let vy = Math.sin(angle) * speed * (0.5 + Math.random());

            if (type === 'snow') {
                // Puff outwards and slightly up
                vy = -Math.abs(vy) * 0.5;
            } else if (type === 'text') {
                vx = 0;
                vy = -20;
            }

            const life = options.life || (0.5 + Math.random() * 0.5);
            const size = options.size || (2 + Math.random() * 3);

            const p = new Particle(x, y, vx, vy, life, color, size, type);
            if (type === 'text') p.text = options.text;

            this.particles.push(p);
        }
    }

    emitExplosion(x, y, color, count = 10) {
        this.emit('sparkle', x, y, { count, color, speed: 200, size: 4 });
    }

    emitSnowPuff(x, y) {
        this.emit('snow', x, y, { count: 8, color: '#e2e8f0', speed: 120, size: 3 });
    }

    emitSplash(x, y) {
        this.emit('water', x, y, { count: 12, color: '#38bdf8', speed: 180, size: 4 });
    }

    emitFloatingText(x, y, text, color) {
        this.emit('text', x, y, { count: 1, text, color, life: 1.5, size: 24 });
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update(dt);
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    reset() {
        this.particles = [];
    }
}
