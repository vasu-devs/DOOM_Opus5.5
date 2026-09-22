import test from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../src/world/grid.js';
import { Enemy, ENEMY_STATE } from '../src/game/enemies.js';
import { Player } from '../src/game/player.js';
import { Pickup } from '../src/game/pickups.js';
import { raycastEnemies, fireHitscan, Projectile } from '../src/game/combat.js';
import { castRay } from '../src/render/raycaster.js';
import { Rng } from '../src/core/rng.js';
import {
  TILE, WEAPONS, WEAPON_ID, ENEMY_ID, PICKUP, AMMO_MAX, PLAYER,
} from '../src/core/constants.js';

const W = TILE.WALL_BRICK;
const _ = TILE.EMPTY;

/** 10x3 corridor with a wall plug we can toggle at x=5. */
const corridor = (plugged = false) => new Grid([
  Array(10).fill(W),
  [W, _, _, _, _, plugged ? W : _, _, _, _, W],
  Array(10).fill(W),
]);

test('raycaster reports distance, face and texture coordinate', () => {
  const grid = corridor();
  const hit = castRay(grid, 1.5, 1.5, 1, 0, 32);
  assert.equal(hit.hit, true);
  assert.equal(hit.mapX, 9);
  assert.ok(Math.abs(hit.distance - 7.5) < 1e-6);
  assert.equal(hit.side, 0);
  assert.ok(hit.textureX >= 0 && hit.textureX < 1);
});

test('raycaster terminates when it leaves the map', () => {
  const open = new Grid([[_, _], [_, _]]);
  const miss = castRay(open, 0.5, 0.5, 0, -1, 8);
  assert.equal(miss.hit, false);
});

test('hitscan hits a clear target and is stopped by walls', () => {
  const rng = new Rng(1);
  const clear = corridor(false);
  const blocked = corridor(true);
  const makeEnemy = () => new Enemy(ENEMY_ID.GRUNT, 7.5, 1.5, new Rng(2));

  const seen = raycastEnemies(clear, [makeEnemy()], 1.5, 1.5, 0, 20);
  assert.ok(seen, 'enemy in the open is hit');
  assert.ok(Math.abs(seen.distance - 5.7) < 0.5);

  assert.equal(raycastEnemies(blocked, [makeEnemy()], 1.5, 1.5, 0, 20), null, 'wall stops the shot');
  assert.equal(raycastEnemies(clear, [makeEnemy()], 1.5, 1.5, Math.PI, 20), null, 'nothing behind us');
  assert.equal(raycastEnemies(clear, [makeEnemy()], 1.5, 1.5, 0, 3), null, 'out of range');
});

test('a dead enemy is no longer a valid target', () => {
  const grid = corridor();
  const enemy = new Enemy(ENEMY_ID.GRUNT, 4.5, 1.5, new Rng(3));
  enemy.takeDamage(999);
  assert.equal(enemy.state, ENEMY_STATE.DYING);
  assert.equal(raycastEnemies(grid, [enemy], 1.5, 1.5, 0, 20), null);
});

test('shotgun spreads pellets and can kill in one blast up close', () => {
  const grid = corridor();
  const enemy = new Enemy(ENEMY_ID.GRUNT, 3.2, 1.5, new Rng(4));
  const result = fireHitscan({
    grid, enemies: [enemy], originX: 1.5, originY: 1.5, angle: 0,
    weapon: WEAPONS[WEAPON_ID.SHOTGUN], rng: new Rng(5),
  });
  assert.equal(result.impacts.length, WEAPONS[WEAPON_ID.SHOTGUN].pellets);
  assert.ok(result.hits >= 3, `expected most pellets to connect, got ${result.hits}`);
  assert.equal(result.kills.length, 1);
  assert.equal(enemy.isDead(), true);
});

test('projectiles stop at walls and damage the player', () => {
  const grid = corridor();
  const player = new Player({ x: 8.5, y: 1.5 });

  const toPlayer = new Projectile({ x: 2.5, y: 1.5, angle: 0, speed: 6, damage: 10, sprite: 'ember' });
  let outcome = 'none';
  for (let i = 0; i < 300 && outcome === 'none'; i += 1) outcome = toPlayer.update(1 / 60, grid, player);
  assert.equal(outcome, 'player');

  const intoWall = new Projectile({ x: 2.5, y: 1.5, angle: Math.PI, speed: 6, damage: 10, sprite: 'ember' });
  let wallOutcome = 'none';
  for (let i = 0; i < 300 && wallOutcome === 'none'; i += 1) wallOutcome = intoWall.update(1 / 60, grid, player);
  assert.equal(wallOutcome, 'wall');
});

