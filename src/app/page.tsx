"use client";

// ① 一枚解剖(F-03)。画像 URL → 版色の抽出 → パレット・面積比・OKLCh・版のマスク。
//
// 測っている対象を短くしない(F-04)。この画面が出すのは
// 「Met が公開した画像において k-means が復元した版色」であって、摺られた当時の色ではない。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HueWheel } from "./HueWheel";
import { toSameOrigin } from "@/core/met";
import type { WorkerRequest, WorkerResponse } from "./plate.worker";

/** 実測 2026-08-31: primaryImageSmall(web-large)は 600 px 幅・ICC プロファイル無し(SPEC §2.6) */
const PRESETS = [
  {
    label: "神奈川沖浪裏 JP10",
    url: "https://images.metmuseum.org/CRDImages/as/web-large/DP141063.jpg",
    note: "北斎『富嶽三十六景』ca.1830–32 / Met JP10",
  },
  {
    label: "同 JP1847",
    url: "https://images.metmuseum.org/CRDImages/as/web-large/DP130155.jpg",
    note: "同じ図柄の別の摺り / Met JP1847",
  },
  {
    label: "同 JP2569",
    url: "https://images.metmuseum.org/CRDImages/as/web-large/DP141042.jpg",
    note: "同じ図柄の別の摺り / Met JP2569",
  },
  {
    label: "同 JP2972",
    url: "https://images.metmuseum.org/CRDImages/as/web-large/DP141067.jpg",
    note: "同じ図柄の別の摺り / Met JP2972",
  },
  {
    label: "東海道五十三次 川崎",
    url: "https://images.metmuseum.org/CRDImages/as/web-large/DP121290.jpg",
    note: "広重 / Met JP3443",
  },
];

const SEED = 20260831;

type Result = Omit<WorkerResponse, "assign"> & { assign: Uint32Array };

