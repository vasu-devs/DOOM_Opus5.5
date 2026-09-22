import { GAME_STATE, WEAPONS, WEAPON_AMMO } from '../core/constants.js';

/**
 * DOM-driven HUD. Text lives in the DOM (crisp at any DPI, screen-reader
 * friendly) while the world stays on canvas. Writes are diffed so we are not
 * touching layout-triggering properties 60 times a second.
 */
export class Hud {
  /** @param {Record<string, HTMLElement>} elements */
  constructor(elements) {
    this.el = elements;
    this.cache = new Map();
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
    this.#set('score', this.el.score, stats.score.toLocaleString('en-US'));
    this.#set('kills', this.el.kills, `${stats.kills}/${stats.totalEnemies}`);
    this.#set('levelName', this.el.levelName, stats.level);
    this.#set('levelIndex', this.el.levelIndex, `${stats.levelIndex + 1}/${stats.levelCount}`);
    this.#set('weapon', this.el.weapon, player.weapon.name);
    this.#set('ammo', this.el.ammo, String(player.currentAmmo));
    this.#set('ammoType', this.el.ammoType, WEAPON_AMMO[player.weaponId].toUpperCase());

    this.#setAttr('healthBar', this.el.healthBar, 'style', `--fill:${Math.max(0, player.health) / 100}`);
    this.#setAttr('armorBar', this.el.armorBar, 'style', `--fill:${Math.max(0, player.armor) / 100}`);
    this.#setAttr('healthState', this.el.healthBlock, 'data-critical', player.health <= 25 ? 'true' : 'false');

    this.#renderWeaponSlots(player);
    this.#renderMessages(game);
    this.#renderAgent(game);
  }

  #renderWeaponSlots(player) {
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
        body = `<p>Three sectors. Everything down there is already hostile.</p>
          <ul class="keys">
            <li><b>WASD</b> move</li><li><b>Mouse</b> aim</li><li><b>Click / Space</b> fire</li>
            <li><b>1-3</b> weapons</li><li><b>E</b> doors</li><li><b>P</b> autoplay</li>
            <li><b>Tab</b> map</li><li><b>Esc</b> pause</li>
          </ul>`;
        action = 'CLICK OR PRESS ENTER TO DROP IN';
        break;
      case GAME_STATE.PAUSED:
        title = 'HOLDING';
        body = `<p>${stats.level} · ${stats.subtitle}</p>`;
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
        body = `<p>All three sectors are silent.</p>
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
