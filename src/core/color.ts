// 色空間 —— sRGB / OKLab / OKLCh / CIELAB(D65) / ΔE2000。
//
// なぜ RGB ではないのか(SPEC §2.8):
//   露草色 h=235.5° と藍色 h=236.8° は色相角で 1.3° しか離れていない。前者は褪せ、後者は残る。
//   色相ヒストグラムは両者を分離できない。分布は (h, C) 平面と L の層で語る。
//
// OKLab は Björn Ottosson の定義(線形 sRGB → LMS → 立方根 → Lab)。
// CIELAB は ΔE2000 のためだけに使う —— ΔE2000 は CIELAB 上で定義されているので、
// OKLab 上のユークリッド距離で代用しない。

export type RGB = [number, number, number];
export type Lab = [number, number, number];
export type OKLab = [number, number, number];
export type OKLCh = { L: number; C: number; h: number };

// ---------------------------------------------------------------- sRGB 伝達関数

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

// ---------------------------------------------------------------- OKLab

export function srgbToOklab(r: number, g: number, b: number): OKLab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function oklabToSrgb(lab: OKLab): RGB {
  const [L, a, b] = lab;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function oklabToOklch(lab: OKLab): OKLCh {
  const C = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: lab[0], C, h };
}

// ---------------------------------------------------------------- CIELAB(D65)

// D65 / CIE 1931 2° の白色点。**色度座標 (0.3127, 0.3290) から導く** ——
// X = x/y、Z = (1-x-y)/y。丸めた 95.047 / 108.883 を使うと白 #FFFFFF で
// Lab の b が 0.014 ずれる(実測 2026-08-31)。導出値なら 1e-3 に収まる。
const D65_X = 0.3127;
const D65_Y = 0.329;
const XN = (D65_X / D65_Y) * 100;
const YN = 100.0;
const ZN = ((1 - D65_X - D65_Y) / D65_Y) * 100;

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;
}

export function srgbToLab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  // sRGB → XYZ(D65)。IEC 61966-2-1 の行列を 100 倍で使う
  const X = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) * 100;
  const Y = (0.2126 * lr + 0.7152 * lg + 0.0722 * lb) * 100;
  const Z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) * 100;

  const fx = labF(X / XN);
  const fy = labF(Y / YN);
  const fz = labF(Z / ZN);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---------------------------------------------------------------- ΔE2000

const DEG = Math.PI / 180;

/**
 * CIEDE2000 色差(CIE 142-2001)。k_L = k_C = k_H = 1。
 * 期待値は colour-science の独立実装と突き合わせる(T-004)。
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const hp = (b: number, a: number): number => {
    if (b === 0 && a === 0) return 0;
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  };
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * hbarp * DEG) +
    0.32 * Math.cos((3 * hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * hbarp - 63) * DEG);

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const RT = -RC * Math.sin(2 * dTheta * DEG);

  const Lm50 = Math.pow(Lbarp - 50, 2);
  const SL = 1 + (0.015 * Lm50) / Math.sqrt(20 + Lm50);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      RT * (dCp / SC) * (dHp / SH),
  );
}

// ---------------------------------------------------------------- 表示用

export function rgbToHex(rgb: RGB): string {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}
