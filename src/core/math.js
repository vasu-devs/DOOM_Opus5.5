/** Small pure math helpers shared by the engine, AI and tests. */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Normalize an angle into (-PI, PI]. */
export function normalizeAngle(angle) {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
}

/** Shortest signed delta to steer `from` toward `to`. */
export const angleDelta = (from, to) => normalizeAngle(to - from);

export const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export const distanceSq = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};

/** Convert a 0..1 depth-fog factor for a given distance. */
export function fogFactor(dist, start, end) {
  if (dist <= start) return 0;
  if (dist >= end) return 1;
  return (dist - start) / (end - start);
}
