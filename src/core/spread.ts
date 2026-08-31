// ⑤ 摺りの散らばり(F-09)。**同じ版から出た色が、摺りをまたいでどれだけ散るか。**
//
// これが測れると、①〜④ の数字に付けるべき誤差棒が決まる(G-09)——
// この幅より細かいことを主張してはならない。
//
// **仮定を隠さない。** 摺りをまたいで「同じ版」を突き合わせる術は、色の近さしかない。
// ここでは基準の摺りに対して**ΔE2000 が小さい対から順に一対一で結ぶ**。
// これは「同じ版は摺りをまたいでも最も近い色として現れる」という仮定であって、
// 保証ではない。**大きく褪せた版は別の版と結ばれうる** —— だから結果は
// 「散らばりの下限」ではなく「この対応づけのもとでの散らばり」である。

import { deltaE2000, srgbToLab, type RGB } from "./color";

export type SpreadInput = {
  /** 受入番号。摺りを見分ける唯一の名前 */
  accession: string;
  plates: { index: number; rgb: RGB; hex: string; share: number; oklch: { L: number; C: number; h: number } }[];
};

export type SpreadPlate = {
  /** 基準の摺りにおける版 */
  ref: SpreadInput["plates"][number];
  members: { accession: string; plate: SpreadInput["plates"][number]; de: number }[];
  /** 基準からの ΔE2000 の最大 */
  deMax: number;
  /** 面積比の最小・最大(基準を含む) */
  shareMin: number;
  shareMax: number;
};

export type Spread = {
  reference: string;
  plates: SpreadPlate[];
  /** 全版・全摺りの ΔE2000 の中央値と最大 */
  deMedian: number;
  deMax: number;
  /** 面積比の幅(max − min)の中央値と最大 */
  shareSpreadMedian: number;
  shareSpreadMax: number;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 基準の版に、相手の版を ΔE の小さい対から一対一で結ぶ。 */
function matchTo(
  ref: SpreadInput["plates"],
  other: SpreadInput["plates"],
): Map<number, { plate: SpreadInput["plates"][number]; de: number }> {
  const pairs: { i: number; j: number; de: number }[] = [];
  for (let i = 0; i < ref.length; i++) {
    for (let j = 0; j < other.length; j++) {
      pairs.push({ i, j, de: deltaE2000(srgbToLab(...ref[i].rgb), srgbToLab(...other[j].rgb)) });
    }
  }
  // 同点は添字順で決める —— 決定論を保つ
  pairs.sort((a, b) => a.de - b.de || a.i - b.i || a.j - b.j);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  const out = new Map<number, { plate: SpreadInput["plates"][number]; de: number }>();
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i);
    usedJ.add(p.j);
    out.set(p.i, { plate: other[p.j], de: p.de });
  }
  return out;
}

/**
 * 摺りをまたいだ散らばりを測る。
 * 基準は既定で先頭 —— **どれを基準にしても幅そのものは変わらない**が、
 * 対応づけは変わりうる。基準は画面に出す。
 */
