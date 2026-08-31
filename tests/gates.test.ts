// T-006〜T-019 — 版色抽出のゲート。SPEC §6 の閾値は **測る前に宣言済み**(2026-08-31)。
//
// 期待値の出所(HC-016):
//   真値は合成木版の生成器が構成的に決める(色と面積比をこちらが指定する)。
//   抽出器は真値を一切参照しない —— T-016 がソースを静的に検査する(G-05)。
//
// 前提の検算(HC-004):
//   「離れた色なら復元できる」は、標本の色が実際に離れているときにしか意味がない。
//   生成した 60 枚すべてについて **版色間の最小 ΔE2000 が MIN_SEPARATION 以上**であることを
//   assert する。前提を検算しない期待値は、正しい実装のほうを落とす。
//
// **無劣化条件を主ゲートにしない理由(実測 2026-08-31 / HC-041):**
//   最初は SPEC どおり無劣化で G-01/G-02 を測り、ΔE 中央値 0.0000・最大 0.0000、
//   面積比誤差 0.000 を得た。同時に **G-04 の陽性対照が 0/60 で発火しなかった**。
//   原因は構造的である —— 抽出器は画素を相異なる色に畳むので、無劣化の合成木版では
//   「相異なる色の数 = 版数」となり、**どんな初期化でも各版から 1 点ずつ拾ってしまう**。
//   つまり無劣化条件の G-01/G-02 はほぼ恒等式で、緑でも何も検査していない。
//   そこで主ゲートを **標準条件(ノイズ σ=2 + クロマ間引き 4:2:0)** に移した。
//   **閾値は据え置きである**(2.0 / 5.0 / 0.010)。緩めたのではなく、対象を難しくした。
//   無劣化条件は「厳密に 0 でなければ実装に欠陥がある」という床として残す。

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRng } from "@/core/rng";
import { deltaE2000, srgbToLab } from "@/core/color";
import type { RasterImage } from "@/core/image";
import { addNoise, blendPaper, blurBoundaries, chromaSubsample420 } from "@/core/degrade";
import { randomPlates, synthPlates } from "@/core/synth";
import {
  chooseK,
  elbowCurve,
  extractPlates,
  suggestPaperIndex,
  withoutPlate,
} from "@/core/extract";

// ---------------------------------------------------------------- 閾値(SPEC §6)

const G01_DE_MEDIAN = 2.0;
const G01_DE_MAX = 5.0;
const G02_SHARE_MAX = 0.010;
const CENTERPIECE_HIT_RATE = 0.8;

/** 版色どうしが最低これだけ離れている標本しか作らない。木版の実際の顔料は互いに明確に違う。 */
const MIN_SEPARATION = 12;

const SAMPLE_COUNT = 60;
const SEED = 20260831;

// ---------------------------------------------------------------- 標本

type Sample = ReturnType<typeof synthPlates> & { n: number };

function buildSamples(): Sample[] {
  const rng = createRng(SEED);
  const out: Sample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    // 版数 3〜12。錦絵の実際の版数の幅にほぼ収まる
    const n = 3 + (i % 10);
    const plates = randomPlates(rng, n, MIN_SEPARATION);
    const s = synthPlates({ width: 240, height: 160, plates, seed: SEED + i, tile: 8 });
    out.push({ ...s, n });
  }
  return out;
}

const samples = buildSamples();

/**
 * 標準条件 —— 実運用で Met の web-large を読んだときに乗っている程度の劣化。
 * ノイズ σ=2(撮影・スキャン)とクロマ間引き 4:2:0(JPEG の色差半減)。
 * **これが G-01 / G-02 / G-04 / G-目玉1 の判定対象である。**
 */
function standard(s: Sample): RasterImage {
  return chromaSubsample420(addNoise(s.image, 2, SEED + 1));
}
const stdImages = samples.map(standard);

