"use client";

// ⑤ 摺りの散らばり(F-09)。**同じ版木から摺られた同じ絵が、どれだけ違う色をしているか。**
//
// ここで出る幅が、①〜④ の数字に付けるべき誤差棒である(G-09)。
// この画面の数字は、他のどの画面よりも先に読まれるべきものだ ——
// **幅を知らずに ① の「12.3 %」を読むと、0.1 ポイントの分解能があると思ってしまう。**

import { useCallback, useEffect, useRef, useState } from "react";
import { DESIGNS } from "@/data/designs";
import { toSameOrigin } from "@/core/met";
import {
  DOUBTFUL_DE,
  countDoubtful,
  formatShare,
  measureSpread,
  sharePrecision,
  type Spread,
  type SpreadInput,
} from "@/core/spread";
import type { WorkerRequest, WorkerResponse } from "../plate.worker";

const SEED = 20260831;

type Loaded = { accession: string; plates: SpreadInput["plates"]; engine: string };

export default function SuriPage() {
  const [designIdx, setDesignIdx] = useState(0);
  const [k, setK] = useState(8);
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [spread, setSpread] = useState<Spread | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("../plate.worker.ts", import.meta.url));
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const design = DESIGNS[designIdx];

  const run = useCallback(async () => {
    const w = workerRef.current;
    if (!w) return;
    const id = ++runId.current;
    setBusy(true);
    setError(null);
    setLoaded([]);
    setSpread(null);

    const out: Loaded[] = [];
    for (const imp of design.impressions) {
      try {
        const data = await decode(imp.image);
        const res = await extract(w, data, k);
        if (runId.current !== id) return; // 選び直された
        out.push({ accession: imp.accession, plates: res.plates, engine: res.engine });
        setLoaded([...out]);
      } catch (e) {
        if (runId.current !== id) return;
        setError(`${imp.accession} を読めなかった: ${e instanceof Error ? e.message : String(e)}`);
        setBusy(false);
        return;
      }
    }
    if (runId.current !== id) return;
    setSpread(out.length >= 2 ? measureSpread(out) : null);
    setBusy(false);
  }, [design, k]);

  useEffect(() => {
    void run();
  }, [run]);

  const prec = spread ? sharePrecision(spread.shareSpreadMax) : 1;

  return (
    <main>
      <h1>
        版色アトラス
        <span className="en">hanshoku-atlas ⑤ 摺りの散らばり</span>
      </h1>

      <nav className="nav">
        <a href="/">① 一枚解剖</a>
        <a href="/suri/" aria-current="page">⑤ 摺りの散らばり</a>
      </nav>

      <p className="subject">
        同じ版木から摺られた同じ絵を、<strong>同じ館が同じように撮影した</strong>複数の摺りで比べる。
        館をまたぐと、差のうちどこまでが褪色でどこからが撮影条件かを分離できない。館内なら、
        残る差は<strong>摺りの違いと保存状態の違い</strong>にほぼ絞られる。
        <strong>ここで出る幅が、他の画面の数字に付くべき誤差棒である。</strong>
      </p>

      <section className="panel">
        <div className="row">
          <label htmlFor="d">図柄</label>
          <select id="d" value={designIdx} onChange={(e) => setDesignIdx(Number(e.target.value))}>
            {DESIGNS.map((d, i) => (
              <option key={d.ja} value={i}>
                {d.ja} — {d.artist}({d.impressions.length} 摺り)
              </option>
            ))}
          </select>
          <label htmlFor="k2">版の数 k = {k}</label>
          <input id="k2" type="range" min={2} max={16} value={k} onChange={(e) => setK(Number(e.target.value))} />
        </div>
        <div className="stats">
          <span>
            {design.en} / {design.date} / Met {design.impressions.map((i) => i.accession).join(" ・ ")}
          </span>
          {busy ? <span>{loaded.length}/{design.impressions.length} 摺りを解析中…</span> : null}
        </div>
        {error ? <p className="err">{error}</p> : null}
      </section>

      {spread ? (
        <section className="panel headline">
          <h2>この図柄で測れた幅</h2>
          <div className="bignums">
            <div>
              <span className="n">{spread.deMedian.toFixed(1)}</span>
              <span className="l">色差 ΔE2000 の中央値</span>
            </div>
            <div>
              <span className="n">{spread.deMax.toFixed(1)}</span>
              <span className="l">同 最大</span>
            </div>
            <div>
              <span className="n">{(spread.shareSpreadMedian * 100).toFixed(1)}</span>
              <span className="l">面積比の幅の中央値(ポイント)</span>
            </div>
            <div>
              <span className="n">{(spread.shareSpreadMax * 100).toFixed(1)}</span>
              <span className="l">同 最大</span>
            </div>
          </div>
          <p>
            基準は <strong>{spread.reference}</strong>。
            面積比の幅が {(spread.shareSpreadMax * 100).toFixed(1)} ポイントあるので、
            この図柄について面積比を語ってよい桁は
            <strong>「{formatShare(0.249, prec)}」の細かさまで</strong>である(G-09)。
            <strong>ΔE2000 は 1 以下が「訓練された目でようやく判別」、5 を超えれば誰にでも別の色に見える。</strong>
          </p>
          <p className="doubtnote">
            うち <strong>{countDoubtful(spread)} 件</strong>の対応は ΔE が {DOUBTFUL_DE} を超えている(表で
            <span className="doubt">枠</span>で囲った)。これは褪色の大きさというより、
            <strong>対応づけが別の版を掴んだ</strong>可能性のほうが高い。
            <strong>それでも幅の計算からは外していない</strong> ——
            対応がつかないのは「よく分からない」であって「よく一致した」ではないので、保守側を採る。
          </p>
        </section>
      ) : null}

      {spread ? (
        <div className="scrollx">
          <table className="suri">
            <thead>
              <tr>
                <th>基準({spread.reference})の版</th>
                <th className="num">面積比</th>
                {spread.plates[0]?.members.map((m) => (
                  <th key={m.accession}>{m.accession}</th>
                ))}
                <th className="num">ΔE 最大</th>
                <th className="num">面積比の幅</th>
              </tr>
            </thead>
            <tbody>
              {spread.plates.map((p) => (
                <tr key={p.ref.index}>
                  <td>
                    <span className="sw" style={{ background: p.ref.hex }} />
                    <span className="mono">{p.ref.hex}</span>
                  </td>
                  <td className="num">{formatShare(p.ref.share, prec)}</td>
                  {p.members.map((m) => (
                    <td key={m.accession} className={m.de > DOUBTFUL_DE ? "doubt" : undefined}>
                      <span className="sw" style={{ background: m.plate.hex }} />
                      <span className="mono">{m.plate.hex}</span>
                      <br />
                      <span className="sub">
                        {formatShare(m.plate.share, prec)} / ΔE {m.de.toFixed(1)}
                      </span>
                    </td>
                  ))}
                  <td className="num strong">{p.deMax.toFixed(1)}</td>
                  <td className="num strong">{((p.shareMax - p.shareMin) * 100).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="caveat">
        <strong>対応づけは仮定である。</strong>
        摺りをまたいで「同じ版」を突き合わせる術は色の近さしかないので、ここでは
        <strong>ΔE2000 が小さい対から順に一対一で結んでいる</strong>。
        大きく褪せた版は別の版と結ばれうる —— 実際、神奈川沖浪裏の 2 つの藍は
        <span className="mono"> #3B5266 </span>と<span className="mono"> #293A47 </span>で
        <strong>ΔE2000 が 8.3 しか離れていない</strong>。摺りをまたいで色が 8.3 以上動けば入れ替わる。
        だからここに出る幅は「散らばりの真の値」ではなく、<strong>この対応づけのもとでの幅</strong>である。
      </p>

      <p className="caveat">
        <strong>網羅していない。</strong>
        ここにあるのは題名で引いて実際に確かめた 3 図柄・11 摺りだけで、
        <strong>Met に同一図柄の複数摺りが何件あるかは測っていない</strong>。
        Met の検索 API は標本枠にならない(<code>q=Hokusai</code> の 58 件中、日本の作品は 5 件)。
        数えるのは、収蔵目録の CSV を使う次の段の仕事である。
      </p>
    </main>
  );
}

// ---------------------------------------------------------------- 取得と抽出

async function decode(url: string): Promise<ImageData> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = toSameOrigin(url);
  await new Promise<void>((ok, ng) => {
    img.onload = () => ok();
    img.onerror = () => ng(new Error("画像を取得できない"));
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas を作れない");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function extract(w: Worker, data: ImageData, k: number): Promise<WorkerResponse> {
  return new Promise((ok) => {
    const id = Math.floor(performance.now() * 1000) % 2147483647;
    const onMsg = (ev: MessageEvent<WorkerResponse>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      ok(ev.data);
    };
    w.addEventListener("message", onMsg);
    const copy = new Uint8ClampedArray(data.data);
    const req: WorkerRequest = {
      id,
      width: data.width,
      height: data.height,
      data: copy.buffer as ArrayBuffer,
      k,
      seed: SEED,
      withCurve: false,
    };
    w.postMessage(req, [req.data]);
  });
}
