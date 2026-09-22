import { TILE } from '../core/constants.js';

const COLORS = Object.freeze({
  unseen: 'rgba(12,13,16,0.85)',
  floor: '#1d2026',
  wall: '#3c3129',
  panel: '#2e3742',
  tech: '#1d3540',
  flesh: '#3c1114',
  door: '#e0a340',
  exit: '#57d06a',
  player: '#f2ede2',
  enemy: '#d8402a',
  enemyDead: '#4a2b22',
  pickup: '#4aa3e0',
  path: 'rgba(87,208,106,0.55)',
  target: '#ffce5c',
  torch: '#e0a340',
});

/**
 * Top-down minimap with fog of war. Tiles are revealed as the player sees them;
 * the autoplay agent's current plan (path + target) is overlaid when active.
 */
export class Minimap {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('2D context unavailable on minimap canvas');
  }

  /** @param {import('../game/game.js').Game} game */
  render(game) {
    const { ctx, canvas } = this;
    const grid = game.level.grid;
    const cell = Math.max(
      2,
      Math.floor(Math.min(canvas.width / grid.width, canvas.height / grid.height))
    );
    const offsetX = Math.floor((canvas.width - cell * grid.width) / 2);
    const offsetY = Math.floor((canvas.height - cell * grid.height) / 2);

    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        if (!game.isExplored(x, y)) continue;
        const tile = grid.at(x, y);
        ctx.fillStyle = tileColor(tile);
        ctx.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
      }
    }

    // Agent plan overlay.
    if (game.agent?.enabled && game.agent.path.length > 0) {
      ctx.fillStyle = COLORS.path;
      for (const node of game.agent.path) {
        ctx.fillRect(offsetX + node.x * cell + cell * 0.3, offsetY + node.y * cell + cell * 0.3, cell * 0.4, cell * 0.4);
      }
      const goal = game.agent.goal;
      if (goal) {
        ctx.strokeStyle = COLORS.target;
        ctx.lineWidth = 1;
        ctx.strokeRect(offsetX + Math.floor(goal.x) * cell, offsetY + Math.floor(goal.y) * cell, cell, cell);
      }
    }

    for (const torch of game.torches ?? []) {
      if (!game.isExplored(Math.floor(torch.x), Math.floor(torch.y))) continue;
      ctx.fillStyle = COLORS.torch;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(offsetX + torch.x * cell - cell * 0.15, offsetY + torch.y * cell - cell * 0.15, cell * 0.3, cell * 0.3);
      ctx.globalAlpha = 1;
    }

    for (const pickup of game.pickups) {
      if (pickup.taken || !game.isExplored(Math.floor(pickup.x), Math.floor(pickup.y))) continue;
      ctx.fillStyle = COLORS.pickup;
      ctx.fillRect(offsetX + pickup.x * cell - cell * 0.2, offsetY + pickup.y * cell - cell * 0.2, cell * 0.45, cell * 0.45);
    }

    for (const enemy of game.enemies) {
      if (!game.isExplored(Math.floor(enemy.x), Math.floor(enemy.y))) continue;
      ctx.fillStyle = enemy.isDead() ? COLORS.enemyDead : COLORS.enemy;
      const size = enemy.isDead() ? cell * 0.35 : cell * 0.55;
      ctx.fillRect(offsetX + enemy.x * cell - size / 2, offsetY + enemy.y * cell - size / 2, size, size);
    }

    // Player arrow.
    const px = offsetX + game.player.x * cell;
    const py = offsetY + game.player.y * cell;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(game.player.angle);
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.moveTo(cell * 0.9, 0);
    ctx.lineTo(-cell * 0.5, cell * 0.5);
    ctx.lineTo(-cell * 0.2, 0);
    ctx.lineTo(-cell * 0.5, -cell * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function tileColor(tile) {
  switch (tile) {
    case TILE.WALL_BRICK: return COLORS.wall;
    case TILE.WALL_PANEL: return COLORS.panel;
    case TILE.WALL_TECH: return COLORS.tech;
    case TILE.WALL_FLESH: return COLORS.flesh;
    case TILE.DOOR: return COLORS.door;
    case TILE.EXIT: return COLORS.exit;
    default: return COLORS.floor;
  }
}
