// 合成木版の生成器(F-02)。**真値をこちらが決める**ので、抽出器の正解になる。
//
// なぜ必要か(SPEC §2.3):
//   外部に色オラクルは存在しない。シカゴ美術館の color フィールドは画面の 0.5 % を
//   占める色を dominant と称し、作品によっては null を返す。版数もカタログに書かれていない。
//   したがって正解は構成するしかない。
//
// 面積比は**厳密**である。最大剰余法で画素数を割り当てるので、画素を数えれば指定と一致する。
// これが G-02(面積比の絶対誤差 ≤ 0.010)を意味のあるゲートにしている。
//
// 抽出器はこのモジュールを import しない(G-05 / T-016)。

import { deltaE2000, srgbToLab, type RGB } from "./color";
import type { RasterImage } from "./image";
import { createRng, randInt, type Rng } from "./rng";

export type PlateSpec = { rgb: RGB; share: number };

export type PlateTruth = {
  rgb: RGB;
  /** 実際に塗られた画素数 */
  exactPixels: number;
  /** exactPixels / 総画素数 —— これが真の面積比 */
  share: number;
  /** 指定した面積比。realized との差は 1 画素未満 */
  requested: number;
};

export type Synth = {
  image: RasterImage;
  truth: PlateTruth[];
  /** 画素 → 版番号。**抽出器には渡さない**(検査の内側だけで使う) */
  labels: Uint8Array;
};

/**
 * 版色と面積比をランダムに選ぶ。
 * 版色どうしは ΔE2000 で minSeparation 以上離す —— 実際の顔料は互いに明確に違う色であり、
 * 見分けのつかない 2 色を復元させる検査は、抽出器ではなく問題設定のほうが壊れている。
 */
export function randomPlates(rng: Rng, n: number, minSeparation: number): PlateSpec[] {
  const rgbs: RGB[] = [];
  let guard = 0;
  while (rgbs.length < n) {
    if (++guard > 100000) throw new Error(`分離 ${minSeparation} を満たす ${n} 色を引けなかった`);
    const c: RGB = [randInt(rng, 256), randInt(rng, 256), randInt(rng, 256)];
    const lab = srgbToLab(...c);
    if (rgbs.every((o) => deltaE2000(lab, srgbToLab(...o)) >= minSeparation)) rgbs.push(c);
  }

  // 面積比 —— どの版も 2 % 以上は占める(3 画素の版を復元させても何も測れない)
  const MIN_SHARE = 0.02;
  const raw = rgbs.map(() => rng() + 0.15);
  const total = raw.reduce((a, b) => a + b, 0);
  const free = 1 - MIN_SHARE * n;
  return rgbs.map((rgb, i) => ({ rgb, share: MIN_SHARE + (raw[i] / total) * free }));
}

/** 最大剰余法。合計が総画素数に**厳密に**一致する整数配分を返す。 */
function largestRemainder(shares: number[], total: number): number[] {
  const exact = shares.map((s) => s * total);
  const floor = exact.map(Math.floor);
  let rest = total - floor.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floor];
  for (let k = 0; k < rest; k++) out[order[k % order.length].i]++;
  return out;
}

/**
 * タイル単位で版を敷く。タイルの順序をシードで混ぜるので、版は画面上に散らばった塊になる
 * —— 境界が生まれるので、境界混色の劣化(degrade.blurBoundaries)が効く対象になる。
 * 割当は画素単位で数え、割当量が尽きたタイルは途中で次の版に切り替わる(面積比を厳密に保つため)。
 */
export function synthPlates(opts: {
  width: number;
  height: number;
  plates: PlateSpec[];
  seed: number;
  tile?: number;
}): Synth {
  const { width, height, plates, seed } = opts;
  const tile = opts.tile ?? 8;
  const total = width * height;

  const quota = largestRemainder(
    plates.map((p) => p.share),
    total,
  );
  if (quota.reduce((a, b) => a + b, 0) !== total) throw new Error("配分の合計が総画素数と一致しない");

  // タイルの走査順を決定論的に混ぜる(Fisher–Yates を固定シードで)
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const order = Array.from({ length: cols * rows }, (_, i) => i);
  // PRNG は写さずに共通実装を使う(HC-069)
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const labels = new Uint8Array(total);
  const remaining = [...quota];
  let plate = 0;
  const advance = () => {
    while (plate < plates.length && remaining[plate] === 0) plate++;
  };
  advance();

  for (const t of order) {
    const tx = (t % cols) * tile;
    const ty = Math.floor(t / cols) * tile;
    for (let y = ty; y < Math.min(ty + tile, height); y++) {
      for (let x = tx; x < Math.min(tx + tile, width); x++) {
        advance();
        if (plate >= plates.length) throw new Error("配分が尽きた — 最大剰余法の不変量が壊れている");
        labels[y * width + x] = plate;
        remaining[plate]--;
      }
    }
  }
  if (remaining.some((r) => r !== 0)) throw new Error("配分が余った — 走査がすべての画素を訪れていない");

  const data = new Uint8ClampedArray(total * 4);
  const counts = new Array(plates.length).fill(0);
  for (let i = 0; i < total; i++) {
    const c = plates[labels[i]].rgb;
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
    counts[labels[i]]++;
  }

  const truth: PlateTruth[] = plates.map((p, i) => {
    if (counts[i] !== quota[i]) throw new Error("塗った画素数が配分と一致しない");
    const share = counts[i] / total;
    // 最大剰余法の不変量: 実現値と指定値の差は 1 画素未満
    if (Math.abs(share - p.share) > 1 / total + 1e-12) {
      throw new Error(`面積比の実現値が指定から 1 画素以上ずれた(版 ${i})`);
    }
    return { rgb: p.rgb, exactPixels: counts[i], share, requested: p.share };
  });

  return { image: { data, width, height }, truth, labels };
}
