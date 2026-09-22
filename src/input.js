import { PLAYER } from './core/constants.js';
import { CODES } from './core/logger.js';

/**
 * @typedef {object} Intent
 * @property {number} forward   -1..1
 * @property {number} strafe    -1..1
 * @property {number} turn      -1..1 (keyboard turning, scaled by TURN_SPEED)
 * @property {number} turnDelta radians applied directly (mouse / agent)
 * @property {number} lookDelta vertical look applied directly
 * @property {boolean} fire
 * @property {boolean} use
 * @property {boolean} run
 * @property {number} weaponSlot 0 = no change
 * @property {number} cycleWeapon -1 | 0 | 1
 */

const KEY_BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  strafeLeft: ['KeyA'],
  strafeRight: ['KeyD'],
  turnLeft: ['ArrowLeft'],
  turnRight: ['ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  fire: ['Space', 'ControlLeft'],
  use: ['KeyE', 'KeyF'],
});

/** Vertical look is a fraction of horizontal sensitivity - it is a nudge, not a flick. */
const LOOK_RATIO = 0.65;

/**
 * Translates keyboard, mouse and touch into a frame Intent.
 * The autoplay agent emits the same shape, so nothing downstream needs to know
 * who is driving.
 */
export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{logger: import('./core/logger.js').Logger,
   *          onCommand: (cmd: string) => void,
   *          settings: import('./core/settings.js').Settings}} deps
   */
  constructor(canvas, { logger, onCommand, settings }) {
    this.canvas = canvas;
    this.logger = logger;
    this.onCommand = onCommand;
    this.settings = settings;

    this.keys = new Set();
    this.mouseDown = false;
    this.pendingTurn = 0;
    this.pendingLook = 0;
    this.pendingSlot = 0;
    this.pendingCycle = 0;
    this.pointerLocked = false;
    this.touch = { forward: 0, strafe: 0, turn: 0, fire: false };
    this.disposers = [];

    this.#bindKeyboard();
    this.#bindMouse();
  }

  #on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.disposers.push(() => target.removeEventListener(type, handler, options));
  }

  #bindKeyboard() {
    this.#on(window, 'keydown', (event) => {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      this.keys.add(event.code);

      if (event.code >= 'Digit1' && event.code <= 'Digit4') {
        this.pendingSlot = Number(event.code.slice(5));
      }
      switch (event.code) {
        case 'KeyQ': this.pendingCycle = 1; break;
        case 'KeyP': this.onCommand('toggleAutoplay'); break;
        case 'KeyM': this.onCommand('toggleMute'); break;
        case 'KeyO': this.onCommand('toggleSettings'); break;
        case 'KeyF': this.onCommand('toggleFullscreen'); break;
        case 'Escape': this.onCommand('pause'); break;
        case 'Enter': this.onCommand('confirm'); break;
        case 'KeyR': this.onCommand('restart'); break;
        case 'Tab': this.onCommand('toggleMap'); event.preventDefault(); break;
        default: break;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
    });

    this.#on(window, 'keyup', (event) => this.keys.delete(event.code));
    this.#on(window, 'blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
  }

  #bindMouse() {
    this.#on(this.canvas, 'mousedown', (event) => {
      if (event.button === 0) this.mouseDown = true;
      if (event.button === 2) this.onCommand('use');
    });
    this.#on(window, 'mouseup', (event) => {
      if (event.button === 0) this.mouseDown = false;
    });
    this.#on(this.canvas, 'contextmenu', (event) => event.preventDefault());

    this.#on(window, 'mousemove', (event) => {
      if (!this.pointerLocked) return;
      const sensitivity = this.settings.mouseSensitivity();
      // Guard against the huge movementX spikes some browsers emit on lock.
      const dx = Math.max(-200, Math.min(200, event.movementX || 0));
      const dy = Math.max(-200, Math.min(200, event.movementY || 0));
      this.pendingTurn += dx * sensitivity;
      const invert = this.settings.get('invertY') ? -1 : 1;
      this.pendingLook -= dy * sensitivity * LOOK_RATIO * invert;
    });

    this.#on(this.canvas, 'wheel', (event) => {
      this.pendingCycle = event.deltaY > 0 ? 1 : -1;
      event.preventDefault();
    }, { passive: false });

    this.#on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // Discard anything queued during the transition.
      this.pendingTurn = 0;
      this.pendingLook = 0;
      this.onCommand(this.pointerLocked ? 'pointerLocked' : 'pointerUnlocked');
    });
  }

  requestPointerLock() {
    try {
      this.canvas.requestPointerLock?.();
    } catch (error) {
      this.logger.warn(CODES.POINTER_LOCK_FAILED, 'pointer lock refused', { reason: error?.name });
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  #anyKey(codes) {
    return codes.some((code) => this.keys.has(code));
  }

  /** @returns {Intent} the intent for this frame (consumes one-shot inputs) */
  poll() {
    const forwardKey = (this.#anyKey(KEY_BINDINGS.forward) ? 1 : 0) - (this.#anyKey(KEY_BINDINGS.back) ? 1 : 0);
    const strafeKey = (this.#anyKey(KEY_BINDINGS.strafeRight) ? 1 : 0) - (this.#anyKey(KEY_BINDINGS.strafeLeft) ? 1 : 0);
    const turnKey = (this.#anyKey(KEY_BINDINGS.turnRight) ? 1 : 0) - (this.#anyKey(KEY_BINDINGS.turnLeft) ? 1 : 0);

    const intent = {
      forward: clampAxis(forwardKey + this.touch.forward),
      strafe: clampAxis(strafeKey + this.touch.strafe),
      turn: clampAxis(turnKey + this.touch.turn),
      turnDelta: this.pendingTurn,
      lookDelta: this.pendingLook,
      fire: this.mouseDown || this.#anyKey(KEY_BINDINGS.fire) || this.touch.fire,
      use: this.#anyKey(KEY_BINDINGS.use),
      run: this.#anyKey(KEY_BINDINGS.run),
      weaponSlot: this.pendingSlot,
      cycleWeapon: this.pendingCycle,
    };

    this.pendingTurn = 0;
    this.pendingLook = 0;
    this.pendingSlot = 0;
    this.pendingCycle = 0;
    return intent;
  }

  /** Touch controls call this from the on-screen pad. */
  setTouchAxis(axis, value) {
    this.touch[axis] = value;
  }

  dispose() {
    for (const off of this.disposers) off();
    this.disposers = [];
  }
}

const clampAxis = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

/** Neutral intent - used while paused, dead or on the menu. */
export const IDLE_INTENT = Object.freeze({
  forward: 0, strafe: 0, turn: 0, turnDelta: 0, lookDelta: 0,
  fire: false, use: false, run: false, weaponSlot: 0, cycleWeapon: 0,
});

/** Default sensitivity in radians-per-pixel, exported for the settings UI. */
export const BASE_SENSITIVITY = PLAYER.MOUSE_SENSITIVITY;
