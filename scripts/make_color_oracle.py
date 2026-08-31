# -*- coding: utf-8 -*-
"""色変換オラクルを生成する(T-002 / T-003 / T-004)。

**これは循環しないオラクルである。** 期待値は本プロジェクトの実装ではなく、
外部の独立実装 colour-science(0.4.x)が計算する。TS 実装は Björn Ottosson の
OKLab 行列と CIEDE2000 の公式から独立に書かれており、コードを共有しない。

生成物: tests/fixtures/color_oracle.json(コミットする)

実行:
    python scripts/make_color_oracle.py

再生成が必要なのは、対象の色空間や標本の取り方を変えたときだけである。
出力にはライブラリ版・生成日・乱数シードが入る。
"""
from __future__ import annotations

import json
import platform
from datetime import date
from pathlib import Path

import colour
import numpy as np

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "color_oracle.json"
SEED = 20260831
D65 = colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"]


def srgb_to_lab(rgb8: np.ndarray) -> np.ndarray:
    """sRGB(0-255)→ CIELAB(D65)。"""
    xyz = colour.sRGB_to_XYZ(rgb8 / 255.0)
    return colour.XYZ_to_Lab(xyz, illuminant=D65)


def srgb_to_oklab(rgb8: np.ndarray) -> np.ndarray:
    """sRGB(0-255)→ OKLab。"""
    xyz = colour.sRGB_to_XYZ(rgb8 / 255.0)
    return colour.XYZ_to_Oklab(xyz)


def lch_from_lab(lab: np.ndarray) -> np.ndarray:
    """Lab → LCh(h は度・[0,360))。"""
    lch = colour.Lab_to_LCHab(lab)
    return lch


def sample_rgb(rng: np.random.Generator) -> list[list[int]]:
    """sRGB 標本。**端点と灰色軸を必ず含める**(変換の特異点はそこにある)。"""
    fixed = [
        [0, 0, 0], [255, 255, 255], [128, 128, 128],
        [255, 0, 0], [0, 255, 0], [0, 0, 255],
        [255, 255, 0], [0, 255, 255], [255, 0, 255],
        # SPEC §2.7 の伝統色(浮世絵の顔料に対応する色)
        [0x21, 0xA0, 0xDB],  # 露草色
        [0x16, 0x5E, 0x83],  # 藍色
        [0xE8, 0x6B, 0x79],  # 紅梅色
        [0x8F, 0x2E, 0x14],  # 弁柄色
        [0xC3, 0x91, 0x43],  # 黄土色
        [0xA7, 0x57, 0xA8],  # 紫
        [0x5E, 0x7C, 0x85],  # 藍鼠
        [0x00, 0xA4, 0xAC],  # 浅葱色
    ]
    rand = rng.integers(0, 256, size=(120, 3)).tolist()
    return fixed + rand


def sample_lab_pairs(rng: np.random.Generator) -> list[tuple[list[float], list[float]]]:
    """CIEDE2000 の標本。**難所を狙って取る** —— この式は近無彩色・色相の回り込み・
    青領域(R_T 項)で挙動が変わるので、一様乱数だけでは通ってしまう。"""
    pairs: list[tuple[list[float], list[float]]] = []

    # (a) 同一色 —— ΔE = 0 でなければならない
    for _ in range(10):
        lab = [float(rng.uniform(0, 100)), float(rng.uniform(-90, 90)), float(rng.uniform(-90, 90))]
        pairs.append((lab, list(lab)))

    # (b) 全域の一様乱数
    for _ in range(60):
        a = [float(rng.uniform(0, 100)), float(rng.uniform(-100, 100)), float(rng.uniform(-100, 100))]
        b = [float(rng.uniform(0, 100)), float(rng.uniform(-100, 100)), float(rng.uniform(-100, 100))]
        pairs.append((a, b))

    # (c) 近無彩色(C < 2)—— 色相角が不安定になる領域
    for _ in range(40):
        a = [float(rng.uniform(20, 80)), float(rng.uniform(-2, 2)), float(rng.uniform(-2, 2))]
        b = [float(rng.uniform(20, 80)), float(rng.uniform(-2, 2)), float(rng.uniform(-2, 2))]
        pairs.append((a, b))

    # (d) 色相の回り込み(0°/360° をまたぐ)
    for _ in range(40):
        L = float(rng.uniform(30, 70))
        C1, C2 = float(rng.uniform(20, 60)), float(rng.uniform(20, 60))
        h1 = float(rng.uniform(350, 360))
        h2 = float(rng.uniform(0, 10))
        a = [L, C1 * np.cos(np.radians(h1)), C1 * np.sin(np.radians(h1))]
        b = [L, C2 * np.cos(np.radians(h2)), C2 * np.sin(np.radians(h2))]
        pairs.append(([float(x) for x in a], [float(x) for x in b]))

    # (e) 青領域(275°付近)—— R_T の回転項が最大に効く
    for _ in range(40):
        L1, L2 = float(rng.uniform(20, 60)), float(rng.uniform(20, 60))
        C1, C2 = float(rng.uniform(40, 90)), float(rng.uniform(40, 90))
        h1 = float(rng.uniform(265, 290))
        h2 = float(rng.uniform(265, 290))
        a = [L1, C1 * np.cos(np.radians(h1)), C1 * np.sin(np.radians(h1))]
        b = [L2, C2 * np.cos(np.radians(h2)), C2 * np.sin(np.radians(h2))]
        pairs.append(([float(x) for x in a], [float(x) for x in b]))

    return pairs


def main() -> None:
    rng = np.random.default_rng(SEED)

    rgbs = sample_rgb(rng)
    conversions = []
    for rgb in rgbs:
        arr = np.array(rgb, dtype=float)
        lab = srgb_to_lab(arr)
        oklab = srgb_to_oklab(arr)
        oklch = lch_from_lab(oklab)
        conversions.append(
            {
                "rgb": [int(v) for v in rgb],
                "lab": [float(v) for v in lab],
                "oklab": [float(v) for v in oklab],
                "oklch": [float(oklch[0]), float(oklch[1]), float(oklch[2])],
            }
        )

    pairs = sample_lab_pairs(rng)
    deltas = []
    for a, b in pairs:
        de = float(colour.difference.delta_E_CIE2000(np.array(a), np.array(b)))
        deltas.append({"lab1": a, "lab2": b, "de2000": de})

    payload = {
        "generated": date.today().isoformat(),
        "generator": "scripts/make_color_oracle.py",
        "oracle": {
            "library": "colour-science",
            "version": colour.__version__,
            "python": platform.python_version(),
            "note": "本プロジェクトの実装とコードを共有しない独立実装。循環していない(G-05)",
        },
        "seed": SEED,
        "illuminant": "D65 (CIE 1931 2°)",
        "conversions": conversions,
        "delta_e_2000": deltas,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{OUT} — 変換 {len(conversions)} 件 / ΔE2000 {len(deltas)} 件(colour-science {colour.__version__})")


if __name__ == "__main__":
    main()
