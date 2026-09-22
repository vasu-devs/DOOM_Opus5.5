import { RENDER, TILE, ENEMY_ID, PICKUP } from '../core/constants.js';
import { Rng } from '../core/rng.js';

/**
 * Every visual asset in the game is generated procedurally at boot - there are
 * no binary art files and no third-party artwork. Textures are baked once into
 * ImageData and sampled by the software renderer.
 *
 * All drawing is authored against a 64-unit design grid and scaled to the real
 * texture size by `u()`, so raising RENDER.TEXTURE_SIZE sharpens everything
 * without reworking a single coordinate.
 */

const SIZE = RENDER.TEXTURE_SIZE;
const SPRITE = RENDER.SPRITE_SIZE;

/** Design-grid unit (64) -> texture pixels. */
const u = (v, size = SIZE) => (v * size) / 64;

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

/** Draw on a 64-unit grid regardless of the real pixel size. */
function designCanvas(size = SIZE) {
  const canvas = makeCanvas(size, size);
  const c = ctx2d(canvas);
  c.save();
  c.scale(size / 64, size / 64);
  return { canvas, c };
}

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
};

/** Fine per-pixel noise, applied in texture space (not design space). */
function grain(canvas, rng, alpha = 0.14) {
  const c = ctx2d(canvas);
  const size = canvas.width;
  const image = c.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const v = (rng.next() * 2 - 1) * alpha * 255;
    data[i] = Math.max(0, Math.min(255, data[i] + v));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + v));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + v));
  }
  c.putImageData(image, 0, 0);
}

/** Vertical grime streaks - cheap, and does a lot for the industrial read. */
function streaks(c, rng, count, color = 'rgba(0,0,0,0.22)') {
  for (let i = 0; i < count; i += 1) {
    const x = rng.range(0, 64);
    const w = rng.range(0.6, 3);
    const top = rng.range(0, 30);
    const h = rng.range(12, 40);
    const grad = c.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(x, top, w, h);
  }
}

/* ------------------------------ wall textures ----------------------------- */

function brickTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#231715';
  c.fillRect(0, 0, 64, 64);

  const brickH = 8;
  const brickW = 16;
  for (let row = 0; row < 64 / brickH; row += 1) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 64 / brickW + 1; col += 1) {
      const x = col * brickW + offset;
      const y = row * brickH;
      const tone = rng.int(-18, 14);
      c.fillStyle = shade('#57301f', tone);
      c.fillRect(x + 0.6, y + 0.6, brickW - 1.2, brickH - 1.2);

      // Chipped corners and pitting give the surface some age.
      if (rng.chance(0.28)) {
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.fillRect(x + rng.range(1, brickW - 4), y + rng.range(1, brickH - 3), rng.range(1, 3), rng.range(1, 2));
      }
      c.fillStyle = 'rgba(255,196,150,0.13)';
      c.fillRect(x + 0.6, y + 0.6, brickW - 1.2, 0.8);
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.fillRect(x + 0.6, y + brickH - 1.6, brickW - 1.2, 1);
    }
  }
  streaks(c, rng, 7);
  c.restore();
  grain(canvas, rng, 0.09);
  return canvas;
}

function panelTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#1d222a';
  c.fillRect(0, 0, 64, 64);

  for (const [px, py] of [[2, 2], [34, 2], [2, 34], [34, 34]]) {
    c.fillStyle = shade('#2e3742', rng.int(-6, 6));
    c.fillRect(px, py, 28, 28);
    c.fillStyle = 'rgba(190,215,240,0.14)';
    c.fillRect(px, py, 28, 1.2);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(px, py + 26.5, 28, 1.5);
    // Recessed bolt heads.
    for (const [bx, by] of [[3, 3], [24, 3], [3, 24], [24, 24]]) {
      c.fillStyle = '#151920';
      c.fillRect(px + bx, py + by, 2, 2);
      c.fillStyle = 'rgba(200,220,245,0.18)';
      c.fillRect(px + bx, py + by, 2, 0.6);
    }
    c.fillStyle = '#12161c';
    c.fillRect(px + 11, py + 11, 6, 6);
  }

  // Hazard stripe band.
  c.fillStyle = '#0f1216';
  c.fillRect(0, 29, 64, 6);
  for (let x = -8; x < 72; x += 8) {
    c.fillStyle = '#e0a340';
    c.beginPath();
    c.moveTo(x, 35);
    c.lineTo(x + 4, 29);
    c.lineTo(x + 8, 29);
    c.lineTo(x + 4, 35);
    c.closePath();
    c.fill();
  }
  streaks(c, rng, 5);
  c.restore();
  grain(canvas, rng, 0.08);
  return canvas;
}

function techTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#121a22';
  c.fillRect(0, 0, 64, 64);

  for (let y = 0; y < 64; y += 4) {
    c.fillStyle = y % 8 === 0 ? '#1b2833' : '#16212b';
    c.fillRect(0, y, 64, 3);
  }
  // Conduit runs.
  c.fillStyle = '#0d151c';
  c.fillRect(6, 0, 4, 64);
  c.fillRect(54, 0, 4, 64);
  c.fillStyle = 'rgba(79,214,196,0.22)';
  c.fillRect(7, 0, 1, 64);
  c.fillRect(55, 0, 1, 64);

  // Indicator banks that read as "live equipment".
  for (let i = 0; i < 22; i += 1) {
    const x = rng.int(14, 48);
    const y = rng.int(4, 58);
    c.fillStyle = rng.chance(0.32) ? '#4fd6c4' : rng.chance(0.4) ? '#2b5f6b' : '#c8582f';
    c.fillRect(x, y, rng.range(1.5, 5), 1.6);
  }
  c.strokeStyle = 'rgba(79,214,196,0.30)';
  c.lineWidth = 0.8;
  c.strokeRect(13, 8, 38, 48);
  c.restore();
  grain(canvas, rng, 0.08);
  return canvas;
}

function fleshTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#340f12';
  c.fillRect(0, 0, 64, 64);

  for (let i = 0; i < 120; i += 1) {
    c.fillStyle = `rgba(${rng.int(100, 165)},${rng.int(18, 44)},${rng.int(24, 50)},0.5)`;
    c.beginPath();
    c.arc(rng.range(0, 64), rng.range(0, 64), rng.range(1.5, 8), 0, Math.PI * 2);
    c.fill();
  }
  // Sinew.
  for (let i = 0; i < 11; i += 1) {
    c.strokeStyle = `rgba(${rng.int(20, 46)},4,8,0.62)`;
    c.lineWidth = rng.range(0.6, 2.2);
    c.beginPath();
    c.moveTo(rng.range(0, 64), 0);
    c.bezierCurveTo(rng.range(0, 64), 21, rng.range(0, 64), 42, rng.range(0, 64), 64);
    c.stroke();
  }
  // Wet highlights.
  for (let i = 0; i < 14; i += 1) {
    c.fillStyle = 'rgba(255,150,150,0.10)';
    c.beginPath();
    c.arc(rng.range(0, 64), rng.range(0, 64), rng.range(1, 3), 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  grain(canvas, rng, 0.11);
  return canvas;
}

function floorTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#211d19';
  c.fillRect(0, 0, 64, 64);

  for (const [px, py] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
    c.fillStyle = shade('#332d25', rng.int(-9, 9));
    c.fillRect(px + 0.8, py + 0.8, 30.4, 30.4);
    c.fillStyle = 'rgba(255,214,170,0.07)';
    c.fillRect(px + 0.8, py + 0.8, 30.4, 0.9);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(px + 0.8, py + 30, 30.4, 1.2);
    // Tread pattern + rivets.
    for (let i = 0; i < 4; i += 1) {
      c.fillStyle = 'rgba(0,0,0,0.16)';
      c.fillRect(px + 4, py + 6 + i * 6, 24, 2);
    }
    for (const [rx, ry] of [[3, 3], [27, 3], [3, 27], [27, 27]]) {
      c.fillStyle = '#4a4238';
      c.fillRect(px + rx, py + ry, 2, 2);
    }
  }
  c.restore();
  grain(canvas, rng, 0.07);
  return canvas;
}

function ceilingTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#15131a';
  c.fillRect(0, 0, 64, 64);

  // Coffered slabs with an exposed girder cross.
  c.fillStyle = '#1c1a22';
  c.fillRect(2, 2, 60, 60);
  c.fillStyle = '#0f0e13';
  c.fillRect(0, 29, 64, 6);
  c.fillRect(29, 0, 6, 64);
  c.fillStyle = 'rgba(160,150,180,0.07)';
  c.fillRect(0, 29, 64, 1);
  c.fillRect(29, 0, 1, 64);
  for (let i = 0; i < 26; i += 1) {
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(rng.range(0, 64), rng.range(0, 64), rng.range(1, 4), rng.range(1, 3));
  }
  c.restore();
  grain(canvas, rng, 0.06);
  return canvas;
}

function doorTexture(rng) {
  const { canvas, c } = designCanvas();
  c.fillStyle = '#2f2820';
  c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#46392c';
  c.fillRect(3, 1, 58, 62);

  // Twin leaves with a heavy centre seam.
  c.fillStyle = '#1d1813';
  c.fillRect(31, 0, 2, 64);
  for (let y = 5; y < 60; y += 9) {
    c.fillStyle = 'rgba(0,0,0,0.32)';
    c.fillRect(5, y, 54, 1.6);
    c.fillStyle = 'rgba(255,214,160,0.06)';
    c.fillRect(5, y + 1.6, 54, 0.6);
  }
  // Warning chevrons.
  for (let i = 0; i < 3; i += 1) {
    c.fillStyle = '#e0a340';
    c.beginPath();
    c.moveTo(10, 20 + i * 10);
    c.lineTo(20, 25 + i * 10);
    c.lineTo(10, 30 + i * 10);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(54, 20 + i * 10);
    c.lineTo(44, 25 + i * 10);
    c.lineTo(54, 30 + i * 10);
    c.closePath();
    c.fill();
  }
  streaks(c, rng, 4);
  c.restore();
  grain(canvas, rng, 0.08);
  return canvas;
}

function exitTexture(rng) {
  const { canvas, c } = designCanvas();
  const grad = c.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#12050a');
  grad.addColorStop(0.45, '#7d1210');
  grad.addColorStop(1, '#e0a340');
  c.fillStyle = grad;
  c.fillRect(0, 0, 64, 64);

  c.fillStyle = '#0b0407';
  c.fillRect(5, 4, 54, 56);
  c.strokeStyle = '#ffce5c';
  c.lineWidth = 1.6;
  c.strokeRect(6, 5, 52, 54);

  c.fillStyle = '#ffce5c';
  c.font = 'bold 15px monospace';
  c.textAlign = 'center';
  c.fillText('EXIT', 32, 30);
  c.font = 'bold 7px monospace';
  c.fillStyle = 'rgba(255,206,92,0.7)';
  c.fillText('SECTOR CLEAR', 32, 42);

  // Glow bars at the base.
  for (let i = 0; i < 5; i += 1) {
    c.fillStyle = `rgba(255,${140 + i * 16},60,${0.5 - i * 0.08})`;
    c.fillRect(8, 50 + i, 48, 1);
  }
  c.restore();
  grain(canvas, rng, 0.05);
  return canvas;
}

/* -------------------------------- sprites --------------------------------- */

/**
 * Shared body-drawing routine for one enemy pose.
 * @param {object} pose {sway, lean, hurt, windup, firing, sink, fade}
 */
