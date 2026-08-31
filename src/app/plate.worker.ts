/// <reference lib="webworker" />
// 版色抽出を主スレッドから外す(N-04)。k=16 の再始動 6 回はミリ秒では終わらない。

import { chooseK, elbowCurve, extractPlates, suggestPaperIndex } from "@/core/extract";

export type WorkerRequest = {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
  k: number;
  seed: number;
  withCurve: boolean;
};

export type WorkerResponse = {
  id: number;
  plates: {
    index: number;
    rgb: [number, number, number];
    hex: string;
    oklch: { L: number; C: number; h: number };
    share: number;
    pixels: number;
  }[];
  assign: ArrayBuffer;
  distinctColors: number;
  iterations: number;
  inertia: number;
  curve: { k: number; inertia: number }[] | null;
  suggestedK: number | null;
  paper: { index: number; reason: string } | null;
  /** k を 1 つ抽出するのに要した時間(N-04 の対象) */
  elapsedMs: number;
  /** 慣性曲線(k=2..16)を引くのに要した時間。**N-04 の対象ではない** */
  curveMs: number;
};

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  const img = {
    data: new Uint8ClampedArray(req.data),
    width: req.width,
    height: req.height,
  };

  const ex = extractPlates(img, { k: req.k, seed: req.seed });
  const t1 = performance.now();
  const curve = req.withCurve ? elbowCurve(img, { kMin: 2, kMax: 16, seed: req.seed }) : null;
  const t2 = performance.now();

  const res: WorkerResponse = {
    id: req.id,
    plates: ex.plates.map((p) => ({
      index: p.index,
      rgb: p.rgb,
      hex: p.hex,
      oklch: p.oklch,
      share: p.share,
      pixels: p.pixels,
    })),
    assign: ex.assign.buffer as ArrayBuffer,
    distinctColors: ex.distinctColors,
    iterations: ex.iterations,
    inertia: ex.inertia,
    curve,
    suggestedK: curve ? chooseK(curve) : null,
    paper: suggestPaperIndex(ex.plates),
    elapsedMs: t1 - t0,
    curveMs: t2 - t1,
  };

  (self as unknown as Worker).postMessage(res, [res.assign]);
};
