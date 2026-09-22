import { PARTICLES } from '../core/constants.js';

/**
 * Lightweight particle pool for impact feedback: blood off bodies, sparks off
 * walls, smoke off explosions.
 *
 * Fixed-capacity ring buffer - allocation-free in steady state, and it can
 * never grow without bound no matter how hard the fight gets.
 */
export class ParticleSystem {
  constructor(capacity = PARTICLES.MAX) {
    this.capacity = capacity;
    this.items = Array.from({ length: capacity }, () => ({
      active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, sprite: 'blood', scale: 0.1, gravity: PARTICLES.GRAVITY,
    }));
    this.cursor = 0;
    this.activeCount = 0;
  }

  #next() {
    // Overwrite the oldest slot when saturated.
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    if (!item.active) this.activeCount += 1;
    return item;
  }

  /**
   * @param {object} spec {x, y, z, sprite, count, speed, spread, scale, life, gravity}
   */
  burst({ x, y, z = 0.5, sprite = 'blood', count = 6, speed = 2.4, scale = 0.09,
    life = PARTICLES.LIFETIME, gravity = PARTICLES.GRAVITY, rng }) {
    for (let i = 0; i < count; i += 1) {
      const item = this.#next();
      const angle = rng ? rng.range(0, Math.PI * 2) : Math.random() * Math.PI * 2;
      const magnitude = (rng ? rng.range(0.35, 1) : Math.random() * 0.65 + 0.35) * speed;
      item.active = true;
      item.x = x;
      item.y = y;
      item.z = z;
      item.vx = Math.cos(angle) * magnitude;
      item.vy = Math.sin(angle) * magnitude;
      item.vz = (rng ? rng.range(0.6, 2.6) : Math.random() * 2 + 0.6);
      item.life = life * (rng ? rng.range(0.7, 1.2) : 1);
      item.maxLife = item.life;
      item.sprite = sprite;
      item.scale = scale * (rng ? rng.range(0.7, 1.35) : 1);
      item.gravity = gravity;
    }
  }

  /** @param {import('../world/grid.js').Grid} grid used to stop particles at walls */
  update(dt, grid) {
    let active = 0;
    for (const item of this.items) {
      if (!item.active) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.active = false;
        continue;
      }

      const nextX = item.x + item.vx * dt;
      const nextY = item.y + item.vy * dt;
      if (grid && grid.isBlocking(Math.floor(nextX), Math.floor(nextY))) {
        // Kill lateral motion against geometry instead of passing through it.
        item.vx = 0;
        item.vy = 0;
      } else {
        item.x = nextX;
        item.y = nextY;
      }

      item.vz -= item.gravity * dt;
      item.z += item.vz * dt;
      if (item.z < 0.04) {
        item.z = 0.04;
        item.vz = 0;
        item.vx *= 0.6;
        item.vy *= 0.6;
      }
      active += 1;
    }
    this.activeCount = active;
  }

  /** Renderer-ready sprite descriptors for every live particle. */
  collect(textures, out) {
    for (const item of this.items) {
      if (!item.active) continue;
      const texture = textures.particles.get(item.sprite);
      if (!texture) continue;
      const fade = Math.max(0, Math.min(1, item.life / item.maxLife));
      out.push({
        x: item.x,
        y: item.y,
        texture,
        scale: item.scale * (0.6 + fade * 0.6),
        vOffset: 0.5 - item.z,
        emissive: item.sprite === 'spark' || item.sprite === 'plasma',
        alpha: fade,
      });
    }
    return out;
  }

  clear() {
    for (const item of this.items) item.active = false;
    this.activeCount = 0;
  }
}
