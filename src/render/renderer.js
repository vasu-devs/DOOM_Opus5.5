import { RENDER, TILE, QUALITY, LIGHT } from '../core/constants.js';
import { clamp, fogFactor } from '../core/math.js';
import { castRay, cameraX } from './raycaster.js';

/** Pixels between lighting evaluations on the floor/ceiling planes. */
const LIGHT_SPAN = 16;

const MAX_PLANE_LIGHT = 1.55;

/**
 * Accumulated torchlight at a world point, on top of an ambient base.
 *
 * Uses a squared-distance falloff so there is no `sqrt` on the hot path: it
 * gives a slightly tighter pool than a linear falloff, which reads fine for
 * firelight and costs a fraction as much.
 */
function lightAt(lights, worldX, worldY, base) {
  let light = base;
  for (let i = 0; i < lights.length; i += 1) {
    const source = lights[i];
    const dx = source.x - worldX;
    const dy = source.y - worldY;
    const distSq = dx * dx + dy * dy;
    if (distSq < source.radiusSq) {
      const falloff = 1 - distSq / source.radiusSq;
      light += source.intensity * falloff * falloff;
    }
  }
  return light > MAX_PLANE_LIGHT ? MAX_PLANE_LIGHT : light;
}

/**
 * Software raycasting renderer.
 *
 * Walls, floor, ceiling and z-buffered billboard sprites are drawn into an
 * internal ImageData buffer, which is then upscaled to the display canvas with
 * smoothing off. The internal height is a quality rung; width follows the
 * window aspect, so the view is genuinely full-screen rather than letterboxed.
 *
 * Per-frame cost is O(width * height) and independent of level size.
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

    this.qualityIndex = QUALITY.DEFAULT_INDEX;
    this.autoQuality = true;
    this.aspect = 16 / 9;
    this.frameSamples = [];

    this.frameCanvas = document.createElement('canvas');
    this.frameCtx = this.frameCanvas.getContext('2d', { alpha: false });

    this.width = 0;
    this.height = 0;
    this.#allocate();

    /** Little-endian ABGR packing is the norm on every platform we target. */
    this.packColor = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
  }

  /* ------------------------------ buffer sizing --------------------------- */

  #allocate() {
    const targetHeight = QUALITY.LADDER[clamp(this.qualityIndex, 0, QUALITY.LADDER.length - 1)];
    let height = targetHeight;
    let width = Math.round(height * this.aspect);

    // Hard ceiling on total pixels so an ultrawide monitor cannot melt the CPU.
    if (width * height > QUALITY.MAX_BUFFER_PIXELS) {
      const scale = Math.sqrt(QUALITY.MAX_BUFFER_PIXELS / (width * height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    width += width % 2;
    height += height % 2;

    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.frameCanvas.width = width;
    this.frameCanvas.height = height;
    this.buffer = this.frameCtx.createImageData(width, height);
    this.pixels = new Uint32Array(this.buffer.data.buffer);
    this.zBuffer = new Float32Array(width);
  }

  /** @param {number|'auto'} quality ladder index, or 'auto' for the governor */
  setQuality(quality) {
    if (quality === 'auto') {
      this.autoQuality = true;
    } else {
      this.autoQuality = false;
      this.qualityIndex = clamp(Number(quality), 0, QUALITY.LADDER.length - 1);
    }
    this.frameSamples.length = 0;
    this.#allocate();
  }

  /** Fit the display canvas to the window and match the buffer to its aspect. */
  resize(displayWidth, displayHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(2, Math.floor(displayWidth * dpr));
    this.canvas.height = Math.max(2, Math.floor(displayHeight * dpr));
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.aspect = displayWidth / Math.max(1, displayHeight);
    this.#allocate();
  }

  /**
   * Frame-time governor. Averages a window of frames and walks the quality
   * ladder so the game holds its frame rate on whatever hardware it lands on.
   */
  sampleFrame(frameMs) {
    if (!this.autoQuality) return;
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length < QUALITY.AUTO_SAMPLE_FRAMES) return;

    const avg = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
    this.frameSamples.length = 0;

    if (avg > QUALITY.AUTO_DOWN_MS && this.qualityIndex > 0) {
      this.qualityIndex -= 1;
      this.#allocate();
    } else if (avg < QUALITY.AUTO_TARGET_MS && this.qualityIndex < QUALITY.LADDER.length - 1) {
      this.qualityIndex += 1;
      this.#allocate();
    }
  }

  get internalLabel() {
    return `${this.width}x${this.height}`;
  }

  /* -------------------------------- drawing ------------------------------- */

  /** @param {import('../game/game.js').Game} game */
  render(game) {
    this.#drawSkyAndPlanes(game);
    this.#drawWalls(game);
    this.#drawSprites(game);
    this.#present(game);
  }

  #horizon(game) {
    return Math.floor(this.height / 2 + game.player.pitchOffset * (this.height / 600));
  }

  /**
   * Floor and ceiling in one pass.
   *
   * Every screen row below the horizon shows floor at a constant distance, so
   * one divide per row yields a world-space step per pixel - perspective-correct
   * planes with no per-pixel divide. The matching row above the horizon is the
   * ceiling at the same distance, so both are filled from the same walk.
   */
  #drawSkyAndPlanes(game) {
    const { player, level } = game;
    const { width, height, pixels } = this;
    const horizon = this.#horizon(game);

    const floorTex = this.textures.floor;
    const ceilTex = this.textures.ceiling;
    const floorTint = hexToRgb(level.floorColor);
    const ceilTint = hexToRgb(level.skyTop);
    const deepTint = hexToRgb(level.skyBottom);

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2) * this.aspect * (3 / 4);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;

    const rayLeftX = dirX - planeX;
    const rayLeftY = dirY - planeY;
    const rayRightX = dirX + planeX;
    const rayRightY = dirY + planeY;

    // Far haze fill first: anything the plane walk skips keeps this colour.
    for (let y = 0; y < height; y += 1) {
      const above = y < horizon;
      const tint = above ? ceilTint : deepTint;
      const t = above ? y / Math.max(1, horizon) : 1;
      const k = 0.55 + t * 0.35;
      const color = 0xff000000
        | ((tint.b * k) << 16) | ((tint.g * k) << 8) | (tint.r * k);
      pixels.fill(color, y * width, y * width + width);
    }

    const lights = game.activeLights ?? [];
    const floorData = floorTex.data;
    const ceilData = ceilTex.data;
    const fTexW = floorTex.width;
    const fTexH = floorTex.height;
    const cTexW = ceilTex.width;
    const cTexH = ceilTex.height;

    // Hoist everything constant out of the per-pixel loop: tint contributions,
    // and the pixel buffer itself as a plain local.
    const fTintR = floorTint.r * 0.4;
    const fTintG = floorTint.g * 0.4;
    const fTintB = floorTint.b * 0.4;
    const cTintR = ceilTint.r * 0.5;
    const cTintG = ceilTint.g * 0.5;
    const cTintB = ceilTint.b * 0.5;
    const buf = pixels;

    const maxRows = height - horizon;
    for (let row = 1; row < maxRows; row += 1) {
      const y = horizon + row;
      const rowDistance = (0.5 * height) / row;
      if (rowDistance > RENDER.FOG_END) continue;

      const stepX = (rowDistance * (rayRightX - rayLeftX)) / width;
      const stepY = (rowDistance * (rayRightY - rayLeftY)) / width;
      let planeXPos = player.x + rowDistance * rayLeftX;
      let planeYPos = player.y + rowDistance * rayLeftY;

      const fog = fogFactor(rowDistance, RENDER.FOG_START, RENDER.FOG_END);
      const baseLight = (1 - fog * 0.94) * 1.12 + game.lightBoost / Math.max(1, rowDistance);
      const ceilY = horizon - row;
      const floorRowStart = y * width;
      const ceilRowStart = ceilY * width;
      const drawCeiling = ceilY >= 0;

      // Lighting is low-frequency, so it is evaluated once per span and
      // interpolated across it. That turns a per-pixel light loop (the single
      // most expensive thing in the frame) into one evaluation per LIGHT_SPAN
      // pixels, with no visible difference.
      let spanLight = lightAt(lights, planeXPos, planeYPos, baseLight);

      for (let x0 = 0; x0 < width; x0 += LIGHT_SPAN) {
        const x1 = Math.min(x0 + LIGHT_SPAN, width);
        const span = x1 - x0;
        const endX = planeXPos + stepX * span;
        const endY = planeYPos + stepY * span;
        const endLight = lightAt(lights, endX, endY, baseLight);
        const lightStep = (endLight - spanLight) / span;
        let light = spanLight;

        for (let x = x0; x < x1; x += 1) {
          const worldX = planeXPos;
          const worldY = planeYPos;
          planeXPos += stepX;
          planeYPos += stepY;
          const lit = light;
          light += lightStep;
          if (lit <= 0.02) continue;

          // World coords are always positive inside a level, so `| 0` is a
          // safe (and much cheaper) floor here.
          const fracX = worldX - (worldX | 0);
          const fracY = worldY - (worldY | 0);

          // Colour packing is inlined here on purpose: at ~1M pixels a frame,
          // a method call per pixel was the single largest cost in the render.
          const fIdx = (((fracY * fTexH) | 0) * fTexW + ((fracX * fTexW) | 0)) * 4;
          let r = (floorData[fIdx] * 0.75 + fTintR) * lit;
          let g2 = (floorData[fIdx + 1] * 0.75 + fTintG) * lit;
          let b = (floorData[fIdx + 2] * 0.75 + fTintB) * lit;
          buf[floorRowStart + x] = 0xff000000
            | ((b > 255 ? 255 : b) << 16)
            | ((g2 > 255 ? 255 : g2) << 8)
            | (r > 255 ? 255 : r);

          if (drawCeiling) {
            const cIdx = (((fracY * cTexH) | 0) * cTexW + ((fracX * cTexW) | 0)) * 4;
            const ceilLight = lit * 0.82;
            r = (ceilData[cIdx] * 0.7 + cTintR) * ceilLight;
            g2 = (ceilData[cIdx + 1] * 0.7 + cTintG) * ceilLight;
            b = (ceilData[cIdx + 2] * 0.7 + cTintB) * ceilLight;
            buf[ceilRowStart + x] = 0xff000000
              | ((b > 255 ? 255 : b) << 16)
              | ((g2 > 255 ? 255 : g2) << 8)
              | (r > 255 ? 255 : r);
          }
        }
        spanLight = endLight;
      }
    }
  }

  #drawWalls(game) {
    const { player, level } = game;
    const { width, height, pixels, zBuffer } = this;
    const grid = level.grid;
    const horizon = this.#horizon(game);
    const lights = game.activeLights ?? [];

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2) * this.aspect * (3 / 4);
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
      const drawStart = Math.floor(-lineHeight / 2 + horizon);
      const drawEnd = Math.floor(lineHeight / 2 + horizon);
      const clampedStart = Math.max(drawStart, 0);
      const clampedEnd = Math.min(drawEnd, height - 1);
      if (clampedEnd < clampedStart) continue;

      const texture = this.textures.wall(hit.tile);
      const texX = Math.min(texture.width - 1, Math.floor(hit.textureX * texture.width));
      const step = texture.height / lineHeight;
      let texPos = (clampedStart - horizon + lineHeight / 2) * step;

      // Shade: darker on y-facing sides, plus depth fog, torches and muzzle flash.
      const sideShade = hit.side === 1 ? 0.7 : 1;
      const fog = fogFactor(perp, RENDER.FOG_START, RENDER.FOG_END);
      const hitX = player.x + rayDirX * perp;
      const hitY = player.y + rayDirY * perp;

      const torch = lightAt(lights, hitX, hitY, 0);

      const emissive = hit.tile === TILE.EXIT ? 0.5 : hit.tile === TILE.WALL_TECH ? 0.08 : 0;
      const light = clamp(
        sideShade * (1 - fog * 0.88) + torch + emissive + game.lightBoost / Math.max(1, perp * 0.9),
        0, 1.6
      );

      const data = texture.data;
      const texRowW = texture.width;
      const texMaxY = texture.height - 1;
      for (let y = clampedStart; y <= clampedEnd; y += 1) {
        let texY = texPos | 0;
        if (texY < 0) texY = 0;
        else if (texY > texMaxY) texY = texMaxY;
        texPos += step;
        const idx = (texY * texRowW + texX) * 4;
        const r = data[idx] * light;
        const g = data[idx + 1] * light;
        const b = data[idx + 2] * light;
        pixels[y * width + x] = 0xff000000
          | ((b > 255 ? 255 : b) << 16)
          | ((g > 255 ? 255 : g) << 8)
          | (r > 255 ? 255 : r);
      }
    }
  }

  #drawSprites(game) {
    const { player } = game;
    const { width, height, pixels, zBuffer } = this;
    const horizon = this.#horizon(game);
    const lights = game.activeLights ?? [];

    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const planeScale = Math.tan(RENDER.FOV / 2) * this.aspect * (3 / 4);
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
      if (transformY <= 0.08) continue;

      const screenX = Math.floor((width / 2) * (1 + transformX / transformY));
      const scale = sprite.scale ?? 1;
      const spriteH = Math.abs(Math.floor(height / transformY)) * scale;
      const spriteW = spriteH;
      if (spriteH < 1) continue;
      const vOffset = ((sprite.vOffset ?? 0) / transformY) * height;

      const startY = Math.floor(horizon - spriteH / 2 + vOffset + (height / transformY) * (0.5 - scale / 2));
      const startX = Math.floor(screenX - spriteW / 2);
      const endX = startX + spriteW;
      const endY = startY + spriteH;

      const texture = sprite.texture;
      const data = texture.data;
      const distance = Math.sqrt(sprite.dist);
      const fog = fogFactor(distance, RENDER.FOG_START, RENDER.FOG_END);

      const torch = sprite.emissive ? 0 : lightAt(lights, sprite.x, sprite.y, 0);

      const light = clamp(
        (1 - fog * 0.82) + torch + game.lightBoost / Math.max(1, distance),
        0, 1.6
      ) * (sprite.emissive ? 1.75 : 1);
      const tint = sprite.tint ?? null;
      const alpha = sprite.alpha ?? 1;

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
          const texAlpha = (data[idx + 3] / 255) * alpha;
          if (texAlpha < 0.06) continue;

          let r = data[idx] * light;
          let g = data[idx + 1] * light;
          let b = data[idx + 2] * light;
          if (tint) {
            r = r * (1 - tint.a) + tint.r * tint.a;
            g = g * (1 - tint.a) + tint.g * tint.a;
            b = b * (1 - tint.a) + tint.b * tint.a;
          }

          const target = y * width + x;
          if (texAlpha < 0.98) {
            // Blend against what is already there (particles, glows, fades).
            const dst = pixels[target];
            const dr = dst & 255;
            const dg = (dst >> 8) & 255;
            const db = (dst >> 16) & 255;
            r = r * texAlpha + dr * (1 - texAlpha);
            g = g * texAlpha + dg * (1 - texAlpha);
            b = b * texAlpha + db * (1 - texAlpha);
          }
          pixels[target] = this.packColor(
            Math.min(255, r) | 0, Math.min(255, g) | 0, Math.min(255, b) | 0
          );
        }
      }
    }
  }

  /** Upscale the internal buffer onto the display canvas and tint it. */
  #present(game) {
    this.frameCtx.putImageData(this.buffer, 0, 0);
    const { ctx, canvas } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.frameCanvas, 0, 0, canvas.width, canvas.height);

    if (game.painFlash > 0) {
      ctx.fillStyle = `rgba(150,16,16,${Math.min(0.5, game.painFlash * 0.5)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (game.pickupFlash > 0) {
      ctx.fillStyle = `rgba(224,163,64,${Math.min(0.26, game.pickupFlash * 0.26)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.#drawVignette();

    // Low-health pulse at the screen edges.
    if (game.player.alive && game.player.health <= 30) {
      const pulse = 0.18 + Math.sin(game.elapsedMs / 180) * 0.09;
      ctx.fillStyle = `rgba(120,8,8,${Math.max(0, pulse)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.06);
      ctx.fillRect(0, canvas.height * 0.94, canvas.width, canvas.height * 0.06);
    }
  }

  #drawVignette() {
    const { ctx, canvas } = this;
    if (!this.vignette || this.vignetteW !== canvas.width || this.vignetteH !== canvas.height) {
      const grad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.height * 0.34,
        canvas.width / 2, canvas.height / 2, canvas.height * 0.92
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.6)');
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
