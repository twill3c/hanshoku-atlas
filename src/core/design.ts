// 同一図柄の判定(F-09 の網羅を数えるため)。
//
// **Met の Title 列は同一性の鍵として設計されていない。** 実測 2026-09-01:
//
//   - 枠 3,833 件のうち **題名があるのは 1,468 件(38.3 %)だけ**。残りは空欄で、
//     同一図柄かどうかを判定する材料が無い
//   - 神奈川沖浪裏の 4 摺りは、英題が
//     「… **also known as** the great wave …」と「… **or** the great wave …」で割れる。
//     **同じ図柄が別の題名を持つ**
//   - 逆に最初のコンマまでで切ると「spring rain collection harusame shū」が 14 件束なる。
//     **これは図柄ではなく叢書の名前**である
//
// だから一つの規則で数えない。**厳しい規則と緩い規則の二つで数えて、間に挟む。**

const BRACKETS = /[「」『』"“”'‘’()（）]/g;

/** 英題の側を採る。和題は表記が揺れる(冨嶽 / 富嶽、括弧の有無)。 */
function englishPart(title: string): string {
  const i = title.indexOf("|");
  return i >= 0 ? title.slice(i + 1) : title;
}

/**
 * 厳しい規則 —— 英題まるごと。
 * **同じ図柄を取りこぼす**(説明句の言い回しが違えば別扱い)。下限を与える。
 */
export function strictDesignKey(title: string): string {
  return englishPart(title).normalize("NFKC").replace(BRACKETS, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 緩い規則 —— 最初のコンマまで。
 * **別の図柄を束ねうる**(叢書名や宿場名が一致するだけの作品)。上限を与える。
 */
export function looseDesignKey(title: string): string {
  return strictDesignKey(title).split(",")[0].trim();
}

export type DesignCount = {
  /** 題名があり、数えられた作品 */
  titled: number;
  /** 同一鍵が 2 件以上ある図柄の数 */
  designs: number;
  /** そこに属する作品の数 */
  works: number;
  /** 一つの鍵に集まった最大数 */
  max: number;
};

/** 鍵ごとに束ねて、複数摺りのある図柄を数える。 */
export function countDesigns(titles: string[], keyOf: (t: string) => string): DesignCount {
  const titled = titles.filter((t) => t.trim().length > 0);
  const groups = new Map<string, number>();
  for (const t of titled) {
    const k = keyOf(t);
    if (!k) continue;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  let designs = 0;
  let works = 0;
  let max = 0;
  for (const n of groups.values()) {
    if (n < 2) continue;
    designs++;
    works += n;
    if (n > max) max = n;
  }
  return { titled: titled.length, designs, works, max };
}
