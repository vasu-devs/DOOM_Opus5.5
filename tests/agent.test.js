import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame, createAgentGame, runAgent, silentLogger } from './helpers/harness.js';
import { AutoplayAgent, AGENT_MODE } from '../src/agent/autoplay.js';
import { GAME_STATE, PICKUP, WEAPON_ID, WEAPON_AMMO } from '../src/core/constants.js';
import { distance } from '../src/core/math.js';

test('the agent starts idle and reports a plan once enabled', () => {
  const agent = new AutoplayAgent({ logger: silentLogger() });
  assert.equal(agent.enabled, false);
  const game = createGame();
  game.start();
  assert.deepEqual(agent.think(1 / 60, game).forward, 0, 'disabled agent does nothing');

  agent.setEnabled(true, game);
  agent.think(1 / 60, game);
  assert.notEqual(agent.mode, AGENT_MODE.IDLE);
  assert.ok(agent.describe().goal.length > 0);
});

test('the agent makes real progress toward the exit', () => {
  const session = createAgentGame({ seed: 4242 });
  const { game } = session;
  const exit = game.level.exitTiles[0];
  const startDistance = distance(game.player.x, game.player.y, exit.x, exit.y);

  runAgent(session, { maxSeconds: 45 });

  const endDistance = distance(game.player.x, game.player.y, exit.x, exit.y);
  const cleared = game.state === GAME_STATE.LEVEL_CLEARED;
  assert.ok(cleared || endDistance < startDistance - 3,
    `agent should close on the exit (from ${startDistance.toFixed(1)} to ${endDistance.toFixed(1)})`);
});

test('the agent clears the opening sector without dying', () => {
  const session = createAgentGame({ seed: 20260923 });
  const result = runAgent(session, { maxSeconds: 150 });

  assert.notEqual(result.state, GAME_STATE.DEAD, 'agent died on sector 1');
  assert.equal(result.state, GAME_STATE.LEVEL_CLEARED,
    `expected a clear, ended as ${result.state} after ${result.seconds.toFixed(1)}s`);
  assert.ok(session.game.player.kills > 0, 'agent should have killed something on the way');
});

test('the agent can clear the whole campaign back to back', () => {
  const session = createAgentGame({ seed: 777 });
  const { game, agent } = session;
  let guard = 0;

  while (game.state !== GAME_STATE.VICTORY && guard < 6) {
    guard += 1;
    const result = runAgent(session, { maxSeconds: 200 });
    if (result.state === GAME_STATE.LEVEL_CLEARED) game.advanceLevel();
    else break;
  }

  assert.equal(game.state, GAME_STATE.VICTORY,
    `campaign not finished: ended in ${game.state} on ${game.level.name}`);
  assert.ok(game.score > 0);
  assert.ok(agent.describe().decisions > 0);
});

test('the agent never walks through a wall', () => {
  const session = createAgentGame({ seed: 31337 });
  let violations = 0;
  runAgent(session, {
    maxSeconds: 40,
    onFrame: (game) => {
      if (game.level.grid.isBlocking(Math.floor(game.player.x), Math.floor(game.player.y))) violations += 1;
    },
  });
  assert.equal(violations, 0);
});

test('the agent prioritises healing when badly hurt', () => {
  const session = createAgentGame({ seed: 11 });
  const { game, agent } = session;
  // Put a medkit right next to the player and drop them to critical health.
  const medkit = game.pickups.find((p) => p.type === PICKUP.MEDKIT);
  assert.ok(medkit, 'level 1 should contain a medkit');
  game.player.x = medkit.x + 2.0;
  game.player.y = medkit.y;
  game.player.health = 20;
  for (const enemy of game.enemies) enemy.takeDamage(9999); // clear the floor so combat is not the answer

  let healed = false;
  runAgent(session, {
    maxSeconds: 20,
    onFrame: () => {
      if (agent.mode === AGENT_MODE.HEAL) healed = true;
    },
  });
  assert.ok(healed || game.player.health > 20, 'agent should have gone for the medkit');
});

test('the agent never settles on a weapon it cannot feed', () => {
  const session = createAgentGame({ seed: 99 });
  const { game } = session;
  game.player.giveWeapon(WEAPON_ID.CHAINGUN);
  game.player.ammo.bullets = 0;
  game.player.ammo.shells = 8;
  game.player.giveWeapon(WEAPON_ID.SHOTGUN);

  // It may legitimately swap to the chaingun again after looting bullets, so the
  // invariant is "hold something loaded whenever anything is loaded", checked
  // once switching has settled.
  let violations = 0;
  runAgent(session, {
    maxSeconds: 8,
    onFrame: (g) => {
      if (g.player.pendingWeaponId || g.player.switchLowered > 0) return;
      const anyLoaded = [...g.player.owned].some((id) => (g.player.ammo[WEAPON_AMMO[id]] ?? 0) > 0);
      if (anyLoaded && g.player.currentAmmo <= 0) violations += 1;
    },
  });
  assert.equal(violations, 0, 'agent held a dry weapon while a loaded one was available');
});

test('a stalled agent shakes itself loose', () => {
  const session = createAgentGame({ seed: 5 });
  const { game, agent } = session;
  // Wedge the player into a corner and watch the stuck detector fire.
  game.player.x = 1.2;
  game.player.y = 1.2;
  let unstuckSeen = false;
  runAgent(session, {
    maxSeconds: 8,
    onFrame: () => {
      if (agent.mode === AGENT_MODE.UNSTICK || agent.stats.unsticks > 0) unstuckSeen = true;
    },
  });
  assert.ok(unstuckSeen || distance(game.player.x, game.player.y, 1.2, 1.2) > 1,
    'agent should either trigger unstick or simply get moving');
});
