// ⑤ 摺りの散らばり(F-09)が使う図柄。**Met 館内の同一図柄・複数摺り**。
//
// なぜ館内なのか(SPEC §2.2):
//   館をまたぐと、差のうちどこまでが褪色でどこからが撮影条件かを原理的に分離できない。
//   同じ館が同じように撮影した複数摺りなら、残る差は「摺りの違い」と「保存状態の違い」に絞られる。
//
// **網羅していない。** Met の検索 API は標本枠にならない(SPEC §2 —— `q=Hokusai` の 58 件中
// culture が Japan* なのは 5 件)。ここにあるのは題名で引いて実際に確かめた 3 図柄・11 摺りだけで、
// 「Met に同一図柄の複数摺りが何件あるか」は**測っていない**。数えるのは L4 の標本枠
// (MetObjects.csv)の仕事である。
//
// すべて Open Access(CC0)であることを取得時に `isPublicDomain` で確認した(実測 2026-08-31)。
// **画像は再配布しない** —— 参照するだけで、閲覧者のブラウザが同一オリジン経由で取得する(N-03)。

export type Impression = {
  objectId: number;
  /** 受入番号。同じ図柄の摺りを見分ける唯一の名前 */
  accession: string;
  image: string;
};

export type Design = {
  ja: string;
  en: string;
  artist: string;
  date: string;
  impressions: Impression[];
};

export const DESIGNS: Design[] = [
  {
    ja: "神奈川沖浪裏",
    en: "Under the Wave off Kanagawa",
    artist: "葛飾北斎",
    date: "ca. 1830–32",
    impressions: [
      { objectId: 36491, accession: "JP10", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP141063.jpg" },
      { objectId: 45434, accession: "JP1847", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP130155.jpg" },
      { objectId: 39799, accession: "JP2569", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP141042.jpg" },
      { objectId: 56353, accession: "JP2972", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP141067.jpg" },
    ],
  },
  {
    ja: "甲州石班沢",
    en: "Kajikazawa in Kai Province",
    artist: "葛飾北斎",
    date: "ca. 1830–32",
    impressions: [
      { objectId: 39656, accession: "JP1327", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP141013.jpg" },
      { objectId: 39800, accession: "JP2986", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP141085.jpg" },
      { objectId: 56727, accession: "JP2581", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP140973.jpg" },
    ],
  },
  {
    ja: "大はしあたけの夕立",
    en: "Sudden Shower over Shin-Ōhashi Bridge and Atake",
    artist: "歌川広重",
    date: "1857",
    impressions: [
      { objectId: 36461, accession: "JP643", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP121525.jpg" },
      { objectId: 37094, accession: "JP644", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP121526.jpg" },
      { objectId: 55433, accession: "JP2522", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP130156.jpg" },
      { objectId: 37386, accession: "JP3174", image: "https://images.metmuseum.org/CRDImages/as/web-large/DP123602.jpg" },
    ],
  },
];
