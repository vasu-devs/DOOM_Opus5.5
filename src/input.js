import { PLAYER } from './core/constants.js';
import { CODES } from './core/logger.js';

/**
 * @typedef {object} Intent
 * @property {number} forward   -1..1
 * @property {number} strafe    -1..1
 * @property {number} turn      -1..1 (keyboard turning, scaled by TURN_SPEED)
 * @property {number} turnDelta radians applied directly (mouse / agent)
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

/**
 * Translates keyboard, mouse and touch into a frame Intent.
 * The autoplay agent emits the same shape, so nothing downstream needs to know
 * who is driving.
 */
export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{logger: import('./core/logger.js').Logger, onCommand: (cmd: string) => void}} deps
   */
  constructor(canvas, { logger, onCommand }) {
    this.canvas = canvas;
    this.logger = logger;
    this.onCommand = onCommand;
    this.keys = new Set();
    this.mouseDown = false;
    this.pendingTurn = 0;
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

      if (event.code >= 'Digit1' && event.code <= 'Digit3') {
        this.pendingSlot = Number(event.code.slice(5));
      }
      switch (event.code) {
        case 'KeyQ': this.pendingCycle = 1; break;
        case 'KeyP': this.onCommand('toggleAutoplay'); break;
        case 'KeyM': this.onCommand('toggleMute'); break;
        case 'Escape': this.onCommand('pause'); break;
        case 'Enter': this.onCommand('confirm'); break;
        case 'KeyR': this.onCommand('restart'); break;
        case 'Tab': this.onCommand('toggleMap'); event.preventDefault(); break;
        default: break;
      }
      // Stop the page scrolling out from under the viewport.
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
      this.pendingTurn += event.movementX * PLAYER.MOUSE_SENSITIVITY;
    });

    this.#on(this.canvas, 'wheel', (event) => {
      this.pendingCycle = event.deltaY > 0 ? 1 : -1;
      event.preventDefault();
    }, { passive: false });

    this.#on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
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
      fire: this.mouseDown || this.#anyKey(KEY_BINDINGS.fire) || this.touch.fire,
      use: this.#anyKey(KEY_BINDINGS.use),
      run: this.#anyKey(KEY_BINDINGS.run),
      weaponSlot: this.pendingSlot,
      cycleWeapon: this.pendingCycle,
    };

    this.pendingTurn = 0;
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
  forward: 0, strafe: 0, turn: 0, turnDelta: 0,
  fire: false, use: false, run: false, weaponSlot: 0, cycleWeapon: 0,
});
