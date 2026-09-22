import { DOOR } from '../core/constants.js';
import { clamp } from '../core/math.js';

/**
 * A sliding door occupying one tile.
 * `openness` 0 = shut, 1 = fully retracted into the frame.
 */
export class Door {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.openness = 0;
    this.targetOpen = false;
    this.holdMs = 0;
  }

  /** Doors are walk-through once mostly retracted. */
  isPassable() {
    return this.openness > 0.72;
  }

  /** Sight (and bullets) pass a little earlier than bodies do. */
  isTransparent() {
    return this.openness > 0.55;
  }

  open() {
    this.targetOpen = true;
    this.holdMs = DOOR.AUTO_CLOSE_MS;
  }

  update(dtSeconds) {
    if (this.targetOpen) {
      this.holdMs -= dtSeconds * 1000;
      if (this.holdMs <= 0) this.targetOpen = false;
    }
    const dir = this.targetOpen ? 1 : -1;
    this.openness = clamp(this.openness + dir * DOOR.OPEN_SPEED * dtSeconds, 0, 1);
  }
}
