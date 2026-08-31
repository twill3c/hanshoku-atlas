// T-027〜T-030 — 摺りの散らばり(F-09 / G-09)。
//
// 期待値の出所: **構成的**。既知の量だけずらした摺りを作り、測った幅がその量に一致するかを見る。
// 本物の版画に対する「正しい散らばり」は存在しない —— 存在しないものを期待値にしない。

import { describe, expect, it } from "vitest";
import { deltaE2000, rgbToHex, srgbToLab, srgbToOklab, oklabToOklch, type RGB } from "@/core/color";
import {
  DOUBTFUL_DE,
  countDoubtful,
  formatShare,
  measureSpread,
  sharePrecision,
  type SpreadInput,
} from "@/core/spread";

function plate(index: number, rgb: RGB, share: number) {
  const oklab = srgbToOklab(...rgb);
  return { index, rgb, hex: rgbToHex(rgb), share, oklch: oklabToOklch(oklab) };
}

/**
 * 版色が明確に離れた基準の摺り。**合成である。**
 *
 * 本物の版色をそのまま使おうとして失敗した(実測 2026-08-31)——
 * 神奈川沖浪裏 JP10 の 2 つの藍 `#3B5266` と `#293A47` は **ΔE2000 で 8.29 しか離れていない**。
 * 対応づけの機構を試すには、対応が一意でない標本は使えない。
 * **この事実自体は対応づけの仮定に対する警告なので、T-031 に別に残してある。**
 */
const BASE: RGB[] = [
  [225, 204, 171],
  [59, 82, 102],
  [143, 46, 20],
  [70, 120, 60],
];

function impression(accession: string, rgbs: RGB[], shares: number[]): SpreadInput {
  return { accession, plates: rgbs.map((c, i) => plate(i, c, shares[i])) };
}

describe("標本の前提", () => {
  it("基準の版色は互いに十分離れている —— でないと対応づけが意味を持たない", () => {
    for (let i = 0; i < BASE.length; i++) {
      for (let j = i + 1; j < BASE.length; j++) {
        expect(deltaE2000(srgbToLab(...BASE[i]), srgbToLab(...BASE[j]))).toBeGreaterThan(12);
      }
    }
  });
});

describe("T-027 同じ摺りを並べれば散らばりは 0", () => {
  it("ΔE も面積比の幅も 0", () => {
    const shares = [0.4, 0.3, 0.2, 0.1];
    const s = measureSpread([impression("A", BASE, shares), impression("B", BASE, shares)]);
    expect(s.deMax).toBe(0);
    expect(s.shareSpreadMax).toBe(0);
    expect(s.reference).toBe("A");
  });
});

describe("T-028 版の並び順が変わっても、色で正しく結ばれる", () => {
  it("面積比を入れ替えて並びを崩しても対応づけが保たれる", () => {
    const a = impression("A", BASE, [0.4, 0.3, 0.2, 0.1]);
    const shuffled: RGB[] = [BASE[2], BASE[0], BASE[3], BASE[1]];
    const b = impression("B", shuffled, [0.2, 0.4, 0.1, 0.3]);
    const s = measureSpread([a, b]);
    expect(s.deMax).toBe(0);
    expect(s.shareSpreadMax).toBe(0);
    // 各版が「同じ色」に結ばれていること
    for (const p of s.plates) {
      expect(p.members[0].plate.hex).toBe(p.ref.hex);
    }
  });
});

describe("T-029 既知のずれを与えると、その大きさが測れる", () => {
  it("1 つの版だけ色をずらすと、その版の ΔE だけが立つ", () => {
    const shares = [0.4, 0.3, 0.2, 0.1];
    const moved: RGB[] = [...BASE];
    moved[1] = [72, 96, 118]; // 藍を少し明るく
    const want = deltaE2000(srgbToLab(...BASE[1]), srgbToLab(...moved[1]));
    expect(want).toBeGreaterThan(1); // 前提: 実際にずれている

    const s = measureSpread([impression("A", BASE, shares), impression("B", moved, shares)]);
    expect(s.deMax).toBeCloseTo(want, 10);
    const target = s.plates.find((p) => p.ref.hex === rgbToHex(BASE[1]));
    expect(target?.deMax).toBeCloseTo(want, 10);
    // 他の版は動いていない
    for (const p of s.plates) {
      if (p.ref.hex !== rgbToHex(BASE[1])) expect(p.deMax).toBe(0);
    }
  });

  it("面積比を既知の量だけずらすと、その幅が返る", () => {
    const a = impression("A", BASE, [0.4, 0.3, 0.2, 0.1]);
    const b = impression("B", BASE, [0.34, 0.36, 0.2, 0.1]);
    const s = measureSpread([a, b]);
    expect(s.shareSpreadMax).toBeCloseTo(0.06, 12);
    expect(s.shareSpreadMedian).toBeCloseTo(0.03, 12);
  });
});

