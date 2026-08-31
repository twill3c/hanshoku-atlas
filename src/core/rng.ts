// シード付き PRNG — mulberry32(フリート共通実装)。
// core 内で Math.random() を使わない。抽出結果の決定論(G-06)はここに依存する。
// nanpure-forge の Rust 実装(rust/src/lib.rs の Mulberry32)とビット単位で同じ仕様。

export type Rng = () => number;

/** [0, 1) の一様乱数を返す決定論的 PRNG を作る */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) の整数 */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}
