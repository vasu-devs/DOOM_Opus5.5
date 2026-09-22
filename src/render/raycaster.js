import { TILE } from '../core/constants.js';

/**
 * Amanatides-Woo DDA ray cast against the tile grid.
 *
 * Pure function over a Grid: no canvas, no globals - the unit tests call it
 * directly. Complexity is O(tiles crossed), bounded by maxDepth.
 *
 * Sliding doors are handled inline: a door is drawn as a slab that retracts
 * sideways, so a ray hitting an opened portion simply carries on.
 *
 * @returns {{hit:boolean, distance:number, tile:number, side:0|1, textureX:number,
 *            mapX:number, mapY:number}}
 */
export function castRay(grid, posX, posY, rayDirX, rayDirY, maxDepth) {
  let mapX = Math.floor(posX);
  let mapY = Math.floor(posY);

  const deltaX = rayDirX === 0 ? Infinity : Math.abs(1 / rayDirX);
  const deltaY = rayDirY === 0 ? Infinity : Math.abs(1 / rayDirY);

  const stepX = rayDirX < 0 ? -1 : 1;
  const stepY = rayDirY < 0 ? -1 : 1;

  let sideDistX = rayDirX < 0 ? (posX - mapX) * deltaX : (mapX + 1 - posX) * deltaX;
  let sideDistY = rayDirY < 0 ? (posY - mapY) * deltaY : (mapY + 1 - posY) * deltaY;

  let side = 0;
  let distance = 0;

  while (distance < maxDepth) {
    if (sideDistX < sideDistY) {
      distance = sideDistX;
      sideDistX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      distance = sideDistY;
      sideDistY += deltaY;
      mapY += stepY;
      side = 1;
    }

    if (!grid.inBounds(mapX, mapY)) break;
    const tile = grid.at(mapX, mapY);
    if (tile === TILE.EMPTY) continue;

    // Where along the wall face the ray landed, in [0,1).
    let textureX = side === 0 ? posY + distance * rayDirY : posX + distance * rayDirX;
    textureX -= Math.floor(textureX);

    if (tile === TILE.DOOR) {
      const door = grid.doorAt(mapX, mapY);
      const openness = door ? door.openness : 0;
      const shifted = textureX + openness;
      if (shifted >= 1) continue; // ray slips through the retracted part
      textureX = shifted;
    }

    // Flip so textures are not mirrored on opposing faces.
    if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
      textureX = 1 - textureX;
    }

    return { hit: true, distance, tile, side, textureX, mapX, mapY };
  }

  return { hit: false, distance: maxDepth, tile: TILE.EMPTY, side, textureX: 0, mapX, mapY };
}

/**
 * Perpendicular distance for one screen column, avoiding fish-eye.
 * @param {number} column   screen x
 * @param {number} width    viewport width in px
 * @returns {number} camera-plane coordinate in [-1, 1]
 */
export const cameraX = (column, width) => (2 * column) / width - 1;
