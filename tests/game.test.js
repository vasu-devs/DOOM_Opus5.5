import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame } from './helpers/harness.js';
import { GAME_STATE, TILE, WEAPON_ID } from '../src/core/constants.js';
import { IDLE_INTENT } from '../src/input.js';

const step = (game, frames = 1, intent = IDLE_INTENT, dt = 1 / 60) => {
  for (let i = 0; i < frames; i += 1) game.update(dt, intent);
};

test('a new game boots into the menu with a loaded first sector', () => {
  const game = createGame();
  assert.equal(game.state, GAME_STATE.MENU);
  assert.equal(game.levelIndex, 0);
  assert.ok(game.enemies.length > 0);
  assert.ok(game.pickups.length > 0);
  assert.equal(game.player.alive, true);
  assert.ok(!game.level.grid.isBlocking(Math.floor(game.player.x), Math.floor(game.player.y)),
    'player must not spawn inside a wall');
});

test('the simulation is frozen outside the playing state', () => {
  const game = createGame();
  const before = { x: game.player.x, y: game.player.y };
  step(game, 60, { ...IDLE_INTENT, forward: 1 });
  assert.deepEqual({ x: game.player.x, y: game.player.y }, before);

  game.start();
  step(game, 60, { ...IDLE_INTENT, forward: 1 });
  assert.notDeepEqual({ x: game.player.x, y: game.player.y }, before, 'moves once playing');
});

test('pausing and resuming toggles cleanly', () => {
  const game = createGame();
  game.start();
  game.togglePause();
  assert.equal(game.state, GAME_STATE.PAUSED);
  game.togglePause();
  assert.equal(game.state, GAME_STATE.PLAYING);
});

test('firing spends ammo, wakes nearby enemies and records the shot', () => {
  const game = createGame();
  game.start();
  const before = game.player.currentAmmo;
  assert.equal(game.tryFire(), true);
  assert.equal(game.player.currentAmmo, before - 1);
  assert.equal(game.player.shotsFired, 1);
  assert.equal(game.tryFire(), false, 'cooldown blocks the next shot');
});

test('an empty weapon warns instead of firing', () => {
  const game = createGame();
  game.start();
  game.player.ammo.bullets = 0;
  assert.equal(game.tryFire(), false);
  assert.ok(game.messages.some((m) => m.text === 'NO AMMO'));
});

test('reaching the exit clears the sector and advances the campaign', () => {
  const game = createGame();
  game.start();
  const exit = game.level.exitTiles[0];
  game.player.x = exit.x + 0.5;
  game.player.y = exit.y + 0.5;
  step(game, 1);
  assert.equal(game.state, GAME_STATE.LEVEL_CLEARED);

  const firstName = game.level.name;
  game.advanceLevel();
  assert.equal(game.state, GAME_STATE.PLAYING);
  assert.equal(game.levelIndex, 1);
  assert.notEqual(game.level.name, firstName);
});

test('the campaign ends in victory after the final sector', () => {
  const game = createGame();
  game.start();
  game.loadLevel(game.levels.length - 1);
  const exit = game.level.exitTiles[0];
  game.player.x = exit.x + 0.5;
  game.player.y = exit.y + 0.5;
  game.state = GAME_STATE.PLAYING;
  step(game, 1);
  assert.equal(game.state, GAME_STATE.LEVEL_CLEARED);
  game.advanceLevel();
  assert.equal(game.state, GAME_STATE.VICTORY);
});

test('inventory carries across sectors but health is floored, not refilled', () => {
  const game = createGame();
  game.start();
  game.player.giveWeapon(WEAPON_ID.SHOTGUN);
  game.player.ammo.shells = 12;
  game.player.health = 10;
  game.loadLevel(1);
  assert.ok(game.player.owned.has(WEAPON_ID.SHOTGUN), 'weapons carry over');
  assert.equal(game.player.ammo.shells, 12);
  assert.equal(game.player.health, 40, 'a minimum health floor is granted between sectors');
});