export default function Page() {
  const [url, setUrl] = useState(PRESETS[0].url);
  const [pending, setPending] = useState(PRESETS[0].url);
  const [k, setK] = useState(8);
  const [excludePaper, setExcludePaper] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [wantCurve, setWantCurve] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  // ------------------------------------------------------------ worker
  useEffect(() => {
    const w = new Worker(new URL("./plate.worker.ts", import.meta.url));
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.id !== reqId.current) return; // 古い応答は捨てる
      setResult({ ...ev.data, assign: new Uint32Array(ev.data.assign) });
      setBusy(false);
    };
    return () => w.terminate();
  }, []);

  // ------------------------------------------------------------ 画像の読み込み
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setResult(null);
    setSelected(null);
    const img = new Image();
    // 同一オリジン(/met/…)に寄せてから読む。crossOrigin は残しておく ——
    // 他館の画像を URL 欄に入れたとき、ACAO を返す配布元なら読めるようにするため(F-05)。
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      try {
        imageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        setError(
          "この画像は CORS 越しに読めなかった。canvas が汚染され、色を数えられない。" +
            "images.metmuseum.org は GET に Access-Control-Allow-Origin を返さないので、" +
            "同一オリジンへの書き換え(/met/…)を通す必要がある。",
        );
        return;
      }
      setResult(null);
      setWantCurve(false);
      requestExtraction(false);
    };
    img.onerror = () => {
      if (!cancelled) setError("画像を取得できなかった。URL を確認すること。");
    };
    img.src = toSameOrigin(pending);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const requestExtraction = useCallback((withCurve = false) => {
    const w = workerRef.current;
    const data = imageDataRef.current;
    if (!w || !data) return;
    setBusy(true);
    const id = ++reqId.current;
    const copy = new Uint8ClampedArray(data.data);
    const req: WorkerRequest = {
      id,
      width: data.width,
      height: data.height,
      data: copy.buffer as ArrayBuffer,
      k,
      seed: SEED,
      withCurve,
    };
    w.postMessage(req, [req.data]);
  }, [k]);

  useEffect(() => {
    if (imageDataRef.current) requestExtraction(false);
  }, [k, requestExtraction]);

  // ------------------------------------------------------------ マスク描画
  useEffect(() => {
    const canvas = canvasRef.current;
    const src = imageDataRef.current;
    if (!canvas || !src) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (selected === null || !result) {
      ctx.putImageData(src, 0, 0);
      return;
    }
    // 選んだ版だけを残し、他を灰に落とす。版の位置がそのまま見える(F-03)
    const out = ctx.createImageData(src.width, src.height);
    for (let i = 0; i < result.assign.length; i++) {
      const o = i * 4;
      if (result.assign[i] === selected) {
        out.data[o] = src.data[o];
        out.data[o + 1] = src.data[o + 1];
        out.data[o + 2] = src.data[o + 2];
      } else {
        const g = (src.data[o] * 0.299 + src.data[o + 1] * 0.587 + src.data[o + 2] * 0.114) * 0.35 + 150;
        out.data[o] = g;
        out.data[o + 1] = g;
        out.data[o + 2] = g;
      }
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [selected, result]);

  // ------------------------------------------------------------ 表示するパレット
  const shown = useMemo(() => {
    if (!result) return [];
    const paper = result.paper?.index ?? null;
    if (!excludePaper || paper === null) return result.plates;
    const rest = result.plates.filter((p) => p.index !== paper);
    const sum = rest.reduce((a, p) => a + p.share, 0);
    return sum > 0 ? rest.map((p) => ({ ...p, share: p.share / sum })) : rest;
  }, [result, excludePaper]);

  return (
    <main>
      <h1>
        版色アトラス
        <span className="en">hanshoku-atlas ① 一枚解剖</span>
      </h1>

      {/* F-04 —— 主語を短くしない */}
      <p className="subject">
        この画面が測っているのは<strong>「メトロポリタン美術館が公開した画像において、k-means が復元した版色の分布」</strong>である。
        摺られた当時の色ではない。我々が見ている浮世絵は、
        <strong>顔料 → 200 年超の褪色 → 所蔵館の撮影 → 閲覧者のディスプレイ</strong>という四層の媒介を通っており、
        アプリが制御できるのは最後の一つだけである。
      </p>

      <section className="panel">
        <div className="row">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            aria-label="画像 URL"
          />
          <button onClick={() => setPending(url)}>読み込む</button>
        </div>
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              key={p.url}
              aria-pressed={pending === p.url}
              title={p.note}
              onClick={() => {
                setUrl(p.url);
                setPending(p.url);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {error ? <p className="err">{error}</p> : null}
      </section>

      <section className="panel">
        <div className="row">
          <label htmlFor="k">版の数 k = {k}</label>
          <input
            id="k"
            type="range"
            min={2}
            max={16}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          />
          <label>
            <input
              type="checkbox"
              checked={excludePaper}
              onChange={(e) => setExcludePaper(e.target.checked)}
            />
            紙の地色を版色に数えない
          </label>
        </div>
        <div className="stats">
          {result?.suggestedK != null ? (
            <>
              <span>
                慣性の折れ曲がりが示す k = {result.suggestedK}
                {result.suggestedK !== k ? "(スライダーは別の値)" : ""}
              </span>
              <button onClick={() => setK(result.suggestedK as number)}>この k を使う</button>
            </>
          ) : (
            <>
              <button
                disabled={busy || !result}
                onClick={() => {
                  setWantCurve(true);
                  requestExtraction(true);
                }}
              >
                k を 2〜16 まで動かして慣性の折れ曲がりを探す
              </button>
              <span>
                {wantCurve && busy ? "計算中(十数秒かかる)…" : "重い計算なので、押したときだけ走らせる"}
              </span>
            </>
          )}
        </div>
        {result?.paper ? (
          <p className="paperNote">
            地色の<strong>候補</strong>: {result.plates[result.paper.index]?.hex} —— {result.paper.reason}。
            これは提案であって判定ではない。数えるかどうかは分析者が決める。
          </p>
        ) : null}
      </section>

      <div className="stage">
        <div className="canvasWrap">
          <canvas ref={canvasRef} />
        </div>

        <div>
          {shown.length > 0 ? (
            <HueWheel plates={shown} selected={selected} onSelect={setSelected} />
          ) : null}
          <div className="plates" style={{ marginTop: shown.length > 0 ? 16 : 0 }}>
            {shown.map((p) => (
              <button
                key={p.index}
                className="plate"
                aria-pressed={selected === p.index}
                onClick={() => setSelected(selected === p.index ? null : p.index)}
              >
                <span className="sw" style={{ background: p.hex }} />
                <span>
                  <span className="hex">{p.hex}</span>
                  <br />
                  <span className="meta">
                    L {p.oklch.L.toFixed(3)} / C {p.oklch.C.toFixed(3)} / h {p.oklch.h.toFixed(1)}°
                  </span>
                </span>
                <span className="share">{(p.share * 100).toFixed(1)} %</span>
              </button>
            ))}
            {shown.length === 0 ? <div style={{ padding: "14px 12px" }}>{busy ? "抽出中…" : "—"}</div> : null}
          </div>

          {result ? (
            <div className="stats">
              <span>相異なる色 {result.distinctColors.toLocaleString()}</span>
              <span>反復 {result.iterations}</span>
              <span>抽出 {result.elapsedMs.toFixed(0)} ms</span>
              <span>慣性曲線 {result.curveMs.toFixed(0)} ms</span>
              <span>seed {SEED}</span>
              <span title="TS 実装と Rust/WASM 実装はビット一致する。速い方をその場で測って選んでいる">
                {result.engine}
                {result.engineNote ? `(${result.engineNote})` : ""}
              </span>
              {busy ? <span>抽出中…</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      <p className="caveat">
        <strong>紙の地色は一つの版ではない。</strong>
        神奈川沖浪裏(Met JP10)を k=8 で解剖すると、上位 5 版のうち 4 版
        <span className="mono"> #E1CCAB / #CBBCA0 / #B9B097 / #F1E2C9 </span>
        が生成り〜黄変の帯で、合わせて画面の 75.9 % を占める(実測 2026-08-31)。
        これは版が 4 枚あるのではなく、<strong>200 年分の褪色ムラが一枚の紙を複数のクラスタに割っている</strong>。
        地色のトグルが外せるのは 1 つだけなので、<strong>外しても紙は残る</strong>。
        ここは自動判定にせず、分析者が見て決める場所である。
      </p>

      <p className="caveat">
        <strong>この数字が言えないこと。</strong>
        版色の抽出は合成木版(色と面積比が既知の画像)に対して検証してある —— 標準条件(ノイズ σ=2 + クロマ間引き 4:2:0)の
        60 枚で、色差 ΔE2000 の中央値 0.00 / 最大 0.30、面積比の絶対誤差 最大 4.4×10⁻⁴。
        しかし<strong>実際の浮世絵の版数はカタログに書かれていない</strong>(Met の記述は
        “Woodblock print; ink and color on paper” までで版数を記さない)。
        したがって「慣性の折れ曲がりが示す k」が本物の版数と一致するかは、
        <strong>本番の作品では検証されていない</strong>。合成データでの的中率 1.000 は、
        合成データについての事実である。
      </p>
    </main>
  );
}
