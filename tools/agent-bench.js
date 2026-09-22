#!/usr/bin/env node
/**
 * Headless autoplay benchmark.
 *
 * Runs the agent through the full campaign across several seeds with no
 * renderer attached and prints win rate, clear times and combat stats. Useful
 * for checking that a tuning change actually made the agent better.
 *
 * Usage: node tools/agent-bench.js [runs]
 */
import { Game } from '../src/game/game.js';
import { AutoplayAgent } from '../src/agent/autoplay.js';
import { Logger } from '../src/core/logger.js';
import { LOG_LEVEL, GAME_STATE } from '../src/core/constants.js';

const RUNS = Number(process.argv[2] ?? 10);
const DT = 1 / 60;
const MAX_SECONDS_PER_LEVEL = 240;

const quietLogger = () => new Logger('bench', LOG_LEVEL.ERROR, {
  debug() {}, info() {}, warn() {}, error() {},
});

const stubTextures = () => ({
  walls: new Map(), enemies: new Map(), pickups: new Map(), projectiles: new Map(), wall: () => null,
});

function playOneCampaign(seed) {
  const game = new Game({ textures: stubTextures(), audio: null, logger: quietLogger(), seed });
  const agent = new AutoplayAgent({ logger: quietLogger() });
  game.agent = agent;
  agent.setEnabled(true, game);
  game.start();

  const started = Date.now();
  let frames = 0;
  const maxFrames = Math.ceil((MAX_SECONDS_PER_LEVEL / DT) * game.levels.length);

  while (frames < maxFrames) {
    if (game.state === GAME_STATE.LEVEL_CLEARED) {
      game.advanceLevel();
      continue;
    }
    if (game.state !== GAME_STATE.PLAYING) break;
    game.update(DT, agent.think(DT, game));
    game.autoOpenDoors();
    frames += 1;
  }

  return {
    seed,
    outcome: game.state,
    won: game.state === GAME_STATE.VICTORY,
    simSeconds: +(frames * DT).toFixed(1),
    realMs: Date.now() - started,
    score: game.score,
    kills: game.totalKills,
    accuracy: +(game.player.accuracy() * 100).toFixed(1),
    health: Math.round(game.player.health),
    unsticks: agent.stats.unsticks,
    decisions: agent.stats.decisions,
  };
}

const results = [];
for (let i = 0; i < RUNS; i += 1) results.push(playOneCampaign(1000 + i * 7919));

const wins = results.filter((r) => r.won);
const avg = (key, rows) => (rows.length ? +(rows.reduce((s, r) => s + r[key], 0) / rows.length).toFixed(1) : 0);

console.table(results);
console.log('\n=== AUTOPLAY SUMMARY ===');
console.log(`runs           : ${results.length}`);
console.log(`campaigns won  : ${wins.length} (${Math.round((wins.length / results.length) * 100)}%)`);
console.log(`avg sim time   : ${avg('simSeconds', wins)}s of in-game time per winning run`);
console.log(`avg real time  : ${avg('realMs', results)}ms of CPU per run`);
console.log(`avg score      : ${avg('score', wins)}`);
console.log(`avg kills      : ${avg('kills', results)}`);
console.log(`avg accuracy   : ${avg('accuracy', results)}%`);
console.log(`avg unsticks   : ${avg('unsticks', results)}`);

process.exitCode = wins.length === results.length ? 0 : 1;
