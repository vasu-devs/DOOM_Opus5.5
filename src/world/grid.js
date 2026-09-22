import { TILE, SOLID_TILES } from '../core/constants.js';

/**
 * Tile grid with collision + visibility queries.
 * Pure data + math: no DOM, no rendering, fully unit-testable.
 */
export class Grid {
  /** @param {number[][]} tiles row-major [y][x] */
  constructor(tiles) {
    if (!Array.isArray(tiles) || tiles.length === 0 || !Array.isArray(tiles[0])) {
      throw new TypeError('Grid requires a non-empty 2D array of tiles');
    }
    this.height = tiles.length;
    this.width = tiles[0].length;
    for (const row of tiles) {
      if (row.length !== this.width) throw new RangeError('Grid rows must all share one width');
    }
    this.tiles = tiles.map((row) => row.slice());
    /** @type {Map<string, import('./doors.js').Door>} */
    this.doors = new Map();
  }

  static key(x, y) {
    return `${x},${y}`;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** @returns {number} tile id, or a wall for out-of-bounds so rays always terminate */
  at(x, y) {
    if (!this.inBounds(x, y)) return TILE.WALL_BRICK;
    return this.tiles[y][x];
  }

  set(x, y, value) {
    if (!this.inBounds(x, y)) return;
    this.tiles[y][x] = value;
  }

  registerDoor(door) {
    this.doors.set(Grid.key(door.x, door.y), door);
  }

  doorAt(x, y) {
    return this.doors.get(Grid.key(x, y)) ?? null;
  }

  /** True if the tile blocks movement right now (open doors do not). */
  isBlocking(x, y) {
    const tile = this.at(x, y);
    if (tile === TILE.DOOR) {
      const door = this.doorAt(x, y);
      return !door || !door.isPassable();
    }
    return SOLID_TILES.has(tile);
  }

  /** True if the tile blocks sight right now. */
  isOpaque(x, y) {
    const tile = this.at(x, y);
    if (tile === TILE.DOOR) {
      const door = this.doorAt(x, y);
      return !door || !door.isTransparent();
    }
    return SOLID_TILES.has(tile);
  }

  isWalkable(x, y) {
    return this.inBounds(x, y) && !this.isBlocking(x, y);
  }

  /**
   * Circle-vs-tile collision resolution, axis-separated so sliding along
   * walls feels right. Returns the corrected position.
   */
  resolveMove(fromX, fromY, toX, toY, radius) {
    let x = fromX;
    let y = fromY;

    if (this.#circleHits(fromX, fromY, radius)) {
      // Escape hatch: we are already overlapping geometry - a door shut on top
      // of us, say. Normal resolution would reject every move and wedge the
      // entity forever. Allow a step into a free tile, and also allow shuffling
      // *within* the tile we are already inside, so an entity standing dead
      // centre can reach the edge and step out on the next tick.
      const originTileX = Math.floor(fromX);
      const originTileY = Math.floor(fromY);
      const escapable = (tx, ty) => !this.isBlocking(tx, ty) || (tx === originTileX && ty === originTileY);

      if (escapable(Math.floor(toX), originTileY)) x = toX;
      if (escapable(Math.floor(x), Math.floor(toY))) y = toY;
      return { x, y };
    }

    if (!this.#circleHits(toX, y, radius)) x = toX;
    if (!this.#circleHits(x, toY, radius)) y = toY;

    return { x, y };
  }

  #circleHits(cx, cy, radius) {
    const minX = Math.floor(cx - radius);
    const maxX = Math.floor(cx + radius);
    const minY = Math.floor(cy - radius);
    const maxY = Math.floor(cy + radius);
    for (let ty = minY; ty <= maxY; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        if (this.isBlocking(tx, ty)) return true;
      }
    }
    return false;
  }

  /**
   * Amanatides-Woo DDA line of sight between two world-space points.
   * @returns {boolean} true when nothing opaque sits between them.
   */
  hasLineOfSight(ax, ay, bx, by, maxDistance = Infinity) {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return true;
    if (dist > maxDistance) return false;

    const rayX = dx / dist;
    const rayY = dy / dist;
    let mapX = Math.floor(ax);
    let mapY = Math.floor(ay);

    const deltaX = rayX === 0 ? Infinity : Math.abs(1 / rayX);
    const deltaY = rayY === 0 ? Infinity : Math.abs(1 / rayY);

    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = rayX < 0 ? (ax - mapX) * deltaX : (mapX + 1 - ax) * deltaX;
    let sideY = rayY < 0 ? (ay - mapY) * deltaY : (mapY + 1 - ay) * deltaY;

    let travelled = 0;
    let guard = 0;
    const guardLimit = (this.width + this.height) * 4;

    while (travelled < dist && guard < guardLimit) {
      guard += 1;
      if (sideX < sideY) {
        travelled = sideX;
        sideX += deltaX;
        mapX += stepX;
      } else {
        travelled = sideY;
        sideY += deltaY;
        mapY += stepY;
      }
      if (travelled >= dist) break;
      if (!this.inBounds(mapX, mapY)) return false;
      if (this.isOpaque(mapX, mapY)) return false;
    }
    return true;
  }

  /** All tile coordinates matching a predicate. */
  findTiles(predicate) {
    const out = [];
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (predicate(this.tiles[y][x], x, y)) out.push({ x, y });
      }
    }
    return out;
  }
}
