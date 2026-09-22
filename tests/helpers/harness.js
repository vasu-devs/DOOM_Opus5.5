import { Game } from '../../src/game/game.js';
import { AutoplayAgent } from '../../src/agent/autoplay.js';
import { Logger, } from '../../src/core/logger.js';
import { LOG_LEVEL, GAME_STATE } from '../../src/core/constants.js';

/** Swallow log output during tests while keeping the Logger contract. */
export const silentLogger = () => new Logger('test', LOG_LEVEL.ERROR, {
  debug() {}, info() {}, warn() {}, error() {},
});

/** Texture bank stand-in: the simulation never touches pixels. */
export const stubTextures = () => ({
  walls: new Map(),
  enemies: new Map(),
  pickups: new Map(),
  projectiles: new Map(),
  wall: () => null,
});

export function createGame({ seed = 1234 } = {}) {
  return new Game({ textures: stubTextures(), audio: null, logger: silentLogger(), seed });
}

export function createAgentGame(options = {}) {
  const game = createGame(options);
  const agent = new AutoplayAgent({ logger: silentLogger() });
  game.agent = agent;
  agent.setEnabled(true, game);
  game.start();
  return { game, agent };
}

/**
 * Run the agent headlessly at a fixed timestep.
 * @returns {{seconds: number, state: string, frames: number}}
 */
export function runAgent({ game, agent }, { maxSeconds = 180, dt = 1 / 60, onFrame = null } = {}) {
  const maxFrames = Math.ceil(maxSeconds / dt);
  let frames = 0;
  while (frames < maxFrames) {
    if (game.state !== GAME_STATE.PLAYING) break;
    const intent = agent.think(dt, game);
    game.update(dt, intent);
    game.autoOpenDoors();
    frames += 1;
    onFrame?.(game, agent, frames);
  }
  return { seconds: frames * dt, state: game.state, frames };
}
