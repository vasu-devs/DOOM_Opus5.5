import { ENEMIES } from '../core/constants.js';
import { angleDelta, distance } from '../core/math.js';
import { findPath } from '../world/pathfinding.js';

export const ENEMY_STATE = Object.freeze({
  DORMANT: 'dormant',   // has not noticed the player yet
  HUNTING: 'hunting',   // knows roughly where the player is, closing in
  FIGHTING: 'fighting', // in range with line of sight
  DYING: 'dying',
  DEAD: 'dead',
});

const REPATH_INTERVAL_MS = 420;
const DEATH_ANIM_MS = 420;
const PAIN_MS = 180;

/**
 * One hostile. Simple but honest AI:
 *   - wakes on sight or on hearing a shot
 *   - closes to its preferred range using A* when sight is blocked
 *   - strafes a little while fighting so it is not a static target
 *   - ranged types lob projectiles, melee types lunge
 */
export class Enemy {
  constructor(type, x, y, rng) {
    const def = ENEMIES[type];
    if (!def) throw new TypeError(`Unknown enemy type: ${type}`);
    this.def = def;
    this.type = type;
    this.x = x;
    this.y = y;
    this.spawnX = x;
    this.spawnY = y;
    this.health = def.health;
    this.state = ENEMY_STATE.DORMANT;
    this.rng = rng;

    this.attackCooldownMs = rng.range(0, def.attackCooldownMs);
    this.repathMs = rng.range(0, REPATH_INTERVAL_MS);
    this.painMs = 0;
    this.dyingMs = 0;
    this.animPhase = rng.range(0, Math.PI * 2);
    this.path = [];
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.strafeSwapMs = rng.range(400, 1400);
    this.lastKnownPlayer = null;
  }

  isDead() {
    return this.state === ENEMY_STATE.DEAD || this.state === ENEMY_STATE.DYING;
  }

  isThreat() {
    return !this.isDead();
  }

  alert(playerX, playerY) {
    if (this.isDead()) return;
    if (this.state === ENEMY_STATE.DORMANT) this.state = ENEMY_STATE.HUNTING;
    this.lastKnownPlayer = { x: playerX, y: playerY };
  }

  /** @returns {boolean} true if this hit killed it */
  takeDamage(amount) {
    if (this.isDead()) return false;
    this.health -= amount;
    this.painMs = PAIN_MS;
    if (this.state === ENEMY_STATE.DORMANT) this.state = ENEMY_STATE.HUNTING;
    if (this.health <= 0) {
      this.health = 0;
      this.state = ENEMY_STATE.DYING;
      this.dyingMs = DEATH_ANIM_MS;
      return true;
    }
    return false;
  }

  /**
   * @param {number} dt seconds
   * @param {import('./game.js').Game} game
   */
  update(dt, game) {
    const dtMs = dt * 1000;
    this.painMs = Math.max(0, this.painMs - dtMs);
    this.animPhase += dt * 6;

    if (this.state === ENEMY_STATE.DYING) {
      this.dyingMs -= dtMs;
      if (this.dyingMs <= 0) this.state = ENEMY_STATE.DEAD;
      return;
    }
    if (this.state === ENEMY_STATE.DEAD) return;

    const { player, level } = game;
    if (!player.alive) {
      this.state = ENEMY_STATE.DORMANT;
      return;
    }

    const grid = level.grid;
    const dist = distance(this.x, this.y, player.x, player.y);
    const canSee = dist <= this.def.sightRange
      && grid.hasLineOfSight(this.x, this.y, player.x, player.y, this.def.sightRange);

    if (canSee) {
      this.lastKnownPlayer = { x: player.x, y: player.y };
      if (this.state === ENEMY_STATE.DORMANT) this.state = ENEMY_STATE.HUNTING;
    }

    if (this.state === ENEMY_STATE.DORMANT) return;

    this.attackCooldownMs = Math.max(0, this.attackCooldownMs - dtMs);
    this.strafeSwapMs -= dtMs;
    if (this.strafeSwapMs <= 0) {
      this.strafeDir *= -1;
      this.strafeSwapMs = this.rng.range(500, 1600);
    }

    const inRange = canSee && dist <= this.def.attackRange;
    this.state = inRange ? ENEMY_STATE.FIGHTING : ENEMY_STATE.HUNTING;

    if (inRange) {
      this.#fightBehaviour(dt, game, dist);
    } else {
      this.#huntBehaviour(dt, game, canSee);
    }
  }

