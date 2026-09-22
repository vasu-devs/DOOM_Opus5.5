import { TILE } from '../core/constants.js';

/**
 * Grid navigation for agents.
 *
 * Doors are treated as traversable with an extra cost: an agent should route
 * through a shut door (it can open it) but prefer an open corridor.
 * Complexity: A* with a binary heap is O(E log V) over the tile graph, which is
 * bounded by ~4 * width * height edges - trivially fast for these map sizes.
 */

const DOOR_COST = 2.2;
const STRAIGHT_COST = 1;
const DIAGONAL_COST = Math.SQRT2;

const NEIGHBORS = Object.freeze([
  { dx: 1, dy: 0, cost: STRAIGHT_COST },
  { dx: -1, dy: 0, cost: STRAIGHT_COST },
  { dx: 0, dy: 1, cost: STRAIGHT_COST },
  { dx: 0, dy: -1, cost: STRAIGHT_COST },
  { dx: 1, dy: 1, cost: DIAGONAL_COST },
  { dx: 1, dy: -1, cost: DIAGONAL_COST },
  { dx: -1, dy: 1, cost: DIAGONAL_COST },
  { dx: -1, dy: -1, cost: DIAGONAL_COST },
]);

/** Minimal binary min-heap keyed by numeric priority. */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value, priority) {
    const node = { value, priority };
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= node.priority) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = node;
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        let smallestPriority = last.priority;
        if (left < n && this.items[left].priority < smallestPriority) {
          smallest = left;
          smallestPriority = this.items[left].priority;
        }
        if (right < n && this.items[right].priority < smallestPriority) {
          smallest = right;
          smallestPriority = this.items[right].priority;
        }
        if (smallest === i) break;
        this.items[i] = this.items[smallest];
        i = smallest;
      }
      this.items[i] = last;
    }
    return top ? top.value : undefined;
  }
}

/** A tile an agent may stand on (doors count - they can be opened). */
export function isNavigable(grid, x, y) {
  if (!grid.inBounds(x, y)) return false;
  const tile = grid.at(x, y);
  if (tile === TILE.DOOR) return true;
  return !grid.isBlocking(x, y);
}

function stepCost(grid, x, y, base) {
  return grid.at(x, y) === TILE.DOOR ? base + DOOR_COST : base;
}

/** Diagonal moves may not cut a wall corner. */
function diagonalAllowed(grid, x, y, dx, dy) {
  if (dx === 0 || dy === 0) return true;
  return isNavigable(grid, x + dx, y) && isNavigable(grid, x, y + dy);
}

const octile = (ax, ay, bx, by) => {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return (dx + dy) + (DIAGONAL_COST - 2) * Math.min(dx, dy);
};

/**
 * A* over tile centres.
 * @returns {{x:number,y:number}[]} tile path including the goal, or [] if unreachable.
 */
export function findPath(grid, start, goal, maxExpansions = 12000) {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);

  if (!isNavigable(grid, gx, gy) || !grid.inBounds(sx, sy)) return [];
  if (sx === gx && sy === gy) return [{ x: gx, y: gy }];

  const width = grid.width;
  const index = (x, y) => y * width + x;
  const gScore = new Map([[index(sx, sy), 0]]);
  const cameFrom = new Map();
  const closed = new Uint8Array(width * grid.height);
  const open = new MinHeap();
  open.push({ x: sx, y: sy }, octile(sx, sy, gx, gy));

  let expansions = 0;
  while (open.size > 0 && expansions < maxExpansions) {
    const current = open.pop();
    const ci = index(current.x, current.y);
    if (closed[ci]) continue;
    closed[ci] = 1;
    expansions += 1;

    if (current.x === gx && current.y === gy) {
      return reconstruct(cameFrom, ci, width);
    }

    for (const { dx, dy, cost } of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isNavigable(grid, nx, ny)) continue;
      if (!diagonalAllowed(grid, current.x, current.y, dx, dy)) continue;
      const ni = index(nx, ny);
      if (closed[ni]) continue;
      const tentative = (gScore.get(ci) ?? Infinity) + stepCost(grid, nx, ny, cost);
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, tentative);
        cameFrom.set(ni, ci);
        open.push({ x: nx, y: ny }, tentative + octile(nx, ny, gx, gy));
      }
    }
  }
  return [];
}

function reconstruct(cameFrom, goalIndex, width) {
  const path = [];
  let cursor = goalIndex;
  const guard = cameFrom.size + 2;
  let steps = 0;
  while (cursor !== undefined && steps <= guard) {
    path.push({ x: cursor % width, y: Math.floor(cursor / width) });
    cursor = cameFrom.get(cursor);
    steps += 1;
  }
  path.reverse();
  return path.slice(1); // drop the tile the agent already stands on
}

/** Every tile reachable from `start`. Used to validate level connectivity. */
export function reachableTiles(grid, start) {
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const seen = new Set();
  if (!isNavigable(grid, sx, sy)) return seen;
  const queue = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const { dx, dy } of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isNavigable(grid, nx, ny)) continue;
      if (!diagonalAllowed(grid, x, y, dx, dy)) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}
