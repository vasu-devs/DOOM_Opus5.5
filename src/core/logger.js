import { LOG_LEVEL } from './constants.js';

/**
 * Structured logger with stable error codes.
 * Never logs payloads, source or secrets - only a code, a message and a small
 * whitelist-shaped context object.
 */
export class Logger {
  constructor(scope, level = LOG_LEVEL.INFO, sink = console) {
    this.scope = scope;
    this.level = level;
    this.sink = sink;
  }

  child(scope) {
    return new Logger(`${this.scope}:${scope}`, this.level, this.sink);
  }

  #emit(levelValue, method, code, message, context) {
    if (levelValue < this.level) return;
    const entry = { ts: new Date().toISOString(), scope: this.scope, code, message };
    if (context && typeof context === 'object') entry.context = context;
    this.sink[method](JSON.stringify(entry));
  }

  debug(code, message, context) { this.#emit(LOG_LEVEL.DEBUG, 'debug', code, message, context); }
  info(code, message, context) { this.#emit(LOG_LEVEL.INFO, 'info', code, message, context); }
  warn(code, message, context) { this.#emit(LOG_LEVEL.WARN, 'warn', code, message, context); }
  error(code, message, context) { this.#emit(LOG_LEVEL.ERROR, 'error', code, message, context); }
}

/** Stable error/event codes. Grep-able, safe to surface to users. */
export const CODES = Object.freeze({
  BOOT_OK: 'E_BOOT_OK',
  BOOT_FAILED: 'E_BOOT_FAILED',
  CANVAS_MISSING: 'E_CANVAS_MISSING',
  LEVEL_LOADED: 'E_LEVEL_LOADED',
  LEVEL_INVALID: 'E_LEVEL_INVALID',
  LEVEL_CLEARED: 'E_LEVEL_CLEARED',
  PLAYER_DIED: 'E_PLAYER_DIED',
  AUDIO_UNAVAILABLE: 'E_AUDIO_UNAVAILABLE',
  AGENT_ENABLED: 'E_AGENT_ENABLED',
  AGENT_DISABLED: 'E_AGENT_DISABLED',
  AGENT_UNSTUCK: 'E_AGENT_UNSTUCK',
  AGENT_PATH_FAILED: 'E_AGENT_PATH_FAILED',
  LOOP_ERROR: 'E_LOOP_ERROR',
  POINTER_LOCK_FAILED: 'E_POINTER_LOCK_FAILED',
});
