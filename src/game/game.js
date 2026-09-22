import {
  GAME_STATE, TILE, PLAYER, DOOR, ENEMIES, RENDER, WEAPON_ID,
  LIGHT, PARTICLES, DIFFICULTY,
} from '../core/constants.js';
import { clamp, distance } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { CODES } from '../core/logger.js';
import { createCampaign } from '../world/levels.js';
import { Player } from './player.js';
import { Enemy, ENEMY_STATE } from './enemies.js';
import { Pickup } from './pickups.js';
import { fireHitscan, Projectile, applySplash } from './combat.js';
import { ParticleSystem } from './particles.js';

const MESSAGE_TTL_MS = 2600;
const MAX_MESSAGES = 4;
const EXIT_REACH = 0.9;
const HEARING_RADIUS = 11;

/**
 * Game orchestrator: owns world state and advances the simulation.
 *
 * Deliberately free of DOM and rendering concerns - `main.js` wires it to a
 * Renderer, a HUD and an input source, and the autoplay agent drives it through
 * exactly the same intent object a human produces.
 */
export class Game {
  /**
   * @param {{textures: import('../render/textures.js').TextureBank, audio?: object,
   *          logger: import('../core/logger.js').Logger, seed?: number,
   *          difficulty?: object}} deps
   */
  constructor({ textures, audio = null, logger, seed = 20260923, difficulty = DIFFICULTY.NORMAL }) {
    this.textures = textures;
    this.audio = audio;
    this.logger = logger;
    this.rng = new Rng(seed);
    this.difficulty = difficulty;

    this.levels = createCampaign();
    this.levelIndex = 0;
    this.state = GAME_STATE.MENU;
    this.agent = null;

    this.particles = new ParticleSystem(PARTICLES.MAX);
    this.messages = [];
    this.score = 0;
    this.totalKills = 0;
    this.elapsedMs = 0;
    this.painFlash = 0;
    this.pickupFlash = 0;
    this.lightBoost = 0;
    this.shakeMs = 0;
    this.shakeMagnitude = 0;
    this.hurtDirection = 0;
    this.activeLights = [];
    this.spriteScratch = [];

    this.loadLevel(0);
  }

  /* ------------------------------ lifecycle ------------------------------- */

  setDifficulty(difficulty) {
    this.difficulty = difficulty ?? DIFFICULTY.NORMAL;
  }

  loadLevel(index) {
    const level = this.levels[index];
    if (!level) throw new RangeError(`No level at index ${index}`);

    this.levelIndex = index;
    this.level = level;
    this.levelStartMs = this.elapsedMs;

    const carried = this.player
      ? {
        health: this.player.health, armor: this.player.armor,
        ammo: { ...this.player.ammo }, owned: new Set(this.player.owned),
        weaponId: this.player.weaponId,
      }
      : null;

    this.player = new Player({ x: level.playerStart.x, y: level.playerStart.y, angle: 0 });
    if (carried) {
      this.player.health = Math.max(carried.health, 40);
      this.player.armor = carried.armor;
      this.player.ammo = carried.ammo;
      this.player.owned = carried.owned;
      this.player.weaponId = carried.owned.has(carried.weaponId) ? carried.weaponId : WEAPON_ID.PISTOL;
    }
    this.player.angle = this.#bestStartAngle(level);

    this.enemies = level.enemySpawns.map((s) => new Enemy(s.type, s.x, s.y, this.rng, this.difficulty));
    this.pickups = level.pickupSpawns.map((s) => new Pickup(s.type, s.x, s.y));
    this.torches = (level.torchSpawns ?? []).map((t, i) => ({
      x: t.x, y: t.y, phase: (i * 1.7) % (Math.PI * 2),
    }));
    this.projectiles = [];
    this.particles.clear();
    this.explored = new Uint8Array(level.grid.width * level.grid.height);
    this.levelKills = 0;
    this.messages = [];

    this.#revealAround(this.player.x, this.player.y, 6);
    this.pushMessage(`${level.name} - ${level.subtitle}`);
    this.logger.info(CODES.LEVEL_LOADED, 'level loaded', {
      level: level.name, index, enemies: this.enemies.length, pickups: this.pickups.length,
    });
  }

