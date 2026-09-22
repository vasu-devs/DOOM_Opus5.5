import {
  AGENT, WEAPON_ID, WEAPONS, WEAPON_AMMO, PICKUP, TILE,
} from '../core/constants.js';
import { angleDelta, clamp, distance } from '../core/math.js';
import { findPath } from '../world/pathfinding.js';
import { CODES } from '../core/logger.js';

export const AGENT_MODE = Object.freeze({
  IDLE: 'IDLE',
  FIGHT: 'FIGHT',
  HEAL: 'HEAL',
  LOOT: 'LOOT',
  ADVANCE: 'ADVANCE',
  UNSTICK: 'UNSTICK',
});

const LOOT_MAX_DETOUR = 14;     // tiles of path an item is worth
const HEAL_MAX_DETOUR = 26;
const DODGE_RADIUS = 4.5;
const REPATH_ON_GOAL_MOVE = 1.5;

/**
 * Autoplay agent.
 *
 * It is a *player*, not a cheat: it reads the same world state a human sees on
 * screen (enemies it has line of sight to, items it has explored) and emits the
 * same intent structure the keyboard produces - no teleporting, no aimbot
 * snapping, no ignoring walls.
 *
 * Loop, once every AGENT.THINK_INTERVAL_MS:
 *   sense -> score goals -> pick a mode -> plan an A* route -> pick a weapon.
 * Every frame in between it steers toward the plan and dodges live projectiles.
 */
export class AutoplayAgent {
  /** @param {{logger: import('../core/logger.js').Logger}} deps */
  constructor({ logger }) {
    this.logger = logger;
    this.enabled = false;
    this.mode = AGENT_MODE.IDLE;
    this.goal = null;
    this.goalLabel = 'standby';
    this.path = [];
    this.target = null;

    this.thinkAccumulatorMs = 0;
    this.strafeTimerMs = 0;
    this.strafeDir = 1;
    this.unstickMs = 0;
    this.unstickDir = 1;
    this.unstickStreak = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.stillFrames = 0;
    this.stats = { decisions: 0, shots: 0, repaths: 0, unsticks: 0 };
  }

