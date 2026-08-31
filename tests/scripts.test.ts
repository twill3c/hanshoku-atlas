// T-022 — 検品器・生成器の構文検査。
//
// **検品器は、壊れていても誰も教えてくれない**(HC-080)。テストから import されないので、
// 実行するまで構文エラーに気づかない。実際 loop_003 で `scripts/verify-browser.mjs` の
// 閉じ括弧を落として `SyntaxError` にし、走らせるまで分からなかった(HC-042 の再発)。
//
// 期待値の出所: 実測 —— `node --check` が 0 を返すこと。

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SCRIPTS = fileURLToPath(new URL("../scripts", import.meta.url));

describe("T-022 scripts の構文検査", () => {
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs"));

  it("走査対象が空でない —— 検査が空振りしていないこと", () => {
    // HC-041: 走査対象が空でないことを別ケースで確かめる
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s が構文として妥当", (f) => {
    expect(() => execFileSync(process.execPath, ["--check", join(SCRIPTS, f)])).not.toThrow();
  });

  it("陽性対照 —— node --check は壊れたソースを実際に落とす", () => {
    // 検査そのものをテストする。落とせないなら、上の緑は何も意味しない
    expect(() =>
      execFileSync(process.execPath, ["--check", fileURLToPath(new URL("./fixtures/broken.mjs.txt", import.meta.url))]),
    ).toThrow();
  });
});
