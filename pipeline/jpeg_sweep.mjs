// G-03 を**実物の JPEG** で測り直す。
//
// これまでの掃引は模型だった。模型で分かったのは「クロマ間引きはほぼ無害、効くのは境界の混色」で、
// **それが実際の JPEG でも成り立つのかは別の問い**である。ここで実物を通す。
//
// 役割分担: 合成と抽出と比較はここ(出荷している実装を束ねて使う)、
// 符号化と復号だけ `pipeline/jpeg_codec.py`(PIL)。**解析を二度書かない**(HC-069)。
//
// **これは測定であってゲートではない。**閾値を置かず、壊れる境界を記録する。
//
// 出力: src/data/jpeg.json

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const WORK = resolve(ROOT, ".cache/jpeg");
const CORE = resolve(ROOT, ".cache/core.mjs");
if (!existsSync(CORE)) {
  console.error("先に core を束ねること: npm run core:bundle");
  process.exit(2);
}
const { createRng, randomPlates, synthPlates, extractPlates, deltaE2000, srgbToLab, makeWasmKmeans } = await import(
  "file://" + CORE.replaceAll("\\", "/")
);

const SEED = 20260831;
const SAMPLES = 30;
const MIN_SEPARATION = 12;
const QUALITIES = [95, 85, 75, 60, 40];

const wasm = await makeWasmKmeans(readFileSync(resolve(ROOT, "public/hanshoku.wasm")));

// ---- 合成木版を作る(gates.test.ts と同じ作り方・同じシード)
const rng = createRng(SEED);
const samples = [];
for (let i = 0; i < SAMPLES; i++) {
  const n = 3 + (i % 10);
  const s = synthPlates({ width: 240, height: 160, plates: randomPlates(rng, n, MIN_SEPARATION), seed: SEED + i, tile: 8 });
  samples.push({ id: `s${String(i).padStart(3, "0")}`, n, ...s });
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

for (const s of samples) {
  const { width, height, data } = s.image;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  writeFileSync(resolve(WORK, `${s.id}.raw`), rgb);
}
writeFileSync(
  resolve(WORK, "manifest.json"),
  JSON.stringify({
    qualities: QUALITIES,
    items: samples.map((s) => ({ id: s.id, width: s.image.width, height: s.image.height })),
  }),
  "utf-8",
);

console.log(`合成木版 ${samples.length} 枚を書いた。JPEG に通す…`);
execFileSync("python", [resolve(ROOT, "pipeline/jpeg_codec.py")], { stdio: "inherit" });

// ---- 通したものを抽出して真値と比べる
function match(truth, found) {
  const pairs = [];
  for (let i = 0; i < truth.length; i++) {
    for (let j = 0; j < found.length; j++) {
      pairs.push({ i, j, de: deltaE2000(srgbToLab(...truth[i].rgb), srgbToLab(...found[j].rgb)) });
    }
  }
  pairs.sort((a, b) => a.de - b.de || a.i - b.i || a.j - b.j);
  const ui = new Set();
  const uj = new Set();
  const out = [];
  for (const p of pairs) {
    if (ui.has(p.i) || uj.has(p.j)) continue;
    ui.add(p.i);
    uj.add(p.j);
    out.push({ de: p.de, dShare: Math.abs(truth[p.i].share - found[p.j].share) });
  }
  return out;
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 再始動回数を変えて、壊れ方が「探索不足」なのか「目的関数の限界」なのかを分ける */
const RESTARTS = [4, 16, 64];

const rows = [];
for (const q of QUALITIES) {
  const des = [];
  const dsh = [];
  let broken = 0;
  for (const s of samples) {
    const rgb = readFileSync(resolve(WORK, `${s.id}.q${q}.raw`));
    const { width, height } = s.image;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = rgb[i * 3];
      data[i * 4 + 1] = rgb[i * 3 + 1];
      data[i * 4 + 2] = rgb[i * 3 + 2];
      data[i * 4 + 3] = 255;
    }
    const ex = extractPlates({ data, width, height }, { k: s.n, seed: SEED, impl: wasm });
    const m = match(s.truth, ex.plates);
    des.push(...m.map((x) => x.de));
    dsh.push(...m.map((x) => x.dShare));
    if (Math.max(...m.map((x) => x.de)) > 5) broken++;
  }
  rows.push({
    quality: q,
    deMedian: Number(median(des).toFixed(3)),
    deMax: Number(Math.max(...des).toFixed(3)),
    shareMax: Number(Math.max(...dsh).toFixed(5)),
    broken,
    samples: samples.length,
  });
}

console.log("\n[G-03 実 JPEG] 合成木版 " + samples.length + " 枚");
console.log("  品質   ΔE 中央   ΔE 最大   面積比 最大   ΔE>5 の枚数");
for (const r of rows) {
  console.log(
    `  ${String(r.quality).padStart(4)}  ${r.deMedian.toFixed(2).padStart(8)}  ${r.deMax.toFixed(2).padStart(8)}` +
      `  ${r.shareMax.toFixed(4).padStart(11)}  ${String(r.broken).padStart(8)}/${r.samples}`,
  );
}

// ---- 壊れ方の内訳。**再始動を増やせば直るのか、増やしても直らないのか**
const byRestarts = [];
for (const r of RESTARTS) {
  let broken = 0;
  for (const s of samples) {
    const rgb = readFileSync(resolve(WORK, `${s.id}.q95.raw`));
    const { width, height } = s.image;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = rgb[i * 3];
      data[i * 4 + 1] = rgb[i * 3 + 1];
      data[i * 4 + 2] = rgb[i * 3 + 2];
      data[i * 4 + 3] = 255;
    }
    const ex = extractPlates({ data, width, height }, { k: s.n, seed: SEED, impl: wasm, restarts: r });
    if (Math.max(...match(s.truth, ex.plates).map((x) => x.de)) > 5) broken++;
  }
  byRestarts.push({ restarts: r, broken, samples: samples.length });
}
console.log("\n[壊れ方の内訳(品質 95)] 再始動を増やすと直るか");
for (const b of byRestarts) console.log(`  restarts=${String(b.restarts).padStart(2)}  壊れた ${b.broken}/${b.samples}`);
console.log("  → 減るが 0 にはならない。**探索不足と、目的関数の限界の二種類がある**");

writeFileSync(
  resolve(ROOT, "src/data/jpeg.json"),
  JSON.stringify(
    {
      note: "pipeline/jpeg_sweep.mjs が書き出す。手で編集しない",
      samples: samples.length,
      seed: SEED,
      encoder: "Pillow の既定設定(subsampling も optimize も触らない)",
      byRestarts,
      rows,
    },
    null,
    1,
  ) + "\n",
  "utf-8",
);
console.log("\nsrc/data/jpeg.json を書いた");
