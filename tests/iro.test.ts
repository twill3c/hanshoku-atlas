// T-038〜T-041 — 伝統色との照合と絵師の名寄せ(F-12 / F-13)。
//
// 期待値の出所: `data/palette.json`(iro-koyomi 由来・CC BY-SA 4.0)と、
// SPEC §2.9 の実測値(出典間の ΔE2000 中央値 13.96)。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RULER_WIDTH, candidatesWithin, normalizeArtist, type PaletteEntry } from "@/core/iro";
import { deltaE2000, srgbToLab, type RGB } from "@/core/color";

const palette: PaletteEntry[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/palette.json", import.meta.url)), "utf-8"),
).colors;

describe("標本の前提", () => {
  it("伝統色は 369 色で、両出典に値がある色の ΔE2000 中央値は 13.96", () => {
    expect(palette.length).toBe(369);
    const both = palette.map((c) => c.delta_e).filter((d): d is number => typeof d === "number");
    const s = [...both].sort((a, b) => a - b);
    const med = s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
    expect(med).toBeCloseTo(13.96, 1);
    expect(RULER_WIDTH).toBeCloseTo(med, 1);
  });
});

describe("T-038 目盛りの中に入る色名を全部返す", () => {
  it("一位だけを返さない —— 藍色に近い色を引くと候補が複数出る", () => {
    const ai: RGB = [0x16, 0x5e, 0x83]; // 藍色(ja)
    const cands = candidatesWithin(ai, palette);
    expect(cands.length).toBeGreaterThan(1);
    expect(cands[0].de).toBeLessThan(1); // 自分自身が一位
    expect(cands.map((c) => c.name)).toContain("藍色");
  });

  it("候補はすべて目盛りの内側にある", () => {
    const c: RGB = [0x3b, 0x52, 0x66]; // ① が出した本物の藍
    for (const cand of candidatesWithin(c, palette)) {
      expect(cand.de).toBeLessThanOrEqual(RULER_WIDTH);
    }
  });

  it("目盛りを狭めれば候補は減る(単調)", () => {
    const c: RGB = [0x3b, 0x52, 0x66];
    const wide = candidatesWithin(c, palette, RULER_WIDTH).length;
    const narrow = candidatesWithin(c, palette, 5).length;
    const tight = candidatesWithin(c, palette, 1).length;
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(tight).toBeLessThanOrEqual(narrow);
  });

  it("近い順に並ぶ", () => {
    const cands = candidatesWithin([0x8f, 0x2e, 0x14], palette);
    for (let i = 1; i < cands.length; i++) expect(cands[i].de).toBeGreaterThanOrEqual(cands[i - 1].de);
  });
});

describe("T-039 一位と二位を区別する根拠が無いことを示す", () => {
  it("本物の版色では、一位と二位の差が目盛り幅より小さい", () => {
    // ① が神奈川沖浪裏(JP10)から出した藍。**この色に「正しい色名」は無い**
    const cands = candidatesWithin([0x3b, 0x52, 0x66], palette);
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const gap = cands[1].de - cands[0].de;
    expect(gap).toBeLessThan(RULER_WIDTH);
  });
});

describe("T-040 出典どうしの食い違いを持ち回る", () => {
  it("両出典に値がある色は sourceSpread を持つ", () => {
    const cands = candidatesWithin([0x16, 0x5e, 0x83], palette);
    const ai = cands.find((c) => c.name === "藍色");
    expect(ai?.sources.length).toBe(2);
    expect(ai?.sourceSpread).toBeCloseTo(14.862, 2); // SPEC §2.9 の実測値
  });

  it("片方の出典しか無い色は sourceSpread が null", () => {
    const cands = candidatesWithin([0x21, 0xa0, 0xdb], palette, 40);
    const t = cands.find((c) => c.name === "露草色");
    expect(t?.sources.length).toBe(1);
    expect(t?.sourceSpread).toBeNull();
  });
});

describe("T-041 絵師の名寄せ", () => {
  it("末尾の CJK だけを落とす —— ō を消さない", () => {
    // 実測 2026-08-31: 非 ASCII をすべて落とす実装は Shunshō の ō まで消した
    expect(normalizeArtist("Katsukawa Shunshō　勝川春章")).toBe("Katsukawa Shunshō");
    expect(normalizeArtist("Katsushika Hokusai 葛飾北斎")).toBe("Katsushika Hokusai");
    expect(normalizeArtist("Ryūryūkyo Shinsai")).toBe("Ryūryūkyo Shinsai");
  });

  it("共同署名は束ねない —— 主たる絵師を機械的に決める規則が作れない", () => {
    // 彫師と絵師のどちらが先に来るかが一定でない(実測 2026-08-31)
    expect(normalizeArtist("Tōshūsai Sharaku|Ueda Shikibuchi")).toBe("Tōshūsai Sharaku|Ueda Shikibuchi");
    expect(normalizeArtist("Yokogawa Horitake|Utagawa Kuniyoshi")).toBe("Yokogawa Horitake|Utagawa Kuniyoshi");
  });

  it("陽性対照 —— 束ねる規則が実際に働く", () => {
    // 束ねないなら、この 2 つは別人として数えられてしまう
    expect(normalizeArtist("Utagawa Kunisada 歌川国貞")).toBe(normalizeArtist("Utagawa Kunisada"));
  });
});

describe("T-042 物差しの幅は、⑤ の誤差棒より広い", () => {
  it("色名の分解能は摺りの散らばりより粗い —— **色名のほうが先に効く**", () => {
    // ⑤ の実測: 同じ版から出た色の ΔE2000 中央値 4.4〜6.1
    const platesSpread = 6.1;
    expect(RULER_WIDTH).toBeGreaterThan(platesSpread);
  });

  it("目盛り幅の中に、本当に別の色が入る", () => {
    // ΔE2000 は 5 を超えれば誰にでも別の色に見える。13.96 の中には十分入る
    const a: RGB = [0x16, 0x5e, 0x83];
    const cands = candidatesWithin(a, palette);
    const far = cands.filter((c) => c.de > 5);
    expect(far.length).toBeGreaterThan(0);
    expect(deltaE2000(srgbToLab(...a), srgbToLab(...a))).toBe(0);
  });
});
