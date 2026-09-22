import { GAME_STATE, WEAPONS, WEAPON_AMMO, AMMO_MAX } from '../core/constants.js';

/**
 * Status-bar HUD in the classic arcade-shooter arrangement: ammo on the left,
 * vitals and a reactive portrait in the middle, armour and the weapon rack on
 * the right, all pinned under a full-bleed viewport.
 *
 * Text lives in the DOM (crisp at any DPI, screen-reader friendly) while the
 * world stays on canvas. Writes are diffed so we are not touching
 * layout-triggering properties 60 times a second.
 */
export class Hud {
  /**
   * @param {Record<string, HTMLElement>} elements
   * @param {import('./textures.js').TextureBank} textures
   */
  constructor(elements, textures) {
    this.el = elements;
    this.textures = textures;
    this.cache = new Map();
    this.portraitCtx = elements.portrait?.getContext('2d') ?? null;
    this.lastPortraitKey = null;
  }

  #set(key, element, value) {
    if (!element || this.cache.get(key) === value) return;
    this.cache.set(key, value);
    element.textContent = value;
  }

  #setAttr(key, element, attribute, value) {
    const cacheKey = `${key}:${attribute}`;
    if (!element || this.cache.get(cacheKey) === value) return;
    this.cache.set(cacheKey, value);
    element.setAttribute(attribute, value);
  }

  /** @param {import('../game/game.js').Game} game */
  update(game) {
    const player = game.player;
    const stats = game.stats();

    this.#set('health', this.el.health, String(Math.max(0, Math.round(player.health))));
    this.#set('armor', this.el.armor, String(Math.round(player.armor)));
    this.#set('ammo', this.el.ammo, String(player.currentAmmo));
    this.#set('score', this.el.score, stats.score.toLocaleString('en-US'));
    this.#set('kills', this.el.kills, `${stats.kills}/${stats.totalEnemies}`);
    this.#set('levelName', this.el.levelName, stats.level);
    this.#set('levelIndex', this.el.levelIndex, `${stats.levelIndex + 1}/${stats.levelCount}`);

    this.#setAttr('healthState', this.el.healthBlock, 'data-critical',
      player.health <= 30 ? 'true' : 'false');
    this.#setAttr('ammoState', this.el.ammoBlock, 'data-empty',
      player.currentAmmo <= 0 ? 'true' : 'false');

    this.#renderPortrait(game);
    this.#renderAmmoPools(player);
    this.#renderWeaponRack(player);
    this.#renderMessages(game);
    this.#renderAgent(game);
  }

  /** Portrait stage, with a hit reaction that briefly forces the hurt frame. */
  #renderPortrait(game) {
    if (!this.portraitCtx) return;
    const player = game.player;
    const hurt = game.painFlash > 0.45;
    const stage = player.alive
      ? Math.min(4, player.portraitStage() + (hurt ? 1 : 0))
      : 'dead';
    const key = String(stage);
    if (key === this.lastPortraitKey) return;
    this.lastPortraitKey = key;

    const source = stage === 'dead'
      ? this.textures.portraits.dead
      : this.textures.portraits.stages[stage];
    const canvas = this.el.portrait;
    this.portraitCtx.imageSmoothingEnabled = false;
    this.portraitCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.portraitCtx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  #renderAmmoPools(player) {
    if (!this.el.ammoPools) return;
    const signature = `${player.ammo.bullets}|${player.ammo.shells}|${player.ammo.cells}|${player.ammoType}`;
    if (this.cache.get('pools') === signature) return;
    this.cache.set('pools', signature);

    this.el.ammoPools.innerHTML = '';
    for (const type of ['bullets', 'shells', 'cells']) {
      const row = document.createElement('div');
      row.className = 'pool';
      row.dataset.active = type === player.ammoType ? 'true' : 'false';
      row.innerHTML = `<span>${type.toUpperCase()}</span><b>${player.ammo[type] ?? 0}</b>`
        + `<i>/${AMMO_MAX[type]}</i>`;
      this.el.ammoPools.append(row);
    }
  }

  #renderWeaponRack(player) {
    if (!this.el.weaponSlots) return;
    const signature = `${[...player.owned].sort().join(',')}|${player.weaponId}`;
    if (this.cache.get('slots') === signature) return;
    this.cache.set('slots', signature);

    this.el.weaponSlots.innerHTML = '';
    for (const weapon of Object.values(WEAPONS).sort((a, b) => a.slot - b.slot)) {
      const owned = player.owned.has(weapon.id);
      const chip = document.createElement('li');
      chip.className = 'slot';
      chip.dataset.state = !owned ? 'locked' : weapon.id === player.weaponId ? 'active' : 'owned';
      chip.innerHTML = `<b>${weapon.slot}</b><span>${weapon.name}</span>`;
      this.el.weaponSlots.append(chip);
    }
  }

  #renderMessages(game) {
    if (!this.el.messages) return;
    const signature = game.messages.map((m) => `${m.kind}:${m.text}`).join('|');
    if (this.cache.get('messages') === signature) return;
    this.cache.set('messages', signature);

    this.el.messages.innerHTML = '';
    for (const message of game.messages) {
      const line = document.createElement('li');
      line.dataset.kind = message.kind;
      line.textContent = message.text;
      this.el.messages.append(line);
    }
  }

  #renderAgent(game) {
    const agent = game.agent;
    if (!agent || !this.el.agentPanel) return;
    this.#setAttr('agentOn', this.el.agentPanel, 'data-active', agent.enabled ? 'true' : 'false');
    if (!agent.enabled) {
      this.#set('agentMode', this.el.agentMode, 'OFFLINE');
      this.#set('agentGoal', this.el.agentGoal, 'press P to hand over');
      return;
    }
    const plan = agent.describe();
    this.#set('agentMode', this.el.agentMode, plan.mode);
    this.#set('agentGoal', this.el.agentGoal, plan.goal);
    this.#set('agentStats', this.el.agentStats,
      `decisions ${plan.decisions} · shots ${plan.shots} · unsticks ${plan.unsticks}`);
  }

  /** Full-screen overlay for menu / pause / death / level end. */
  renderOverlay(game, extra = {}) {
    const overlay = this.el.overlay;
    if (!overlay) return;
    const stats = game.stats();
    const visible = game.state !== GAME_STATE.PLAYING;
    overlay.hidden = !visible;
    if (!visible) return;

    const fmtTime = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    const accuracy = `${Math.round(stats.accuracy * 100)}%`;
    let title = '';
    let body = '';
    let action = '';

    switch (game.state) {
      case GAME_STATE.MENU:
        title = 'DESCENT PROTOCOL';
        body = `<p class="tagline">Three sectors. Everything down there is already hostile.</p>
          <ul class="keys">
            <li><b>WASD</b> move</li><li><b>Mouse</b> aim</li><li><b>Click</b> fire</li>
            <li><b>1-4</b> weapons</li><li><b>E</b> doors</li><li><b>Shift</b> run</li>
            <li><b>Tab</b> map</li><li><b>P</b> autoplay</li><li><b>F</b> fullscreen</li>
            <li><b>O</b> settings</li><li><b>Esc</b> pause</li><li><b>R</b> restart</li>
          </ul>
          <p class="difficulty-note">Difficulty: <b>${stats.difficulty}</b> — change it in Settings (O)</p>`;
        action = 'CLICK OR PRESS ENTER TO DROP IN';
        break;
      case GAME_STATE.PAUSED:
        title = 'HOLDING';
        body = `<p class="tagline">${stats.level} · ${stats.subtitle}</p>`;
        action = 'ESC TO RESUME';
        break;
      case GAME_STATE.DEAD:
        title = 'YOU DIED';
        body = `<dl class="scoreboard">
            <div><dt>SECTOR</dt><dd>${stats.level}</dd></div>
            <div><dt>SCORE</dt><dd>${stats.score.toLocaleString('en-US')}</dd></div>
            <div><dt>KILLS</dt><dd>${stats.killsAll}</dd></div>
            <div><dt>ACCURACY</dt><dd>${accuracy}</dd></div>
          </dl>`;
        action = 'PRESS R OR ENTER TO TRY AGAIN';
        break;
      case GAME_STATE.LEVEL_CLEARED:
        title = 'SECTOR CLEARED';
        body = `<dl class="scoreboard">
            <div><dt>SECTOR</dt><dd>${stats.level}</dd></div>
            <div><dt>TIME</dt><dd>${fmtTime(stats.timeMs)}</dd></div>
            <div><dt>KILLS</dt><dd>${stats.kills}/${stats.totalEnemies}</dd></div>
            <div><dt>ITEMS</dt><dd>${stats.secretsFound}/${stats.pickupCount}</dd></div>
            <div><dt>ACCURACY</dt><dd>${accuracy}</dd></div>
            <div><dt>SCORE</dt><dd>${stats.score.toLocaleString('en-US')}</dd></div>
          </dl>`;
        action = 'PRESS ENTER FOR THE NEXT SECTOR';
        break;
      case GAME_STATE.VICTORY:
        title = 'FURNACE COLD';
        body = `<p class="tagline">All three sectors are silent.</p>
          <dl class="scoreboard">
            <div><dt>TOTAL SCORE</dt><dd>${stats.score.toLocaleString('en-US')}</dd></div>
            <div><dt>TOTAL KILLS</dt><dd>${stats.killsAll}</dd></div>
            <div><dt>TOTAL TIME</dt><dd>${fmtTime(stats.totalTimeMs)}</dd></div>
            <div><dt>ACCURACY</dt><dd>${accuracy}</dd></div>
          </dl>`;
        action = 'PRESS R TO RUN IT AGAIN';
        break;
      default:
        break;
    }

    const signature = `${game.state}|${title}|${body}|${action}|${extra.note ?? ''}`;
    if (this.cache.get('overlay') === signature) return;
    this.cache.set('overlay', signature);

    overlay.innerHTML = `
      <div class="overlay-card">
        <h2>${title}</h2>
        <div class="overlay-body">${body}</div>
        <p class="overlay-action">${action}</p>
        ${extra.note ? `<p class="overlay-note">${extra.note}</p>` : ''}
      </div>`;
  }
}
