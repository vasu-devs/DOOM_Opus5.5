import { AUDIO, WEAPON_ID } from '../core/constants.js';
import { CODES } from '../core/logger.js';

/**
 * Procedural sound. Every effect is synthesised with oscillators and shaped
 * noise at runtime - there are no audio files in this repository.
 *
 * The AudioContext is created lazily on the first user gesture, which is what
 * browsers require, and every call is wrapped so a missing or blocked audio
 * device degrades to silence instead of breaking the game loop.
 */
export class Sfx {
  /** @param {{logger: import('../core/logger.js').Logger}} deps */
  constructor({ logger }) {
    this.logger = logger;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicIntensity = 0;
    this.available = typeof window !== 'undefined'
      && Boolean(window.AudioContext || window.webkitAudioContext);
  }

  /** Must be called from a user gesture handler. */
  resume() {
    if (!this.available) return false;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : AUDIO.MASTER_GAIN;
        this.master.connect(this.ctx.destination);

        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = this.sfxVolume;
        this.sfxBus.connect(this.master);

        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = this.musicVolume * AUDIO.MUSIC_GAIN;
        this.musicBus.connect(this.master);

        this.noiseBuffer = this.#createNoiseBuffer();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (error) {
      this.available = false;
      this.logger.warn(CODES.AUDIO_UNAVAILABLE, 'audio unavailable', { reason: error?.name });
      return false;
    }
  }

  setSfxVolume(value) {
    this.sfxVolume = Math.max(0, Math.min(1, value));
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
  }

  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.musicBus) this.musicBus.gain.value = this.musicVolume * AUDIO.MUSIC_GAIN;
    if (this.musicVolume === 0) this.stopMusic();
    else if (this.ctx && !this.musicTimer) this.startMusic();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : AUDIO.MASTER_GAIN;
    return this.muted;
  }

  #createNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 0.5);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  #noise(duration, { gain = 0.5, filterType = 'lowpass', frequency = 1200, sweepTo = null, bus = null }) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    if (sweepTo !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), this.ctx.currentTime + duration);
    }
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, this.ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

    source.connect(filter).connect(envelope).connect(bus ?? this.sfxBus);
    source.start();
    source.stop(this.ctx.currentTime + duration);
  }

  #tone(frequency, duration, {
    type = 'square', gain = 0.3, endFrequency = null, bus = null, delay = 0,
  } = {}) {
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope).connect(bus ?? this.sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /**
   * Positional variant: quieter with distance, silent past the falloff range.
   * Keeps distant firefights from drowning out what is next to the player.
   */
  playAt(name, x, y, player) {
    if (!this.ctx || this.muted) return;
    const dist = Math.hypot(x - player.x, y - player.y);
    if (dist > AUDIO.FALLOFF_RANGE) return;
    const attenuation = Math.max(0, 1 - dist / AUDIO.FALLOFF_RANGE) ** 1.6;
    if (attenuation < 0.04) return;
    this.play(name, attenuation);
  }

  /**
   * Play a named effect. Unknown names are ignored rather than throwing - audio
   * is never allowed to take the game down.
   * @param {number} volume 0..1 scale applied on top of the bus gain
   */
  play(name, volume = 1) {
    if (!this.ctx || this.muted) return;
    const v = Math.max(0, Math.min(1, volume));
    try {
      switch (name) {
        case WEAPON_ID.PISTOL:
          this.#noise(0.13, { gain: 0.5 * v, frequency: 2800, sweepTo: 420 });
          this.#tone(240, 0.09, { type: 'square', gain: 0.16 * v, endFrequency: 70 });
          break;
        case WEAPON_ID.SHOTGUN:
          this.#noise(0.36, { gain: 0.85 * v, frequency: 1900, sweepTo: 150 });
          this.#tone(104, 0.24, { type: 'sawtooth', gain: 0.3 * v, endFrequency: 40 });
          this.#noise(0.16, { gain: 0.22 * v, frequency: 900, sweepTo: 300, delay: 0.22 });
          break;
        case WEAPON_ID.CHAINGUN:
          this.#noise(0.07, { gain: 0.4 * v, frequency: 3400, sweepTo: 700 });
          this.#tone(330, 0.05, { type: 'square', gain: 0.11 * v, endFrequency: 120 });
          break;
        case WEAPON_ID.LANCE:
          this.#tone(880, 0.16, { type: 'sawtooth', gain: 0.2 * v, endFrequency: 220 });
          this.#tone(1320, 0.1, { type: 'triangle', gain: 0.13 * v, endFrequency: 440 });
          this.#noise(0.12, { gain: 0.2 * v, frequency: 3000, sweepTo: 800, filterType: 'bandpass' });
          break;
        case 'explosion':
          this.#noise(0.5, { gain: 0.8 * v, frequency: 1400, sweepTo: 90 });
          this.#tone(80, 0.42, { type: 'sawtooth', gain: 0.32 * v, endFrequency: 30 });
          break;
        case 'dryfire':
          this.#tone(90, 0.06, { type: 'square', gain: 0.12 * v });
          break;
        case 'impact':
          this.#noise(0.09, { gain: 0.28 * v, frequency: 950, sweepTo: 240 });
          break;
        case 'step':
          this.#noise(0.07, { gain: AUDIO.STEP_GAIN * v, frequency: 420, sweepTo: 130 });
          break;
        case 'hurt':
          this.#tone(190, 0.22, { type: 'sawtooth', gain: 0.3 * v, endFrequency: 60 });
          this.#noise(0.16, { gain: 0.24 * v, frequency: 720, sweepTo: 180 });
          break;
        case 'death':
          this.#tone(250, 0.5, { type: 'sawtooth', gain: 0.28 * v, endFrequency: 45 });
          this.#noise(0.44, { gain: 0.32 * v, frequency: 1200, sweepTo: 90 });
          break;
        case 'alert':
          this.#tone(320, 0.2, { type: 'sawtooth', gain: 0.2 * v, endFrequency: 520 });
          this.#noise(0.18, { gain: 0.16 * v, frequency: 1400, sweepTo: 500 });
          break;
        case 'windup':
          this.#tone(180, 0.22, { type: 'triangle', gain: 0.14 * v, endFrequency: 360 });
          break;
        case 'enemyShot':
          this.#tone(520, 0.16, { type: 'triangle', gain: 0.17 * v, endFrequency: 140 });
          break;
        case 'bite':
          this.#noise(0.12, { gain: 0.36 * v, frequency: 1600, sweepTo: 300 });
          break;
        case 'pickup':
          this.#tone(660, 0.09, { type: 'triangle', gain: 0.2 * v, endFrequency: 990 });
          this.#tone(990, 0.12, { type: 'triangle', gain: 0.13 * v, endFrequency: 1320, delay: 0.05 });
          break;
        case 'door':
          this.#noise(0.6, { gain: 0.3 * v, frequency: 440, sweepTo: 120 });
          this.#tone(70, 0.5, { type: 'square', gain: 0.1 * v, endFrequency: 45 });
          break;
        case 'levelClear':
          [523, 659, 784, 1046].forEach((f, i) => {
            this.#tone(f, 0.3, { type: 'triangle', gain: 0.22 * v, delay: i * 0.13 });
          });
          break;
        case 'gameOver':
          [392, 330, 262, 196].forEach((f, i) => {
            this.#tone(f, 0.45, { type: 'sawtooth', gain: 0.22 * v, delay: i * 0.22 });
          });
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.warn(CODES.AUDIO_UNAVAILABLE, 'sound failed', { effect: name, reason: error?.name });
    }
  }

  /* --------------------------------- music -------------------------------- */

  /**
   * A simple procedural score: a driving root-note pulse with a hat on the
   * off-beat. `intensity` (0..1, set from how much trouble the player is in)
   * opens up the pattern so fights feel busier than corridors.
   */
  startMusic() {
    if (!this.ctx || this.musicTimer || this.musicVolume === 0) return;
    const stepMs = 150;
    const roots = [55, 55, 73.42, 65.41];
    this.musicStep = 0;

    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) return;
      try {
        const step = this.musicStep % 16;
        const bar = Math.floor(this.musicStep / 16) % roots.length;
        const root = roots[bar];
        const intensity = this.musicIntensity;

        if (step % 4 === 0) {
          this.#tone(root, 0.22, { type: 'sawtooth', gain: 0.5, bus: this.musicBus });
          this.#tone(root / 2, 0.3, { type: 'square', gain: 0.28, bus: this.musicBus });
        } else if (step % 2 === 0 && intensity > 0.25) {
          this.#tone(root * 1.5, 0.12, { type: 'square', gain: 0.16, bus: this.musicBus });
        }
        if (step % 4 === 2) {
          this.#noise(0.05, { gain: 0.16 + intensity * 0.12, frequency: 7000, filterType: 'highpass', bus: this.musicBus });
        }
        if (intensity > 0.55 && step % 8 === 6) {
          this.#tone(root * 3, 0.1, { type: 'triangle', gain: 0.14, bus: this.musicBus });
        }
        this.musicStep += 1;
      } catch {
        /* a dropped music step is never worth interrupting play for */
      }
    }, stepMs);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** @param {number} intensity 0..1 */
  setMusicIntensity(intensity) {
    this.musicIntensity = Math.max(0, Math.min(1, intensity));
  }
}
