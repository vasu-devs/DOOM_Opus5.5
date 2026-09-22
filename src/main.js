import { GAME_STATE, LOG_LEVEL, PLAYER } from './core/constants.js';
import { Logger, CODES } from './core/logger.js';
import { TextureBank } from './render/textures.js';
import { Renderer } from './render/renderer.js';
import { Viewmodel } from './render/viewmodel.js';
import { Minimap } from './render/minimap.js';
import { Hud } from './render/hud.js';
import { Game } from './game/game.js';
import { AutoplayAgent } from './agent/autoplay.js';
import { InputManager, IDLE_INTENT } from './input.js';
import { Sfx } from './audio/sfx.js';

const MAX_FRAME_DT = 1 / 20;   // never simulate more than 50ms in one step
const FPS_SAMPLE_MS = 500;

/**
 * Application shell: builds every subsystem, owns the animation frame loop and
 * routes commands. Everything below this file is DOM-free and testable.
 */
class App {
  constructor() {
    this.logger = new Logger('descent', LOG_LEVEL.INFO);
    this.dom = this.#queryDom();

    this.textures = new TextureBank();
    this.renderer = new Renderer(this.dom.canvas, this.textures);
    this.viewmodel = new Viewmodel(this.renderer.ctx);
    this.minimap = new Minimap(this.dom.minimap);
    this.hud = new Hud(this.dom);
    this.audio = new Sfx({ logger: this.logger.child('audio') });

    this.game = new Game({
      textures: this.textures,
      audio: this.audio,
      logger: this.logger.child('game'),
    });
    this.agent = new AutoplayAgent({ logger: this.logger.child('agent') });
    this.game.agent = this.agent;

    this.input = new InputManager(this.dom.canvas, {
      logger: this.logger.child('input'),
      onCommand: (cmd) => this.handleCommand(cmd),
    });

    this.lastFrameTime = performance.now();
    this.fpsAccumulator = 0;
    this.fpsFrames = 0;
    this.fps = 0;
    this.mapExpanded = false;
    this.previousState = this.game.state;
    this.loopHandle = null;
  }

