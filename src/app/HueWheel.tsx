"use client";

// ② 色相環(F-07)。一枚の絵を、色相環上の数点の布置に抽象化する。
//
// 角度 = h、半径 = C(彩度)、点の大きさ = 面積比。**明度 L は点の縁の太さで表す。**
// 明度を色の濃さで表すと、SPEC §2.8 の問題がそのまま図に出る ——
// 露草色(褪せる)と藍色(残る)は色相角が 1.3° しか離れておらず、
// 分かれるのは明度だけなので、明度を潰すと二つが同じ点になる。

/**
 * 図が必要とする分だけを受け取る。**`Plate` をそのまま要求しない** ——
 * worker が返すのは OKLab を落とした軽い形で、図はそれで足りる。
 * 型を広く取ると、送っていないフィールドのために送る羽目になる。
 */
export type WheelPlate = {
  index: number;
  hex: string;
  share: number;
  oklch: { L: number; C: number; h: number };
};

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 132;

/** SPEC §2.8 —— 色相角では分離できない二色。図の上でも重なることを見せる */
const FADE_MARKS = [
  { h: 235.5, label: "露草(褪せる)" },
  { h: 236.8, label: "藍(残る)" },
];

function polar(h: number, r: number): [number, number] {
  const rad = ((h - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

export function HueWheel({ plates, selected, onSelect }: {
  plates: WheelPlate[];
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  // 半径の目盛りは**標本に合わせる**。固定の外周(C=0.2)にすると、彩度の低い絵で
  // 全部が中心に潰れる —— 神奈川沖浪裏の版色は C が 0.010〜0.050 しかなく、実際に潰れた
  // (実測 2026-08-31)。下限 0.06 は、無彩色に近い絵で点が散らばりすぎるのを防ぐだけの床。
  const maxC = Math.max(0.06, ...plates.map((p) => p.oklch.C)) * 1.12;
  const rOf = (c: number) => (c / maxC) * R;

  return (
    <figure className="wheel">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="抽出した版色の色相環。角度が色相、半径が彩度、点の大きさが面積比、縁の太さが明度">
        {/* 彩度の目盛り */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={CX} cy={CY} r={R * f} className="ring" />
        ))}
        {/* 色相の目盛り */}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((h) => {
          const [x1, y1] = polar(h, R);
          const [x2, y2] = polar(h, R + 6);
          const [tx, ty] = polar(h, R + 20);
          return (
            <g key={h}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="tick" />
              <text x={tx} y={ty} className="tickLabel">{h}°</text>
            </g>
          );
        })}

        {/* 褪せる青と残る青。**1.3° しか離れていない**ことを図でも示す */}
        {FADE_MARKS.map((m) => {
          const [x1, y1] = polar(m.h, 0);
          const [x2, y2] = polar(m.h, R);
          return <line key={m.label} x1={x1} y1={y1} x2={x2} y2={y2} className="fadeMark" />;
        })}
        <text x={polar(236, R * 0.62)[0]} y={polar(236, R * 0.62)[1]} className="fadeLabel">
          236°
        </text>

        {/* 版色 */}
        {plates.map((p) => {
          const [x, y] = polar(p.oklch.h, rOf(p.oklch.C));
          const size = 5 + Math.sqrt(p.share) * 26;
          // 明度は縁の太さ。暗いほど太い —— 色そのものは塗りで見えている
          const edge = 1 + (1 - Math.min(1, Math.max(0, p.oklch.L))) * 5;
          return (
            <circle
              key={p.index}
              cx={x}
              cy={y}
              r={size}
              fill={p.hex}
              strokeWidth={edge}
              className={`dot${selected === p.index ? " on" : ""}`}
              onClick={() => onSelect(selected === p.index ? null : p.index)}
            >
              <title>{`${p.hex} 面積 ${(p.share * 100).toFixed(1)}% / L ${p.oklch.L.toFixed(3)} C ${p.oklch.C.toFixed(3)} h ${p.oklch.h.toFixed(1)}°`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption>
        角度 = 色相 h ・ 半径 = 彩度 C(<strong>外周 {maxC.toFixed(3)}</strong>・標本に合わせて伸縮する)・
        点の大きさ = 面積比 ・ <strong>縁の太さ = 明度 L(暗いほど太い)</strong>。
        <br />
        赤い破線は 236° —— <strong>露草色(褪せる)235.5° と藍色(残る)236.8° はここで重なる</strong>。
        明度を色の濃さで表すと、この二つが図の上でも同じ点になってしまうので、明度は縁に逃がしてある。
      </figcaption>
    </figure>
  );
}
