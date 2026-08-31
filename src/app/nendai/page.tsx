"use client";

// ③ 年代の帯(F-10)と、目玉の判定(G-目玉2)。
//
// **作品を年代に単一配属しない。** Met の年代は幅を持つ(神奈川沖浪裏は "ca. 1830–32" に対し
// begin 1820 / end 1842 の 22 年幅 —— SPEC §2.4)。begin–end に一様配分した重みで年ごとの
// 平均を出し、**厳密標本(幅 ≤ 10 年)と緩標本(全件)を並走させる。**
//
// 閾値は SPEC §5.1 に**一枚も測る前に**書いた。この画面は当てはめた結果を出すだけで、
// 通っても落ちても同じ形で出す。

import { useState } from "react";
import bands from "@/data/bands.json";

const W = 900;
const H = 260;
const PAD = { l: 46, r: 14, t: 14, b: 28 };
const Y0 = 1760;
const Y1 = 1900;

type Point = { year: number; mean: number; weight: number };

function path(series: Point[], maxY: number): string {
  const xs = (y: number) => PAD.l + ((y - Y0) / (Y1 - Y0)) * (W - PAD.l - PAD.r);
  const ys = (v: number) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);
  return series
    .filter((p) => p.year >= Y0 && p.year <= Y1)
    .map((p, i) => `${i === 0 ? "M" : "L"}${xs(p.year).toFixed(1)},${ys(p.mean).toFixed(1)}`)
    .join(" ");
}