describe("T-030 (G-09) 散らばりが表示の桁を決める", () => {
  // 表は**規則から導いた**ものであって、規則を表に合わせたのではない。
  // 規則が守るべき不変量は次のケースが検査している(表が壊れても不変量は残る)。
  it.each([
    [0.001, 1, "24.9 %"],
    [0.006, 1, "24.9 %"],
    [0.02, 0, "25 %"],
    [0.06, 0, "25 %"],
    [0.2, -1, "20 %"],
  ])("幅 %f → 小数 %i 桁 → 「%s」", (spread, prec, text) => {
    expect(sharePrecision(spread)).toBe(prec);
    expect(formatShare(0.249, sharePrecision(spread))).toBe(text);
  });

  const unitOf = (p: number) => (p < 0 ? 10 : Math.pow(10, -p));
  const SPREADS = [0.002, 0.005, 0.01, 0.03, 0.07, 0.15, 0.4];

  it("**最後の桁は、散らばりが飲み込まない最初の桁** —— 単位 ≤ 幅 < 単位×10", () => {
    for (const spread of SPREADS) {
      const points = spread * 100;
      const unit = unitOf(sharePrecision(spread));
      expect(unit, `幅 ${points} ポイントに対し単位 ${unit} は細かすぎる`).toBeLessThanOrEqual(points + 1e-9);
      expect(points, `幅 ${points} ポイントに対し単位 ${unit} は粗すぎる`).toBeLessThan(unit * 10 + 1e-9);
    }
  });

  it("陽性対照 —— 桁を 1 つ細かくすると、散らばりが最後の桁を 10 倍で飲み込む", () => {
    // 検査そのものをテストする(HC-041)。**全件で破れること**を要求する ——
    // 1 件でも破れないなら、その不変量は「細かすぎる表示」を止めていない
    for (const spread of SPREADS) {
      const finer = unitOf(sharePrecision(spread) + 1);
      expect(spread * 100, `幅 ${spread * 100} で単位 ${finer} が許されてしまう`).toBeGreaterThanOrEqual(
        finer * 10 - 1e-9,
      );
    }
  });
});

describe("T-032 10 % 刻みで 0 に丸まる版を「0 %」と書かない", () => {
  it("刻みより小さいことしか言えない、と書く", () => {
    expect(formatShare(0.038, -1)).toBe("< 10 %");
    expect(formatShare(0.049, -1)).toBe("< 10 %");
    expect(formatShare(0.051, -1)).toBe("10 %");
    // 細かい桁のときは従来どおり
    expect(formatShare(0.038, 1)).toBe("3.8 %");
    expect(formatShare(0.038, 0)).toBe("4 %");
  });
});

describe("T-033 怪しい対応を数える(幅からは外さない)", () => {
  it("ΔE が閾値を超えた対応の件数を返す", () => {
    const shares = [0.4, 0.3, 0.2, 0.1];
    const far: RGB[] = [...BASE];
    far[0] = [40, 40, 40]; // 紙が真っ黒に化けた = 対応づけの破綻に相当
    const s = measureSpread([impression("A", BASE, shares), impression("B", far, shares)]);
    expect(countDoubtful(s)).toBeGreaterThanOrEqual(1);
    // **幅からは外していない** —— 外すと幅が小さく見える
    expect(s.deMax).toBeGreaterThan(DOUBTFUL_DE);
  });

  it("よく一致した組では 0 件", () => {
    const shares = [0.4, 0.3, 0.2, 0.1];
    const s = measureSpread([impression("A", BASE, shares), impression("B", BASE, shares)]);
    expect(countDoubtful(s)).toBe(0);
  });
});

describe("T-031 本物の版色は、対応づけを一意にするほど離れていない", () => {
  it("神奈川沖浪裏 JP10 の 2 つの藍は ΔE2000 で 8.3 —— 対応づけの仮定への警告", () => {
    // 実測 2026-08-31。①(k=8)の出力から取った本物の版色。
    // 摺りをまたいで色が 8.3 以上動けば、この 2 つは入れ替わりうる。
    const ai1: RGB = [0x3b, 0x52, 0x66];
    const ai2: RGB = [0x29, 0x3a, 0x47];
    const de = deltaE2000(srgbToLab(...ai1), srgbToLab(...ai2));
    expect(de).toBeGreaterThan(8);
    expect(de).toBeLessThan(9);
  });
});

describe("摺りが 1 つでは散らばりを測れない", () => {
  it("例外にする —— 黙って 0 を返さない", () => {
    expect(() => measureSpread([impression("A", BASE, [0.4, 0.3, 0.2, 0.1])])).toThrow();
  });
});
