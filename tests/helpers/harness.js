import { Game } from '../../src/game/game.js';
import { AutoplayAgent } from '../../src/agent/autoplay.js';
import { Logger, } from '../../src/core/logger.js';
import { LOG_LEVEL, GAME_STATE, ENEMY_ID, PICKUP } from '../../src/core/constants.js';

/** Swallow log output during tests while keeping the Logger contract. */
export const silentLogger = () => new Logger('test', LOG_LEVEL.ERROR, {
  debug() {}, info() {}, warn() {}, error() {},
});

/**
 * Texture bank stand-in: the simulation never touches pixels, but it does ask
 * for sprite handles, so the shape has to match the real bank.
 */
const stubTexture = (name) => ({ width: 1, height: 1, data: new Uint8ClampedArray(4), name });

export const stubTextures = () => ({
  walls: new Map(),
  floor: stubTexture('floor'),
  ceiling: stubTexture('ceiling'),
  flames: [stubTexture('flame')],
  enemies: new Map(Object.values(ENEMY_ID).map((id) => [id, {
    walk: [0, 1, 2, 3].map((i) => stubTexture(`${id}-walk-${i}`)),
    attack: [stubTexture(`${id}-windup`), stubTexture(`${id}-fire`)],
    pain: stubTexture(`${id}-pain`),
    death: [0, 1, 2, 3].map((i) => stubTexture(`${id}-death-${i}`)),
  }])),
  pickups: new Map(Object.values(PICKUP).map((id) => [id, stubTexture(id)])),
  projectiles: new Map([
    ['ember', stubTexture('ember')], ['bile', stubTexture('bile')],
    ['coolant', stubTexture('coolant')], ['bolt', stubTexture('bolt')],
  ]),
  particles: new Map([
    ['blood', stubTexture('blood')], ['bloodCool', stubTexture('bloodCool')],
    ['spark', stubTexture('spark')], ['smoke', stubTexture('smoke')],
    ['plasma', stubTexture('plasma')],
  ]),
  portraits: { stages: [0, 1, 2, 3, 4].map((i) => stubTexture(`face-${i}`)), dead: stubTexture('face-dead') },
  wall: () => stubTexture('wall'),
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
