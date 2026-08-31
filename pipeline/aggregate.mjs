// ③ 年代の帯(F-10)の集計と、G-目玉2 の判定。
//
// **作品を年代に単一配属しない**(SPEC §2.4)。`objectBeginDate`–`objectEndDate` に
// 一様配分した重みで年ごとの平均を出す。標本は二本並走 ——
// **厳密標本**(年代幅 ≤ 10 年)と**緩標本**(全件)。
//
// 判定の閾値は SPEC §5.1 に**一枚も測る前に**書いてある。ここでは当てはめるだけ。
//
// 入力: data/plates.json  出力: src/data/bands.json + 判定の標準出力

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CORE = resolve(ROOT, ".cache/core.mjs");
if (!existsSync(CORE)) {
  console.error("先に core を束ねること: npx esbuild src/core/index.ts --bundle --format=esm --outfile=.cache/core.mjs --platform=neutral");
  process.exit(2);
}
// **年代の重み付けと「青」の定義は出荷している実装から読む。** ここで書き直さない(HC-069)
const core = await import("file://" + CORE.replaceAll("\\", "/"));
const { yearlyWeighted, windowMean, blueShare: coreBlueShare, BLUE_HUE, BLUE_MIN_CHROMA } = core;

const src = JSON.parse(readFileSync(resolve(ROOT, "data/plates.json"), "utf-8"));

// ---- SPEC §5.1 の定義(測る前に宣言済み)
const BLUE_H = BLUE_HUE;
const BLUE_C_MIN = BLUE_MIN_CHROMA;
const THRESHOLD = 0.03; // G-目玉2a: +3.0 ポイント
const WINDOWS = {
  before: [1820, 1828],
  after: [1831, 1840],
  ctrlEarlyA: [1800, 1818],
  ctrlEarlyB: [1819, 1828],
  ctrlLateA: [1841, 1850],
  ctrlLateB: [1851, 1860],
};

const blueShare = (w) => coreBlueShare(w.plates);
const yearly = (works, valueOf) => yearlyWeighted(works, valueOf);
const win = (series, [lo, hi]) => windowMean(series, lo, hi);

const all = src.works;
const strict = all.filter((w) => w.span <= 10);

const samples = { 緩標本: all, 厳密標本: strict };
const report = {};

for (const [name, works] of Object.entries(samples)) {
  const series = yearly(works, blueShare);
  const w = Object.fromEntries(Object.entries(WINDOWS).map(([k, r]) => [k, win(series, r)]));
  report[name] = {
    n: works.length,
    series,
    windows: w,
    diffMain: w.after.mean - w.before.mean,
    diffEarly: w.ctrlEarlyB.mean - w.ctrlEarlyA.mean,
    diffLate: w.ctrlLateB.mean - w.ctrlLateA.mean,
  };
}

// ---- G-目玉2c: 遷移をまたぐ絵師に限った部分標本
const byArtist = new Map();
for (const w of all) {
  if (!w.artist) continue;
  const e = byArtist.get(w.artist) ?? { before: 0, after: 0, works: [] };
  if (w.end <= 1828) e.before++;
  if (w.begin >= 1831) e.after++;
  e.works.push(w);
  byArtist.set(w.artist, e);
}
const spanning = [...byArtist.entries()].filter(([, e]) => e.before >= 3 && e.after >= 3);
const spanWorks = spanning.flatMap(([, e]) => e.works);
const spanSeries = yearly(spanWorks, blueShare);
const spanBefore = win(spanSeries, WINDOWS.before);
const spanAfter = win(spanSeries, WINDOWS.after);
const spanDiff = spanAfter.mean - spanBefore.mean;

// ---- 判定
const a = Object.values(report).every((r) => r.diffMain >= THRESHOLD);
const b = Object.values(report).every(
  (r) => r.diffMain > r.diffEarly && r.diffMain > r.diffLate,
);
const c = Number.isFinite(spanDiff) && Math.sign(spanDiff) === Math.sign(report["緩標本"].diffMain);

