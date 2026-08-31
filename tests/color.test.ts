// T-001〜T-005 — 色変換と PRNG。
//
// 期待値の出所(HC-016):
//   T-002〜T-004 は tests/fixtures/color_oracle.json。生成元は **colour-science 0.4.7**
//   (Python の独立実装)で、本実装とコードを共有しない。循環していない(G-05)。
//   T-001 はテスト内で BigInt により独立再計算する(実装は Math.imul / >>>0 の 32 ビット演算、
//   テストは BigInt の mod 2^32 演算 — 同じ仕様の別経路)。
//
// 許容差の根拠(TEST_SPEC「閾値」):
//   colour-science は sRGB → XYZ → OKLab を通り、本実装は線形 sRGB → LMS を
//   Ottosson の行列で直接変換する。**経路が違うので厳密一致はしない**
//   (白 #FFFFFF の OKLab L は colour-science で 1.000001735、本実装で 1)。
//   達成不能な閾値を掲げない(HC-073)。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createRng } from "@/core/rng";
import {
  deltaE2000,
  oklabToOklch,
  oklabToSrgb,
  srgbToLab,
  srgbToOklab,
} from "@/core/color";

type Oracle = {
  oracle: { library: string; version: string };
  conversions: { rgb: number[]; lab: number[]; oklab: number[]; oklch: number[] }[];
  delta_e_2000: { lab1: number[]; lab2: number[]; de2000: number }[];
};

const oracle: Oracle = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/color_oracle.json", import.meta.url)), "utf-8"),
);

const TOL_COMPONENT = 1e-3; // OKLab / Lab の成分
const TOL_DE = 1e-4; // ΔE2000

describe("オラクルそのものの健全性", () => {
  // HC-079: 対照が成り立つ前提を assert で固定する。
  it("オラクルは外部の独立実装から来ている", () => {
    expect(oracle.oracle.library).toBe("colour-science");
    expect(oracle.conversions.length).toBeGreaterThanOrEqual(100);
    expect(oracle.delta_e_2000.length).toBeGreaterThanOrEqual(150);
  });

  it("ΔE2000 の標本は難所を含む —— 同一色・近無彩色・回り込み・青領域", () => {
    const zero = oracle.delta_e_2000.filter((d) => d.de2000 === 0).length;
    const nearNeutral = oracle.delta_e_2000.filter(
      (d) => Math.hypot(d.lab1[1], d.lab1[2]) < 3 && Math.hypot(d.lab2[1], d.lab2[2]) < 3,
    ).length;
    const large = oracle.delta_e_2000.filter((d) => d.de2000 > 20).length;
    expect(zero).toBeGreaterThanOrEqual(10); // 同一色対
    expect(nearNeutral).toBeGreaterThanOrEqual(20); // 色相角が不安定な領域
    expect(large).toBeGreaterThanOrEqual(20); // 大きく離れた対
  });
});