  #fightBehaviour(dt, game, dist) {
    const { player, level } = game;
    const grid = level.grid;
    const toPlayer = Math.atan2(player.y - this.y, player.x - this.x);

    // Hold a comfortable distance, strafing sideways while doing it.
    let forward = 0;
    if (dist > this.def.preferredRange * 1.25) forward = 1;
    else if (dist < this.def.preferredRange * 0.6) forward = -0.7;
    const strafe = this.def.ranged ? this.strafeDir * 0.75 : 0;

    const speed = this.def.speed;
    const dx = (Math.cos(toPlayer) * forward - Math.sin(toPlayer) * strafe) * speed * dt;
    const dy = (Math.sin(toPlayer) * forward + Math.cos(toPlayer) * strafe) * speed * dt;
    const next = grid.resolveMove(this.x, this.y, this.x + dx, this.y + dy, this.def.radius);
    this.x = next.x;
    this.y = next.y;

    if (this.attackCooldownMs <= 0) {
      this.attackCooldownMs = this.def.attackCooldownMs;
      game.enemyAttack(this, toPlayer, dist);
    }
  }

  #huntBehaviour(dt, game, canSee) {
    const { player, level } = game;
    const grid = level.grid;
    const goal = canSee ? { x: player.x, y: player.y } : this.lastKnownPlayer;
    if (!goal) return;

    this.repathMs -= dt * 1000;
    if (canSee) {
      this.path = [];
    } else if (this.repathMs <= 0 || this.path.length === 0) {
      this.repathMs = REPATH_INTERVAL_MS;
      this.path = findPath(grid, this, goal, 4000);
      if (this.path.length === 0 && !canSee) {
        // Lost the trail entirely - go dormant rather than jitter in place.
        this.lastKnownPlayer = null;
        this.state = ENEMY_STATE.DORMANT;
        return;
      }
    }

    let targetX = goal.x;
    let targetY = goal.y;
    if (!canSee && this.path.length > 0) {
      const node = this.path[0];
      targetX = node.x + 0.5;
      targetY = node.y + 0.5;
      if (distance(this.x, this.y, targetX, targetY) < 0.28) this.path.shift();
    }

    const heading = Math.atan2(targetY - this.y, targetX - this.x);
    const speed = this.def.speed;
    const dx = Math.cos(heading) * speed * dt;
    const dy = Math.sin(heading) * speed * dt;
    const next = grid.resolveMove(this.x, this.y, this.x + dx, this.y + dy, this.def.radius);

    // Nudge doors open when bumping into them.
    if (next.x === this.x && next.y === this.y) {
      const doorX = Math.floor(this.x + Math.cos(heading) * 0.8);
      const doorY = Math.floor(this.y + Math.sin(heading) * 0.8);
      grid.doorAt(doorX, doorY)?.open();
      this.repathMs = 0;
    }
    this.x = next.x;
    this.y = next.y;

    if (!canSee && this.lastKnownPlayer
      && distance(this.x, this.y, this.lastKnownPlayer.x, this.lastKnownPlayer.y) < 0.5) {
      this.lastKnownPlayer = null;
      this.state = ENEMY_STATE.DORMANT;
    }
  }

  /** Which sprite frame to show this instant. */
  frameIndex() {
    if (this.painMs > 0) return 3;
    if (this.state === ENEMY_STATE.DORMANT) return 0;
    return Math.sin(this.animPhase) > 0 ? 1 : 2;
  }

  /** How threatening this enemy is to a player at (px,py) - used by the agent. */
  threatScore(px, py) {
    const dist = Math.max(0.5, distance(this.x, this.y, px, py));
    const dps = this.def.damage / (this.def.attackCooldownMs / 1000);
    const proximity = this.def.ranged ? 1 / dist : 3 / dist;
    return dps * proximity;
  }
}

/** Facing-aware helper used for the agent's aim checks. */
export const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

export const aimError = (shooterAngle, from, to) => Math.abs(angleDelta(shooterAngle, angleTo(from, to)));
