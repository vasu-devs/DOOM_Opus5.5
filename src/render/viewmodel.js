import { WEAPON_ID } from '../core/constants.js';

/**
 * First-person weapon viewmodel, drawn with canvas primitives on top of the
 * upscaled scene.
 *
 * Bob, recoil kick, per-weapon fire animation and muzzle flash are all driven
 * by live weapon state, so the feel stays locked to the actual fire cooldown.
 * Everything is authored against a 300-unit-tall reference view and scaled to
 * the real canvas, so it looks identical at any resolution.
 */
export class Viewmodel {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.idlePhase = 0;
  }

  /** @param {number} dt seconds - advances the idle sway */
  update(dt) {
    this.idlePhase += dt * 1.6;
  }

  /**
   * @param {object} weapon  {id, recoil, flashMs, spin, fireAnim}
   * @param {number} bobX    horizontal bob in display px
   * @param {number} bobY    vertical bob in display px
   * @param {number} lowered 0 = raised, 1 = fully off screen (weapon switch)
   */
  draw(weapon, bobX, bobY, lowered = 0) {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const unit = h / 300;
    const fire = weapon.fireAnim ?? 0;

    // Idle sway keeps the weapon alive when standing still.
    const swayX = Math.sin(this.idlePhase) * 2.2 * unit;
    const swayY = Math.cos(this.idlePhase * 1.3) * 1.6 * unit;

    ctx.save();
    ctx.translate(
      w / 2 + bobX + swayX,
      h + bobY + swayY + lowered * h * 0.55 + weapon.recoil * 13 * unit
    );
    ctx.scale(unit, unit);

    switch (weapon.id) {
      case WEAPON_ID.SHOTGUN:
        this.#drawShotgun(ctx, fire);
        break;
      case WEAPON_ID.CHAINGUN:
        this.#drawChaingun(ctx, weapon.spin ?? 0, fire);
        break;
      case WEAPON_ID.LANCE:
        this.#drawLance(ctx, fire);
        break;
      default:
        this.#drawPistol(ctx, fire);
    }

    if (weapon.flashMs > 0) this.#drawMuzzleFlash(ctx, weapon);
    ctx.restore();
  }

  #drawPistol(ctx, fire) {
    const slide = fire * 9;                         // slide cycles back on firing
    ctx.fillStyle = '#4a3a2a';                      // grip
    ctx.beginPath();
    ctx.moveTo(-14, -36);
    ctx.lineTo(16, -36);
    ctx.lineTo(24, 18);
    ctx.lineTo(-6, 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a2d20';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(-9 + i, -30 + i * 12, 26, 2);

    ctx.fillStyle = '#20242a';                      // frame
    ctx.fillRect(-17, -62, 34, 28);
    ctx.fillStyle = '#272c34';                      // slide
    ctx.fillRect(-16, -80 + slide, 32, 22);
    ctx.fillStyle = '#171a1f';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(8 - i * 3, -78 + slide, 1.4, 18);
    ctx.fillStyle = '#12151a';                      // barrel
    ctx.fillRect(-6, -96 + slide * 0.4, 12, 20);
    ctx.fillStyle = 'rgba(255,220,170,0.10)';
    ctx.fillRect(-16, -80 + slide, 32, 2.5);

    if (fire > 0.35) {                              // ejected case
      ctx.fillStyle = '#e0a340';
      ctx.fillRect(18 + fire * 14, -70 + (1 - fire) * 26, 4, 7);
    }
  }

  #drawShotgun(ctx, fire) {
    const pump = fire > 0.5 ? (fire - 0.5) * 2 : 0; // pump slides back after the shot
    ctx.fillStyle = '#5a4632';                      // stock
    ctx.beginPath();
    ctx.moveTo(-18, -8);
    ctx.lineTo(22, -8);
    ctx.lineTo(34, 42);
    ctx.lineTo(-6, 42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#41321f';
    ctx.fillRect(-12, 6, 34, 3);

    ctx.fillStyle = '#31383f';                      // receiver
    ctx.fillRect(-23, -32, 46, 26);
    ctx.fillStyle = '#20262c';
    ctx.fillRect(-23, -32, 46, 4);

    ctx.fillStyle = '#1b1f24';                      // barrels
    ctx.fillRect(-21, -132, 19, 102);
    ctx.fillRect(2, -132, 19, 102);
    ctx.fillStyle = 'rgba(255,235,190,0.10)';
    ctx.fillRect(-21, -132, 19, 4);
    ctx.fillRect(2, -132, 19, 4);

    ctx.fillStyle = '#7d6a4c';                      // pump grip
    ctx.fillRect(-15, -58 + pump * 16, 30, 22);
    ctx.fillStyle = '#5d4e37';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(-15, -54 + pump * 16 + i * 5, 30, 2);

    if (pump > 0.2) {                               // ejected shells
      ctx.fillStyle = '#c94a28';
      ctx.fillRect(24 + pump * 16, -46 - pump * 12, 6, 11);
    }
  }

  #drawChaingun(ctx, spin, fire) {
    ctx.fillStyle = '#23272d';                      // housing
    ctx.fillRect(-32, -42, 64, 44);
    ctx.fillStyle = '#2f353c';
    ctx.fillRect(-32, -42, 64, 5);
    ctx.fillStyle = '#4a3a2a';                      // grip
    ctx.fillRect(-11, 0, 28, 42);

    ctx.save();                                     // spinning barrel cluster
    ctx.translate(0, -94);
    for (let i = 0; i < 6; i += 1) {
      const a = spin + (i * Math.PI * 2) / 6;
      const x = Math.cos(a) * 16;
      const depth = Math.sin(a) * 0.5 + 0.5;
      ctx.fillStyle = `rgb(${26 + depth * 62},${30 + depth * 62},${36 + depth * 64})`;
      ctx.fillRect(x - 5, -32, 10, 82);
    }
    ctx.restore();

    ctx.fillStyle = '#2f353c';                      // muzzle collar
    ctx.fillRect(-19, -110, 38, 17);
    ctx.fillStyle = '#e0a340';                      // ammo feed
    ctx.fillRect(-30, -38, 7, 7);
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = '#c4923a';
      ctx.fillRect(-44 - i * 7, -34 + Math.sin(spin + i) * 2, 6, 5);
    }

    if (fire > 0.3) {                               // spent brass
      ctx.fillStyle = '#e0a340';
      ctx.fillRect(26 + fire * 18, -60 + (1 - fire) * 30, 4, 6);
    }
  }

  #drawLance(ctx, fire) {
    const charge = 1 - fire;
    ctx.fillStyle = '#1e262c';                      // body
    ctx.fillRect(-26, -54, 52, 50);
    ctx.fillStyle = '#2b353d';
    ctx.fillRect(-26, -54, 52, 5);
    ctx.fillStyle = '#39454e';                      // grip
    ctx.fillRect(-10, -4, 26, 44);

    ctx.fillStyle = '#151c21';                      // emitter rails
    ctx.fillRect(-16, -120, 12, 68);
    ctx.fillRect(4, -120, 12, 68);

    // Coil glow rises back to full as the weapon recharges.
    for (let i = 0; i < 4; i += 1) {
      const level = Math.max(0, Math.min(1, charge * 4 - i));
      ctx.fillStyle = `rgba(79,214,196,${0.25 + level * 0.65})`;
      ctx.fillRect(-14, -66 - i * 13, 28, 6);
    }

    const arcAlpha = 0.35 + charge * 0.5;
    const grad = ctx.createRadialGradient(0, -122, 2, 0, -122, 22);
    grad.addColorStop(0, `rgba(230,255,251,${arcAlpha})`);
    grad.addColorStop(0.5, `rgba(79,214,196,${arcAlpha * 0.7})`);
    grad.addColorStop(1, 'rgba(79,214,196,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, -122, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  #drawMuzzleFlash(ctx, weapon) {
    const intensity = Math.min(1, weapon.flashMs / 80);
    const y = weapon.id === WEAPON_ID.SHOTGUN ? -134
      : weapon.id === WEAPON_ID.CHAINGUN ? -112
        : weapon.id === WEAPON_ID.LANCE ? -124 : -98;
    const r = (weapon.id === WEAPON_ID.SHOTGUN ? 52 : 38) * intensity;
    const warm = weapon.id === WEAPON_ID.LANCE;

    const grad = ctx.createRadialGradient(0, y, 2, 0, y, r);
    grad.addColorStop(0, `rgba(255,255,240,${0.95 * intensity})`);
    grad.addColorStop(0.4, warm
      ? `rgba(79,214,196,${0.75 * intensity})`
      : `rgba(255,172,60,${0.72 * intensity})`);
    grad.addColorStop(1, warm ? 'rgba(20,120,110,0)' : 'rgba(255,90,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Star spikes for a crisper flash.
    ctx.save();
    ctx.globalAlpha = intensity * 0.8;
    ctx.fillStyle = warm ? '#bdfff5' : '#ffe6a8';
    for (let i = 0; i < 4; i += 1) {
      ctx.save();
      ctx.translate(0, y);
      ctx.rotate((i * Math.PI) / 4 + 0.4);
      ctx.fillRect(-r * 0.95, -1.6, r * 1.9, 3.2);
      ctx.restore();
    }
    ctx.restore();
  }
}
