// 版色の抽出(F-01)。画像 → OKLab 上の重み付き k-means → 版色・面積比・OKLCh。
//
// 木版画は一版一色の平面色で構成される。だから画像の色は連続分布ではなく、
// 版の数だけの離散クラスタを成している**はず**である —— その「はず」が
// どこまで成り立つかを測るのが G-01〜G-03 と G-目玉1 である。
//
// **このモジュールは真値も生成器も見ない**(G-05 / T-016)。入力は画素バッファだけ。

import {
  oklabToOklch,
  oklabToSrgb,
  rgbToHex,
  srgbToOklab,
  type OKLCh,
  type OKLab,
  type RGB,
} from "./color";
import type { RasterImage } from "./image";
import { kmeans, type KMeansInit } from "./kmeans";

export type Plate = {
  index: number;
  rgb: RGB;
  hex: string;
  oklab: OKLab;
  oklch: OKLCh;
  /** 面積比。全版の和は 1 */
  share: number;
  pixels: number;
};

export type Extraction = {
  plates: Plate[];
  /** 画素 → 版番号。版のマスク表示(F-03)に使う */
  assign: Uint32Array;
  inertia: number;
  iterations: number;
  inertiaTrace: number[];
  changesTrace: number[];
  /** 相異なる色の数。k はこれを超えられない */
  distinctColors: number;
};

/**
 * 相異なる色に畳む。画素をそのまま k-means に入れるのと**結果は厳密に同じ**で、
 * 24 万画素の版画でも相異なる色は桁で少ない。
 */
function foldColors(img: RasterImage): {
  points: Float64Array;
  weights: Float64Array;
  keyOf: Uint32Array;
  index: Map<number, number>;
} {
  const n = img.width * img.height;
  const index = new Map<number, number>();
  const keyOf = new Uint32Array(n);
  const keys: number[] = [];
  const counts: number[] = [];

  for (let i = 0; i < n; i++) {
    const key = (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
    let id = index.get(key);
    if (id === undefined) {
      id = keys.length;
      index.set(key, id);
      keys.push(key);
      counts.push(0);
    }
    counts[id]++;
    keyOf[i] = id;
  }

  const points = new Float64Array(keys.length * 3);
  const weights = new Float64Array(keys.length);
  for (let id = 0; id < keys.length; id++) {
    const key = keys[id];
    const lab = srgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255);
    points[id * 3] = lab[0];
    points[id * 3 + 1] = lab[1];
    points[id * 3 + 2] = lab[2];
    weights[id] = counts[id];
  }
  return { points, weights, keyOf, index };
}

/**
 * 既定の再始動回数。
 *
 * **なぜ要るか(実測 2026-08-31):** k-means++ は初期値によっては悪い局所解に落ちる。
 * 標準条件(ノイズ σ=2 + クロマ間引き)の合成木版 60 枚のうち 5 枚で、単一始動だと
 * 版が潰れて ΔE2000 が 33〜76 に飛んだ。**そのとき慣性は 12〜48 で、正解側の 1.5〜1.9 と
 * 桁で違っていた** —— つまり慣性は良し悪しの完全な判別子として働く。
 * 再始動して慣性最小を採ると 5 枚すべてが復元された。
 *
 * **回数の決め方(実測 2026-08-31):** 同じ 60 枚で回数を振ると
 * `1 回 → 閾値超過 5/60・最大 ΔE 76.35`、`2 回以降 → 0/60・最大 0.30` で、
 * 2 回で頭打ちになる。**4 を既定にしたのは 2 では余裕が無いため** ——
 * 合成木版の相異なる色は 3,200 前後だが、実際の版画(神奈川沖浪裏 JP10)は
 * **55,100** で一桁多い。標本で頭打ちになった値をそのまま本番の既定にしない。
 */
const DEFAULT_RESTARTS = 4;

