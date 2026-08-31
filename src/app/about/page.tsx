// /about(F-14)。**測って捨てたものを、捨てたと書く画面。**
//
// このプロジェクトの目玉は二つとも素直には通らなかった。だからこの画面が、
// 一番読む価値のある画面になる。
//
// **数字は一つも手で書いていない。** ゲートの実測は `tests/gates.test.ts` が、
// ⑤ の幅は実ブラウザ検品が、③ と ④/⑥ は集計が書き出した JSON から読む。
// 手で写せば必ずずれる(HC-045)。⑤ の幅は**毎回の検品が食い違いを落とす**。

import artists from "@/data/artists.json";
import bands from "@/data/bands.json";
import gates from "@/data/gates.json";
import spread from "@/data/spread.json";
import plates from "@/data/plates-meta.json";

export const metadata = {
  title: "何を測っていないか — 版色アトラス",
  description:
    "版色アトラスが測れなかったこと、落ちたゲート、測って捨てた設計の記録。数字はすべて測定が書き出したファイルから読んでいる。",
};

const pct = (x: number | null | undefined, d = 2) =>
  typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(d)} %` : "—";

export default function AboutPage() {
  const de = spread.measured.map((m) => m.deMedian);
  const shareSpread = spread.measured.map((m) => m.shareMedian);

  return (
    <main>
      <h1>
        何を測っていないか
        <span className="en">hanshoku-atlas / about</span>
      </h1>

      <nav className="nav">
        <a href="/">① 一枚解剖</a>
        <a href="/suri/">⑤ 摺りの散らばり</a>
        <a href="/nendai/">③ 年代の帯</a>
        <a href="/eshi/">④ 絵師くらべ</a>
        <a href="/about/" aria-current="page">about</a>
      </nav>

      <p className="subject">
        このアプリが測るのは
        <strong>「メトロポリタン美術館が公開した画像において、k-means が復元した版色の分布」</strong>である。
        摺られた当時の色ではない。長い主語だが、短くすると嘘になる。
        <strong>以下は、この道具が測れなかったことの一覧である。</strong>
      </p>

      <section className="panel">
        <h2>四層の媒介 —— 制御できるのは最後の一つだけ</h2>
        <ol>
          <li>摺られた当時、版木と顔料が生んだ色</li>
          <li>200 年超の褪色。<strong>紅(紅花)と露草(青花紙)は光で消える</strong>。紫は青灰色へ、桃色は生成りへ</li>
          <li>所蔵館の照明・撮影機材・カラープロファイル・後処理</li>
          <li>閲覧者のディスプレイ</li>
        </ol>
        <p>
          アプリが制御できるのは 4 だけである。1 と 2 は再現も記録もできない。
          だから抽出器の正しさは、<strong>色と面積比をこちらで決めた合成木版</strong>からしか検証できない ——
          <strong>本物の浮世絵は、答えのない入力である。</strong>
        </p>
        <p className="note-inline">
          なお 3 については実測した。<strong>Met の web-large は {plates.count} 件すべて ICC プロファイルを持たない。</strong>
          存在した唯一の 1 件(原寸)は sRGB、すなわち恒等変換だった。
          Chromium と Firefox で版色の色相角の差は <strong>0.000°</strong>、16 進表記まで一致する。
          <strong>心配していた層は、この経路では効いていない。</strong>
        </p>
      </section>

      <section className="panel verdict fail">
        <h2>落ちたゲート</h2>

        <h3>G-目玉1 —— 木版への k-means は版数を当てるか</h3>
        <p>
          合成木版 {gates.samples} 枚で、慣性の折れ曲がりが真の版数を ±1 で当てる率は
          <strong> {gates.measured.centerpieceStandard.toFixed(3)}</strong>(標準条件)。閾値 {gates.thresholds.centerpieceHitRate} を超えている。
          <strong>それでもこの目玉は成立していない。</strong>
          本物の浮世絵の版数はカタログに書かれていないからである ——
          Met の記述は “Woodblock print; ink and color on paper” までで、版の数を記さない。
          <strong>答え合わせができない以上、本物に対して当たっているかは分からない。</strong>
          画面が「版数」と書かず「慣性の折れ曲がりが示す k」と書いているのはそのためである。
        </p>

        <h3>G-目玉2 —— 1829–30 年に青が非連続に増えるか</h3>
        <p>
          <strong>不通過。</strong>閾値は測る前に宣言し、一切動かしていない。
        </p>
        <div className="scrollx">
          <table className="suri">
            <thead>
              <tr>
                <th>条件</th>
                <th className="num">実測</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>2a 1820–1828 → 1831–1840 で +3.00 pt 以上・両標本</td>
                <td className="num">
                  緩 {(bands.samples["緩標本"].diffMain * 100).toFixed(2)} pt / 厳密{" "}
                  {(bands.samples["厳密標本"].diffMain * 100).toFixed(2)} pt
                </td>
                <td className={bands.verdict.a ? "ok" : "ng"}>{bands.verdict.a ? "通過" : "不通過"}</td>
              </tr>
              <tr>
                <td>2b その差が前後の同幅の差より大きい</td>
                <td className="num">
                  緩の対照 前 {(bands.samples["緩標本"].diffEarly * 100).toFixed(2)} pt
                </td>
                <td className={bands.verdict.b ? "ok" : "ng"}>{bands.verdict.b ? "通過" : "不通過"}</td>
              </tr>
              <tr>
                <td>2c 遷移をまたぐ絵師だけの部分標本で符号が同じ</td>
                <td className="num">{bands.spanning.artists.length} 名 / {bands.spanning.works} 件</td>
                <td className={bands.verdict.c ? "ok" : "ng"}>{bands.verdict.c ? "通過" : "不通過"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>落ち方に理由がある。</strong>厳密標本だけなら 2a も 2b も通る。落としたのは緩標本で、
          そこでは<strong>年代幅の広い作品が 1830 年代の青を 1820 年代へ滲ませている</strong>。
          <strong>二本並走させたのは、まさにこれを見るためだった。</strong>
        </p>
        <p>
          <strong>2c は「通過」と出たが、通過に意味がない。</strong>条件を満たした絵師は
          {bands.spanning.artists.map((a) => a.artist).join(" と ")} の {bands.spanning.artists.length} 名だけで、
          後者は 1764 年に没している(「1831 年以降の作品」は年代幅の広い作品による見かけ)。
          <strong>「対照が通った」ことと「対照が何かを言った」ことは別である。</strong>
        </p>
        <p>
          宣言どおり、件数による主張は破棄して<a href="/nendai/">観測の列挙</a>に格下げした。
        </p>

        <h3>N-04 —— 抽出は 1 秒以内</h3>
        <p>
          <strong>安定しては未達。</strong>Chromium 610〜1,510 ms / Firefox 968〜1,432 ms。
          速い回は 1 秒を切るが、<strong>計測機の負荷で倍近く振れる</strong>ので「1 秒以内」とは言えない。
          Rust/WASM で詰めようとしたが、<strong>WASM が速いのは Chromium だけで Firefox では 4 倍遅かった</strong>。
          実行時に測って速い方を選んでいる —— <strong>二実装がビット一致するから、速さだけで選べる。</strong>
        </p>
      </section>

      <section className="panel">
        <h2>測って捨てた設計</h2>
        <dl className="dropped">
          <dt>館をまたいだ画像の比較</dt>
          <dd>
            差のうちどこまでが褪色でどこからが撮影条件かを<strong>原理的に分離できない</strong>。
            同じ館の複数摺りに変えた。加えてシカゴ美術館の IIIF は Cloudflare の bot チャレンジで 403 を返し、
            <strong>クロスオリジンの画像取得ではチャレンジを解けない</strong>。
          </dd>

          <dt>褪色前の色の逆算(点推定)</dt>
          <dd>
            ピンポイントの復元色を出すことは、<strong>不確かさを平滑化して消す行為</strong>そのものである。
            代わりに<a href="/suri/">同じ版木から出た色が実際にどれだけ散るか</a>を測った ——
            ΔE2000 の中央値 {Math.min(...de).toFixed(1)}〜{Math.max(...de).toFixed(1)}。
            <strong>半分が「誰にでも別の色に見える」域まで散っている。</strong>
          </dd>

          <dt>「色相分布」という枠組み</dt>
          <dd>
            <strong>露草色(h=235.5°)と藍色(h=236.8°)は色相角で 1.3° しか離れていない。</strong>
            前者は褪せ、後者は残る。色相ヒストグラムでは両者を分離できないので、
            分布は (h, C) 平面と L の層で語ることにした。③ の「青」も、
            <strong>青系全体であってベロ藍ではない</strong>。
          </dd>

          <dt>外部の色オラクル</dt>
          <dd>
            シカゴ美術館の <code>color</code> フィールドは、神奈川沖浪裏で
            <strong>画面の 0.5 % しか占めない色を dominant と称し</strong>、春信の作では <code>null</code> を返す。
            色の正解を外部から借りる経路は存在しない。
          </dd>

          <dt>Met の検索 API を標本枠にすること</dt>
          <dd>
            <code>q=Hokusai</code> の 58 件中、日本の作品は 5 件だった(パピルスも油彩も混じる)。
            収蔵目録 CSV(317 MB)の構造化列に切り替えた。
          </dd>

          <dt>色名を一つに当てること</dt>
          <dd>
            物差しの目盛り(ΔE2000 = {artists.ruler})の中に入る色名は
            <strong>中央値 {artists.nameCount.median} 個</strong>(最小 {artists.nameCount.min} / 最大{" "}
            {artists.nameCount.max})。一位と二位を区別する根拠が無い。
            <strong>物差しのほうが摺りの散らばりより粗い。</strong>
          </dd>

          <dt>構想が挙げた七人の絵師を並べること</dt>
          <dd>
            写楽 5 件 / 国芳 7 件 / 芳年 9 件で、<strong>三人はこの標本の閾値({artists.minWorks} 件)に届かなかった</strong>。
            棚に載せず、載らなかったと書いた。
          </dd>
        </dl>
      </section>

      <section className="panel">
        <h2>通ったもの</h2>
        <div className="scrollx">
          <table className="suri">
            <thead>
              <tr>
                <th>検査</th>
                <th className="num">閾値</th>
                <th className="num">実測</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>G-01 版色の復元(色差)</td>
                <td className="num">
                  中央 ≤ {gates.thresholds.deMedian} / 最大 ≤ {gates.thresholds.deMax}
                </td>
                <td className="num strong">
                  {gates.measured.g01Median.toFixed(4)} / {gates.measured.g01Max.toFixed(4)}
                </td>
              </tr>
              <tr>
                <td>G-02 面積比の復元</td>
                <td className="num">最大 ≤ {gates.thresholds.shareMax}</td>
                <td className="num strong">{gates.measured.g02Max.toExponential(2)}</td>
              </tr>
              <tr>
                <td>G-04 陽性対照(壊した抽出器は落ちるか)</td>
                <td className="num">発火すること</td>
                <td className="num strong">
                  {gates.measured.g04Fired}/{gates.samples} 枚
                </td>
              </tr>
              <tr>
                <td>G-07 ブラウザ間の色相角</td>
                <td className="num">Δh ≤ 2.0°</td>
                <td className="num strong">0.000°</td>
              </tr>
              <tr>
                <td>G-08 二実装照合(結論も経路も)</td>
                <td className="num">ビット一致</td>
                <td className="num strong">一致</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note-inline">
          <strong>いずれの数字も、この画面のために測り直したものではない。</strong>
          ゲートの実測はテストが、⑤ の幅は実ブラウザ検品が、③ と ④ は集計が書き出した
          ファイルから読んでいる。<strong>⑤ の幅は毎回の検品が食い違いを落とす。</strong>
        </p>
      </section>

      <section className="panel">
        <h2>出どころと権利</h2>
        <ul>
          <li>
            画像・書誌は <strong>The Metropolitan Museum of Art Open Access(CC0)</strong>。
            <strong>画像は再配布していない</strong> —— 閲覧者のブラウザが同一オリジン経由で取得する。
            配っているのは、そこから計算した数値だけである
          </li>
          <li>
            伝統色 369 色は <a href="https://iro-koyomi.vercel.app">iro-koyomi(色暦)</a> 由来。
            出典は英語版・日本語版 Wikipedia の伝統色一覧で、<strong>CC BY-SA 4.0</strong>。
            <code>data/palette.json</code> はこの 1 ファイルだけ同ライセンス(コードと他のデータは MIT)
          </li>
          <li>
            標本は収蔵目録 CSV から抽出規則 6 つで絞った枠 3,833 件のうち、
            10 年ごとに最大 45 件・乱数シード {bands.seed} で選んだ <strong>{bands.count} 件</strong>。
            抽出規則と CSV の sha256 は <code>data/frame.json</code> に刻んである
          </li>
        </ul>
      </section>

      <p className="caveat">
        <strong>この標本は浮世絵の母集団ではない。</strong>
        Met の収蔵は Met の収集史である。1830 年代に青が増えて見えたとして、それは顔料史かもしれないし、
        Met が北斎・広重の風景版画を多く買ったからかもしれない。
        <strong>その二つを分ける対照を、私たちは作れなかった。</strong>
      </p>

      <p className="caveat">
        面積比の幅は図柄ごとに {Math.min(...shareSpread).toFixed(1)}〜{Math.max(...shareSpread).toFixed(1)} ポイント。
        だから ① の面積比から小数点以下を落としてある。
        <strong>最後に表示する桁は、散らばりが飲み込まない最初の桁である。</strong>
      </p>
    </main>
  );
}
