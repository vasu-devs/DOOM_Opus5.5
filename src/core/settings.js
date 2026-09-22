import { SETTINGS_DEFAULTS, SENSITIVITY_RANGE, PLAYER, DIFFICULTY } from './constants.js';
import { clamp } from './math.js';

const STORAGE_KEY = 'descent-protocol.settings.v1';

/**
 * User settings with localStorage persistence.
 *
 * Storage is best-effort: private browsing, disabled storage or a corrupt blob
 * all degrade to defaults rather than breaking the boot. Subscribers are
 * notified on every change so the renderer/audio/input can react live.
 */
export class Settings {
  /** @param {{logger?: import('./logger.js').Logger, storage?: Storage}} deps */
  constructor({ logger = null, storage = undefined } = {}) {
    this.logger = logger;
    this.storage = storage ?? safeStorage();
    this.values = { ...SETTINGS_DEFAULTS, ...this.#load() };
    this.listeners = new Set();
  }

  #load() {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      // Only accept keys we know about, with the right primitive type.
      const clean = {};
      for (const [key, fallback] of Object.entries(SETTINGS_DEFAULTS)) {
        if (key in parsed && typeof parsed[key] === typeof fallback) clean[key] = parsed[key];
      }
      return clean;
    } catch {
      return {};
    }
  }

  #persist() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* quota or blocked storage: settings stay session-only */
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!(key in SETTINGS_DEFAULTS)) return false;
    if (this.values[key] === value) return false;
    this.values[key] = value;
    this.#persist();
    for (const listener of this.listeners) listener(key, value, this);
    return true;
  }

  reset() {
    this.values = { ...SETTINGS_DEFAULTS };
    this.#persist();
    for (const listener of this.listeners) listener('*', null, this);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* --------------------------- derived values ---------------------------- */

  /** Radians of yaw per pixel of mouse travel. */
  mouseSensitivity() {
    const t = clamp(this.values.sensitivity, 0, 1);
    const multiplier = SENSITIVITY_RANGE.min + (SENSITIVITY_RANGE.max - SENSITIVITY_RANGE.min) * t;
    return PLAYER.MOUSE_SENSITIVITY * multiplier;
  }

  difficulty() {
    return DIFFICULTY[this.values.difficulty] ?? DIFFICULTY.NORMAL;
  }

  isAutoQuality() {
    return this.values.quality === 'auto';
  }

  qualityIndex(fallback) {
    const parsed = Number.parseInt(this.values.quality, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__descent_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
