import { PLAYER, WEAPON_ID, WEAPONS, WEAPON_AMMO, AMMO_MAX } from '../core/constants.js';
import { clamp, normalizeAngle } from '../core/math.js';

/**
 * Player state: position, orientation, vitals, inventory and weapon handling.
 * Movement is applied through the Grid so collision stays authoritative.
 */
export class Player {
  constructor({ x, y, angle = 0 }) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.pitchOffset = 0;

    this.health = PLAYER.START_HEALTH;
    this.armor = 0;
    this.alive = true;

    this.ammo = { bullets: 50, shells: 0 };
    this.owned = new Set([WEAPON_ID.PISTOL]);
    this.weaponId = WEAPON_ID.PISTOL;

    this.cooldownMs = 0;
    this.recoil = 0;
    this.flashMs = 0;
    this.spin = 0;
    this.switchLowered = 0;
    this.pendingWeaponId = null;

    this.bobPhase = 0;
    this.bobAmount = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.damageTaken = 0;
  }

  get weapon() {
    return WEAPONS[this.weaponId];
  }

  get ammoType() {
    return WEAPON_AMMO[this.weaponId];
  }

  get currentAmmo() {
    return this.ammo[this.ammoType] ?? 0;
  }

  canFire() {
    return this.alive && this.cooldownMs <= 0 && this.switchLowered <= 0 && this.currentAmmo >= this.weapon.ammoPerShot;
  }

  /** Begin a weapon switch; the swap lands halfway through the lower animation. */
  selectWeapon(id) {
    if (!this.owned.has(id) || id === this.weaponId || this.pendingWeaponId === id) return false;
    this.pendingWeaponId = id;
    return true;
  }

  selectSlot(slot) {
    const match = Object.values(WEAPONS).find((w) => w.slot === slot);
    return match ? this.selectWeapon(match.id) : false;
  }

  /** Cycle to the next owned weapon (mouse wheel / Q). */
  cycleWeapon(direction = 1) {
    const order = Object.values(WEAPONS)
      .filter((w) => this.owned.has(w.id))
      .sort((a, b) => a.slot - b.slot);
    if (order.length < 2) return false;
    const idx = order.findIndex((w) => w.id === this.weaponId);
    const next = order[(idx + direction + order.length) % order.length];
    return this.selectWeapon(next.id);
  }

  giveWeapon(id) {
    const isNew = !this.owned.has(id);
    this.owned.add(id);
    if (isNew) this.selectWeapon(id);
    return isNew;
  }

  /** @returns {number} ammo actually added (respects per-type caps) */
  giveAmmo(type, amount) {
    const max = AMMO_MAX[type] ?? 0;
    const before = this.ammo[type] ?? 0;
    const after = clamp(before + amount, 0, max);
    this.ammo[type] = after;
    return after - before;
  }

  giveHealth(amount) {
    const before = this.health;
    this.health = clamp(this.health + amount, 0, PLAYER.MAX_HEALTH);
    return this.health - before;
  }

  giveArmor(amount) {
    const before = this.armor;
    this.armor = clamp(this.armor + amount, 0, PLAYER.MAX_ARMOR);
    return this.armor - before;
  }

  /**
   * Armor soaks a fixed fraction of incoming damage until it runs out.
   * @returns {number} damage actually applied to health
   */
  applyDamage(amount) {
    if (!this.alive || amount <= 0) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * PLAYER.ARMOR_ABSORB);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    const applied = Math.max(0, Math.round(remaining));
    this.health -= applied;
    this.damageTaken += applied;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return applied;
  }

  turn(delta) {
    this.angle = normalizeAngle(this.angle + delta);
  }

  /**
   * Move with wall sliding.
   * @param {import('../world/grid.js').Grid} grid
   * @param {number} forward  -1..1 along facing
   * @param {number} strafe   -1..1 perpendicular
   * @param {number} speed    tiles/second
   * @param {number} dt       seconds
   */
  move(grid, forward, strafe, speed, dt) {
    if (forward === 0 && strafe === 0) {
      this.bobAmount = Math.max(0, this.bobAmount - dt * 4);
      return;
    }
    const magnitude = Math.hypot(forward, strafe) || 1;
    const fx = forward / magnitude;
    const sx = strafe / magnitude;

    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const dx = (cos * fx - sin * sx) * speed * dt;
    const dy = (sin * fx + cos * sx) * speed * dt;

    const next = grid.resolveMove(this.x, this.y, this.x + dx, this.y + dy, PLAYER.RADIUS);
    this.x = next.x;
    this.y = next.y;

    this.bobPhase += dt * PLAYER.BOB_FREQUENCY * (speed / PLAYER.MOVE_SPEED);
    this.bobAmount = Math.min(1, this.bobAmount + dt * 5);
  }

  /** Per-frame timers: cooldowns, recoil decay, weapon switching. */
  update(dt) {
    const dtMs = dt * 1000;
    this.cooldownMs = Math.max(0, this.cooldownMs - dtMs);
    this.flashMs = Math.max(0, this.flashMs - dtMs);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    if (this.weaponId === WEAPON_ID.CHAINGUN) {
      const spinning = this.cooldownMs > 0 ? 18 : 3;
      this.spin = (this.spin + dt * spinning) % (Math.PI * 2);
    }

    if (this.pendingWeaponId) {
      this.switchLowered = Math.min(1, this.switchLowered + dt * 6);
      if (this.switchLowered >= 1) {
        this.weaponId = this.pendingWeaponId;
        this.pendingWeaponId = null;
      }
    } else if (this.switchLowered > 0) {
      this.switchLowered = Math.max(0, this.switchLowered - dt * 6);
    }
  }

  /** Called by the combat system when a shot is actually fired. */
  registerShot() {
    const weapon = this.weapon;
    this.ammo[this.ammoType] -= weapon.ammoPerShot;
    this.cooldownMs = weapon.cooldownMs;
    this.recoil = 1;
    this.flashMs = 70;
    this.shotsFired += 1;
  }

  bobOffsets() {
    const amp = PLAYER.BOB_AMPLITUDE * this.bobAmount;
    return {
      x: Math.cos(this.bobPhase) * amp * 1.6,
      y: Math.abs(Math.sin(this.bobPhase)) * amp,
    };
  }

  accuracy() {
    return this.shotsFired === 0 ? 0 : this.shotsHit / this.shotsFired;
  }
}
