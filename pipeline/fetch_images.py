# -*- coding: utf-8 -*-
"""標本の画像を取り、生画素に落とす(F-11 の後段)。

**再開できるように書いてある。** Met はレート制限で 403 を返すことがある(実測 2026-08-31)。
1 件ずつキャッシュに落とし、既にあるものは飛ばす。途中で止めても続きから走る。

**ここでは解析しない。** 取得と復号だけ。版色の抽出は `pipeline/analyze.mjs` が
出荷しているのと同じ TS/WASM 実装で行う —— 解析を二度書かない(HC-069)。

出力: `.cache/api/<id>.json` / `.cache/raw/<id>.bin`(RGB 3 バイト/画素)/ `.cache/raw/manifest.json`

実行:
    python pipeline/fetch_images.py [--limit N]
"""
from __future__ import annotations

import argparse
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
API = CACHE / "api"
RAW = CACHE / "raw"
UA = "hanshoku-atlas (research; contact via github.com/twill3c/hanshoku-atlas)"
BASE = "https://collectionapi.metmuseum.org/public/collection/v1/objects"


def safe_url(url: str) -> str:
    """**Met の画像 URL には空白が入っていることがある**(実測 2026-08-31)。

    `.../web-large/JP 3228.JPG` のような 3 件があり、そのまま渡すと
    `URL can't contain control characters` で落ちる。パス部だけを percent-encode する。
    """
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(parts._replace(path=urllib.parse.quote(parts.path, safe="/%")))


def get(url: str, *, binary: bool = False, tries: int = 5):
    """403(レート制限)は待って retry。**黙って諦めない。**"""
    delay = 1.0
    for attempt in range(tries):
        try:
            req = urllib.request.Request(safe_url(url), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read() if binary else json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(delay)
                delay *= 3
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < tries - 1:
                time.sleep(delay)
                delay *= 3
                continue
            raise
    raise RuntimeError("unreachable")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pace", type=float, default=0.35, help="1 件あたりの最短間隔(秒)")
    ap.add_argument(
        "--retry-failed",
        action="store_true",
        help="落とした件(レート制限など)だけを取り直す。**黙って欠けたままにしない**",
    )
    args = ap.parse_args()

    sample = json.loads((ROOT / "data" / "sample.json").read_text(encoding="utf-8"))
    works = sample["works"]
    if args.limit:
        works = works[: args.limit]

    API.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict] = {}
    mpath = RAW / "manifest.json"
    if mpath.exists():
        manifest = json.loads(mpath.read_text(encoding="utf-8"))

    done = skipped = failed = 0
    for i, w in enumerate(works, 1):
        oid = str(w["objectId"])
        if oid in manifest and not (args.retry_failed and "skip" in manifest[oid]):
            skipped += 1
            continue
        t0 = time.time()
        try:
            apath = API / f"{oid}.json"
            if apath.exists():
                meta = json.loads(apath.read_text(encoding="utf-8"))
            else:
                meta = get(f"{BASE}/{oid}")
                apath.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

            url = meta.get("primaryImageSmall") or ""
            if not url or not meta.get("isPublicDomain"):
                manifest[oid] = {"skip": "画像なし / public domain でない"}
                failed += 1
                continue

            raw = get(url, binary=True)
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            (RAW / f"{oid}.bin").write_bytes(im.tobytes())
            manifest[oid] = {
                "objectId": w["objectId"],
                "width": im.width,
                "height": im.height,
                "image": url,
                "accession": meta.get("accessionNumber"),
                "artist": w["artist"],
                "title": w["title"],
                "begin": w["begin"],
                "end": w["end"],
                "span": w["span"],
                "objectDate": w["objectDate"],
                "icc": bool(im.info.get("icc_profile")),
            }
            done += 1
        except Exception as e:  # noqa: BLE001 — 1 件の失敗で全体を止めない。理由は残す
            manifest[oid] = {"skip": f"{type(e).__name__}: {e}"}
            failed += 1

        if i % 25 == 0 or i == len(works):
            mpath.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            print(f"  {i}/{len(works)} 取得 {done} / 既存 {skipped} / 落とした {failed}", flush=True)

        dt = time.time() - t0
        if dt < args.pace:
            time.sleep(args.pace - dt)

    mpath.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    usable = [m for m in manifest.values() if "skip" not in m]
    icc = sum(1 for m in usable if m.get("icc"))
    widths = sorted({m["width"] for m in usable})
    print(f"完了 —— 使える {len(usable)} 件 / 落とした {sum(1 for m in manifest.values() if 'skip' in m)} 件")
    print(f"  ICC プロファイル付き {icc} 件 / 幅の種類 {widths[:6]}{'…' if len(widths) > 6 else ''}")


if __name__ == "__main__":
    main()
