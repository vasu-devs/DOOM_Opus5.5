/**
 * Centralized configuration. No magic numbers elsewhere in the codebase.
 * All tuning for the engine, combat, presentation and the autoplay agent
 * lives here.
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
  FOV: Math.PI / 3,
  MAX_DEPTH: 34,
  TEXTURE_SIZE: 128,
  SPRITE_SIZE: 128,
  FOG_START: 2.5,
  FOG_END: 17.0,
  MUZZLE_FLASH_MS: 80,
  /** Vertical look range in pixels of horizon shift. */
  MAX_PITCH: 220,
});

/**
 * Internal render heights. The software renderer scales its pixel buffer to
 * the window aspect, so only the height is a preset; AUTO watches frame time
 * and walks the ladder to hold the target frame rate.
 */
export const QUALITY = Object.freeze({
  LADDER: Object.freeze([300, 400, 520, 660, 820, 1000]),
  /**
   * Start mid-ladder and climb. Booting a rung low and stepping up feels far
   * better than opening sharp and stuttering down on weaker hardware.
   */
  DEFAULT_INDEX: 2,
  AUTO_TARGET_MS: 11.0,      // sustained better than this: take a rung up
  AUTO_DOWN_MS: 15.5,        // sustained worse than this: drop a rung
  AUTO_SAMPLE_FRAMES: 30,
  MAX_BUFFER_PIXELS: 2_400_000,
});

export const PLAYER = Object.freeze({
  RADIUS: 0.22,
  MOVE_SPEED: 3.25,
  RUN_MULTIPLIER: 1.62,
  ACCELERATION: 18,          // tiles/s^2 toward the wish vector
  FRICTION: 12,
  TURN_SPEED: 2.4,
  MOUSE_SENSITIVITY: 0.00085, // calmer default; tunable in Settings
  MAX_HEALTH: 100,
  MAX_ARMOR: 100,
  START_HEALTH: 100,
  ARMOR_ABSORB: 0.4,
  PAIN_FLASH_MS: 220,
  BOB_FREQUENCY: 9.2,
  BOB_AMPLITUDE: 3.4,
  LAND_DIP: 5,
  STEP_INTERVAL: Math.PI,    // one footstep per half bob cycle
});

export const WEAPON_ID = Object.freeze({
  PISTOL: 'pistol',
  SHOTGUN: 'shotgun',
  CHAINGUN: 'chaingun',
  LANCE: 'lance',
});

/**
 * Weapon table. Cooldowns in ms, spread in radians, range in tiles.
 * `kind` picks the resolution path: hitscan pellets or a travelling bolt.
 */
export const WEAPONS = Object.freeze({
  [WEAPON_ID.PISTOL]: Object.freeze({
    id: WEAPON_ID.PISTOL, name: 'SIDEARM', slot: 1, kind: 'hitscan',
    damage: 15, pellets: 1, spread: 0.010, cooldownMs: 300, range: 24,
    ammoPerShot: 1, noise: 9, auto: false, kick: 1.0, shake: 0.5,
  }),
  [WEAPON_ID.SHOTGUN]: Object.freeze({
    id: WEAPON_ID.SHOTGUN, name: 'BREACHER', slot: 2, kind: 'hitscan',
    damage: 12, pellets: 8, spread: 0.135, cooldownMs: 780, range: 15,
    ammoPerShot: 1, noise: 16, auto: false, kick: 2.4, shake: 1.6,
  }),
  [WEAPON_ID.CHAINGUN]: Object.freeze({
    id: WEAPON_ID.CHAINGUN, name: 'RIPPER', slot: 3, kind: 'hitscan',
    damage: 9, pellets: 1, spread: 0.048, cooldownMs: 88, range: 22,
    ammoPerShot: 1, noise: 12, auto: true, kick: 0.6, shake: 0.35,
  }),
  [WEAPON_ID.LANCE]: Object.freeze({
    id: WEAPON_ID.LANCE, name: 'ARC LANCE', slot: 4, kind: 'bolt',
    damage: 26, pellets: 1, spread: 0.02, cooldownMs: 210, range: 26,
    ammoPerShot: 1, noise: 14, auto: true, kick: 1.1, shake: 0.6,
    boltSpeed: 15, splashRadius: 1.15, splashDamage: 12,
  }),
});

export const AMMO_MAX = Object.freeze({ bullets: 250, shells: 60, cells: 150 });

/** Which ammo pool each weapon draws from. */
export const WEAPON_AMMO = Object.freeze({
  [WEAPON_ID.PISTOL]: 'bullets',
  [WEAPON_ID.SHOTGUN]: 'shells',
  [WEAPON_ID.CHAINGUN]: 'bullets',
  [WEAPON_ID.LANCE]: 'cells',
});

export const ENEMY_ID = Object.freeze({
  GRUNT: 'grunt',
  HOUND: 'hound',
  BRUTE: 'brute',
  WRAITH: 'wraith',
});

