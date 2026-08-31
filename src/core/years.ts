// 年代の重み付け(F-10)。
//
// **作品を年代に単一配属しない。** Met の年代は幅を持つ —— 神奈川沖浪裏は
// `objectDate: "ca. 1830–32"` に対し `objectBeginDate: 1820` / `objectEndDate: 1842` の
// **22 年幅**である(SPEC §2.4)。中点に置けば、実際には知られていない精度を作ってしまう。
//
// ここでは begin–end に**一様配分**する。幅 22 年の作品は 22 年それぞれに 1/22 の重みで効く。
// 幅の狭い作品ほど、その年に強く効く。

export type Dated = { begin: number; end: number };

export type YearPoint = { year: number; mean: number; weight: number };

/**
 * 年ごとの重み付き平均。
 * 重みは 1/(幅)。**幅の広い作品が特定の年を支配しないようにする。**
 */
export function yearlyWeighted<T extends Dated>(works: T[], valueOf: (w: T) => number): YearPoint[] {
  const num = new Map<number, number>();
  const den = new Map<number, number>();
  for (const w of works) {
    if (!Number.isFinite(w.begin) || !Number.isFinite(w.end) || w.end < w.begin) continue;
    const span = w.end - w.begin + 1;
    const v = valueOf(w);
    for (let y = w.begin; y <= w.end; y++) {
      num.set(y, (num.get(y) ?? 0) + v / span);
      den.set(y, (den.get(y) ?? 0) + 1 / span);
    }
  }
  return [...den.keys()]
    .sort((a, b) => a - b)
    .map((y) => ({ year: y, mean: (num.get(y) as number) / (den.get(y) as number), weight: den.get(y) as number }));
}

/** 窓 [lo, hi] の重み付き平均。標本が無ければ NaN(0 を返さない —— 無いことと 0 は違う) */
export function windowMean(series: YearPoint[], lo: number, hi: number): { mean: number; weight: number } {
  let num = 0;
  let den = 0;
  for (const p of series) {
    if (p.year < lo || p.year > hi) continue;
    num += p.mean * p.weight;
    den += p.weight;
  }
  return den > 0 ? { mean: num / den, weight: den } : { mean: NaN, weight: 0 };
}

/**
 * 「青」の面積比(SPEC §5.1 で測定前に宣言した定義)。
 *
 * **これは青系全体であって、ベロ藍ではない。** 露草色(h=235.5°)と藍色(h=236.8°)は
 * 色相角で 1.3° しか離れておらず(SPEC §2.8)、この指標は褪せる青と残る青を分離しない。
 */
export const BLUE_HUE: [number, number] = [200, 270];
export const BLUE_MIN_CHROMA = 0.02;

export function blueShare(plates: { h: number; C: number; share: number }[]): number {
  return hueShare(plates, BLUE_HUE);
}

/**
 * 赤系。**G-目玉2c'-a の対照**(SPEC §5.2 で測定前に宣言)。
 *
 * 顔料史の話なら青だけが増えるはずで、Met が風景版画を多く買ったのなら
 * 増えるのは青だけではないはずである。**赤が同じだけ増えるなら、青に固有ではない。**
 */
export const RED_HUE: [number, number] = [20, 50];

export function redShare(plates: { h: number; C: number; share: number }[]): number {
  return hueShare(plates, RED_HUE);
}

/**
 * 有彩色の面積比の合計。**G-目玉2c'-b の対照**。
 * 摺りが豪華になったのなら、色相を問わず有彩色が増えるはずである。
 */
export function chromaticShare(plates: { h: number; C: number; share: number }[]): number {
  return plates.reduce((a, p) => (p.C >= BLUE_MIN_CHROMA ? a + p.share : a), 0);
}

function hueShare(plates: { h: number; C: number; share: number }[], [lo, hi]: [number, number]): number {
  return plates.reduce((a, p) => (p.h >= lo && p.h < hi && p.C >= BLUE_MIN_CHROMA ? a + p.share : a), 0);
}
