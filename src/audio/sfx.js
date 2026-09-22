import { AUDIO, WEAPON_ID } from '../core/constants.js';
import { CODES } from '../core/logger.js';

/**
 * Procedural sound. Every effect is synthesised with oscillators and shaped
 * noise at runtime - there are no audio files in this repository.
 *
 * The AudioContext is created lazily on the first user gesture, which is what
 * browsers require, and every call is wrapped so a missing/blocked audio device
 * degrades to silence instead of breaking the game loop.
 */
export class Sfx {
  /** @param {{logger: import('../core/logger.js').Logger}} deps */
  constructor({ logger }) {
    this.logger = logger;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
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
        this.master.gain.value = AUDIO.MASTER_GAIN;
        this.master.connect(this.ctx.destination);
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

  #noise(duration, { gain = 0.5, filterType = 'lowpass', frequency = 1200, sweepTo = null }) {
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

    source.connect(filter).connect(envelope).connect(this.master);
    source.start();
    source.stop(this.ctx.currentTime + duration);
  }

  #tone(frequency, duration, { type = 'square', gain = 0.3, endFrequency = null } = {}) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), this.ctx.currentTime + duration);
    }
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, this.ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(envelope).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  /**
   * Play a named effect. Unknown names are ignored rather than throwing - audio
   * is never allowed to take the game down.
   */
  play(name) {
    if (!this.ctx || this.muted) return;
    try {
      switch (name) {
        case WEAPON_ID.PISTOL:
          this.#noise(0.13, { gain: 0.55, frequency: 2600, sweepTo: 420 });
          this.#tone(220, 0.09, { type: 'square', gain: 0.18, endFrequency: 70 });
          break;
        case WEAPON_ID.SHOTGUN:
          this.#noise(0.34, { gain: 0.85, frequency: 1800, sweepTo: 160 });
          this.#tone(110, 0.22, { type: 'sawtooth', gain: 0.28, endFrequency: 42 });
          break;
        case WEAPON_ID.CHAINGUN:
          this.#noise(0.07, { gain: 0.42, frequency: 3200, sweepTo: 700 });
          this.#tone(320, 0.05, { type: 'square', gain: 0.12, endFrequency: 120 });
          break;
        case 'dryfire':
          this.#tone(90, 0.06, { type: 'square', gain: 0.12 });
          break;
        case 'impact':
          this.#noise(0.09, { gain: 0.3, frequency: 900, sweepTo: 240 });
          break;
        case 'hurt':
          this.#tone(180, 0.22, { type: 'sawtooth', gain: 0.3, endFrequency: 60 });
          this.#noise(0.16, { gain: 0.25, frequency: 700, sweepTo: 180 });
          break;
        case 'death':
          this.#tone(260, 0.5, { type: 'sawtooth', gain: 0.3, endFrequency: 45 });
          this.#noise(0.42, { gain: 0.35, frequency: 1200, sweepTo: 90 });
          break;
        case 'enemyShot':
          this.#tone(520, 0.16, { type: 'triangle', gain: 0.18, endFrequency: 140 });
          break;
        case 'bite':
          this.#noise(0.12, { gain: 0.4, frequency: 1500, sweepTo: 300 });
          break;
        case 'pickup':
          this.#tone(660, 0.09, { type: 'triangle', gain: 0.22, endFrequency: 990 });
          this.#tone(990, 0.12, { type: 'triangle', gain: 0.14, endFrequency: 1320 });
          break;
        case 'door':
          this.#noise(0.55, { gain: 0.3, frequency: 420, sweepTo: 130 });
          break;
        case 'levelClear':
          [523, 659, 784, 1046].forEach((f, i) => {
            setTimeout(() => this.ctx && this.#tone(f, 0.26, { type: 'triangle', gain: 0.24 }), i * 130);
          });
          break;
        case 'gameOver':
          [392, 330, 262, 196].forEach((f, i) => {
            setTimeout(() => this.ctx && this.#tone(f, 0.42, { type: 'sawtooth', gain: 0.24 }), i * 220);
          });
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.warn(CODES.AUDIO_UNAVAILABLE, 'sound failed', { effect: name, reason: error?.name });
    }
  }
}
