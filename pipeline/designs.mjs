// 同一図柄の複数摺りが枠に何件あるかを数える(F-09 の網羅)。
//
// **一つの規則で数えない。** Met の Title 列は同一性の鍵として設計されていないので、
// 厳しい規則(取りこぼす)と緩い規則(束ねすぎる)の二つで数え、**間に挟む**。
// 規則は出荷している `src/core/design.ts` を束ねて読む(解析を二度書かない / HC-069)。
//
// 入力: data/frame.json  出力: src/data/designs-count.json

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const CORE = resolve(ROOT, ".cache/core.mjs");
if (!existsSync(CORE)) {
  console.error("先に core を束ねること: npm run core:bundle");
  process.exit(2);
}
const { countDesigns, strictDesignKey, looseDesignKey } = await import("file://" + CORE.replaceAll("\\", "/"));

const frame = JSON.parse(readFileSync(resolve(ROOT, "data/frame.json"), "utf-8"));
const titles = frame.works.map((w) => w.title);

const strict = countDesigns(titles, strictDesignKey);
const loose = countDesigns(titles, looseDesignKey);

const out = {
  note: "pipeline/designs.mjs が書き出す。手で編集しない",
  frame: frame.count,
  titled: strict.titled,
  untitled: frame.count - strict.titled,
  strict,
  loose,
};

console.log(`枠 ${out.frame} 件 / 題名あり ${out.titled} 件(${((out.titled / out.frame) * 100).toFixed(1)} %)`);
console.log(`  厳しい規則: ${strict.designs} 図柄 / ${strict.works} 作品 / 最大 ${strict.max}`);
console.log(`  緩い規則  : ${loose.designs} 図柄 / ${loose.works} 作品 / 最大 ${loose.max}`);
console.log(`  → 同一図柄の複数摺りは **${strict.designs}〜${loose.designs} 図柄**。これ以上は絞れない`);

writeFileSync(resolve(ROOT, "src/data/designs-count.json"), JSON.stringify(out, null, 1) + "\n", "utf-8");
console.log("src/data/designs-count.json を書いた");