test('fast projectiles cannot tunnel through a thin wall', () => {
  const grid = corridor(true);
  const player = new Player({ x: 8.5, y: 1.5 });
  const fast = new Projectile({ x: 2.5, y: 1.5, angle: 0, speed: 40, damage: 10, sprite: 'ember' });
  let outcome = 'none';
  for (let i = 0; i < 60 && outcome === 'none'; i += 1) outcome = fast.update(1 / 60, grid, player);
  assert.equal(outcome, 'wall');
});

test('armor absorbs part of incoming damage until it runs out', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  player.armor = 100;
  const applied = player.applyDamage(50);
  assert.ok(applied < 50, 'armor soaked some damage');
  assert.ok(player.armor < 100);
  assert.equal(player.health, PLAYER.MAX_HEALTH - applied);

  const bare = new Player({ x: 1.5, y: 1.5 });
  assert.equal(bare.applyDamage(30), 30);
  bare.applyDamage(500);
  assert.equal(bare.health, 0);
  assert.equal(bare.alive, false);
  assert.equal(bare.applyDamage(10), 0, 'the dead take no further damage');
});

test('ammo and vitals respect their caps', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  player.ammo.bullets = AMMO_MAX.bullets - 5;
  assert.equal(player.giveAmmo('bullets', 50), 5);
  assert.equal(player.ammo.bullets, AMMO_MAX.bullets);
  assert.equal(player.giveHealth(50), 0, 'already at full health');
  player.health = 40;
  assert.equal(player.giveHealth(25), 25);
});

test('weapon switching lowers, swaps, then raises', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  player.giveWeapon(WEAPON_ID.SHOTGUN);
  player.selectWeapon(WEAPON_ID.SHOTGUN);
  assert.equal(player.weaponId, WEAPON_ID.PISTOL, 'swap is not instant');
  for (let i = 0; i < 30; i += 1) player.update(1 / 60);
  assert.equal(player.weaponId, WEAPON_ID.SHOTGUN);
  assert.equal(player.selectWeapon(WEAPON_ID.CHAINGUN), false, 'cannot select what we do not own');
});

test('firing consumes ammo and respects the cooldown', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  const before = player.currentAmmo;
  assert.equal(player.canFire(), true);
  player.registerShot();
  assert.equal(player.currentAmmo, before - 1);
  assert.equal(player.canFire(), false, 'still cooling down');
  player.update(WEAPONS[WEAPON_ID.PISTOL].cooldownMs / 1000 + 0.01);
  assert.equal(player.canFire(), true);

  player.ammo.bullets = 0;
  assert.equal(player.canFire(), false, 'no ammo, no shot');
});

test('pickups only trigger when they actually help', () => {
  const player = new Player({ x: 1.5, y: 1.5 });
  const medkit = new Pickup(PICKUP.MEDKIT, 1.5, 1.5);
  assert.equal(medkit.isUsefulTo(player), false, 'full health ignores medkits');
  assert.equal(medkit.collect(player).taken, false);
  assert.equal(medkit.taken, false, 'item stays on the floor for later');

  player.health = 30;
  const result = medkit.collect(player);
  assert.equal(result.taken, true);
  assert.equal(player.health, 55);
  assert.ok(result.messages.length > 0);
  assert.equal(medkit.collect(player).taken, false, 'cannot be taken twice');

  const gun = new Pickup(PICKUP.SHOTGUN, 2, 2);
  assert.equal(gun.isUsefulTo(player), true);
  gun.collect(player);
  assert.ok(player.owned.has(WEAPON_ID.SHOTGUN));
  assert.ok(player.ammo.shells > 0);
});

test('enemies wake on damage and die when their health runs out', () => {
  const enemy = new Enemy(ENEMY_ID.HOUND, 3, 3, new Rng(9));
  assert.equal(enemy.state, ENEMY_STATE.DORMANT);
  assert.equal(enemy.takeDamage(5), false);
  assert.equal(enemy.state, ENEMY_STATE.HUNTING);
  assert.equal(enemy.takeDamage(999), true);
  assert.equal(enemy.isDead(), true);
  assert.equal(enemy.takeDamage(10), false, 'already dead');
});