const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(2) + " pt" : "—");

console.log(`標本 ${src.count} 件(k=${src.k} / seed=${src.seed})`);
for (const [name, r] of Object.entries(report)) {
  console.log(`\n[${name}] n=${r.n}`);
  console.log(`  1820–1828 の青 ${pct(r.windows.before.mean)}(重み ${r.windows.before.weight.toFixed(1)})`);
  console.log(`  1831–1840 の青 ${pct(r.windows.after.mean)}(重み ${r.windows.after.weight.toFixed(1)})`);
  console.log(`  **差 ${pct(r.diffMain)}**(閾値 +${(THRESHOLD * 100).toFixed(1)} pt)`);
  console.log(`  対照 1800–1818 → 1819–1828 の差 ${pct(r.diffEarly)}`);
  console.log(`  対照 1841–1850 → 1851–1860 の差 ${pct(r.diffLate)}`);
}
console.log(`\n[G-目玉2c] 遷移をまたぐ絵師 ${spanning.length} 名 / 作品 ${spanWorks.length} 件`);
console.log(`  1820–1828 ${pct(spanBefore.mean)} → 1831–1840 ${pct(spanAfter.mean)} / 差 ${pct(spanDiff)}`);
console.log(`  絵師: ${spanning.map(([k, e]) => `${k}(前${e.before}/後${e.after})`).join(" ・ ")}`);

console.log(`\n判定 —— 2a ${a ? "通過" : "不通過"} / 2b ${b ? "通過" : "不通過"} / 2c ${c ? "通過" : "不通過"}`);
console.log(`**G-目玉2: ${a && b && c ? "通過" : "不通過"}**`);

// ---- ③ の画面が使うデータ
const decadeHist = {};
for (const w of all) {
  const dec = Math.floor(((w.begin + w.end) / 2) / 10) * 10;
  const bins = (decadeHist[dec] ??= { n: 0, hue: new Array(36).fill(0), blue: 0 });
  bins.n++;
  bins.blue += blueShare(w);
  for (const p of w.plates) {
    if (p.C < BLUE_C_MIN) continue;
    bins.hue[Math.min(35, Math.floor(p.h / 10))] += p.share;
  }
}
for (const d of Object.values(decadeHist)) {
  d.blue /= d.n;
  const tot = d.hue.reduce((x, y) => x + y, 0) || 1;
  d.hue = d.hue.map((v) => Number((v / tot).toFixed(5)));
  d.blue = Number(d.blue.toFixed(5));
}

writeFileSync(
  resolve(ROOT, "src/data/bands.json"),
  JSON.stringify(
    {
      generated: src.generated,
      k: src.k,
      seed: src.seed,
      count: src.count,
      blue: { hue: BLUE_H, minChroma: BLUE_C_MIN },
      threshold: THRESHOLD,
      windows: WINDOWS,
      verdict: { a, b, c, pass: a && b && c },
      samples: Object.fromEntries(
        Object.entries(report).map(([k, r]) => [
          k,
          {
            n: r.n,
            diffMain: r.diffMain,
            diffEarly: r.diffEarly,
            diffLate: r.diffLate,
            windows: r.windows,
            series: r.series.map((p) => ({
              year: p.year,
              mean: Number(p.mean.toFixed(5)),
              weight: Number(p.weight.toFixed(3)),
            })),
          },
        ]),
      ),
      spanning: {
        artists: spanning.map(([k, e]) => ({ artist: k, before: e.before, after: e.after })),
        works: spanWorks.length,
        before: spanBefore.mean,
        after: spanAfter.mean,
        diff: spanDiff,
      },
      decades: decadeHist,
    },
    null,
    1,
  ) + "\n",
  "utf-8",
);
console.log("\nsrc/data/bands.json を書いた");