  /** Face whichever direction has the most open floor ahead. */
  #bestStartAngle(level) {
    let bestAngle = 0;
    let bestOpen = -1;
    for (let i = 0; i < 8; i += 1) {
      const angle = (i * Math.PI) / 4;
      let open = 0;
      for (let step = 1; step <= 6; step += 1) {
        const x = Math.floor(level.playerStart.x + Math.cos(angle) * step);
        const y = Math.floor(level.playerStart.y + Math.sin(angle) * step);
        if (level.grid.isBlocking(x, y)) break;
        open += 1;
      }
      if (open > bestOpen) {
        bestOpen = open;
        bestAngle = angle;
      }
    }
    return bestAngle;
  }

  start() {
    if (this.state !== GAME_STATE.MENU) this.restart();
    this.state = GAME_STATE.PLAYING;
  }

  restart() {
    this.score = 0;
    this.totalKills = 0;
    this.elapsedMs = 0;
    this.player = null;
    this.loadLevel(0);
    this.state = GAME_STATE.PLAYING;
  }

  togglePause() {
    if (this.state === GAME_STATE.PLAYING) this.state = GAME_STATE.PAUSED;
    else if (this.state === GAME_STATE.PAUSED) this.state = GAME_STATE.PLAYING;
  }

  advanceLevel() {
    const next = this.levelIndex + 1;
    if (next >= this.levels.length) {
      this.state = GAME_STATE.VICTORY;
      this.logger.info(CODES.LEVEL_CLEARED, 'campaign complete', { score: this.score });
      return;
    }
    this.loadLevel(next);
    this.state = GAME_STATE.PLAYING;
  }

  /* -------------------------------- update -------------------------------- */

  /**
   * Advance one frame.
   * @param {number} dt seconds (already clamped by the caller)
   * @param {import('../input.js').Intent} intent movement/fire wishes
   */
  update(dt, intent) {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.elapsedMs += dt * 1000;

    this.painFlash = Math.max(0, this.painFlash - dt * 3.2);
    this.pickupFlash = Math.max(0, this.pickupFlash - dt * 3.2);
    this.lightBoost = Math.max(0, this.lightBoost - dt * 6);
    this.shakeMs = Math.max(0, this.shakeMs - dt * 1000);

    this.#updateDoors(dt);
    this.#applyIntent(dt, intent);
    this.player.update(dt);

    if (this.player.consumeFootstep()) this.audio?.play('step');

    for (const enemy of this.enemies) enemy.update(dt, this);
    this.#updateProjectiles(dt);
    this.particles.update(dt, this.level.grid);
    this.#collectPickups();
    this.#updateLights(dt);
    this.#revealAround(this.player.x, this.player.y, 7);
    this.#expireMessages();

    if (!this.player.alive) {
      this.state = GAME_STATE.DEAD;
      this.logger.info(CODES.PLAYER_DIED, 'player died', {
        level: this.level.name, score: this.score, kills: this.totalKills,
      });
      return;
    }

    if (this.#onExit()) {
      this.state = GAME_STATE.LEVEL_CLEARED;
      const bonus = Math.max(0, Math.round((this.level.par * 1000 - (this.elapsedMs - this.levelStartMs)) / 100));
      this.score += bonus;
      this.logger.info(CODES.LEVEL_CLEARED, 'level cleared', {
        level: this.level.name, bonus, kills: this.levelKills,
      });
    }
  }

  /**
   * Doors never close on top of something. A door that shut over an occupant
   * would make that tile blocking with a body already inside it, which used to
   * wedge the player (and the agent) in place permanently.
   */
  #updateDoors(dt) {
    for (const door of this.level.grid.doors.values()) {
      if (this.#doorIsOccupied(door)) door.open();
      door.update(dt);
    }
  }

  #doorIsOccupied(door) {
    const inside = (x, y, radius) => x > door.x - radius && x < door.x + 1 + radius
      && y > door.y - radius && y < door.y + 1 + radius;

    if (this.player.alive && inside(this.player.x, this.player.y, PLAYER.RADIUS)) return true;
    return this.enemies.some((enemy) => !enemy.isDead() && inside(enemy.x, enemy.y, enemy.def.radius));
  }

  /** Torch flicker plus the muzzle flash, capped to the nearest few lights. */
  #updateLights(dt) {
    const lights = [];
    for (const torch of this.torches) {
      torch.phase += dt * LIGHT.FLICKER_SPEED;
      const dist = distance(torch.x, torch.y, this.player.x, this.player.y);
      if (dist > LIGHT.TORCH_RADIUS * 2.2) continue;
      const flicker = 1 - LIGHT.FLICKER_DEPTH * (0.5 + 0.5 * Math.sin(torch.phase * 1.7) * Math.sin(torch.phase * 0.63));
      lights.push({
        x: torch.x,
        y: torch.y,
        radius: LIGHT.TORCH_RADIUS,
        radiusSq: LIGHT.TORCH_RADIUS * LIGHT.TORCH_RADIUS,
        intensity: LIGHT.TORCH_INTENSITY * flicker,
        dist,
      });
    }
    lights.sort((a, b) => a.dist - b.dist);
    this.activeLights = lights.slice(0, LIGHT.MAX_ACTIVE);
  }

  #applyIntent(dt, intent) {
    const player = this.player;
    if (intent.turn) player.turn(intent.turn * dt * PLAYER.TURN_SPEED);
    if (intent.turnDelta) player.turn(intent.turnDelta);
    if (intent.lookDelta) player.look(intent.lookDelta);

    const speed = PLAYER.MOVE_SPEED * (intent.run ? PLAYER.RUN_MULTIPLIER : 1);
    player.move(this.level.grid, intent.forward, intent.strafe, speed, dt);

    if (intent.use) this.useInFront();
    if (intent.weaponSlot) player.selectSlot(intent.weaponSlot);
    if (intent.cycleWeapon) player.cycleWeapon(intent.cycleWeapon);
    if (intent.fire) this.tryFire();
  }

  #updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      const targets = projectile.owner === 'player' ? this.enemies : this.enemies;
      const result = projectile.update(dt, this.level.grid, this.player, targets);
      if (result === 'none') continue;

      if (result === 'player') {
        const applied = this.player.applyDamage(projectile.damage * this.difficulty.damageTaken);
        this.hurtDirection = Math.atan2(projectile.y - this.player.y, projectile.x - this.player.x);
        this.onPlayerHurt(applied);
      } else if (result === 'enemy' && projectile.hitEnemy) {
        // Enemy bolts clipping another enemy is crossfire; player bolts are just damage.
        const victim = projectile.hitEnemy;
        const killed = victim.takeDamage(projectile.damage);
        this.#bleed(victim, projectile.x, projectile.y);
        if (killed) this.#registerKill(victim, projectile.owner === 'player');
        else victim.alert(this.player.x, this.player.y);
      }

      if (projectile.splashRadius > 0 && result !== 'expired') {
        this.#detonate(projectile);
      } else if (result === 'wall') {
        this.particles.burst({
          x: projectile.x, y: projectile.y, z: 0.5,
          sprite: projectile.owner === 'player' ? 'plasma' : 'spark',
          count: 5, speed: 2.2, scale: 0.05, life: 0.35, rng: this.rng,
        });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  #detonate(projectile) {
    const { victims, kills } = applySplash({
      enemies: this.enemies,
      x: projectile.x,
      y: projectile.y,
      radius: projectile.splashRadius,
      damage: projectile.splashDamage,
      exclude: projectile.hitEnemy ?? null,
    });
    for (const victim of victims) this.#bleed(victim, victim.x, victim.y);
    for (const kill of kills) this.#registerKill(kill, projectile.owner === 'player');

    this.particles.burst({
      x: projectile.x, y: projectile.y, z: 0.5, sprite: 'plasma',
      count: 12, speed: 3.4, scale: 0.075, life: 0.45, rng: this.rng,
    });
    this.particles.burst({
      x: projectile.x, y: projectile.y, z: 0.55, sprite: 'smoke',
      count: 6, speed: 1.2, scale: 0.12, life: 0.7, gravity: -0.4, rng: this.rng,
    });
    this.lightBoost = Math.max(this.lightBoost, 0.5);
    this.audio?.playAt('explosion', projectile.x, projectile.y, this.player);
  }

  #bleed(enemy, x, y) {
    this.particles.burst({
      x, y, z: 0.55,
      sprite: enemy.def.bloodColor === '#3ad1b0' ? 'bloodCool' : 'blood',
      count: PARTICLES.BLOOD_PER_HIT, speed: 2.6, scale: 0.055, rng: this.rng,
    });
  }

  #registerKill(enemy, byPlayer) {
    this.levelKills += 1;
    this.totalKills += 1;
    if (byPlayer) this.player.kills += 1;
    this.score += ENEMIES[enemy.type].score;
    this.pushMessage(`${enemy.def.name} DOWN`, 'kill');
    this.audio?.playAt('death', enemy.x, enemy.y, this.player);
    this.particles.burst({
      x: enemy.x, y: enemy.y, z: 0.6,
      sprite: enemy.def.bloodColor === '#3ad1b0' ? 'bloodCool' : 'blood',
      count: 14, speed: 3.4, scale: 0.07, rng: this.rng,
    });
  }

  #collectPickups() {
    for (const pickup of this.pickups) {
      if (pickup.taken || !pickup.touches(this.player.x, this.player.y)) continue;
      const result = pickup.collect(this.player);
      if (!result.taken) continue;
      this.pickupFlash = 1;
      this.score += 50;
      this.audio?.play('pickup');
      for (const message of result.messages) this.pushMessage(message);
    }
  }

  /* -------------------------------- combat -------------------------------- */

  tryFire() {
    const player = this.player;
    if (!player.alive) return false;
    if (!player.canFire()) {
      if (player.currentAmmo <= 0 && player.cooldownMs <= 0) {
        this.pushMessage('NO AMMO', 'warn');
        player.cooldownMs = 280;
        this.audio?.play('dryfire');
      }
      return false;
    }

    const weapon = player.weapon;
    player.registerShot();
    this.lightBoost = 0.6;
    this.shake(weapon.shake ?? 0.5, 130);
    this.audio?.play(weapon.id);

    if (weapon.kind === 'bolt') {
      this.projectiles.push(new Projectile({
        x: player.x + Math.cos(player.angle) * 0.3,
        y: player.y + Math.sin(player.angle) * 0.3,
        angle: player.angle + (this.rng.next() - 0.5) * weapon.spread,
        speed: weapon.boltSpeed,
        damage: weapon.damage,
        sprite: 'bolt',
        owner: 'player',
        splashRadius: weapon.splashRadius,
        splashDamage: weapon.splashDamage,
        lifeSeconds: 3,
      }));
      this.#wakeNearby(weapon.noise);
      return true;
    }

    const { hits, kills, impacts } = fireHitscan({
      grid: this.level.grid,
      enemies: this.enemies,
      originX: player.x,
      originY: player.y,
      angle: player.angle,
      weapon,
      rng: this.rng,
    });

    for (const impact of impacts) {
      if (impact.onEnemy && impact.enemy) {
        this.#bleed(impact.enemy, impact.x, impact.y);
      } else {
        this.particles.burst({
          x: impact.x, y: impact.y, z: 0.55, sprite: 'spark',
          count: PARTICLES.SPARK_PER_HIT, speed: 2.1, scale: 0.04, life: 0.3, rng: this.rng,
        });
      }
    }

    if (hits > 0) {
      player.shotsHit += 1;
      this.audio?.play('impact');
    }
    for (const kill of kills) this.#registerKill(kill, true);

    this.#wakeNearby(weapon.noise);
    return true;
  }

  /** Gunfire wakes anything close enough to hear it. */
  #wakeNearby(noise) {
    const radius = clamp(noise, 6, HEARING_RADIUS);
    for (const enemy of this.enemies) {
      if (enemy.isDead()) continue;
      if (distance(enemy.x, enemy.y, this.player.x, this.player.y) <= radius) {
        if (enemy.alert(this.player.x, this.player.y)) this.onEnemyAlerted(enemy);
      }
    }
  }

  /** Called by Enemy when it commits to an attack (after the wind-up). */
  enemyAttack(enemy, angleToPlayer, dist) {
    this.audio?.playAt(enemy.def.ranged ? 'enemyShot' : 'bite', enemy.x, enemy.y, this.player);

    if (!enemy.def.ranged) {
      if (dist <= enemy.def.attackRange) {
        const applied = this.player.applyDamage(enemy.def.damage * this.difficulty.damageTaken);
        this.hurtDirection = angleToPlayer + Math.PI;
        this.onPlayerHurt(applied);
      }
      return;
    }

    const accuracy = clamp(enemy.def.accuracy * this.difficulty.enemyAccuracy, 0, 0.99);
    const jitter = (1 - accuracy) * (this.rng.next() - 0.5) * 0.6;
    this.projectiles.push(new Projectile({
      x: enemy.x + Math.cos(angleToPlayer) * (enemy.def.radius + 0.14),
      y: enemy.y + Math.sin(angleToPlayer) * (enemy.def.radius + 0.14),
      angle: angleToPlayer + jitter,
      speed: enemy.type === 'brute' ? 5.4 : enemy.type === 'wraith' ? 7.4 : 6.5,
      damage: enemy.def.damage,
      sprite: enemy.type === 'brute' ? 'ember' : enemy.type === 'wraith' ? 'coolant' : 'bile',
      owner: 'enemy',
      source: enemy,
    }));
  }

  /** Audio hooks fired by Enemy state changes. */
  onEnemyWindup(enemy) {
    this.audio?.playAt('windup', enemy.x, enemy.y, this.player);
  }

  onEnemyAlerted(enemy) {
    this.audio?.playAt('alert', enemy.x, enemy.y, this.player);
  }

  onPlayerHurt(amount) {
    if (amount <= 0) return;
    this.painFlash = 1;
    this.shake(1.2, 190);
    this.audio?.play('hurt');
    if (this.player.health <= 25) this.pushMessage('VITALS CRITICAL', 'warn');
  }

  shake(magnitude, durationMs) {
    this.shakeMagnitude = Math.max(this.shakeMagnitude * 0.5, magnitude);
    this.shakeMs = Math.max(this.shakeMs, durationMs);
  }

  /* ------------------------------- world use ------------------------------ */

  /** Open a door (or read the exit) directly ahead of the player. */
  useInFront() {
    const grid = this.level.grid;
    for (let step = 0.5; step <= DOOR.USE_RANGE; step += 0.35) {
      const x = Math.floor(this.player.x + Math.cos(this.player.angle) * step);
      const y = Math.floor(this.player.y + Math.sin(this.player.angle) * step);
      const door = grid.doorAt(x, y);
      if (door) {
        if (door.openness < 0.05) this.audio?.play('door');
        door.open();
        return true;
      }
      if (grid.at(x, y) === TILE.EXIT) {
        this.pushMessage('EXIT OPEN - STEP THROUGH', 'warn');
        return true;
      }
      if (grid.isBlocking(x, y)) return false;
    }
    return false;
  }

  /** Doors auto-open when the player walks into them; called from the loop. */
  autoOpenDoors() {
    const grid = this.level.grid;
    const reach = 0.8;
    const x = Math.floor(this.player.x + Math.cos(this.player.angle) * reach);
    const y = Math.floor(this.player.y + Math.sin(this.player.angle) * reach);
    const door = grid.doorAt(x, y);
    if (door && door.openness < 0.05) {
      door.open();
      this.audio?.play('door');
    }
  }

  #onExit() {
    return this.level.exitTiles.some(
      (tile) => distance(this.player.x, this.player.y, tile.x + 0.5, tile.y + 0.5) <= EXIT_REACH
    );
  }

  /* ------------------------------ presentation ---------------------------- */

  /** Sprites for this frame, in renderer-ready form. */
  collectSprites() {
    const sprites = this.spriteScratch;
    sprites.length = 0;

    for (const enemy of this.enemies) {
      const bank = this.textures.enemies.get(enemy.type);
      if (!bank) continue;
      const texture = enemy.spriteFor(bank);
      if (!texture) continue;
      const dying = enemy.state === ENEMY_STATE.DYING || enemy.state === ENEMY_STATE.DEAD;
      sprites.push({
        x: enemy.x,
        y: enemy.y,
        texture,
        scale: enemy.def.height * (dying ? 0.85 : 1),
        vOffset: dying ? 0.18 : (1 - enemy.def.height) * 0.5,
        tint: enemy.painMs > 0 ? { r: 255, g: 80, b: 60, a: 0.35 } : null,
        emissive: Boolean(enemy.def.emissive) && !dying,
      });
    }

    for (const torch of this.torches) {
      const frames = this.textures.flames;
      if (!frames || frames.length === 0) continue;
      const frame = Math.floor((this.elapsedMs / 90 + torch.phase * 3)) % frames.length;
      sprites.push({
        x: torch.x, y: torch.y, texture: frames[frame],
        scale: 0.5, vOffset: -0.12, emissive: true,
      });
    }

    for (const pickup of this.pickups) {
      if (pickup.taken) continue;
      const texture = this.textures.pickups.get(pickup.type);
      if (!texture) continue;
      const bob = Math.sin(this.elapsedMs / 380 + pickup.bobPhase) * 0.045;
      sprites.push({ x: pickup.x, y: pickup.y, texture, scale: 0.45, vOffset: 0.3 + bob });
    }

    for (const projectile of this.projectiles) {
      const texture = this.textures.projectiles.get(projectile.sprite);
      if (!texture) continue;
      sprites.push({
        x: projectile.x, y: projectile.y, texture,
        scale: projectile.owner === 'player' ? 0.26 : 0.3,
        vOffset: 0.08, emissive: true,
      });
    }

    this.particles.collect(this.textures, sprites);
    return sprites;
  }

  pushMessage(text, kind = 'info') {
    this.messages.push({ text, kind, expiresAt: this.elapsedMs + MESSAGE_TTL_MS });
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
  }

  #expireMessages() {
    this.messages = this.messages.filter((m) => m.expiresAt > this.elapsedMs);
  }

  #revealAround(x, y, radius) {
    const grid = this.level.grid;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(grid.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(grid.height - 1, Math.ceil(y + radius));
    for (let ty = minY; ty <= maxY; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        if (this.explored[ty * grid.width + tx]) continue;
        if (distance(x, y, tx + 0.5, ty + 0.5) > radius) continue;
        if (grid.hasLineOfSight(x, y, tx + 0.5, ty + 0.5, RENDER.MAX_DEPTH)) {
          this.explored[ty * grid.width + tx] = 1;
        }
      }
    }
  }

  isExplored(x, y) {
    const grid = this.level.grid;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
    return this.explored[y * grid.width + x] === 1;
  }

  /** Snapshot for the HUD and the end-of-level card. */
  stats() {
    const total = this.level.enemySpawns.length;
    return {
      level: this.level.name,
      levelIndex: this.levelIndex,
      levelCount: this.levels.length,
      subtitle: this.level.subtitle,
      score: this.score,
      kills: this.levelKills,
      totalEnemies: total,
      killsAll: this.totalKills,
      accuracy: this.player.accuracy(),
      timeMs: this.elapsedMs - this.levelStartMs,
      totalTimeMs: this.elapsedMs,
      secretsFound: this.pickups.filter((p) => p.taken).length,
      pickupCount: this.pickups.length,
      difficulty: this.difficulty.label,
    };
  }
}
