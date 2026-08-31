// ⑥ 伝統色との照合(F-12)。
//
// **「これは藍鼠」とは言えない。**物差しの側がそれだけの分解能を持っていないからである。
//
// iro-koyomi の実測(伝統色 369 色):**同じ色名の hex が出典間で ΔE2000 の中央値 13.96 ずれている**
// (藍色 14.9 / 藍鼠 20.7 / 紫 24.1)。出典はどちらも HEX の典拠を示しておらず、
// ja 版は冒頭に「近似色であり一例」と書いている。
//
// さらに ⑤ の実測では、**同じ版木から摺られた色が ΔE2000 の中央値 4.4〜6.1 散る**。
// 二つを足せば、当てにいける精度は残っていない。
//
// だからここは**最も近い一色を当てない**。**物差しの目盛りの中に入る色名を全部並べる。**
// 「候補が 12 個ある」という事実そのものが、この照合の分解能である。

import { deltaE2000, srgbToLab, type Lab, type RGB } from "./color";

/** 物差しの目盛り幅。**iro-koyomi の実測値そのもの**(出典間の ΔE2000 中央値) */
export const RULER_WIDTH = 13.96;

export type PaletteEntry = {
  name: string;
  readings?: Record<string, string>;
  hex_by_source: Record<string, string>;
  delta_e: number | null;
  provenance: string;
};

export type Candidate = {
  name: string;
  /** 出典ごとの hex と、抽出色からの ΔE2000 */
  sources: { source: string; hex: string; de: number }[];
  /** 最も近い出典での ΔE2000 */
  de: number;
  /** 出典間の食い違い(両出典に値があるときだけ) */
  sourceSpread: number | null;
};

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * 目盛りの中に入る色名を全部返す(近い順)。
 *
 * **一位だけを返さない。** 一位と二位の差が目盛り幅より小さければ、
 * その二つを区別する根拠は無い。
 */
export function candidatesWithin(rgb: RGB, palette: PaletteEntry[], ruler = RULER_WIDTH): Candidate[] {
  const lab: Lab = srgbToLab(...rgb);
  const out: Candidate[] = [];
  for (const e of palette) {
    const sources: Candidate["sources"] = [];
    for (const [source, hex] of Object.entries(e.hex_by_source)) {
      const c = hexToRgb(hex);
      if (!c) continue;
      sources.push({ source, hex: hex.toUpperCase(), de: deltaE2000(lab, srgbToLab(...c)) });
    }
    if (sources.length === 0) continue;
    sources.sort((a, b) => a.de - b.de || a.source.localeCompare(b.source));
    const de = sources[0].de;
    if (de > ruler) continue;
    out.push({
      name: e.name,
      sources,
      de,
      sourceSpread: typeof e.delta_e === "number" ? e.delta_e : null,
    });
  }
  out.sort((a, b) => a.de - b.de || a.name.localeCompare(b.name));
  return out;
}

/**
 * 絵師の署名を束ねる規則(F-13)。
 *
 * **末尾の CJK だけを落とす。**Met の署名には `Katsushika Hokusai 葛飾北斎` のように
 * 同じ人物が英字だけの版と和名付きの版で二重に入っているものがある。
 * **非 ASCII をすべて落とすと `Shunshō` の `ō` まで消える**ので、CJK の範囲に限る(実測 2026-08-31)。
 *
 * **共同署名(`|` を含むもの)は束ねない。** 彫師と絵師のどちらが先に来るかが一定でなく、
 * 「主たる絵師」を機械的に決める規則を作れない。別の絵師として扱い、そう書く。
 *
 * この規則が束ねる組は実測で **7 組**(春章 / 北斎 / 是真 / 俊満 / 辰斎 / 国貞 / 貞信)。
 */
// 範囲は符号位置で書く。**パターンに CJK を直接置かない** ——
// シェルや編集経路を通ると字が落ちても構文は通り、黙って何も一致しなくなる(HC-042)。
//   U+3000–U+303F 記号(表意文字空白を含む) / U+3040–U+30FF かな
//   U+3400–U+4DBF 拡張A / U+4E00–U+9FFF 統合漢字 / U+F900–U+FAFF 互換漢字
const TRAILING_CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿\s]+$/u;

export function normalizeArtist(name: string): string {
  return name.replace(TRAILING_CJK, "");
}