/** 抽出色と真値を、ΔE の小さい対から順に一対一で結ぶ。k = 真値 のときのみ使う。 */
function match(
  truth: { rgb: [number, number, number]; share: number }[],
  found: { rgb: [number, number, number]; share: number }[],
): { de: number; dShare: number }[] {
  const pairs: { i: number; j: number; de: number }[] = [];
  for (let i = 0; i < truth.length; i++) {
    for (let j = 0; j < found.length; j++) {
      pairs.push({
        i,
        j,
        de: deltaE2000(srgbToLab(...truth[i].rgb), srgbToLab(...found[j].rgb)),
      });
    }
  }
  pairs.sort((a, b) => a.de - b.de || a.i - b.i || a.j - b.j);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  const res: { de: number; dShare: number }[] = [];
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i);
    usedJ.add(p.j);
    res.push({ de: p.de, dShare: Math.abs(truth[p.i].share - found[p.j].share) });
  }
  return res;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// about の画面が出す数字は、**ここで測った値そのものを書き出す**。
// 手で写すと必ずずれる(HC-045 —— 図に添える文字は図を生成したのと同じデータから導く)。
// 測定はすべて固定シードなので、この JSON は決定論的に同じ内容になる。
//
// 注意: ブロックコメントの中に `**` と `/` を続けて書かないこと ——
// `*/` として解釈されコメントが途中で閉じる(実測 2026-08-31)。
const measured: Record<string, number> = {};
afterAll(() => {
  const out = fileURLToPath(new URL("../src/data/gates.json", import.meta.url));
  writeFileSync(
    out,
    JSON.stringify(
      {
        note: "tests/gates.test.ts が書き出す。手で編集しない",
        samples: SAMPLE_COUNT,
        seed: SEED,
        thresholds: {
          deMedian: G01_DE_MEDIAN,
          deMax: G01_DE_MAX,
          shareMax: G02_SHARE_MAX,
          centerpieceHitRate: CENTERPIECE_HIT_RATE,
        },
        measured,
      },
      null,
      1,
    ) + "\n",
    "utf-8",
  );
});

// ---------------------------------------------------------------- 前提の検算