function drawEnemy(c, type, pose, rng) {
  const { sway = 0, hurt = false, windup = false, firing = false, sink = 0 } = pose;
  c.save();
  c.translate(0, sink);

  if (type === ENEMY_ID.GRUNT) {
    // Gaunt husk in scorched plating, one arm fused to a slug-thrower.
    const armor = hurt ? '#8c3a2c' : '#42403a';
    const skin = hurt ? '#c05a3a' : '#7d7266';
    c.fillStyle = '#1d1a17';
    c.fillRect(23 + sway, 46, 18, 4);                 // shadow under torso
    c.fillStyle = armor;
    c.fillRect(22 + sway, 21, 20, 26);
    c.fillStyle = shade('#42403a', -14);
    c.fillRect(22 + sway, 33, 20, 3);                 // belt
    c.fillStyle = hurt ? '#a34133' : '#565049';
    c.fillRect(18 + sway, 23, 5, 19);
    c.fillRect(41 + sway, windup ? 20 : 23, 5, 19);
    c.fillStyle = '#2b2824';
    c.fillRect(24 + sway, 46, 7, 15);
    c.fillRect(33 + sway, 46, 7, 15);
    c.fillStyle = skin;
    c.fillRect(26 + sway, 9, 12, 13);
    c.fillStyle = '#1b1815';
    c.fillRect(26 + sway, 9, 12, 3);                  // brow
    c.fillStyle = windup || firing ? '#fff0b0' : '#ffb23c';
    c.fillRect(28 + sway, 14, 3, 3);
    c.fillRect(34 + sway, 14, 3, 3);
    c.fillStyle = '#120f0d';
    c.fillRect(29 + sway, 19, 6, 2);
    c.fillStyle = '#20242a';                           // weapon
    c.fillRect(44 + sway, windup ? 25 : 29, 12, 5);
    c.fillStyle = '#3a4048';
    c.fillRect(50 + sway, windup ? 26 : 30, 6, 3);
  } else if (type === ENEMY_ID.HOUND) {
    // Low quadruped, all shoulders and teeth.
    const hide = hurt ? '#9c3524' : '#45281f';
    c.fillStyle = '#140d0a';
    c.fillRect(16, 54, 32, 4);
    c.fillStyle = hide;
    c.fillRect(14, 31 + sway, 32, 15);
    c.fillStyle = shade('#45281f', -10);
    c.fillRect(14, 31 + sway, 32, 4);                  // spine ridge
    for (let i = 0; i < 4; i += 1) {
      c.fillStyle = '#35201a';
      c.fillRect(16 + i * 8, 45, 5, 12);
    }
    c.fillStyle = hurt ? '#b5412c' : '#52302a';
    c.fillRect(42, 26 + sway, 17, 15);                 // head
    c.fillStyle = '#ff5a3c';
    c.fillRect(47, 30 + sway, 3, 3);
    c.fillRect(53, 30 + sway, 3, 3);
    c.fillStyle = '#efe4cf';                            // jaws
    const gape = firing || windup ? 3 : 0;
    for (let i = 0; i < 5; i += 1) c.fillRect(44 + i * 3, 40 + sway + gape, 2, 4);
    c.strokeStyle = '#35201a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(14, 35 + sway);
    c.lineTo(4, 25 + sway * 2);
    c.stroke();
  } else if (type === ENEMY_ID.BRUTE) {
    // Slab of armour around an open furnace chest.
    const plate = hurt ? '#a33a24' : '#3a2b2b';
    c.fillStyle = '#130e0e';
    c.fillRect(16, 46, 32, 5);
    c.fillStyle = plate;
    c.fillRect(15 + sway, 14, 34, 33);
    c.fillStyle = '#291f1f';
    c.fillRect(9 + sway, 16, 8, 27);
    c.fillRect(47 + sway, windup ? 12 : 16, 8, 27);
    const core = windup ? 1 : firing ? 1.25 : 0.75;
    c.fillStyle = `rgba(255,190,80,${0.45 * core})`;
    c.fillRect(23 + sway, 22, 18, 18);
    c.fillStyle = `rgba(255,${110 + core * 60},${30 * core},1)`;
    c.fillRect(26 + sway, 25, 12, 12);
    c.fillStyle = '#fff2c0';
    c.fillRect(29 + sway, 28, 6, 6);
    c.fillStyle = '#2b201c';
    c.fillRect(19 + sway, 46, 11, 15);
    c.fillRect(34 + sway, 46, 11, 15);
    c.fillStyle = hurt ? '#bb4630' : '#493530';
    c.fillRect(24 + sway, 3, 16, 12);
    c.fillStyle = '#ffd24a';
    c.fillRect(27 + sway, 8, 4, 3);
    c.fillRect(34 + sway, 8, 4, 3);
    c.fillStyle = '#e8ddc6';                            // horns
    c.beginPath();
    c.moveTo(22 + sway, 8);
    c.lineTo(19 + sway, 0);
    c.lineTo(25 + sway, 5);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(42 + sway, 8);
    c.lineTo(45 + sway, 0);
    c.lineTo(39 + sway, 5);
    c.closePath();
    c.fill();
  } else {
    // Slag-wraith: a hovering shell of cooled slag around a coolant core.
    const shell = hurt ? '#2f6d63' : '#1d3d3d';
    const hoverY = Math.sin(sway * 1.4) * 1.5;
    c.fillStyle = 'rgba(60,220,190,0.10)';
    c.beginPath();
    c.ellipse(32, 54, 13, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = shell;
    c.beginPath();                                     // tapered body
    c.moveTo(32, 6 + hoverY);
    c.lineTo(46, 26 + hoverY);
    c.lineTo(40, 48 + hoverY);
    c.lineTo(24, 48 + hoverY);
    c.lineTo(18, 26 + hoverY);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(79,214,196,0.55)';
    c.lineWidth = 1;
    c.stroke();
    const glow = windup ? 1.3 : firing ? 1.6 : 1;
    c.fillStyle = `rgba(79,214,196,${0.5 * glow})`;
    c.beginPath();
    c.arc(32, 27 + hoverY, 8 * glow, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d8fff6';
    c.beginPath();
    c.arc(32, 27 + hoverY, 3.4, 0, Math.PI * 2);
    c.fill();
    // Trailing filaments.
    for (let i = 0; i < 3; i += 1) {
      c.strokeStyle = 'rgba(79,214,196,0.32)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(26 + i * 6, 47 + hoverY);
      c.quadraticCurveTo(24 + i * 6 + sway, 54 + hoverY, 27 + i * 6 - sway, 60 + hoverY);
      c.stroke();
    }
  }
  c.restore();
}

function enemySprite(type, pose, rng) {
  const { canvas, c } = designCanvas(SPRITE);
  c.clearRect(0, 0, 64, 64);
  drawEnemy(c, type, pose, rng);
  c.restore();
  return canvas;
}

/** Four-stage collapse: the body folds down into a spreading pool. */
function deathSprite(type, stage) {
  const { canvas, c } = designCanvas(SPRITE);
  const blood = ENEMY_ID.WRAITH === type ? '#1f6e63' : '#6e0f0f';
  const bodyColor = type === ENEMY_ID.BRUTE ? '#3a2b2b' : type === ENEMY_ID.WRAITH ? '#1d3d3d' : '#3f3931';
  c.clearRect(0, 0, 64, 64);

  const t = stage / 3;                 // 0 -> 1
  const height = 34 * (1 - t) + 6 * t;
  const width = 20 + t * 22;
  const top = 60 - height;

  c.fillStyle = blood;
  c.globalAlpha = 0.35 + t * 0.55;
  c.beginPath();
  c.ellipse(32, 59, 10 + t * 18, 2 + t * 5, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;

  c.fillStyle = bodyColor;
  c.fillRect(32 - width / 2, top, width, height);
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fillRect(32 - width / 2, top, width, Math.max(1, height * 0.2));

  if (stage < 2) {
    // Head still readable in the early frames.
    c.fillStyle = type === ENEMY_ID.WRAITH ? '#4fd6c4' : '#6e675c';
    c.fillRect(30 - stage * 4, top - 6 + stage * 4, 12, 8);
  }
  if (stage >= 2) {
    c.fillStyle = blood;
    c.fillRect(32 - width / 2 + 2, top + 1, width - 4, 2);
  }
  c.restore();
  return canvas;
}

/** Animated torch flame, drawn as its own billboard sprite. */
function flameSprite(frame, rng) {
  const { canvas, c } = designCanvas(SPRITE);
  c.clearRect(0, 0, 64, 64);

  // Bracket.
  c.fillStyle = '#2b2620';
  c.fillRect(28, 42, 8, 18);
  c.fillStyle = '#413a30';
  c.fillRect(26, 40, 12, 4);

  const wobble = Math.sin(frame * 1.7) * 3;
  const lift = Math.cos(frame * 2.3) * 2;
  const flame = c.createRadialGradient(32, 30 - lift, 1, 32, 30 - lift, 18);
  flame.addColorStop(0, 'rgba(255,250,214,0.98)');
  flame.addColorStop(0.28, 'rgba(255,196,80,0.92)');
  flame.addColorStop(0.62, 'rgba(226,96,24,0.66)');
  flame.addColorStop(1, 'rgba(120,20,0,0)');
  c.fillStyle = flame;
  c.beginPath();
  c.moveTo(32, 8 - lift * 2);
  c.quadraticCurveTo(44 + wobble, 26, 38, 42);
  c.quadraticCurveTo(32, 48, 26, 42);
  c.quadraticCurveTo(20 + wobble, 26, 32, 8 - lift * 2);
  c.closePath();
  c.fill();

  c.fillStyle = 'rgba(255,255,230,0.75)';
  c.beginPath();
  c.ellipse(32, 34 - lift, 3.6, 7, 0, 0, Math.PI * 2);
  c.fill();

  // Embers.
  for (let i = 0; i < 3; i += 1) {
    c.fillStyle = `rgba(255,${160 + rng.int(0, 60)},60,${rng.range(0.25, 0.6)})`;
    c.fillRect(30 + Math.sin(frame * 2 + i) * 6, 6 + i * 4 - lift * 2, 1.6, 1.6);
  }
  c.restore();
  return canvas;
}

function pickupSprite(type) {
  const { canvas, c } = designCanvas(SPRITE);
  c.clearRect(0, 0, 64, 64);

  // Every item sits on a faint emissive pad so it reads from across a room.
  const pad = (color) => {
    const grad = c.createRadialGradient(32, 46, 2, 32, 46, 20);
    grad.addColorStop(0, `${color}55`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.ellipse(32, 47, 19, 7, 0, 0, Math.PI * 2);
    c.fill();
  };

  switch (type) {
    case PICKUP.MEDKIT:
      pad('#57d06a');
      c.fillStyle = '#e8e2d4';
      c.fillRect(18, 24, 28, 22);
      c.fillStyle = '#b9b2a2';
      c.fillRect(18, 24, 28, 4);
      c.strokeStyle = '#23231f';
      c.lineWidth = 1.6;
      c.strokeRect(18, 24, 28, 22);
      c.fillStyle = '#c0392b';
      c.fillRect(29, 29, 6, 14);
      c.fillRect(22, 33, 20, 6);
      break;
    case PICKUP.ARMOR:
      pad('#4aa3e0');
      c.fillStyle = '#2f6f9e';
      c.beginPath();
      c.moveTo(32, 20);
      c.lineTo(48, 28);
      c.lineTo(44, 48);
      c.lineTo(32, 54);
      c.lineTo(20, 48);
      c.lineTo(16, 28);
      c.closePath();
      c.fill();
      c.fillStyle = 'rgba(180,225,255,0.3)';
      c.beginPath();
      c.moveTo(32, 20);
      c.lineTo(40, 24);
      c.lineTo(32, 50);
      c.closePath();
      c.fill();
      c.strokeStyle = '#8fd0ff';
      c.lineWidth = 1.6;
      c.stroke();
      break;
    case PICKUP.BULLETS:
      pad('#e0a340');
      c.fillStyle = '#463f36';
      c.fillRect(19, 30, 26, 16);
      c.fillStyle = '#2f2a24';
      c.fillRect(19, 30, 26, 3);
      for (let i = 0; i < 5; i += 1) {
        c.fillStyle = '#e0a340';
        c.fillRect(21 + i * 5, 23, 3.4, 8);
        c.fillStyle = '#fff0c4';
        c.fillRect(21 + i * 5, 23, 3.4, 2);
      }
      break;
    case PICKUP.SHELLS:
      pad('#d8552f');
      for (let i = 0; i < 4; i += 1) {
        c.fillStyle = '#c94a28';
        c.fillRect(17 + i * 8, 28, 6.5, 18);
        c.fillStyle = '#e0c060';
        c.fillRect(17 + i * 8, 41, 6.5, 5);
        c.fillStyle = 'rgba(255,220,190,0.25)';
        c.fillRect(17 + i * 8, 28, 2, 18);
      }
      break;
    case PICKUP.CELLS:
      pad('#4fd6c4');
      c.fillStyle = '#1a2b30';
      c.fillRect(20, 24, 24, 24);
      c.strokeStyle = '#4fd6c4';
      c.lineWidth = 1.4;
      c.strokeRect(20, 24, 24, 24);
      for (let i = 0; i < 3; i += 1) {
        c.fillStyle = `rgba(79,214,196,${0.9 - i * 0.2})`;
        c.fillRect(23, 28 + i * 6, 18, 4);
      }
      break;
    case PICKUP.SHOTGUN:
      pad('#d8cfc0');
      c.fillStyle = '#5a4632';
      c.fillRect(14, 36, 18, 8);
      c.fillStyle = '#242a30';
      c.fillRect(30, 32, 24, 7);
      c.fillStyle = '#3f464d';
      c.fillRect(30, 39, 20, 4);
      c.fillStyle = '#7d6a4c';
      c.fillRect(34, 40, 10, 5);
      break;
    case PICKUP.CHAINGUN:
      pad('#d8cfc0');
      c.fillStyle = '#242a30';
      c.fillRect(12, 30, 22, 14);
      for (let i = 0; i < 3; i += 1) {
        c.fillStyle = i === 1 ? '#6b737b' : '#525960';
        c.fillRect(34, 28 + i * 6, 20, 4.5);
      }
      c.fillStyle = '#e0a340';
      c.fillRect(14, 33, 5, 5);
      break;
    case PICKUP.LANCE:
      pad('#4fd6c4');
      c.fillStyle = '#1e262c';
      c.fillRect(14, 32, 34, 9);
      c.fillStyle = '#39454e';
      c.fillRect(16, 27, 12, 6);
      c.fillStyle = '#4fd6c4';
      c.fillRect(44, 29, 8, 15);
      c.fillStyle = '#d8fff6';
      c.fillRect(46, 33, 4, 7);
      break;
    default:
      c.fillStyle = '#d8cfc0';
      c.fillRect(18, 26, 28, 22);
  }
  c.restore();
  return canvas;
}

function projectileSprite(color, coreColor = '#fff6d8') {
  const canvas = makeCanvas(64, 64);
  const c = ctx2d(canvas);
  const grad = c.createRadialGradient(32, 32, 1, 32, 32, 28);
  grad.addColorStop(0, coreColor);
  grad.addColorStop(0.32, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = grad;
  c.beginPath();
  c.arc(32, 32, 28, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = coreColor;
  c.beginPath();
  c.arc(32, 32, 6, 0, Math.PI * 2);
  c.fill();
  return canvas;
}

/** Tiny round particle used for blood, sparks and smoke. */
function particleSprite(color) {
  const canvas = makeCanvas(16, 16);
  const c = ctx2d(canvas);
  const grad = c.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, color);
  grad.addColorStop(0.6, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = grad;
  c.beginPath();
  c.arc(8, 8, 8, 0, Math.PI * 2);
  c.fill();
  return canvas;
}

/* ------------------------------ status portrait ---------------------------- */

/**
 * Status-bar portrait of the diver inside the helmet. Five health stages plus
 * a dead frame; it snarls as things get worse. Original character design.
 */
function portraitFrame(stage, dead = false) {
  const canvas = makeCanvas(96, 96);
  const c = ctx2d(canvas);
  c.scale(96 / 64, 96 / 64);
  c.clearRect(0, 0, 64, 64);

  const damage = stage / 4;                     // 0 healthy -> 1 nearly dead
  c.fillStyle = '#15171c';
  c.fillRect(0, 0, 64, 64);

  // Helmet shell.
  c.fillStyle = dead ? '#2a2b30' : '#4a5058';
  c.beginPath();
  c.moveTo(10, 30);
  c.quadraticCurveTo(10, 8, 32, 8);
  c.quadraticCurveTo(54, 8, 54, 30);
  c.lineTo(54, 46);
  c.lineTo(10, 46);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(210,225,240,0.16)';
  c.fillRect(12, 12, 40, 3);

  // Face opening.
  c.fillStyle = dead ? '#43302c' : `rgb(${168 - damage * 20},${138 - damage * 42},${120 - damage * 46})`;
  c.fillRect(16, 22, 32, 24);

  if (dead) {
    c.strokeStyle = '#2a1512';
    c.lineWidth = 2;
    for (const ex of [23, 37]) {
      c.beginPath();
      c.moveTo(ex - 3, 28);
      c.lineTo(ex + 3, 34);
      c.moveTo(ex + 3, 28);
      c.lineTo(ex - 3, 34);
      c.stroke();
    }
    c.fillStyle = '#6e0f0f';
    c.fillRect(20, 38, 24, 5);
  } else {
    // Eyes narrow as health drops.
    const squint = damage * 2.4;
    c.fillStyle = '#efe9dd';
    c.fillRect(20, 28 + squint, 8, 5 - squint);
    c.fillRect(36, 28 + squint, 8, 5 - squint);
    c.fillStyle = '#1d2a33';
    c.fillRect(23, 29 + squint, 3, 3.5 - squint * 0.6);
    c.fillRect(39, 29 + squint, 3, 3.5 - squint * 0.6);
    // Brow + mouth get angrier.
    c.strokeStyle = '#3a2a22';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(19, 27 - damage);
    c.lineTo(28, 25 + damage * 3);
    c.moveTo(45, 27 - damage);
    c.lineTo(36, 25 + damage * 3);
    c.stroke();
    c.fillStyle = '#3a211c';
    c.fillRect(26, 39, 12, 2 + damage * 3);
    // Blood as it gets bad.
    if (stage >= 2) {
      c.fillStyle = 'rgba(140,20,20,0.8)';
      c.fillRect(19, 33, 3, 6 + stage * 2);
    }
    if (stage >= 3) {
      c.fillStyle = 'rgba(140,20,20,0.75)';
      c.fillRect(41, 30, 4, 10);
      c.fillRect(30, 44, 6, 3);
    }
  }

  // Visor frame over the top.
  c.strokeStyle = '#20252b';
  c.lineWidth = 3;
  c.strokeRect(15.5, 21.5, 33, 25);
  c.fillStyle = '#2c333b';
  c.fillRect(10, 44, 44, 6);
  c.fillStyle = dead ? '#6e0f0f' : '#57d06a';
  c.fillRect(12, 46, 4, 2);
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

    this.floor = new Texture(floorTexture(rng));
    this.ceiling = new Texture(ceilingTexture(rng));

    /**
     * Per enemy: a 4-frame walk cycle, a 2-frame attack (windup, release),
     * a pain frame and a 4-frame death collapse.
     */
    this.enemies = new Map();
    for (const id of Object.values(ENEMY_ID)) {
      this.enemies.set(id, {
        walk: [0, 1, 2, 3].map((i) => new Texture(enemySprite(id, {
          sway: [0, 2, 0, -2][i],
        }, rng))),
        attack: [
          new Texture(enemySprite(id, { windup: true }, rng)),
          new Texture(enemySprite(id, { firing: true }, rng)),
        ],
        pain: new Texture(enemySprite(id, { hurt: true, sway: 1 }, rng)),
        death: [0, 1, 2, 3].map((stage) => new Texture(deathSprite(id, stage))),
      });
    }

    this.flames = [0, 1, 2, 3, 4, 5].map((f) => new Texture(flameSprite(f, rng)));

    this.pickups = new Map(
      Object.values(PICKUP).map((id) => [id, new Texture(pickupSprite(id))])
    );

    this.projectiles = new Map([
      ['ember', new Texture(projectileSprite('#ff8a2a'))],
      ['bile', new Texture(projectileSprite('#7cff5c'))],
      ['coolant', new Texture(projectileSprite('#4fd6c4', '#e6fffb'))],
      ['bolt', new Texture(projectileSprite('#59e0ff', '#ffffff'))],
    ]);

    this.particles = new Map([
      ['blood', new Texture(particleSprite('#8a1a1a'))],
      ['bloodCool', new Texture(particleSprite('#2f9e8c'))],
      ['spark', new Texture(particleSprite('#ffd27a'))],
      ['smoke', new Texture(particleSprite('rgba(120,120,130,0.55)'))],
      ['plasma', new Texture(particleSprite('#7fe9ff'))],
    ]);

    /** Portrait canvases: index 0 (healthy) .. 4 (critical), plus `dead`. */
    this.portraits = {
      stages: [0, 1, 2, 3, 4].map((stage) => portraitFrame(stage)),
      dead: portraitFrame(4, true),
    };
  }

  wall(tile) {
    return this.walls.get(tile) ?? this.walls.get(TILE.WALL_BRICK);
  }
}