export default function NendaiPage() {
  const [decade, setDecade] = useState<number | null>(null);
  const loose = bands.samples["緩標本"];
  const strict = bands.samples["厳密標本"];
  const maxY = Math.max(
    0.2,
    ...[...loose.series, ...strict.series].filter((p) => p.year >= Y0 && p.year <= Y1).map((p) => p.mean),
  );
  const xs = (y: number) => PAD.l + ((y - Y0) / (Y1 - Y0)) * (W - PAD.l - PAD.r);
  const decades = Object.entries(bands.decades)
    .map(([k, v]) => ({ decade: Number(k), ...(v as { n: number; hue: number[]; blue: number }) }))
    .filter((d) => d.decade >= Y0 && d.decade < Y1)
    .sort((a, b) => a.decade - b.decade);
  const shown = decade === null ? null : decades.find((d) => d.decade === decade);

  // 標本が無い窓は JSON では null になる(NaN は JSON に無い)。
  // **「—」と書く。0 と書けば「測ったら 0 だった」に見えてしまう。**
  const pct = (x: number | null | undefined) =>
    typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(2)} pt` : "—";

  return (
    <main>
      <h1>
        版色アトラス
        <span className="en">hanshoku-atlas ③ 年代の帯</span>
      </h1>

      <nav className="nav">
        <a href="/">① 一枚解剖</a>
        <a href="/suri/">⑤ 摺りの散らばり</a>
        <a href="/nendai/" aria-current="page">③ 年代の帯</a>
      </nav>

      <p className="subject">
        1760 年代から 1900 年まで、<strong>青の面積比が年とともにどう動くか</strong>。
        通説では 1829–30 年前後にベロ藍(プルシアンブルー)が普及し、
        <strong>一つの人工顔料が風景版画というジャンルを生んだ</strong>とされる。
        それが数字に出るかを、<strong>閾値を先に宣言してから</strong>測った。
        <strong>結果は不通過だったので、件数による主張は破棄し、観測の列挙に格下げしてある。</strong>
      </p>

      <section className={`panel verdict ${bands.verdict.pass ? "pass" : "fail"}`}>
        <h2>目玉の判定 —— G-目玉2 は{bands.verdict.pass ? "通過した" : "通らなかった"}</h2>
        <div className="scrollx">
          <table className="suri">
            <thead>
              <tr>
                <th>条件</th>
                <th>閾値(測定前に宣言)</th>
                <th>実測</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2a 青が増える</td>
                <td>1820–1828 → 1831–1840 で +3.00 pt 以上・両標本</td>
                <td className="num">
                  緩 {pct(loose.diffMain)} / 厳密 {pct(strict.diffMain)}
                </td>
                <td className={bands.verdict.a ? "ok" : "ng"}>{bands.verdict.a ? "通過" : "不通過"}</td>
              </tr>
              <tr>
                <td>2b 非連続である</td>
                <td>2a の差が前後の同幅の差のどちらよりも大きい</td>
                <td className="num">
                  緩 前 {pct(loose.diffEarly)} / 後 {pct(loose.diffLate)}
                  <br />
                  厳密 前 {pct(strict.diffEarly)} / 後 {pct(strict.diffLate)}
                </td>
                <td className={bands.verdict.b ? "ok" : "ng"}>{bands.verdict.b ? "通過" : "不通過"}</td>
              </tr>
              <tr>
                <td>2c 標本の偏りで説明できない</td>
                <td>遷移をまたぐ絵師だけの部分標本で符号が同じ</td>
                <td className="num">
                  {bands.spanning.artists.length} 名 / {bands.spanning.works} 件 / 差 {pct(bands.spanning.diff)}
                </td>
                <td className={bands.verdict.c ? "ok" : "ng"}>{bands.verdict.c ? "通過" : "不通過"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>格下げの中身 —— 主張のかわりに置くもの</h2>
        <p>
          <strong>落ちたのは 2a と 2b で、落ち方には理由がある。</strong>
          厳密標本だけを見れば 2a(+4.36 pt)も 2b(対照は +0.46 と −6.69)も通る。
          落としたのは<strong>緩標本</strong>で、そこでは 1820–1828 の青が 3.41 pt もある ——
          10 年ごとに数えると 1820 年代は 1.68 % しかない。差は
          <strong>年代幅の広い作品が 1830 年代の青を 1820 年代へ滲ませている</strong>ことから来る。
          <strong>二本並走させたのは、まさにこれを見るためだった。</strong>
        </p>
        <p>
          <strong>2c は「通過」と出たが、通過に意味がない。</strong>
          条件を満たした絵師は 2 名 —— 一方は <span className="mono">Unidentified artist</span>、
          他方は 1764 年に没した奥村政信で、「1831 年以降の作品」は年代幅の広い作品による見かけである。
          <strong>対照が退化しているので、通過を根拠にしない。</strong>
        </p>
        <p>
          <strong>以下は主張ではなく、この標本で観測されたことの列挙である。</strong>
        </p>
        <div className="scrollx">
          <table className="suri">
            <thead>
              <tr>
                <th>10 年</th>
                <th className="num">標本</th>
                <th className="num">青の面積比の平均</th>
                <th>帯</th>
              </tr>
            </thead>
            <tbody>
              {decades.map((d) => (
                <tr key={d.decade}>
                  <td className="mono">{d.decade}s</td>
                  <td className="num">{d.n}</td>
                  <td className="num strong">{(d.blue * 100).toFixed(2)} %</td>
                  <td>
                    <span className="minibar" style={{ width: `${Math.min(100, d.blue * 100 * 12)}px` }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note-inline">
          1700 年代から 1790 年代までの<strong>九つの 10 年で、青の平均は 0.00 %</strong>(1730 年代の 0.11 % を除く)。
          1820 年代に 1.68 %、<strong>1830 年代に 7.08 %</strong>。1870 年代以降はふたたび 1 % を下回る。
          <strong>これは観測であって、因果ではない。</strong>Met がその時代の風景版画を多く持っているだけかもしれず、
          2c はそれを排除できなかった。
        </p>
      </section>

      <section className="panel">
        <h2>青の面積比(年ごと・重み付き)</h2>
        <div className="scrollx">
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="青の面積比の年推移。厳密標本と緩標本の 2 本">
            <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className="axis" />
            <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} className="axis" />
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={H - PAD.b - f * (H - PAD.t - PAD.b)}
                  y2={H - PAD.b - f * (H - PAD.t - PAD.b)}
                  className="grid"
                />
                <text x={PAD.l - 6} y={H - PAD.b - f * (H - PAD.t - PAD.b)} className="ylab">
                  {(maxY * f * 100).toFixed(0)}%
                </text>
              </g>
            ))}
            {[1780, 1800, 1820, 1840, 1860, 1880].map((y) => (
              <text key={y} x={xs(y)} y={H - 8} className="xlab">
                {y}
              </text>
            ))}
            {/* 1829–30 —— 通説がベロ藍の普及を置く年 */}
            <rect x={xs(1829)} y={PAD.t} width={Math.max(2, xs(1831) - xs(1829))} height={H - PAD.t - PAD.b} className="mark" />
            <text x={xs(1830)} y={PAD.t + 10} className="marklab">1829–30</text>

            <path d={path(loose.series as Point[], maxY)} className="line loose" />
            <path d={path(strict.series as Point[], maxY)} className="line strict" />
          </svg>
        </div>
        <div className="legend">
          <span className="k loose" /> 緩標本(全 {loose.n} 件)
          <span className="k strict" /> 厳密標本(年代幅 ≤ 10 年・{strict.n} 件)
        </div>
        <p className="note-inline">
          「青」は色相角 h ∈ [200°, 270°) かつ彩度 C ≥ 0.02。
          <strong>これは青系全体であって、ベロ藍ではない</strong> ——
          露草色(h=235.5°)と藍色(h=236.8°)は 1.3° しか離れておらず、この指標は両者を分離しない。
        </p>
      </section>

      <section className="panel">
        <h2>10 年ごとの色相の帯</h2>
        <div className="bandwrap">
          {decades.map((d) => (
            <button
              key={d.decade}
              className={`band${decade === d.decade ? " on" : ""}`}
              onClick={() => setDecade(decade === d.decade ? null : d.decade)}
              title={`${d.decade}s / ${d.n} 件 / 青 ${(d.blue * 100).toFixed(1)}%`}
            >
              <span className="bandbar">
                {d.hue.map((v, i) => (
                  <span
                    key={i}
                    style={{
                      flexGrow: Math.max(v, 0.0001),
                      background: `oklch(0.62 0.13 ${i * 10 + 5})`,
                    }}
                  />
                ))}
              </span>
              <span className="bandlab">
                {d.decade}s<span className="sub"> {d.n}</span>
              </span>
            </button>
          ))}
        </div>
        {shown ? (
          <p className="note-inline">
            <strong>{shown.decade}s</strong> —— 標本 {shown.n} 件、青の面積比の平均{" "}
            <strong>{(shown.blue * 100).toFixed(1)} %</strong>。帯は彩度 0.02 以上の版色を色相 10° 刻みで
            面積比の重みで並べたもの(無彩色は入っていない)。
          </p>
        ) : (
          <p className="note-inline">帯を押すとその 10 年の内訳が出る。</p>
        )}
      </section>

      <p className="caveat">
        <strong>この標本は浮世絵の母集団ではない。</strong>
        Met の収蔵は Met の収集史である。1830 年代に青が増えて見えたとして、それは顔料史かもしれないし、
        <strong>Met が北斎・広重の風景版画を多く買ったから</strong>かもしれない。2c はその対照だが、
        遷移をまたぐ絵師の作品数は多くない。
        枠は <strong>{bands.count} 件</strong>(収蔵目録 CSV から抽出規則 6 つで絞り、10 年ごとに最大 45 件、
        乱数シード {bands.seed})。
      </p>

      <p className="caveat">
        <strong>年代そのものが幅を持つ。</strong>
        Met の <code>objectBeginDate</code>–<code>objectEndDate</code> は
        神奈川沖浪裏で 22 年ある。だから作品を 1 年に置かず、幅に一様配分した。
        <strong>厳密標本と緩標本の 2 本を出しているのは、この配分の影響を読み手が見られるようにするため</strong>である。
      </p>
    </main>
  );
}
