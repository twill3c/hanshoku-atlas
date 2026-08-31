// T-021 — フッタ規約の判定規則。
//
// **検査そのものをテストする**(HC-041)。フッタは実ブラウザ検品でしか見ないので、
// 判定規則が黙って壊れると「規約どおり」が出続ける。
// 陰性対照(規約どおりのフッタは通る)と陽性対照(壊し方ごとに落ちる)を対で置く。
//
// 期待値の出所: フリート規約(koho-lens が正本)。
//   MIT License © 2026 坂田哲朗 ・ GitHub ・ <歩き方> ・ <設計図> ・ App Menu

import { describe, expect, it } from "vitest";
// @ts-expect-error — 規則は実ブラウザ検品(.mjs)と共有するので型定義を持たない
import { CONFORMING_FOOTER, judgeFooter } from "../scripts/footer-rule.mjs";

type Footer = {
  text: string;
  links: { text: string; href: string }[];
  fixed: string;
};

const ok: Footer = CONFORMING_FOOTER;

/** 規約どおりのフッタを一箇所だけ壊す */
function broken(f: (x: Footer) => Footer): Footer {
  return f({ ...ok, links: ok.links.map((l) => ({ ...l })) });
}

describe("T-021 フッタ規約の判定規則", () => {
  it("陰性対照 —— 規約どおりのフッタは通る(誤検出 0)", () => {
    expect(judgeFooter(ok)).toEqual([]);
  });

  it("陽性対照 —— 壊し方ごとに落ちる", () => {
    const cases: [string, Footer][] = [
      [
        "App Menu が無い",
        broken((f) => ({
          ...f,
          text: f.text.replace(" ・ App Menu", ""),
          links: f.links.filter((l) => l.text !== "App Menu"),
        })),
      ],
      [
        "GitHub が © より前",
        broken((f) => ({ ...f, text: "GitHub ・ MIT License © 2026 坂田哲朗 ・ 版色アトラスの歩き方 ・ 版色アトラスの設計図 ・ App Menu" })),
      ],
      [
        "歩き方だけで設計図が無い",
        broken((f) => ({
          ...f,
          text: f.text.replace(" ・ 版色アトラスの設計図", ""),
          links: f.links.filter((l) => l.text !== "版色アトラスの設計図"),
        })),
      ],
      [
        "アーティファクトが App Menu より後ろ",
        broken((f) => ({
          ...f,
          text: "MIT License © 2026 坂田哲朗 ・ GitHub ・ App Menu ・ 版色アトラスの歩き方 ・ 版色アトラスの設計図",
        })),
      ],
      ["position が fixed でない", broken((f) => ({ ...f, fixed: "static" }))],
      [
        "GitHub のリンク先が別ホスト",
        broken((f) => ({
          ...f,
          links: f.links.map((l) => (l.text === "GitHub" ? { ...l, href: "https://example.com/" } : l)),
        })),
      ],
      ["フッタが無い", null as unknown as Footer],
    ];

    for (const [label, f] of cases) {
      expect(judgeFooter(f), `「${label}」を落とせていない`).not.toEqual([]);
    }
  });

  it("区切りの「・」が innerText に無くても通る —— CSS の ::before で描く実装への対応", () => {
    // 実測 2026-08-31: 区切りを CSS で描くと innerText に入らない。
    // 「・」で分割して数える実装は、正しいフッタを 1 項目と誤判定した。
    const noSeparators: Footer = { ...ok, text: ok.text.split(" ・ ").join(" ") };
    expect(noSeparators.text).not.toContain("・");
    expect(judgeFooter(noSeparators)).toEqual([]);
  });
});
