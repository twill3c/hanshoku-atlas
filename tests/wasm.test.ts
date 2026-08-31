// T-023〜T-026 — TS 実装と Rust/WASM 実装の照合(F-08 / G-08)。
//
// **結論だけでなく経路も比べる**(HC-065)。最終的な重心が一致したことは、
// 同じ理由で一致したことを意味しない。反復回数と各反復の割当変更数まで見る。
//
// 陽性対照: `variant: 1` は**同じ答えに別の経路で着く**(収束を 2 回連続で要求する)。
// 結論だけを見る照合はこれを緑のまま通す。経路を見る照合だけが落とせる。
//
// 期待値の出所: どちらも実装なので「期待値」は無い。**一致するかどうかを測る**。
// 一致しうる根拠は SPEC §2.10(演算は加減乗除と比較のみ・順序を揃えてある)。

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRng } from "@/core/rng";
import { srgbToOklab } from "@/core/color";
import { kmeans, type KMeansResult } from "@/core/kmeans";
import { makeWasmKmeans, type WasmKmeans } from "@/core/wasm";
import { addNoise, chromaSubsample420 } from "@/core/degrade";
import { randomPlates, synthPlates } from "@/core/synth";

const SEED = 20260831;
let wasmKmeans: WasmKmeans;

beforeAll(async () => {
  // 既定は**出荷している** wasm。`HANSHOKU_WASM` を渡すと別のものを試せる ——
  // CI はその場でビルドした wasm でも同じ照合を回し、
  // **`rust/src/lib.rs` を直して出荷 wasm を更新し忘れた**状態を捕まえる。
  //
  // **バイト一致では検査しない。** ビルドする Rust の版が違えば生成物のバイトは変わるので、
  // 「出荷 wasm とビルド結果が同一バイト」は原理的に達成できない(HC-073 —— 達成不能な閾値を掲げない)。
  // 比べるのは**振る舞い**である。
  const path = process.env.HANSHOKU_WASM ?? fileURLToPath(new URL("../public/hanshoku.wasm", import.meta.url));
  wasmKmeans = await makeWasmKmeans(readFileSync(path));
});

/** 画像を「相異なる色 → OKLab 点 + 重み」に畳む。**この変換は両実装で共有する**(境界の外) */
function fold(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const index = new Map<number, number>();
  const keys: number[] = [];
  const counts: number[] = [];
  const n = img.width * img.height;
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
  }
  const points = new Float64Array(keys.length * 3);
  const weights = new Float64Array(keys.length);
  keys.forEach((key, id) => {
    const lab = srgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255);
    points[id * 3] = lab[0];
    points[id * 3 + 1] = lab[1];
    points[id * 3 + 2] = lab[2];
    weights[id] = counts[id];
  });
  return { points, weights };
}

type Case = { n: number; points: Float64Array; weights: Float64Array };

function buildCases(count: number, degraded: boolean): Case[] {
  const rng = createRng(SEED);
  const out: Case[] = [];
  for (let i = 0; i < count; i++) {
    const n = 3 + (i % 10);
    const s = synthPlates({ width: 120, height: 80, plates: randomPlates(rng, n, 12), seed: SEED + i, tile: 8 });
    const img = degraded ? chromaSubsample420(addNoise(s.image, 2, SEED + 1)) : s.image;
    out.push({ n, ...fold(img) });
  }
  return out;
}

const clean = buildCases(12, false);
const noisy = buildCases(12, true);

/** ビット一致の比較。**NaN も -0 も区別する**(Object.is) */
function sameFloats(a: ArrayLike<number>, b: ArrayLike<number>): string | null {
  if (a.length !== b.length) return `長さが違う(${a.length} / ${b.length})`;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return `添字 ${i} で ${a[i]} ≠ ${b[i]}`;
  }
  return null;
}

function compare(ts: KMeansResult, wa: KMeansResult): string[] {
  const problems: string[] = [];
  const c = sameFloats(ts.centroids, wa.centroids);
  if (c) problems.push(`重心: ${c}`);
  const a = sameFloats(ts.assign, wa.assign);
  if (a) problems.push(`割当: ${a}`);
  const w = sameFloats(ts.weights, wa.weights);
  if (w) problems.push(`クラスタ重み: ${w}`);
  if (!Object.is(ts.inertia, wa.inertia)) problems.push(`慣性: ${ts.inertia} ≠ ${wa.inertia}`);
  // ---- ここから経路(HC-065)
  if (ts.iterations !== wa.iterations) problems.push(`反復回数: ${ts.iterations} ≠ ${wa.iterations}`);
  const it = sameFloats(ts.inertiaTrace, wa.inertiaTrace);
  if (it) problems.push(`慣性の履歴: ${it}`);
  const ch = sameFloats(ts.changesTrace, wa.changesTrace);
  if (ch) problems.push(`割当変更数の履歴: ${ch}`);
  return problems;
}

