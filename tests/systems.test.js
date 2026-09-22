import test from 'node:test';
import assert from 'node:assert/strict';

import { Settings } from '../src/core/settings.js';
import { ParticleSystem } from '../src/game/particles.js';
import { Projectile, applySplash } from '../src/game/combat.js';
import { Enemy, ENEMY_STATE } from '../src/game/enemies.js';
import { Player } from '../src/game/player.js';
import { Grid } from '../src/world/grid.js';
import { Rng } from '../src/core/rng.js';
import {
  TILE, ENEMY_ID, WEAPON_ID, DIFFICULTY, PLAYER, SENSITIVITY_RANGE, SETTINGS_DEFAULTS,
} from '../src/core/constants.js';
import { createGame, stubTextures } from './helpers/harness.js';

const W = TILE.WALL_BRICK;
const _ = TILE.EMPTY;

const corridor = () => new Grid([
  Array(12).fill(W),
  [W, _, _, _, _, _, _, _, _, _, _, W],
  Array(12).fill(W),
]);

/** In-memory Storage stand-in so settings tests never touch a real browser. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
  };
}

/* -------------------------------- settings -------------------------------- */

test('settings fall back to defaults and persist changes', () => {
  const storage = memoryStorage();
  const settings = new Settings({ storage });
  assert.equal(settings.get('sensitivity'), SETTINGS_DEFAULTS.sensitivity);

  settings.set('sensitivity', 0.25);
  const reloaded = new Settings({ storage });
  assert.equal(reloaded.get('sensitivity'), 0.25, 'value survives a reload');
});

test('settings ignore unknown keys and corrupt storage', () => {
  const settings = new Settings({ storage: memoryStorage({ 'descent-protocol.settings.v1': '{not json' }) });
  assert.equal(settings.get('difficulty'), SETTINGS_DEFAULTS.difficulty, 'corrupt blob falls back');
  assert.equal(settings.set('nonsense', 1), false, 'unknown keys are rejected');
  assert.equal(settings.get('nonsense'), undefined);
});

test('settings reject values of the wrong type from storage', () => {
  const storage = memoryStorage({
    'descent-protocol.settings.v1': JSON.stringify({ sensitivity: 'fast', invertY: true }),
  });
  const settings = new Settings({ storage });
  assert.equal(settings.get('sensitivity'), SETTINGS_DEFAULTS.sensitivity, 'bad type discarded');
  assert.equal(settings.get('invertY'), true, 'good value kept');
});

test('the sensitivity slider maps onto a sane radians-per-pixel range', () => {
  const settings = new Settings({ storage: memoryStorage() });

  settings.set('sensitivity', 0);
  const slowest = settings.mouseSensitivity();
  settings.set('sensitivity', 1);
  const fastest = settings.mouseSensitivity();

  assert.ok(slowest < fastest, 'slider increases sensitivity');
  assert.equal(slowest, PLAYER.MOUSE_SENSITIVITY * SENSITIVITY_RANGE.min);
  assert.equal(fastest, PLAYER.MOUSE_SENSITIVITY * SENSITIVITY_RANGE.max);

  // A 400px flick at the default setting should be a reasonable turn, not a spin.
  settings.set('sensitivity', SETTINGS_DEFAULTS.sensitivity);
  const turn = settings.mouseSensitivity() * 400;
  assert.ok(turn > 0.2 && turn < Math.PI, `400px flick turned ${turn.toFixed(2)}rad`);
});

test('settings notify subscribers', () => {
  const settings = new Settings({ storage: memoryStorage() });
  const seen = [];
  const off = settings.subscribe((key, value) => seen.push([key, value]));
  settings.set('musicVolume', 0.1);
  off();
  settings.set('musicVolume', 0.9);
  assert.deepEqual(seen, [['musicVolume', 0.1]], 'unsubscribed listener stops firing');
});

/* -------------------------------- particles ------------------------------- */

test('particles expire and never exceed their pool', () => {
  const particles = new ParticleSystem(16);
  const rng = new Rng(3);
  for (let i = 0; i < 10; i += 1) {
    particles.burst({ x: 2, y: 2, count: 8, rng });
  }
  assert.ok(particles.activeCount <= 16, 'pool is a hard cap');

  for (let i = 0; i < 200; i += 1) particles.update(1 / 60, corridor());
  assert.equal(particles.activeCount, 0, 'everything eventually dies');
});

