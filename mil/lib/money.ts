export type Split = 'equal' | 'meals' | 'room' | 'selected';

/** Split `total` poisha by integer `weights`; shares sum exactly to `total`.
 *  Largest remainder, ties to the lowest index. Null when every weight is 0. */
export function allocate(total: number, weights: number[]): number[] | null {
  if (!Number.isInteger(total) || !weights.every(Number.isInteger)) throw new TypeError('allocate needs integers');
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) return null;
  const shares = weights.map(w => Math.floor((total * w) / sumW));
  const order = weights.map((w, i) => ({ i, r: (total * w) % sumW })).sort((a, b) => b.r - a.r || a.i - b.i);
  let left = total - shares.reduce((a, b) => a + b, 0);
  for (const { i } of order) { if (left-- <= 0) break; shares[i]++; }
  return shares;
}
