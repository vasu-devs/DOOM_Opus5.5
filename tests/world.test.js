import test from 'node:test';
import assert from 'node:assert/strict';

import { Grid } from '../src/world/grid.js';
import { Door } from '../src/world/doors.js';
import { Level, LevelParseError } from '../src/world/level.js';
import { createCampaign } from '../src/world/levels.js';
import { findPath, reachableTiles, isNavigable } from '../src/world/pathfinding.js';
import { TILE } from '../src/core/constants.js';
import { normalizeAngle, angleDelta, clamp, fogFactor } from '../src/core/math.js';
import { Rng } from '../src/core/rng.js';

const W = TILE.WALL_BRICK;
const _ = TILE.EMPTY;

const room = () => new Grid([
  [W, W, W, W, W],
  [W, _, _, _, W],
  [W, _, W, _, W],
  [W, _, _, _, W],
  [W, W, W, W, W],
]);

test('math helpers stay in range', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(normalizeAngle(-Math.PI * 3) <= Math.PI);
  // Shortest turn across the wrap point is small, not nearly a full circle.
  assert.ok(Math.abs(angleDelta(3.1, -3.1)) < 0.2);
  assert.equal(fogFactor(1, 3, 15), 0);
  assert.equal(fogFactor(99, 3, 15), 1);
});

test('rng is deterministic for a given seed', () => {
  const a = new Rng(7);
  const b = new Rng(7);
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => new Rng(8).next()));
});

test('grid rejects ragged input and reports out-of-bounds as solid', () => {
  assert.throws(() => new Grid([[0, 0], [0]]), RangeError);
  assert.throws(() => new Grid([]), TypeError);
  const grid = room();
  assert.equal(grid.at(-1, 0), TILE.WALL_BRICK);
  assert.equal(grid.at(99, 99), TILE.WALL_BRICK);
  assert.equal(grid.isWalkable(1, 1), true);
  assert.equal(grid.isWalkable(2, 2), false);
});

test('movement slides along walls instead of stopping dead', () => {
  const grid = room();
  // Push diagonally into the north wall: x advances, y is clamped.
  const moved = grid.resolveMove(1.5, 1.5, 2.0, 0.9, 0.22);
  assert.ok(moved.x > 1.5, 'x should slide');
  assert.ok(moved.y > 1.0, 'y should be blocked by the wall');
});

test('line of sight is blocked by walls but not by open doors', () => {
  const grid = room();
  assert.equal(grid.hasLineOfSight(1.5, 1.5, 3.5, 1.5), true);
  assert.equal(grid.hasLineOfSight(1.5, 2.5, 3.5, 2.5), false, 'pillar blocks sight');

  const withDoor = new Grid([
    [W, W, W],
    [W, _, W],
    [W, TILE.DOOR, W],
    [W, _, W],
    [W, W, W],
  ]);
  const door = new Door(1, 2);
  withDoor.registerDoor(door);
  assert.equal(withDoor.hasLineOfSight(1.5, 1.5, 1.5, 3.5), false, 'shut door blocks');
  door.open();
  door.update(2);
  assert.equal(door.isPassable(), true);
  assert.equal(withDoor.hasLineOfSight(1.5, 1.5, 1.5, 3.5), true, 'open door lets sight through');
});

test('doors close again after their hold expires', () => {
  const door = new Door(0, 0);
  door.open();
  door.update(1);
  assert.ok(door.openness > 0.9);
  door.update(5);      // burns through AUTO_CLOSE_MS
  door.update(5);
  assert.equal(door.openness, 0);
  assert.equal(door.isPassable(), false);
});

test('level parser rejects malformed maps with coordinates', () => {
  const base = { name: 'T', subtitle: 's', skyTop: '#000', skyBottom: '#000', floorColor: '#000', par: 10 };
  assert.throws(() => new Level({ ...base, rows: ['###', '#@#', '###'] }), LevelParseError, 'no exit');
  assert.throws(() => new Level({ ...base, rows: ['###', '#X#', '###'] }), LevelParseError, 'no player');
  assert.throws(() => new Level({ ...base, rows: ['####', '#@X#', '##'] }), LevelParseError, 'ragged');
  assert.throws(() => new Level({ ...base, rows: ['####', '#@Z#', '####'] }), LevelParseError, 'bad symbol');
  assert.throws(() => new Level({ ...base, rows: ['#####', '#@@X#', '#####'] }), LevelParseError, 'two starts');
});

test('every shipped level is parseable, connected and winnable', () => {
  const campaign = createCampaign();
  assert.equal(campaign.length, 3);

  for (const level of campaign) {
    const reachable = reachableTiles(level.grid, level.playerStart);
    const key = (o) => `${Math.floor(o.x)},${Math.floor(o.y)}`;

    for (const exit of level.exitTiles) {
      assert.ok(reachable.has(`${exit.x},${exit.y}`), `${level.name}: exit unreachable`);
    }
    for (const spawn of level.enemySpawns) {
      assert.ok(reachable.has(key(spawn)), `${level.name}: enemy sealed in at ${key(spawn)}`);
    }
    for (const spawn of level.pickupSpawns) {
      assert.ok(reachable.has(key(spawn)), `${level.name}: pickup sealed in at ${key(spawn)}`);
    }

    const path = findPath(level.grid, level.playerStart, level.exitTiles[0]);
    assert.ok(path.length > 0, `${level.name}: no A* route to the exit`);
    assert.ok(level.enemySpawns.length >= 5, `${level.name}: too empty`);

    // The map must be sealed: no floor tile on the outer ring.
    for (let x = 0; x < level.grid.width; x += 1) {
      assert.ok(level.grid.isBlocking(x, 0) && level.grid.isBlocking(x, level.grid.height - 1));
    }
    for (let y = 0; y < level.grid.height; y += 1) {
      assert.ok(level.grid.isBlocking(0, y) && level.grid.isBlocking(level.grid.width - 1, y));
    }
  }
});

test('A* returns a contiguous path and refuses impossible goals', () => {
  const grid = room();
  const path = findPath(grid, { x: 1.5, y: 1.5 }, { x: 3.5, y: 3.5 });
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), { x: 3, y: 3 });

  let prev = { x: 1, y: 1 };
  for (const node of path) {
    assert.ok(Math.abs(node.x - prev.x) <= 1 && Math.abs(node.y - prev.y) <= 1, 'steps are adjacent');
    assert.ok(isNavigable(grid, node.x, node.y), 'path never enters a wall');
    prev = node;
  }

  assert.deepEqual(findPath(grid, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 }), [], 'goal inside a wall');
  assert.deepEqual(findPath(grid, { x: 1.5, y: 1.5 }, { x: 9.5, y: 9.5 }), [], 'goal off the map');
});

test('A* will not cut a wall corner diagonally', () => {
  const grid = new Grid([
    [W, W, W, W],
    [W, _, W, W],
    [W, W, _, W],
    [W, W, W, W],
  ]);
  assert.deepEqual(findPath(grid, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 }), []);
});
