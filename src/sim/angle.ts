/** Maps any angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  const r = a - twoPi * Math.floor((a + Math.PI) / twoPi); // [−π, π)
  return r <= -Math.PI ? r + twoPi : r;
}
