import { RENDER, TILE, ENEMY_ID, PICKUP } from '../core/constants.js';
import { Rng } from '../core/rng.js';

/**
 * Every visual asset in the game is generated procedurally at boot - there are
 * no binary art files and no third-party artwork. Textures are baked once into
 * ImageData and sampled by the software renderer.
 */

const SIZE = RENDER.TEXTURE_SIZE;

function makeCanvas(width = SIZE, height = SIZE) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function ctx2d(canvas) {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('2D canvas context unavailable');
  return c;
}

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
};

function grain(c, rng, alpha = 0.16, cells = SIZE) {
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const v = rng.range(-1, 1) * alpha;
      c.fillStyle = v > 0 ? `rgba(255,236,214,${v})` : `rgba(0,0,0,${-v})`;
      c.fillRect(x, y, 1, 1);
    }
  }
}

/* ------------------------------ wall textures ----------------------------- */

function brickTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#2a1d1b';
  c.fillRect(0, 0, SIZE, SIZE);
  const brickH = 8;
  const brickW = 16;
  for (let row = 0; row < SIZE / brickH; row += 1) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < SIZE / brickW + 1; col += 1) {
      const x = col * brickW + offset;
      const y = row * brickH;
      c.fillStyle = shade('#5a3128', rng.int(-16, 16));
      c.fillRect(x + 1, y + 1, brickW - 2, brickH - 2);
      c.fillStyle = 'rgba(255,190,150,0.10)';
      c.fillRect(x + 1, y + 1, brickW - 2, 1);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(x + 1, y + brickH - 2, brickW - 2, 1);
    }
  }
  grain(c, rng, 0.10);
  return canvas;
}

function panelTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#232830';
  c.fillRect(0, 0, SIZE, SIZE);
  for (const [px, py] of [[2, 2], [34, 2], [2, 34], [34, 34]]) {
    c.fillStyle = '#2e3742';
    c.fillRect(px, py, 28, 28);
    c.fillStyle = 'rgba(190,215,240,0.12)';
    c.fillRect(px, py, 28, 2);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(px, py + 26, 28, 2);
    c.fillStyle = '#171b21';
    c.fillRect(px + 12, py + 12, 4, 4);
  }
  c.fillStyle = '#e0a340';
  c.fillRect(0, 30, SIZE, 2);
  c.fillStyle = 'rgba(224,163,64,0.25)';
  c.fillRect(0, 28, SIZE, 2);
  grain(c, rng, 0.12);
  return canvas;
}

function techTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#16202a';
  c.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 4) {
    c.fillStyle = y % 8 === 0 ? '#1d2a36' : '#192530';
    c.fillRect(0, y, SIZE, 3);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = rng.int(2, SIZE - 6);
    const y = rng.int(2, SIZE - 6);
    c.fillStyle = rng.chance(0.3) ? '#4fd6c4' : '#2b5f6b';
    c.fillRect(x, y, rng.int(2, 6), 2);
  }
  c.strokeStyle = 'rgba(79,214,196,0.35)';
  c.lineWidth = 1;
  c.strokeRect(8.5, 8.5, SIZE - 17, SIZE - 17);
  grain(c, rng, 0.10);
  return canvas;
}

function fleshTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#3c1114';
  c.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 90; i += 1) {
    c.fillStyle = `rgba(${rng.int(110, 170)},${rng.int(20, 45)},${rng.int(26, 50)},0.55)`;
    c.beginPath();
    c.arc(rng.range(0, SIZE), rng.range(0, SIZE), rng.range(2, 9), 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 8; i += 1) {
    c.strokeStyle = 'rgba(20,4,6,0.6)';
    c.lineWidth = rng.range(1, 2.4);
    c.beginPath();
    c.moveTo(rng.range(0, SIZE), 0);
    c.bezierCurveTo(rng.range(0, SIZE), SIZE / 3, rng.range(0, SIZE), (SIZE * 2) / 3, rng.range(0, SIZE), SIZE);
    c.stroke();
  }
  grain(c, rng, 0.14);
  return canvas;
}

function floorTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#26221d';
  c.fillRect(0, 0, SIZE, SIZE);
  // Riveted grating: quartered plates with a recessed seam.
  for (const [px, py] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    c.fillStyle = shade('#312c25', rng.int(-10, 10));
    c.fillRect(px + 1, py + 1, 30, 30);
    c.fillStyle = 'rgba(255,214,170,0.07)';
    c.fillRect(px + 1, py + 1, 30, 1);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(px + 1, py + 30, 30, 1);
    for (const [rx, ry] of [[4, 4], [26, 4], [4, 26], [26, 26]]) {
      c.fillStyle = '#4a4238';
      c.fillRect(px + rx, py + ry, 2, 2);
    }
  }
  grain(c, rng, 0.09);
  return canvas;
}

function doorTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  c.fillStyle = '#3a3026';
  c.fillRect(0, 0, SIZE, SIZE);
  c.fillStyle = '#4d4031';
  c.fillRect(4, 2, SIZE - 8, SIZE - 4);
  c.fillStyle = '#26201a';
  c.fillRect(SIZE / 2 - 1, 0, 2, SIZE);
  for (let y = 6; y < SIZE - 6; y += 10) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(6, y, SIZE - 12, 2);
  }
  c.fillStyle = '#e0a340';
  c.fillRect(8, SIZE / 2 - 3, 6, 6);
  c.fillRect(SIZE - 14, SIZE / 2 - 3, 6, 6);
  grain(c, rng, 0.10);
  return canvas;
}

function exitTexture(rng) {
  const canvas = makeCanvas();
  const c = ctx2d(canvas);
  const grad = c.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, '#14060a');
  grad.addColorStop(0.5, '#8a1410');
  grad.addColorStop(1, '#e0a340');
  c.fillStyle = grad;
  c.fillRect(0, 0, SIZE, SIZE);
  c.fillStyle = '#0d0508';
  c.fillRect(6, 4, SIZE - 12, SIZE - 8);
  c.fillStyle = '#ffce5c';
  c.font = 'bold 15px monospace';
  c.textAlign = 'center';
  c.fillText('EXIT', SIZE / 2, SIZE / 2 + 5);
  c.strokeStyle = '#ffce5c';
  c.lineWidth = 2;
  c.strokeRect(7, 5, SIZE - 14, SIZE - 10);
  grain(c, rng, 0.08);
  return canvas;
}

/* -------------------------------- sprites --------------------------------- */

