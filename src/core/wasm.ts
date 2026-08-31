// Rust/WASM 実装の呼び出し口(F-08)。
//
// **速いから使うのではない。**同じ計算を二度、別の言語で書いて突き合わせるためにある。
// 一致は結論だけでなく**経路**(反復回数・各反復の割当変更数)まで見る(G-08 / HC-065)。
//
// 境界の位置は意図的である —— WASM が受け取るのは**変換済みの OKLab 点**で、
// sRGB → OKLab は JS 側に残してある。変換は `cbrt` を使い、`cbrt` は実装ごとに
// 最終桁が違いうるので、そこを跨がせるとビット一致は原理的に達成できない(HC-073)。
// この境界の内側の演算は加減乗除と比較だけで、IEEE-754 が結果を一意に定める。

import type { KMeansInit, KMeansResult } from "./kmeans";

type Exports = {
  memory: WebAssembly.Memory;
  alloc(n: number, k: number, maxIter: number): void;
  points_ptr(): number;
  weights_ptr(): number;
  centroids_ptr(): number;
  assign_ptr(): number;
  cweights_ptr(): number;
  inertia_trace_ptr(): number;
  changes_trace_ptr(): number;
  trace_len(): number;
  inertia(): number;
  run(k: number, seed: number, maxIter: number, tol: number, init: number, variant: number): number;
};

export type WasmKmeansOptions = {
  seed: number;
  maxIter?: number;
  tol?: number;
  init?: KMeansInit;
  /** 1 にすると**同じ答えに別の経路で着く**(収束を 2 回連続で要求する)。G-08 の陽性対照用 */
  variant?: number;
};

export type WasmKmeans = (
  points: Float64Array,
  weights: Float64Array,
  k: number,
  opts: WasmKmeansOptions,
) => KMeansResult;

/** 取得済みのバイト列から実装を組み立てる。取得方法は呼び出し側の都合に任せる。 */
export async function makeWasmKmeans(bytes: BufferSource): Promise<WasmKmeans> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports as unknown as Exports;

  return (points, weights, k, opts) => {
    const n = weights.length;
    if (points.length !== n * 3) throw new Error("points と weights の長さが合わない");
    if (k < 1) throw new Error("k は 1 以上");
    if (k > n) throw new Error(`k=${k} が相異なる点の数 ${n} を超えている`);

    const maxIter = opts.maxIter ?? 100;
    const tol = opts.tol ?? 1e-10;

    ex.alloc(n, k, maxIter);
    // **ポインタは alloc のたびに取り直す。** 掴み置くと、再確保でメモリが伸びたときに
    // 古い ArrayBuffer を指したままになる(detached / 別領域)
    new Float64Array(ex.memory.buffer, ex.points_ptr(), n * 3).set(points);
    new Float64Array(ex.memory.buffer, ex.weights_ptr(), n).set(weights);

    const iterations = ex.run(
      k,
      opts.seed >>> 0,
      maxIter,
      tol,
      opts.init === "degenerate" ? 1 : 0,
      opts.variant ?? 0,
    );

    const len = ex.trace_len();
    const buf = ex.memory.buffer;
    return {
      centroids: new Float64Array(buf, ex.centroids_ptr(), k * 3).slice(),
      assign: new Uint32Array(buf, ex.assign_ptr(), n).slice(),
      weights: new Float64Array(buf, ex.cweights_ptr(), k).slice(),
      inertia: ex.inertia(),
      iterations,
      inertiaTrace: Array.from(new Float64Array(buf, ex.inertia_trace_ptr(), len)),
      changesTrace: Array.from(new Uint32Array(buf, ex.changes_trace_ptr(), len)),
    };
  };
}
