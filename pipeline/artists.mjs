// ④ 絵師くらべ(F-13)と ⑥ 伝統色照合(F-12)の集計。
//
// **絵師の色域は、その絵師の版色をもう一度 k-means にかけて出す。**
// 一段目は 1 枚の絵の中の版、二段目は 1 人の絵師の中の版 —— 同じ道具を一段上で使う。
// 実装は出荷しているものを esbuild で束ねて読む(解析を二度書かない / HC-069)。
//
// 入力: data/plates.json + data/palette.json
// 出力: src/data/artists.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CORE = resolve(ROOT, ".cache/core.mjs");
if (!existsSync(CORE)) {
  console.error("先に core を束ねること: npm run core:bundle");
  process.exit(2);
}
const core = await import("file://" + CORE.replaceAll("\\", "/"));
const { kmeans, srgbToOklab, oklabToSrgb, oklabToOklch, rgbToHex, normalizeArtist, candidatesWithin, RULER_WIDTH, blueShare } = core;

const src = JSON.parse(readFileSync(resolve(ROOT, "data/plates.json"), "utf-8"));
const palette = JSON.parse(readFileSync(resolve(ROOT, "data/palette.json"), "utf-8")).colors;

const MIN_WORKS = 12; // これ未満の絵師は出さない(宣言値)
const K = 8;
const SEED = 20260831;

// ---- 束ねる
const groups = new Map();
for (const w of src.works) {
  const name = normalizeArtist(w.artist || "").trim();
  if (!name) continue;
  const g = groups.get(name) ?? { name, works: [], plates: [] };
  g.works.push(w);
  for (const p of w.plates) g.plates.push(p);
  groups.set(name, g);
}

const kept = [...groups.values()].filter((g) => g.works.length >= MIN_WORKS);
kept.sort((a, b) => b.works.length - a.works.length);

const dropped = [...groups.values()].filter((g) => g.works.length < MIN_WORKS);
console.log(
  `絵師 ${groups.size} 名 → ${MIN_WORKS} 件以上の ${kept.length} 名(作品 ${kept.reduce((a, g) => a + g.works.length, 0)} 件)`,
);
console.log(`  落とした ${dropped.length} 名 / ${dropped.reduce((a, g) => a + g.works.length, 0)} 件`);

const out = [];
for (const g of kept) {
  // 版色を OKLab 点にして、面積比を重みにする。**1 枚の絵が持つ重みは 1** に揃える
  const per = 1 / g.works.length;
  const pts = [];
  const wts = [];
  for (const w of g.works) {
    for (const p of w.plates) {
      const rgb = [parseInt(p.hex.slice(1, 3), 16), parseInt(p.hex.slice(3, 5), 16), parseInt(p.hex.slice(5, 7), 16)];
      const lab = srgbToOklab(...rgb);
      pts.push(lab[0], lab[1], lab[2]);
      wts.push(p.share * per);
    }
  }
  const points = Float64Array.from(pts);
  const weights = Float64Array.from(wts);
  const k = Math.min(K, weights.length);
  const res = kmeans(points, weights, k, { seed: SEED });

  const totalW = weights.reduce((a, b) => a + b, 0);
  const plates = [];
  for (let j = 0; j < k; j++) {
    const lab = [res.centroids[j * 3], res.centroids[j * 3 + 1], res.centroids[j * 3 + 2]];
    const rgb = oklabToSrgb(lab);
    const ch = oklabToOklch(lab);
    const share = res.weights[j] / totalW;
    const cands = candidatesWithin(rgb, palette);
    plates.push({
      hex: rgbToHex(rgb),
      share: Number(share.toFixed(5)),
      L: Number(ch.L.toFixed(4)),
      C: Number(ch.C.toFixed(4)),
      h: Number(ch.h.toFixed(2)),
      names: cands.slice(0, 6).map((c) => ({
        name: c.name,
        de: Number(c.de.toFixed(2)),
        spread: c.sourceSpread === null ? null : Number(c.sourceSpread.toFixed(2)),
      })),
      nameCount: cands.length,
    });
  }
  plates.sort((a, b) => b.share - a.share);

  const begins = g.works.map((w) => w.begin);
  const ends = g.works.map((w) => w.end);
  out.push({
    name: g.name,
    works: g.works.length,
    from: Math.min(...begins),
    to: Math.max(...ends),
    blue: Number((g.works.reduce((a, w) => a + blueShare(w.plates), 0) / g.works.length).toFixed(5)),
    medianChroma: Number(
      [...g.plates.map((p) => p.C)].sort((a, b) => a - b)[Math.floor(g.plates.length / 2)].toFixed(4),
    ),
    plates,
  });
}

// 参考: 名前がいくつ当たるかの分布(⑥ の分解能そのもの)
const counts = out.flatMap((a) => a.plates.map((p) => p.nameCount)).sort((a, b) => a - b);
const med = counts[counts.length >> 1];
console.log(`\n⑥ 目盛り幅 ΔE ${RULER_WIDTH} の中に入る色名の数: 中央値 ${med} / 最小 ${counts[0]} / 最大 ${counts[counts.length - 1]}`);

writeFileSync(
  resolve(ROOT, "src/data/artists.json"),
  JSON.stringify(
    {
      generated: src.generated,
      k: K,
      seed: SEED,
      minWorks: MIN_WORKS,
      ruler: RULER_WIDTH,
      totalArtists: groups.size,
      droppedArtists: dropped.length,
      droppedWorks: dropped.reduce((a, g) => a + g.works.length, 0),
      nameCount: { median: med, min: counts[0], max: counts[counts.length - 1] },
      artists: out,
    },
    null,
    1,
  ) + "\n",
  "utf-8",
);
console.log("src/data/artists.json を書いた");