test('particles settle on the floor instead of falling through it', () => {
  const particles = new ParticleSystem(8);
  particles.burst({ x: 2.5, y: 1.5, z: 1, count: 4, rng: new Rng(1) });
  for (let i = 0; i < 120; i += 1) particles.update(1 / 60, corridor());
  for (const item of particles.items) {
    if (item.active) assert.ok(item.z >= 0.03, 'particle stays above the floor');
  }
});

test('particles produce renderer-ready sprites', () => {
  const particles = new ParticleSystem(8);
  particles.burst({ x: 3, y: 1.5, count: 4, sprite: 'blood', rng: new Rng(2) });
  const out = particles.collect(stubTextures(), []);
  assert.equal(out.length, 4);
  for (const sprite of out) {
    assert.ok(sprite.texture);
    assert.ok(sprite.alpha > 0 && sprite.alpha <= 1);
  }
});

/* ------------------------------ bolts + splash ----------------------------- */

test('player bolts damage enemies and detonate with falloff', () => {
  const rng = new Rng(5);
  const near = new Enemy(ENEMY_ID.GRUNT, 5.0, 1.5, rng);
  const far = new Enemy(ENEMY_ID.GRUNT, 6.0, 1.5, rng);

  const { victims } = applySplash({
    enemies: [near, far], x: 5.0, y: 1.5, radius: 1.2, damage: 20,
  });
  assert.equal(victims.length, 2, 'both are inside the blast');
  assert.ok(near.maxHealth - near.health > far.maxHealth - far.health,
    'closer target takes more damage');
});

test('splash respects its exclusion and radius', () => {
  const rng = new Rng(6);
  const hit = new Enemy(ENEMY_ID.GRUNT, 3, 1.5, rng);
  const distant = new Enemy(ENEMY_ID.GRUNT, 9, 1.5, rng);
  const { victims } = applySplash({
    enemies: [hit, distant], x: 3, y: 1.5, radius: 1.2, damage: 20, exclude: hit,
  });
  assert.equal(victims.length, 0, 'excluded target and out-of-range target both skipped');
  assert.equal(distant.health, distant.maxHealth);
});

test('a player bolt stops on the first enemy it reaches', () => {
  const grid = corridor();
  const player = new Player({ x: 1.5, y: 1.5 });
  const target = new Enemy(ENEMY_ID.GRUNT, 6.5, 1.5, new Rng(7));

  const bolt = new Projectile({
    x: 2, y: 1.5, angle: 0, speed: 14, damage: 26, sprite: 'bolt', owner: 'player',
  });
  let outcome = 'none';
  for (let i = 0; i < 200 && outcome === 'none'; i += 1) {
    outcome = bolt.update(1 / 60, grid, player, [target]);
  }
  assert.equal(outcome, 'enemy');
  assert.equal(bolt.hitEnemy, target);
});

test('an enemy bolt can clip another enemy standing in the way', () => {
  const grid = corridor();
  const player = new Player({ x: 10.5, y: 1.5 });
  const shooter = new Enemy(ENEMY_ID.GRUNT, 2.5, 1.5, new Rng(8));
  const blocker = new Enemy(ENEMY_ID.BRUTE, 6, 1.5, new Rng(9));

  const bolt = new Projectile({
    x: 3, y: 1.5, angle: 0, speed: 8, damage: 12, sprite: 'bile',
    owner: 'enemy', source: shooter,
  });
  let outcome = 'none';
  for (let i = 0; i < 300 && outcome === 'none'; i += 1) {
    outcome = bolt.update(1 / 60, grid, player, [shooter, blocker]);
  }
  assert.equal(outcome, 'enemy', 'crossfire hits the enemy in the line of fire');
  assert.equal(bolt.hitEnemy, blocker);
});

/* ------------------------------ enemy behaviour ---------------------------- */

test('enemies telegraph an attack before it lands', () => {
  const game = createGame();
  game.start();
  const enemy = game.enemies[0];
  // Park the player right in front of it with clear sight.
  game.player.x = enemy.x + 1.5;
  game.player.y = enemy.y;
  enemy.attackCooldownMs = 0;
  enemy.alert(game.player.x, game.player.y);

  let sawWindup = false;
  for (let i = 0; i < 60; i += 1) {
    enemy.update(1 / 60, game);
    if (enemy.windupMs > 0) sawWindup = true;
  }
  assert.ok(sawWindup, 'attack passes through a wind-up state');
  assert.ok(enemy.def.windupMs > 0);
});

test('taking damage interrupts a wind-up', () => {
  const enemy = new Enemy(ENEMY_ID.BRUTE, 4, 4, new Rng(11));
  enemy.windupMs = 300;
  enemy.takeDamage(5);
  assert.equal(enemy.windupMs, 0);
});

