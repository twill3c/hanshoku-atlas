// 重み付き k-means(Lloyd 法)+ k-means++ 初期化。
//
// 決定論であること(G-06)がこの実装の要求である。乱数は createRng だけを使い、
// 同点の扱いも順序で決める —— 浮動小数の同点で分岐すると、同じ入力でも
// 環境によって結果が変わりうる(HC-073)。
//
// 重みを取るのは、画像の画素をそのまま入れず**相異なる色に畳んでから**渡すため。
// 600×410 の版画でも相異なる色は桁で少なく、結果は厳密に同じになる。
//
// このモジュールは合成木版の生成器(synth.ts)も真値も参照しない(G-05 / T-016)。

import { createRng, type Rng } from "./rng";

export type KMeansInit = "kmeans++" | "degenerate";

export type KMeansOptions = {
  seed: number;
  maxIter?: number;
  tol?: number;
  init?: KMeansInit;
};

export type KMeansResult = {
  /** k × 3 の重心 */
  centroids: Float64Array;
  /** 各点の所属クラスタ */
  assign: Uint32Array;
  /** 各クラスタの重み合計 */
  weights: Float64Array;
  inertia: number;
  iterations: number;
  /** 反復ごとの慣性(T-008 が単調非増加を検査する) */
  inertiaTrace: number[];
  /** 反復ごとの割当変更数。**経路の比較に使う**(G-08 / HC-065) */
  changesTrace: number[];
};

function sqDist(p: Float64Array, i: number, c: Float64Array, j: number): number {
  const d0 = p[i * 3] - c[j * 3];
  const d1 = p[i * 3 + 1] - c[j * 3 + 1];
  const d2 = p[i * 3 + 2] - c[j * 3 + 2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

/**
 * k-means++ の初期中心。重み付き版 —— 面積の大きい色ほど選ばれやすい。
 * 木版画では「大きな平面色ほど版として重要」なので、これは妥当な事前分布になる。
 */
function initPlusPlus(points: Float64Array, weights: Float64Array, k: number, rng: Rng): Float64Array {
  const n = weights.length;
  const centroids = new Float64Array(k * 3);
  const best = new Float64Array(n).fill(Infinity);

  // 1 個目は重み付きで引く
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  let target = rng() * total;
  let first = n - 1;
  for (let i = 0; i < n; i++) {
    target -= weights[i];
    if (target <= 0) {
      first = i;
      break;
    }
  }
  centroids[0] = points[first * 3];
  centroids[1] = points[first * 3 + 1];
  centroids[2] = points[first * 3 + 2];

  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = sqDist(points, i, centroids, c - 1);
      if (d < best[i]) best[i] = d;
      sum += best[i] * weights[i];
    }
    let t = rng() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      t -= best[i] * weights[i];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
    centroids[c * 3] = points[pick * 3];
    centroids[c * 3 + 1] = points[pick * 3 + 1];
    centroids[c * 3 + 2] = points[pick * 3 + 2];
  }
  return centroids;
}

/**
 * 退化した初期化 —— **陽性対照専用**(G-04 / T-012)。
 * 先頭の k 点をそのまま初期中心に採る。入力が空間的に並んでいると同じ版に集中し、
 * k-means は局所解に落ちる。正常な初期化が実際に効いていることを示すために置く。
 */
function initFirst(points: Float64Array, k: number): Float64Array {
  const centroids = new Float64Array(k * 3);
  for (let c = 0; c < k; c++) {
    centroids[c * 3] = points[c * 3];
    centroids[c * 3 + 1] = points[c * 3 + 1];
    centroids[c * 3 + 2] = points[c * 3 + 2];
  }
  return centroids;
}

export function kmeans(
  points: Float64Array,
  weights: Float64Array,
  k: number,
  opts: KMeansOptions,
): KMeansResult {
  const n = weights.length;
  if (k < 1) throw new Error("k は 1 以上");
  if (points.length !== n * 3) throw new Error("points と weights の長さが合わない");
  if (k > n) throw new Error(`k=${k} が相異なる点の数 ${n} を超えている`);

  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-10;
  const rng = createRng(opts.seed);

  let centroids =
    (opts.init ?? "kmeans++") === "degenerate" ? initFirst(points, k) : initPlusPlus(points, weights, k, rng);

  const assign = new Uint32Array(n).fill(0xffffffff);
  const sums = new Float64Array(k * 3);
  const wsum = new Float64Array(k);
  const inertiaTrace: number[] = [];
  const changesTrace: number[] = [];

  let iterations = 0;
  let inertia = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    let changes = 0;
    let obj = 0;

    sums.fill(0);
    wsum.fill(0);

    for (let i = 0; i < n; i++) {
      let bestJ = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = sqDist(points, i, centroids, j);
        // 同点は添字の小さい方。浮動小数の同点で結果が揺れないようにする
        if (d < bestD) {
          bestD = d;
          bestJ = j;
        }
      }
      if (assign[i] !== bestJ) {
        assign[i] = bestJ;
        changes++;
      }
      const w = weights[i];
      obj += bestD * w;
      wsum[bestJ] += w;
      sums[bestJ * 3] += points[i * 3] * w;
      sums[bestJ * 3 + 1] += points[i * 3 + 1] * w;
      sums[bestJ * 3 + 2] += points[i * 3 + 2] * w;
    }

    inertiaTrace.push(obj);
    changesTrace.push(changes);

    // 空クラスタは、最も遠い点を割り当て直して埋める(決定論的に選ぶ)
    for (let j = 0; j < k; j++) {
      if (wsum[j] > 0) continue;
      let far = 0;
      let farD = -1;
      for (let i = 0; i < n; i++) {
        const d = sqDist(points, i, centroids, assign[i]);
        if (d > farD) {
          farD = d;
          far = i;
        }
      }
      centroids[j * 3] = points[far * 3];
      centroids[j * 3 + 1] = points[far * 3 + 1];
      centroids[j * 3 + 2] = points[far * 3 + 2];
      wsum[j] = 0;
    }

    const next = new Float64Array(k * 3);
    for (let j = 0; j < k; j++) {
      if (wsum[j] > 0) {
        next[j * 3] = sums[j * 3] / wsum[j];
        next[j * 3 + 1] = sums[j * 3 + 1] / wsum[j];
        next[j * 3 + 2] = sums[j * 3 + 2] / wsum[j];
      } else {
        next[j * 3] = centroids[j * 3];
        next[j * 3 + 1] = centroids[j * 3 + 1];
        next[j * 3 + 2] = centroids[j * 3 + 2];
      }
    }

    let shift = 0;
    for (let j = 0; j < k * 3; j++) shift += (next[j] - centroids[j]) * (next[j] - centroids[j]);
    centroids = next;
    inertia = obj;

    if (changes === 0 && shift <= tol) break;
  }

  // 最後の重心に対して割当と慣性を取り直す(重心移動の後の値を返すため)
  let obj = 0;
  wsum.fill(0);
  for (let i = 0; i < n; i++) {
    let bestJ = 0;
    let bestD = Infinity;
    for (let j = 0; j < k; j++) {
      const d = sqDist(points, i, centroids, j);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    assign[i] = bestJ;
    obj += bestD * weights[i];
    wsum[bestJ] += weights[i];
  }
  inertia = obj;

  return {
    centroids,
    assign,
    weights: wsum.slice(),
    inertia,
    iterations,
    inertiaTrace,
    changesTrace,
  };
}
