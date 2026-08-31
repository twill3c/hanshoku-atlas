// 劣化の模型(G-03)。**JPEG コーデックそのものではない。**
//
// ここで通すのは、平面色の版画に対して撮影・圧縮・保存が起こす主要な効果の模型である:
//   ノイズ           —— センサ・スキャン・紙の粒
//   クロマ間引き 4:2:0 —— JPEG が色差を半分に落とす。平面色の境界で色が滲む主因
//   境界混色         —— リサイズ・アンチエイリアス。版と版の境界に中間色が生まれる
//   地色の黄変       —— 紙の経年。全体に紙色が乗る
//
// **「JPEG 品質 75 で壊れる」とは言えない**(TEST_SPEC)。実コーデックを通した測定は L2。
// 一文字ぼかしのような連続階調は、この模型では境界混色が代理になっている。

import { createRng } from "./rng";
import type { RasterImage } from "./image";

function clone(img: RasterImage): RasterImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

/** ガウスノイズ。Box–Muller を固定シードで回す。 */
export function addNoise(img: RasterImage, sigma: number, seed: number): RasterImage {
  const out = clone(img);
  const rng = createRng(seed);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      out.data[i + c] = out.data[i + c] + g * sigma;
    }
  }
  return out;
}

/** 4:2:0 のクロマ間引き。YCbCr(BT.601)に変換 → Cb/Cr を 2×2 平均 → 戻す。 */
export function chromaSubsample420(img: RasterImage): RasterImage {
  const { width: w, height: h } = img;
  const Y = new Float64Array(w * h);
  const Cb = new Float64Array(w * h);
  const Cr = new Float64Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      let sb = 0;
      let sr = 0;
      let n = 0;
      for (let dy = 0; dy < 2 && y + dy < h; dy++) {
        for (let dx = 0; dx < 2 && x + dx < w; dx++) {
          const i = (y + dy) * w + (x + dx);
          sb += Cb[i];
          sr += Cr[i];
          n++;
        }
      }
      const mb = sb / n;
      const mr = sr / n;
      for (let dy = 0; dy < 2 && y + dy < h; dy++) {
        for (let dx = 0; dx < 2 && x + dx < w; dx++) {
          const i = (y + dy) * w + (x + dx);
          Cb[i] = mb;
          Cr[i] = mr;
        }
      }
    }
  }

  const out = clone(img);
  for (let i = 0; i < w * h; i++) {
    const y = Y[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;
    out.data[i * 4] = y + 1.402 * cr;
    out.data[i * 4 + 1] = y - 0.344136 * cb - 0.714136 * cr;
    out.data[i * 4 + 2] = y + 1.772 * cb;
  }
  return out;
}

/** 箱平滑。版と版の境界に中間色を作る —— クラスタ仮説が最初に壊れる場所。 */
export function blurBoundaries(img: RasterImage, radius: number): RasterImage {
  const { width: w, height: h } = img;
  const out = clone(img);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          acc[0] += img.data[i];
          acc[1] += img.data[i + 1];
          acc[2] += img.data[i + 2];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = acc[0] / n;
      out.data[o + 1] = acc[1] / n;
      out.data[o + 2] = acc[2] / n;
    }
  }
  return out;
}

/** 地色の黄変。紙色を全体に α で乗せる。**全画素が同じ向きに動く**ので色差は系統的に出る。 */
export function blendPaper(img: RasterImage, paper: [number, number, number], alpha: number): RasterImage {
  const out = clone(img);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out.data[i + c] = img.data[i + c] * (1 - alpha) + paper[c] * alpha;
    }
  }
  return out;
}
