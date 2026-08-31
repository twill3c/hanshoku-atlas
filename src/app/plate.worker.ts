/// <reference lib="webworker" />
// 版色抽出を主スレッドから外す(N-04)。k=16 の再始動 6 回はミリ秒では終わらない。

import { chooseK, elbowCurve, extractPlates, suggestPaperIndex, type KMeansFn } from "@/core/extract";
import { makeWasmKmeans } from "@/core/wasm";
import { kmeans } from "@/core/kmeans";
import { createRng } from "@/core/rng";

// Rust/WASM 実装を使う(F-08)。**結果は TS 実装とビット一致する**(G-08 が毎回検査している)ので、
// どちらで計算しても数字は変わらない。読み込みに失敗したら TS 実装に落ちる。
let wasm: KMeansFn | null = null;
let wasmError: string | null = null;
const wasmReady = (async () => {
  try {
    // **相対 URL にしない。** worker のスクリプトは /_next/static/chunks/ に置かれるので、
    // 相対だとそこからの解決になり 404 する(実測 2026-08-31)。
    const res = await fetch(new URL("/hanshoku.wasm", self.location.origin));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    wasm = await makeWasmKmeans(await res.arrayBuffer());
  } catch (e) {
    wasm = null;
    wasmError = e instanceof Error ? e.message : String(e);
  }
})();

export type WorkerRequest = {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
  k: number;
  seed: number;
  withCurve: boolean;
};

export type WorkerResponse = {
  id: number;
  plates: {
    index: number;
    rgb: [number, number, number];
    hex: string;
    oklch: { L: number; C: number; h: number };
    share: number;
    pixels: number;
  }[];
  assign: ArrayBuffer;
  distinctColors: number;
  iterations: number;
  inertia: number;
  curve: { k: number; inertia: number }[] | null;
  suggestedK: number | null;
  /** どちらの実装で計算したか。両者はビット一致するので値は変わらない */
  engine: "rust/wasm" | "typescript";
  /** WASM に落ちた理由。**黙って落ちない** —— 落ちたことが画面と検品に見えるようにする */
  engineNote: string | null;
  paper: { index: number; reason: string } | null;
  /** k を 1 つ抽出するのに要した時間(N-04 の対象) */
  elapsedMs: number;
  /** 慣性曲線(k=2..16)を引くのに要した時間。**N-04 の対象ではない** */
  curveMs: number;
};

/**
 * **どちらの実装を使うかは、測って決める。**
 *
 * 実測 2026-08-31(神奈川沖浪裏 JP10・相異なる色 55,100・k=8・再始動 4):
 *
 * | | TS | Rust/WASM |
 * |---|--:|--:|
 * | Chromium | 869–1,126 ms | **609–689 ms** |
 * | Firefox | **1,378–1,634 ms** | 5,113–6,063 ms |
 *
 * WASM が速いブラウザと、桁で遅いブラウザがある。ブラウザ名で分岐すると別の版で必ず外すので、
 * **その場で小さな作業を両方に流して速い方を採る**。
 *
 * **この選択は結果を変えない。** 二実装がビット一致することを G-08 が毎回検査している
 * —— 等価だからこそ、速さだけで選んでよい。
 */
let chosen: { fn: KMeansFn | undefined; engine: "rust/wasm" | "typescript"; note: string | null } | null = null;

async function pickImpl() {
  if (chosen) return chosen;
  await wasmReady;
  if (!wasm) {
    chosen = { fn: undefined, engine: "typescript", note: wasmError ? `WASM 不可: ${wasmError}` : null };
    return chosen;
  }

  // 決まった疑似データ。実画像には触れないので、選択が画像ごとに揺れない。
  // **本番に近い大きさで測る** —— n=3,000 の小さな作業では Firefox でも WASM が速いと出た。
  const n = 12000;
  const k = 8;
  const rng = createRng(20260831);
  const points = new Float64Array(n * 3);
  const weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    points[i * 3] = rng();
    points[i * 3 + 1] = rng() * 0.4 - 0.2;
    points[i * 3 + 2] = rng() * 0.4 - 0.2;
    weights[i] = 1 + Math.floor(rng() * 40);
  }
  const opts = { seed: 1, maxIter: 16 };

  // **JS 側を暖めてから測る。** JIT が効く前の TS と、最初から機械語の WASM を比べれば
  // 必ず WASM が速いと出る —— 測り方が結論を作ってしまう
  kmeans(points, weights, k, opts);
  wasm(points, weights, k, opts);

  const a0 = performance.now();
  kmeans(points, weights, k, opts);
  const ts = performance.now() - a0;
  const b0 = performance.now();
  wasm(points, weights, k, opts);
  const wa = performance.now() - b0;

  const note = `TS ${ts.toFixed(0)}ms / WASM ${wa.toFixed(0)}ms`;
  chosen =
    wa <= ts
      ? { fn: wasm, engine: "rust/wasm", note }
      : { fn: undefined, engine: "typescript", note };
  return chosen;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const pick = await pickImpl();
  const impl = pick.fn;
  const t0 = performance.now();
  const img = {
    data: new Uint8ClampedArray(req.data),
    width: req.width,
    height: req.height,
  };

  const ex = extractPlates(img, { k: req.k, seed: req.seed, impl });
  const t1 = performance.now();
  const curve = req.withCurve ? elbowCurve(img, { kMin: 2, kMax: 16, seed: req.seed, impl }) : null;
  const t2 = performance.now();

  const res: WorkerResponse = {
    id: req.id,
    plates: ex.plates.map((p) => ({
      index: p.index,
      rgb: p.rgb,
      hex: p.hex,
      oklch: p.oklch,
      share: p.share,
      pixels: p.pixels,
    })),
    assign: ex.assign.buffer as ArrayBuffer,
    distinctColors: ex.distinctColors,
    iterations: ex.iterations,
    inertia: ex.inertia,
    curve,
    suggestedK: curve ? chooseK(curve) : null,
    paper: suggestPaperIndex(ex.plates),
    engine: pick.engine,
    engineNote: pick.note,
    elapsedMs: t1 - t0,
    curveMs: t2 - t1,
  };

  (self as unknown as Worker).postMessage(res, [res.assign]);
};