describe("T-001 mulberry32 —— BigInt による独立再計算と一致する", () => {
  // 実装は Math.imul と >>>0 で 32 ビットに畳む。ここでは BigInt で mod 2^32 を明示的に取る。
  // 同じ仕様を別の演算経路で辿るので、実装のビット演算の取り違えを捕まえられる。
  const M = 1n << 32n;
  function reference(seed: number, n: number): number[] {
    let a = BigInt(seed >>> 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      a = (a + 0x6d2b79f5n) % M;
      let t = a;
      t = ((t ^ (t >> 15n)) * (t | 1n)) % M;
      t = (t ^ ((t + ((t ^ (t >> 7n)) * (t | 61n)) % M) % M)) % M;
      out.push(Number((t ^ (t >> 14n)) % M) / 4294967296);
    }
    return out;
  }

  it.each([0, 1, 42, 20260831, 0xffffffff])("seed=%i の先頭 1000 個が一致する", (seed) => {
    const rng = createRng(seed);
    const got = Array.from({ length: 1000 }, () => rng());
    expect(got).toEqual(reference(seed, 1000));
  });

  it("値域は [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("T-002 sRGB → OKLab がオラクルと一致する", () => {
  it(`${oracle.conversions.length} 色すべてで各成分 |Δ| ≤ ${TOL_COMPONENT}`, () => {
    const worst = { d: 0, rgb: [0, 0, 0] as number[] };
    for (const c of oracle.conversions) {
      const got = srgbToOklab(c.rgb[0], c.rgb[1], c.rgb[2]);
      for (let i = 0; i < 3; i++) {
        const d = Math.abs(got[i] - c.oklab[i]);
        if (d > worst.d) {
          worst.d = d;
          worst.rgb = c.rgb;
        }
      }
    }
    expect(worst.d, `最悪は rgb=${worst.rgb} で Δ=${worst.d}`).toBeLessThanOrEqual(TOL_COMPONENT);
  });
});

describe("T-003 sRGB → CIELAB(D65)がオラクルと一致する", () => {
  it(`${oracle.conversions.length} 色すべてで各成分 |Δ| ≤ ${TOL_COMPONENT}`, () => {
    const worst = { d: 0, rgb: [0, 0, 0] as number[] };
    for (const c of oracle.conversions) {
      const got = srgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]);
      for (let i = 0; i < 3; i++) {
        const d = Math.abs(got[i] - c.lab[i]);
        if (d > worst.d) {
          worst.d = d;
          worst.rgb = c.rgb;
        }
      }
    }
    expect(worst.d, `最悪は rgb=${worst.rgb} で Δ=${worst.d}`).toBeLessThanOrEqual(TOL_COMPONENT);
  });
});

describe("T-004 ΔE2000 がオラクルと一致する", () => {
  it(`${oracle.delta_e_2000.length} 対すべてで |Δ| ≤ ${TOL_DE}`, () => {
    const worst = { d: 0, pair: "" };
    for (const p of oracle.delta_e_2000) {
      const got = deltaE2000(
        [p.lab1[0], p.lab1[1], p.lab1[2]],
        [p.lab2[0], p.lab2[1], p.lab2[2]],
      );
      const d = Math.abs(got - p.de2000);
      if (d > worst.d) {
        worst.d = d;
        worst.pair = `${JSON.stringify(p.lab1)} vs ${JSON.stringify(p.lab2)} 期待 ${p.de2000} 実際 ${got}`;
      }
    }
    expect(worst.d, worst.pair).toBeLessThanOrEqual(TOL_DE);
  });

  it("同一色の ΔE は厳密に 0", () => {
    for (const p of oracle.delta_e_2000.filter((x) => x.de2000 === 0)) {
      expect(deltaE2000(p.lab1 as [number, number, number], p.lab2 as [number, number, number])).toBe(0);
    }
  });

  it("対称である —— ΔE(a,b) = ΔE(b,a)", () => {
    for (const p of oracle.delta_e_2000) {
      const ab = deltaE2000(p.lab1 as [number, number, number], p.lab2 as [number, number, number]);
      const ba = deltaE2000(p.lab2 as [number, number, number], p.lab1 as [number, number, number]);
      expect(Math.abs(ab - ba)).toBeLessThan(1e-12);
    }
  });
});

describe("T-005 OKLab → sRGB の往復", () => {
  it("8 ビットに戻したとき各チャネルの差が 1 以内", () => {
    for (const c of oracle.conversions) {
      const back = oklabToSrgb(srgbToOklab(c.rgb[0], c.rgb[1], c.rgb[2]));
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(back[i] - c.rgb[i])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("OKLCh の h はオラクルと一致する(彩度が十分あるときのみ)", () => {
    // 近無彩色では h が数値的に定義できない。オラクル側の C を見て対象を絞る
    // —— 射程を先に観測してから主張する(HC-040)。
    const target = oracle.conversions.filter((c) => c.oklch[1] > 0.01);
    expect(target.length).toBeGreaterThan(50);
    for (const c of target) {
      const got = oklabToOklch(srgbToOklab(c.rgb[0], c.rgb[1], c.rgb[2]));
      // 円環上の差 —— [-180, 180) に畳んでから絶対値を取る
      const dh = Math.abs(((got.h - c.oklch[2] + 540) % 360) - 180);
      expect(dh, `rgb=${c.rgb} 期待 h=${c.oklch[2]} 実際 h=${got.h}`).toBeLessThan(0.5);
    }
  });
});
