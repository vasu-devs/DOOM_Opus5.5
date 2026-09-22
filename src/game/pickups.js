import { PICKUP_TABLE, PICKUP_RADIUS } from '../core/constants.js';

/**
 * A floor item. Items are only consumed when they would actually help
 * (a full-health player walks over a medkit and leaves it for later).
 */
export class Pickup {
  constructor(type, x, y) {
    const def = PICKUP_TABLE[type];
    if (!def) throw new TypeError(`Unknown pickup type: ${type}`);
    this.def = def;
    this.type = type;
    this.x = x;
    this.y = y;
    this.taken = false;
    this.bobPhase = (x * 3.7 + y * 2.3) % (Math.PI * 2);
  }

  /** True when the player would gain something from this item right now. */
  isUsefulTo(player) {
    const { def } = this;
    if (def.weapon && !player.owned.has(def.weapon)) return true;
    if (def.health && player.health < 100) return true;
    if (def.armor && player.armor < 100) return true;
    if (def.ammo) {
      for (const [type, amount] of Object.entries(def.ammo)) {
        if (amount > 0 && (player.ammo[type] ?? 0) < (type === 'shells' ? 50 : 200)) return true;
      }
    }
    return false;
  }

  /**
   * Apply the item to the player.
   * @returns {{taken: boolean, messages: string[]}}
   */
  collect(player) {
    if (this.taken || !this.isUsefulTo(player)) return { taken: false, messages: [] };
    const { def } = this;
    const messages = [];

    if (def.weapon && player.giveWeapon(def.weapon)) messages.push(`${def.label} ACQUIRED`);
    if (def.health) {
      const gained = player.giveHealth(def.health);
      if (gained > 0) messages.push(`+${gained} VITALS`);
    }
    if (def.armor) {
      const gained = player.giveArmor(def.armor);
      if (gained > 0) messages.push(`+${gained} PLATING`);
    }
    if (def.ammo) {
      for (const [type, amount] of Object.entries(def.ammo)) {
        const gained = player.giveAmmo(type, amount);
        if (gained > 0) messages.push(`+${gained} ${type.toUpperCase()}`);
      }
    }

    this.taken = true;
    return { taken: true, messages };
  }

  distanceTo(x, y) {
    return Math.hypot(this.x - x, this.y - y);
  }

  touches(x, y) {
    return this.distanceTo(x, y) <= PICKUP_RADIUS;
  }
}