export const ENEMIES = Object.freeze({
  [ENEMY_ID.GRUNT]: Object.freeze({
    id: ENEMY_ID.GRUNT, name: 'HUSK', health: 32, speed: 1.4, radius: 0.28,
    damage: 7, attackCooldownMs: 1150, attackRange: 12, preferredRange: 5,
    accuracy: 0.55, sightRange: 18, score: 100, height: 1.0, ranged: true,
    windupMs: 260, bloodColor: '#8a1a1a',
  }),
  [ENEMY_ID.HOUND]: Object.freeze({
    id: ENEMY_ID.HOUND, name: 'RIPPER-HOUND', health: 24, speed: 2.7, radius: 0.26,
    damage: 9, attackCooldownMs: 680, attackRange: 1.2, preferredRange: 0.7,
    accuracy: 0.95, sightRange: 16, score: 120, height: 0.62, ranged: false,
    windupMs: 170, bloodColor: '#8a1a1a',
  }),
  [ENEMY_ID.BRUTE]: Object.freeze({
    id: ENEMY_ID.BRUTE, name: 'CINDER-BRUTE', health: 92, speed: 1.2, radius: 0.36,
    damage: 17, attackCooldownMs: 1500, attackRange: 11, preferredRange: 4.5,
    accuracy: 0.48, sightRange: 20, score: 300, height: 1.24, ranged: true,
    windupMs: 400, bloodColor: '#b23a12',
  }),
  [ENEMY_ID.WRAITH]: Object.freeze({
    id: ENEMY_ID.WRAITH, name: 'SLAG-WRAITH', health: 46, speed: 2.0, radius: 0.28,
    damage: 12, attackCooldownMs: 900, attackRange: 14, preferredRange: 7,
    accuracy: 0.7, sightRange: 22, score: 220, height: 1.1, ranged: true,
    windupMs: 300, bloodColor: '#3ad1b0', emissive: 0.35,
  }),
});

/** Difficulty scales the fight, never the player's own numbers. */
export const DIFFICULTY = Object.freeze({
  EASY: Object.freeze({ id: 'EASY', label: 'SALVAGE RUN', damageTaken: 0.6, enemyHealth: 0.85, enemyAccuracy: 0.8, enemyCooldown: 1.25 }),
  NORMAL: Object.freeze({ id: 'NORMAL', label: 'DESCENT', damageTaken: 1, enemyHealth: 1, enemyAccuracy: 1, enemyCooldown: 1 }),
  HARD: Object.freeze({ id: 'HARD', label: 'FURNACE RUN', damageTaken: 1.45, enemyHealth: 1.2, enemyAccuracy: 1.2, enemyCooldown: 0.78 }),
});

export const PICKUP = Object.freeze({
  MEDKIT: 'medkit',
  ARMOR: 'armor',
  BULLETS: 'bullets',
  SHELLS: 'shells',
  CELLS: 'cells',
  SHOTGUN: 'shotgun',
  CHAINGUN: 'chaingun',
  LANCE: 'lance',
});

export const PICKUP_TABLE = Object.freeze({
  [PICKUP.MEDKIT]: Object.freeze({ id: PICKUP.MEDKIT, label: 'MEDKIT', health: 25, color: '#57d06a' }),
  [PICKUP.ARMOR]: Object.freeze({ id: PICKUP.ARMOR, label: 'PLATING', armor: 30, color: '#4aa3e0' }),
  [PICKUP.BULLETS]: Object.freeze({ id: PICKUP.BULLETS, label: 'BULLETS', ammo: { bullets: 28 }, color: '#e0a340' }),
  [PICKUP.SHELLS]: Object.freeze({ id: PICKUP.SHELLS, label: 'SHELLS', ammo: { shells: 9 }, color: '#d8552f' }),
  [PICKUP.CELLS]: Object.freeze({ id: PICKUP.CELLS, label: 'CELLS', ammo: { cells: 24 }, color: '#4fd6c4' }),
  [PICKUP.SHOTGUN]: Object.freeze({ id: PICKUP.SHOTGUN, label: 'BREACHER', weapon: WEAPON_ID.SHOTGUN, ammo: { shells: 9 }, color: '#d8cfc0' }),
  [PICKUP.CHAINGUN]: Object.freeze({ id: PICKUP.CHAINGUN, label: 'RIPPER', weapon: WEAPON_ID.CHAINGUN, ammo: { bullets: 55 }, color: '#d8cfc0' }),
  [PICKUP.LANCE]: Object.freeze({ id: PICKUP.LANCE, label: 'ARC LANCE', weapon: WEAPON_ID.LANCE, ammo: { cells: 40 }, color: '#4fd6c4' }),
});

export const PICKUP_RADIUS = 0.45;

export const DOOR = Object.freeze({
  OPEN_SPEED: 1.9,
  AUTO_CLOSE_MS: 4600,
  USE_RANGE: 1.7,
});

/** Wall-mounted torches: flicker light plus an animated flame sprite. */
export const LIGHT = Object.freeze({
  TORCH_RADIUS: 6.5,
  TORCH_INTENSITY: 0.85,
  FLICKER_SPEED: 11,
  FLICKER_DEPTH: 0.22,
  MAX_ACTIVE: 6,
});

export const PARTICLES = Object.freeze({
  MAX: 320,
  BLOOD_PER_HIT: 7,
  SPARK_PER_HIT: 5,
  GRAVITY: 3.1,
  LIFETIME: 0.85,
});

export const AGENT = Object.freeze({
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
  MASTER_GAIN: 0.26,
  MUSIC_GAIN: 0.16,
  /** Sounds fade out past this many tiles. */
  FALLOFF_RANGE: 16,
  STEP_GAIN: 0.22,
});

export const GAME_STATE = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DEAD: 'dead',
  LEVEL_CLEARED: 'level_cleared',
  VICTORY: 'victory',
});

/** Defaults for user-tunable settings (persisted in localStorage). */
export const SETTINGS_DEFAULTS = Object.freeze({
  sensitivity: 0.5,        // 0..1 slider -> scaled against PLAYER.MOUSE_SENSITIVITY
  quality: 'auto',         // 'auto' | ladder index as string
  sfxVolume: 0.8,
  musicVolume: 0.5,
  difficulty: 'NORMAL',
  showMinimap: true,
  invertY: false,
  viewBob: true,
});

/** Slider 0..1 maps onto this multiplier range around the base sensitivity. */
export const SENSITIVITY_RANGE = Object.freeze({ min: 0.25, max: 3.0 });

export const LOG_LEVEL = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 });