  setEnabled(enabled, game) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.mode = AGENT_MODE.IDLE;
    this.path = [];
    this.goal = null;
    this.target = null;
    this.thinkAccumulatorMs = AGENT.THINK_INTERVAL_MS; // decide immediately
    this.logger.info(enabled ? CODES.AGENT_ENABLED : CODES.AGENT_DISABLED, 'autoplay toggled', {
      level: game?.level?.name,
    });
  }

  toggle(game) {
    this.setEnabled(!this.enabled, game);
    return this.enabled;
  }

  /**
   * Produce this frame's intent.
   * @param {number} dt seconds
   * @param {import('../game/game.js').Game} game
   * @returns {import('../input.js').Intent}
   */
  think(dt, game) {
    const intent = {
      forward: 0, strafe: 0, turn: 0, turnDelta: 0,
      fire: false, use: false, run: false, weaponSlot: 0, cycleWeapon: 0,
    };
    const player = game.player;
    if (!this.enabled || !player.alive) return intent;

    this.thinkAccumulatorMs += dt * 1000;
    this.strafeTimerMs += dt * 1000;
    if (this.strafeTimerMs >= AGENT.STRAFE_PERIOD_MS) {
      this.strafeTimerMs = 0;
      this.strafeDir *= -1;
    }

    this.#trackStuck(game, dt);

    if (this.thinkAccumulatorMs >= AGENT.THINK_INTERVAL_MS) {
      this.thinkAccumulatorMs = 0;
      this.#decide(game);
    }

    this.#act(intent, game, dt);
    return intent;
  }

  /* ------------------------------- sensing -------------------------------- */

  #visibleEnemies(game) {
    const { player, level } = game;
    const out = [];
    for (const enemy of game.enemies) {
      if (enemy.isDead()) continue;
      const dist = distance(player.x, player.y, enemy.x, enemy.y);
      if (dist > AGENT.ENGAGE_RANGE) continue;
      if (!level.grid.hasLineOfSight(player.x, player.y, enemy.x, enemy.y, AGENT.ENGAGE_RANGE)) continue;
      out.push({ enemy, dist, threat: enemy.threatScore(player.x, player.y) });
    }
    out.sort((a, b) => b.threat - a.threat);
    return out;
  }

  /** Cheapest reachable pickup of interest, scored by path length. */
  #bestPickup(game, filter, maxDetour) {
    const { player, level } = game;
    let best = null;
    for (const pickup of game.pickups) {
      if (pickup.taken || !filter(pickup)) continue;
      if (!pickup.isUsefulTo(player)) continue;
      const straight = distance(player.x, player.y, pickup.x, pickup.y);
      if (straight > maxDetour * 1.5) continue;
      const path = findPath(level.grid, player, pickup);
      if (path.length === 0 || path.length > maxDetour) continue;
      const cost = path.length;
      if (!best || cost < best.cost) best = { pickup, path, cost };
    }
    return best;
  }

  #exitGoal(game) {
    const exit = game.level.exitTiles[0];
    return { x: exit.x + 0.5, y: exit.y + 0.5 };
  }

  /* ------------------------------- deciding ------------------------------- */

  #decide(game) {
    this.stats.decisions += 1;
    const player = game.player;
    const threats = this.#visibleEnemies(game);
    this.target = threats.length > 0 ? threats[0].enemy : null;

    if (this.unstickMs > 0) {
      this.mode = AGENT_MODE.UNSTICK;
      this.goalLabel = 'breaking deadlock';
      return;
    }

    const lowHealth = player.health <= AGENT.LOW_HEALTH;
    const critical = player.health <= AGENT.CRITICAL_HEALTH;

    // 1. Survival: a medkit outranks everything when badly hurt.
    if (lowHealth) {
      const heal = this.#bestPickup(
        game,
        (p) => p.type === PICKUP.MEDKIT || p.type === PICKUP.ARMOR,
        critical ? HEAL_MAX_DETOUR : LOOT_MAX_DETOUR
      );
      if (heal) {
        this.mode = AGENT_MODE.HEAL;
        this.goal = { x: heal.pickup.x, y: heal.pickup.y };
        this.path = heal.path;
        this.goalLabel = `recovering (${heal.pickup.def.label})`;
        return;
      }
    }

    // 2. Fight what can see us, unless critical and something is worth fleeing to.
    if (this.target) {
      this.mode = AGENT_MODE.FIGHT;
      this.goal = { x: this.target.x, y: this.target.y };
      this.path = [];
      this.goalLabel = `engaging ${this.target.def.name}`;
      this.#selectWeapon(game, threats[0].dist);
      return;
    }

    // 3. Out of ammo for everything? Grab any ammo we can reach.
    const dryOnAmmo = this.#totalUsableAmmo(player) <= 4;
    const ammoPickup = this.#bestPickup(
      game,
      (p) => (dryOnAmmo ? true : p.def.weapon || p.def.ammo || p.def.health || p.def.armor),
      dryOnAmmo ? HEAL_MAX_DETOUR : LOOT_MAX_DETOUR
    );
    if (ammoPickup) {
      this.mode = AGENT_MODE.LOOT;
      this.goal = { x: ammoPickup.pickup.x, y: ammoPickup.pickup.y };
      this.path = ammoPickup.path;
      this.goalLabel = `collecting ${ammoPickup.pickup.def.label}`;
      return;
    }

    // 4. Otherwise push for the exit.
    const exit = this.#exitGoal(game);
    const path = findPath(game.level.grid, player, exit);
    if (path.length === 0) {
      this.logger.warn(CODES.AGENT_PATH_FAILED, 'no route to exit', { level: game.level.name });
      this.mode = AGENT_MODE.UNSTICK;
      this.unstickMs = 600;
      this.goalLabel = 'rerouting';
      return;
    }
    this.mode = AGENT_MODE.ADVANCE;
    this.goal = exit;
    this.path = path;
    this.stats.repaths += 1;
    this.goalLabel = 'advancing to exit';
    this.#selectWeapon(game, 8);
  }

  #totalUsableAmmo(player) {
    let total = 0;
    for (const id of player.owned) total += player.ammo[WEAPON_AMMO[id]] ?? 0;
    return total;
  }

  /** Pick the best weapon we can actually feed for this distance. */
  #selectWeapon(game, dist) {
    const player = game.player;
    const usable = (id) => player.owned.has(id) && (player.ammo[WEAPON_AMMO[id]] ?? 0) >= WEAPONS[id].ammoPerShot;

    let choice = WEAPON_ID.PISTOL;
    if (dist <= 4.5 && usable(WEAPON_ID.SHOTGUN)) choice = WEAPON_ID.SHOTGUN;
    else if (usable(WEAPON_ID.CHAINGUN)) choice = WEAPON_ID.CHAINGUN;
    else if (usable(WEAPON_ID.SHOTGUN)) choice = WEAPON_ID.SHOTGUN;
    else if (usable(WEAPON_ID.PISTOL)) choice = WEAPON_ID.PISTOL;

    if (choice !== player.weaponId) player.selectWeapon(choice);
  }

  /* -------------------------------- acting -------------------------------- */

  #act(intent, game, dt) {
    switch (this.mode) {
      case AGENT_MODE.FIGHT:
        this.#actFight(intent, game, dt);
        break;
      case AGENT_MODE.UNSTICK:
        this.#actUnstick(intent, game, dt);
        break;
      case AGENT_MODE.HEAL:
      case AGENT_MODE.LOOT:
      case AGENT_MODE.ADVANCE:
        this.#actTravel(intent, game, dt);
        break;
      default:
        break;
    }
    this.#dodgeProjectiles(intent, game);
    this.#openDoorAhead(intent, game);
  }

  #actFight(intent, game, dt) {
    const player = game.player;
    const target = this.target;
    if (!target || target.isDead()) {
      this.mode = AGENT_MODE.IDLE;
      this.thinkAccumulatorMs = AGENT.THINK_INTERVAL_MS;
      return;
    }

    const dist = distance(player.x, player.y, target.x, target.y);
    // Lead the shot slightly: aim where a strafing target is heading.
    const desired = Math.atan2(target.y - player.y, target.x - player.x);
    const delta = angleDelta(player.angle, desired);
    intent.turnDelta = clamp(delta, -AGENT.TURN_SPEED * dt, AGENT.TURN_SPEED * dt);

    const aimed = Math.abs(delta) <= AGENT.FIRE_TOLERANCE;
    const weapon = WEAPONS[player.weaponId];
    const wantRange = weapon.id === WEAPON_ID.SHOTGUN ? 2.6 : 5.5;

    if (dist > wantRange + 1.2) intent.forward = 1;
    else if (dist < wantRange - 1.2) intent.forward = -1;
    intent.strafe = this.strafeDir * 0.85;
    intent.run = dist > 7;

    if (aimed && dist <= weapon.range) {
      intent.fire = true;
      this.stats.shots += 1;
    }
  }

  #actTravel(intent, game, dt) {
    const player = game.player;
    if (this.goal && this.path.length === 0) {
      // Goal is close or the plan ran out - walk straight at it.
      const delta = angleDelta(player.angle, Math.atan2(this.goal.y - player.y, this.goal.x - player.x));
      intent.turnDelta = clamp(delta, -AGENT.TURN_SPEED * dt, AGENT.TURN_SPEED * dt);
      intent.forward = Math.abs(delta) < 1.1 ? 1 : 0.25;
      intent.run = true;
      return;
    }
    if (this.path.length === 0) return;

    // Consume waypoints we have already reached.
    while (this.path.length > 0) {
      const node = this.path[0];
      if (distance(player.x, player.y, node.x + 0.5, node.y + 0.5) <= AGENT.WAYPOINT_EPSILON) this.path.shift();
      else break;
    }
    if (this.path.length === 0) {
      this.thinkAccumulatorMs = AGENT.THINK_INTERVAL_MS;
      return;
    }

    const node = this.path[0];
    const targetX = node.x + 0.5;
    const targetY = node.y + 0.5;
    const desired = Math.atan2(targetY - player.y, targetX - player.x);
    const delta = angleDelta(player.angle, desired);
    intent.turnDelta = clamp(delta, -AGENT.TURN_SPEED * dt, AGENT.TURN_SPEED * dt);

    // Walk while roughly facing the waypoint; ease off during sharp corners.
    const facing = Math.abs(delta);
    intent.forward = facing < 0.5 ? 1 : facing < 1.2 ? 0.6 : 0.15;
    intent.run = facing < 0.35;

    // Re-plan if the goal itself has drifted (a moving pickup target, say).
    if (this.goal && distance(this.goal.x, this.goal.y, targetX, targetY) > REPATH_ON_GOAL_MOVE * 6) {
      this.thinkAccumulatorMs = AGENT.THINK_INTERVAL_MS;
    }
  }

  #actUnstick(intent, game, dt) {
    this.unstickMs -= dt * 1000;
    // Escalate: a plain back-and-strafe first, then a hard turn and push if the
    // same spot keeps holding us (a doorway we are standing in, say).
    if (this.unstickStreak >= 3) {
      intent.turnDelta = this.unstickDir * AGENT.TURN_SPEED * dt * 2.2;
      intent.forward = 1;
      intent.run = true;
    } else {
      intent.forward = -0.6;
      intent.strafe = this.unstickDir;
      intent.turnDelta = this.unstickDir * AGENT.TURN_SPEED * dt * 0.8;
    }
    intent.use = true;
    if (this.unstickMs <= 0) {
      this.mode = AGENT_MODE.IDLE;
      this.path = [];
      this.thinkAccumulatorMs = AGENT.THINK_INTERVAL_MS;
    }
  }

  /** Sidestep anything flying at us. */
  #dodgeProjectiles(intent, game) {
    const player = game.player;
    for (const projectile of game.projectiles) {
      const dist = distance(player.x, player.y, projectile.x, projectile.y);
      if (dist > DODGE_RADIUS) continue;
      // Is it actually heading our way?
      const toPlayer = Math.atan2(player.y - projectile.y, player.x - projectile.x);
      const heading = Math.atan2(projectile.dy, projectile.dx);
      if (Math.abs(angleDelta(heading, toPlayer)) > 0.45) continue;

      // Strafe perpendicular to the incoming line.
      const side = angleDelta(player.angle, heading) > 0 ? -1 : 1;
      intent.strafe = side;
      intent.run = true;
      return;
    }
  }

  /** Open doors we are about to walk into. */
  #openDoorAhead(intent, game) {
    const player = game.player;
    const grid = game.level.grid;
    for (const reach of [0.6, 1.0, 1.4]) {
      const x = Math.floor(player.x + Math.cos(player.angle) * reach);
      const y = Math.floor(player.y + Math.sin(player.angle) * reach);
      if (grid.at(x, y) === TILE.DOOR) {
        const door = grid.doorAt(x, y);
        if (door && door.openness < 0.9) intent.use = true;
        return;
      }
    }
  }

  /** Detect "pressing into a wall" and schedule a shake-out. */
  #trackStuck(game, dt) {
    const player = game.player;
    const moved = distance(player.x, player.y, this.lastX, this.lastY);
    this.lastX = player.x;
    this.lastY = player.y;

    const wantsToMove = this.mode !== AGENT_MODE.IDLE && this.mode !== AGENT_MODE.FIGHT;
    if (wantsToMove && moved < AGENT.STUCK_EPSILON * (dt * 60)) this.stillFrames += 1;
    else this.stillFrames = Math.max(0, this.stillFrames - 2);

    if (moved > AGENT.STUCK_EPSILON * 4) this.unstickStreak = 0;

    if (this.stillFrames >= AGENT.STUCK_FRAMES && this.unstickMs <= 0) {
      this.stillFrames = 0;
      this.unstickMs = 420;
      this.unstickDir *= -1;
      this.unstickStreak += 1;
      this.stats.unsticks += 1;
      this.path = [];
      this.mode = AGENT_MODE.UNSTICK;
      this.logger.debug(CODES.AGENT_UNSTUCK, 'agent shaking out of a stall', { mode: this.mode });
    }
  }

  /** Human-readable plan for the HUD. */
  describe() {
    return { mode: this.mode, goal: this.goalLabel, waypoints: this.path.length, ...this.stats };
  }
}