/** Original creature designs, drawn with primitives. frame: 0 idle, 1/2 stride, 3 hurt. */
function enemyFrame(type, frame, rng) {
  const canvas = makeCanvas(SIZE, SIZE);
  const c = ctx2d(canvas);
  c.clearRect(0, 0, SIZE, SIZE);
  const sway = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  const isHurt = frame === 3;

  if (type === ENEMY_ID.GRUNT) {
    // Gaunt humanoid husk in scorched plating.
    c.fillStyle = isHurt ? '#8c3a2c' : '#44403a';
    c.fillRect(22 + sway, 22, 20, 26);
    c.fillStyle = isHurt ? '#a34133' : '#585148';
    c.fillRect(18 + sway, 24, 5, 20);
    c.fillRect(41 + sway, 24, 5, 20);
    c.fillStyle = '#2f2b27';
    c.fillRect(24 + sway, 47, 7, 14);
    c.fillRect(33 + sway, 47, 7, 14);
    c.fillStyle = isHurt ? '#c05a3a' : '#7d7266';
    c.fillRect(26 + sway, 10, 12, 13);
    c.fillStyle = '#ffb23c';
    c.fillRect(28 + sway, 15, 3, 3);
    c.fillRect(34 + sway, 15, 3, 3);
    c.fillStyle = '#1b1815';
    c.fillRect(29 + sway, 20, 6, 2);
    c.fillStyle = '#20242a';
    c.fillRect(44 + sway, 30, 10, 4);
  } else if (type === ENEMY_ID.HOUND) {
    // Low, quadrupedal ripper-hound.
    c.fillStyle = isHurt ? '#9c3524' : '#4a2b22';
    c.fillRect(16, 32 + sway, 30, 14);
    c.fillStyle = '#3a211a';
    c.fillRect(18, 45, 5, 12);
    c.fillRect(26, 45, 5, 12);
    c.fillRect(34, 45, 5, 12);
    c.fillRect(41, 45, 5, 12);
    c.fillStyle = isHurt ? '#b5412c' : '#57322a';
    c.fillRect(42, 27 + sway, 16, 14);
    c.fillStyle = '#ff5a3c';
    c.fillRect(48, 31 + sway, 3, 3);
    c.fillRect(54, 31 + sway, 3, 3);
    c.fillStyle = '#efe4cf';
    for (let i = 0; i < 4; i += 1) c.fillRect(44 + i * 4, 40 + sway, 2, 4);
    c.strokeStyle = '#3a211a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(16, 36 + sway);
    c.lineTo(6, 26 + sway * 2);
    c.stroke();
  } else {
    // Heavy cinder-brute with an exposed furnace core.
    c.fillStyle = isHurt ? '#a33a24' : '#3b2b2b';
    c.fillRect(16 + sway, 16, 32, 32);
    c.fillStyle = '#2a1f1f';
    c.fillRect(10 + sway, 18, 7, 26);
    c.fillRect(47 + sway, 18, 7, 26);
    c.fillStyle = 'rgba(255,196,80,0.55)';
    c.fillRect(24 + sway, 24, 16, 16);
    c.fillStyle = '#ff7a2a';
    c.fillRect(27 + sway, 27, 10, 10);
    c.fillStyle = '#31241f';
    c.fillRect(20 + sway, 47, 10, 14);
    c.fillRect(34 + sway, 47, 10, 14);
    c.fillStyle = isHurt ? '#bb4630' : '#4a3630';
    c.fillRect(24 + sway, 4, 16, 13);
    c.fillStyle = '#ffd24a';
    c.fillRect(27 + sway, 9, 4, 3);
    c.fillRect(34 + sway, 9, 4, 3);
    c.fillStyle = '#efe4cf';
    c.fillRect(21 + sway, 2, 3, 7);
    c.fillRect(40 + sway, 2, 3, 7);
  }

  if (rng.chance(0.5)) grain(c, rng, 0.05, 24);
  return canvas;
}