describe("標本の前提(これが崩れると以下のゲートは何も測っていない)", () => {
  it(`${SAMPLE_COUNT} 枚を生成し、版数は 3〜12 に散っている`, () => {
    expect(samples.length).toBe(SAMPLE_COUNT);
    const ns = new Set(samples.map((s) => s.n));
    expect([...ns].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it(`どの標本でも版色間の最小 ΔE2000 が ${MIN_SEPARATION} 以上`, () => {
    for (const s of samples) {
      let worst = Infinity;
      for (let i = 0; i < s.truth.length; i++) {
        for (let j = i + 1; j < s.truth.length; j++) {
          worst = Math.min(worst, deltaE2000(srgbToLab(...s.truth[i].rgb), srgbToLab(...s.truth[j].rgb)));
        }
      }
      expect(worst).toBeGreaterThanOrEqual(MIN_SEPARATION);
    }
  });

  it("T-006 面積比が指定どおり —— 画素を数えて厳密に一致する", () => {
    for (const s of samples) {
      const total = s.image.width * s.image.height;
      let sum = 0;
      for (const t of s.truth) {
        expect(t.exactPixels / total).toBeCloseTo(t.share, 12);
        expect(Math.abs(t.share - t.requested)).toBeLessThanOrEqual(1 / total + 1e-12);
        sum += t.exactPixels;
      }
      expect(sum).toBe(total); // 取りこぼしゼロ
    }
  });

  it("T-007 無劣化の合成木版は指定色以外の画素を持たない", () => {
    for (const s of samples) {
      const seen = new Set<number>();
      for (let p = 0; p < s.image.data.length; p += 4) {
        seen.add((s.image.data[p] << 16) | (s.image.data[p + 1] << 8) | s.image.data[p + 2]);
      }
      expect(seen.size).toBe(s.n);
    }
  });

  it("標準条件は実際に問題を難しくしている —— 相異なる色数が版数を大きく超える", () => {
    // HC-079: 対照が成り立つ前提を assert で固定する。
    // これが成り立たないと、標準条件のゲートも無劣化と同じ恒等式に戻る。
    for (let i = 0; i < samples.length; i++) {
      const ex = extractPlates(stdImages[i], { k: samples[i].n, seed: SEED });
      expect(ex.distinctColors).toBeGreaterThan(samples[i].n * 50);
    }
  });
});

// ---------------------------------------------------------------- G-01 / G-02

describe("G-01 / G-02(標準条件)—— 版色と面積比を復元する", () => {
  const results = samples.map((s, i) => {
    const ex = extractPlates(stdImages[i], { k: s.n, seed: SEED });
    return { s, ex, m: match(s.truth, ex.plates) };
  });

  it("すべての標本で真値と抽出色が一対一に結べる", () => {
    for (const r of results) expect(r.m.length).toBe(r.s.n);
  });

  it(`T-010 (G-01) ΔE2000 の中央値 ≤ ${G01_DE_MEDIAN} かつ 最大 ≤ ${G01_DE_MAX}`, () => {
    const all = results.flatMap((r) => r.m.map((x) => x.de));
    const med = median(all);
    const max = Math.max(...all);
    console.log(`[G-01/標準] ΔE2000 中央値 ${med.toFixed(4)} / 最大 ${max.toFixed(4)}(${all.length} 版)`);
    measured.g01Median = med;
    measured.g01Max = max;
    measured.g01Plates = all.length;
    expect(med).toBeLessThanOrEqual(G01_DE_MEDIAN);
    expect(max).toBeLessThanOrEqual(G01_DE_MAX);
  });

  it(`T-011 (G-02) 面積比の絶対誤差の最大 ≤ ${G02_SHARE_MAX}`, () => {
    const all = results.flatMap((r) => r.m.map((x) => x.dShare));
    const max = Math.max(...all);
    console.log(`[G-02/標準] 面積比の絶対誤差 最大 ${max.toExponential(3)} / 中央値 ${median(all).toExponential(3)}`);
    measured.g02Max = max;
    expect(max).toBeLessThanOrEqual(G02_SHARE_MAX);
  });

  it("T-013 (G-04 陰性対照) 正常な抽出器は 60 枚すべてで通る —— 誤検出 0", () => {
    const failures = results
      .map((r, i) => ({ i, worst: Math.max(...r.m.map((x) => x.de)) }))
      .filter((r) => r.worst > G01_DE_MAX);
    expect(failures).toEqual([]);
  });

  it("無劣化条件は床として厳密に 0 —— ここが 0 でなければ実装に欠陥がある", () => {
    const all = samples.flatMap((s) => {
      const ex = extractPlates(s.image, { k: s.n, seed: SEED });
      return match(s.truth, ex.plates).map((x) => x.de);
    });
    console.log(`[床/無劣化] ΔE2000 最大 ${Math.max(...all).toFixed(6)}`);
    expect(Math.max(...all)).toBeLessThan(1e-6);
  });
});

describe("T-012 (G-04 陽性対照) —— 壊した抽出器は標準条件で落ちる", () => {
  // HC-070: 対照は「壊した箇所が実際に効く入力」でなければ発火しない。
  // 無劣化条件では相異なる色数 = 版数なので、どんな初期化でも各版から 1 点ずつ拾ってしまい、
  // この対照は 0/60 で発火しなかった(実測 2026-08-31)。標準条件では色が数万に散るので、
  // 先頭 k 点を採る退化初期化は同じ版の近傍から重複して拾う。
  it("退化した初期化では ΔE2000 の最大が閾値を超える標本が出る", () => {
    const broken = samples.map((s, i) => {
      const ex = extractPlates(stdImages[i], { k: s.n, seed: SEED, init: "degenerate" });
      return Math.max(...match(s.truth, ex.plates).map((x) => x.de));
    });
    const over = broken.filter((d) => d > G01_DE_MAX).length;
    console.log(`[G-04 陽性対照] 退化初期化で閾値超過 ${over}/${SAMPLE_COUNT} 枚`);
    measured.g04Fired = over;
    expect(over).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- G-06 決定論

describe("T-009 (G-06) 決定論", () => {
  it("同一入力・同一シードで 100 回、ビット不一致 0 件", () => {
    const img = stdImages[0];
    const k = samples[0].n;
    const key = (e: ReturnType<typeof extractPlates>) =>
      JSON.stringify([e.plates.map((p) => [p.rgb, p.pixels]), e.iterations, e.inertia]);
    const want = key(extractPlates(img, { k, seed: SEED }));
    for (let i = 0; i < 100; i++) {
      expect(key(extractPlates(img, { k, seed: SEED }))).toBe(want);
    }
  });

  it("シードを変えても、よく分離した標本では同じ版色に収束する", () => {
    const img = stdImages[0];
    const k = samples[0].n;
    const a = extractPlates(img, { k, seed: 1 });
    const b = extractPlates(img, { k, seed: 2 });
    const m = match(
      a.plates.map((p) => ({ rgb: p.rgb, share: p.share })),
      b.plates.map((p) => ({ rgb: p.rgb, share: p.share })),
    );
    expect(Math.max(...m.map((x) => x.de))).toBeLessThanOrEqual(G01_DE_MAX);
  });
});

describe("T-008 k-means の慣性は反復ごとに単調非増加", () => {
  it("増加した反復が 1 件もない", () => {
    for (let i = 0; i < samples.length; i++) {
      const ex = extractPlates(stdImages[i], { k: samples[i].n, seed: SEED });
      for (let t = 1; t < ex.inertiaTrace.length; t++) {
        expect(ex.inertiaTrace[t]).toBeLessThanOrEqual(ex.inertiaTrace[t - 1] + 1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------- G-目玉1

describe("G-目玉1 —— エルボーが版数を当てるか", () => {
  function hitRate(images: RasterImage[]): { rate: number; miss: string[] } {
    let hit = 0;
    const miss: string[] = [];
    images.forEach((img, i) => {
      const k = chooseK(elbowCurve(img, { kMin: 2, kMax: 16, seed: SEED }));
      if (Math.abs(k - samples[i].n) <= 1) hit++;
      else miss.push(`真 ${samples[i].n} → 選 ${k}`);
    });
    return { rate: hit / images.length, miss };
  }

  it(`T-014 無劣化(SPEC の宣言どおり)の的中率 ≥ ${CENTERPIECE_HIT_RATE}`, () => {
    const { rate, miss } = hitRate(samples.map((s) => s.image));
    console.log(`[G-目玉1/無劣化] 的中率 ${rate.toFixed(3)}${miss.length ? " 外し: " + miss.slice(0, 10).join(" / ") : ""}`);
    measured.centerpieceClean = rate;
    expect(rate).toBeGreaterThanOrEqual(CENTERPIECE_HIT_RATE);
  });

  it("T-014b 標準条件での的中率を測る —— UI の主張はこちらに従う", () => {
    // 実際の版画は必ず劣化している。無劣化の的中率は主張の根拠にならない。
    // **ここは閾値を置かない測定である**が、この値が低ければ UI は「版数」と呼ばない。
    const { rate, miss } = hitRate(stdImages);
    console.log(`[G-目玉1/標準] 的中率 ${rate.toFixed(3)}${miss.length ? " 外し: " + miss.slice(0, 12).join(" / ") : ""}`);
    measured.centerpieceStandard = rate;
    expect(rate).toBeGreaterThanOrEqual(0); // 測定。判定はループ末尾で人間が行う
  });
});

// ---------------------------------------------------------------- G-03 測定

describe("G-03 —— 劣化掃引(閾値なし。壊れる境界を測る)", () => {
  // TEST_SPEC: ここで通しているのは JPEG コーデックではなく、平面色に対する主要効果の模型。
  // 「品質 75 で壊れる」とは言えない。
  it("T-015 劣化ごとの ΔE2000 と面積比誤差を記録する", () => {
    const rows: string[] = [];
    const measure = (label: string, f: (s: Sample) => RasterImage) => {
      const des: number[] = [];
      const dsh: number[] = [];
      for (const s of samples) {
        const ex = extractPlates(f(s), { k: s.n, seed: SEED });
        const m = match(s.truth, ex.plates);
        des.push(...m.map((x) => x.de));
        dsh.push(...m.map((x) => x.dShare));
      }
      rows.push(
        `${label.padEnd(26)} ΔE 中央 ${median(des).toFixed(2)} 最大 ${Math.max(...des).toFixed(2)}` +
          ` / 面積比 最大 ${Math.max(...dsh).toFixed(4)}`,
      );
    };

    measure("劣化なし", (s) => s.image);
    for (const sigma of [2, 5, 10, 20]) measure(`ノイズ σ=${sigma}`, (s) => addNoise(s.image, sigma, SEED));
    measure("クロマ間引き 4:2:0", (s) => chromaSubsample420(s.image));
    measure("標準条件(σ=2 + 4:2:0)", standard);
    for (const r of [1, 2, 4]) measure(`境界混色 r=${r}`, (s) => blurBoundaries(s.image, r));
    for (const a of [0.1, 0.25, 0.5]) measure(`地色の黄変 α=${a}`, (s) => blendPaper(s.image, [235, 219, 178], a));

    console.log("[G-03] 劣化掃引\n" + rows.join("\n"));
    expect(rows.length).toBe(13);
  });
});

// ---------------------------------------------------------------- G-05 循環の禁止

describe("T-016 (G-05) 循環の禁止", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(`../src/core/${rel}`, import.meta.url)), "utf-8");

  it("抽出器と k-means は生成器・真値を参照しない", () => {
    for (const f of ["extract.ts", "kmeans.ts"]) {
      const src = read(f);
      expect(src, `${f} が synth を import している`).not.toMatch(/from\s+["'][^"']*synth/);
      expect(src, `${f} が degrade を import している`).not.toMatch(/from\s+["'][^"']*degrade/);
      expect(src, `${f} に truth が現れる`).not.toMatch(/\btruth\b/);
    }
  });

  it("陽性対照 —— この検査は実際に撃てる", () => {
    // HC-041: 検査そのものをテストする。生成器のソースは truth を含むので、
    // 同じ検査を当てれば必ず落ちる。落ちないなら検査が壊れている。
    expect(read("synth.ts")).toMatch(/\btruth\b/);
  });
});

// ---------------------------------------------------------------- F-03 / F-06

describe("T-017 版マスクは全画素を過不足なく被覆する", () => {
  it("重複 0・欠落 0、面積比の和が 1、並べ替え後の index と assign が一致する", () => {
    for (let i = 0; i < 10; i++) {
      const ex = extractPlates(stdImages[i], { k: samples[i].n, seed: SEED });
      const counts = new Array(ex.plates.length).fill(0);
      for (let p = 0; p < ex.assign.length; p++) counts[ex.assign[p]]++;
      expect(ex.assign.length).toBe(stdImages[i].width * stdImages[i].height);
      for (const p of ex.plates) expect(p.pixels).toBe(counts[p.index]);
      expect(Math.abs(ex.plates.reduce((a, p) => a + p.share, 0) - 1)).toBeLessThan(1e-9);
      // 面積の大きい順に並んでいる
      for (let j = 1; j < ex.plates.length; j++) {
        expect(ex.plates[j - 1].share).toBeGreaterThanOrEqual(ex.plates[j].share);
      }
    }
  });
});

describe("F-06 地色 —— 提案であって判定ではない", () => {
  it("T-018 地色を除外すると残りの面積比の和が 1 になる", () => {
    for (let i = 0; i < 10; i++) {
      const ex = extractPlates(stdImages[i], { k: samples[i].n, seed: SEED });
      const rest = withoutPlate(ex.plates, 0);
      expect(rest.length).toBe(ex.plates.length - 1);
      expect(Math.abs(rest.reduce((a, p) => a + p.share, 0) - 1)).toBeLessThan(1e-9);
    }
  });

  it("T-019 地色の提案の的中率を測る —— これは測定であってゲートではない", () => {
    // HC-079: 裏づけの無い記号を出さない。的中率が低いなら、UI は提案として弱く出すべきで、
    // 「これが地色です」と判定を出してはならない。
    let hit = 0;
    let proposed = 0;
    samples.forEach((s, i) => {
      // 真値のうち最も明るく彩度の低いものを「紙」とみなす(人間が地色と呼ぶであろうものの操作的定義)
      const labs = s.truth.map((t) => srgbToLab(...t.rgb));
      let paperIdx = 0;
      let best = -Infinity;
      labs.forEach((lab, j) => {
        const score = lab[0] - 2 * Math.hypot(lab[1], lab[2]);
        if (score > best) {
          best = score;
          paperIdx = j;
        }
      });
      const sug = suggestPaperIndex(extractPlates(stdImages[i], { k: s.n, seed: SEED }).plates);
      if (sug === null) return;
      proposed++;
      const ex = extractPlates(stdImages[i], { k: s.n, seed: SEED });
      if (deltaE2000(labs[paperIdx], srgbToLab(...ex.plates[sug.index].rgb)) < 5) hit++;
    });
    console.log(`[F-06] 地色の提案 ${proposed}/${samples.length} 枚で提示、うち的中 ${hit}`);
    expect(proposed).toBeGreaterThan(0);
  });
});
