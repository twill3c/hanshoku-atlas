// フリート規約のフッタを判定する規則(koho-lens が正本)。
//
//   MIT License © 2026 坂田哲朗 ・ GitHub ・ <歩き方> ・ <設計図> ・ App Menu
//
// **文言では照合しない。** 3・4 番目は各アプリの和名+固有動詞を温存する規約なので、
// 行き先(claude.ai の artifact)と位置(GitHub と App Menu の間)で見る。
//
// **区切りの「・」で分割しない。** 区切りを CSS の ::before で描いていると
// innerText に入らず、6 項目が 1 項目に見える(実測 2026-08-31)。**出現順**で照合する。
//
// この規則はブラウザの外でも動くので、対照つきで単体テストできる(tests/footer.test.ts)。

/**
 * @param {{text: string, links: {text: string, href: string}[], fixed: string}} f
 * @returns {string[]} 違反の一覧。空なら規約どおり
 */
export function judgeFooter(f) {
  const problems = [];
  if (!f) return ["footer が無い"];

  const text = (f.text ?? "").replace(/\s+/g, " ").trim();
  const links = f.links ?? [];

  const iLic = text.indexOf("MIT License");
  const iCopy = text.indexOf("© 2026 坂田哲朗");
  const iGh = text.indexOf("GitHub", Math.max(iLic, 0));
  const iMenu = text.lastIndexOf("App Menu");

  if (iLic < 0) problems.push("MIT License が無い");
  if (iCopy <= iLic) problems.push("© が MIT License の後に無い");
  if (iGh <= iCopy) problems.push("GitHub が © の後に無い");
  if (iMenu <= iGh) problems.push("App Menu が最後に無い");

  const arts = links.filter((l) => (l.href ?? "").startsWith("https://claude.ai/code/artifact/"));
  if (arts.length !== 2) problems.push(`歩き方/設計図のリンクが 2 本でない(${arts.length} 本)`);
  for (const a of arts) {
    const at = text.indexOf(a.text);
    if (!(at > iGh && at < iMenu)) problems.push(`「${a.text}」が GitHub と App Menu の間に無い`);
  }

  if (links.length !== 5) problems.push(`リンクが 5 本でない(${links.length} 本)`);

  // **「どれかが github.com を向いている」では足りない。**
  // MIT License のリンク先も github.com なので、それだけで通ってしまう
  // ——「GitHub の行き先を別ホストにする」という壊し方を落とせなかった(実測 2026-08-31)。
  // 文言が規約で固定されている項目は、**その項目の行き先**を見る。
  const hostOf = (href) => {
    try {
      return new URL(href).host;
    } catch {
      return "";
    }
  };
  for (const [label, want] of [
    ["MIT License", "github.com"],
    ["GitHub", "github.com"],
    ["App Menu", "app-menu-amber.vercel.app"],
  ]) {
    const link = links.find((l) => l.text === label);
    if (!link) problems.push(`「${label}」のリンクが無い`);
    else if (hostOf(link.href) !== want) problems.push(`「${label}」の行き先が ${hostOf(link.href) || "不正な URL"}(規約は ${want})`);
  }

  if (f.fixed !== "fixed") problems.push(`position: fixed でない(${f.fixed})`);

  return problems;
}

/** 規約どおりのフッタ。対照の基準にも使う。 */
export const CONFORMING_FOOTER = {
  text: "MIT License © 2026 坂田哲朗 ・ GitHub ・ 版色アトラスの歩き方 ・ 版色アトラスの設計図 ・ App Menu",
  links: [
    { text: "MIT License", href: "https://github.com/twill3c/hanshoku-atlas/blob/main/LICENSE" },
    { text: "GitHub", href: "https://github.com/twill3c/hanshoku-atlas" },
    { text: "版色アトラスの歩き方", href: "https://claude.ai/code/artifact/53dcce2c-f144-4615-8418-d3e3faad5be7" },
    { text: "版色アトラスの設計図", href: "https://claude.ai/code/artifact/5a6c3bad-00fc-463d-ad9a-55b0710b1b53" },
    { text: "App Menu", href: "https://app-menu-amber.vercel.app/" },
  ],
  fixed: "fixed",
};