test('enemies animate through a death sequence before resting', () => {
  const game = createGame();
  game.start();
  const enemy = game.enemies[0];
  enemy.takeDamage(9999);
  assert.equal(enemy.state, ENEMY_STATE.DYING);
  assert.equal(enemy.deathStage, 0);

  const stages = new Set();
  for (let i = 0; i < 120; i += 1) {
    enemy.update(1 / 60, game);
    stages.add(enemy.deathStage);
  }
  assert.equal(enemy.state, ENEMY_STATE.DEAD);
  assert.ok(stages.size > 1, `death animated through stages: ${[...stages].join(',')}`);
});

test('difficulty scales enemy health but never the player', () => {
  const rng = new Rng(12);
  const easy = new Enemy(ENEMY_ID.GRUNT, 2, 2, rng, DIFFICULTY.EASY);
  const hard = new Enemy(ENEMY_ID.GRUNT, 2, 2, rng, DIFFICULTY.HARD);
  assert.ok(hard.maxHealth > easy.maxHealth);

  const player = new Player({ x: 1.5, y: 1.5 });
  assert.equal(player.health, PLAYER.MAX_HEALTH, 'player starts the same on every difficulty');
});

test('difficulty changes how hard incoming damage hits', () => {
  const easy = createGame();
  easy.setDifficulty(DIFFICULTY.EASY);
  easy.start();
  const hard = createGame();
  hard.setDifficulty(DIFFICULTY.HARD);
  hard.start();

  const enemyEasy = easy.enemies[0];
  const enemyHard = hard.enemies[0];
  easy.enemyAttack(enemyEasy, 0, 0.5);   // melee-range resolution applies damage now
  hard.enemyAttack(enemyHard, 0, 0.5);

  if (!enemyEasy.def.ranged && !enemyHard.def.ranged) {
    assert.ok(hard.player.damageTaken > easy.player.damageTaken, 'hard hurts more');
  } else {
    assert.ok(easy.projectiles.length + hard.projectiles.length > 0, 'ranged attacks spawn bolts');
  }
});

/* --------------------------------- player ---------------------------------- */

test('movement accelerates and comes to rest', () => {
  const grid = corridor();
  const player = new Player({ x: 1.5, y: 1.5, angle: 0 });

  player.move(grid, 1, 0, 3.2, 1 / 60);
  const firstStep = player.speed;
  player.move(grid, 1, 0, 3.2, 1 / 60);
  assert.ok(player.speed > firstStep, 'speed ramps up rather than snapping');

  for (let i = 0; i < 120; i += 1) player.move(grid, 0, 0, 3.2, 1 / 60);
  assert.equal(player.speed, 0, 'friction brings the player to a stop');
});

test('footsteps fire on a cadence while moving', () => {
  const grid = corridor();
  const player = new Player({ x: 1.5, y: 1.5, angle: 0 });
  let steps = 0;
  for (let i = 0; i < 180; i += 1) {
    player.move(grid, 1, 0, 3.2, 1 / 60);
    if (player.consumeFootstep()) steps += 1;
  }
  assert.ok(steps >= 2, `expected footsteps while walking, got ${steps}`);
  assert.equal(player.consumeFootstep(), false, 'the flag is consumed, not sticky');
});

test('vertical look is clamped to a sane range', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  for (let i = 0; i < 100; i += 1) player.look(0.5);
  assert.equal(player.pitch, 1, 'cannot look past straight up');
  for (let i = 0; i < 400; i += 1) player.look(-0.5);
  assert.equal(player.pitch, -1, 'cannot look past straight down');
});

test('portrait stage tracks how hurt the player is', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  assert.equal(player.portraitStage(), 0);
  player.health = 50;
  assert.equal(player.portraitStage(), 2);
  player.health = 5;
  assert.equal(player.portraitStage(), 4);
  player.alive = false;
  assert.equal(player.portraitStage(), 4);
});

test('the arc lance is a bolt weapon that spends cells', () => {
  const game = createGame();
  game.start();
  game.player.giveWeapon(WEAPON_ID.LANCE);
  game.player.weaponId = WEAPON_ID.LANCE;
  game.player.pendingWeaponId = null;
  game.player.switchLowered = 0;
  game.player.ammo.cells = 10;

  assert.equal(game.tryFire(), true);
  assert.equal(game.player.ammo.cells, 9, 'cells are the lance ammo pool');
  assert.equal(game.projectiles.length, 1, 'firing spawns a travelling bolt');
  assert.equal(game.projectiles[0].owner, 'player');
  assert.ok(game.projectiles[0].splashRadius > 0);
});