test('death ends the run and a restart resets score and level', () => {
  const game = createGame();
  game.start();
  game.score = 500;
  game.player.applyDamage(1000);
  step(game, 1);
  assert.equal(game.state, GAME_STATE.DEAD);

  game.restart();
  assert.equal(game.state, GAME_STATE.PLAYING);
  assert.equal(game.score, 0);
  assert.equal(game.levelIndex, 0);
  assert.equal(game.player.health, 100);
});

test('walking over a useful item consumes it and scores', () => {
  const game = createGame();
  game.start();
  const pickup = game.pickups.find((p) => p.def.ammo);
  game.player.ammo.bullets = 0;
  game.player.ammo.shells = 0;
  game.player.x = pickup.x;
  game.player.y = pickup.y;
  const scoreBefore = game.score;
  step(game, 1);
  assert.equal(pickup.taken, true);
  assert.ok(game.score > scoreBefore);
});

test('use opens a door in front of the player', () => {
  const game = createGame();
  game.start();
  const [door] = [...game.level.grid.doors.values()];
  // Stand one tile west of the door, facing east.
  game.player.x = door.x - 0.5;
  game.player.y = door.y + 0.5;
  game.player.angle = 0;
  assert.equal(game.useInFront(), true);
  assert.equal(door.targetOpen, true);
  for (let i = 0; i < 60; i += 1) door.update(1 / 60);
  assert.ok(door.openness > 0.5);
});

test('fog of war only reveals what the player can see', () => {
  const game = createGame();
  game.start();
  const grid = game.level.grid;
  let explored = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) if (game.isExplored(x, y)) explored += 1;
  }
  assert.ok(explored > 0, 'the starting room is revealed');
  assert.ok(explored < grid.width * grid.height, 'the whole map is not handed over');
});

test('sprite collection stays in sync with world state', () => {
  const game = createGame();
  game.start();
  const sprites = game.collectSprites();
  assert.ok(Array.isArray(sprites));
  assert.ok(sprites.length >= game.enemies.length, 'every live entity contributes a sprite');
  for (const sprite of sprites) {
    assert.equal(typeof sprite.x, 'number');
    assert.equal(typeof sprite.y, 'number');
    assert.ok(sprite.texture, 'each sprite carries a texture handle');
    assert.ok(Number.isFinite(sprite.scale));
  }

  // Torch flames are part of the scene now.
  assert.ok(game.torches.length > 0, 'level 1 has torches');
});

test('exit tiles are never blocking geometry', () => {
  const game = createGame();
  for (const level of game.levels) {
    for (const exit of level.exitTiles) {
      assert.equal(level.grid.at(exit.x, exit.y), TILE.EXIT);
      assert.equal(level.grid.isBlocking(exit.x, exit.y), false);
    }
  }
});

test('a door never closes on top of the player and never wedges them', () => {
  const game = createGame();
  game.start();
  const [door] = [...game.level.grid.doors.values()];

  // Stand inside the doorway and let far more than the auto-close time pass.
  game.player.x = door.x + 0.5;
  game.player.y = door.y + 0.5;
  door.open();
  step(game, 600); // 10 simulated seconds, well past DOOR.AUTO_CLOSE_MS

  assert.ok(door.openness > 0.7, 'door should stay open while occupied');
  assert.equal(game.level.grid.isBlocking(door.x, door.y), false);
});

test('an entity already inside blocking geometry can still walk out', () => {
  const game = createGame();
  game.start();
  const [door] = [...game.level.grid.doors.values()];
  game.player.x = door.x + 0.5;
  game.player.y = door.y + 0.5;

  // Force the worst case: a shut door with the player inside its tile.
  door.targetOpen = false;
  door.openness = 0;
  assert.equal(game.level.grid.isBlocking(door.x, door.y), true);

  const start = { x: game.player.x, y: game.player.y };
  const grid = game.level.grid;
  let moved = false;
  // Try every direction; at least one must let us escape the tile.
  for (let i = 0; i < 8 && !moved; i += 1) {
    const angle = (i * Math.PI) / 4;
    const next = grid.resolveMove(start.x, start.y, start.x + Math.cos(angle) * 0.4, start.y + Math.sin(angle) * 0.4, 0.22);
    if (next.x !== start.x || next.y !== start.y) moved = true;
  }
  assert.ok(moved, 'player must be able to escape a tile that closed on them');
});
