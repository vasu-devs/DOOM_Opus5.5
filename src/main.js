import { GAME_STATE, LOG_LEVEL, DIFFICULTY } from './core/constants.js';
import { Logger, CODES } from './core/logger.js';
import { Settings } from './core/settings.js';
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
    this.settings = new Settings({ logger: this.logger.child('settings') });

    this.textures = new TextureBank();
    this.renderer = new Renderer(this.dom.canvas, this.textures);
    this.viewmodel = new Viewmodel(this.renderer.ctx);
    this.minimap = new Minimap(this.dom.minimap);
    this.hud = new Hud(this.dom, this.textures);
    this.audio = new Sfx({ logger: this.logger.child('audio') });

    this.game = new Game({
      textures: this.textures,
      audio: this.audio,
      logger: this.logger.child('game'),
      difficulty: this.settings.difficulty(),
    });
    this.agent = new AutoplayAgent({ logger: this.logger.child('agent') });
    this.game.agent = this.agent;

    this.input = new InputManager(this.dom.canvas, {
      logger: this.logger.child('input'),
      onCommand: (cmd) => this.handleCommand(cmd),
      settings: this.settings,
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
      mapPanel: byId('map-panel'),
      stage: byId('stage'),
      overlay: byId('overlay'),
      portrait: byId('portrait'),
      health: byId('health-value'),
      healthBlock: byId('health-block'),
      armor: byId('armor-value'),
      ammo: byId('ammo-value'),
      ammoBlock: byId('ammo-block'),
      ammoPools: byId('ammo-pools'),
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
      settingsToggle: byId('settings-toggle'),
      settingsPanel: byId('settings-panel'),
      settingsClose: byId('settings-close'),
      settingsReset: byId('settings-reset'),
      fullscreenToggle: byId('fullscreen-toggle'),
      fps: byId('fps-value'),
      res: byId('res-value'),
      sensitivityInput: byId('sensitivity-input'),
      sensitivityOut: byId('sensitivity-out'),
      qualityInput: byId('quality-input'),
      difficultyInput: byId('difficulty-input'),
      sfxInput: byId('sfx-input'),
      sfxOut: byId('sfx-out'),
      musicInput: byId('music-input'),
      musicOut: byId('music-out'),
      invertInput: byId('invert-input'),
      bobInput: byId('bob-input'),
      minimapInput: byId('minimap-input'),
    };
  }

  start() {
    this.#bindUi();
    this.#applySettings();
    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    this.hud.renderOverlay(this.game);
    this.loopHandle = requestAnimationFrame((t) => this.#frame(t));
    this.logger.info(CODES.BOOT_OK, 'game booted', {
      levels: this.game.levels.length,
      viewport: this.renderer.internalLabel,
    });
    document.body.dataset.booted = 'true';
  }

  /* --------------------------------- UI ----------------------------------- */

  #bindUi() {
    this.dom.overlay?.addEventListener('click', () => this.handleCommand('confirm'));
    this.dom.canvas.addEventListener('click', () => {
      if (this.game.state === GAME_STATE.MENU) this.handleCommand('confirm');
      else if (this.game.state === GAME_STATE.PLAYING && !this.agent.enabled) this.input.requestPointerLock();
    });
    this.dom.agentToggle?.addEventListener('click', () => this.handleCommand('toggleAutoplay'));
    this.dom.settingsToggle?.addEventListener('click', () => this.handleCommand('toggleSettings'));
    this.dom.settingsClose?.addEventListener('click', () => this.handleCommand('closeSettings'));
    this.dom.fullscreenToggle?.addEventListener('click', () => this.handleCommand('toggleFullscreen'));
    this.dom.settingsReset?.addEventListener('click', () => {
      this.settings.reset();
      this.#applySettings();
    });

    const bindRange = (input, key, output, format) => {
      input?.addEventListener('input', () => {
        const value = Number(input.value);
        this.settings.set(key, value);
        if (output) output.textContent = format(value);
        this.#applySettings({ skipInputs: true });
      });
    };
    bindRange(this.dom.sensitivityInput, 'sensitivity', this.dom.sensitivityOut, (v) => v.toFixed(2));
    bindRange(this.dom.sfxInput, 'sfxVolume', this.dom.sfxOut, (v) => `${Math.round(v * 100)}%`);
    bindRange(this.dom.musicInput, 'musicVolume', this.dom.musicOut, (v) => `${Math.round(v * 100)}%`);

    this.dom.qualityInput?.addEventListener('change', () => {
      this.settings.set('quality', this.dom.qualityInput.value);
      this.#applySettings({ skipInputs: true });
    });
    this.dom.difficultyInput?.addEventListener('change', () => {
      this.settings.set('difficulty', this.dom.difficultyInput.value);
      this.#applySettings({ skipInputs: true });
      this.game.pushMessage(`DIFFICULTY: ${this.settings.difficulty().label}`);
    });
    const bindCheck = (input, key) => {
      input?.addEventListener('change', () => {
        this.settings.set(key, input.checked);
        this.#applySettings({ skipInputs: true });
      });
    };
    bindCheck(this.dom.invertInput, 'invertY');
    bindCheck(this.dom.bobInput, 'viewBob');
    bindCheck(this.dom.minimapInput, 'showMinimap');

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

  /** Push settings into every subsystem (and back into the form controls). */
  #applySettings({ skipInputs = false } = {}) {
    const s = this.settings;
    this.renderer.setQuality(s.isAutoQuality() ? 'auto' : s.qualityIndex(3));
    this.audio.setSfxVolume(s.get('sfxVolume'));
    this.audio.setMusicVolume(s.get('musicVolume'));
    this.game.setDifficulty(DIFFICULTY[s.get('difficulty')] ?? DIFFICULTY.NORMAL);

    if (this.dom.mapPanel) this.dom.mapPanel.hidden = !s.get('showMinimap');

    if (skipInputs) return;
    const { dom } = this;
    if (dom.sensitivityInput) dom.sensitivityInput.value = String(s.get('sensitivity'));
    if (dom.sensitivityOut) dom.sensitivityOut.textContent = Number(s.get('sensitivity')).toFixed(2);
    if (dom.qualityInput) dom.qualityInput.value = String(s.get('quality'));
    if (dom.difficultyInput) dom.difficultyInput.value = s.get('difficulty');
    if (dom.sfxInput) dom.sfxInput.value = String(s.get('sfxVolume'));
    if (dom.sfxOut) dom.sfxOut.textContent = `${Math.round(s.get('sfxVolume') * 100)}%`;
    if (dom.musicInput) dom.musicInput.value = String(s.get('musicVolume'));
    if (dom.musicOut) dom.musicOut.textContent = `${Math.round(s.get('musicVolume') * 100)}%`;
    if (dom.invertInput) dom.invertInput.checked = Boolean(s.get('invertY'));
    if (dom.bobInput) dom.bobInput.checked = Boolean(s.get('viewBob'));
    if (dom.minimapInput) dom.minimapInput.checked = Boolean(s.get('showMinimap'));
  }

  handleCommand(command) {
    const game = this.game;
    switch (command) {
      case 'confirm':
        this.audio.resume();
        this.audio.startMusic();
        if (this.#settingsOpen()) {
          this.handleCommand('closeSettings');
          return;
        }
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
        if (this.#settingsOpen()) {
          this.handleCommand('closeSettings');
          return;
        }
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
        this.audio.startMusic();
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
        game.pushMessage(muted ? 'AUDIO MUTED' : 'AUDIO ON');
        break;
      }
      case 'toggleSettings':
        if (this.#settingsOpen()) this.handleCommand('closeSettings');
        else {
          this.dom.settingsPanel.hidden = false;
          this.input.exitPointerLock();
          if (game.state === GAME_STATE.PLAYING) game.togglePause();
          this.#applySettings();
        }
        break;
      case 'closeSettings':
        if (this.dom.settingsPanel) this.dom.settingsPanel.hidden = true;
        if (game.state === GAME_STATE.PAUSED) game.togglePause();
        break;
      case 'toggleFullscreen':
        this.#toggleFullscreen();
        break;
      case 'toggleMap':
        this.mapExpanded = !this.mapExpanded;
        this.dom.stage?.setAttribute('data-map', this.mapExpanded ? 'expanded' : 'compact');
        break;
      case 'use':
        if (game.state === GAME_STATE.PLAYING) game.useInFront();
        break;
      case 'pointerUnlocked':
        if (game.state === GAME_STATE.PLAYING && !this.agent.enabled && !this.#settingsOpen()) {
          game.togglePause();
        }
        break;
      default:
        break;
    }
  }

  #settingsOpen() {
    return this.dom.settingsPanel && !this.dom.settingsPanel.hidden;
  }

  #toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.();
    } catch (error) {
      this.logger.warn(CODES.POINTER_LOCK_FAILED, 'fullscreen refused', { reason: error?.name });
    }
  }

  #resize() {
    const stage = this.dom.stage ?? this.dom.canvas.parentElement;
    const bounds = stage.getBoundingClientRect();
    this.renderer.resize(Math.max(320, Math.floor(bounds.width)), Math.max(200, Math.floor(bounds.height)));
  }

  /* -------------------------------- loop ---------------------------------- */

  #frame(now) {
    this.loopHandle = requestAnimationFrame((t) => this.#frame(t));
    const rawDt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);

    try {
      const started = performance.now();
      this.#tick(dt);
      this.renderer.sampleFrame(performance.now() - started);
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

  #tick(dt) {
    const game = this.game;
    const playing = game.state === GAME_STATE.PLAYING && !this.#settingsOpen();

    if (playing) {
      const human = this.input.poll();
      let intent = this.agent.enabled ? this.agent.think(dt, game) : human;
      if (this.agent.enabled) {
        // Even under autoplay, a human can always take a shot or open a door.
        intent = { ...intent, fire: intent.fire || human.fire, use: intent.use || human.use };
      }
      game.update(dt, intent);
      game.autoOpenDoors();
      this.#updateMusicIntensity();
    } else {
      this.input.poll(); // drain one-shot inputs so they do not queue up
    }

    this.viewmodel.update(dt);
    this.renderer.render(game);
    this.#drawViewmodel(game);
    this.#drawCrosshair();
    this.#drawHurtIndicator(game);

    if (this.settings.get('showMinimap')) this.minimap.render(game);
    this.hud.update(game);
    this.hud.renderOverlay(game);
    this.#trackFps(dt);
    this.#handleStateChange();
  }

  #drawViewmodel(game) {
    const player = game.player;
    const scale = this.renderer.canvas.height / 300;
    const bob = this.settings.get('viewBob') ? player.bobOffsets() : { x: 0, y: 0 };
    const shake = game.shakeMs > 0
      ? (Math.random() - 0.5) * game.shakeMagnitude * (game.shakeMs / 190) * 9
      : 0;

    this.viewmodel.draw(
      {
        id: player.weaponId,
        recoil: player.recoil,
        flashMs: player.flashMs,
        spin: player.spin,
        fireAnim: player.fireAnim,
      },
      (bob.x + shake) * scale,
      bob.y * scale,
      player.switchLowered
    );
  }

  #drawCrosshair() {
    const ctx = this.renderer.ctx;
    const { width, height } = this.renderer.canvas;
    const size = Math.max(6, height * 0.016);
    ctx.save();
    ctx.strokeStyle = 'rgba(224,163,64,0.8)';
    ctx.lineWidth = Math.max(1, height * 0.0022);
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
    ctx.fillStyle = 'rgba(224,163,64,0.9)';
    ctx.fillRect(width / 2 - 1, height / 2 - 1, 2, 2);
    ctx.restore();
  }

  /** A wedge at the screen edge pointing at whatever just hit us. */
  #drawHurtIndicator(game) {
    if (game.painFlash <= 0.05) return;
    const ctx = this.renderer.ctx;
    const { width, height } = this.renderer.canvas;
    const relative = game.hurtDirection - game.player.angle;

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(relative + Math.PI / 2);
    ctx.globalAlpha = Math.min(0.75, game.painFlash);
    const radius = Math.min(width, height) * 0.28;
    const grad = ctx.createLinearGradient(0, -radius, 0, -radius * 0.5);
    grad.addColorStop(0, 'rgba(220,40,30,0.85)');
    grad.addColorStop(1, 'rgba(220,40,30,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.34, -radius);
    ctx.lineTo(radius * 0.34, -radius);
    ctx.lineTo(0, -radius * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Music gets busier when things are actually dangerous. */
  #updateMusicIntensity() {
    const game = this.game;
    let threat = 0;
    for (const enemy of game.enemies) {
      if (enemy.isDead() || enemy.state === 'dormant') continue;
      threat += 1;
    }
    const health = game.player.health / 100;
    this.audio.setMusicIntensity(Math.min(1, threat / 4) * 0.7 + (1 - health) * 0.3);
  }

  #trackFps(dt) {
    this.fpsAccumulator += dt * 1000;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= FPS_SAMPLE_MS) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      if (this.dom.fps) this.dom.fps.textContent = String(this.fps);
      if (this.dom.res) this.dom.res.textContent = this.renderer.internalLabel;
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
