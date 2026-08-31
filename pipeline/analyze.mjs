// 標本の版色を抽出する(F-11 の後段)。
//
// **出荷しているのと同じ実装を使う。** `src/core/*` を esbuild で束ねて読み込み、
// Rust/WASM 実装で回す(TS 実装とビット一致することは G-08 が毎回検査している)。
// 解析を二度書かない —— 書けば必ずずれる(HC-069)。
//
// 入力: `.cache/raw/<id>.bin`(RGB 3 バイト/画素)+ `manifest.json`
// 出力: `data/plates.json`
//
// 実行:
//   npx esbuild src/core/index.ts --bundle --format=esm --outfile=.cache/core.mjs --platform=neutral
//   node pipeline/analyze.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const RAW = resolve(ROOT, ".cache/raw");
const CORE = resolve(ROOT, ".cache/core.mjs");

if (!existsSync(CORE)) {
  console.error("先に core を束ねること: npx esbuild src/core/index.ts --bundle --format=esm --outfile=.cache/core.mjs --platform=neutral");
  process.exit(2);
}

const { extractPlates, makeWasmKmeans } = await import("file://" + CORE.replaceAll("\\", "/"));
const wasm = await makeWasmKmeans(readFileSync(resolve(ROOT, "public/hanshoku.wasm")));

const manifest = JSON.parse(readFileSync(resolve(RAW, "manifest.json"), "utf-8"));
const entries = Object.entries(manifest).filter(([, m]) => !m.skip);

const K = 8;
const SEED = 20260831;
/** 小さすぎる画像は版色が潰れる。**下限を測って決める**のではなく、先に宣言して落とす */
const MIN_PIXELS = 60000;

const out = [];
let dropped = 0;
let n = 0;
const t0 = Date.now();

for (const [id, m] of entries) {
  n++;
  const px = m.width * m.height;
  if (px < MIN_PIXELS) {
    dropped++;
    continue;
  }
  const bin = readFileSync(resolve(RAW, `${id}.bin`));
  if (bin.length !== px * 3) {
    dropped++;
    continue;
  }
  // RGB → RGBA(抽出器の入力の形)
  const data = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    data[i * 4] = bin[i * 3];
    data[i * 4 + 1] = bin[i * 3 + 1];
    data[i * 4 + 2] = bin[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  const ex = extractPlates({ data, width: m.width, height: m.height }, { k: K, seed: SEED, impl: wasm });
  out.push({
    objectId: m.objectId,
    accession: m.accession,
    artist: m.artist,
    title: m.title,
    begin: m.begin,
    end: m.end,
    span: m.span,
    objectDate: m.objectDate,
    width: m.width,
    height: m.height,
    distinctColors: ex.distinctColors,
    plates: ex.plates.map((p) => ({
      hex: p.hex,
      share: Number(p.share.toFixed(6)),
      L: Number(p.oklch.L.toFixed(5)),
      C: Number(p.oklch.C.toFixed(5)),
      h: Number(p.oklch.h.toFixed(3)),
    })),
  });
  if (n % 50 === 0) console.log(`  ${n}/${entries.length}(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

writeFileSync(
  resolve(ROOT, "data/plates.json"),
  JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      k: K,
      seed: SEED,
      minPixels: MIN_PIXELS,
      engine: "rust/wasm(TS 実装とビット一致 —— G-08)",
      count: out.length,
      dropped,
      works: out,
    },
    null,
    1,
  ) + "\n",
  "utf-8",
);
// about の画面が読むメタ。**plates.json は 1 MB あるので、必要な分だけを別に出す**
writeFileSync(
  resolve(ROOT, "src/data/plates-meta.json"),
  JSON.stringify(
    {
      note: "pipeline/analyze.mjs が書き出す。手で編集しない",
      generated: new Date().toISOString().slice(0, 10),
      k: K,
      seed: SEED,
      count: out.length,
      minPixels: MIN_PIXELS,
      engine: "rust/wasm(TS 実装とビット一致 —— G-08)",
    },
    null,
    1,
  ) + "\n",
  "utf-8",
);
console.log(`版色を抽出 ${out.length} 件 / 小さすぎて落とした ${dropped} 件 / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