describe("標本の前提", () => {
  it("無劣化と標準条件の両方を持ち、標準条件は点数が桁で多い", () => {
    // HC-079: 対照が成り立つ前提を assert で固定する
    expect(clean.length).toBe(12);
    expect(noisy.length).toBe(12);
    for (let i = 0; i < clean.length; i++) {
      expect(clean[i].weights.length).toBe(clean[i].n); // 無劣化は 相異なる色 = 版数
      expect(noisy[i].weights.length).toBeGreaterThan(clean[i].n * 20);
    }
  });
});

describe("T-023 PRNG が言語をまたいで一致する", () => {
  it("k-means++ の初期中心が一致する = 乱数列が一致している", () => {
    // 直接 PRNG は公開していないので、**乱数を消費する経路の出力**で見る。
    // 初期中心が全標本で一致するなら、消費した乱数列は一致している。
    for (const c of noisy) {
      const ts = kmeans(c.points, c.weights, c.n, { seed: SEED, maxIter: 1 });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed: SEED, maxIter: 1 });
      expect(sameFloats(ts.centroids, wa.centroids), `k=${c.n}`).toBeNull();
    }
  });
});

describe("T-024 (G-08) 二実装照合 —— 結論も経路もビット一致", () => {
  it.each([
    ["無劣化", clean],
    ["標準条件", noisy],
  ] as const)("%s の 12 標本すべてで一致", (_label, cases) => {
    for (const c of cases) {
      const ts = kmeans(c.points, c.weights, c.n, { seed: SEED });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed: SEED });
      expect(compare(ts, wa), `k=${c.n}`).toEqual([]);
    }
  });

  it("退化初期化でも一致する", () => {
    for (const c of noisy) {
      const ts = kmeans(c.points, c.weights, c.n, { seed: SEED, init: "degenerate" });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed: SEED, init: "degenerate" });
      expect(compare(ts, wa), `k=${c.n}`).toEqual([]);
    }
  });

  it("シードを変えても一致する", () => {
    for (const seed of [1, 2, 7, 4294967295]) {
      const c = noisy[0];
      const ts = kmeans(c.points, c.weights, c.n, { seed });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed });
      expect(compare(ts, wa), `seed=${seed}`).toEqual([]);
    }
  });
});

describe("T-025 (G-08 陽性対照) 経路だけをずらすと照合が落ちる", () => {
  // HC-065: 照合が経路を見ていることを、経路だけ違う実装で確かめる。
  // variant 1 は収束を 2 回連続で要求するので、**答えは同じで反復が 1 回多い**。
  it("経路をずらした実装は、経路の比較で落ちる", () => {
    let caught = 0;
    for (const c of noisy) {
      const ts = kmeans(c.points, c.weights, c.n, { seed: SEED });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed: SEED, variant: 1 });
      const problems = compare(ts, wa);
      if (problems.length > 0) caught++;
      // 落ちる理由が**経路**であることまで確かめる
      if (problems.length > 0) {
        expect(problems.some((p) => p.startsWith("反復回数") || p.includes("履歴"))).toBe(true);
      }
    }
    expect(caught, "経路をずらしたのに 1 件も落ちなかった").toBe(noisy.length);
  });

  it("結論だけを見る照合は、経路をずらした実装を通してしまう", () => {
    // **この検査が「経路を見る意味」を示す。** 重心・割当・慣性だけなら一致する
    let sameConclusion = 0;
    for (const c of noisy) {
      const ts = kmeans(c.points, c.weights, c.n, { seed: SEED });
      const wa = wasmKmeans(c.points, c.weights, c.n, { seed: SEED, variant: 1 });
      const conclusionOnly =
        sameFloats(ts.centroids, wa.centroids) === null &&
        sameFloats(ts.assign, wa.assign) === null &&
        Object.is(ts.inertia, wa.inertia);
      if (conclusionOnly) sameConclusion++;
    }
    expect(sameConclusion, "結論まで違うなら、これは経路の対照になっていない").toBe(noisy.length);
  });
});

describe("T-026 WASM の入力を作り直しても壊れない", () => {
  it("同じ実装を続けて呼んでも結果が変わらない(ポインタの掴み置きが無い)", () => {
    const a = wasmKmeans(noisy[0].points, noisy[0].weights, noisy[0].n, { seed: SEED });
    // 途中で別の大きさを流し、メモリが伸びうる状況を作る
    wasmKmeans(noisy[11].points, noisy[11].weights, noisy[11].n, { seed: SEED });
    const b = wasmKmeans(noisy[0].points, noisy[0].weights, noisy[0].n, { seed: SEED });
    expect(compare(a, b)).toEqual([]);
  });
});
