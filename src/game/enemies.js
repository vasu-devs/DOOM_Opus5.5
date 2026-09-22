import { ENEMIES, DIFFICULTY } from '../core/constants.js';
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
const DEATH_ANIM_MS = 560;
const PAIN_MS = 180;
const WALK_CYCLE_SPEED = 5.2;

/**
 * One hostile. Simple but honest AI:
 *   - wakes on sight or on hearing a shot
 *   - closes to its preferred range using A* when sight is blocked
 *   - strafes while fighting so it is not a static target
 *   - telegraphs every attack with a windup pose before it commits
 *   - ranged types lob projectiles, melee types lunge
 */
export class Enemy {
  /**
   * @param {string} type
   * @param {number} x
   * @param {number} y
   * @param {import('../core/rng.js').Rng} rng
   * @param {object} difficulty entry from DIFFICULTY
   */
  constructor(type, x, y, rng, difficulty = DIFFICULTY.NORMAL) {
    const def = ENEMIES[type];
    if (!def) throw new TypeError(`Unknown enemy type: ${type}`);
    this.def = def;
    this.type = type;
    this.x = x;
    this.y = y;
    this.spawnX = x;
    this.spawnY = y;
    this.difficulty = difficulty;
    this.maxHealth = Math.round(def.health * difficulty.enemyHealth);
    this.health = this.maxHealth;
    this.state = ENEMY_STATE.DORMANT;
    this.rng = rng;

    this.attackCooldownMs = rng.range(0, def.attackCooldownMs);
    this.windupMs = 0;
    this.repathMs = rng.range(0, REPATH_INTERVAL_MS);
    this.painMs = 0;
    this.dyingMs = 0;
    this.deathStage = 0;
    this.walkPhase = rng.range(0, Math.PI * 2);
    this.animPhase = this.walkPhase;
    this.path = [];
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.strafeSwapMs = rng.range(400, 1400);
    this.lastKnownPlayer = null;
    this.justDied = false;
  }

  isDead() {
    return this.state === ENEMY_STATE.DEAD || this.state === ENEMY_STATE.DYING;
  }

  isThreat() {
    return !this.isDead();
  }

  alert(playerX, playerY) {
    if (this.isDead()) return false;
    const wasAsleep = this.state === ENEMY_STATE.DORMANT;
    if (wasAsleep) this.state = ENEMY_STATE.HUNTING;
    this.lastKnownPlayer = { x: playerX, y: playerY };
    return wasAsleep;
  }