export function extractPlates(
  img: RasterImage,
  opts: { k: number; seed?: number; init?: KMeansInit; maxIter?: number; restarts?: number },
): Extraction {
  const { points, weights, keyOf } = foldColors(img);
  const distinct = weights.length;
  const k = Math.min(opts.k, distinct);
  const total = img.width * img.height;
  const baseSeed = opts.seed ?? 0;
  // 退化初期化(陽性対照)は乱数を使わないので再始動しても同じ結果になる。1 回で足りる
  const restarts = opts.init === "degenerate" ? 1 : (opts.restarts ?? DEFAULT_RESTARTS);

  // 慣性最小の解を採る。同値なら添字の小さい始動 —— 決定論を保つ(G-06)
  let res = kmeans(points, weights, k, { seed: baseSeed, init: opts.init, maxIter: opts.maxIter });
  for (let r = 1; r < restarts; r++) {
    const cand = kmeans(points, weights, k, {
      seed: (baseSeed + r) >>> 0,
      init: opts.init,
      maxIter: opts.maxIter,
    });
    if (cand.inertia < res.inertia) res = cand;
  }

  const assign = new Uint32Array(total);
  for (let i = 0; i < total; i++) assign[i] = res.assign[keyOf[i]];

  const plates: Plate[] = [];
  for (let j = 0; j < k; j++) {
    const oklab: OKLab = [res.centroids[j * 3], res.centroids[j * 3 + 1], res.centroids[j * 3 + 2]];
    const rgb = oklabToSrgb(oklab);
    plates.push({
      index: j,
      rgb,
      hex: rgbToHex(rgb),
      oklab,
      oklch: oklabToOklch(oklab),
      pixels: res.weights[j],
      share: res.weights[j] / total,
    });
  }

  // 面積の大きい順に並べ替える。**index は並べ替え後の位置に振り直し、assign も追随させる**
  // —— 表示順と assign の添字が食い違うと、マスクが別の版を光らせる(HC-045)。
  const order = plates
    .map((p, j) => ({ j, share: p.share }))
    .sort((a, b) => b.share - a.share || a.j - b.j);
  const remap = new Uint32Array(k);
  order.forEach((o, newIdx) => (remap[o.j] = newIdx));
  for (let i = 0; i < total; i++) assign[i] = remap[assign[i]];
  const sorted = order.map((o, newIdx) => ({ ...plates[o.j], index: newIdx }));

  return {
    plates: sorted,
    assign,
    inertia: res.inertia,
    iterations: res.iterations,
    inertiaTrace: res.inertiaTrace,
    changesTrace: res.changesTrace,
    distinctColors: distinct,
  };
}

// ---------------------------------------------------------------- エルボー

export type ElbowPoint = { k: number; inertia: number };

export function elbowCurve(
  img: RasterImage,
  opts: { kMin: number; kMax: number; seed?: number; restarts?: number },
): ElbowPoint[] {
  const out: ElbowPoint[] = [];
  for (let k = opts.kMin; k <= opts.kMax; k++) {
    const ex = extractPlates(img, { k, seed: opts.seed, restarts: opts.restarts });
    out.push({ k, inertia: ex.inertia });
    if (ex.plates.length < k) break; // 相異なる色を使い切った
  }
  return out;
}

/**
 * **既定の選択規則(G-目玉1 が判定するのはこの規則である)。**
 *
 * 曲線の両端 (kMin, I_min) と (kMax, I_max) を結ぶ直線から最も遠い点を選ぶ。
 * 慣性は k に対して桁で落ちるので、**対数を取ってから**正規化する ——
 * 生の値のままだと最初の 1 段だけが巨大になり、常に kMin+1 が選ばれる。
 */
export function chooseK(curve: ElbowPoint[]): number {
  if (curve.length === 0) throw new Error("曲線が空");
  if (curve.length <= 2) return curve[0].k;

  const eps = 1e-12;
  const xs = curve.map((p) => p.k);
  const ys = curve.map((p) => Math.log(p.inertia + eps));

  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];

  const nx = (x: number) => (x - x0) / (x1 - x0 || 1);
  const ny = (y: number) => (y - y0) / (y1 - y0 || 1);

  let best = curve[0].k;
  let bestD = -Infinity;
  for (let i = 0; i < curve.length; i++) {
    // 正規化後の弦は (0,0)-(1,1)。慣性は凸に落ちるので曲線は弦の**下**を通り、
    // 肘では ny が nx を最も上回る。符号を逆にすると常に端点(k=kMin)が選ばれる ——
    // 無劣化の合成木版では慣性が 1e-29 まで落ちて対数が端点を支配するため、
    // 符号を誤ったままでも的中率 1.000 に見えた(実測 2026-08-31)。
    const d = ny(ys[i]) - nx(xs[i]);
    if (d > bestD) {
      bestD = d;
      best = curve[i].k;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 地色(F-06)

/**
 * 紙の地色**候補**を提案する。判定ではない。
 *
 * 地色を版色に数えるかは分析者の判断であり、その判断が入る場所を隠さないことが
 * この画面の設計思想である(SPEC F-06)。ここが返すのはあくまで候補で、
 * UI は「これが地色です」と断定しない(HC-079 —— 裏づけの無い記号を出さない)。
 *
 * 規則: 明るく彩度が低い版のうち、最も面積の大きいもの。
 */
export function suggestPaperIndex(plates: Plate[]): { index: number; reason: string } | null {
  const candidates = plates.filter((p) => p.oklch.L > 0.75 && p.oklch.C < 0.06);
  if (candidates.length === 0) return null;
  const pick = candidates.reduce((a, b) => (b.share > a.share ? b : a));
  return {
    index: pick.index,
    reason: `明度 L=${pick.oklch.L.toFixed(3)} / 彩度 C=${pick.oklch.C.toFixed(3)} で、この条件を満たす版のうち最大(面積 ${(pick.share * 100).toFixed(1)} %)`,
  };
}

/** 指定した版を除き、残りの面積比を再正規化する。 */
export function withoutPlate(plates: Plate[], index: number): Plate[] {
  const rest = plates.filter((p) => p.index !== index);
  const sum = rest.reduce((a, p) => a + p.share, 0);
  if (sum <= 0) return [];
  return rest.map((p) => ({ ...p, share: p.share / sum }));
}
