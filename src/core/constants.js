/**
 * Centralized configuration. No magic numbers elsewhere in the codebase.
 * All tuning for the engine, combat and the autoplay agent lives here.
 */

export const TILE = Object.freeze({
  EMPTY: 0,
  WALL_BRICK: 1,
  WALL_PANEL: 2,
  WALL_TECH: 3,
  WALL_FLESH: 4,
  DOOR: 5,
  EXIT: 6,
});

/** Tiles the player / enemies cannot walk through (doors handled separately). */
export const SOLID_TILES = Object.freeze(
  new Set([TILE.WALL_BRICK, TILE.WALL_PANEL, TILE.WALL_TECH, TILE.WALL_FLESH, TILE.DOOR])
);

export const RENDER = Object.freeze({
  INTERNAL_WIDTH: 480,
  INTERNAL_HEIGHT: 300,
  FOV: Math.PI / 3,
  MAX_DEPTH: 32,
  TEXTURE_SIZE: 64,
  FOG_START: 3.0,
  FOG_END: 15.0,
  MUZZLE_FLASH_MS: 70,
});

export const PLAYER = Object.freeze({
  RADIUS: 0.22,
  MOVE_SPEED: 3.1,
  RUN_MULTIPLIER: 1.6,
  TURN_SPEED: 2.6,
  MOUSE_SENSITIVITY: 0.0026,
  MAX_HEALTH: 100,
  MAX_ARMOR: 100,
  START_HEALTH: 100,
  ARMOR_ABSORB: 0.4,
  PAIN_FLASH_MS: 220,
  BOB_FREQUENCY: 9.5,
  BOB_AMPLITUDE: 2.4,
});

export const WEAPON_ID = Object.freeze({
  PISTOL: 'pistol',
  SHOTGUN: 'shotgun',
  CHAINGUN: 'chaingun',
});

/** Weapon table: cooldowns in ms, spread in radians, range in tiles. */
export const WEAPONS = Object.freeze({
  [WEAPON_ID.PISTOL]: Object.freeze({
    id: WEAPON_ID.PISTOL, name: 'SIDEARM', slot: 1, damage: 14, pellets: 1,
    spread: 0.012, cooldownMs: 320, range: 22, ammoPerShot: 1, noise: 9, auto: false,
  }),
  [WEAPON_ID.SHOTGUN]: Object.freeze({
    id: WEAPON_ID.SHOTGUN, name: 'BREACHER', slot: 2, damage: 11, pellets: 7,
    spread: 0.14, cooldownMs: 820, range: 14, ammoPerShot: 1, noise: 16, auto: false,
  }),
  [WEAPON_ID.CHAINGUN]: Object.freeze({
    id: WEAPON_ID.CHAINGUN, name: 'RIPPER', slot: 3, damage: 9, pellets: 1,
    spread: 0.055, cooldownMs: 95, range: 20, ammoPerShot: 1, noise: 12, auto: true,
  }),
});

export const AMMO_MAX = Object.freeze({ bullets: 200, shells: 50 });

/** Which ammo pool each weapon draws from. */
export const WEAPON_AMMO = Object.freeze({
  [WEAPON_ID.PISTOL]: 'bullets',
  [WEAPON_ID.SHOTGUN]: 'shells',
  [WEAPON_ID.CHAINGUN]: 'bullets',
});

export const ENEMY_ID = Object.freeze({
  GRUNT: 'grunt',
  HOUND: 'hound',
  BRUTE: 'brute',
});

export const ENEMIES = Object.freeze({
  [ENEMY_ID.GRUNT]: Object.freeze({
    id: ENEMY_ID.GRUNT, name: 'HUSK', health: 30, speed: 1.35, radius: 0.28,
    damage: 7, attackCooldownMs: 1100, attackRange: 12, preferredRange: 5,
    accuracy: 0.55, sightRange: 18, score: 100, height: 1.0, ranged: true,
  }),
  [ENEMY_ID.HOUND]: Object.freeze({
    id: ENEMY_ID.HOUND, name: 'RIPPER-HOUND', health: 22, speed: 2.55, radius: 0.26,
    damage: 9, attackCooldownMs: 700, attackRange: 1.15, preferredRange: 0.7,
    accuracy: 0.95, sightRange: 16, score: 120, height: 0.62, ranged: false,
  }),
  [ENEMY_ID.BRUTE]: Object.freeze({
    id: ENEMY_ID.BRUTE, name: 'CINDER-BRUTE', health: 85, speed: 1.15, radius: 0.36,
    damage: 16, attackCooldownMs: 1500, attackRange: 10, preferredRange: 4,
    accuracy: 0.45, sightRange: 20, score: 300, height: 1.22, ranged: true,
  }),
});

export const PICKUP = Object.freeze({
  MEDKIT: 'medkit',
  ARMOR: 'armor',
  BULLETS: 'bullets',
  SHELLS: 'shells',
  SHOTGUN: 'shotgun',
  CHAINGUN: 'chaingun',
});

export const PICKUP_TABLE = Object.freeze({
  [PICKUP.MEDKIT]: Object.freeze({ id: PICKUP.MEDKIT, label: 'MEDKIT', health: 25, color: '#57d06a' }),
  [PICKUP.ARMOR]: Object.freeze({ id: PICKUP.ARMOR, label: 'PLATING', armor: 30, color: '#4aa3e0' }),
  [PICKUP.BULLETS]: Object.freeze({ id: PICKUP.BULLETS, label: 'BULLETS', ammo: { bullets: 25 }, color: '#e0a340' }),
  [PICKUP.SHELLS]: Object.freeze({ id: PICKUP.SHELLS, label: 'SHELLS', ammo: { shells: 8 }, color: '#d8552f' }),
  [PICKUP.SHOTGUN]: Object.freeze({ id: PICKUP.SHOTGUN, label: 'BREACHER', weapon: WEAPON_ID.SHOTGUN, ammo: { shells: 8 }, color: '#d8cfc0' }),
  [PICKUP.CHAINGUN]: Object.freeze({ id: PICKUP.CHAINGUN, label: 'RIPPER', weapon: WEAPON_ID.CHAINGUN, ammo: { bullets: 50 }, color: '#d8cfc0' }),
});

export const PICKUP_RADIUS = 0.42;

export const DOOR = Object.freeze({
  OPEN_SPEED: 1.8,       // fraction per second
  AUTO_CLOSE_MS: 4200,
  USE_RANGE: 1.6,
});

export const AGENT = Object.freeze({
  /** Agent "thinks" at a fixed rate; movement is interpolated every frame. */
  THINK_INTERVAL_MS: 90,
  TURN_SPEED: 4.4,
  AIM_TOLERANCE: 0.09,
  FIRE_TOLERANCE: 0.14,
  ENGAGE_RANGE: 16,
  STRAFE_PERIOD_MS: 900,
  STUCK_EPSILON: 0.035,
  STUCK_FRAMES: 14,
  LOW_HEALTH: 45,
  CRITICAL_HEALTH: 25,
  WAYPOINT_EPSILON: 0.3,
  RETREAT_DISTANCE: 3.2,
});

export const AUDIO = Object.freeze({
  MASTER_GAIN: 0.22,
});

export const GAME_STATE = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DEAD: 'dead',
  LEVEL_CLEARED: 'level_cleared',
  VICTORY: 'victory',
});

export const LOG_LEVEL = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });
