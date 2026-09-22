import { TILE, ENEMY_ID, PICKUP } from '../core/constants.js';
import { Grid } from './grid.js';
import { Door } from './doors.js';

/** ASCII legend -> tile id. Anything not listed here is a spawn marker on floor. */
const TILE_LEGEND = Object.freeze({
  '#': TILE.WALL_BRICK,
  '%': TILE.WALL_PANEL,
  '=': TILE.WALL_TECH,
  '&': TILE.WALL_FLESH,
  D: TILE.DOOR,
  X: TILE.EXIT,
  '.': TILE.EMPTY,
});

/** ASCII legend -> spawn descriptor (all sit on an empty floor tile). */
const SPAWN_LEGEND = Object.freeze({
  '@': { kind: 'player' },
  g: { kind: 'enemy', type: ENEMY_ID.GRUNT },
  h: { kind: 'enemy', type: ENEMY_ID.HOUND },
  b: { kind: 'enemy', type: ENEMY_ID.BRUTE },
  '+': { kind: 'pickup', type: PICKUP.MEDKIT },
  a: { kind: 'pickup', type: PICKUP.ARMOR },
  B: { kind: 'pickup', type: PICKUP.BULLETS },
  S: { kind: 'pickup', type: PICKUP.SHELLS },
  1: { kind: 'pickup', type: PICKUP.SHOTGUN },
  2: { kind: 'pickup', type: PICKUP.CHAINGUN },
});

export class LevelParseError extends Error {
  constructor(message, context) {
    super(message);
    this.name = 'LevelParseError';
    this.code = 'E_LEVEL_INVALID';
    this.context = context;
  }
}

/**
 * Parsed, ready-to-play level: grid + spawn lists + metadata.
 * Parsing is total: any malformed map throws LevelParseError with coordinates.
 */
export class Level {
  constructor({ name, subtitle, rows, skyTop, skyBottom, floorColor, par }) {
    this.name = name;
    this.subtitle = subtitle;
    this.skyTop = skyTop;
    this.skyBottom = skyBottom;
    this.floorColor = floorColor;
    this.par = par;

    const { tiles, playerStart, enemySpawns, pickupSpawns, exitTiles } = Level.#parse(rows, name);
    this.grid = new Grid(tiles);
    this.playerStart = playerStart;
    this.enemySpawns = enemySpawns;
    this.pickupSpawns = pickupSpawns;
    this.exitTiles = exitTiles;

    for (const { x, y } of this.grid.findTiles((t) => t === TILE.DOOR)) {
      this.grid.registerDoor(new Door(x, y));
    }
  }

  static #parse(rows, name) {
    if (!Array.isArray(rows) || rows.length < 3) {
      throw new LevelParseError('Level needs at least 3 rows', { level: name });
    }
    const width = rows[0].length;
    const tiles = [];
    let playerStart = null;
    const enemySpawns = [];
    const pickupSpawns = [];
    const exitTiles = [];

    rows.forEach((row, y) => {
      if (row.length !== width) {
        throw new LevelParseError('Ragged level row', { level: name, row: y, length: row.length, expected: width });
      }
      const tileRow = [];
      for (let x = 0; x < width; x += 1) {
        const ch = row[x];
        if (ch in TILE_LEGEND) {
          const tile = TILE_LEGEND[ch];
          tileRow.push(tile);
          if (tile === TILE.EXIT) exitTiles.push({ x, y });
          continue;
        }
        const spawn = SPAWN_LEGEND[ch];
        if (!spawn) {
          throw new LevelParseError('Unknown map symbol', { level: name, x, y, symbol: ch });
        }
        tileRow.push(TILE.EMPTY);
        const at = { x: x + 0.5, y: y + 0.5 };
        if (spawn.kind === 'player') {
          if (playerStart) throw new LevelParseError('Duplicate player start', { level: name, x, y });
          playerStart = at;
        } else if (spawn.kind === 'enemy') {
          enemySpawns.push({ type: spawn.type, ...at });
        } else {
          pickupSpawns.push({ type: spawn.type, ...at });
        }
      }
      tiles.push(tileRow);
    });

    if (!playerStart) throw new LevelParseError('Level has no player start (@)', { level: name });
    if (exitTiles.length === 0) throw new LevelParseError('Level has no exit (X)', { level: name });

    return { tiles, playerStart, enemySpawns, pickupSpawns, exitTiles };
  }
}