function corpseFrame(type) {
  const canvas = makeCanvas(SIZE, SIZE);
  const c = ctx2d(canvas);
  c.fillStyle = type === ENEMY_ID.BRUTE ? '#3b2b2b' : '#413b34';
  c.fillRect(12, 50, 40, 10);
  c.fillStyle = '#6e0f0f';
  c.beginPath();
  c.ellipse(32, 58, 22, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#8a1a1a';
  c.fillRect(20, 46, 24, 6);
  return canvas;
}

function pickupSprite(type) {
  const canvas = makeCanvas(SIZE, SIZE);
  const c = ctx2d(canvas);
  c.clearRect(0, 0, SIZE, SIZE);
  switch (type) {
    case PICKUP.MEDKIT:
      c.fillStyle = '#e8e2d4';
      c.fillRect(18, 26, 28, 22);
      c.strokeStyle = '#2b2b2b';
      c.lineWidth = 2;
      c.strokeRect(18, 26, 28, 22);
      c.fillStyle = '#c0392b';
      c.fillRect(29, 30, 6, 14);
      c.fillRect(22, 34, 20, 6);
      break;
    case PICKUP.ARMOR:
      c.fillStyle = '#2f6f9e';
      c.beginPath();
      c.moveTo(32, 22);
      c.lineTo(48, 30);
      c.lineTo(44, 50);
      c.lineTo(32, 56);
      c.lineTo(20, 50);
      c.lineTo(16, 30);
      c.closePath();
      c.fill();
      c.strokeStyle = '#8fd0ff';
      c.lineWidth = 2;
      c.stroke();
      break;
    case PICKUP.BULLETS:
      c.fillStyle = '#4a4238';
      c.fillRect(20, 32, 24, 16);
      c.fillStyle = '#e0a340';
      for (let i = 0; i < 4; i += 1) c.fillRect(22 + i * 6, 26, 4, 8);
      break;
    case PICKUP.SHELLS:
      for (let i = 0; i < 3; i += 1) {
        c.fillStyle = '#d8552f';
        c.fillRect(20 + i * 9, 30, 7, 18);
        c.fillStyle = '#e0c060';
        c.fillRect(20 + i * 9, 44, 7, 5);
      }
      break;
    case PICKUP.SHOTGUN:
      c.fillStyle = '#5a4632';
      c.fillRect(16, 38, 16, 8);
      c.fillStyle = '#2a2e33';
      c.fillRect(30, 34, 22, 7);
      c.fillStyle = '#3f464d';
      c.fillRect(30, 41, 18, 4);
      break;
    case PICKUP.CHAINGUN:
      c.fillStyle = '#2a2e33';
      c.fillRect(14, 32, 20, 12);
      for (let i = 0; i < 3; i += 1) {
        c.fillStyle = '#585f66';
        c.fillRect(34, 30 + i * 6, 20, 4);
      }
      break;
    default:
      c.fillStyle = '#d8cfc0';
      c.fillRect(18, 26, 28, 22);
  }
  return canvas;
}

function projectileSprite(color) {
  const canvas = makeCanvas(32, 32);
  const c = ctx2d(canvas);
  const grad = c.createRadialGradient(16, 16, 1, 16, 16, 14);
  grad.addColorStop(0, '#fff6d8');
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = grad;
  c.beginPath();
  c.arc(16, 16, 14, 0, Math.PI * 2);
  c.fill();
  return canvas;
}

/* --------------------------------- bank ----------------------------------- */

/** Immutable pixel buffer sampled by the software renderer. */
export class Texture {
  constructor(canvas) {
    const c = ctx2d(canvas);
    this.width = canvas.width;
    this.height = canvas.height;
    this.data = c.getImageData(0, 0, canvas.width, canvas.height).data;
    this.canvas = canvas;
  }
}

/** Builds and owns every texture. Constructed once at boot. */
export class TextureBank {
  constructor(seed = 0xd00d1e) {
    const rng = new Rng(seed);
    this.walls = new Map([
      [TILE.WALL_BRICK, new Texture(brickTexture(rng))],
      [TILE.WALL_PANEL, new Texture(panelTexture(rng))],
      [TILE.WALL_TECH, new Texture(techTexture(rng))],
      [TILE.WALL_FLESH, new Texture(fleshTexture(rng))],
      [TILE.DOOR, new Texture(doorTexture(rng))],
      [TILE.EXIT, new Texture(exitTexture(rng))],
    ]);
    /** Shared grating sampled by the floor-casting pass, tinted per level. */
    this.floor = new Texture(floorTexture(rng));

    /** enemy id -> { frames: [idle, strideA, strideB, hurt], corpse } */
    this.enemies = new Map();
    for (const id of Object.values(ENEMY_ID)) {
      this.enemies.set(id, {
        frames: [0, 1, 2, 3].map((f) => new Texture(enemyFrame(id, f, rng))),
        corpse: new Texture(corpseFrame(id)),
      });
    }

    this.pickups = new Map(
      Object.values(PICKUP).map((id) => [id, new Texture(pickupSprite(id))])
    );

    this.projectiles = new Map([
      ['ember', new Texture(projectileSprite('#ff8a2a'))],
      ['bile', new Texture(projectileSprite('#7cff5c'))],
    ]);
  }

  wall(tile) {
    return this.walls.get(tile) ?? this.walls.get(TILE.WALL_BRICK);
  }
}
