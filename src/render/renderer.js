import { RENDER, TILE } from '../core/constants.js';
import { clamp, fogFactor } from '../core/math.js';
import { castRay, cameraX } from './raycaster.js';

/**
 * Software raycasting renderer.
 *
 * Draws walls, floor/ceiling and z-buffered billboard sprites into a small
 * internal ImageData buffer (480x300 by default), then upscales it with
 * smoothing off for a crisp, chunky look. Per-frame cost is O(width * height),
 * independent of level size.
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas display canvas
   * @param {import('./textures.js').TextureBank} textures
   */
  constructor(canvas, textures) {
    this.canvas = canvas;
    this.textures = textures;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('2D context unavailable on display canvas');
    this.ctx.imageSmoothingEnabled = false;

    this.width = RENDER.INTERNAL_WIDTH;
    this.height = RENDER.INTERNAL_HEIGHT;

    this.buffer = this.ctx.createImageData(this.width, this.height);
    this.pixels = new Uint32Array(this.buffer.data.buffer);
    this.zBuffer = new Float32Array(this.width);

    this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = this.width;
    this.frameCanvas.height = this.height;
    this.frameCtx = this.frameCanvas.getContext('2d');

    /** Little-endian ABGR packing is the norm on every platform we target. */
    this.packColor = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
  }

  /** Fit the display canvas to its container while preserving the 8:5 viewport. */
  resize(displayWidth, displayHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(displayWidth * dpr);
    this.canvas.height = Math.floor(displayHeight * dpr);
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** @param {import('../game/game.js').Game} game */
  render(game) {
    const { player, level } = game;
    this.#drawBackdrop(level, player);
    this.#drawFloor(game);
    this.#drawWalls(game);
    this.#drawSprites(game);
    this.#present(game);
  }

  /* ------------------------------ scene passes ---------------------------- */

  #drawBackdrop(level, player) {
    const { width, height, pixels } = this;
    const horizon = Math.floor(height / 2 + player.pitchOffset);
    const top = hexToRgb(level.skyTop);
    const bottom = hexToRgb(level.skyBottom);
    const floor = hexToRgb(level.floorColor);

    for (let y = 0; y < height; y += 1) {
      let r;
      let g;
      let b;
      if (y < horizon) {
        const t = horizon <= 0 ? 0 : y / horizon;
        r = Math.round(top.r + (bottom.r - top.r) * t);
        g = Math.round(top.g + (bottom.g - top.g) * t);
        b = Math.round(top.b + (bottom.b - top.b) * t);
      } else {
        // Nearer floor rows are brighter; distance falls off toward the horizon.
        const t = clamp((y - horizon) / Math.max(1, height - horizon), 0, 1);
        const lit = 0.32 + t * 0.85;
        r = Math.round(floor.r * lit);
        g = Math.round(floor.g * lit);
        b = Math.round(floor.b * lit);
      }
      const color = this.packColor(r, g, b);
      const rowStart = y * width;
      pixels.fill(color, rowStart, rowStart + width);
    }
  }

  /**
   * Textured floor pass.
   *
   * For each row below the horizon, the distance to the floor strip it shows is
   * constant, so one divide per row gives a world-space step per pixel. That is
   * what makes a perspective-correct floor affordable in software: O(width) per
   * row with no per-pixel divides.
   */
  #drawFloor(game) {
    const { player, level } = game;
    const { width, height, pixels } = this;
    const texture = this.textures.floor;
    if (!texture) return;

    const horizon = Math.floor(height / 2 + player.pitchOffset);
    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;

    // Ray directions at the extreme left and right of the screen.
    const rayLeftX = dirX - planeX;
    const rayLeftY = dirY - planeY;
    const rayRightX = dirX + planeX;
    const rayRightY = dirY + planeY;

    const tint = hexToRgb(level.floorColor);
    const data = texture.data;
    const texW = texture.width;
    const texH = texture.height;

    for (let y = horizon + 1; y < height; y += 1) {
      const rowDistance = (0.5 * height) / (y - horizon);
      if (rowDistance > RENDER.FOG_END) continue; // beyond fog: keep the gradient

      const stepX = (rowDistance * (rayRightX - rayLeftX)) / width;
      const stepY = (rowDistance * (rayRightY - rayLeftY)) / width;
      let floorX = player.x + rowDistance * rayLeftX;
      let floorY = player.y + rowDistance * rayLeftY;

      const fog = fogFactor(rowDistance, RENDER.FOG_START, RENDER.FOG_END);
      const light = clamp((1 - fog * 0.92) * 1.15 + game.lightBoost / Math.max(1, rowDistance), 0, 1.4);
      const rowStart = y * width;

      for (let x = 0; x < width; x += 1) {
        const tx = ((floorX - Math.floor(floorX)) * texW) | 0;
        const ty = ((floorY - Math.floor(floorY)) * texH) | 0;
        floorX += stepX;
        floorY += stepY;

        const idx = (ty * texW + tx) * 4;
        // Blend the grating toward the level's floor colour so sectors differ.
        const r = Math.min(255, (data[idx] * 0.72 + tint.r * 0.45) * light) | 0;
        const g = Math.min(255, (data[idx + 1] * 0.72 + tint.g * 0.45) * light) | 0;
        const b = Math.min(255, (data[idx + 2] * 0.72 + tint.b * 0.45) * light) | 0;
        pixels[rowStart + x] = this.packColor(r, g, b);
      }
    }
  }

  #drawWalls(game) {
    const { player, level } = game;
    const { width, height, pixels, zBuffer } = this;
    const grid = level.grid;
    const horizon = Math.floor(height / 2 + player.pitchOffset);

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;

    for (let x = 0; x < width; x += 1) {
      const camX = cameraX(x, width);
      const rayDirX = dirX + planeX * camX;
      const rayDirY = dirY + planeY * camX;

      const hit = castRay(grid, player.x, player.y, rayDirX, rayDirY, RENDER.MAX_DEPTH);
      zBuffer[x] = hit.distance;
      if (!hit.hit) continue;

      const perp = Math.max(hit.distance, 0.0001);
      const lineHeight = Math.floor(height / perp);
      let drawStart = Math.floor(-lineHeight / 2 + horizon);
      let drawEnd = Math.floor(lineHeight / 2 + horizon);
      const clampedStart = Math.max(drawStart, 0);
      const clampedEnd = Math.min(drawEnd, height - 1);
      if (clampedEnd < clampedStart) continue;

      const texture = this.textures.wall(hit.tile);
      const texX = Math.min(texture.width - 1, Math.floor(hit.textureX * texture.width));
      const step = texture.height / lineHeight;
      let texPos = (clampedStart - horizon + lineHeight / 2) * step;

      // Shade: darker on y-facing sides, plus depth fog and muzzle-flash light.
      const sideShade = hit.side === 1 ? 0.72 : 1;
      const fog = fogFactor(perp, RENDER.FOG_START, RENDER.FOG_END);
      const flash = game.lightBoost;
      const light = clamp(sideShade * (1 - fog * 0.86) + flash / Math.max(1, perp * 0.9), 0, 1.45);
      const emissive = hit.tile === TILE.EXIT ? 0.45 : 0;

      const data = texture.data;
      for (let y = clampedStart; y <= clampedEnd; y += 1) {
        const texY = Math.min(texture.height - 1, Math.max(0, texPos | 0));
        texPos += step;
        const idx = (texY * texture.width + texX) * 4;
        const lum = light + emissive;
        const r = Math.min(255, data[idx] * lum) | 0;
        const g = Math.min(255, data[idx + 1] * lum) | 0;
        const b = Math.min(255, data[idx + 2] * lum) | 0;
        pixels[y * width + x] = this.packColor(r, g, b);
      }
    }
  }

  #drawSprites(game) {
    const { player } = game;
    const { width, height, pixels, zBuffer } = this;
    const horizon = height / 2 + player.pitchOffset;

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;

    const sprites = game.collectSprites();
    for (const sprite of sprites) {
      sprite.dist = (sprite.x - player.x) ** 2 + (sprite.y - player.y) ** 2;
    }
    sprites.sort((a, b) => b.dist - a.dist);

    const invDet = 1 / (planeX * dirY - dirX * planeY);

    for (const sprite of sprites) {
      const relX = sprite.x - player.x;
      const relY = sprite.y - player.y;
      const transformX = invDet * (dirY * relX - dirX * relY);
      const transformY = invDet * (-planeY * relX + planeX * relY);
      if (transformY <= 0.08) continue; // behind the camera / too close

      const screenX = Math.floor((width / 2) * (1 + transformX / transformY));
      const scale = sprite.scale ?? 1;
      const spriteH = Math.abs(Math.floor(height / transformY)) * scale;
      const spriteW = spriteH;
      const vOffset = ((sprite.vOffset ?? 0) / transformY) * height;

      const startY = Math.floor(horizon - spriteH / 2 + vOffset + (height / transformY) * (0.5 - scale / 2));
      const endY = startY + spriteH;
      const startX = Math.floor(screenX - spriteW / 2);
      const endX = startX + spriteW;

      const texture = sprite.texture;
      const data = texture.data;
      const distance = Math.sqrt(sprite.dist);
      const fog = fogFactor(distance, RENDER.FOG_START, RENDER.FOG_END);
      const light = clamp((1 - fog * 0.8) + game.lightBoost / Math.max(1, distance), 0, 1.5)
        * (sprite.emissive ? 1.6 : 1);
      const tint = sprite.tint ?? null;

      const clampedX0 = Math.max(startX, 0);
      const clampedX1 = Math.min(endX, width - 1);
      const clampedY0 = Math.max(startY, 0);
      const clampedY1 = Math.min(endY, height - 1);

      for (let x = clampedX0; x <= clampedX1; x += 1) {
        if (transformY >= zBuffer[x]) continue;
        const texX = Math.min(
          texture.width - 1,
          Math.max(0, Math.floor(((x - startX) * texture.width) / spriteW))
        );
        for (let y = clampedY0; y <= clampedY1; y += 1) {
          const texY = Math.min(
            texture.height - 1,
            Math.max(0, Math.floor(((y - startY) * texture.height) / spriteH))
          );
          const idx = (texY * texture.width + texX) * 4;
          const alpha = data[idx + 3];
          if (alpha < 24) continue;
          let r = data[idx] * light;
          let g = data[idx + 1] * light;
          let b = data[idx + 2] * light;
          if (tint) {
            r = r * (1 - tint.a) + tint.r * tint.a;
            g = g * (1 - tint.a) + tint.g * tint.a;
            b = b * (1 - tint.a) + tint.b * tint.a;
          }
          pixels[y * width + x] = this.packColor(
            Math.min(255, r) | 0,
            Math.min(255, g) | 0,
            Math.min(255, b) | 0
          );
        }
      }
    }
  }

  /** Upscale the internal buffer onto the display canvas. */
  #present(game) {
    this.frameCtx.putImageData(this.buffer, 0, 0);
    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.frameCanvas, 0, 0, canvas.width, canvas.height);

    if (game.painFlash > 0) {
      ctx.fillStyle = `rgba(150,16,16,${Math.min(0.55, game.painFlash * 0.55)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (game.pickupFlash > 0) {
      ctx.fillStyle = `rgba(224,163,64,${Math.min(0.3, game.pickupFlash * 0.3)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.#drawVignette();
  }

  #drawVignette() {
    const { ctx, canvas } = this;
    if (!this.vignette || this.vignetteW !== canvas.width || this.vignetteH !== canvas.height) {
      const grad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.height * 0.32,
        canvas.width / 2, canvas.height / 2, canvas.height * 0.86
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      this.vignette = grad;
      this.vignetteW = canvas.width;
      this.vignetteH = canvas.height;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
