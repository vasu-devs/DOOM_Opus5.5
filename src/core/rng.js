/**
 * Deterministic PRNG (mulberry32). Deterministic runs make the autoplay agent
 * reproducible and let tests assert on generated content.
 */
export class Rng {
  /** @param {number} seed */
  constructor(seed = 0x9e3779b9) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** @returns {number} float in [0,1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {number} float in [min,max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** @returns {number} integer in [min,max] */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** @returns {boolean} true with probability p */
  chance(p) {
    return this.next() < p;
  }

  pick(items) {
    return items[this.int(0, items.length - 1)];
  }

  reset(seed = this.seed) {
    this.state = seed >>> 0;
  }
}