  /** @returns {boolean} true if this hit killed it */
  takeDamage(amount) {
    if (this.isDead()) return false;
    this.health -= amount;
    this.painMs = PAIN_MS;
    this.windupMs = 0; // getting hit interrupts a wind-up
    if (this.state === ENEMY_STATE.DORMANT) this.state = ENEMY_STATE.HUNTING;
    if (this.health <= 0) {
      this.health = 0;
      this.state = ENEMY_STATE.DYING;
      this.dyingMs = DEATH_ANIM_MS;
      this.deathStage = 0;
      this.justDied = true;
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
      const progress = 1 - Math.max(0, this.dyingMs) / DEATH_ANIM_MS;
      this.deathStage = Math.min(3, Math.floor(progress * 4));
      if (this.dyingMs <= 0) {
        this.state = ENEMY_STATE.DEAD;
        this.deathStage = 3;
      }
      return;
    }
    if (this.state === ENEMY_STATE.DEAD) return;

    const { player, level } = game;
    if (!player.alive) {
      this.state = ENEMY_STATE.DORMANT;
      this.windupMs = 0;
      return;
    }

    const grid = level.grid;
    const dist = distance(this.x, this.y, player.x, player.y);
    const canSee = dist <= this.def.sightRange
      && grid.hasLineOfSight(this.x, this.y, player.x, player.y, this.def.sightRange);

    if (canSee) {
      this.lastKnownPlayer = { x: player.x, y: player.y };
      if (this.state === ENEMY_STATE.DORMANT) {
        this.state = ENEMY_STATE.HUNTING;
        game.onEnemyAlerted?.(this);
      }
    }

    if (this.state === ENEMY_STATE.DORMANT) return;

    this.attackCooldownMs = Math.max(0, this.attackCooldownMs - dtMs);
    this.strafeSwapMs -= dtMs;
    if (this.strafeSwapMs <= 0) {
      this.strafeDir *= -1;
      this.strafeSwapMs = this.rng.range(500, 1600);
    }

    // A committed wind-up resolves into the actual attack.
    if (this.windupMs > 0) {
      this.windupMs -= dtMs;
      if (this.windupMs <= 0) {
        const stillValid = canSee && dist <= this.def.attackRange;
        if (stillValid) {
          const toPlayer = Math.atan2(player.y - this.y, player.x - this.x);
          game.enemyAttack(this, toPlayer, dist);
        }
      }
      return; // rooted while winding up: that is the player's cue to move
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

    let forward = 0;
    if (dist > this.def.preferredRange * 1.25) forward = 1;
    else if (dist < this.def.preferredRange * 0.6) forward = -0.7;
    const strafe = this.def.ranged ? this.strafeDir * 0.75 : 0;

    const speed = this.def.speed;
    const dx = (Math.cos(toPlayer) * forward - Math.sin(toPlayer) * strafe) * speed * dt;
    const dy = (Math.sin(toPlayer) * forward + Math.cos(toPlayer) * strafe) * speed * dt;
    const next = grid.resolveMove(this.x, this.y, this.x + dx, this.y + dy, this.def.radius);
    if (next.x !== this.x || next.y !== this.y) this.walkPhase += dt * WALK_CYCLE_SPEED;
    this.x = next.x;
    this.y = next.y;

    if (this.attackCooldownMs <= 0) {
      this.attackCooldownMs = this.def.attackCooldownMs * this.difficulty.enemyCooldown;
      this.windupMs = this.def.windupMs;
      game.onEnemyWindup?.(this);
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

    if (next.x === this.x && next.y === this.y) {
      // Bumped something: nudge a door and re-plan.
      const doorX = Math.floor(this.x + Math.cos(heading) * 0.8);
      const doorY = Math.floor(this.y + Math.sin(heading) * 0.8);
      grid.doorAt(doorX, doorY)?.open();
      this.repathMs = 0;
    } else {
      this.walkPhase += dt * WALK_CYCLE_SPEED;
    }
    this.x = next.x;
    this.y = next.y;

    if (!canSee && this.lastKnownPlayer
      && distance(this.x, this.y, this.lastKnownPlayer.x, this.lastKnownPlayer.y) < 0.5) {
      this.lastKnownPlayer = null;
      this.state = ENEMY_STATE.DORMANT;
    }
  }

  /**
   * Pick the sprite for this instant from an enemy's animation bank.
   * @param {{walk: object[], attack: object[], pain: object, death: object[]}} bank
   */
  spriteFor(bank) {
    if (this.state === ENEMY_STATE.DEAD) return bank.death[3];
    if (this.state === ENEMY_STATE.DYING) return bank.death[this.deathStage];
    if (this.painMs > 0) return bank.pain;
    if (this.windupMs > 0) {
      // Second half of the wind-up shows the release pose.
      return this.windupMs < this.def.windupMs * 0.4 ? bank.attack[1] : bank.attack[0];
    }
    if (this.state === ENEMY_STATE.DORMANT) return bank.walk[0];
    const frame = Math.floor(this.walkPhase) % 4;
    return bank.walk[frame < 0 ? frame + 4 : frame];
  }

  /** How threatening this enemy is to a player at (px,py) - used by the agent. */
  threatScore(px, py) {
    const dist = Math.max(0.5, distance(this.x, this.y, px, py));
    const dps = this.def.damage / (this.def.attackCooldownMs / 1000);
    const proximity = this.def.ranged ? 1 / dist : 3 / dist;
    return dps * proximity;
  }
}

/** Facing-aware helpers used for the agent's aim checks. */
export const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

export const aimError = (shooterAngle, from, to) => Math.abs(angleDelta(shooterAngle, angleTo(from, to)));
