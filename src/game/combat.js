import { RENDER } from '../core/constants.js';
import { castRay } from '../render/raycaster.js';

/**
 * Hitscan and projectile resolution.
 * Kept free of rendering and input so the rules can be unit tested directly.
 */

/**
 * Nearest live enemy struck by a ray, respecting walls.
 * Ray-vs-circle: solve |o + t*d - c|^2 = r^2 for the smallest positive t.
 *
 * @returns {{enemy: import('./enemies.js').Enemy, distance: number}|null}
 */
export function raycastEnemies(grid, enemies, originX, originY, angle, range) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const wall = castRay(grid, originX, originY, dx, dy, Math.min(range, RENDER.MAX_DEPTH));
  const wallDistance = wall.hit ? wall.distance : range;

  let best = null;
  for (const enemy of enemies) {
    if (enemy.isDead()) continue;
    const ox = enemy.x - originX;
    const oy = enemy.y - originY;
    const projection = ox * dx + oy * dy;      // distance along the ray to the closest point
    if (projection <= 0) continue;             // behind the shooter
    const radius = enemy.def.radius;
    const perpSq = ox * ox + oy * oy - projection * projection;
    if (perpSq > radius * radius) continue;    // ray misses the cylinder
    const halfChord = Math.sqrt(radius * radius - perpSq);
    const t = projection - halfChord;
    const hitDistance = t > 0 ? t : projection;
    if (hitDistance > range || hitDistance > wallDistance) continue;
    if (!best || hitDistance < best.distance) best = { enemy, distance: hitDistance };
  }
  return best;
}

/**
 * Fire one weapon's worth of pellets.
 * @returns {{hits: number, kills: import('./enemies.js').Enemy[], impacts: {x:number,y:number}[]}}
 */
export function fireHitscan({ grid, enemies, originX, originY, angle, weapon, rng }) {
  const kills = [];
  const impacts = [];
  let hits = 0;

  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    const deviation = (rng.next() + rng.next() - 1) * weapon.spread; // triangular, centre-weighted
    const shotAngle = angle + deviation;
    const result = raycastEnemies(grid, enemies, originX, originY, shotAngle, weapon.range);
    if (result) {
      hits += 1;
      if (result.enemy.takeDamage(weapon.damage)) kills.push(result.enemy);
      impacts.push({
        x: originX + Math.cos(shotAngle) * result.distance,
        y: originY + Math.sin(shotAngle) * result.distance,
        onEnemy: true,
      });
    } else {
      const wall = castRay(grid, originX, originY, Math.cos(shotAngle), Math.sin(shotAngle), weapon.range);
      impacts.push({
        x: originX + Math.cos(shotAngle) * wall.distance,
        y: originY + Math.sin(shotAngle) * wall.distance,
        onEnemy: false,
      });
    }
  }
  return { hits, kills, impacts };
}

/** A slow enemy projectile the player can sidestep. */
export class Projectile {
  constructor({ x, y, angle, speed, damage, sprite, radius = 0.16, lifeSeconds = 6 }) {
    this.x = x;
    this.y = y;
    this.dx = Math.cos(angle) * speed;
    this.dy = Math.sin(angle) * speed;
    this.damage = damage;
    this.sprite = sprite;
    this.radius = radius;
    this.life = lifeSeconds;
    this.dead = false;
  }

  /**
   * Substepped so fast projectiles cannot tunnel through thin walls.
   * @returns {'none'|'wall'|'player'}
   */
  update(dt, grid, player) {
    if (this.dead) return 'none';
    this.life -= dt;
    if (this.life <= 0) {
      this.dead = true;
      return 'none';
    }

    const steps = Math.max(1, Math.ceil((Math.hypot(this.dx, this.dy) * dt) / 0.12));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      this.x += this.dx * stepDt;
      this.y += this.dy * stepDt;

      if (grid.isBlocking(Math.floor(this.x), Math.floor(this.y))) {
        this.dead = true;
        return 'wall';
      }
      if (player.alive && Math.hypot(player.x - this.x, player.y - this.y) < this.radius + 0.28) {
        this.dead = true;
        return 'player';
      }
    }
    return 'none';
  }
}
