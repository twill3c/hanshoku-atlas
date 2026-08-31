# -*- coding: utf-8 -*-
"""合成木版を**実際の JPEG コーデック**に通して戻す(G-03)。

これまでの劣化掃引はノイズ・クロマ間引き・境界混色・地色の**模型**だった。
模型は「JPEG が平面色に対して起こす主要な効果」を狙って作ったものだが、
**「品質 75 で壊れる」とは言えない**。ここで実物を通す。

このスクリプトは**符号化と復号だけ**を行う。合成も抽出も比較もしない
—— 解析は出荷している TS/WASM 実装が受け持つ(HC-069)。

入出力: `.cache/jpeg/manifest.json` を読み、`<id>.raw`(RGB)を品質ごとに
`<id>.q<品質>.raw` として書き戻す。

実行:
    python pipeline/jpeg_codec.py
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / ".cache" / "jpeg"


def main() -> None:
    manifest = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    qualities: list[int] = manifest["qualities"]
    sizes: list[int] = []

    for item in manifest["items"]:
        w, h = item["width"], item["height"]
        raw = (WORK / f"{item['id']}.raw").read_bytes()
        assert len(raw) == w * h * 3, f"{item['id']}: 生画素の長さが合わない"
        im = Image.frombytes("RGB", (w, h), raw)

        for q in qualities:
            buf = io.BytesIO()
            # **既定のままにする。** subsampling も optimize も触らない ——
            # 触れば「その設定の JPEG」を測ることになり、通説の「JPEG」から遠ざかる
            im.save(buf, format="JPEG", quality=q)
            sizes.append(buf.tell())
            back = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
            (WORK / f"{item['id']}.q{q}.raw").write_bytes(back.tobytes())

    (WORK / "done.json").write_text(
        json.dumps({"encoded": len(sizes), "bytesMedian": sorted(sizes)[len(sizes) // 2]}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"符号化 {len(sizes)} 枚 / 中央サイズ {sorted(sizes)[len(sizes) // 2]:,} B")


if __name__ == "__main__":
    main()
