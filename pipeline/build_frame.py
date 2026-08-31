# -*- coding: utf-8 -*-
"""標本枠を作る(F-11)。`MetObjects.csv` の構造化列だけを使う。

**検索 API は使わない。**`q=Hokusai&hasImages=true` の 58 件中、culture が Japan* なのは
5 件だった(SPEC §2)—— パピルスも油彩も混じる。標本枠にならない。

出力: `data/frame.json`(枠)と `data/sample.json`(層別抽出した標本)。
**抽出規則と乱数シードをこのファイルに書き、出力にも刻む。**

実行:
    python pipeline/build_frame.py --csv .cache/MetObjects.csv
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"

# 抽出規則(この 6 つがすべて)
DEPARTMENT = "Asian Art"
CULTURE_PREFIX = "Japan"
MEDIUM_MUST_CONTAIN = "oodblock print"  # Woodblock / woodblock の両方に当たる
YEAR_MIN, YEAR_MAX = 1700, 1912
SEED = 20260831
PER_DECADE = 45  # 各 10 年から最大この数。少ない 10 年はある分だけ

COL = {
    "pd": 3,
    "id": 4,
    "dept": 6,
    "name": 8,
    "title": 9,
    "culture": 10,
    "artist": 18,
    "odate": 28,
    "begin": 29,
    "end": 30,
    "medium": 31,
}


def build_frame(csv_path: Path) -> list[dict]:
    csv.field_size_limit(10**9)
    rows: list[dict] = []
    with csv_path.open(encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if len(row) < 50:
                continue
            if row[COL["dept"]] != DEPARTMENT:
                continue
            if not row[COL["culture"]].startswith(CULTURE_PREFIX):
                continue
            if row[COL["pd"]].strip().lower() != "true":
                continue
            medium = row[COL["medium"]]
            if MEDIUM_MUST_CONTAIN not in medium:
                continue
            # 絵本・画帖は一枚摺りではないので除く
            if "book" in medium.lower() or "book" in row[COL["name"]].lower():
                continue
            try:
                begin = int(row[COL["begin"]])
                end = int(row[COL["end"]])
            except ValueError:
                continue
            if not (YEAR_MIN <= begin <= YEAR_MAX and YEAR_MIN <= end <= YEAR_MAX and end >= begin):
                continue
            rows.append(
                {
                    "objectId": int(row[COL["id"]]),
                    # **題名は切らない。** 同一性の鍵なので、切り詰めると
                    # 「切れる位置が違うだけの別題名」が生まれる(実測 2026-09-01 ——
                    # 神奈川沖浪裏の 4 摺りが 120 字で切られて 4 つの別題名になっていた)
                    "title": row[COL["title"]],
                    "artist": row[COL["artist"]][:60],
                    "objectDate": row[COL["odate"]][:40],
                    "begin": begin,
                    "end": end,
                    "span": end - begin,
                    "medium": medium[:80],
                }
            )
    rows.sort(key=lambda x: x["objectId"])
    return rows


def stratified_sample(frame: list[dict]) -> list[dict]:
    """10 年ごとに最大 PER_DECADE 件。**中点の 10 年で層を作る。**

    年代幅の広い作品は中点も当てにならないが、層は抽出のためだけに使い、
    分布の計算では begin–end に一様配分する(F-10)。層の取り方が分布を作らないようにしてある。
    """
    by_decade: dict[int, list[dict]] = defaultdict(list)
    for w in frame:
        by_decade[((w["begin"] + w["end"]) // 2) // 10 * 10].append(w)

    rng = random.Random(SEED)
    picked: list[dict] = []
    for dec in sorted(by_decade):
        bucket = sorted(by_decade[dec], key=lambda x: x["objectId"])
        picked.extend(bucket if len(bucket) <= PER_DECADE else rng.sample(bucket, PER_DECADE))
    picked.sort(key=lambda x: x["objectId"])
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(ROOT / ".cache" / "MetObjects.csv"))
    args = ap.parse_args()
    csv_path = Path(args.csv)

    digest = hashlib.sha256()
    with csv_path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)

    frame = build_frame(csv_path)
    sample = stratified_sample(frame)

    rule = {
        "source": "metmuseum/openaccess MetObjects.csv",
        "sourceBytes": csv_path.stat().st_size,
        "sourceSha256": digest.hexdigest(),
        "fetched": date.today().isoformat(),
        "rule": {
            "department": DEPARTMENT,
            "culturePrefix": CULTURE_PREFIX,
            "isPublicDomain": True,
            "mediumContains": MEDIUM_MUST_CONTAIN,
            "excludes": "medium/name に book を含むもの(絵本・画帖)",
            "yearRange": [YEAR_MIN, YEAR_MAX],
        },
        "sampling": {"perDecade": PER_DECADE, "seed": SEED, "stratum": "(begin+end)//2 の 10 年"},
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "frame.json").write_text(
        json.dumps({**rule, "count": len(frame), "works": frame}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    (OUT / "sample.json").write_text(
        json.dumps({**rule, "count": len(sample), "works": sample}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )

    dec = Counter(((w["begin"] + w["end"]) // 2) // 10 * 10 for w in sample)
    spans = Counter("≤10" if w["span"] <= 10 else ">10" for w in sample)
    print(f"枠 {len(frame)} 件 → 標本 {len(sample)} 件(seed {SEED} / 各 10 年 最大 {PER_DECADE})")
    print("  年代幅 " + " / ".join(f"{k} {v}" for k, v in sorted(spans.items())))
    print("  " + " ".join(f"{k}s:{v}" for k, v in sorted(dec.items())))


if __name__ == "__main__":
    main()
