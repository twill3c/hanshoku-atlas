// T-034〜T-037 — 年代の重み付けと「青」の定義(F-10 / G-目玉2)。
//
// 期待値の出所: **構成的**。手で計算できる小さな例を置く。
// 年代の重み付けは目玉の判定の土台なので、ここが狂うと判定そのものが意味を失う。

import { describe, expect, it } from "vitest";
import { BLUE_HUE, BLUE_MIN_CHROMA, blueShare, windowMean, yearlyWeighted } from "@/core/years";

describe("T-034 幅 1 年の作品はその年にだけ効く", () => {
  it("重みは 1、平均は値そのもの", () => {
    const s = yearlyWeighted([{ begin: 1830, end: 1830, v: 0.4 }], (w) => w.v);
    expect(s).toEqual([{ year: 1830, mean: 0.4, weight: 1 }]);
  });
});

describe("T-035 幅の広い作品は薄く広がる", () => {
  it("幅 4 年なら各年に 1/4 の重み", () => {
    const s = yearlyWeighted([{ begin: 1820, end: 1823, v: 0.8 }], (w) => w.v);
    expect(s.map((p) => p.year)).toEqual([1820, 1821, 1822, 1823]);
    for (const p of s) {
      expect(p.weight).toBeCloseTo(0.25, 12);
      expect(p.mean).toBeCloseTo(0.8, 12);
    }
  });

  it("**幅の広い作品が狭い作品を押しのけない**", () => {
    // 1830 年に、幅 1 年の作品(値 0)と 幅 20 年の作品(値 1)が重なる。
    // 重みは 1 : 1/20 なので、平均は 0 に大きく寄る
    const s = yearlyWeighted(
      [
        { begin: 1830, end: 1830, v: 0 },
        { begin: 1821, end: 1840, v: 1 },
      ],
      (w) => w.v,
    );
    const y = s.find((p) => p.year === 1830);
    expect(y?.weight).toBeCloseTo(1 + 1 / 20, 12);
    expect(y?.mean).toBeCloseTo(0.05 / 1.05, 12);
    expect(y?.mean).toBeLessThan(0.05);
  });
});

describe("T-036 窓の平均", () => {
  const series = [
    { year: 1820, mean: 0.1, weight: 2 },
    { year: 1821, mean: 0.4, weight: 1 },
    { year: 1830, mean: 0.9, weight: 3 },
  ];

  it("重み付きで平均する", () => {
    const w = windowMean(series, 1820, 1821);
    expect(w.weight).toBe(3);
    expect(w.mean).toBeCloseTo((0.1 * 2 + 0.4 * 1) / 3, 12);
  });

  it("窓に標本が無ければ NaN —— **0 を返さない**", () => {
    // 「無い」と「0 だった」は違う。0 を返すと差の計算が静かに嘘になる
    const w = windowMean(series, 1700, 1719);
    expect(w.weight).toBe(0);
    expect(Number.isNaN(w.mean)).toBe(true);
  });
});

describe("T-037 「青」の定義(SPEC §5.1)", () => {
  it("色相角と彩度の両方で絞る", () => {
    const plates = [
      { h: 236, C: 0.09, share: 0.3 }, // 藍 —— 入る
      { h: 235, C: 0.13, share: 0.2 }, // 露草 —— **入る。分離しない**
      { h: 236, C: 0.01, share: 0.4 }, // 彩度が足りない灰色 —— 入らない
      { h: 79, C: 0.05, share: 0.1 }, // 紙の黄 —— 入らない
    ];
    expect(blueShare(plates)).toBeCloseTo(0.5, 12);
  });

  it("境界は下を含み上を含まない", () => {
    expect(blueShare([{ h: BLUE_HUE[0], C: 0.5, share: 1 }])).toBe(1);
    expect(blueShare([{ h: BLUE_HUE[1], C: 0.5, share: 1 }])).toBe(0);
    expect(blueShare([{ h: 236, C: BLUE_MIN_CHROMA, share: 1 }])).toBe(1);
  });

  it("**露草と藍を分離しないことを、テストとして固定する**", () => {
    // SPEC §2.8 の実測値。この 2 つが同じ側に入ることは欠陥ではなく、
    // 指標の射程の限界である —— 変更したら主張の意味も変わる
    const tsuyukusa = { h: 235.5, C: 0.134, share: 0.5 };
    const ai = { h: 236.8, C: 0.09, share: 0.5 };
    expect(blueShare([tsuyukusa])).toBe(0.5);
    expect(blueShare([ai])).toBe(0.5);
    expect(Math.abs(tsuyukusa.h - ai.h)).toBeLessThan(2);
  });
});