export function measureSpread(impressions: SpreadInput[], referenceIndex = 0): Spread {
  if (impressions.length < 2) throw new Error("摺りが 2 つ以上ないと散らばりは測れない");
  const ref = impressions[referenceIndex];
  const others = impressions.filter((_, i) => i !== referenceIndex);
  const matches = others.map((o) => ({ accession: o.accession, m: matchTo(ref.plates, o.plates) }));

  const plates: SpreadPlate[] = ref.plates.map((rp, i) => {
    const members = matches
      .map((x) => {
        const hit = x.m.get(i);
        return hit ? { accession: x.accession, plate: hit.plate, de: hit.de } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const shares = [rp.share, ...members.map((m) => m.plate.share)];
    return {
      ref: rp,
      members,
      deMax: members.length ? Math.max(...members.map((m) => m.de)) : 0,
      shareMin: Math.min(...shares),
      shareMax: Math.max(...shares),
    };
  });

  const allDe = plates.flatMap((p) => p.members.map((m) => m.de));
  const allSpread = plates.map((p) => p.shareMax - p.shareMin);

  return {
    reference: ref.accession,
    plates,
    deMedian: median(allDe),
    deMax: allDe.length ? Math.max(...allDe) : 0,
    shareSpreadMedian: median(allSpread),
    shareSpreadMax: allSpread.length ? Math.max(...allSpread) : 0,
  };
}

/**
 * **G-09 —— 主張してよい桁を散らばりから決める。**
 *
 * 規約は一文で言える ——
 * **最後に表示する桁は、散らばりが飲み込まない最初の桁である。**
 *
 * 面積比の散らばりが 6 ポイントあるのに「24.9 %」と出せば、0.1 ポイントの分解能を
 * 主張したことになる。実際には 6 ポイント動くのだから嘘である。
 * 表示の単位は **幅以下で最大の 10 のべき**(6 ポイントなら 1 ポイント刻み → 「25 %」)。
 *
 * 返すのは小数点以下の桁数。`-1` は 10 % 刻みを意味する。
 */
export function sharePrecision(shareSpread: number): number {
  const points = shareSpread * 100;
  if (!(points > 0)) return 2;
  // 幅以下で最大の 10 のべき。0.01 ポイントより細かくは出さず、10 ポイントより粗くもしない
  const e = Math.floor(Math.log10(points));
  // `-0` を返さない —— Object.is(-0, 0) は false で、比較の場所によって挙動が割れる
  return -Math.min(1, Math.max(-2, e)) || 0;
}

/** 桁に従って面積比を文字列にする。**桁は散らばりが決める**(G-09) */
export function formatShare(share: number, precision: number): string {
  const pct = share * 100;
  if (precision < 0) {
    // 10 % 刻みで 0 に丸まる版を「0 %」と書くと、**無いことになってしまう**。
    // 刻みより小さいことしか言えない、と書く
    if (pct < 5) return "< 10 %";
    return `${Math.round(pct / 10) * 10} %`;
  }
  return `${pct.toFixed(Math.max(0, precision))} %`;
}

/**
 * **⑤ で測った誤差棒(実測 2026-08-31)。**
 *
 * Met 館内の同一図柄・複数摺りで測った面積比の幅(中央値):
 *
 * | 図柄 | 摺り | ΔE 中央 | ΔE 最大 | 面積比の幅 中央 | 最大 | 怪しい対応 |
 * |---|--:|--:|--:|--:|--:|--:|
 * | 神奈川沖浪裏(北斎) | 4 | 6.1 | 14.1 | 4.3 pt | 23.0 pt | 4 |
 * | 甲州石班沢(北斎) | 3 | 4.4 | 20.7 | 5.9 pt | 17.9 pt | 1 |
 * | 大はしあたけの夕立(広重) | 4 | 4.6 | 44.3 | 4.5 pt | 14.5 pt | 1 |
 *
 * **ΔE の中央値が 4.4〜6.1** —— 同じ版から出た色の半分が、
 * 「誰にでも別の色に見える」とされる ΔE 5 の前後まで散っている。
 *
 * ① が面積比を出す桁は、この 3 図柄の中央値の中央値(4.5 ポイント)から決める。
 * **1 図柄の幅を代表値にしない。**
 */
export const MEASURED_SHARE_SPREAD = 0.045;

/**
 * **対応づけが怪しい閾値。**
 *
 * ΔE2000 は 5 を超えれば誰にでも別の色に見える。10 を超える対応を「同じ版」と呼ぶのは苦しい
 * —— それは褪色の大きさではなく、**対応づけが別の版を掴んだ**可能性のほうが高い。
 *
 * **怪しい対応を幅の計算から外さない。** 外せば幅は小さくなるが、
 * 対応がつかないという事実は「よく分からない」であって「よく一致した」ではない。
 * **保守側(大きい幅)を採る。**画面には怪しい対応の件数を出し、読み手が判断できるようにする。
 */
export const DOUBTFUL_DE = 10;

/** 怪しい対応の件数を数える。 */
export function countDoubtful(spread: Spread): number {
  return spread.plates.reduce((n, p) => n + p.members.filter((m) => m.de > DOUBTFUL_DE).length, 0);
}
