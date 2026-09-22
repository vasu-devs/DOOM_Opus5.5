import { WEAPON_ID } from '../core/constants.js';

/**
 * First-person weapon viewmodel, drawn with canvas primitives on top of the
 * upscaled scene. Bob, recoil kick and muzzle flash are all driven by the
 * weapon state so the feel stays in sync with the actual fire cooldown.
 */
export class Viewmodel {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * @param {object} weapon  active weapon state ({id, recoil, flashMs, ...})
   * @param {number} bobX    horizontal bob in display px
   * @param {number} bobY    vertical bob in display px
   * @param {number} lowered 0 = raised, 1 = fully off screen (weapon switch)
   */
  draw(weapon, bobX, bobY, lowered = 0) {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const unit = h / 300; // scale relative to the internal viewport height

    ctx.save();
    ctx.translate(w / 2 + bobX, h + bobY + lowered * h * 0.5 + weapon.recoil * 14 * unit);
    ctx.scale(unit, unit);

    switch (weapon.id) {
      case WEAPON_ID.SHOTGUN:
        this.#drawShotgun(ctx);
        break;
      case WEAPON_ID.CHAINGUN:
        this.#drawChaingun(ctx, weapon.spin ?? 0);
        break;
      default:
        this.#drawPistol(ctx);
    }

    if (weapon.flashMs > 0) this.#drawMuzzleFlash(ctx, weapon);
    ctx.restore();
  }

  #drawPistol(ctx) {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-16, -78, 32, 44);      // slide
    ctx.fillStyle = '#2d333b';
    ctx.fillRect(-13, -74, 26, 12);
    ctx.fillStyle = '#12151a';
    ctx.fillRect(-7, -96, 14, 20);       // barrel shroud
    ctx.fillStyle = '#4a3a2a';
    ctx.beginPath();                      // grip
    ctx.moveTo(-14, -36);
    ctx.lineTo(16, -36);
    ctx.lineTo(24, 16);
    ctx.lineTo(-6, 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,170,0.09)';
    ctx.fillRect(-16, -78, 32, 3);
  }

  #drawShotgun(ctx) {
    ctx.fillStyle = '#1b1f24';
    ctx.fillRect(-20, -128, 18, 108);    // barrels
    ctx.fillRect(2, -128, 18, 108);
    ctx.fillStyle = '#31383f';
    ctx.fillRect(-22, -30, 44, 22);      // receiver
    ctx.fillStyle = '#5a4632';
    ctx.beginPath();                      // stock
    ctx.moveTo(-18, -8);
    ctx.lineTo(22, -8);
    ctx.lineTo(34, 40);
    ctx.lineTo(-6, 40);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7d6a4c';
    ctx.fillRect(-14, -54, 28, 22);      // pump
    ctx.fillStyle = 'rgba(255,230,180,0.10)';
    ctx.fillRect(-20, -128, 18, 4);
    ctx.fillRect(2, -128, 18, 4);
  }

  #drawChaingun(ctx, spin) {
    ctx.fillStyle = '#23272d';
    ctx.fillRect(-30, -40, 60, 40);      // housing
    ctx.save();
    ctx.translate(0, -92);
    for (let i = 0; i < 5; i += 1) {
      const a = spin + (i * Math.PI * 2) / 5;
      const x = Math.cos(a) * 15;
      const depth = Math.sin(a) * 0.5 + 0.5;
      ctx.fillStyle = `rgb(${28 + depth * 60},${32 + depth * 60},${38 + depth * 62})`;
      ctx.fillRect(x - 5, -30, 10, 78);
    }
    ctx.restore();
    ctx.fillStyle = '#2f353c';
    ctx.fillRect(-18, -104, 36, 16);     // muzzle collar
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(-10, 0, 26, 40);        // grip
    ctx.fillStyle = '#e0a340';
    ctx.fillRect(-28, -36, 6, 6);        // ammo feed detail
  }

  #drawMuzzleFlash(ctx, weapon) {
    const intensity = Math.min(1, weapon.flashMs / 70);
    const y = weapon.id === WEAPON_ID.SHOTGUN ? -128 : weapon.id === WEAPON_ID.CHAINGUN ? -108 : -96;
    const r = (weapon.id === WEAPON_ID.SHOTGUN ? 46 : 34) * intensity;
    const grad = ctx.createRadialGradient(0, y, 2, 0, y, r);
    grad.addColorStop(0, `rgba(255,248,214,${0.95 * intensity})`);
    grad.addColorStop(0.4, `rgba(255,170,60,${0.72 * intensity})`);
    grad.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
