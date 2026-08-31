// T-043〜T-046 — 同一図柄の判定(F-09 の網羅)。
//
// **判定則は実データ全件に当ててから使う**(HC-083)。ここでは枠 3,833 件に当て、
// 当たった数・外れた数・具体例を固定する。
//
// 期待値の出所: `data/frame.json`(収蔵目録 CSV から抽出規則 6 つで作った枠)の実測。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { countDesigns, looseDesignKey, strictDesignKey } from "@/core/design";

const frame: { count: number; works: { title: string }[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../data/frame.json", import.meta.url)), "utf-8"),
);
const titles = frame.works.map((w) => w.title);

describe("標本の前提", () => {
  it("枠は 3,833 件、**題名があるのは 1,468 件だけ**", () => {
    // 実測 2026-09-01。CSV の Title 列は 6 割が空欄で、同一性を判定する材料が無い
    expect(frame.count).toBe(3833);
    expect(titles.filter((t) => t.trim()).length).toBe(1468);
  });
});

describe("T-043 二つの規則が、上限と下限を与える", () => {
  const strict = countDesigns(titles, strictDesignKey);
  const loose = countDesigns(titles, looseDesignKey);

  it("厳しい規則(英題まるごと)—— 143 図柄 / 327 作品", () => {
    expect(strict.designs).toBe(143);
    expect(strict.works).toBe(327);
  });

  it("緩い規則(最初のコンマまで)—— 159 図柄 / 404 作品", () => {
    expect(loose.designs).toBe(159);
    expect(loose.works).toBe(404);
  });

  it("**緩い規則は厳しい規則を必ず含む**(束ねる方向にしか動かない)", () => {
    expect(loose.designs).toBeGreaterThanOrEqual(strict.designs);
    expect(loose.works).toBeGreaterThanOrEqual(strict.works);
  });
});

describe("T-044 厳しい規則は、同じ図柄を取りこぼす", () => {
  it("神奈川沖浪裏の 4 摺りが 3 + 1 に割れる", () => {
    // 英題が「… also known as the great wave …」と「… or the great wave …」で違う。
    // **同じ図柄が別の題名を持つ** —— Title 列は同一性の鍵ではない
    const wave = titles.filter((t) => strictDesignKey(t).startsWith("under the wave off kanagawa"));
    expect(wave.length).toBe(4);
    const keys = new Set(wave.map(strictDesignKey));
    expect(keys.size).toBe(2);
  });

  it("緩い規則なら 4 つとも束なる", () => {
    const wave = titles.filter((t) => looseDesignKey(t).startsWith("under the wave off kanagawa"));
    expect(new Set(wave.map(looseDesignKey)).size).toBe(1);
    expect(wave.length).toBe(4);
  });
});

describe("T-045 緩い規則は、別の図柄を束ねる", () => {
  it("「spring rain collection harusame shū」が 14 件に膨らむ —— これは叢書名である", () => {
    const n = titles.filter((t) => looseDesignKey(t) === "spring rain collection harusame shū").length;
    expect(n).toBe(14);
    // 厳しい規則ならばらける
    const keys = new Set(
      titles.filter((t) => looseDesignKey(t) === "spring rain collection harusame shū").map(strictDesignKey),
    );
    expect(keys.size).toBeGreaterThan(1);
  });
});

describe("T-046 鍵の作り方", () => {
  it("英題の側を採る —— 和題は表記が揺れる(冨嶽 / 富嶽、括弧の有無)", () => {
    const a = "冨嶽三十六景　神奈川沖浪裏|Under the Wave off Kanagawa";
    const b = "「富嶽三十六景　神奈川沖浪裏」|Under the Wave off Kanagawa";
    expect(strictDesignKey(a)).toBe(strictDesignKey(b));
  });

  it("括弧と引用符を落とし、空白を畳む", () => {
    expect(strictDesignKey("|  “Ejiri”  (Sunshū)  ")).toBe("ejiri sunshū");
  });

  it("| が無ければ全体を使う", () => {
    expect(strictDesignKey("Plain Title")).toBe("plain title");
  });

  it("空の題名は数えない", () => {
    expect(countDesigns(["", "  ", ""], strictDesignKey)).toEqual({ titled: 0, designs: 0, works: 0, max: 0 });
  });
});
