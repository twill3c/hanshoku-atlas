// Met の画像を**同一オリジンに寄せる**(SPEC §2.7)。
//
// 実測 2026-08-31: `images.metmuseum.org` は `curl -I`(HEAD)には
// `Access-Control-Allow-Origin: *` を返すが、**GET には返さない**(6 回とも)。
// 前段の WAF が HEAD にだけ別応答をしている。したがって crossOrigin="anonymous" の
// 直読みは CORS で落ち、canvas が汚染されて getImageData を呼べない。
//
// `vercel.json` の rewrite で `/met/*` をエッジで書き換え、ブラウザからは同一オリジンにする。
// **関数は起動しない**ので N-01(サーバ関数ゼロ)は保たれる。
// **画像は再配布しない**(N-03)—— 書き換えは中継であって保存ではない。

const MET_IMAGES = /^https?:\/\/images\.metmuseum\.org\/(.+)$/;

/** images.metmuseum.org の URL を /met/… に書き換える。それ以外はそのまま返す。 */
export function toSameOrigin(url: string): string {
  const m = url.match(MET_IMAGES);
  return m ? `/met/${m[1]}` : url;
}
