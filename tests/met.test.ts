// T-020 — Met 画像 URL の同一オリジン化(SPEC §2.7 / F-05)。
//
// 期待値の出所: 実測 2026-08-31。`images.metmuseum.org` は GET に
// Access-Control-Allow-Origin を返さない(6/6)。HEAD にだけ返す。
// この書き換えが効かないと、実ブラウザで canvas が汚染されて何も測れない。

import { describe, expect, it } from "vitest";
import { toSameOrigin } from "@/core/met";

describe("T-020 toSameOrigin", () => {
  it("images.metmuseum.org を /met/… に寄せる", () => {
    expect(toSameOrigin("https://images.metmuseum.org/CRDImages/as/web-large/DP141063.jpg")).toBe(
      "/met/CRDImages/as/web-large/DP141063.jpg",
    );
    expect(toSameOrigin("http://images.metmuseum.org/a/b.jpg")).toBe("/met/a/b.jpg");
  });

  it("他のホストには触らない —— ACAO を返す配布元は直読みできる", () => {
    for (const u of [
      "https://upload.wikimedia.org/wikipedia/commons/x.jpg",
      "https://www.artic.edu/iiif/2/abc/full/843,/0/default.jpg",
      "/local/fixture.png",
      "",
    ]) {
      expect(toSameOrigin(u)).toBe(u);
    }
  });

  it("紛らわしいホスト名を巻き込まない", () => {
    // 部分一致で拾うと、別ドメインの画像まで自分のオリジンに寄せてしまう
    for (const u of [
      "https://images.metmuseum.org.evil.example/a.jpg",
      "https://notimages.metmuseum.org/a.jpg",
      "https://example.com/?u=https://images.metmuseum.org/a.jpg",
    ]) {
      expect(toSameOrigin(u)).toBe(u);
    }
  });
});