  #queryDom() {
    const byId = (id) => document.getElementById(id);
    const canvas = byId('viewport');
    if (!canvas) {
      throw Object.assign(new Error('Viewport canvas missing'), { code: CODES.CANVAS_MISSING });
    }
    return {
      canvas,
      minimap: byId('minimap'),
      stage: byId('stage'),
      overlay: byId('overlay'),
      health: byId('health-value'),
      healthBar: byId('health-bar'),
      healthBlock: byId('health-block'),
      armor: byId('armor-value'),
      armorBar: byId('armor-bar'),
      ammo: byId('ammo-value'),
      ammoType: byId('ammo-type'),
      weapon: byId('weapon-name'),
      weaponSlots: byId('weapon-slots'),
      score: byId('score-value'),
      kills: byId('kills-value'),
      levelName: byId('level-name'),
      levelIndex: byId('level-index'),
      messages: byId('messages'),
      agentPanel: byId('agent-panel'),
      agentMode: byId('agent-mode'),
      agentGoal: byId('agent-goal'),
      agentStats: byId('agent-stats'),
      agentToggle: byId('agent-toggle'),
      muteToggle: byId('mute-toggle'),
      fps: byId('fps-value'),
    };
  }

  start() {
    this.#bindUi();
    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    this.hud.renderOverlay(this.game);
    this.loopHandle = requestAnimationFrame((t) => this.#frame(t));
    this.logger.info(CODES.BOOT_OK, 'game booted', {
      levels: this.game.levels.length,
      viewport: `${this.renderer.width}x${this.renderer.height}`,
    });
    document.body.dataset.booted = 'true';
  }

  #bindUi() {
    this.dom.overlay?.addEventListener('click', () => this.handleCommand('confirm'));
    this.dom.canvas.addEventListener('click', () => {
      if (this.game.state === GAME_STATE.MENU) this.handleCommand('confirm');
      else if (this.game.state === GAME_STATE.PLAYING && !this.agent.enabled) this.input.requestPointerLock();
    });
    this.dom.agentToggle?.addEventListener('click', () => this.handleCommand('toggleAutoplay'));
    this.dom.muteToggle?.addEventListener('click', () => this.handleCommand('toggleMute'));

    for (const button of document.querySelectorAll('[data-touch]')) {
      const [axis, value] = button.dataset.touch.split(':');
      const press = (event) => {
        event.preventDefault();
        this.input.setTouchAxis(axis, axis === 'fire' ? true : Number(value));
      };
      const release = (event) => {
        event.preventDefault();
        this.input.setTouchAxis(axis, axis === 'fire' ? false : 0);
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
    }
  }

  handleCommand(command) {
    const game = this.game;
    switch (command) {
      case 'confirm':
        this.audio.resume();
        if (game.state === GAME_STATE.MENU) {
          game.start();
          if (!this.agent.enabled) this.input.requestPointerLock();
        } else if (game.state === GAME_STATE.LEVEL_CLEARED) {
          game.advanceLevel();
        } else if (game.state === GAME_STATE.DEAD || game.state === GAME_STATE.VICTORY) {
          game.restart();
        } else if (game.state === GAME_STATE.PAUSED) {
          game.togglePause();
        }
        break;
      case 'pause':
        if (game.state === GAME_STATE.PLAYING || game.state === GAME_STATE.PAUSED) {
          game.togglePause();
          if (game.state === GAME_STATE.PAUSED) this.input.exitPointerLock();
        }
        break;
      case 'restart':
        this.audio.resume();
        game.restart();
        break;
      case 'toggleAutoplay': {
        this.audio.resume();
        const enabled = this.agent.toggle(game);
        if (enabled) {
          this.input.exitPointerLock();
          if (game.state === GAME_STATE.MENU) game.start();
          game.pushMessage('AUTOPLAY ENGAGED');
        } else {
          game.pushMessage('MANUAL CONTROL');
        }
        this.dom.agentToggle?.setAttribute('aria-pressed', String(enabled));
        break;
      }
      case 'toggleMute': {
        this.audio.resume();
        const muted = this.audio.toggleMute();
        this.dom.muteToggle?.setAttribute('aria-pressed', String(muted));
        this.dom.muteToggle && (this.dom.muteToggle.textContent = muted ? 'SOUND OFF' : 'SOUND ON');
        break;
      }
      case 'toggleMap':
        this.mapExpanded = !this.mapExpanded;
        this.dom.stage?.setAttribute('data-map', this.mapExpanded ? 'expanded' : 'compact');
        break;
      case 'use':
        if (game.state === GAME_STATE.PLAYING) game.useInFront();
        break;
      case 'pointerUnlocked':
        if (game.state === GAME_STATE.PLAYING && !this.agent.enabled) game.togglePause();
        break;
      default:
        break;
    }
  }

  #resize() {
    const stage = this.dom.stage ?? this.dom.canvas.parentElement;
    const bounds = stage.getBoundingClientRect();
    const aspect = this.renderer.width / this.renderer.height;
    let width = bounds.width;
    let height = width / aspect;
    if (height > bounds.height) {
      height = bounds.height;
      width = height * aspect;
    }
    this.renderer.resize(Math.max(320, Math.floor(width)), Math.max(200, Math.floor(height)));
  }

  #frame(now) {
    this.loopHandle = requestAnimationFrame((t) => this.#frame(t));
    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);

    try {
      this.#tick(dt, now);
    } catch (error) {
      // A render/sim fault must not wedge the browser in a throwing rAF loop.
      this.logger.error(CODES.LOOP_ERROR, 'frame failed', {
        name: error?.name, message: error?.message, state: this.game.state,
      });
      cancelAnimationFrame(this.loopHandle);
      this.game.state = GAME_STATE.PAUSED;
      this.hud.renderOverlay(this.game, { note: 'A frame error stopped the loop - reload to continue.' });
    }
  }

  #tick(dt, now) {
    const game = this.game;
    const playing = game.state === GAME_STATE.PLAYING;

    let intent = IDLE_INTENT;
    if (playing) {
      const human = this.input.poll();
      intent = this.agent.enabled ? this.agent.think(dt, game) : human;
      // Even under autoplay, a human can always take a shot or hit the brakes.
      if (this.agent.enabled) {
        intent = {
          ...intent,
          fire: intent.fire || human.fire,
          use: intent.use || human.use,
        };
      }
      game.update(dt, intent);
      game.autoOpenDoors();
    } else {
      this.input.poll(); // drain one-shot inputs so they do not queue up
    }

    this.renderer.render(game);
    const bob = game.player.bobOffsets();
    const shake = game.shakeMs > 0 ? (Math.random() - 0.5) * game.shakeMs * 0.08 : 0;
    const scale = this.renderer.canvas.height / this.renderer.height;
    this.viewmodel.draw(
      { id: game.player.weaponId, recoil: game.player.recoil, flashMs: game.player.flashMs, spin: game.player.spin },
      (bob.x + shake) * scale * (PLAYER.BOB_AMPLITUDE / PLAYER.BOB_AMPLITUDE),
      bob.y * scale,
      game.player.switchLowered
    );
    this.#drawCrosshair();

    this.minimap.render(game);
    this.hud.update(game);
    this.hud.renderOverlay(game);
    this.#trackFps(dt);
    this.#handleStateChange();
  }

  #drawCrosshair() {
    const ctx = this.renderer.ctx;
    const { width, height } = this.renderer.canvas;
    const size = Math.max(6, height * 0.018);
    ctx.save();
    ctx.strokeStyle = 'rgba(224,163,64,0.75)';
    ctx.lineWidth = Math.max(1, height * 0.0025);
    ctx.beginPath();
    ctx.moveTo(width / 2 - size, height / 2);
    ctx.lineTo(width / 2 - size * 0.35, height / 2);
    ctx.moveTo(width / 2 + size * 0.35, height / 2);
    ctx.lineTo(width / 2 + size, height / 2);
    ctx.moveTo(width / 2, height / 2 - size);
    ctx.lineTo(width / 2, height / 2 - size * 0.35);
    ctx.moveTo(width / 2, height / 2 + size * 0.35);
    ctx.lineTo(width / 2, height / 2 + size);
    ctx.stroke();
    ctx.restore();
  }

  #trackFps(dt) {
    this.fpsAccumulator += dt * 1000;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= FPS_SAMPLE_MS) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      if (this.dom.fps) this.dom.fps.textContent = String(this.fps);
    }
  }

  #handleStateChange() {
    const state = this.game.state;
    if (state === this.previousState) return;
    this.previousState = state;
    if (state === GAME_STATE.LEVEL_CLEARED) this.audio.play('levelClear');
    if (state === GAME_STATE.DEAD) this.audio.play('gameOver');
    if (state !== GAME_STATE.PLAYING) this.input.exitPointerLock();
  }
}

function boot() {
  const logger = new Logger('descent:boot', LOG_LEVEL.INFO);
  try {
    const app = new App();
    app.start();
    window.__DESCENT__ = app; // handle for tests and debugging
  } catch (error) {
    logger.error(CODES.BOOT_FAILED, 'boot failed', { name: error?.name, message: error?.message });
    const overlay = document.getElementById('overlay');
    if (overlay) {
      overlay.hidden = false;
      overlay.innerHTML = `<div class="overlay-card"><h2>BOOT FAILED</h2>
        <p class="overlay-action">${error?.message ?? 'unknown error'}</p></div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
