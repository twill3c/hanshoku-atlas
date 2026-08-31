"use client";

// ④ 絵師くらべ(F-13)と ⑥ 伝統色照合(F-12)。
//
// 絵師の色域は、その絵師の版色を**もう一度 k-means にかけて**出す ——
// 一段目は 1 枚の絵の中の版、二段目は 1 人の絵師の中の版。同じ道具を一段上で使っている。
// 1 枚が持つ重みは 1 に揃えてある(多作な絵師の 1 枚が重くならないように)。
//
// ⑥ は**最も近い色名を当てない。** 物差しの目盛り(出典間の ΔE2000 中央値 13.96)の中に
// 入る色名を全部数える。**その数そのものが、この照合の分解能である。**

import { useState } from "react";
import artists from "@/data/artists.json";

export default function EshiPage() {
  const [open, setOpen] = useState<string | null>(artists.artists[0]?.name ?? null);
  const [sort, setSort] = useState<"works" | "blue" | "chroma" | "year">("works");

  const list = [...artists.artists].sort((a, b) =>
    sort === "blue"
      ? b.blue - a.blue
      : sort === "chroma"
        ? b.medianChroma - a.medianChroma
        : sort === "year"
          ? a.from - b.from
          : b.works - a.works,
  );

  return (
    <main>
      <h1>
        版色アトラス
        <span className="en">hanshoku-atlas ④ 絵師くらべ / ⑥ 伝統色との照合</span>
      </h1>

      <nav className="nav">
        <a href="/">① 一枚解剖</a>
        <a href="/suri/">⑤ 摺りの散らばり</a>
        <a href="/nendai/">③ 年代の帯</a>
        <a href="/eshi/" aria-current="page">④ 絵師くらべ</a>
      </nav>

      <p className="subject">
        絵師ごとに版色をまとめ、色域の形を比べる。ただし
        <strong>どの絵師も、面積の大きい版はまず紙の色である</strong> ——
        差が出るのは上位ではなく、残りの数パーセントのほうだ。
        並んでいるのは<strong>この標本({artists.artists.reduce((a, x) => a + x.works, 0)} 件)で
        {artists.minWorks} 件以上ある {artists.artists.length} 名</strong>で、
        写楽・国芳・芳年は届かなかった(それぞれ 5・7・9 件)。
      </p>

      <section className="panel">
        <div className="row">
          <label>並べ替え</label>
          {(
            [
              ["works", "作品数"],
              ["blue", "青の面積比"],
              ["chroma", "彩度の中央値"],
              ["year", "年代"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
              {label}
            </button>
          ))}
        </div>
        <p className="note-inline">
          絵師名は Met の署名そのまま。<strong>末尾の漢字だけを落として束ねてある</strong>
          (「Katsushika Hokusai 葛飾北斎」と「Katsushika Hokusai」は同じ人)。
          <strong>共同署名(彫師との連名など)は束ねていない</strong> ——
          どちらが主たる絵師かを機械的に決める規則が作れないため。
        </p>
      </section>

      <div className="eshiList">
        {list.map((a) => (
          <section key={a.name} className="panel eshi">
            <button className="eshiHead" onClick={() => setOpen(open === a.name ? null : a.name)}>
              <span className="eshiName">{a.name}</span>
              <span className="eshiNums">
                {a.works} 件 ・ {a.from}–{a.to} ・ 青 {(a.blue * 100).toFixed(1)} % ・ 彩度中央 {a.medianChroma.toFixed(3)}
              </span>
              <span className="eshiBar">
                {a.plates.map((p) => (
                  <span key={p.hex} style={{ flexGrow: Math.max(p.share, 0.001), background: p.hex }} />
                ))}
              </span>
            </button>

            {open === a.name ? (
              <div className="scrollx">
                <table className="suri">
                  <thead>
                    <tr>
                      <th>版色</th>
                      <th className="num">面積比</th>
                      <th className="num">L / C / h</th>
                      <th className="num">目盛りの中の色名</th>
                      <th>近い順に(ΔE2000)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.plates.map((p) => (
                      <tr key={p.hex}>
                        <td>
                          <span className="sw" style={{ background: p.hex }} />
                          <span className="mono">{p.hex}</span>
                        </td>
                        <td className="num">{(p.share * 100).toFixed(0)} %</td>
                        <td className="num sub">
                          {p.L.toFixed(2)} / {p.C.toFixed(3)} / {p.h.toFixed(0)}°
                        </td>
                        <td className="num strong">{p.nameCount}</td>
                        <td>
                          {p.names.map((n, i) => (
                            <span key={n.name} className="cand">
                              {i > 0 ? " ・ " : ""}
                              {n.name}
                              <span className="sub"> {n.de}</span>
                              {n.spread !== null ? <span className="spread"> 出典差 {n.spread}</span> : null}
                            </span>
                          ))}
                          {p.nameCount > p.names.length ? (
                            <span className="sub"> … ほか {p.nameCount - p.names.length} 個</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <p className="caveat">
        <strong>「これは藍鼠」とは言えない。</strong>
        物差しの目盛り(ΔE2000 = {artists.ruler})の中に入る色名は、
        <strong>中央値で {artists.nameCount.median} 個</strong>(最小 {artists.nameCount.min} / 最大{" "}
        {artists.nameCount.max})ある。一位と二位を区別する根拠は無い。
        目盛りの幅は<strong>伝統色の側の実測</strong>で、同じ色名の値が二つの出典間でこれだけ食い違っている
        (藍色 14.9 / 藍鼠 20.7 / 紫 24.1)。どちらの出典も HEX の典拠を示しておらず、
        日本語版は冒頭に「近似色であり一例」と書いている。
      </p>

      <p className="caveat">
        <strong>物差しのほうが、摺りの散らばりより粗い。</strong>
        ⑤ で測った同じ版木からの散らばりは ΔE2000 の中央値 4.4〜6.1 だった。
        色名の目盛り {artists.ruler} はそれより広い ——
        <strong>色名で語ろうとすると、摺りの違いより先に物差しの目盛りが効く。</strong>
      </p>

      <p className="caveat">
        伝統色のデータは <a href="https://iro-koyomi.vercel.app">iro-koyomi(色暦)</a> から。
        出典は英語版・日本語版 Wikipedia の伝統色一覧で、<strong>CC BY-SA 4.0</strong>。
        本アプリが再配布する <code>data/palette.json</code> も同じライセンスに従う(コードは MIT)。
      </p>
    </main>
  );
}
